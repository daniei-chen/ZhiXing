import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const load = (name) =>
  import(
    packed
      ? pathToFileURL(path.join(packed, name)).href
      : new URL(`../${name}`, import.meta.url).href
  );
const nativeRequire = createRequire(
  packed ? path.join(packed, 'package.json') : new URL('../package.json', import.meta.url),
);
const native = (name) => import(pathToFileURL(nativeRequire.resolve(name)).href);
const { Context } = await native('@deepseek-ai/cordis');
const { SessionProjectionRegistry } = await native('@deepseek-ai/dsh-session-projection');
const { SessionStore } = await native('@deepseek-ai/dsh-session');
const { AgentRegistry } = await native('@deepseek-ai/dsh-agent');
const { SubagentRuntime } = await native('@deepseek-ai/dsh-subagent');
const { ApprovalService, setApprovalPolicy } = await native('@deepseek-ai/dsh-user-approval');
const plugin = await load('harness/approval-bridge.mjs');
const { startToolBridge } = await load('electron/tool-bridge.mjs');

const ENV_KEYS = ['ZHIXING_APPROVAL_URL', 'ZHIXING_APPROVAL_TOKEN', 'ZHIXING_APPROVAL_SESSION'];

function onAbort(signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
}

async function rawServer(t, handle) {
  const server = http.createServer(handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  return `http://127.0.0.1:${server.address().port}/approval`;
}

async function fixture(t, options = {}) {
  const ctx = new Context();
  const controller = new AbortController();
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const calls = [];
  const events = [];
  const logs = [];
  let bridge;
  t.after(async () => {
    controller.abort();
    try {
      await ctx.fiber.dispose();
      await bridge?.close();
    } finally {
      for (const key of ENV_KEYS) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  // Real Cordis services own registration, live identity, policy, projections and
  // audit. Agent objects are controlled fixtures: no model or filesystem tool runs.
  // The native subagent manager needs this dependency, but rootOf never calls it.
  ctx.provide('workingDirectory', {});
  for (const service of [
    SessionProjectionRegistry,
    SessionStore,
    AgentRegistry,
    SubagentRuntime,
    ApprovalService,
  ]) {
    await ctx.plugin(service, {}).await();
  }
  ctx.on('session/event', (session, event) => events.push({ sessionId: session.id, ...event }));
  ctx.logger.exporter({ export: (message) => logs.push(message.args) });

  async function agent(id, meta) {
    const session = ctx.sessions.create(id, meta ? { meta } : undefined);
    const value = { id: session.id, session, ctx };
    const detach = await ctx.agents.register(value);
    return { value, detach };
  }
  const root = await agent('approval-root');
  bridge = await startToolBridge({
    route: '/approval',
    signal: controller.signal,
    maxBodyBytes: 256 * 1024,
    async invoke(input, signal) {
      calls.push(input);
      return options.invoke ? options.invoke(input, signal) : { outcome: 'allowed-once' };
    },
  });
  const env = {
    ZHIXING_APPROVAL_URL: options.url ?? bridge.url,
    ZHIXING_APPROVAL_TOKEN: options.token ?? bridge.token,
    ZHIXING_APPROVAL_SESSION: root.value.id,
  };
  Object.assign(process.env, env);
  const fiber = ctx.plugin(plugin);
  await fiber.await();
  for (const key of ENV_KEYS) assert.equal(process.env[key], undefined, `${key} must be consumed`);
  return { ctx, root, agent, calls, events, logs, env, fiber, controller };
}

function openTurn(agent) {
  agent.session.append('turn/start', { turn: 1 });
}

function audit(f, sessionId = f.root.value.session.id) {
  return f.events.filter(
    (event) => event.sessionId === sessionId && event.type.startsWith('approval/'),
  );
}

test('native approval audits two separate decisions for the same tool call', async (t) => {
  const outcomes = ['allowed-once', 'rejected', 'cancelled', 'unavailable'];
  const f = await fixture(t, { invoke: () => ({ outcome: outcomes.shift() }) });
  const agent = f.root.value;
  openTurn(agent);
  const request = {
    agent,
    toolName: 'office_write_file',
    callId: 'same-native-tool-call',
    reason: JSON.stringify({ operation: 'write', path: 'report.txt', overwrite: false }),
    rootSessionId: 'model-supplied-root-must-not-cross',
    params: { secret: 'non-approval-parameters-must-not-cross' },
  };
  for (const expected of ['allowed-once', 'rejected', 'cancelled', 'unavailable']) {
    assert.equal(await f.ctx.approval.request(request), expected);
  }
  assert.equal(f.calls.length, 4);
  for (const call of f.calls) {
    assert.deepEqual(call, {
      sessionId: agent.session.id,
      toolName: request.toolName,
      callId: request.callId,
      reason: request.reason,
    });
  }
  const entries = audit(f);
  assert.deepEqual(
    entries.map((entry) => entry.type),
    Array.from({ length: 4 }, () => ['approval/asked', 'approval/decided']).flat(),
  );
  const asked = entries.filter((entry) => entry.type === 'approval/asked');
  const decided = entries.filter((entry) => entry.type === 'approval/decided');
  assert.equal(new Set(asked.map((entry) => entry.data.id)).size, 4);
  assert.deepEqual(
    decided.map((entry) => entry.data.id),
    asked.map((entry) => entry.data.id),
  );
  assert.deepEqual(
    decided.map((entry) => entry.data.outcome),
    ['allowed-once', 'rejected', 'cancelled', 'unavailable'],
  );
  assert(!JSON.stringify(f.logs).includes(f.env.ZHIXING_APPROVAL_TOKEN));
});

test('native turn enclosure, never policy and pre-cancellation still precede the bridge', async (t) => {
  const f = await fixture(t);
  const agent = f.root.value;
  const request = { agent, toolName: 'write' };
  await assert.rejects(f.ctx.approval.request(request), /outside an open turn/);
  assert.equal(audit(f).length, 0);
  openTurn(agent);
  setApprovalPolicy(agent.session, 'never');
  assert.equal(await f.ctx.approval.request(request), 'rejected');
  setApprovalPolicy(agent.session, 'ask');
  assert.equal(
    await f.ctx.approval.request({ ...request, signal: AbortSignal.abort() }),
    'cancelled',
  );
  assert.equal(f.calls.length, 0);
  assert.deepEqual(
    audit(f)
      .filter((entry) => entry.type === 'approval/decided')
      .map((entry) => entry.data.outcome),
    ['rejected', 'cancelled'],
  );
});

test(
  'native cancellation aborts real HTTP and a late allow cannot change its audited decision',
  { timeout: 10000 },
  async (t) => {
    const arrived = Promise.withResolvers();
    const disconnected = Promise.withResolvers();
    const lateAllow = Promise.withResolvers();
    const completed = Promise.withResolvers();
    t.after(() => lateAllow.resolve());
    const f = await fixture(t, {
      async invoke(input, signal) {
        arrived.resolve(input);
        await onAbort(signal);
        disconnected.resolve();
        await lateAllow.promise;
        completed.resolve();
        return { outcome: 'allowed-once' };
      },
    });
    const agent = f.root.value;
    openTurn(agent);
    const controller = new AbortController();
    const answer = f.ctx.approval.request({
      agent,
      toolName: 'write',
      callId: 'cancel-current-operation',
      signal: controller.signal,
    });
    await arrived.promise;
    controller.abort();
    assert.equal(await answer, 'cancelled');
    await disconnected.promise;
    lateAllow.resolve();
    await completed.promise;
    assert.equal(f.calls.length, 1);
    assert.equal(audit(f).length, 2);
    assert.equal(audit(f)[1].data.outcome, 'cancelled');
  },
);

test(
  'disposing only the answerer cancels a pending native request without a caller signal',
  { timeout: 10000 },
  async (t) => {
    const arrived = Promise.withResolvers();
    const disconnected = Promise.withResolvers();
    const f = await fixture(t, {
      async invoke(input, signal) {
        arrived.resolve(input);
        await onAbort(signal);
        disconnected.resolve();
        return { outcome: 'allowed-once' };
      },
    });
    const agent = f.root.value;
    openTurn(agent);
    const answer = f.ctx.approval.request({ agent, toolName: 'write' });
    await arrived.promise;
    await f.fiber.dispose();
    assert.equal(await answer, 'cancelled');
    await disconnected.promise;
    assert.equal(audit(f)[1].data.outcome, 'cancelled');
  },
);

test('foreign roots, stale Agent identities and orphaned child metadata fall through', async (t) => {
  const f = await fixture(t);
  const foreign = await f.agent('foreign-root');
  const orphan = await f.agent('orphan-child', {
    parentSession: f.root.value.session.id,
    origin: 'subagent',
    delegationDepth: 1,
  });
  assert.equal(f.ctx.subagents.rootOf(foreign.value), foreign.value);
  assert.throws(() => f.ctx.subagents.rootOf(orphan.value), /no active runtime owner/);
  const stale = { ...f.root.value };
  let nextCalls = 0;
  f.ctx.on('approval/request', () => {
    nextCalls += 1;
    return 'rejected';
  });
  for (const agent of [foreign.value, orphan.value, stale]) {
    openTurn(agent);
    assert.equal(
      await f.ctx.approval.request({
        agent,
        toolName: 'write',
        reason: JSON.stringify({ rootSessionId: f.root.value.id }),
      }),
      'rejected',
    );
  }
  assert.equal(nextCalls, 3);
  assert.equal(f.calls.length, 0);
});

test('unexpected native ownership failures are unavailable without invoking later answerers', async (t) => {
  const f = await fixture(t);
  const foreign = await f.agent('foreign-with-unavailable-owner');
  openTurn(foreign.value);
  t.mock.method(SubagentRuntime.prototype, 'rootOf', () => {
    throw Object.assign(new Error('PRIVATE_NATIVE_OWNERSHIP_FAILURE'), {
      code: 'INTERNAL_FAILURE',
    });
  });
  let fallbackCalls = 0;
  f.ctx.on('approval/request', () => {
    fallbackCalls += 1;
    return 'allowed-once';
  });
  assert.equal(
    await f.ctx.approval.request({ agent: foreign.value, toolName: 'write' }),
    'unavailable',
  );
  assert.equal(fallbackCalls, 0);
  assert.equal(f.calls.length, 0);
  assert(!JSON.stringify(f.logs).includes('PRIVATE_NATIVE_OWNERSHIP_FAILURE'));
});

test(
  'a live Agent replacement while approval waits cannot consume the old allow',
  { timeout: 10000 },
  async (t) => {
    const arrived = Promise.withResolvers();
    const finish = Promise.withResolvers();
    t.after(() => finish.resolve());
    const f = await fixture(t, {
      async invoke(input) {
        arrived.resolve(input);
        await finish.promise;
        return { outcome: 'allowed-once' };
      },
    });
    const agent = f.root.value;
    openTurn(agent);
    const answer = f.ctx.approval.request({ agent, toolName: 'write' });
    await arrived.promise;
    await f.root.detach();
    const replacement = { ...agent };
    await f.ctx.agents.register(replacement);
    assert.equal(f.ctx.agents.get(agent.id), replacement);
    finish.resolve();
    assert.equal(await answer, 'unavailable');
    assert.equal(audit(f)[1].data.outcome, 'unavailable');
  },
);

test('invalid outcomes, authentication failure and transport exceptions fail closed without logging contents', async (t) => {
  for (const [label, options] of [
    ['unknown outcome', { invoke: () => ({ outcome: 'allow-always' }) }],
    ['wrong envelope', { invoke: () => 'allowed-once' }],
    ['wrong token', { token: '0'.repeat(64) }],
    [
      'host rejection',
      {
        invoke: () => {
          throw new Error('PRIVATE_HOST_REASON');
        },
      },
    ],
  ]) {
    await t.test(label, async (st) => {
      const f = await fixture(st, options);
      const agent = f.root.value;
      openTurn(agent);
      assert.equal(
        await f.ctx.approval.request({
          agent,
          toolName: 'write',
          reason: 'PRIVATE_REQUEST_REASON',
        }),
        'unavailable',
      );
      const logs = JSON.stringify(f.logs);
      assert(!logs.includes(f.env.ZHIXING_APPROVAL_TOKEN));
      assert(!logs.includes('PRIVATE_HOST_REASON'));
      assert(!logs.includes('PRIVATE_REQUEST_REASON'));
    });
  }
});

test('the loopback answerer refuses redirects, malformed JSON and oversized replies', async (t) => {
  let redirected = 0;
  const target = await rawServer(t, (_req, res) => {
    redirected += 1;
    res.end('{"value":{"outcome":"allowed-once"}}');
  });
  for (const [label, handle] of [
    ['redirect', (_req, res) => res.writeHead(302, { location: target }).end()],
    ['malformed', (_req, res) => res.end('{broken json')],
    [
      'oversized',
      (_req, res) => res.end(' '.repeat(4097) + '{"value":{"outcome":"allowed-once"}}'),
    ],
  ]) {
    await t.test(label, async (st) => {
      const url = await rawServer(st, handle);
      const f = await fixture(st, { url });
      openTurn(f.root.value);
      assert.equal(
        await f.ctx.approval.request({ agent: f.root.value, toolName: 'write' }),
        'unavailable',
      );
    });
  }
  assert.equal(redirected, 0);
});

test('endpoint configuration stays local and invalid configuration is consumed and fails closed', async (t) => {
  for (const url of [
    'https://127.0.0.1:1234/approval',
    'http://example.invalid:1234/approval',
    'http://127.0.0.1:1234/another-route',
    'http://user:secret@127.0.0.1:1234/approval',
    'http://127.0.0.1:1234/approval?root=other',
    'http://127.0.0.1:1234/approval#other',
    'http://127.0.0.1:0/approval',
  ]) {
    await t.test(new URL(url).pathname + ' / invalid configuration', async (st) => {
      const f = await fixture(st, { url });
      openTurn(f.root.value);
      assert.equal(
        await f.ctx.approval.request({ agent: f.root.value, toolName: 'write' }),
        'unavailable',
      );
      assert.equal(f.calls.length, 0);
    });
  }
});

test('full approval reasons are transported without truncation and oversized requests are refused', async (t) => {
  const f = await fixture(t);
  const agent = f.root.value;
  openTurn(agent);
  const reason = JSON.stringify({ command: 'x'.repeat(20000), detail: '中'.repeat(20000) });
  assert.equal(await f.ctx.approval.request({ agent, toolName: 'exec', reason }), 'allowed-once');
  assert.equal(f.calls[0].reason, reason);
  assert.equal(
    await f.ctx.approval.request({ agent, toolName: 'exec', reason: 'x'.repeat(256 * 1024) }),
    'unavailable',
  );
  assert.equal(f.calls.length, 1);
});

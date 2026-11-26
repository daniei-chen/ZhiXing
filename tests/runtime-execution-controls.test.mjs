import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const load = (name) =>
  import(
    packed
      ? pathToFileURL(path.join(packed, name)).href
      : new URL(`../${name}`, import.meta.url).href
  );
const { RuntimeManager } = await load('electron/runtime.mjs');
const { createBridgeKey, writeBridge, readBridge } = await load('harness/privacy-bridge.mjs');
const { apply } = await load('harness/execution-controls.mjs');

async function temporaryRoot(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-execution-control-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert(path.basename(resolved).startsWith('zhixing-execution-control-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  });
  return root;
}

test(
  'child creation is starting; only native running grants interrupt, idle and end revoke it',
  { timeout: 10000 },
  async (t) => {
    const root = await temporaryRoot(t);
    const parentId = 'control-parent',
      childId = 'control-child';
    const messages = [
      {
        method: 'subagent.started',
        params: { childSessionId: childId, parentSessionId: parentId },
      },
      { method: 'session.status', params: { sessionId: 'unrelated-child', status: 'running' } },
      { method: 'session.status', params: { sessionId: childId, status: 'running' } },
      { method: 'session.status', params: { sessionId: childId, status: 'idle' } },
      {
        method: 'subagent.finished',
        params: { childSessionId: childId, parentSessionId: parentId, stopReason: 'aborted' },
      },
      { method: 'session.status', params: { sessionId: childId, status: 'idle' } },
    ];
    const vaults = new Map(),
      observed = [],
      processed = Promise.withResolvers();
    let publication,
      bridgeCommitted = false,
      admittedAfterBridge = false;
    const manager = new RuntimeManager({
      root,
      readVault: async (id) => vaults.get(id),
      writeVault: async (id, value) => vaults.set(id, value),
      createGateway: async () => ({
        baseUrl: 'http://127.0.0.1:1',
        apiKey: 'control-fixture-key',
        close: async () => {},
      }),
      onEvent(event) {
        if (event.type !== 'subagents') return;
        const targets = manager.runs.get('control-run').controls.targets;
        observed.push({
          status: event.status,
          interrupt: targets.has(`interrupt-agent:${childId}`),
          foreign: targets.has('interrupt-agent:unrelated-child'),
        });
      },
      createHarness: async (directory, options) => ({
        async start() {
          await writeBridge(path.join(directory, 'context.bin'), options.bridgeKey, {
            [parentId]: { tools: [], skills: [] },
          });
          publication = delay(60).then(async () => {
            await writeBridge(options.controls.file, options.controls.key, {
              url: 'http://127.0.0.1:1/execution',
              token: 'synthetic-control-token',
            });
            bridgeCommitted = true;
          });
        },
        async close() {},
        client: {
          async request() {},
          subscribeSessionTree() {
            const closed = Promise.withResolvers();
            return {
              tryNext: () => undefined,
              close: () => closed.resolve(),
              async *[Symbol.asyncIterator]() {
                for (const message of messages) yield message;
                processed.resolve();
                await closed.promise;
              },
            };
          },
        },
        session: () => ({
          run: async () => {
            admittedAfterBridge = bridgeCommitted;
            await processed.promise;
            return { finishReason: 'completed', finalResponse: 'SYNTHETIC_DONE' };
          },
        }),
      }),
    });
    try {
      const result = await manager.run(
        { runId: 'control-run', sessionId: parentId, prompt: '合成生命周期验收。' },
        {
          baseUrl: 'https://synthetic.invalid',
          model: 'synthetic',
          reasoning: 'off',
          manualControls: true,
        },
        'control-fixture-key',
      );
      assert.equal(admittedAfterBridge, true, 'No turn may start before control publication');
      assert.deepEqual(observed, [
        { status: 'starting', interrupt: false, foreign: false },
        { status: 'running', interrupt: true, foreign: false },
        { status: 'idle', interrupt: false, foreign: false },
        { status: 'aborted', interrupt: false, foreign: false },
      ]);
      assert.equal(result.children[0].status, 'aborted');
    } finally {
      await manager.close();
      await publication;
    }
  },
);

test(
  'missing control bridge fails startup within four seconds and never admits a turn',
  { timeout: 7000 },
  async (t) => {
    const root = await temporaryRoot(t);
    const vaults = new Map();
    let turns = 0;
    const manager = new RuntimeManager({
      root,
      readVault: async (id) => vaults.get(id),
      writeVault: async (id, value) => vaults.set(id, value),
      createGateway: async () => ({
        baseUrl: 'http://127.0.0.1:1',
        apiKey: 'control-fixture-key',
        close: async () => {},
      }),
      createHarness: async () => ({
        async start() {},
        async close() {},
        client: {},
        session: () => ({
          run: async () => {
            turns++;
            throw new Error('Unexpected turn admission');
          },
        }),
      }),
    });
    const start = Date.now();
    try {
      await assert.rejects(
        manager.run(
          { runId: 'missing-control', sessionId: 'missing-control', prompt: 'Synthetic prompt' },
          {
            baseUrl: 'https://synthetic.invalid',
            model: 'synthetic',
            reasoning: 'off',
            manualControls: true,
          },
          'control-fixture-key',
        ),
        (error) => {
          assert.equal(error.code, 'RUNTIME_CONTROL_BRIDGE_UNAVAILABLE');
          assert.equal(error.stage, 'startup');
          assert.match(error.message, /本次交办尚未发送/);
          return true;
        },
      );
      assert.equal(turns, 0);
      assert(Date.now() - start >= 3900 && Date.now() - start < 5500);
    } finally {
      await manager.close();
    }
  },
);

async function controlFixture(t, respond = (_req, res) => res.end('{"value":"requested"}')) {
  const root = await temporaryRoot(t);
  const file = path.join(root, 'control.bin'),
    key = createBridgeKey();
  const controller = new AbortController();
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    respond(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const manager = new RuntimeManager({ root });
  manager.runs.set('control-run', {
    controller,
    controls: {
      sessionId: 'control-parent',
      file,
      key,
      targets: new Map([['interrupt-agent:control-child', 'control-parent']]),
    },
  });
  t.after(async () => {
    controller.abort();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    manager.runs.clear();
  });
  return {
    file,
    key,
    controller,
    calls: () => calls,
    publish: () =>
      writeBridge(file, key, {
        url: `http://127.0.0.1:${server.address().port}/execution`,
        token: 'local-control-fixture-token',
      }),
    control: () =>
      manager.controlExecution({
        runId: 'control-run',
        sessionId: 'control-parent',
        action: 'interrupt-agent',
        target: 'control-child',
      }),
  };
}

test('control waits for atomic bridge publication instead of rejecting the first ENOENT', async (t) => {
  const fixture = await controlFixture(t);
  const outcome = fixture.control().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await delay(50);
  assert.equal(fixture.calls(), 0);
  await fixture.publish();
  const result = await outcome;
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, { requested: true });
  assert.equal(fixture.calls(), 1);
});

test('bridge readiness stops on caller cancellation without sending a request', async (t) => {
  const fixture = await controlFixture(t);
  const start = Date.now();
  const rejected = assert.rejects(fixture.control(), /内核未能完成此操作/);
  await delay(30);
  fixture.controller.abort();
  await rejected;
  assert(Date.now() - start < 1000);
  assert.equal(fixture.calls(), 0);
});

test('corrupt encrypted control record fails immediately and is not treated as starting', async (t) => {
  const fixture = await controlFixture(t);
  await fs.writeFile(fixture.file, 'not-an-encrypted-control-record');
  const start = Date.now();
  await assert.rejects(fixture.control(), /内核未能完成此操作/);
  assert(Date.now() - start < 1000);
  assert.equal(fixture.calls(), 0);
});

test(
  'readiness and HTTP share the original four-second control budget',
  { timeout: 7000 },
  async (t) => {
    let timer;
    const fixture = await controlFixture(t, (_req, res) => {
      timer = setTimeout(() => res.end('{"value":"requested"}'), 1200);
    });
    t.after(() => clearTimeout(timer));
    const start = Date.now();
    const rejected = assert.rejects(fixture.control(), /内核未能完成此操作/);
    await delay(3300);
    await fixture.publish();
    await rejected;
    const elapsed = Date.now() - start;
    assert.equal(fixture.calls(), 1);
    assert(elapsed >= 3900 && elapsed < 5000, `Shared control budget elapsed ${elapsed}ms`);
  },
);

test('Cordis plugin initialization does not finish before its encrypted control record', async (t) => {
  const root = await temporaryRoot(t);
  const file = path.join(root, 'control.bin'),
    key = createBridgeKey();
  const names = ['ZHIXING_CONTROL_PATH', 'ZHIXING_CONTROL_KEY', 'ZHIXING_CONTROL_SESSION'];
  const previous = names.map((name) => process.env[name]);
  Object.assign(process.env, {
    ZHIXING_CONTROL_PATH: file,
    ZHIXING_CONTROL_KEY: key,
    ZHIXING_CONTROL_SESSION: 'control-parent',
  });
  let dispose;
  try {
    const initialized = apply({
      agents: { get: () => null },
      subagents: {},
      logger: { warn() {} },
      on(name, callback) {
        if (name === 'dispose') dispose = callback;
      },
    });
    assert.equal(typeof initialized?.then, 'function', 'Cordis must observe bridge readiness');
    await initialized;
    const bridge = await readBridge(file, key);
    assert.match(bridge.url, /^http:\/\/127\.0\.0\.1:\d+\/execution$/);
    assert.equal(typeof bridge.token, 'string');
    for (const name of names) assert.equal(process.env[name], undefined);
  } finally {
    await dispose?.();
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const load = (name) =>
  import(
    packed
      ? pathToFileURL(path.join(packed, name)).href
      : new URL(`../${name}`, import.meta.url).href
  );
const { RuntimeManager } = await load('electron/runtime.mjs');
const { RuntimeApprovals } = await load('electron/runtime-approvals.mjs');
const { readBridge } = await load('harness/privacy-bridge.mjs');

function response(res, model, value) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta, finish_reason = null) =>
    res.write(
      `data: ${JSON.stringify({
        id: 'approval-integration-response',
        object: 'chat.completion.chunk',
        created: 1,
        model,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`,
    );
  send({ role: 'assistant', content: '' });
  if (value.tool) {
    send({
      tool_calls: [
        {
          index: 0,
          id: 'approval-call',
          type: 'function',
          function: {
            name: value.tool.name,
            arguments: JSON.stringify(value.tool.input),
          },
        },
      ],
    });
    send({}, 'tool_calls');
  } else {
    send({ content: value.text });
    send({}, 'stop');
  }
  res.end('data: [DONE]\n\n');
}

async function fixture(t, { child = false } = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-approval-integration-'));
  const workspace = path.join(root, 'project');
  await fs.mkdir(workspace);
  const target = path.join(workspace, 'approval-result.txt');
  const received = Promise.withResolvers();
  const approvals = new RuntimeApprovals({
    onChange: (snapshot) => {
      if (snapshot.pending.length) received.resolve(snapshot);
    },
  });
  const vaults = new Map();
  const requests = [];
  const failures = [];
  const approvalRequests = [];
  let delegated = false;
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/v1/chat/completions');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      const isChild =
        JSON.stringify(body.messages).includes('CHILD_APPROVAL_REQUEST') &&
        !JSON.stringify(body.messages).includes('ROOT_APPROVAL_REQUEST');
      if (child && !isChild) {
        if (!delegated) {
          delegated = true;
          response(res, body.model, {
            tool: {
              name: 'subagent',
              input: {
                description: '审批来源合成回归',
                prompt: 'CHILD_APPROVAL_REQUEST 请创建合成结果文件。',
              },
            },
          });
        } else response(res, body.model, { text: 'PARENT_APPROVAL_DONE' });
        return;
      }
      if (body.messages.some((message) => message.role === 'tool')) {
        response(res, body.model, { text: isChild ? 'CHILD_APPROVAL_DONE' : 'ROOT_APPROVAL_DONE' });
      } else {
        response(res, body.model, {
          tool: {
            name: 'office_write_file',
            input: {
              file_path: 'approval-result.txt',
              content: 'APPROVAL_FILE_CONTENT',
            },
          },
        });
      }
    } catch (error) {
      failures.push(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const manager = new RuntimeManager({
    root: path.join(root, 'harness'),
    readVault: async (id) => vaults.get(id),
    writeVault: async (id, value) => vaults.set(id, value),
    onApproval: (request) => {
      approvalRequests.push(request);
      return approvals.request(request);
    },
  });
  let cleanupPromise;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      approvals.close();
      server.closeAllConnections();
      const [shutdown] = await Promise.all([
        manager.close(),
        new Promise((resolve) => server.close(resolve)),
      ]);
      assert.equal(shutdown.cleanupPending.length, 0);
      const resolved = await fs.realpath(root);
      assert.equal(path.dirname(resolved), parent);
      assert(path.basename(resolved).startsWith('zhixing-approval-integration-'));
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    })());
  const abortCleanup = () => {
    void cleanup().catch(() => {});
  };
  t.signal.addEventListener('abort', abortCleanup, { once: true });
  t.after(async () => {
    try {
      await cleanup();
    } finally {
      t.signal.removeEventListener('abort', abortCleanup);
    }
  });
  const config = {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    protocol: 'openai',
    providerId: 'approval-fixture',
    model: 'approval-fixture',
    reasoning: 'off',
    reasoningMap: false,
    manualControls: true,
    permission: 'ask',
    workspaceRoot: workspace,
    kernel: { taskTimeoutSeconds: 30 },
  };
  const identity = { runId: 'native-approval-run', sessionId: 'native-approval-session' };
  const settled = manager
    .run(
      {
        ...identity,
        prompt: 'ROOT_APPROVAL_REQUEST 请保存合成验收文件。',
        privacyMode: 'redact',
      },
      config,
      'synthetic-approval-fixture-key',
    )
    .then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
  const pending = () =>
    Promise.race([
      received.promise,
      settled.then(() => {
        throw new Error('The real kernel ended before asking for approval.');
      }),
    ]);
  const history = async (sessionId = identity.sessionId) => {
    assert.match(sessionId, /^[\w-]{1,150}$/);
    return readBridge(
      path.join(root, 'harness', identity.sessionId, 'history-redact', `${sessionId}.bin`),
      vaults.get(identity.sessionId).historyKey,
    );
  };
  return {
    manager,
    approvals,
    approvalRequests,
    requests,
    failures,
    target,
    identity,
    settled,
    pending,
    history,
  };
}

function answer(snapshot, outcome) {
  const item = snapshot.pending[0];
  return {
    hostEpoch: snapshot.hostEpoch,
    requestId: item.requestId,
    runId: item.runId,
    rootSessionId: item.rootSessionId,
    outcome,
  };
}

for (const outcome of ['allowed-once', 'rejected']) {
  test(
    `真实 Harness 文件审批经本机桥和主机 broker 得到 ${outcome}`,
    { timeout: 45000 },
    async (t) => {
      const f = await fixture(t);
      const pending = await f.pending();
      assert.equal(pending.pending.length, 1);
      const item = pending.pending[0];
      assert.equal(item.sourceSessionId, f.identity.sessionId);
      assert.equal(item.rootSessionId, f.identity.sessionId);
      assert.equal(item.toolName, 'office_write_file');
      assert.equal(item.presentation.path, f.target);
      assert.equal(item.presentation.overwrite, false);
      assert.equal(f.approvalRequests[0].manual, true);
      await assert.rejects(fs.access(f.target), { code: 'ENOENT' });
      assert.deepEqual(f.approvals.answer(answer(pending, outcome)), { accepted: true });
      const finished = await f.settled;
      assert.equal(finished.error, undefined);
      assert.equal(finished.result.finishReason, 'completed');
      assert.equal(f.approvals.snapshot().pending.length, 0);
      assert.equal(f.approvalRequests.length, 1);
      assert.deepEqual(f.failures, []);
      const audit = (await f.history()).events.filter((event) =>
        ['approval/asked', 'approval/decided'].includes(event.type),
      );
      assert.equal(audit.length, 2);
      assert.equal(audit[0].data.toolName, 'office_write_file');
      assert.equal(audit[1].data.id, audit[0].data.id);
      assert.equal(audit[1].data.outcome, outcome);
      if (outcome === 'allowed-once')
        assert.equal(await fs.readFile(f.target, 'utf8'), 'APPROVAL_FILE_CONTENT');
      else await assert.rejects(fs.access(f.target), { code: 'ENOENT' });
      assert.equal(f.approvals.answer(answer(pending, 'allowed-once')).accepted, false);
    },
  );
}

test(
  '真实 Harness 等待文件审批时取消，撤回主机请求且迟到批准不能写文件',
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t);
    const pending = await f.pending();
    await f.manager.cancel(f.identity.runId);
    const finished = await f.settled;
    assert(finished.error);
    assert.equal(finished.error.finalization.executionStatus, 'cancelled');
    assert.equal(finished.error.finalization.processStatus, 'exited');
    assert.equal(f.approvalRequests[0].signal.aborted, true);
    assert.equal(f.approvals.snapshot().pending.length, 0);
    assert.equal(f.approvals.answer(answer(pending, 'allowed-once')).accepted, false);
    await assert.rejects(fs.access(f.target), { code: 'ENOENT' });
    assert.deepEqual(f.failures, []);
  },
);

test(
  '真实子 Agent 保留上游 delegated never 策略，需审批的写入直接拒绝且不弹主机审批',
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t, { child: true });
    const finished = await f.settled;
    assert.equal(finished.error, undefined);
    assert.equal(finished.result.finishReason, 'completed');
    const childRequests = f.requests.filter((request) => {
      const messages = JSON.stringify(request.messages);
      return (
        messages.includes('CHILD_APPROVAL_REQUEST') && !messages.includes('ROOT_APPROVAL_REQUEST')
      );
    });
    assert.equal(
      childRequests.length,
      2,
      'the real child must request and receive its file-tool result',
    );
    const toolResults = childRequests[1].messages.filter((message) => message.role === 'tool');
    assert.equal(toolResults.length, 1);
    assert.match(JSON.stringify(toolResults), /本次文件操作未获批准/);
    const child = finished.result.children.find((child) => child.status === 'completed');
    assert(child);
    const { events } = await f.history(child.id);
    assert(
      events.some(
        (event) =>
          event.type === 'approval/policy' &&
          event.data.policy === 'never' &&
          event.data.source === 'delegation',
      ),
    );
    const audit = events.filter((event) =>
      ['approval/asked', 'approval/decided'].includes(event.type),
    );
    assert.equal(audit.length, 2);
    assert.equal(audit[0].data.toolName, 'office_write_file');
    assert.equal(audit[1].data.id, audit[0].data.id);
    assert.equal(audit[1].data.outcome, 'rejected');
    assert.equal(f.approvalRequests.length, 0);
    assert.equal(f.approvals.snapshot().pending.length, 0);
    await assert.rejects(fs.access(f.target), { code: 'ENOENT' });
    assert.deepEqual(f.failures, []);
  },
);

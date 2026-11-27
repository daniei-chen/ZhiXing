import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const { RuntimeApprovals } = await import(
  packed
    ? pathToFileURL(path.join(packed, 'electron/runtime-approvals.mjs')).href
    : '../electron/runtime-approvals.mjs'
);

function request(signal, changes = {}) {
  return {
    runId: 'run-one',
    rootSessionId: 'root-one',
    sessionId: 'root-one',
    toolName: 'office_write_file',
    callId: 'call-one',
    reason: JSON.stringify({ operation: '写入文件', path: '项目/报告.txt', overwrite: true }),
    signal,
    ...changes,
  };
}

function answer(snapshot, item = snapshot.pending[0], changes = {}) {
  return {
    hostEpoch: snapshot.hostEpoch,
    requestId: item.requestId,
    runId: item.runId,
    rootSessionId: item.rootSessionId,
    outcome: 'allowed-once',
    ...changes,
  };
}

test('approval waits for an explicit one-shot answer and publishes immutable full snapshots', async (t) => {
  const changes = [];
  const approvals = new RuntimeApprovals({ onChange: (state) => changes.push(state) });
  t.after(() => approvals.close());
  const controller = new AbortController();
  let completed = false;
  const pending = approvals.request(request(controller.signal)).then((result) => {
    completed = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  const state = approvals.snapshot();
  assert.equal(state.revision, 1);
  assert.match(state.hostEpoch, /^[0-9a-f-]{36}$/);
  assert.match(state.pending[0].requestId, /^[0-9a-f-]{36}$/);
  assert.equal(state.pending[0].sourceSessionId, 'root-one');
  assert.equal(state.pending[0].presentation.overwrite, true);
  assert.equal(typeof state.pending[0].createdAt, 'number');
  assert.equal(Object.hasOwn(state.pending[0], 'reason'), false);
  state.pending[0].presentation.path = 'unapproved-path';
  changes[0].pending[0].runId = 'unapproved-run';
  assert.equal(approvals.snapshot().pending[0].presentation.path, '项目/报告.txt');
  assert.equal(approvals.snapshot().pending[0].runId, 'run-one');

  assert.deepEqual(approvals.answer(answer(approvals.snapshot())), { accepted: true });
  assert.deepEqual(await pending, { outcome: 'allowed-once' });
  assert.deepEqual(
    changes.map((item) => item.revision),
    [1, 2],
  );
  assert.equal(changes.at(-1).pending.length, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('rejection and duplicate replies cannot turn one decision into a later grant', async (t) => {
  const approvals = new RuntimeApprovals();
  t.after(() => approvals.close());
  const pending = approvals.request(request(new AbortController().signal));
  const reply = answer(approvals.snapshot());
  assert.deepEqual(approvals.answer({ ...reply, outcome: 'rejected' }), { accepted: true });
  assert.deepEqual(await pending, { outcome: 'rejected' });
  assert.deepEqual(approvals.answer(reply), { accepted: false, reason: 'request-ended' });
  assert.equal(approvals.snapshot().revision, 2);
});

test('host epoch, run and root identities are checked without consuming another request', async (t) => {
  const approvals = new RuntimeApprovals();
  const previousHost = new RuntimeApprovals();
  t.after(() => approvals.close());
  t.after(() => previousHost.close());
  const pending = approvals.request(request(new AbortController().signal));
  const state = approvals.snapshot();
  for (const changes of [
    { hostEpoch: previousHost.snapshot().hostEpoch },
    { requestId: 'unknown-request' },
    { runId: 'other-run' },
    { rootSessionId: 'other-root' },
    { outcome: 'allowed-always' },
    { outcome: 'cancelled' },
    { command: 'replacement-command' },
    { sourceSessionId: 'other-child' },
  ]) {
    assert.equal(approvals.answer(answer(state, state.pending[0], changes)).accepted, false);
    assert.deepEqual(approvals.snapshot(), state);
  }
  assert.equal(approvals.answer(answer(state)).accepted, true);
  assert.deepEqual(await pending, { outcome: 'allowed-once' });
});

test('same call id can ask twice and concurrent child sessions never share a grant', async (t) => {
  const approvals = new RuntimeApprovals();
  t.after(() => approvals.close());
  const signal = new AbortController().signal;
  const first = approvals.request(request(signal, { sessionId: 'child-one' }));
  const second = approvals.request(request(signal, { sessionId: 'child-two' }));
  const state = approvals.snapshot();
  assert.notEqual(state.pending[0].requestId, state.pending[1].requestId);
  assert.equal(state.pending[0].callId, state.pending[1].callId);
  assert.equal(
    approvals.answer(answer(state, state.pending[1], { outcome: 'rejected' })).accepted,
    true,
  );
  assert.deepEqual(await second, { outcome: 'rejected' });
  assert.equal(approvals.snapshot().pending[0].sourceSessionId, 'child-one');
  assert.equal(approvals.answer(answer(state, state.pending[0])).accepted, true);
  assert.deepEqual(await first, { outcome: 'allowed-once' });

  const third = approvals.request(request(signal, { sessionId: 'child-one' }));
  assert.notEqual(approvals.snapshot().pending[0].requestId, state.pending[0].requestId);
  assert.equal(approvals.answer(answer(state, state.pending[0])).accepted, false);
  assert.equal(approvals.answer(answer(approvals.snapshot())).accepted, true);
  assert.deepEqual(await third, { outcome: 'allowed-once' });
});

test('native cancellation withdraws exactly its own request and ignores late approval', async (t) => {
  const approvals = new RuntimeApprovals();
  t.after(() => approvals.close());
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = approvals.request(request(firstController.signal));
  const firstReply = answer(approvals.snapshot());
  const second = approvals.request(request(secondController.signal, { sessionId: 'child-two' }));
  firstController.abort();
  assert.deepEqual(await first, { outcome: 'cancelled' });
  assert.equal(approvals.answer(firstReply).accepted, false);
  assert.equal(approvals.snapshot().pending.length, 1);
  assert.equal(approvals.snapshot().pending[0].sourceSessionId, 'child-two');
  assert.equal(approvals.answer(answer(approvals.snapshot())).accepted, true);
  assert.deepEqual(await second, { outcome: 'allowed-once' });
  assert.equal(getEventListeners(firstController.signal, 'abort').length, 0);
  assert.equal(getEventListeners(secondController.signal, 'abort').length, 0);
});

test('abort before publication and during its synchronous observer both fail closed', async () => {
  const controller = new AbortController();
  let approvals;
  let lateReply;
  approvals = new RuntimeApprovals({
    onChange: (state) => {
      if (!state.pending.length) return;
      controller.abort();
      lateReply = approvals.answer(answer(state));
    },
  });
  assert.deepEqual(await approvals.request(request(controller.signal)), { outcome: 'cancelled' });
  assert.equal(lateReply.accepted, false);
  assert.equal(approvals.snapshot().pending.length, 0);
  assert.equal(approvals.snapshot().revision, 2);
  assert.deepEqual(await approvals.request(request(controller.signal)), { outcome: 'cancelled' });
  assert.equal(approvals.snapshot().revision, 2);
  approvals.close();
});

test('a completed approval remains one-shot when cancellation arrives afterward', async () => {
  const approvals = new RuntimeApprovals();
  const controller = new AbortController();
  const pending = approvals.request(request(controller.signal));
  const reply = answer(approvals.snapshot());
  assert.equal(approvals.answer(reply).accepted, true);
  controller.abort();
  assert.deepEqual(await pending, { outcome: 'allowed-once' });
  assert.equal(approvals.snapshot().revision, 2);
  assert.equal(approvals.answer(reply).accepted, false);
  approvals.close();
});

test('close cancels all outstanding promises and cannot admit a later request', async () => {
  const approvals = new RuntimeApprovals();
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = approvals.request(request(firstController.signal));
  const second = approvals.request(request(secondController.signal, { sessionId: 'child-two' }));
  const old = approvals.snapshot();
  approvals.close();
  assert.deepEqual(await Promise.all([first, second]), [
    { outcome: 'cancelled' },
    { outcome: 'cancelled' },
  ]);
  assert.equal(approvals.snapshot().pending.length, 0);
  assert.equal(approvals.snapshot().revision, 4);
  assert.equal(approvals.answer(answer(old)).accepted, false);
  assert.equal(getEventListeners(firstController.signal, 'abort').length, 0);
  assert.equal(getEventListeners(secondController.signal, 'abort').length, 0);
  approvals.close();
  assert.equal(approvals.snapshot().revision, 4);
  assert.deepEqual(await approvals.request(request(new AbortController().signal)), {
    outcome: 'cancelled',
  });
});

test('the previous tool allowlist and JSON path requirement remain fail closed', async () => {
  const approvals = new RuntimeApprovals();
  const signal = new AbortController().signal;
  for (const changes of [
    { toolName: 'bash' },
    { toolName: 'unregistered_tool' },
    { toolName: null },
    { reason: 'not JSON' },
    { reason: 'null' },
    { reason: '[]' },
    { reason: '{}' },
    { reason: '{"path":42}' },
    { reason: '{"path":"ok","command":{}}' },
    { reason: '{"path":"ok","overwrite":"false"}' },
    { reason: '{"path":"ok","hiddenCommand":"unshown"}' },
    { reason: '{"path":"ok","network":{"limit":1e999}}' },
    { signal: undefined },
    { runId: '' },
    { rootSessionId: '' },
    { sessionId: '' },
  ]) {
    assert.deepEqual(await approvals.request(request(signal, changes)), { outcome: 'rejected' });
    assert.equal(approvals.snapshot().pending.length, 0);
    assert.equal(approvals.snapshot().revision, 0);
  }
  const pending = approvals.request(request(signal, { toolName: 'mcp__configured__action' }));
  assert.equal(approvals.snapshot().pending[0].toolName, 'mcp__configured__action');
  approvals.close();
  assert.deepEqual(await pending, { outcome: 'cancelled' });
});

test('commands and network values are displayed completely without truncation or mutable objects', async () => {
  const approvals = new RuntimeApprovals();
  const command = '汉'.repeat(19999) + '末';
  const network = {
    query: '<b>完整内容</b>',
    parameters: ['原始值', { enabled: false }],
    final: '尾部标记',
  };
  const input = request(new AbortController().signal, {
    toolName: 'office_execute',
    reason: JSON.stringify({ operation: '执行命令', path: '项目', command, network }),
  });
  const pending = approvals.request(input);
  input.reason = '{}';
  const state = approvals.snapshot();
  assert.equal(state.pending[0].presentation.command, command);
  assert.equal(state.pending[0].presentation.network, JSON.stringify(network));
  assert.equal(typeof state.pending[0].presentation.network, 'string');
  assert.equal(approvals.answer(answer(state)).accepted, true);
  assert.deepEqual(await pending, { outcome: 'allowed-once' });
  approvals.close();
});

test('oversized command or UTF-8 reason is rejected rather than approved from a partial view', async () => {
  const approvals = new RuntimeApprovals();
  const signal = new AbortController().signal;
  const longReason = JSON.stringify({ path: '项目', network: { value: '汉'.repeat(44000) } });
  assert(longReason.length < 128 * 1024);
  assert(Buffer.byteLength(longReason) > 128 * 1024);
  for (const reason of [JSON.stringify({ path: '项目', command: 'a'.repeat(20001) }), longReason]) {
    assert.deepEqual(await approvals.request(request(signal, { reason })), { outcome: 'rejected' });
    assert.equal(approvals.snapshot().pending.length, 0);
  }
  approvals.close();
});

test('renderer notification failure leaves snapshot recovery and decision settlement intact', async () => {
  const approvals = new RuntimeApprovals({
    onChange: () => {
      throw new Error('renderer unavailable');
    },
  });
  const pending = approvals.request(request(new AbortController().signal));
  assert.equal(approvals.snapshot().pending.length, 1);
  assert.equal(approvals.answer(answer(approvals.snapshot())).accepted, true);
  assert.deepEqual(await pending, { outcome: 'allowed-once' });
  assert.equal(approvals.snapshot().pending.length, 0);
  approvals.close();
});

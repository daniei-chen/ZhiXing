import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeApprovals } from '../src/runtime-approvals.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const request = (id, root = 'chat-a') => ({
  requestId: id,
  runId: `run-${root}`,
  rootSessionId: root,
  sourceSessionId: root,
  toolName: 'office_write_file',
  callId: 'one-tool-call',
  presentation: { operation: '写入项目文件', path: `${id}.txt`, overwrite: false },
  createdAt: 1,
});
const snapshot = (revision, pending = [], hostEpoch = 'host-a') => ({
  hostEpoch,
  revision,
  pending,
});

function host(initial = snapshot(0)) {
  let current = initial;
  const subscribers = new Set();
  const calls = [];
  const order = [];
  const api = {
    onApprovalsChanged(listener) {
      order.push('subscribe');
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    async approvalSnapshot() {
      order.push('snapshot');
      return structuredClone(current);
    },
    async answerApproval(value) {
      calls.push(value);
      return { accepted: false };
    },
  };
  return {
    api,
    subscribers,
    calls,
    order,
    set(value) {
      current = value;
    },
    emit(value) {
      current = value;
      for (const listener of subscribers) listener(structuredClone(value));
    },
  };
}

test('subscribes before querying and a delayed snapshot cannot restore a withdrawn approval', async () => {
  const fixture = host();
  const initial = deferred();
  fixture.api.approvalSnapshot = () => {
    fixture.order.push('snapshot');
    return initial.promise;
  };
  const store = createRuntimeApprovals();
  store.bind(fixture.api);
  assert.deepEqual(fixture.order, ['subscribe', 'snapshot']);
  fixture.emit(snapshot(2));
  initial.resolve(snapshot(1, [request('withdrawn')]));
  await tick();
  assert.equal(store.getSnapshot().revision, 2);
  assert.deepEqual(store.getSnapshot().pending, []);
  assert.equal(store.getSnapshot().connection, 'ready');
});

test('a new host event wins over an initially unseen old epoch returned by an earlier query', async () => {
  const fixture = host();
  const initial = deferred();
  fixture.api.approvalSnapshot = () => initial.promise;
  const store = createRuntimeApprovals();
  store.bind(fixture.api);
  fixture.emit(snapshot(0, [request('new')], 'host-b'));
  initial.resolve(snapshot(90, [request('old')], 'host-a'));
  await tick();
  assert.equal(store.getSnapshot().hostEpoch, 'host-b');
  assert.deepEqual(
    store.getSnapshot().pending.map((item) => item.requestId),
    ['new'],
  );
});

test('failure of an older query cannot disable a newer valid host event', async () => {
  const fixture = host();
  const initial = deferred();
  fixture.api.approvalSnapshot = () => initial.promise;
  const store = createRuntimeApprovals();
  store.bind(fixture.api);
  fixture.emit(snapshot(2, [request('current')]));
  const current = store.getSnapshot();
  initial.reject(new Error('older transport failed'));
  await tick();
  assert.equal(store.getSnapshot(), current);
  assert.equal(store.getSnapshot().connection, 'ready');
});

test('retired epochs and older revisions cannot revive requests; equal snapshots retain identity', async () => {
  const fixture = host(snapshot(1, [request('first')]));
  const store = createRuntimeApprovals();
  store.bind(fixture.api);
  await tick();
  const first = store.getSnapshot();
  fixture.emit(snapshot(1, [request('first')]));
  assert.equal(store.getSnapshot(), first);
  fixture.emit(snapshot(3, [request('new')], 'host-b'));
  const current = store.getSnapshot();
  fixture.emit(snapshot(100, [request('old')], 'host-a'));
  fixture.emit(snapshot(2, [request('older')], 'host-b'));
  assert.equal(store.getSnapshot(), current);
  assert.throws(() => {
    current.pending[0].presentation.path = 'changed';
  }, TypeError);
});

test('binding is idempotent and old callbacks/queries cannot repopulate after remount', async () => {
  const oldHost = host();
  const oldQuery = deferred();
  oldHost.api.approvalSnapshot = () => oldQuery.promise;
  const store = createRuntimeApprovals();
  const off = store.bind(oldHost.api);
  const lateEvent = [...oldHost.subscribers][0];
  assert.equal(store.bind(oldHost.api), off);
  assert.equal(oldHost.subscribers.size, 1);
  off();
  assert.equal(oldHost.subscribers.size, 0);
  const next = host(snapshot(1, [request('current')], 'host-b'));
  store.bind(next.api);
  await tick();
  const current = store.getSnapshot();
  lateEvent(snapshot(2, [request('detached')]));
  oldQuery.resolve(snapshot(3, [request('late-query')]));
  await tick();
  assert.equal(store.getSnapshot(), current);
  assert.equal(next.subscribers.size, 1);
});

test('same-call requests remain distinct and pending never changes optimistically on decision', async () => {
  const fixture = host(snapshot(1, [request('first'), request('second')]));
  const response = deferred();
  fixture.api.answerApproval = (value) => {
    fixture.calls.push(value);
    return response.promise;
  };
  const store = createRuntimeApprovals();
  store.bind(fixture.api);
  await tick();
  const value = {
    hostEpoch: 'host-a',
    requestId: 'first',
    runId: 'run-chat-a',
    rootSessionId: 'chat-a',
    outcome: 'allowed-once',
  };
  const first = store.answer({ ...value, command: 'must not cross the bridge' });
  const duplicate = store.answer(value);
  assert.equal(first, duplicate);
  assert.deepEqual(fixture.calls, [value]);
  assert.deepEqual(
    store.getSnapshot().pending.map((item) => item.requestId),
    ['first', 'second'],
  );
  fixture.emit(snapshot(2, [request('second')]));
  response.resolve({ accepted: true });
  assert.deepEqual(await first, { accepted: true });
  assert.deepEqual(
    store.getSnapshot().pending.map((item) => item.requestId),
    ['second'],
  );
  assert.deepEqual(await store.answer(value), { accepted: false, reason: 'stale' });
  assert.equal(fixture.calls.length, 1);
});

test('a failed decision is reconciled with the host before another user action', async () => {
  const fixture = host(snapshot(1, [request('lost-ack')]));
  fixture.api.answerApproval = async (value) => {
    fixture.calls.push(value);
    fixture.set(snapshot(2));
    throw new Error('synthetic private native failure');
  };
  const store = createRuntimeApprovals();
  store.bind(fixture.api);
  await tick();
  const value = {
    hostEpoch: 'host-a',
    requestId: 'lost-ack',
    runId: 'run-chat-a',
    rootSessionId: 'chat-a',
    outcome: 'rejected',
  };
  await assert.rejects(store.answer(value));
  assert.deepEqual(store.getSnapshot().pending, []);
  assert.equal(store.getSnapshot().revision, 2);
  assert.equal(store.getSnapshot().connection, 'ready');
  assert.deepEqual(await store.answer(value), { accepted: false, reason: 'stale' });
  assert.equal(fixture.calls.length, 1);
});

test('wrong scope, old epoch and persistent-grant outcomes cannot reach the answer IPC', async () => {
  const fixture = host(snapshot(1, [request('pending')]));
  const store = createRuntimeApprovals();
  store.bind(fixture.api);
  await tick();
  const value = {
    hostEpoch: 'host-a',
    requestId: 'pending',
    runId: 'run-chat-a',
    rootSessionId: 'chat-a',
    outcome: 'allowed-once',
  };
  for (const patch of [
    { hostEpoch: 'old' },
    { runId: 'other' },
    { rootSessionId: 'other' },
    { outcome: 'allowed-always' },
  ]) {
    assert.equal((await store.answer({ ...value, ...patch })).accepted, false);
  }
  assert.equal(fixture.calls.length, 0);
});

test('failed or malformed synchronization preserves data but disables decisions without exposing errors', async () => {
  const fixture = host(snapshot(1, [request('pending')]));
  const store = createRuntimeApprovals();
  store.bind(fixture.api);
  await tick();
  fixture.api.approvalSnapshot = async () => {
    throw Error('PRIVATE_PATH_OR_SECRET');
  };
  await assert.rejects(
    store.refresh(),
    (error) => !error.message.includes('PRIVATE_PATH_OR_SECRET'),
  );
  assert.equal(store.getSnapshot().connection, 'error');
  assert.equal(store.getSnapshot().pending[0].requestId, 'pending');
  const value = {
    hostEpoch: 'host-a',
    requestId: 'pending',
    runId: 'run-chat-a',
    rootSessionId: 'chat-a',
    outcome: 'allowed-once',
  };
  assert.equal((await store.answer(value)).accepted, false);
  fixture.emit(snapshot(2, [request('duplicate'), request('duplicate')]));
  assert.equal(store.getSnapshot().connection, 'error');
  assert.equal(store.getSnapshot().revision, 1);
  fixture.emit(snapshot(2, [request('pending')]));
  assert.equal(store.getSnapshot().connection, 'ready');
  assert.equal(fixture.calls.length, 0);
});

test('empty browser API remains unavailable and subscribing never performs a host decision', async () => {
  const store = createRuntimeApprovals();
  const initial = store.getSnapshot();
  store.bind(undefined)();
  const off = store.subscribe(() => {});
  assert.equal(store.getSnapshot(), initial);
  await assert.rejects(store.refresh());
  off();
});

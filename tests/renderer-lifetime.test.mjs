import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const moduleUrl = (relative) =>
  packed
    ? pathToFileURL(path.join(packed, relative)).href
    : new URL(`../${relative}`, import.meta.url).href;
const { RuntimeHandoffs } = await import(moduleUrl('electron/runtime-handoffs.mjs'));
const { RendererLifetime } = await import(moduleUrl('electron/renderer-lifetime.mjs'));

function fixture() {
  const handoffs = new RuntimeHandoffs();
  const errors = [];
  const cancellations = [];
  const manager = {
    runs: new Map(),
    async cancel(runId) {
      cancellations.push(runId);
      return { accepted: true };
    },
  };
  const lifetime = new RendererLifetime({
    manager,
    handoffs,
    onError: (detail) => errors.push(detail),
  });
  function start(runId, { persist = false, sessionId = `session-${runId}` } = {}) {
    const gate = Promise.withResolvers();
    const identity = handoffs.start(
      { runId, sessionId, replyId: `reply-${runId}`, workspaceId: 'office-home', persist },
      () => gate.promise,
    );
    manager.runs.set(runId, { runId, sessionId });
    return { identity, gate };
  }
  const exited = (identity) => ({
    type: 'run/terminal',
    runId: identity.runId,
    sessionId: identity.sessionId,
    label: '交办已取消',
    finalization: {
      executionStatus: 'cancelled',
      processStatus: 'exited',
      persistenceStatus: 'saved',
    },
  });
  const finish = (run, processStatus = 'exited') =>
    run.gate.resolve({
      text: 'PRIVATE_RESULT',
      finalization: { executionStatus: 'cancelled', processStatus, persistenceStatus: 'saved' },
    });
  return { handoffs, errors, cancellations, manager, lifetime, start, exited, finish };
}

test('document generation advances synchronously and only volatile runs are cancelled', async () => {
  const f = fixture();
  const persistent = f.start('persistent', { persist: true });
  const volatile = f.start('volatile');
  assert.equal(f.lifetime.generation, 0);
  const detached = f.lifetime.detach();
  assert.equal(f.lifetime.generation, 1);
  await Promise.resolve();
  assert.deepEqual(f.cancellations, ['volatile']);
  assert.equal(f.handoffs.snapshot().runs.length, 2, 'no result is discarded before settlement');
  f.manager.runs.delete('volatile');
  f.finish(volatile);
  await detached;
  assert.deepEqual(
    f.handoffs.snapshot().runs.map((run) => run.runId),
    ['persistent'],
  );
  f.manager.runs.delete('persistent');
  f.finish(persistent);
  await f.handoffs.wait(persistent.identity);
  assert.deepEqual(f.errors, []);
});

test('confirmed cleanup retires a detached receipt even when its cloned finalization is stale', async () => {
  const f = fixture();
  const run = f.start('quarantined');
  f.finish(run, 'cleanup_pending');
  const oldReceipt = await f.handoffs.wait(run.identity);
  await f.lifetime.detach();
  assert.equal(f.handoffs.snapshot().runs.length, 1, 'quarantine must retain the receipt');
  await f.lifetime.observe({ ...f.exited(run.identity), sessionId: 'wrong-session' });
  assert.equal(f.handoffs.snapshot().runs.length, 1);
  // RuntimeManager emits exited before synchronously releasing the same run.
  const retiring = f.lifetime.observe(f.exited(run.identity));
  assert.equal(f.handoffs.snapshot().runs.length, 1);
  f.manager.runs.delete(run.identity.runId);
  await retiring;
  assert.equal(oldReceipt.outcome.result.finalization.processStatus, 'cleanup_pending');
  assert.equal(f.handoffs.snapshot().runs.length, 0);
  await assert.rejects(f.handoffs.wait(run.identity), /记录已结束/);
  assert.equal(f.lifetime.generation, 1, 'terminal events do not create renderer generations');
  assert.deepEqual(f.errors, []);
});

test('an exited event cannot release a run that the manager still retains', async () => {
  const f = fixture();
  const run = f.start('retained');
  f.finish(run, 'cleanup_pending');
  await f.lifetime.detach();
  await f.lifetime.observe(f.exited(run.identity));
  assert.equal(f.handoffs.snapshot().runs.length, 1);
  f.manager.runs.delete(run.identity.runId);
  await f.lifetime.observe(f.exited(run.identity));
  assert.equal(f.handoffs.snapshot().runs.length, 0);
  assert.deepEqual(f.cancellations, ['retained']);
});

test('repeated detach and terminal events share one cancellation and are idempotent', async () => {
  const f = fixture();
  const run = f.start('duplicate');
  const first = f.lifetime.detach();
  const second = f.lifetime.detach();
  await Promise.resolve();
  assert.deepEqual(f.cancellations, ['duplicate']);
  assert.equal(f.lifetime.generation, 2);
  const event = f.lifetime.observe(f.exited(run.identity));
  f.manager.runs.delete(run.identity.runId);
  f.finish(run);
  await Promise.all([first, second, event]);
  await f.lifetime.observe(f.exited(run.identity));
  await f.lifetime.detach();
  assert.equal(f.lifetime.generation, 3);
  assert.equal(f.handoffs.snapshot().runs.length, 0);
  assert.deepEqual(f.cancellations, ['duplicate']);
  assert.deepEqual(f.errors, []);
});

test('a previous renderer acknowledgement during detachment is handled without a second discard', async () => {
  const f = fixture();
  const run = f.start('acknowledged');
  const cancel = Promise.withResolvers();
  f.manager.cancel = async (runId) => {
    f.cancellations.push(runId);
    await cancel.promise;
  };
  const detached = f.lifetime.detach();
  f.finish(run, 'cleanup_pending');
  const receipt = await f.handoffs.wait(run.identity);
  f.handoffs.acknowledge({ ...run.identity, receiptId: receipt.receiptId }, () => true);
  cancel.resolve();
  await detached;
  assert.equal(f.handoffs.snapshot().runs.length, 0);
  f.manager.runs.delete(run.identity.runId);
  await f.lifetime.observe(f.exited(run.identity));
  await f.lifetime.observe(f.exited(run.identity));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.cancellations, ['acknowledged']);
});

test('failed cancellation retains the result and a later detach retries without leaking the error', async () => {
  const f = fixture();
  const run = f.start('cancel-failure');
  let attempts = 0;
  f.manager.cancel = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('PRIVATE_NATIVE_ERROR');
  };
  f.finish(run);
  f.manager.runs.delete(run.identity.runId);
  await f.lifetime.detach();
  assert.equal(f.handoffs.snapshot().runs.length, 1);
  assert.deepEqual(f.errors, [{ runId: 'cancel-failure', stage: 'cancel' }]);
  await f.lifetime.detach();
  assert.equal(attempts, 2);
  assert.equal(f.handoffs.snapshot().runs.length, 0);
  assert(!JSON.stringify(f.errors).includes('PRIVATE_NATIVE_ERROR'));
});

test('retiring one volatile run preserves a different persistent receipt in the same session', async () => {
  const f = fixture();
  const volatile = f.start('old-volatile', { sessionId: 'shared-chat' });
  const persistent = f.start('new-persistent', { persist: true, sessionId: 'shared-chat' });
  f.finish(volatile);
  f.finish(persistent);
  f.manager.runs.clear();
  await f.lifetime.detach();
  assert.deepEqual(
    f.handoffs.snapshot().runs.map((run) => run.runId),
    ['new-persistent'],
  );
  assert.equal((await f.handoffs.wait(persistent.identity)).outcome.result.text, 'PRIVATE_RESULT');
  assert.deepEqual(f.cancellations, ['old-volatile']);
  assert.deepEqual(f.errors, []);
});

test('discard failure keeps the detached record retryable and diagnostics cannot interrupt retirement', async () => {
  const f = fixture();
  const run = f.start('discard-failure');
  f.finish(run);
  f.manager.runs.delete(run.identity.runId);
  const forget = f.handoffs.forget.bind(f.handoffs);
  let attempts = 0;
  f.handoffs.forget = (identity) => {
    attempts += 1;
    if (attempts === 1) throw new Error('PRIVATE_DISCARD_ERROR');
    return forget(identity);
  };
  f.lifetime.onError = () => {
    throw new Error('PRIVATE_DIAGNOSTIC_ERROR');
  };
  await f.lifetime.detach();
  assert.equal(f.handoffs.snapshot().runs.length, 1);
  await f.lifetime.observe(f.exited(run.identity));
  assert.equal(attempts, 2);
  assert.equal(f.handoffs.snapshot().runs.length, 0);
});

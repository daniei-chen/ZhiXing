import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const { RuntimeHandoffs } = await import(
  packed
    ? pathToFileURL(path.join(packed, 'electron/runtime-handoffs.mjs')).href
    : '../electron/runtime-handoffs.mjs'
);

function binding(changes = {}) {
  return {
    runId: 'handoff-run',
    sessionId: 'handoff-session',
    replyId: 'handoff-reply',
    workspaceId: 'office',
    persist: true,
    ...changes,
  };
}

function result(changes = {}) {
  return {
    text: '完整已核验正文',
    masked: '受保护正文',
    modelInput: 'PRIVATE_VALIDATED_INPUT',
    deliverables: [{ ref: 'SIGNED_DELIVERY_REFERENCE' }],
    changeDiffs: [{ path: 'report.txt', oldText: 'before', newText: 'after' }],
    children: [{ id: 'child-one', messages: [{ role: 'assistant', text: 'CHILD_RESULT' }] }],
    finalization: {
      executionStatus: 'completed',
      persistenceStatus: 'saved',
      processStatus: 'exited',
      eventWatermark: 17,
    },
    ...changes,
  };
}

function acknowledgement(receipt, changes = {}) {
  return {
    hostEpoch: receipt.hostEpoch,
    runId: receipt.runId,
    sessionId: receipt.sessionId,
    receiptId: receipt.receiptId,
    ...changes,
  };
}

test('forget uses exact run ownership, waits for settlement and preserves other receipts in the same session', async () => {
  const handoffs = new RuntimeHandoffs();
  const gate = Promise.withResolvers();
  const first = handoffs.start(binding({ runId: 'discarded-run' }), () => gate.promise);
  const second = handoffs.start(binding({ runId: 'retained-run', replyId: 'other-reply' }), () =>
    result(),
  );
  assert.throws(() => handoffs.forget(first), /仍未结束/);
  gate.resolve(result());
  await Promise.all([handoffs.wait(first), handoffs.wait(second)]);
  for (const invalid of [
    { ...first, hostEpoch: 'other-host' },
    { ...first, sessionId: 'other-session' },
    { ...first, runId: 'unknown-run' },
  ])
    assert.throws(() => handoffs.forget(invalid), /不属于当前会话/);
  const original = handoffs.locate(first);
  assert.deepEqual(handoffs.forget(first), { forgotten: true });
  assert.equal(original.forgotten, true);
  assert.equal(original.outcome, undefined);
  assert.equal(original.progressText, '');
  assert.deepEqual(original.trace, []);
  assert.deepEqual(
    handoffs.snapshot().runs.map((run) => run.runId),
    ['retained-run'],
  );
  assert.deepEqual((await handoffs.wait(second)).outcome.result, result());
  await assert.rejects(handoffs.wait(first), /记录已结束/);
  assert.throws(
    () => handoffs.start(binding({ runId: 'discarded-run' }), () => result()),
    /已经启动/,
  );
});

test('detached callers reconnect to one registered execution and independent complete receipts', async () => {
  const handoffs = new RuntimeHandoffs();
  const gate = Promise.withResolvers();
  let executed = 0;
  const identity = handoffs.start(binding(), async () => {
    executed += 1;
    assert.equal(handoffs.snapshot().runs[0].status, 'running');
    handoffs.observe({ ...binding(), type: 'draft', text: '已保护的实时片段' });
    return gate.promise;
  });
  assert.equal(executed, 0, 'registration must precede operation scheduling');
  const otherObserver = handoffs.wait(identity);
  await Promise.resolve();
  const reconnect = handoffs.snapshot().runs[0];
  assert.equal(reconnect.progressText, '已保护的实时片段');
  const recoveredObserver = handoffs.wait(reconnect);
  const complete = result();
  gate.resolve(complete);
  const [first, second] = await Promise.all([otherObserver, recoveredObserver]);
  assert.equal(executed, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first.outcome.result, complete);
  assert.match(first.receiptId, /^[a-f0-9-]{36}$/);
  assert.equal(handoffs.snapshot().runs[0].status, 'settled');
  const publicState = JSON.stringify(handoffs.snapshot());
  assert(!publicState.includes('PRIVATE_VALIDATED_INPUT'));
  assert(!publicState.includes('SIGNED_DELIVERY_REFERENCE'));
  first.outcome.result.text = 'observer mutation';
  complete.text = 'producer mutation';
  assert.equal((await handoffs.wait(identity)).outcome.result.text, '完整已核验正文');
  assert.equal(second.outcome.result.text, '完整已核验正文');
});

test('execution failure retains the complete validated result and separate finalization', async () => {
  const handoffs = new RuntimeHandoffs({ sanitizeError: () => '保存尚未完成，请重试保存。' });
  const complete = result();
  const finalization = { ...complete.finalization, persistenceStatus: 'pending' };
  const failure = Object.assign(new Error('PRIVATE_NATIVE_ERROR'), {
    code: 'RUNTIME_PERSIST_FAILED',
    stage: 'persist',
    result: complete,
    finalization,
  });
  const identity = handoffs.start(binding(), () => {
    throw failure;
  });
  const receipt = await handoffs.wait(identity);
  assert.equal(receipt.outcome.status, 'failed');
  assert.deepEqual(receipt.outcome.result, complete);
  assert.deepEqual(receipt.outcome.finalization, finalization);
  assert.deepEqual(receipt.outcome.error, {
    code: 'RUNTIME_PERSIST_FAILED',
    stage: 'persist',
    message: '保存尚未完成，请重试保存。',
  });
  assert(!JSON.stringify(receipt).includes('PRIVATE_NATIVE_ERROR'));
  assert(!JSON.stringify(handoffs.snapshot()).includes('PRIVATE_VALIDATED_INPUT'));
});

test('error sanitization failure or invalid return cannot strand a private receipt', async () => {
  for (const sanitizeError of [
    () => {
      throw new Error('SANITIZER_PRIVATE_FAILURE');
    },
    () => ({ private: 'not-user-copy' }),
    () => '',
  ]) {
    const handoffs = new RuntimeHandoffs({ sanitizeError });
    const complete = result();
    const identity = handoffs.start(binding(), () => {
      throw Object.assign(new Error('UNSAFE_ERROR'), {
        result: complete,
        finalization: { executionStatus: 'cancelled', processStatus: 'exited' },
        code: 'not a safe code',
        stage: 'unsafe stage',
      });
    });
    const receipt = await handoffs.wait(identity);
    assert.equal(handoffs.snapshot().runs[0].status, 'settled');
    assert.equal(receipt.outcome.status, 'cancelled');
    assert.equal(receipt.outcome.error.message, '本轮未完成，请检查执行记录。');
    assert.equal(receipt.outcome.error.code, 'RUNTIME_EXECUTION_FAILED');
    assert.equal(receipt.outcome.error.stage, 'query');
    assert.deepEqual(receipt.outcome.result, complete);
  }
});

test('uncloneable output becomes a settled failure without an unhandled private promise', async () => {
  const handoffs = new RuntimeHandoffs();
  const identity = handoffs.start(binding(), () => ({ text: 'invalid', callable() {} }));
  const receipt = await handoffs.wait(identity);
  assert.equal(receipt.outcome.status, 'failed');
  assert.equal(receipt.outcome.result, undefined);
  assert.equal(handoffs.snapshot().runs[0].status, 'settled');
});

test('pre-begin cancellation stays cancelled without inventing a process finalization', async () => {
  const handoffs = new RuntimeHandoffs({ sanitizeError: () => '任务已停止。' });
  const identity = handoffs.start(binding(), () => {
    throw Object.assign(new Error('任务已停止。'), { code: 'RUNTIME_CANCELLED', stage: 'prepare' });
  });
  const receipt = await handoffs.wait(identity);
  assert.equal(receipt.outcome.status, 'cancelled');
  assert.equal(receipt.outcome.error.code, 'RUNTIME_CANCELLED');
  assert.equal(receipt.outcome.finalization, undefined);
  assert.equal(receipt.outcome.result, undefined);
});

test('only exact receipt identity and synchronous positive host save proof release a result', async () => {
  const handoffs = new RuntimeHandoffs();
  const identity = handoffs.start(binding(), () => result());
  const receipt = await handoffs.wait(identity);
  for (const wrong of [
    { hostEpoch: new RuntimeHandoffs().hostEpoch },
    { runId: 'other-run' },
    { sessionId: 'other-session' },
    { receiptId: 'other-receipt' },
  ]) {
    assert.throws(() => handoffs.acknowledge(acknowledgement(receipt, wrong), () => true));
    assert.equal(handoffs.snapshot().runs.length, 1);
  }
  for (const proof of [() => false, () => undefined, () => 'true', async () => true]) {
    assert.throws(() => handoffs.acknowledge(acknowledgement(receipt), proof), /尚未确认保存/);
    assert.equal(handoffs.snapshot().runs.length, 1);
  }
  assert.throws(() =>
    handoffs.acknowledge(acknowledgement(receipt), () => {
      throw new Error('save failed');
    }),
  );
  assert.equal(handoffs.snapshot().runs.length, 1);
  let proofs = 0;
  assert.deepEqual(
    handoffs.acknowledge(acknowledgement(receipt), (entry) => {
      proofs += 1;
      return entry.receiptId === receipt.receiptId && entry.binding.replyId === receipt.replyId;
    }),
    { acknowledged: true },
  );
  assert.equal(handoffs.snapshot().runs.length, 0);
  assert.deepEqual(
    handoffs.acknowledge(acknowledgement(receipt), () => {
      throw new Error('an idempotent ACK must not repeat the save proof');
    }),
    { acknowledged: true },
  );
  assert.equal(proofs, 1);
  await assert.rejects(handoffs.wait(identity), /已结束|不属于/);
});

test('pending operations cannot be acknowledged and duplicate begin never reruns work', async () => {
  const handoffs = new RuntimeHandoffs();
  const gate = Promise.withResolvers();
  let executions = 0;
  const execute = () => {
    executions += 1;
    return gate.promise;
  };
  const identity = handoffs.start(binding(), execute);
  assert.throws(() => handoffs.start(binding(), execute), /已经启动|原任务/);
  assert.throws(() => handoffs.acknowledge({ ...identity, receiptId: 'forged' }, () => true));
  gate.resolve(result());
  const receipt = await handoffs.wait(identity);
  handoffs.acknowledge(acknowledgement(receipt), () => true);
  assert.throws(() => handoffs.start(binding(), execute), /已经启动|原任务/);
  assert.equal(executions, 1);
});

test('acknowledgement-cache eviction does not permit a host-lifetime run ID to execute again', async () => {
  const handoffs = new RuntimeHandoffs();
  let executions = 0;
  for (let index = 0; index < 130; index += 1) {
    const identity = handoffs.start(binding({ runId: `run-${index}` }), () => {
      executions += 1;
      return result();
    });
    const receipt = await handoffs.wait(identity);
    handoffs.acknowledge(acknowledgement(receipt), () => true);
  }
  assert.throws(() =>
    handoffs.start(binding({ runId: 'run-0' }), () => {
      executions += 1;
    }),
  );
  assert.equal(executions, 130);
});

test('sixteen unacknowledged results apply backpressure without evicting or admitting work', async () => {
  const handoffs = new RuntimeHandoffs();
  const receipts = [];
  for (let index = 0; index < 16; index += 1) {
    const identity = handoffs.start(binding({ runId: `retained-${index}` }), () => result());
    receipts.push(await handoffs.wait(identity));
  }
  let overflowExecuted = false;
  const overflow = binding({ runId: 'overflow' });
  assert.throws(
    () =>
      handoffs.start(overflow, () => {
        overflowExecuted = true;
      }),
    /尚未保存/,
  );
  assert.equal(handoffs.snapshot().runs.length, 16);
  assert.equal(overflowExecuted, false);
  assert.deepEqual((await handoffs.wait(receipts[0])).outcome.result, result());
  handoffs.acknowledge(acknowledgement(receipts[0]), () => true);
  const next = handoffs.start(overflow, () => {
    overflowExecuted = true;
    return result();
  });
  await handoffs.wait(next);
  assert.equal(overflowExecuted, true);
  assert.equal(handoffs.snapshot().runs.length, 16);
});

test('snapshots retain only bounded public summaries for the correct root session', async () => {
  const handoffs = new RuntimeHandoffs();
  const gate = Promise.withResolvers();
  const identity = handoffs.start(binding({ secret: 'PRIVATE_BINDING_FIELD' }), () => gate.promise);
  assert.equal(identity.secret, undefined);
  handoffs.observe({
    ...binding(),
    sessionId: 'foreign-session',
    type: 'draft',
    text: 'FOREIGN_TEXT',
  });
  handoffs.observe({ ...binding(), type: 'draft', text: 'x'.repeat(300 * 1024) });
  for (let index = 0; index < 405; index += 1) {
    handoffs.observe({
      ...binding(),
      type: 'tool/call',
      category: 'tools',
      status: 'running',
      label: '调用 · 写入项目文本',
      callId: `event-${index}`,
      sequence: index,
      time: 1000 + index,
      childSessionId: 'safe-child',
      arguments: 'PRIVATE_ARGS',
      result: result(),
      error: 'PRIVATE_ERROR',
      plan: [{ content: 'PRIVATE_PLAN', status: 'pending' }],
      children: [{ id: 'safe-child', messages: [{ text: 'PRIVATE_CHILD_TEXT' }] }],
    });
  }
  handoffs.observe({
    ...binding(),
    sessionId: 'foreign-session',
    type: 'tool/call',
    label: 'FOREIGN_LABEL',
  });
  const snapshot = handoffs.snapshot();
  const run = snapshot.runs[0];
  assert.equal(run.progressText.length, 256 * 1024);
  assert.equal(run.progressTruncated, true);
  assert.equal(run.trace.length, 400);
  assert.equal(run.trace[0].sequence, 5);
  assert.equal(run.traceTruncated, true);
  assert.equal(run.trace.at(-1).callId, 'event-404');
  assert.equal(run.trace.at(-1).childSessionId, 'safe-child');
  for (const denied of ['PRIVATE_', 'FOREIGN_']) assert(!JSON.stringify(snapshot).includes(denied));
  run.trace[0].label = 'observer mutation';
  assert.equal(handoffs.snapshot().runs[0].trace[0].label, '调用 · 写入项目文本');
  const longFinal = '最终'.repeat(200 * 1024);
  gate.resolve(result({ text: longFinal }));
  const receipt = await handoffs.wait(identity);
  assert.equal(receipt.outcome.result.text, longFinal);
  assert.equal(receipt.progressTruncated, true);
  handoffs.observe({ ...binding(), type: 'draft', text: 'late event' });
  assert.equal(handoffs.snapshot().runs[0].progressText.length, 256 * 1024);
});

test('deleting a settled session revokes pending reads and leaves other and running sessions intact', async () => {
  const handoffs = new RuntimeHandoffs();
  const first = handoffs.start(binding({ runId: 'settled-delete' }), () => result());
  await handoffs.wait(first);
  const gate = Promise.withResolvers();
  const running = handoffs.start(binding({ runId: 'still-running' }), () => gate.promise);
  const other = handoffs.start(binding({ runId: 'other-run', sessionId: 'other-session' }), () =>
    result(),
  );
  await handoffs.wait(other);
  const delayedRead = handoffs.wait(first);
  handoffs.forgetSession(first.sessionId);
  await assert.rejects(delayedRead, /已结束|不属于/);
  await assert.rejects(handoffs.wait(first), /已结束|不属于/);
  assert.deepEqual(
    handoffs.snapshot().runs.map((entry) => entry.runId),
    ['still-running', 'other-run'],
  );
  gate.resolve(result());
  await handoffs.wait(running);
  handoffs.forgetSession(running.sessionId);
  assert.deepEqual(
    handoffs.snapshot().runs.map((entry) => entry.runId),
    ['other-run'],
  );
  assert.throws(() => handoffs.start(binding({ runId: 'settled-delete' }), () => result()));
});

test('invalid ownership or non-callable operations never enter the delivery table', () => {
  const handoffs = new RuntimeHandoffs();
  for (const field of ['runId', 'sessionId', 'replyId', 'workspaceId']) {
    assert.throws(() => handoffs.start(binding({ [field]: '../unsafe' }), () => result()));
  }
  assert.throws(() => handoffs.start(binding(), undefined));
  assert.equal(handoffs.snapshot().runs.length, 0);
});

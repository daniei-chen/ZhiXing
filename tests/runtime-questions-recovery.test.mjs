import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
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
const { PrivacySession } = await load('src/privacy-core.js');
const { createBridgeKey, writeBridge } = await load('harness/privacy-bridge.mjs');

async function fixture(t, { onQuestion } = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-questions-recovery-'));
  const events = [];
  const observers = new Map();
  const jobs = [];
  const controllers = [];
  let manager;
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(jobs);
    await manager?.close();
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert(path.basename(resolved).startsWith('zhixing-questions-recovery-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  });
  manager = new RuntimeManager({
    root,
    readVault: async () => undefined,
    writeVault: async () => {},
    onEvent(event) {
      events.push(structuredClone(event));
      if (event.type === 'question') {
        observers.get(event.requestId)?.resolve(manager.questionSnapshot());
        onQuestion?.(event);
      }
    },
  });

  async function scope(name, phone, { child = false } = {}) {
    const vault = new PrivacySession(`questions-${name}`);
    const protectedPhone = vault.protect(phone).text;
    assert.notEqual(protectedPhone, phone);
    const bridgeKey = createBridgeKey();
    const bridgeFile = path.join(root, `${name}.bin`);
    await writeBridge(bridgeFile, bridgeKey, vault.exportState());
    assert.equal((await fs.readFile(bridgeFile)).includes(Buffer.from(phone)), false);
    const providerKey = `questions-fixture-key-${name}`;
    const context = {
      bridgeFile,
      bridgeKey,
      providerKey,
      runId: `run-${name}`,
      rootSessionId: `root-${name}`,
      allowQuestions: true,
    };
    const request = {
      requestId: `request-${name}`,
      sessionId: child ? `child-${name}` : context.rootSessionId,
      questions: [
        {
          id: 'plan-choice',
          header: 'Plan review',
          question: 'Approve this plan and leave plan mode?',
          detail: `本机联系人电话：${protectedPhone}`,
          options: [
            { label: 'Approve', description: providerKey },
            {
              label: 'Keep planning',
              description: 'Stay in plan mode; feedback goes back to the model.',
            },
          ],
        },
      ],
    };
    return { request, context, phone, providerKey };
  }

  function ask(item, changes = {}) {
    const controller = new AbortController();
    controllers.push(controller);
    const observed = Promise.withResolvers();
    observers.set(item.request.requestId, observed);
    const pending = manager.askQuestion(item.request, controller.signal, {
      ...item.context,
      ...changes,
    });
    jobs.push(pending);
    return { controller, pending, published: observed.promise };
  }
  return { manager, events, scope, ask, root };
}

function answer(item, selected = '批准并执行', changes = {}) {
  return {
    requestId: item.requestId,
    runId: item.runId,
    rootSessionId: item.rootSessionId,
    answers: [{ id: 'plan-choice', selected: [selected], custom: '请补充执行顺序。' }],
    ...changes,
  };
}

test('two root questions recover independent safe snapshots and scoped answers map back to native choices', async (t) => {
  const f = await fixture(t);
  const first = await f.scope('one', '13800000000', { child: true });
  const second = await f.scope('two', '13900000000');
  const a = f.ask(first);
  const b = f.ask(second);
  await Promise.all([a.published, b.published]);
  const snapshot = f.manager.questionSnapshot();
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.pending.length, 2);
  const qa = snapshot.pending.find((item) => item.runId === first.context.runId);
  const qb = snapshot.pending.find((item) => item.runId === second.context.runId);
  assert.equal(qa.sessionId, first.request.sessionId);
  assert.equal(qa.rootSessionId, first.context.rootSessionId);
  assert.notEqual(qa.sessionId, qa.rootSessionId);
  assert.equal(qb.sessionId, qb.rootSessionId);
  assert.equal(qa.questions[0].header, '方案审批');
  assert.equal(qa.questions[0].question, '是否批准此方案并开始执行？');
  assert(qa.questions[0].detail.includes(first.phone));
  assert(!qa.questions[0].detail.includes(second.phone));
  assert(qb.questions[0].detail.includes(second.phone));
  assert(!JSON.stringify(snapshot).includes(first.providerKey));
  assert(!JSON.stringify(snapshot).includes(second.providerKey));
  assert.equal(qa.questions[0].options[0].description, '【检测到凭证，已隐藏此段】');

  const intact = structuredClone(snapshot);
  qa.questions[0].detail = 'observer-mutation';
  qa.questions[0].options[0].label = 'observer-mutation';
  snapshot.pending.pop();
  assert.deepEqual(f.manager.questionSnapshot(), intact);

  const owned = intact.pending.find((item) => item.runId === first.context.runId);
  for (const wrong of [{ runId: qb.runId }, { rootSessionId: qb.rootSessionId }]) {
    assert.throws(() => f.manager.answerQuestion(answer(owned, '批准并执行', wrong)), /不属于/);
    assert.deepEqual(f.manager.questionSnapshot(), intact);
  }
  assert.equal(f.manager.answerQuestion(answer(owned)), true);
  assert.deepEqual(await a.pending, {
    answers: [{ id: 'plan-choice', selected: ['Approve'], custom: '请补充执行顺序。' }],
  });
  assert.equal(f.manager.questionSnapshot().revision, 3);
  assert.equal(f.manager.questionSnapshot().pending[0].requestId, qb.requestId);
  assert.throws(() => f.manager.answerQuestion(answer(owned)), /已结束/);

  // The original caller contract remains supported while new recovery callers
  // send the explicit root/run binding checked above.
  assert.equal(
    f.manager.answerQuestion({
      requestId: qb.requestId,
      answers: [{ id: 'plan-choice', selected: ['继续完善方案'] }],
    }),
    true,
  );
  assert.deepEqual(await b.pending, {
    answers: [{ id: 'plan-choice', selected: ['Keep planning'] }],
  });
  assert.deepEqual(f.manager.questionSnapshot(), { revision: 4, pending: [] });
});

test('native abort withdraws only its own root and stale recovery replies cannot consume another question', async (t) => {
  const f = await fixture(t);
  const a = f.ask(await f.scope('one', '13800000000'));
  const b = f.ask(await f.scope('two', '13900000000'));
  await Promise.all([a.published, b.published]);
  const before = f.manager.questionSnapshot();
  const qa = before.pending.find((item) => item.runId === 'run-one');
  const qb = before.pending.find((item) => item.runId === 'run-two');
  a.controller.abort();
  assert.deepEqual(await a.pending, { cancelled: true });
  assert.equal(getEventListeners(a.controller.signal, 'abort').length, 0);
  assert.deepEqual(f.manager.questionSnapshot(), { revision: 3, pending: [qb] });
  assert.throws(() => f.manager.answerQuestion(answer(qa)), /已结束/);
  assert.deepEqual(f.manager.questionSnapshot(), { revision: 3, pending: [qb] });
  assert.equal(before.revision, 2);
  assert.equal(before.pending.length, 2);
  f.manager.answerQuestion(answer(qb, '继续完善方案', { cancelled: true }));
  assert.deepEqual(await b.pending, { cancelled: true });
  assert.equal(getEventListeners(b.controller.signal, 'abort').length, 0);
  assert.deepEqual(f.manager.questionSnapshot(), { revision: 4, pending: [] });
  const closed = f.events.filter((event) => event.type === 'question-closed');
  assert.deepEqual(
    new Set(closed.map((event) => event.requestId)),
    new Set([qa.requestId, qb.requestId]),
  );
  assert.equal(closed.length, 2);
});

test('abort during question publication advances revision and invalidates the already observed older snapshot', async (t) => {
  let controller;
  const f = await fixture(t, { onQuestion: () => controller.abort() });
  const pending = f.ask(await f.scope('publication', '13800000000'));
  controller = pending.controller;
  const observed = await pending.published;
  assert.deepEqual(await pending.pending, { cancelled: true });
  assert.equal(observed.revision, 1);
  assert.equal(observed.pending.length, 1);
  assert.deepEqual(f.manager.questionSnapshot(), { revision: 2, pending: [] });
  assert.throws(() => f.manager.answerQuestion(answer(observed.pending[0])), /已结束/);
  assert.equal(f.events.filter((event) => event.type === 'question-closed').length, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('disabled and already aborted question paths publish nothing and do not read a missing bridge', async (t) => {
  const f = await fixture(t);
  const item = await f.scope('disabled', '13800000000');
  const missingBridge = path.join(f.root, 'not-created.bin');
  assert.deepEqual(
    await f.manager.askQuestion(item.request, new AbortController().signal, {
      ...item.context,
      allowQuestions: false,
      bridgeFile: missingBridge,
    }),
    { cancelled: true },
  );
  assert.deepEqual(
    await f.manager.askQuestion(item.request, AbortSignal.abort(), {
      ...item.context,
      bridgeFile: missingBridge,
    }),
    { cancelled: true },
  );
  assert.deepEqual(f.manager.questionSnapshot(), { revision: 0, pending: [] });
  assert.deepEqual(f.events, []);
});

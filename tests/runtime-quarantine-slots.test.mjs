import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const app = process.env.ZHIXING_TEST_PACKED_APP;
const load = (name) =>
  import(
    app ? pathToFileURL(path.join(app, name)).href : new URL(`../${name}`, import.meta.url).href
  );
const { RuntimeManager } = await load('electron/runtime.mjs');
const { writeBridge } = await load('harness/privacy-bridge.mjs');
const key = 'synthetic-quarantine-key';
const config = { baseUrl: 'https://synthetic.invalid', model: 'synthetic', reasoning: 'off' };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, ms = 6000) {
  const limit = Date.now() + ms;
  while (Date.now() < limit) {
    if (await predicate()) return;
    await pause(10);
  }
  throw new Error('Synthetic lifecycle condition did not settle');
}

// `stuck` keeps the kernel exit unconfirmed through every retry, `busy` never
// finishes its query at all, `ok` closes cleanly. A session behaves like its
// first harness: later harnesses for the same session are healthy, which is how
// a test proves the app released the session instead of merely reporting it.
async function fixture({ modes = {}, cleanupRetryDelays = [20, 20] } = {}) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), 'zhixing-quarantine-slots-'),
  );
  const vaults = new Map(),
    events = [],
    consumed = new Set();
  const manager = new RuntimeManager({
    root,
    cleanupTimeoutMs: 60,
    cleanupRetryDelays,
    readVault: async (id) => vaults.get(id),
    writeVault: async (id, value) => vaults.set(id, structuredClone(value)),
    onEvent: (event) => events.push(event),
    createGateway: async () => ({
      baseUrl: 'http://127.0.0.1:1',
      apiKey: key,
      close: async () => {},
    }),
    createHarness: async (directory, options) => {
      const sessionId = path.basename(directory),
        mode = consumed.has(sessionId) ? 'ok' : modes[sessionId] || 'ok';
      if (mode !== 'ok') consumed.add(sessionId);
      return {
        client: {
          request: async () => ({}),
          subscribeSessionTree() {
            let resolve;
            const stopped = new Promise((yes) => {
              resolve = yes;
            });
            return {
              tryNext: () => undefined,
              close: resolve,
              async *[Symbol.asyncIterator]() {
                await stopped;
                yield* [];
              },
            };
          },
        },
        async start() {
          await writeBridge(path.join(directory, 'context.bin'), options.bridgeKey, {
            [path.basename(directory)]: { tools: [], skills: [] },
            'kernel-check': { tools: [], skills: [] },
          });
        },
        async close() {
          if (mode === 'stuck') throw new Error('Synthetic exit not confirmed');
        },
        async retryClose() {
          if (mode === 'stuck') throw new Error('Synthetic exit still not confirmed');
        },
        session: () => ({
          run: async () => {
            if (mode === 'busy') await new Promise(() => {});
            return { finishReason: 'completed', finalResponse: 'Synthetic answer' };
          },
        }),
      };
    },
  });
  return {
    root,
    manager,
    events,
    terminal: (runId) =>
      events.filter((event) => event.type === 'run/terminal' && event.runId === runId).at(-1),
    async dispose() {
      await Promise.race([manager.close(), pause(400)]);
      await fs.rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 });
    },
  };
}
const start = (f, runId, sessionId) =>
  f.manager.run(
    { runId, sessionId, prompt: 'Synthetic prompt', privacyMode: 'redact' },
    config,
    key,
  );

test(
  'R03 三个隔离 run 不占执行名额：新聊天仍能发起一轮，内核自检也能跑',
  { timeout: 20000 },
  async () => {
    const f = await fixture({
      modes: { 'stuck-a': 'stuck', 'stuck-b': 'stuck', 'stuck-c': 'stuck' },
    });
    try {
      for (const id of ['a', 'b', 'c'])
        await assert.rejects(
          start(f, `run-stuck-${id}`, `stuck-${id}`),
          (error) => error.finalization?.processStatus === 'cleanup_pending',
        );
      const quarantined = f.manager.getCleanupStatus();
      assert.equal(quarantined.length, 3);
      assert.equal(
        quarantined.every((item) => item.canAbandon === false),
        true,
        'the retry budget is not burned yet',
      );
      assert.equal(f.manager.activeRuns().length, 0);
      // Nothing is executing: a brand-new chat must get a slot even though three
      // kernels are still quarantined.
      const fresh = await start(f, 'run-fresh', 'fresh-chat');
      assert.equal(fresh.text, 'Synthetic answer');
      assert.equal(f.manager.runs.has('run-fresh'), false);
      // The kernel self-check shares the same bookkeeping, so it must pass too.
      const report = await f.manager.check(config, key);
      assert.deepEqual(report.skills, []);
      assert.equal(
        f.manager.getCleanupStatus().length,
        3,
        'the check never releases a quarantined run',
      );
      assert.equal(f.manager.runs.size, 3);
    } finally {
      await f.dispose();
    }
  },
);

test(
  'R03 重试预算耗尽后可放弃并释放：busy 与名额同时释放，终态标记未交接',
  { timeout: 20000 },
  async () => {
    const f = await fixture({ modes: { 'stuck-a': 'stuck' }, cleanupRetryDelays: [20, 20] });
    try {
      await assert.rejects(start(f, 'run-stuck-a', 'stuck-a'));
      assert.equal(f.manager.getCleanupStatus()[0].canAbandon, false);
      await assert.rejects(
        f.manager.abandonRun('run-stuck-a'),
        /重试清理还不满 2 次/,
        'nothing is released before the retry budget is burned',
      );
      assert.equal(f.manager.busy.has('stuck-a'), true);
      assert(f.manager.runs.has('run-stuck-a'));
      await until(() => f.manager.getCleanupStatus()[0]?.canAbandon === true);
      const abandoned = await f.manager.abandonRun('run-stuck-a');
      assert.equal(abandoned.status, 'abandoned');
      assert.equal(f.manager.runs.has('run-stuck-a'), false);
      assert.equal(f.manager.busy.has('stuck-a'), false);
      assert.equal(f.manager.getCleanupStatus().length, 0);
      assert.equal(f.manager.runs.size, 0);
      const terminal = f.terminal('run-stuck-a');
      assert.equal(terminal.finalization.executionStatus, 'abandoned');
      assert.equal(terminal.finalization.processStatus, 'abandoned');
      assert.equal(
        terminal.finalization.abandoned.resultDelivered,
        false,
        'an unhanded result is never recorded as delivered',
      );
      assert.equal(terminal.finalization.abandoned.attempts, 2);
      assert.equal(terminal.finalization.abandoned.previousExecutionStatus, 'completed');
      // The recorded settlement also stops claiming the round is still running.
      assert.equal((await f.manager.waitForRun('run-stuck-a')).status, 'failed');
      // Releasing the session is real: the next round there is accepted and starts.
      const recovered = await start(f, 'run-after-abandon', 'stuck-a');
      assert.equal(recovered.text, 'Synthetic answer');
    } finally {
      await f.dispose();
    }
  },
);

test(
  'R03 名额满的文案区分真在跑与等清理，隔离会话的文案指向放弃并释放',
  { timeout: 20000 },
  async () => {
    const busy = await fixture({ modes: { 'busy-a': 'busy', 'busy-b': 'busy', 'busy-c': 'busy' } });
    try {
      for (const id of ['a', 'b', 'c']) {
        void start(busy, `run-busy-${id}`, `busy-${id}`).catch(() => {});
        await until(() => busy.manager.runs.has(`run-busy-${id}`));
      }
      const full = await start(busy, 'run-fourth', 'fresh-chat').then(
        () => null,
        (error) => error,
      );
      assert.match(full.message, /已有 3 个任务正在执行（上限 3 个）/);
      assert.equal(full.message.includes('内核退出还没确认'), false, 'nothing is quarantined here');
      assert.equal(
        full.message.includes('已有三个任务在运行'),
        false,
        'the old blanket copy is gone',
      );
    } finally {
      await busy.dispose();
    }

    const mixed = await fixture({
      modes: {
        'busy-a': 'busy',
        'busy-b': 'busy',
        'busy-c': 'busy',
        'stuck-a': 'stuck',
        'stuck-b': 'stuck',
      },
      cleanupRetryDelays: [],
    });
    try {
      for (const id of ['a', 'b'])
        await assert.rejects(start(mixed, `run-stuck-${id}`, `stuck-${id}`));
      assert.equal(mixed.manager.getCleanupStatus().length, 2);
      for (const id of ['a', 'b', 'c']) {
        void start(mixed, `run-busy-${id}`, `busy-${id}`).catch(() => {});
        await until(() => mixed.manager.runs.has(`run-busy-${id}`));
      }
      const full = await start(mixed, 'run-fourth', 'fresh-chat').then(
        () => null,
        (error) => error,
      );
      assert.match(full.message, /另有 2 轮的内核退出还没确认/);
      assert.match(full.message, /它们不占这个上限/);
    } finally {
      await mixed.dispose();
    }

    // The quarantined session itself stays the one blocked owner: that copy must
    // name the escape instead of claiming anything is still executing.
    const single = await fixture({ modes: { 'stuck-a': 'stuck' }, cleanupRetryDelays: [] });
    try {
      await assert.rejects(start(single, 'run-stuck-a', 'stuck-a'));
      assert.equal(
        single.manager.getCleanupStatus()[0].canAbandon,
        true,
        'an empty retry schedule burns its budget at once',
      );
      const session = await start(single, 'run-second', 'stuck-a').then(
        () => null,
        (error) => error,
      );
      assert.match(session.message, /放弃并释放/);
      assert.match(session.message, /连续 0 次重试后仍未确认退出/);
      assert.equal(session.message.includes('该会话正在执行'), false);
    } finally {
      await single.dispose();
    }
  },
);

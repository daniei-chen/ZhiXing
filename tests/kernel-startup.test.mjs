import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeHarness } from '../electron/runtime.mjs';
import {
  KERNEL_START_BUDGET_MS,
  KERNEL_START_BUDGET_ENV,
  kernelStartBudgetError,
  kernelStartBudgetMs,
  startKernel,
} from '../electron/kernel-startup.mjs';

const record = () => {
  const rows = [];
  return { rows, log: (level, event, detail) => rows.push({ level, event, detail }) };
};

test('启动预算默认取实测标定值，非法环境变量退回默认值', () => {
  assert.equal(KERNEL_START_BUDGET_MS, 40000);
  assert.equal(kernelStartBudgetMs({}), KERNEL_START_BUDGET_MS);
  assert.equal(kernelStartBudgetMs({ [KERNEL_START_BUDGET_ENV]: '90000' }), 90000);
  assert.equal(kernelStartBudgetMs({ [KERNEL_START_BUDGET_ENV]: ' 125000 ' }), 125000);
  for (const invalid of ['', '   ', '4000', '300001', '60s', 'Infinity', '-1', '1e6']) {
    assert.equal(
      kernelStartBudgetMs({ [KERNEL_START_BUDGET_ENV]: invalid }),
      KERNEL_START_BUDGET_MS,
      invalid,
    );
  }
  assert.match(
    kernelStartBudgetError({ elapsedMs: 41234, budgetMs: 40000 }).message,
    /内核启动用了 41\.2 秒，超过 40\.0 秒的预算/,
  );
});

test('启动成功时记录实测耗时', async () => {
  const { rows, log } = record();
  await startKernel(
    {
      start: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      },
    },
    { sessionId: 'session-started', budgetMs: 5000, log },
  );
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].level, rows[0].event], ['info', 'kernel.start']);
  assert.equal(rows[0].detail.sessionId, 'session-started');
  assert.equal(rows[0].detail.budgetMs, 5000);
  assert(rows[0].detail.ms >= 60, `记录的耗时 ${rows[0].detail.ms} ms 应不小于启动耗时`);
});

test('启动失败时也记录实测耗时，非预算错误原样抛出', async () => {
  const { rows, log } = record();
  const cause = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  await assert.rejects(
    startKernel(
      {
        start: async () => {
          throw cause;
        },
      },
      { sessionId: 'session-failed', budgetMs: 5000, log },
    ),
    (error) => error === cause,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].level, rows[0].event, rows[0].detail.code],
    ['error', 'kernel.start-failed', 'ENOENT'],
  );
  assert(Number.isInteger(rows[0].detail.ms));
});

test('SDK 的 initialize 超时换成带实测值的预算错误', async () => {
  const { rows, log } = record();
  const timeout = Object.assign(
    new Error('initialize timed out after 45000ms waiting for 知行 SDK 内核'),
    { name: 'RequestTimeoutError' },
  );
  await assert.rejects(
    startKernel(
      {
        start: async () => {
          throw timeout;
        },
      },
      { sessionId: 'session-sdk-timeout', budgetMs: 40000, log },
    ),
    (error) => {
      assert.equal(error.code, 'RUNTIME_START_TIMEOUT');
      assert.equal(error.stage, 'startup');
      assert.equal(error.details.budgetMs, 40000);
      assert.match(error.message, /本次交办尚未发送/);
      return true;
    },
  );
  assert.equal(rows.at(-1).detail.code, 'RUNTIME_START_TIMEOUT');
});

// 真内核：预算压到 100 ms，真实 h.start() 不可能这么快就绪，断言拿到显式失败与实测毫秒数。
test('超出预算时用真内核显式失败并报出实测毫秒数', { timeout: 90000 }, async () => {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), 'zhixing-kernel-budget-'),
  );
  const harness = await makeHarness(
    root,
    {
      model: 'synthetic-startup-budget',
      reasoning: 'off',
      baseUrl: 'http://127.0.0.1:1',
      kernel: { webEnabled: false, workflowEnabled: false, subagentDepth: 0 },
    },
    'synthetic-no-model-request',
  );
  const { rows, log } = record();
  const began = Date.now();
  try {
    await assert.rejects(
      startKernel(harness, { sessionId: 'budget-check', budgetMs: 100, log }),
      (error) => {
        assert.equal(error.code, 'RUNTIME_START_TIMEOUT');
        assert.equal(error.stage, 'startup');
        assert.equal(error.details.budgetMs, 100);
        assert(error.details.elapsedMs >= 100, `实测 ${error.details.elapsedMs} ms 应不小于预算`);
        assert(error.details.elapsedMs < Date.now() - began + 1000);
        assert.match(error.message, /内核启动用了 0\.\d 秒，超过 0\.1 秒的预算，本次交办尚未发送/);
        return true;
      },
    );
    const entry = rows.at(-1);
    assert.deepEqual(
      [entry.level, entry.event, entry.detail.code],
      ['error', 'kernel.start-failed', 'RUNTIME_START_TIMEOUT'],
    );
    assert(entry.detail.ms >= 100);
    assert.equal(entry.detail.budgetMs, 100);
  } finally {
    await Promise.race([
      harness.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 20000)),
    ]);
    await fs
      .rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 })
      .catch(() => {});
  }
});

// 同一台机器上把预算给足，真内核要能成功两次并留下两次成功日志（首次铺 DSH_HOME 后第二次更快）。
test('预算给足时真内核连续两次启动成功并记录耗时', { timeout: 120000 }, async () => {
  const parent = await fs.realpath(os.tmpdir());
  for (const label of ['first', 'second']) {
    const root = await fs.mkdtemp(path.join(parent, 'zhixing-kernel-start-'));
    const harness = await makeHarness(
      root,
      {
        model: 'synthetic-startup-budget',
        reasoning: 'off',
        baseUrl: 'http://127.0.0.1:1',
        kernel: { webEnabled: false, workflowEnabled: false, subagentDepth: 0 },
      },
      'synthetic-no-model-request',
    );
    const { rows, log } = record();
    try {
      await startKernel(harness, { sessionId: `start-${label}`, budgetMs: 40000, log });
      const entry = rows.at(-1);
      assert.deepEqual([entry.level, entry.event], ['info', 'kernel.start'], label);
      assert(entry.detail.ms > 0, label);
    } finally {
      await Promise.race([
        harness.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 20000)),
      ]);
      await fs
        .rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 })
        .catch(() => {});
    }
  }
});

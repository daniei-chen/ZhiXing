// 内核冷启动预算。基线（main a73cc7d）把 initializeTimeoutMs 写死 20 000 ms，
// 而本机真实负载下 h.start() 会顶到 20 149 ms，于是新建聊天后的第一次交办直接
// 收到 RequestTimeoutError，界面还把这条失败改写成「请求超时，请检查网络」。
//
// 默认值来自实测（2026-11-28，Windows PC-20260816OWHB，空 DSH_HOME，走仓库自己的
// makeHarness()）：
//   空载连跑 10 次 h.start()：2 657–3 705 ms，p95 3 705 ms
//   同时起 3 个内核再测 10 次：3 547–7 088 ms，p95 7 088 ms
// 但 P0 发生当晚（四个审计线程同时起内核）实测 9 410–11 711 ms，队长在同样条件下
// 测到 20 149 ms 与 22 159 ms 两次。空载样本会给出 7 s 预算、负载样本给出 14 s，
// 两者都会在已记录的最坏条件（20 s）下重新变成超时，所以按最坏 p95 的两倍取 40 s：
// 留一倍余量给更慢的机器和更重的负载，同时仍远小于任务超时（600 s）。
export const KERNEL_START_BUDGET_MS = 40000;
export const KERNEL_START_BUDGET_ENV = 'ZHIXING_KERNEL_START_TIMEOUT_MS';
const MIN_MS = 5000;
const MAX_MS = 300000;
// SDK 自己的 initialize 截止时间要排在预算之后：先由这里报「超预算 + 实测毫秒数」，
// SDK 的硬截止只兜住 spawn 之类的非握手挂起。
export const KERNEL_START_SDK_GRACE_MS = 5000;

// 预算只从环境变量读：它属于「这台机器到底有多慢」，不是办公设置里的一项。
// 非法值退回默认值，不因为写错一个环境变量就让交办永远失败。
export function kernelStartBudgetMs(env = process.env) {
  const raw = String(env?.[KERNEL_START_BUDGET_ENV] ?? '').trim();
  if (!raw) return KERNEL_START_BUDGET_MS;
  const value = Number(raw);
  return Number.isInteger(value) && value >= MIN_MS && value <= MAX_MS
    ? value
    : KERNEL_START_BUDGET_MS;
}

const seconds = (milliseconds) => (milliseconds / 1000).toFixed(1);

export function kernelStartBudgetError({ elapsedMs, budgetMs }) {
  return Object.assign(
    new Error(
      `内核启动用了 ${seconds(elapsedMs)} 秒，超过 ${seconds(budgetMs)} 秒的预算，本次交办尚未发送。可以重试；反复失败请重启应用。`,
    ),
    { code: 'RUNTIME_START_TIMEOUT', stage: 'startup', details: { elapsedMs, budgetMs } },
  );
}

// SDK 抛的是 RequestTimeoutError（message 形如 `initialize timed out after 40000ms`）。
// 到这一步说明等待已经超预算，统一换成带实测毫秒数的错误；其它启动失败原样抛出，
// 只在日志里留下耗时。
function exceededBudget(error, elapsedMs, budgetMs) {
  return error?.name === 'RequestTimeoutError' || elapsedMs >= budgetMs
    ? kernelStartBudgetError({ elapsedMs, budgetMs })
    : error;
}

export async function startKernel(
  harness,
  { sessionId, budgetMs = kernelStartBudgetMs(), log = () => {} } = {},
) {
  const startedAt = Date.now();
  let timer;
  const starting = harness.start();
  // 超预算之后这次启动仍然可能在几千毫秒后失败；harness 在调用方 finally 里关闭，
  // 这里先接住迟到结果，免得变成 unhandledRejection。
  starting.catch(() => {});
  try {
    await Promise.race([
      starting,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(kernelStartBudgetError({ elapsedMs: Date.now() - startedAt, budgetMs })),
          budgetMs,
        );
      }),
    ]);
    log('info', 'kernel.start', { sessionId, ms: Date.now() - startedAt, budgetMs });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const failure = exceededBudget(error, elapsedMs, budgetMs);
    log('error', 'kernel.start-failed', {
      sessionId,
      ms: elapsedMs,
      budgetMs,
      code: failure.code || error?.name || 'UNKNOWN',
    });
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

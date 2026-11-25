// 压缩策略：与 DeepSeek Harness 桌面版对齐（dsh-base 默认挂载，无配置即用默认值）。
//
// 桌面版的默认值来自 dsh-compaction-basic：
//   thresholdRatio .8、retainRatio .16、headroomTokens 65536（maxTokens 默认等于 headroom）。
// 内核的预算公式是：
//   messageBudget  = contextWindow - reservedCompletionTokens(maxTokens)
//   pressureBudget = messageBudget - headroomTokens
//   thresholdTokens = min(contextWindow * thresholdRatio, pressureBudget)
// 桌面版模型窗口都在 128k 以上，65536 的 headroom 永远留得下；知行允许把窗口配到 8k，
// 所以这里保留同一个默认值，只在窗口塞不下时收缩并标记，交给调用方记日志。
export const DESKTOP_HEADROOM_TOKENS = 65536;
export const DESKTOP_THRESHOLD_RATIO = 0.8;
export const DESKTOP_RETAIN_RATIO = 0.16;

export function compactionPolicy({ contextWindow, maxTokens, headroomTokens = DESKTOP_HEADROOM_TOKENS, thresholdRatio = DESKTOP_THRESHOLD_RATIO, retainRatio = DESKTOP_RETAIN_RATIO } = {}) {
  const window = Number(contextWindow);
  const reserved = Number(maxTokens);
  if (!Number.isInteger(window) || window <= 0) throw new Error('contextWindow 必须是正整数');
  if (!Number.isInteger(reserved) || reserved <= 0) throw new Error('maxTokens 必须是正整数');
  if (reserved >= window) throw new Error('maxTokens 必须小于 contextWindow');
  if (!(thresholdRatio > 0 && thresholdRatio <= 1)) throw new Error('thresholdRatio 必须在 (0, 1] 之间');
  if (!(retainRatio > 0 && retainRatio < thresholdRatio)) throw new Error('retainRatio 必须小于 thresholdRatio');
  const budget = window - reserved;
  const wanted = Number(headroomTokens);
  if (!Number.isInteger(wanted) || wanted <= 0) throw new Error('headroomTokens 必须是正整数');
  const clamped = wanted >= budget;
  const effective = clamped ? Math.max(1024, Math.floor(budget / 2)) : wanted;
  const thresholdTokens = Math.floor(Math.min(window * thresholdRatio, budget - effective));
  const retainTokens = Math.floor(budget * retainRatio);
  return {
    config: { headroomTokens: effective, maxTokens: effective, thresholdRatio, retainRatio },
    headroomTokens: effective,
    clamped,
    thresholdTokens,
    retainTokens,
    contextWindow: window,
    maxTokens: reserved,
  };
}

export function compactionSummary(policy) {
  return `压缩阈值 ${policy.thresholdTokens} tokens（窗口 ${policy.contextWindow}，headroom ${policy.headroomTokens}${policy.clamped ? '，已按窗口收缩' : ''}）`;
}

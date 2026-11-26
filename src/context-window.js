// 输入区的「上下文 N / M tokens」中，M 必须跟着**当前选中的型号**走。
//
// 内核回报的压力口径（`context.pressure.contextWindow`）属于「上一次真正发出请求时用的模型」。
// 用户在输入区把型号换成窗口更小的那个之后、请求还没发出去之前，界面若继续用这个旧值，
// 就会出现「型号已经叫 QA 中窗口、窗口还写着 131,072」的自相矛盾。这里按与主进程相同的优先级
// 取窗口：型号自己声明的 → 供应商声明的 → 上一次实测的 → 128,000。
const positive = value => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

// 同名型号可能出现在多个供应商下，所以先按「供应商 + 型号」精确匹配，再退回按型号匹配。
export function modelContextWindow(runtime, settings) {
  const providerId = settings?.modelProviderId || '';
  const modelId = settings?.model || '';
  if (!modelId) return null;
  const models = Array.isArray(runtime?.models) ? runtime.models : [];
  const exact = providerId ? models.find(row => row?.id === modelId && row?.providerId === providerId) : null;
  const row = exact || models.find(item => item?.id === modelId) || null;
  const window = positive(row?.contextWindow);
  if (window) return window;
  const providers = Array.isArray(runtime?.providers) ? runtime.providers : [];
  const owner = providers.find(provider => provider?.id === (row?.providerId || providerId));
  return positive(owner?.contextWindow);
}

export function contextWindowTokens(runtime, settings, measured, fallback = 128000) {
  return modelContextWindow(runtime, settings) ?? positive(measured) ?? fallback;
}

export function contextUsageText(totalTokens, windowTokens) {
  const total = Number(totalTokens);
  const window = positive(windowTokens) ?? 128000;
  return `上下文 ${Number.isFinite(total) ? total.toLocaleString('en-US') : '0'} / ${window.toLocaleString('en-US')} tokens`;
}

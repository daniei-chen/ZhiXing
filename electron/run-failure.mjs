// 内核把一次失败的模型请求压成「模型未完成本次请求」一句话，用户看完仍然
// 不知道该改 API Key、换地址，还是等一会儿重试。这里只做一件事：把内核
// 已经给出的 HTTP 状态或它自己的失败代码原样带进句子，交给渲染层统一映射
// 成可行动文案。不做猜测——没有状态、也没识别出代码时保持原来那句不变。
//
// 不同供应商适配器给出的形状并不一致：Messages 路径带 status 字段，Chat
// Completions 路径只在 message 开头写「401: {...}」，还有的只给 AUTH 这类
// 供应商无关代码。三种都要认，否则用户拿到的还是一句笼统的话。
const STATUSES = /^\s*(\d{3})\b|HTTP (\d{3})\b/;
const HINTED_CODES = new Set([
  'AUTH', 'ACCOUNT_TOKEN_INVALID', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL',
  'RATE_LIMIT', 'QUOTA', 'ACCOUNT_QUOTA',
  'TRANSPORT', 'TIMEOUT', 'SERVER',
  'CONTEXT_WINDOW_EXCEEDED', 'MODEL_SWITCH_COMPACTION_FAILED', 'UNKNOWN_MODEL',
]);
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;

function statusOf(error) {
  const status = error.status;
  if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  const match = STATUSES.exec(typeof error.message === 'string' ? error.message : '');
  const parsed = Number(match?.[1] || match?.[2]);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : 0;
}

export function failureHint(reason) {
  const error = reason?.error ?? {};
  const status = statusOf(error);
  if (status) return `HTTP ${status}`;
  const code = error.code;
  if (typeof code === 'string' && FAILURE_CODE.test(code) && HINTED_CODES.has(code)) return code;
  return '';
}

export function turnFailureMessage(reason) {
  const hint = failureHint(reason);
  return `模型未完成本次请求${hint ? `（${hint}）` : ''}。请检查服务地址、模型 ID、API Key 或额度。`;
}

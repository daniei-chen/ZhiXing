// 内核把一次失败的模型请求压成「模型未完成本次请求」一句话，用户看完仍然
// 不知道该改 API Key、换地址，还是等一会儿重试。这里只做一件事：把内核
// 已经给出的 HTTP 状态或它自己的失败代码原样带进句子，交给渲染层统一映射
// 成可行动文案。不做猜测——没有状态、也没识别出代码时保持原来那句不变。
const HINTED_CODES = new Set(['TRANSPORT', 'TIMEOUT']);
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;

export function failureHint(reason) {
  const error = reason?.error ?? {};
  const status = error.status;
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `HTTP ${status}`;
  const code = error.code;
  if (typeof code === 'string' && FAILURE_CODE.test(code) && HINTED_CODES.has(code)) return code;
  return '';
}

export function turnFailureMessage(reason) {
  const hint = failureHint(reason);
  return `模型未完成本次请求${hint ? `（${hint}）` : ''}。请检查服务地址、模型 ID、API Key 或额度。`;
}

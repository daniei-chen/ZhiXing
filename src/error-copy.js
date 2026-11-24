// 底层错误直接抛给用户时是一串技术文本（fetch failed、401、ENOTFOUND），
// 用户看不出下一步该做什么。这里按可行动性归类；匹配不到的保持原文，
// 不做猜测性改写。原始文本仍会进诊断日志。
const NETWORK_ERROR_COPY = [
  [/401|unauthorized|invalid api key|incorrect api key|authentication/i, 'API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。'],
  [/403|forbidden/i, '服务端拒绝了这次请求（403），请检查 API Key 权限或账户状态。'],
  [/429|rate.?limit|too many requests/i, '请求太频繁（429），请稍等再试。'],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, '解析不到服务地址，请检查网络连接或代理设置。'],
  [/ECONNREFUSED/i, '服务地址拒绝连接，请确认地址和端口是否正确。'],
  [/ECONNRESET|socket hang up|EPIPE/i, '连接被中途断开，请检查网络后重试。'],
  [/ETIMEDOUT|timed? ?out|超时/i, '请求超时，请检查网络后重试。'],
  [/certificate|CERT_|self.signed/i, 'HTTPS 证书校验未通过，请确认服务地址可信。'],
  [/fetch failed|network error|failed to fetch/i, '网络请求失败，请检查网络连接或代理设置。'],
];

export const friendlyError = message => {
  for (const [pattern, copy] of NETWORK_ERROR_COPY) if (pattern.test(message)) return copy;
  return message;
};

// Electron 会把 IPC 异常包成 "Error invoking remote method 'x': Error: ..."，
// 剥掉这层壳再判断。
export const errorText = error => friendlyError(String(error?.message ?? error).replace(/^Error invoking remote method '[^']+': Error: /, ''));

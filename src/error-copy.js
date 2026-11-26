// 底层错误直接抛给用户时是一串技术文本（fetch failed、401、ENOTFOUND），
// 用户看不出下一步该做什么。这里按可行动性归类；匹配不到的保持原文，
// 不做猜测性改写。原始文本仍会进诊断日志。
const NETWORK_ERROR_COPY = [
  // 供应商无关的失败代码（内核 LLM_FAILURE_CODES）：适配器给不出 HTTP 状态
  // 时，代码是唯一还能指向下一步的线索。用中文括号锚定，避免误伤正文。
  [/（(?:AUTH|ACCOUNT_TOKEN_INVALID|MISSING_CREDENTIAL|INVALID_CREDENTIAL)）/, 'API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。'],
  [/（(?:RATE_LIMIT|QUOTA|ACCOUNT_QUOTA)）/, '请求太频繁或额度已用尽，请稍后再试，或到账户里检查余额与限额。'],
  [/（SERVER）/, '模型服务内部出错，请稍后再试。'],
  [/（CONTEXT_WINDOW_EXCEEDED）/, '对话内容超出模型一次能处理的长度，请新建聊天或减少资料后再试。'],
  // 桌面版在模型切换时先给拟用的请求头定价：装不下就压缩，压缩不成才抛这条。
  // 它跟地址、Key、额度都无关，说成那三样会让人白折腾。
  [/（MODEL_SWITCH_COMPACTION_FAILED）/, '换到的新模型装不下这段对话历史，压缩也没能腾出空间。请改用上下文更大的模型，或新建聊天后继续。'],
  [/（UNKNOWN_MODEL）/, '服务端不认这个模型，请刷新模型目录后重新选择。'],
  [/401|unauthorized|invalid api key|incorrect api key|authentication/i, 'API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。'],
  [/403|forbidden/i, '服务端拒绝了这次请求（403），请检查 API Key 权限或账户状态。'],
  [/429|rate.?limit|too many requests/i, '请求太频繁（429），请稍等再试。'],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, '解析不到服务地址，请检查网络连接或代理设置。'],
  [/ECONNREFUSED/i, '服务地址拒绝连接，请确认地址和端口是否正确。'],
  [/ECONNRESET|socket hang up|EPIPE/i, '连接被中途断开，请检查网络后重试。'],
  // 内核把传输层失败统一记成 TRANSPORT，不保留底层 Socket 代码；
  // 这是聊天发送路径唯一还能拿到的网络线索，不能落回笼统的失败句。
  [/TRANSPORT/, '无法连接到模型服务，请检查网络、代理或服务地址后重试。'],
  [/ETIMEDOUT|timed? ?out|超时/i, '请求超时，请检查网络后重试。'],
  [/certificate|CERT_|self.signed/i, 'HTTPS 证书校验未通过，请确认服务地址可信。'],
  // 本机网关把「连不上上游」记成 502/503/504；这三者对用户就是同一件事：
  // 服务没连上。500 不算——它是上游自己出错，不能冒充网络问题。
  [/（HTTP (?:502|503|504)）|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout/i, '无法连接到模型服务，请检查网络、代理或服务地址后重试。'],
  [/fetch failed|network error|failed to fetch/i, '网络请求失败，请检查网络连接或代理设置。'],
];

export const friendlyError = message => {
  for (const [pattern, copy] of NETWORK_ERROR_COPY) if (pattern.test(message)) return copy;
  return message;
};

// Electron 会把 IPC 异常包成 "Error invoking remote method 'x': Error: ..."，
// 剥掉这层壳再判断。
export const errorText = error => friendlyError(String(error?.message ?? error).replace(/^Error invoking remote method '[^']+': Error: /, ''));

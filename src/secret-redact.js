// 凭据形状的唯一事实来源：脱敏引擎（privacy-core.js）与 Electron 主进程的
// IPC 错误路径都必须从这里取规则。CJS 与 ESM 都能加载本文件，所以不要在
// 任何其它文件里再写一份凭据正则。
export const SECRET_PLACEHOLDER = '[已隐藏凭据]';

export const SECRET_RULES = [
  ['SECRET', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['SECRET', /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer[ \t]+[A-Za-z0-9._~+/-]{12,})\b/g],
  [
    'SECRET',
    /\b(?:ghp_|github_pat_|glpat-|AIza|xox[baprs]-|sk_live_|hf_|gsk_|xai-|npm_|pypi-|dop_v1_|cfut_)[A-Za-z0-9_-]{12,}\b/g,
  ],
  ['SECRET', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['SECRET', /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g],
  [
    'SECRET',
    /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|密码|密钥|password|passwd|token|secret)["']?[ \t]*[=:：][ \t]*(?:"[^"\r\n]+(?:"|(?=\r|\n|$))|'[^'\r\n]+(?:'|(?=\r|\n|$))|[^\s"',;，；⟦⟧]+)/gi,
  ],
  [
    'SECRET',
    /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|https?):\/\/[^\s/@"'<>]+:[^\s/@"'<>]+@[^\s"'<>，；]+/gi,
  ],
  [
    'SECRET',
    /\b(?:authorization|proxy-authorization)["']?[ \t]*[:=][ \t]*["']?(?:Basic|Bearer)[ \t]+[A-Za-z0-9._~+/-=]+/gi,
  ],
];

// 把文本里所有凭据形状替换成占位符。调用方负责先脱敏后截断：先截断会把
// 跨边界的密钥切成半截，剩下的前缀照样是凭据。
export function redactSecrets(text) {
  let output = String(text ?? '');
  for (const rule of SECRET_RULES) output = output.replace(rule[1], SECRET_PLACEHOLDER);
  return output;
}

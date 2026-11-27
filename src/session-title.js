// 会话标题取自用户第一段交办。内核 `dsh-session-title` 的 fallback 规则是
// 「清掉控制序列 → 合成一行 → 按 UTF-8 字节截断且不切断码点」，并明确说明
// 方向控制符会让显示的标题变得具有欺骗性。知行原来直接 `slice(0, 42)`，
// 既不按字节也不清控制符：粘贴的终端输出会带 ANSI 序列，RTL override 能让
// 标题看起来像另一句话。这里按上游口径收紧，不引入新的标题策略。
/* eslint-disable no-control-regex -- 这些正则的定义就是「匹配控制序列」，与上游 dsh-session-title 的同一组模式一致。 */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu;
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu;
const ESC_SEQUENCE = /\u001B[@-_]/gu;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu;

export const TITLE_MAX_BYTES = 120;

export function cleanTitleText(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

// 用 TextEncoder 数 UTF-8 字节，避免把 emoji 或组合序列截成半个码点。
export function truncateTitleBytes(input, maxBytes = TITLE_MAX_BYTES) {
  const text = typeof input === 'string' ? input : '';
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('标题字节上限无效。');
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let output = '';
  let used = 0;
  for (const character of text) {
    const bytes = encoder.encode(character).length;
    if (used + bytes > maxBytes) break;
    output += character;
    used += bytes;
  }
  return output;
}

/** 新聊天标题：清掉控制符后按字节截断，超长补省略号。 */
export function fallbackTitle(input, maxBytes = TITLE_MAX_BYTES) {
  const clean = cleanTitleText(input);
  const cut = truncateTitleBytes(clean, maxBytes).trimEnd();
  return cut.length < clean.length ? `${cut}…` : cut;
}

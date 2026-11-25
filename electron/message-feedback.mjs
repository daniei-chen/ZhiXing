// 消息反馈：与 Harness 桌面版的 dsh-message-feedback 对齐——赞/踩、固定分类表、可选备注，
// 只写本机，不进模型历史。分类 id 是桌面版的持久词汇，标签用其中文释义。
export const FEEDBACK_RATINGS = ['up', 'down'];

export const FEEDBACK_CATEGORIES = [
  { id: 'task-result', label: '任务结果' },
  { id: 'instruction-following', label: '指令理解与遵循' },
  { id: 'product-interaction', label: '产品功能与交互' },
  { id: 'service-stability', label: '稳定性和速度' },
  { id: 'resource-cost', label: '资源使用与费用' },
  { id: 'security-privacy-permission', label: '安全隐私与权限' },
  { id: 'other', label: '其他' },
];

// 桌面版 Web 组合把备注上限定在 8192 字节（UTF-8），这里保持一致。
export const FEEDBACK_NOTE_MAX_BYTES = 8192;

const CATEGORY_IDS = new Set(FEEDBACK_CATEGORIES.map(item => item.id));

// 不依赖 TextEncoder：组件测试跑在 jsdom 里没有这个全局，按码点自己算 UTF-8 字节数，
// 结果与 Buffer.byteLength(text,'utf8') 一致。
export function utf8Bytes(text) {
  let bytes = 0;
  for (const character of String(text ?? '')) {
    const code = character.codePointAt(0);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function noteBytes(note) {
  return utf8Bytes(note);
}

/** 校验一条反馈；返回 {ok:true,value} 或 {ok:false,code}，code 与桌面版失败码同名。 */
export function validateFeedback(input) {
  const rating = input?.rating;
  if (!FEEDBACK_RATINGS.includes(rating)) return { ok: false, code: 'rating-invalid' };
  const rawCategory = input?.category ?? null;
  if (rawCategory !== null && !CATEGORY_IDS.has(rawCategory)) return { ok: false, code: 'category-invalid' };
  const rawNote = input?.note ?? '';
  const note = String(rawNote);
  if (note.length && !note.trim().length) return { ok: false, code: 'note-blank' };
  if (noteBytes(note) > FEEDBACK_NOTE_MAX_BYTES) return { ok: false, code: 'note-too-large' };
  return { ok: true, value: { rating, category: rawCategory, note } };
}

/** 规范化成落盘条目；conversationId 与 messageId 只用来定位，不参与校验码判断。 */
export function feedbackEntry(input, now = Date.now()) {
  const checked = validateFeedback(input);
  if (!checked.ok) return checked;
  const conversationId = String(input?.conversationId ?? '').trim();
  const messageId = String(input?.messageId ?? '').trim();
  if (!conversationId || !messageId) return { ok: false, code: 'message-missing' };
  return {
    ok: true,
    value: {
      conversationId,
      messageId,
      ...checked.value,
      updatedAt: now,
    },
  };
}

/** 同一条消息只保留一条反馈：后写的覆盖先写的。 */
export function mergeFeedback(entries, entry) {
  const list = Array.isArray(entries) ? entries.filter(item => item && typeof item === 'object') : [];
  return [...list.filter(item => !(item.conversationId === entry.conversationId && item.messageId === entry.messageId)), entry];
}

export function removeFeedback(entries, conversationId, messageId) {
  return (Array.isArray(entries) ? entries : []).filter(item => !(item?.conversationId === conversationId && item?.messageId === messageId));
}

export function feedbackFor(entries, conversationId, messageId) {
  return (Array.isArray(entries) ? entries : []).find(item => item?.conversationId === conversationId && item?.messageId === messageId) ?? null;
}

export function categoryLabel(id) {
  return FEEDBACK_CATEGORIES.find(item => item.id === id)?.label ?? '';
}

/** 界面上那一行字：赞/踩 + 分类（如果有）。备注不进摘要，避免把长文本摊在消息下方。 */
export function feedbackLabel(entry) {
  if (!entry) return '';
  const rating = entry.rating === 'down' ? '踩' : '赞';
  const category = categoryLabel(entry.category);
  return category ? `${rating} · ${category}` : rating;
}

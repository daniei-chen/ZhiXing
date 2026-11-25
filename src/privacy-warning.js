export const RESTORE_MARK = '【敏感值待核实】';

export function restoreNotice(count) {
  const total = Number(count) || 0;
  if (total <= 0) return null;
  return `有 ${total} 处占位符无法归属本次任务，已按${RESTORE_MARK}保留；原文没有还原，模型也没有看到原始内容。`;
}

// 导出与分享的正文是纯文本，气泡里的灰字提示带不过去，所以附一句同样的说明。
export function exportNote(count, { whole = false } = {}) {
  const total = Number(count) || 0;
  if (total <= 0) return '';
  return `（${whole ? '本会话' : '本段'}有 ${total} 处占位符无法归属对应任务，已按${RESTORE_MARK}保留。）`;
}

export function sumUnrestored(messages) {
  return (messages || []).reduce((total, message) => total + (Number(message?.unrestored) || 0), 0);
}

export const RESTORE_MARK = '【敏感值待核实】';

export function restoreNotice(count) {
  const total = Number(count) || 0;
  if (total <= 0) return null;
  return `有 ${total} 处占位符无法归属本次任务，已按${RESTORE_MARK}保留；原文没有还原，模型也没有看到原始内容。`;
}

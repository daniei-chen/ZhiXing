// 改动对比视图的文案规则（对标桌面版 changes-review tab 的标题与行数口径）。
export function reviewTitle(files) {
  const total = Array.isArray(files) ? files.length : 0;
  return total ? `本轮改动 ${total} 个文件` : '本轮改动';
}

export function reviewFileLabel(file) {
  const display = typeof file?.display === 'string' ? file.display.trim() : '';
  if (display) return display;
  const path = typeof file?.path === 'string' ? file.path.trim() : '';
  return path || '未命名文件';
}

export function reviewCounts(file) {
  const added = Number.isSafeInteger(file?.added) ? file.added : 0;
  const deleted = Number.isSafeInteger(file?.deleted) ? file.deleted : 0;
  const sign = value => `${value > 0 ? '+' : value === 0 ? '±' : '−'}${Math.abs(value)}`;
  if (file?.estimated) return `约 ${sign(added)} ${deleted >= 0 ? '−' + deleted : ''}`.trim();
  return `+${added} −${deleted}`;
}

export function reviewRowType(row) {
  return ['add', 'remove', 'context', 'gap'].includes(row?.type) ? row.type : 'context';
}

export function reviewEmptyCopy(files) {
  return Array.isArray(files) && files.length ? '' : '本轮没有可以对比的改动。';
}

export function reviewSkipCopy(diff) {
  return diff?.skipped ? '这次改动太大，只统计了行数，没有逐行对比。' : '';
}

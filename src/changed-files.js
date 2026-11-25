// 轮次末尾「改动文件」卡片的展示规则。对标 dsh-client-ui-deliverables 的改动文件卡片：
// 列出本轮改动的文件与 Host 记录的行数，卡片在收尾正文之后、交付卡片之前。
export function changedFilesLabel(count) {
  if (!Number.isSafeInteger(count) || count <= 0) return '';
  return `本轮改动 ${count} 个文件`;
}

export function displayPath(file) {
  const display = typeof file?.display === 'string' ? file.display.trim() : '';
  if (display) return display;
  const path = typeof file?.path === 'string' ? file.path.trim() : '';
  return path || '未命名文件';
}

// 行数：+新增 / -删除；估算或缺失时明确写出来，不假装精确。
export function changeCounts(change) {
  const added = Number.isSafeInteger(change?.added) ? change.added : 0;
  const deleted = Number.isSafeInteger(change?.deleted) ? change.deleted : 0;
  if (change?.estimated) return { added, deleted, label: `约 +${added} −${deleted}` };
  if (!added && !deleted) return { added, deleted, label: '行数未记录' };
  return { added, deleted, label: `+${added} −${deleted}` };
}

export function totalCounts(files) {
  const list = Array.isArray(files) ? files : [];
  return list.reduce((totals, change) => {
    const counts = changeCounts(change);
    return { added: totals.added + counts.added, deleted: totals.deleted + counts.deleted };
  }, { added: 0, deleted: 0 });
}

export function changedFilesTotalLabel(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return '';
  const { added, deleted } = totalCounts(list);
  return `+${added} −${deleted}`;
}

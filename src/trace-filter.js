// 执行轨迹的检索：桌面版 Trajectory 工具栏有「搜索轨迹」（placeholder「搜索」），
// 且搜索覆盖已折叠的子调用。这里只做与本机事件模型等价的匹配，不改事件本身。
export function normalizeQuery(query) {
  return String(query ?? '').trim().toLocaleLowerCase('zh-CN');
}

function haystack(row) {
  return [row?.label, row?.status, row?.category].filter(value => typeof value === 'string').join(' ').toLocaleLowerCase('zh-CN');
}

export function matchesTrace(row, query) {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  return haystack(row).includes(needle);
}

// 事件按时间升序进来，界面倒序展示；过滤后保持原有顺序，不重排。
export function filterTrace(rows, query) {
  const needle = normalizeQuery(query);
  if (!needle) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter(row => haystack(row).includes(needle));
}

// 子任务与后台作业按「子任务 N」「作业 N」这类展示名参与检索，和界面上的行保持一致。
export function matchesLabel(label, query) {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  return String(label ?? '').toLocaleLowerCase('zh-CN').includes(needle);
}

export function traceSearchSummary(query, matched, total) {
  const needle = normalizeQuery(query);
  if (!needle) return '';
  return matched ? `匹配 ${matched} / ${total} 条` : `没有匹配「${String(query).trim()}」的记录`;
}

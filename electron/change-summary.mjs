// 本轮改动文件的行数统计。桌面版（dsh-workspace-changes）在每轮开始/结束时取 git 快照，
// 对 git 覆盖不到、由文件工具写入的路径另行整文件捕获；本轮先在知行里做后者：
// write/edit 的 tool/result 自带 meta.diffs（每个已应用 hunk 的 before/after 文本），
// 用行级 LCS 算新增/删除行数。路径可能带着本会话的占位符，所以先收集条目、还原路径后再合并。
export const CHANGE_LIMIT = 200;
const TEXT_LIMIT = 65536;
const LINE_LIMIT = 4000;

export function splitLines(value) {
  const text = String(value ?? '');
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}

// 行级最长公共子序列长度，只用来把「替换」拆成新增与删除，不生成逐行补丁。
export function commonLines(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > LINE_LIMIT || b.length > LINE_LIMIT) {
    // 超大文件退化成「按行数差估算」，并在结果里标注估算，不假装精确。
    const overlap = Math.min(a.length, b.length);
    return { count: overlap, estimated: true };
  }
  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return { count: previous[b.length], estimated: false };
}

export function lineDelta(before, after) {
  const beforeText = String(before ?? '');
  const afterText = String(after ?? '');
  if (beforeText === afterText) return { added: 0, deleted: 0, estimated: false };
  if (beforeText.length > TEXT_LIMIT || afterText.length > TEXT_LIMIT) return { added: 0, deleted: 0, estimated: true, skipped: true };
  const { count, estimated } = commonLines(beforeText, afterText);
  const beforeLines = splitLines(beforeText).length;
  const afterLines = splitLines(afterText).length;
  return { added: Math.max(0, afterLines - count), deleted: Math.max(0, beforeLines - count), estimated };
}

// 一个 tool/result 的 meta.diffs 转成本轮的改动条目（不合并，交给还原路径之后再合并）。
export function diffEntries(meta) {
  const diffs = Array.isArray(meta?.diffs) ? meta.diffs : [];
  const entries = [];
  for (const diff of diffs) {
    const target = typeof diff?.path === 'string' ? diff.path.trim() : '';
    if (!target) continue;
    const delta = lineDelta(diff.oldText ?? '', diff.newText ?? '');
    entries.push({ path: target, added: delta.added, deleted: delta.deleted, estimated: delta.estimated });
  }
  return entries;
}

// 按路径合并：同一文件多次编辑累加，超过上限丢弃最早的路径。
export function mergeEntries(entries, limit = CHANGE_LIMIT) {
  const merged = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const target = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (!target) continue;
    const added = Number.isFinite(entry.added) ? entry.added : 0;
    const deleted = Number.isFinite(entry.deleted) ? entry.deleted : 0;
    const display = typeof entry.display === 'string' && entry.display.trim() ? entry.display.trim() : undefined;
    const previous = merged.get(target);
    merged.set(target, previous
      ? { path: target, added: previous.added + added, deleted: previous.deleted + deleted, estimated: previous.estimated || entry.estimated === true, ...(previous.display ? { display: previous.display } : display ? { display } : {}) }
      : { path: target, added, deleted, estimated: entry.estimated === true, ...(display ? { display } : {}) });
    if (merged.size > limit) merged.delete(merged.keys().next().value);
  }
  while (merged.size > limit) merged.delete(merged.keys().next().value);
  return [...merged.values()];
}

export function changeTotals(changes) {
  const list = Array.isArray(changes) ? changes : [];
  return list.reduce((totals, change) => ({
    total: totals.total + 1,
    added: totals.added + (Number.isFinite(change?.added) ? change.added : 0),
    deleted: totals.deleted + (Number.isFinite(change?.deleted) ? change.deleted : 0),
  }), { total: 0, added: 0, deleted: 0 });
}

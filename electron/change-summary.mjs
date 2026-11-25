// 本轮改动文件的行数统计。桌面版（dsh-workspace-changes）在每轮开始/结束时取 git 快照，
// 对 git 覆盖不到、由文件工具写入的路径另行整文件捕获；本轮先在知行里做后者：
// write/edit 的 tool/result 自带 meta.diffs（每个已应用 hunk 的 before/after 文本），
// 用行级 LCS 算新增/删除行数，按路径累计。二进制与超大文件不记行数。
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

// 一个 tool/result 的 meta.diffs 转成本轮的改动条目；同一路径的多次编辑累加。
export function diffEntries(meta) {
  const diffs = Array.isArray(meta?.diffs) ? meta.diffs : [];
  const entries = new Map();
  for (const diff of diffs) {
    const path = typeof diff?.path === 'string' ? diff.path.trim() : '';
    if (!path) continue;
    const delta = lineDelta(diff.oldText ?? '', diff.newText ?? '');
    const previous = entries.get(path) || { path, added: 0, deleted: 0, estimated: false };
    entries.set(path, {
      path,
      added: previous.added + delta.added,
      deleted: previous.deleted + delta.deleted,
      estimated: previous.estimated || delta.estimated,
    });
  }
  return [...entries.values()];
}

export function mergeChanges(changes, meta, limit = CHANGE_LIMIT) {
  const merged = new Map(Array.isArray(changes) ? changes.map(change => [change.path, { ...change }]) : []);
  for (const entry of diffEntries(meta)) {
    const previous = merged.get(entry.path);
    merged.set(entry.path, previous
      ? { path: entry.path, added: previous.added + entry.added, deleted: previous.deleted + entry.deleted, estimated: previous.estimated || entry.estimated }
      : entry);
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

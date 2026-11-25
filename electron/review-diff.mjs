// 改动文件的逐文件对比（对标桌面版 changes-review tab：文件选择 + 单文件前后对比）。
// 数据仍来自 write/edit 的 tool/result meta.diffs（每个已应用 hunk 的前后文本）。
// 这里把前后文本算成统一对比行：上下文 3 行、相邻两段之间留一个 gap 行、超大文件只给行数。
export const CONTEXT_LINES = 3;
export const TEXT_LIMIT = 65536;
export const LINE_LIMIT = 4000;
export const ROW_LIMIT = 2000;
export const HUNK_LIMIT = 120;
export const BYTES_LIMIT = 262144;

const splitLines = value => {
  const text = String(value ?? '');
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
};

// 行级 LCS 回溯出增删运动；超过行数上限就不再逐行比较。
function movements(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  const rows = a.length + 1;
  const columns = b.length + 1;
  const table = new Uint8Array(rows * columns);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] = a[i] === b[j]
        ? table[(i + 1) * columns + j + 1] + 1
        : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
    }
  }
  const moves = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      moves.push({ type: 'context', text: a[i], beforeLine: i + 1, afterLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * columns + j] >= table[i * columns + j + 1]) {
      moves.push({ type: 'remove', text: a[i], beforeLine: i + 1, afterLine: null });
      i += 1;
    } else {
      moves.push({ type: 'add', text: b[j], beforeLine: null, afterLine: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    moves.push({ type: 'remove', text: a[i], beforeLine: i + 1, afterLine: null });
    i += 1;
  }
  while (j < b.length) {
    moves.push({ type: 'add', text: b[j], beforeLine: null, afterLine: j + 1 });
    j += 1;
  }
  return moves;
}

// 只保留改动附近的行，远处相同的行折叠成 gap；行数超限时标注 truncated。
export function unifiedRows(before, after, options = {}) {
  const context = Number.isSafeInteger(options.context) ? options.context : CONTEXT_LINES;
  const limit = Number.isSafeInteger(options.limit) ? options.limit : ROW_LIMIT;
  const beforeText = String(before ?? '');
  const afterText = String(after ?? '');
  if (beforeText.length > TEXT_LIMIT || afterText.length > TEXT_LIMIT) {
    return { rows: [], added: 0, deleted: 0, skipped: true, truncated: false };
  }
  if (splitLines(beforeText).length > LINE_LIMIT || splitLines(afterText).length > LINE_LIMIT) {
    return { rows: [], added: 0, deleted: 0, skipped: true, truncated: false };
  }
  const moves = movements(beforeText, afterText);
  const keep = new Array(moves.length).fill(false);
  moves.forEach((move, index) => {
    if (move.type === 'context') return;
    for (let cursor = Math.max(0, index - context); cursor <= Math.min(moves.length - 1, index + context); cursor += 1) keep[cursor] = true;
  });
  let added = 0;
  let deleted = 0;
  for (const move of moves) {
    if (move.type === 'add') added += 1;
    if (move.type === 'remove') deleted += 1;
  }
  const rows = [];
  let truncated = false;
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (!keep[index]) {
      if (!rows.length || rows.at(-1).type === 'gap') continue;
      rows.push({ type: 'gap' });
      continue;
    }
    if (rows.length >= limit) { truncated = true; break; }
    rows.push(move);
  }
  while (rows.length && rows.at(-1).type === 'gap') rows.pop();
  return { rows, added, deleted, skipped: false, truncated };
}

// 把一轮里的 meta.diffs 收集成逐文件对比；条数、字节与文件数都有上限。
export function collectDiffs(entries, diffs) {
  const list = Array.isArray(diffs) ? diffs : [];
  const collected = [];
  let bytes = 0;
  for (const entry of list) {
    if (collected.length >= HUNK_LIMIT) break;
    const target = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (!target) continue;
    const before = String(entry.oldText ?? '');
    const after = String(entry.newText ?? '');
    const size = before.length + after.length;
    if (bytes + size > BYTES_LIMIT) continue;
    const unified = unifiedRows(before, after);
    if (!unified.rows.length && !unified.skipped) continue;
    bytes += size;
    collected.push({ path: target, rows: unified.rows, added: unified.added, deleted: unified.deleted, skipped: unified.skipped, truncated: unified.truncated });
  }
  return collected;
}

// 同一路径的多次编辑合成一条对比：按时间顺序拼接，段间留 gap；全部跳过时保留跳过标记。
export function mergeDiffs(list) {
  const merged = new Map();
  for (const entry of Array.isArray(list) ? list : []) {
    const target = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (!target) continue;
    const previous = merged.get(target);
    const rows = Array.isArray(entry.rows) ? entry.rows : [];
    if (!previous) {
      merged.set(target, { path: target, display: entry.display, rows: [...rows], added: entry.added || 0, deleted: entry.deleted || 0, skipped: entry.skipped === true, truncated: entry.truncated === true });
      continue;
    }
    if (previous.rows.length && rows.length) previous.rows.push({ type: 'gap' });
    previous.rows.push(...rows);
    previous.added += entry.added || 0;
    previous.deleted += entry.deleted || 0;
    previous.skipped = previous.skipped && entry.skipped === true;
    previous.truncated = previous.truncated || entry.truncated === true;
    if (!previous.display && entry.display) previous.display = entry.display;
  }
  return [...merged.values()];
}

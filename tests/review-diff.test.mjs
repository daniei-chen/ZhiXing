import assert from 'node:assert/strict';
import test from 'node:test';
import {TEXT_LIMIT, collectDiffs, unifiedRows} from '../electron/review-diff.mjs';

test('新增文件整段是新增行', () => {
  const { rows, added, deleted, skipped } = unifiedRows('', '一\n二');
  assert.equal(skipped, false);
  assert.equal(added, 2);
  assert.equal(deleted, 0);
  assert.deepEqual(rows.map(row => row.type), ['add', 'add']);
  assert.deepEqual(rows.map(row => row.text), ['一', '二']);
});

test('替换行给出删除在前、新增在后，并带行号', () => {
  const { rows, added, deleted } = unifiedRows('标题\n旧\n结尾', '标题\n新\n结尾');
  assert.equal(added, 1);
  assert.equal(deleted, 1);
  const removed = rows.find(row => row.type === 'remove');
  const addedRow = rows.find(row => row.type === 'add');
  assert.deepEqual(removed, { type: 'remove', text: '旧', beforeLine: 2, afterLine: null });
  assert.deepEqual(addedRow, { type: 'add', text: '新', beforeLine: null, afterLine: 2 });
});

test('远处相同的行折叠成一个 gap，且不留首尾 gap', () => {
  const before = Array.from({ length: 20 }, (_, index) => `行${index + 1}`).join('\n');
  const lines = before.split('\n');
  lines[1] = '改过的行';
  lines[17] = '另一处改动';
  const { rows } = unifiedRows(before, lines.join('\n'));
  assert.equal(rows[0].type === 'gap', false, '开头不应是 gap');
  assert.equal(rows.at(-1).type === 'gap', false, '结尾不应是 gap');
  assert.equal(rows.filter(row => row.type === 'gap').length, 1, `gap 数量不对：${rows.filter(row => row.type === 'gap').length}`);
  assert.ok(rows.filter(row => row.type === 'context').length >= 6, '每处改动两侧各留三行上下文');
});

test('超过文本上限只给跳过标记，不假装有对比', () => {
  const big = 'x'.repeat(TEXT_LIMIT + 1);
  const result = unifiedRows(big, '短');
  assert.deepEqual(result, { rows: [], added: 0, deleted: 0, skipped: true, truncated: false });
});

test('行数超过显示上限时标注 truncated', () => {
  const before = '';
  const after = Array.from({ length: 40 }, (_, index) => `新增${index + 1}`).join('\n');
  const result = unifiedRows(before, after, { limit: 10 });
  assert.equal(result.rows.length, 10);
  assert.equal(result.truncated, true);
  assert.equal(result.added, 40);
});

test('收集时跳过空路径与无变化，并累计字节', () => {
  const collected = collectDiffs(null, [
    { path: 'a.md', oldText: '', newText: '一' },
    { path: '', oldText: 'x', newText: 'y' },
    { path: 'b.md', oldText: '同', newText: '同' },
    { path: 'a.md', oldText: '一', newText: '一\n二' },
  ]);
  assert.deepEqual(collected.map(item => item.path), ['a.md', 'a.md']);
  assert.deepEqual(collected.map(item => item.added), [1, 1]);
  assert.deepEqual(collectDiffs(undefined, undefined), []);
});

test('文件过大时保留条目但标注跳过，不伪造对比行', () => {
  const huge = 'y'.repeat(TEXT_LIMIT);
  const collected = collectDiffs(null, [{ path: 'big.md', oldText: huge, newText: huge + 'z' }]);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].skipped, true);
  assert.deepEqual(collected[0].rows, []);
});

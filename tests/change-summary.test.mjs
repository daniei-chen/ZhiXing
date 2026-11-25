import assert from 'node:assert/strict';
import test from 'node:test';
import {changeTotals, diffEntries, lineDelta, mergeEntries} from '../electron/change-summary.mjs';

test('新增文件按行数算新增', () => {
  assert.deepEqual(lineDelta('', 'a\nb\nc'), { added: 3, deleted: 0, estimated: false });
  assert.deepEqual(lineDelta('', ''), { added: 0, deleted: 0, estimated: false });
});

test('替换行拆成新增与删除，不把上下文算进去', () => {
  const before = '标题\n旧行\n结尾';
  const after = '标题\n新行\n结尾';
  assert.deepEqual(lineDelta(before, after), { added: 1, deleted: 1, estimated: false });
});

test('纯删除与纯插入', () => {
  assert.deepEqual(lineDelta('a\nb\nc', 'a\nc'), { added: 0, deleted: 1, estimated: false });
  assert.deepEqual(lineDelta('a\nc', 'a\nb\nc'), { added: 1, deleted: 0, estimated: false });
});

test('meta.diffs 转成条目，空路径与无 diffs 都被跳过', () => {
  const entries = diffEntries({ diffs: [
    { path: 'a.md', oldText: '', newText: '一\n二' },
    { path: 'a.md', oldText: '一\n二', newText: '一\n二\n三' },
    { path: 'b.txt', oldText: 'x', newText: '' },
    { path: '', oldText: 'x', newText: 'y' },
  ] });
  assert.deepEqual(entries, [
    { path: 'a.md', added: 2, deleted: 0, estimated: false },
    { path: 'a.md', added: 1, deleted: 0, estimated: false },
    { path: 'b.txt', added: 0, deleted: 1, estimated: false },
  ]);
  assert.deepEqual(diffEntries({}), []);
});

test('mergeEntries 跨多次工具结果累计，并有上限', () => {
  const merged = mergeEntries([
    { path: 'a.md', added: 1, deleted: 0 },
    { path: 'a.md', added: 1, deleted: 0 },
    { path: 'b.md', added: 2, deleted: 1 },
  ]);
  assert.deepEqual(merged, [
    { path: 'a.md', added: 2, deleted: 0, estimated: false },
    { path: 'b.md', added: 2, deleted: 1, estimated: false },
  ]);
  const many = Array.from({ length: 5 }, (_, index) => ({ path: `${index}.md`, added: 1, deleted: 0 }));
  assert.equal(mergeEntries([...many, { path: 'new.md', added: 1, deleted: 0 }], 3).length, 3);
  assert.deepEqual(mergeEntries(undefined), []);
});

test('汇总总计', () => {
  assert.deepEqual(changeTotals([{ added: 2, deleted: 1 }, { added: 0, deleted: 3 }]), { total: 2, added: 2, deleted: 4 });
  assert.deepEqual(changeTotals(undefined), { total: 0, added: 0, deleted: 0 });
});

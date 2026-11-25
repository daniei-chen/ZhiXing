import assert from 'node:assert/strict';
import test from 'node:test';
import {changeCounts, changedFilesLabel, changedFilesTotalLabel, displayPath, totalCounts} from '../src/changed-files.js';

test('标题只在有文件时给出，并带数量', () => {
  assert.equal(changedFilesLabel(3), '本轮改动 3 个文件');
  assert.equal(changedFilesLabel(0), '');
  assert.equal(changedFilesLabel(undefined), '');
});

test('路径缺失时给占位，不抛错', () => {
  assert.equal(displayPath({ path: '  src/a.md ' }), 'src/a.md');
  assert.equal(displayPath({}), '未命名文件');
});

test('给了工作区相对名就用相对名，完整路径留给 title', () => {
  assert.equal(displayPath({ path: 'C:\\工作区\\成果\\季度汇总.docx', display: '成果\\季度汇总.docx' }), '成果\\季度汇总.docx');
  assert.equal(displayPath({ path: 'C:\\工作区\\a.md', display: '  ' }), 'C:\\工作区\\a.md');
});

test('行数写成 +新增 / -删除', () => {
  assert.equal(changeCounts({ added: 6, deleted: 0 }).label, '+6 −0');
  assert.equal(changeCounts({ added: 2, deleted: 3 }).label, '+2 −3');
  assert.equal(changeCounts({ added: 0, deleted: 0 }).label, '行数未记录');
  assert.equal(changeCounts({ added: 4, deleted: 1, estimated: true }).label, '约 +4 −1');
});

test('总计累加，并给出合计文案', () => {
  const files = [{ path: 'a', added: 2, deleted: 1 }, { path: 'b', added: 0, deleted: 3 }];
  assert.deepEqual(totalCounts(files), { added: 2, deleted: 4 });
  assert.equal(changedFilesTotalLabel(files), '+2 −4');
  assert.equal(changedFilesTotalLabel([]), '');
});

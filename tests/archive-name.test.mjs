import test from 'node:test';
import assert from 'node:assert/strict';

const { archiveFileName, numberedName } = await import('../electron/archive-name.mjs');

test('默认文件名带会话名与日期，扩展名固定为 .md', () => {
  const name = archiveFileName({ title: '周报整理', date: new Date('2026-11-25T10:00:00').getTime(), index: 1 });
  assert.equal(name, '子会话-周报整理-20261125-1.md');
});

test('会话名里的 Windows 非法字符被替换，过长会截断', () => {
  const name = archiveFileName({ title: 'a/b:c*?"<>|'.concat('长'.repeat(80)), date: new Date('2026-11-25T10:00:00').getTime() });
  assert.doesNotMatch(name, /[\\/:*?"<>|]/);
  assert.ok(name.startsWith('子会话-a-b-c'));
  assert.ok(name.length <= 60 + '子会话--'.length + '-20261125.md'.length + 2);
});

test('没有标题与非法日期时仍给出可用名字', () => {
  assert.equal(archiveFileName({ title: '   ', date: new Date('2026-11-25T10:00:00').getTime() }), '子会话-子会话-20261125.md');
  assert.match(archiveFileName({ title: 'x', date: Number.NaN }), /-未标日期/);
});

test('重名时按序号退让，不改扩展名', () => {
  assert.equal(numberedName('子会话-x-20261125.md', 1), '子会话-x-20261125.md');
  assert.equal(numberedName('子会话-x-20261125.md', 2), '子会话-x-20261125-2.md');
  assert.equal(numberedName('子会话-x-20261125.md', 3), '子会话-x-20261125-3.md');
});

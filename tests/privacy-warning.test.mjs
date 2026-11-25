import test from 'node:test';
import assert from 'node:assert/strict';

const { restoreNotice, RESTORE_MARK } = await import('../src/privacy-warning.js');

test('没有无法归属的占位符时不显示提示', () => {
  assert.equal(restoreNotice(0), null);
  assert.equal(restoreNotice(undefined), null);
  assert.equal(restoreNotice(-3), null);
});

test('提示里带处数与中性标记', () => {
  const note = restoreNotice(2);
  assert.ok(note.includes('2 处'), note);
  assert.ok(note.includes(RESTORE_MARK), note);
  assert.ok(note.includes('没有还原'), note);
});

test('标记本身不是可还原的占位符', () => {
  assert.equal(/⟦ZX-/.test(RESTORE_MARK), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';

const { restoreNotice, exportNote, sumUnrestored, RESTORE_MARK } = await import('../src/privacy-warning.js');

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

test('导出正文附一句同样的说明，单段与会话口径不同', () => {
  assert.equal(exportNote(0), '');
  const single = exportNote(1);
  assert.ok(single.includes('本段'), single);
  assert.ok(single.includes(RESTORE_MARK), single);
  const whole = exportNote(3, { whole: true });
  assert.ok(whole.includes('本会话'), whole);
  assert.ok(whole.includes('3 处'), whole);
});

test('会话口径把各条回答的处数相加', () => {
  assert.equal(sumUnrestored([{ unrestored: 1 }, {}, { unrestored: 2 }]), 3);
  assert.equal(sumUnrestored([]), 0);
  assert.equal(sumUnrestored(undefined), 0);
  assert.equal(sumUnrestored([{ unrestored: '2' }]), 2);
});

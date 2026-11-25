import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FEEDBACK_CATEGORIES, FEEDBACK_NOTE_MAX_BYTES, categoryLabel, feedbackEntry, feedbackFor, feedbackLabel,
  mergeFeedback, noteBytes, removeFeedback, validateFeedback,
} from '../electron/message-feedback.mjs';

const base = { conversationId: 'c1', messageId: 'm1', rating: 'up', category: null, note: '' };

test('七个分类 id 与桌面版一致，标签是中文释义', () => {
  assert.deepEqual(FEEDBACK_CATEGORIES.map(item => item.id), [
    'task-result', 'instruction-following', 'product-interaction', 'service-stability',
    'resource-cost', 'security-privacy-permission', 'other',
  ]);
  assert.equal(categoryLabel('security-privacy-permission'), '安全隐私与权限');
  assert.equal(categoryLabel('nope'), '');
});

test('只接受赞与踩', () => {
  assert.equal(validateFeedback({ ...base, rating: 'good' }).code, 'rating-invalid');
  assert.equal(validateFeedback({ ...base, rating: null }).code, 'rating-invalid');
  assert.equal(validateFeedback(base).ok, true);
});

test('分类必须是固定表里的 id，空值表示不选', () => {
  assert.equal(validateFeedback({ ...base, category: 'too-slow' }).code, 'category-invalid');
  assert.equal(validateFeedback({ ...base, category: 'other' }).ok, true);
  assert.equal(validateFeedback({ ...base, category: null }).value.category, null);
});

test('备注：空白算无效，超过 8192 字节算过大，边界值通过', () => {
  assert.equal(validateFeedback({ ...base, note: '   ' }).code, 'note-blank');
  const exact = 'a'.repeat(FEEDBACK_NOTE_MAX_BYTES);
  assert.equal(noteBytes(exact), FEEDBACK_NOTE_MAX_BYTES);
  assert.equal(validateFeedback({ ...base, note: exact }).ok, true);
  assert.equal(validateFeedback({ ...base, note: 'a'.repeat(FEEDBACK_NOTE_MAX_BYTES + 1) }).code, 'note-too-large');
  // 中文按 UTF-8 三字节算，不是按字符数
  assert.equal(noteBytes('压'), 3);
  assert.equal(validateFeedback({ ...base, note: '压'.repeat(2731) }).code, 'note-too-large');
});

test('落盘条带时间戳；缺会话或消息 id 直接拒绝', () => {
  const entry = feedbackEntry({ ...base, note: ' 有用的备注 ' }, 1700000000000);
  assert.equal(entry.ok, true);
  assert.deepEqual(entry.value, {
    conversationId: 'c1', messageId: 'm1', rating: 'up', category: null, note: ' 有用的备注 ', updatedAt: 1700000000000,
  });
  assert.equal(feedbackEntry({ ...base, messageId: '' }).code, 'message-missing');
});

test('同一条消息后写覆盖先写，删除按消息定位', () => {
  const first = feedbackEntry({ ...base, rating: 'up' }, 1).value;
  const second = feedbackEntry({ ...base, rating: 'down', category: 'task-result' }, 2).value;
  const merged = mergeFeedback([first], second);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].rating, 'down');
  assert.equal(feedbackFor(merged, 'c1', 'm1').category, 'task-result');
  assert.deepEqual(removeFeedback(merged, 'c1', 'm1'), []);
});

test('摘要行只给赞/踩与分类，不摊备注', () => {
  assert.equal(feedbackLabel(null), '');
  assert.equal(feedbackLabel({ rating: 'up', category: null }), '赞');
  assert.equal(feedbackLabel({ rating: 'down', category: 'other', note: '一大段备注' }), '踩 · 其他');
});

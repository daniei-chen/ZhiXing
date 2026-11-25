import assert from 'node:assert/strict';
import test from 'node:test';
import {reviewCounts, reviewEmptyCopy, reviewFileLabel, reviewRowType, reviewSkipCopy, reviewTitle} from '../src/review-view.js';

test('标题带文件数，没有改动时不留数字', () => {
  assert.equal(reviewTitle([{}, {}]), '本轮改动 2 个文件');
  assert.equal(reviewTitle([]), '本轮改动');
  assert.equal(reviewTitle(undefined), '本轮改动');
});

test('文件行优先用工作区相对名', () => {
  assert.equal(reviewFileLabel({ path: 'C:\\工作区\\a.md', display: 'a.md' }), 'a.md');
  assert.equal(reviewFileLabel({ path: 'C:\\工作区\\a.md' }), 'C:\\工作区\\a.md');
  assert.equal(reviewFileLabel({}), '未命名文件');
});

test('行数带正负号，估算时写「约」', () => {
  assert.equal(reviewCounts({ added: 3, deleted: 1 }), '+3 −1');
  assert.equal(reviewCounts({ added: 0, deleted: 4 }), '+0 −4');
  assert.equal(reviewCounts({ added: 5, deleted: 0, estimated: true }), '约 +5 −0');
});

test('对比行只认四种类型，其余按普通行处理', () => {
  assert.deepEqual(['add', 'remove', 'context', 'gap'].map(type => reviewRowType({ type })), ['add', 'remove', 'context', 'gap']);
  assert.equal(reviewRowType({ type: 'weird' }), 'context');
  assert.equal(reviewRowType(undefined), 'context');
});

test('空态与跳过文案只在对应情况下出现', () => {
  assert.equal(reviewEmptyCopy([]), '本轮没有可以对比的改动。');
  assert.equal(reviewEmptyCopy([{}]), '');
  assert.equal(reviewSkipCopy({ skipped: true }).includes('太大'), true);
  assert.equal(reviewSkipCopy({}), '');
});

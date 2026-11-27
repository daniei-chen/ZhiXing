import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITLE_MAX_BYTES,
  cleanTitleText,
  fallbackTitle,
  truncateTitleBytes,
} from '../src/session-title.js';

test('标题清掉终端控制序列与方向控制符', () => {
  assert.equal(cleanTitleText('\u001B[31m整理纪要\u001B[0m'), '整理纪要');
  assert.equal(cleanTitleText('\u001B]0;窗口标题\u0007核对表格'), '核对表格');
  assert.equal(cleanTitleText('汇总\u202E报告'), '汇总报告');
  assert.equal(cleanTitleText('第一行\n\n第二行\t第三行'), '第一行 第二行 第三行');
  assert.equal(cleanTitleText('  '), '');
  assert.equal(cleanTitleText(undefined), '');
});

test('标题按 UTF-8 字节截断且不切断码点', () => {
  assert.equal(truncateTitleBytes('汉字标题', 6), '汉字');
  assert.equal(truncateTitleBytes('汉字标题', 7), '汉字');
  assert.equal(truncateTitleBytes('abc', 3), 'abc');
  // 4 字节 emoji 不能被截成半个码点。
  const emoji = '😀😀';
  const cut = truncateTitleBytes(emoji, 6);
  assert.equal(cut, '😀');
  assert.equal(new TextEncoder().encode(cut).length <= 6, true);
  assert.throws(() => truncateTitleBytes('x', 0), /字节上限/);
});

test('默认标题在字节上限内补省略号，未超长时不改写', () => {
  assert.equal(fallbackTitle('核对季度报表'), '核对季度报表');
  const long = '一'.repeat(60);
  const title = fallbackTitle(long);
  assert.equal(title.endsWith('…'), true);
  assert.equal(new TextEncoder().encode(title).length <= TITLE_MAX_BYTES + 3, true);
  assert.equal(title.startsWith('一'.repeat(39)), true);
});

test('标题清掉控制符之后才判断是否为空', () => {
  assert.equal(fallbackTitle('\u001B[2J\u202E\u0007'), '');
  assert.equal(fallbackTitle('  核对  '), '核对');
});

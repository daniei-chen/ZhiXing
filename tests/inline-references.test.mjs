import assert from 'node:assert/strict';
import test from 'node:test';
import {baseName, looksLikePath, referenceTitle, resolveReference} from '../src/inline-references.js';

const files = [
  { path: '成果\\季度汇总.docx', description: '第三季度经营汇总' },
  { path: '成果\\明细.xlsx' },
  { path: '归档\\明细.xlsx' },
];

test('basename 取路径末段', () => {
  assert.equal(baseName(files[0]), '季度汇总.docx');
  assert.equal(baseName({}), '');
  assert.equal(baseName({ path: 'a/b/c.pdf' }), 'c.pdf');
});

test('辨认像路径的 token', () => {
  assert.equal(looksLikePath('成果\\a.docx'), true);
  assert.equal(looksLikePath('D:/x/y.docx'), true);
  assert.equal(looksLikePath('a.docx'), false);
});

test('唯一 basename 可解析，斜杠方向与大小写不敏感', () => {
  assert.equal(resolveReference('季度汇总.docx', files)?.path, '成果\\季度汇总.docx');
  assert.equal(resolveReference('  季度汇总.DOCX  ', files)?.path, '成果\\季度汇总.docx');
});

test('有歧义的 basename 保持不可点击', () => {
  assert.equal(resolveReference('明细.xlsx', files), null);
});

test('精确路径可解析，且必须是唯一匹配', () => {
  assert.equal(resolveReference('成果/季度汇总.docx', files)?.path, '成果\\季度汇总.docx');
  assert.equal(resolveReference('成果\\明细.xlsx', files)?.path, '成果\\明细.xlsx');
  assert.equal(resolveReference('不存在\\季度汇总.docx', files), null);
});

test('不做后缀或当前目录猜测', () => {
  assert.equal(resolveReference('度汇总.docx', files), null);
  assert.equal(resolveReference('成果/季度汇总', files), null);
  assert.equal(resolveReference('', files), null);
  assert.equal(resolveReference('季度汇总.docx', []), null);
});

test('title 用完整路径', () => {
  assert.equal(referenceTitle(files[0]), '成果\\季度汇总.docx');
});

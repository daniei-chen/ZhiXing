import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTrace, matchesLabel, matchesTrace, normalizeQuery, traceSearchSummary } from '../src/trace-filter.js';

const rows = [
  { label: '调用 · 更新工作计划', status: 'running', category: 'tools' },
  { label: '更新工作计划 · 完成', status: 'completed', category: 'tools' },
  { label: '网页搜索 · 完成', status: 'completed', category: 'tools' },
  { label: '子任务已启动', status: 'completed', category: 'agents' },
];

test('空查询原样返回全部行', () => {
  assert.equal(filterTrace(rows, '').length, 4);
  assert.equal(filterTrace(rows, '   ').length, 4);
  assert.deepEqual(filterTrace(null, 'x'), []);
});

test('按标签子串匹配且不改变顺序', () => {
  assert.deepEqual(filterTrace(rows, '工作计划').map(row => row.label), ['调用 · 更新工作计划', '更新工作计划 · 完成']);
  assert.deepEqual(filterTrace(rows, '网页').map(row => row.label), ['网页搜索 · 完成']);
});

test('大小写与首尾空格不影响匹配', () => {
  assert.equal(normalizeQuery('  WORK  '), 'work');
  assert.equal(filterTrace([{ label: 'WEB Fetch · 完成' }], 'web fetch').length, 1);
  assert.equal(matchesTrace({ label: '网页搜索 · 完成' }, ' 网页 '), true);
});

test('状态与分类也参与检索', () => {
  assert.equal(filterTrace(rows, 'agents').length, 1);
  assert.equal(filterTrace(rows, 'completed').length, 3);
});

test('子任务行按展示名检索', () => {
  assert.equal(matchesLabel('子任务 2 · 已中断', '子任务 2'), true);
  assert.equal(matchesLabel('作业 1', '子任务'), false);
  assert.equal(matchesLabel('作业 1', ''), true);
});

test('摘要行说明匹配数量或没有匹配', () => {
  assert.equal(traceSearchSummary('', 2, 4), '');
  assert.equal(traceSearchSummary('网页', 1, 4), '匹配 1 / 4 条');
  assert.equal(traceSearchSummary(' 不存在 ', 0, 4), '没有匹配「不存在」的记录');
});

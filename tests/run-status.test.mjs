import test from 'node:test';
import assert from 'node:assert/strict';

const { runStatusLabel, toolTimeline, liveToolCalls, IDLE_LABEL } = await import('../src/run-status.js');

const run = 'run-1';

test('没有事件时显示「思考中」，不显示内核阶段名', () => {
  assert.equal(runStatusLabel([], run), '思考中');
  assert.equal(IDLE_LABEL, '思考中');
});

test('忽略其它运行与空标签', () => {
  assert.equal(runStatusLabel([{ runId: 'other', label: '内核启动中' }], run), '思考中');
  assert.equal(runStatusLabel([{ runId: run, label: '   ' }], run), '思考中');
});

test('有工具在跑时显示工具动作，而不是阶段名', () => {
  const events = [
    { runId: run, category: 'reasoning', label: '内核启动中', sequence: 1 },
    { runId: run, category: 'tools', label: '调用 · 网页搜索', sequence: 2 },
  ];
  assert.equal(runStatusLabel(events, run), '正在网页搜索');
});

test('工具已经出结果时回到「思考中」', () => {
  const events = [
    { runId: run, category: 'tools', label: '调用 · 网页搜索', sequence: 1 },
    { runId: run, category: 'tools', label: '网页搜索 · 完成', sequence: 2, status: 'completed' },
  ];
  assert.equal(runStatusLabel(events, run), '思考中');
});

test('只有推理事件时回到「思考中」', () => {
  const events = [{ runId: run, category: 'reasoning', label: '内核启动中' }];
  assert.equal(runStatusLabel(events, run), '思考中');
});

test('工具时间线包含调用与结果，按顺序，只取最近几条', () => {
  const trace = [
    { category: 'tools', label: '调用 · 网页搜索', sequence: 1, status: 'running' },
    { category: 'reasoning', label: '思考', sequence: 2 },
    { category: 'tools', label: '网页搜索 · 完成', sequence: 3, status: 'completed', durationMs: 1200 },
    { category: 'tools', label: '调用 · 读取网页', sequence: 4, status: 'running' },
    { category: 'tools', label: '读取网页 · 失败', sequence: 5, status: 'failed' },
  ];
  const rows = toolTimeline(trace);
  assert.deepEqual(rows.map(row => row.label), ['调用 · 网页搜索', '网页搜索 · 完成', '调用 · 读取网页', '读取网页 · 失败']);
  assert.equal(rows[1].durationMs, 1200);
  assert.equal(rows[1].status, 'completed');
  assert.equal(toolTimeline(trace, 2).length, 2);
  assert.equal(toolTimeline(trace, 2)[1].label, '读取网页 · 失败');
});

test('liveToolCalls 只看当前运行', () => {
  const events = [
    { runId: run, category: 'tools', label: '调用 · 网页搜索', sequence: 1 },
    { runId: 'other', category: 'tools', label: '调用 · 别的运行', sequence: 2 },
  ];
  assert.deepEqual(liveToolCalls(events, run).map(item => item.label), ['调用 · 网页搜索']);
});

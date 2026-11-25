import test from 'node:test';
import assert from 'node:assert/strict';

const { runStatusLabel, liveToolCalls, IDLE_LABEL } = await import('../src/run-status.js');

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

test('只有推理事件时回到「思考中」', () => {
  const events = [{ runId: run, category: 'reasoning', label: '内核启动中' }];
  assert.equal(runStatusLabel(events, run), '思考中');
});

test('工具提示保留最近几条，按顺序', () => {
  const events = [
    { runId: run, category: 'tools', label: '调用 · 网页搜索', sequence: 1 },
    { runId: run, category: 'reasoning', label: '思考', sequence: 2 },
    { runId: run, category: 'tools', label: '调用 · 读取网页', sequence: 3 },
    { runId: 'other', category: 'tools', label: '调用 · 别的运行', sequence: 4 },
  ];
  assert.deepEqual(liveToolCalls(events, run).map(item => item.label), ['调用 · 网页搜索', '调用 · 读取网页']);
  const many = Array.from({ length: 6 }, (_, index) => ({ runId: run, category: 'tools', label: `调用 · 工具${index}`, sequence: index }));
  assert.deepEqual(liveToolCalls(many, run, 2).map(item => item.label), ['调用 · 工具4', '调用 · 工具5']);
});

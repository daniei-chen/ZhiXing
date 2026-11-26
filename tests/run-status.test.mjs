import test from 'node:test';
import assert from 'node:assert/strict';

const { runStatusLabel, toolTimeline, toolTimelineSummary, liveToolCalls, IDLE_LABEL } = await import('../src/run-status.js');
const { projectExecutionEvent } = await import('../electron/execution-events.mjs');

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

test('旧工具轨迹不凭相同标签猜配，也不把结果再次计成调用', () => {
  const trace = [
    { category: 'tools', label: '调用 · 网页搜索', sequence: 1, status: 'running' },
    { category: 'reasoning', label: '思考', sequence: 2 },
    { category: 'tools', label: '网页搜索 · 完成', sequence: 3, status: 'completed', durationMs: 1200 },
    { category: 'tools', label: '调用 · 读取网页', sequence: 4, status: 'running' },
    { category: 'tools', label: '读取网页 · 失败', sequence: 5, status: 'failed' },
  ];
  const rows = toolTimeline(trace);
  assert.deepEqual(rows.map(row => row.label), ['调用 · 网页搜索', '网页搜索 · 完成（关联未记录）', '调用 · 读取网页', '读取网页 · 失败（关联未记录）']);
  assert.equal(rows[1].durationMs, 1200);
  assert.equal(rows[1].status, 'completed');
  assert.equal(toolTimelineSummary(rows), '2 次工具调用 · 2 条历史结果未关联');
  assert.equal(toolTimeline(trace, 2).length, 2);
  assert.equal(toolTimeline(trace, 2)[1].label, '读取网页 · 失败（关联未记录）');
  assert.deepEqual(toolTimeline(trace, 0), []);
});

function nativeCall(calls, { id = 'tool-one', seq = 1, time = 100, child, turn = 1, step = 1, name = 'write' } = {}) {
  return projectExecutionEvent({ type: 'tool/call', seq, time, data: {
    turn, step, callId: id, name, arguments: '{"file_path":"private-path","content":"private-content"}',
  } }, child, calls);
}

function nativeResult(calls, { id = 'tool-one', seq = 2, time = 300, source = 1, child, turn = 1, step = 1, isError = false, meta } = {}) {
  return projectExecutionEvent({ type: 'tool/result', seq, time, sourceEventSeqs: source == null ? undefined : [source], data: {
    turn, step, message: { toolCallId: id, isError, content: [{ type: 'text', text: 'private-result' }] },
    error: isError ? { code: 'PRIVATE_CODE', reason: 'private-error' } : undefined,
    meta,
  } }, child, calls);
}

test('真实内核事件字段把一次 call/result 合并，保留最终状态与耗时', () => {
  const calls = new Map();
  const call = nativeCall(calls);
  const result = nativeResult(calls);
  assert.equal(call.callId, result.callId);
  const rows = toolTimeline([call, result]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, '写入项目文本 · 完成');
  assert.equal(rows[0].status, 'completed');
  assert.equal(rows[0].durationMs, 200);
  assert.equal(rows[0].time, 100);
  assert.equal(toolTimelineSummary(rows), '1 次工具调用');
});

test('并行子会话、主会话和不同运行即使 provider call id 相同也互不串配', () => {
  const calls = new Map();
  const a = nativeCall(calls, { child: 'root', time: 110 });
  const b = nativeCall(calls, { child: 'child-b', time: 120 });
  const main = nativeCall(calls, { time: 100 });
  const trace = [a, b, main,
    nativeResult(calls, { child: 'child-b', time: 500, isError: true }),
    nativeResult(calls, { time: 300 }),
    nativeResult(calls, { child: 'root', time: 710 }),
  ];
  const rows = toolTimeline(trace);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.key)).size, 3);
  assert.deepEqual(rows.map(row => [row.status, row.durationMs]), [['completed', 600], ['failed', 380], ['completed', 200]]);
  assert.equal(toolTimeline([...trace.map(event => ({ ...event, runId: 'one' })),
    ...trace.map(event => ({ ...event, runId: 'two' }))]).length, 6);
});

test('并行调用乱序完成时不把尚未完成的工具状态隐藏成思考中', () => {
  const calls = new Map();
  const events = [
    nativeCall(calls, { id: 'read', name: 'read', seq: 1 }),
    nativeCall(calls, { id: 'write', name: 'write', seq: 2 }),
    nativeResult(calls, { id: 'write', seq: 3, source: 2 }),
  ].map(event => ({ ...event, runId: run }));
  assert.equal(runStatusLabel(events, run), '正在读取项目文本');
  events.push({ ...nativeResult(calls, { id: 'read', seq: 4 }), runId: run });
  assert.equal(runStatusLabel(events, run), '思考中');
});

test('没有工具名称的完成事件也会结束运行文案，但不隐藏另一已关联的运行中调用', () => {
  const calls = new Map();
  const completed = [
    nativeCall(calls, { id: 'provider:call/one', seq: 1 }),
    nativeResult(calls, { id: 'provider:call/one', seq: 2, source: 1 }),
  ].map(event => ({ ...event, runId: run }));
  assert.equal(completed[1].label, '工具完成');
  assert.equal(toolTimeline(completed)[0].status, 'completed');
  assert.equal(runStatusLabel(completed, run), '思考中');
  const running = { ...nativeCall(calls, { id: 'still-reading', name: 'read', seq: 3 }), runId: run };
  assert.equal(runStatusLabel([running, ...completed], run), '正在读取项目文本');
});

test('同一工具重复事件不多计，不同步骤重用 provider call id 仍是两次调用', () => {
  const calls = new Map();
  const first = nativeCall(calls);
  const firstResult = nativeResult(calls);
  const next = nativeCall(calls, { seq: 3, step: 2, time: 400 });
  const nextResult = nativeResult(calls, { seq: 4, source: 3, step: 2, time: 900 });
  const rows = toolTimeline([first, first, firstResult, firstResult, next, nextResult]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.durationMs), [200, 500]);
});

test('默认保留全部已保存调用，显式显示截断证据范围', () => {
  const calls = new Map();
  const trace = Array.from({ length: 12 }, (_, index) => [
    nativeCall(calls, { seq: index * 2 + 1, id: `tool-${index}` }),
    nativeResult(calls, { seq: index * 2 + 2, source: index * 2 + 1, id: `tool-${index}` }),
  ]).flat();
  assert.equal(toolTimeline(trace).length, 12);
  assert.equal(toolTimelineSummary(toolTimeline(trace)), '12 次工具调用');
  assert.equal(toolTimeline(trace, 3).length, 3);
  const retained = toolTimeline(trace.slice(7));
  assert.equal(retained.length, 9);
  assert.equal(toolTimelineSummary(retained, { truncated: true }), '已保留 9 次工具调用');
});

test('无关联信息的历史结果不虚构调用次数，空输入不会崩溃', () => {
  const rows = toolTimeline([{ type: 'tool/result', category: 'tools', label: '写入项目文本 · 完成' }]);
  assert.equal(toolTimelineSummary(rows), '1 条工具记录（调用次数未记录）');
  assert.equal(toolTimelineSummary(rows, { truncated: true }), '已保留 1 条工具记录（调用次数未记录）');
  assert.deepEqual(toolTimeline(null), []);
  assert.deepEqual(toolTimeline({}), []);
  assert.equal(toolTimelineSummary([]), '没有调用工具');
});

test('投影只增加不透明关联坐标，不带出模型 id、参数、路径、结果或错误正文', () => {
  const calls = new Map();
  const call = nativeCall(calls, { id: '13800000000' });
  const result = nativeResult(calls, { id: '13800000000', isError: true });
  const projected = JSON.stringify([call, result]);
  for (const value of ['13800000000', 'private-path', 'private-content', 'private-result', 'private-error', 'PRIVATE_CODE']) {
    assert.ok(!projected.includes(value), projected);
  }
  assert.equal(toolTimeline([call, result])[0].status, 'failed');
});

test('缺少序号时也用不透明关联 id；内核停止 patch 保持未完成状态', () => {
  const calls = new Map();
  const call = nativeCall(calls, { seq: null, name: 'apply_patch' });
  const result = nativeResult(calls, { seq: null, source: null, meta: { stopped: true } });
  assert.match(call.callId, /^live-/);
  assert.equal(call.callId, result.callId);
  const rows = toolTimeline([call, result]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'interrupted');
  assert.equal(rows[0].label, '应用项目文件补丁 · 未完成');
});

test('liveToolCalls 只看当前运行', () => {
  const events = [
    { runId: run, category: 'tools', label: '调用 · 网页搜索', sequence: 1 },
    { runId: 'other', category: 'tools', label: '调用 · 别的运行', sequence: 2 },
  ];
  assert.deepEqual(liveToolCalls(events, run).map(item => item.label), ['调用 · 网页搜索']);
});

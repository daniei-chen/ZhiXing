import test from 'node:test';
import assert from 'node:assert/strict';

const { runSummary, summaryRows, durationText } = await import('../src/run-summary.js');

const trace = [
  { type: 'run/started', time: 1000 },
  { type: 'tool/call', time: 2000 },
  { type: 'tool/result', time: 2200 },
  { type: 'run/terminal', time: 81000, status: 'completed' },
];

test('耗时按秒与分秒展示，未记录时为空', () => {
  assert.equal(durationText(1000, 81000), '1 分 20 秒');
  assert.equal(durationText(0, 500), '不到 1 秒');
  assert.equal(durationText(0, 125000), '2 分 5 秒');
  assert.equal(durationText(undefined, 1000), '');
  assert.equal(durationText(2000, 1000), '');
});

test('完成的一轮汇总状态、耗时、工具与子任务', () => {
  const summary = runSummary({
    status: 'succeeded', startedAt: 1000, trace,
    children: [{ id: 'a' }, { id: 'b' }], deliverables: [{ name: 'x.docx' }],
  });
  assert.equal(summary.statusLabel, '已完成');
  assert.equal(summary.duration, '1 分 20 秒');
  assert.equal(summary.tools, 2);
  assert.equal(summary.children, 2);
  assert.equal(summary.deliverables, 1);
  assert.equal(summary.unrestored, 0);
  assert.equal(summary.restoreNote, null);
});

test('失败与取消各有自己的文案，错误码原样带出', () => {
  assert.equal(runSummary({ status: 'failed' }).statusLabel, '未完成');
  assert.equal(runSummary({ status: 'cancelled' }).statusLabel, '已取消');
  const summary = runSummary({ status: 'failed', errorDetail: { code: 'HTTP_401' } });
  assert.equal(summary.errorCode, 'HTTP_401');
});

test('运行中的一轮不把 updatedAt 当结束时间', () => {
  const summary = runSummary({ pending: true, startedAt: 1000, updatedAt: 5000, trace: [] });
  assert.equal(summary.statusLabel, '进行中');
  assert.equal(summary.duration, '');
});

test('有无法归属的占位符时详情里也要写明处数', () => {
  const summary = runSummary({ status: 'succeeded', startedAt: 0, unrestored: 2, trace });
  assert.equal(summary.unrestored, 2);
  assert.ok(summary.restoreNote.includes('2 处'), summary.restoreNote);
  const rows = summaryRows({ status: 'succeeded', startedAt: 0, unrestored: 2, trace });
  const row = rows.find(item => item.key === 'restore');
  assert.ok(row && row.value.includes('2 处'), JSON.stringify(rows));
});

test('没有工具、子任务、产出时不显示空的产出行', () => {
  const rows = summaryRows({ status: 'succeeded', startedAt: 0, trace: [{ type: 'run/terminal', time: 10 }] });
  const keys = rows.map(item => item.key);
  assert.deepEqual(keys, ['status', 'duration', 'tools', 'children']);
  assert.equal(rows.find(item => item.key === 'tools').value, '没有调用工具');
  assert.equal(rows.find(item => item.key === 'duration').value, '不到 1 秒');
});

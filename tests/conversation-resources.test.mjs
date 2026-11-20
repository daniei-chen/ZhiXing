import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateConversationResources } from '../src/conversation-resources.js';
import { projectExecutionEvent } from '../electron/execution-events.mjs';

test('空会话与不完整历史返回空集合，正文里的链接不成为来源', () => {
  const empty = { deliverables: [], sources: [], agents: [], jobs: [] };
  assert.deepEqual(aggregateConversationResources(), empty);
  assert.deepEqual(aggregateConversationResources(null, null), empty);
  assert.deepEqual(aggregateConversationResources([
    null,
    { role: 'assistant', text: 'https://example.com/unvisited', importedThinking: 'https://example.com/private' },
    { deliverables: [null, { path: '' }], files: 'not an array', children: [null, {}], trace: [null, { type: 3 }] },
  ]), empty);
});

test('产出按完整路径聚合，Windows 路径去重后保留最新文件引用', () => {
  const previous = { path: 'D:\\成果\\日报.docx', description: '初稿' };
  const current = { path: 'd:/成果/日报.docx', description: '终稿' };
  const other = { path: 'D:\\另一个项目\\日报.docx' };
  const result = aggregateConversationResources([
    { id: 'one', deliverables: [previous, other, { path: '/work/A.txt' }] },
    { id: 'two', deliverables: [current, { path: '/work/a.txt' }] },
  ]);
  assert.equal(result.deliverables.length, 4);
  assert.equal(result.deliverables[0].file.path, '/work/a.txt');
  assert.equal(result.deliverables[1].file, current);
  assert.equal(result.deliverables[1].name, '日报.docx');
  assert.equal(result.deliverables[1].messageId, 'two');
  assert(result.deliverables.some(row => row.file === other));
});

test('用户附件区分可打开内容与仅有名称大小的历史记录', () => {
  const result = aggregateConversationResources([
    { role: 'user', id: 'first', files: [
      { name: '材料.txt', size: 100 },
      { id: 'text', name: '已读取.txt', text: '合成资料', status: 'ready' },
      { name: '遗失.txt', path: 'D:\\已丢失.txt', unavailable: true },
      { name: '图片.webp', image: { format: 'image/webp', data: 'synthetic' } },
    ] },
    { role: 'user', id: 'second', files: [{ name: '材料.txt', size: 100 }] },
    { role: 'assistant', files: [{ name: '不属于用户附件.txt' }] },
  ]);
  assert.equal(result.sources.length, 5);
  assert.equal(result.sources.filter(row => row.name === '材料.txt').length, 2);
  assert.equal(result.sources.find(row => row.name === '遗失.txt').recordOnly, true);
  assert.equal(result.sources.find(row => row.name === '材料.txt').canOpen, true);
  assert.equal(result.sources.find(row => row.name === '材料.txt').recordOnly, true);
  assert.equal(result.sources.find(row => row.name === '已读取.txt').canOpen, true);
  assert.equal(result.sources.find(row => row.name === '已读取.txt').recordOnly, false);
  assert.equal(result.sources.find(row => row.name === '图片.webp').canOpen, true);
  assert.match(result.sources.find(row => row.name === '材料.txt').description, /附件记录/);
});

test('网页来源只使用明确的 sourceUrl 和 importedTools.url，保留原附件引用', () => {
  const file = { name: '已加入的网页', sourceUrl: 'https://EXAMPLE.com:443/report', text: '资料正文' };
  const result = aggregateConversationResources([
    { id: 'user', role: 'user', files: [file] },
    { id: 'imported', importedTools: [
      { name: 'web_fetch', url: 'https://example.com/report' },
      { name: 'web_search', detail: 'https://example.com/summary-only' },
      { name: 'other_tool', url: 'https://example.com/not-a-web-tool' },
      { name: 'web_fetch', url: 'https://example.com/failed', failed: true },
      { name: 'web_fetch', url: 'https://example.com/failed' },
    ] },
  ]);
  assert.equal(result.sources.length, 2);
  const source = result.sources.find(row => row.url === 'https://example.com/report');
  assert.equal(source.kind, 'web');
  assert.equal(source.file, file);
  assert.equal(source.messageId, 'imported');
  assert.equal(result.sources.find(row => row.url.endsWith('/failed')).status, 'failed');
});

test('来源拒绝凭据地址和非网页协议，不从工具 detail 或参数正文提取链接', () => {
  const result = aggregateConversationResources([{ importedTools: [
    ...['javascript:alert(1)', 'file:///D:/secret', 'data:text/html,secret', 'https://user:secret@example.com'].map(url => ({ name: 'web_fetch', url })),
    { name: 'web_search', detail: '已找到 https://example.com/in-text', arguments: { url: 'https://example.com/argument' } },
  ] }]);
  assert.deepEqual(result.sources, []);
});

test('实际执行投影中的搜索摘要跳执行，调用和结果不会变成两个网页来源', () => {
  const calls = new Map();
  const call = projectExecutionEvent({ type: 'tool/call', time: 1, seq: 1, data: {
    callId: 'search', name: 'web_search', arguments: { queries: ['https://example.com/not-visited'] },
  } }, undefined, calls);
  const result = projectExecutionEvent({ type: 'tool/result', time: 2, seq: 2, data: {
    message: { toolCallId: 'search', content: [{ type: 'text', text: 'https://example.com/not-recorded' }] },
  } }, undefined, calls);
  const resources = aggregateConversationResources([{ runId: 'run', trace: [call, result] }], [
    { ...call, runId: 'run' }, { ...result, runId: 'run' },
    { type: 'status', label: 'https://example.com/label-only' },
  ]);
  assert.equal(resources.sources.length, 1);
  assert.equal(resources.sources[0].kind, 'activity');
  assert.equal(resources.sources[0].url, undefined);
  assert.equal(resources.sources[0].status, 'completed');
  assert.equal(resources.sources[0].event.label, '网页搜索 · 完成');
});

test('搜索或读取轨迹含明确网页字段时才提供可打开来源', () => {
  const resources = aggregateConversationResources([], [
    { type: 'tool/result', category: 'tools', label: '读取网页 · 完成', url: 'https://example.com/source', title: '实际记录的地址', runId: 'one' },
    { type: 'tool/result', category: 'tools', label: '网页搜索 · 失败', runId: 'two' },
    { type: 'tool/call', category: 'tools', label: '调用 · 数字计算', url: 'https://example.com/irrelevant' },
    { type: 'tool/result', toolName: 'web_fetch', url: 'https://example.com/source', runId: 'one' },
  ]);
  assert.equal(resources.sources.length, 2);
  assert.equal(resources.sources.find(row => row.kind === 'web').name, '实际记录的地址');
  assert.equal(resources.sources.find(row => row.kind === 'activity').status, 'failed');
});

test('子任务及作业来自真实标识，历史与 liveTrace 重叠不重复计数，作业按运行和子会话隔离', () => {
  const trace = [
    { type: 'subagents', runId: 'run-one', childSessionId: 'child-one', children: [{ id: 'child-one', status: 'running' }] },
    { type: 'subagents', runId: 'run-one', childSessionId: 'child-two' },
    { type: 'job/registered', category: 'jobs', runId: 'run-one', itemId: 'job', status: 'running' },
    { type: 'job/settled', category: 'jobs', runId: 'run-one', itemId: 'job', status: 'completed' },
    { type: 'job/registered', category: 'jobs', runId: 'run-one', childSessionId: 'child-one', itemId: 'job' },
    { type: 'tool/call', category: 'tools', label: '调用 · 委派子任务' },
  ];
  const resources = aggregateConversationResources([
    { runId: 'run-one', trace, children: [{ id: 'child-one', status: 'completed' }, { id: 'child-two' }] },
    { runId: 'run-two', trace: [{ type: 'job/registered', category: 'jobs', itemId: 'job' }] },
  ], [trace[3], { type: 'job/stop-requested', runId: 'run-one', childSessionId: 'child-one', itemId: 'job', status: 'stopping' }]);
  assert.equal(resources.agents.length, 2);
  assert.equal(resources.agents.find(row => row.id === 'child-one').status, 'completed');
  assert.equal(resources.jobs.length, 3);
  assert.equal(resources.jobs.find(row => row.id === 'run-one:root:job').status, 'completed');
  assert.equal(resources.jobs.find(row => row.id === 'run-one:child-one:job').status, 'stopping');
});

test('聚合不更改消息、文件或轨迹数据', () => {
  const file = Object.freeze({ path: 'D:\\资料\\成果.docx' });
  const child = Object.freeze({ id: 'child' });
  const event = Object.freeze({ type: 'job/registered', itemId: 'job' });
  const message = Object.freeze({
    role: 'assistant', deliverables: Object.freeze([file]), children: Object.freeze([child]), trace: Object.freeze([event]),
  });
  const messages = Object.freeze([message]);
  const before = structuredClone(messages);
  const result = aggregateConversationResources(messages, Object.freeze([event]));
  assert.equal(result.deliverables[0].file, file);
  assert.deepEqual(messages, before);
});

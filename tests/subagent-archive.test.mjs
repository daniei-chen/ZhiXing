import test from 'node:test';
import assert from 'node:assert/strict';

const { archiveMarkdown } = await import('../src/subagent-archive.js');

const child = {
  id: 'child-1',
  status: 'finished',
  startedAt: new Date('2026-11-25T09:00:00').getTime(),
  finishedAt: new Date('2026-11-25T09:03:00').getTime(),
  messages: [
    { role: 'user', text: '把上周的销售表汇总成一段结论。' },
    { role: 'assistant', text: '华东增长 12%，华南持平。' },
  ],
};

test('归档包含会话、编号、状态、时间与正文', () => {
  const text = archiveMarkdown({ title: '周报整理', child, index: 2, generatedAt: new Date('2026-11-25T10:00:00').getTime() });
  assert.match(text, /^# 子会话归档 · 子任务 2/m);
  assert.match(text, /- 所属会话：周报整理/);
  assert.match(text, /- 状态：finished/);
  assert.match(text, /- 消息：2 条/);
  assert.match(text, /## 交办输入\n\n把上周的销售表汇总成一段结论。/);
  assert.match(text, /## 子任务\n\n华东增长 12%，华南持平。/);
  assert.ok(text.endsWith('\n'));
});

test('截断的消息在归档里标注清楚，不冒充完整内容', () => {
  const text = archiveMarkdown({ title: '长文', child: { ...child, messages: [{ role: 'assistant', text: '前半段…', truncated: true }] }, index: 1 });
  assert.match(text, /## 子任务（原始内容过长，归档里是界面显示的部分）/);
  assert.doesNotMatch(text, /完整/);
});

test('没有消息、没有子会话时拒绝归档', () => {
  assert.throws(() => archiveMarkdown({ title: 'x', child: { ...child, messages: [] } }), /还没有可归档的对话/);
  assert.throws(() => archiveMarkdown({ title: 'x' }), /没有可归档的子会话/);
});

test('空消息占位而不是留下空标题', () => {
  const text = archiveMarkdown({ title: 'x', child: { ...child, messages: [{ role: 'user', text: '   ' }] }, index: 1 });
  assert.match(text, /## 交办输入\n\n（空消息）/);
});

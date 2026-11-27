import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUEUE_LIMIT,
  enqueueMessage,
  nextQueued,
  patchQueued,
  queuePreview,
  queuedFor,
  removeQueued,
} from '../src/message-queue.js';

const item = (id, chatId = 'chat-a', extra = {}) => ({
  id,
  chatId,
  workspaceId: 'office-home',
  text: `消息 ${id}`,
  files: [],
  ...extra,
});

test('排队按聊天隔离，并保持提交顺序', () => {
  let queue = [];
  for (const id of ['m1', 'm2']) queue = enqueueMessage(queue, item(id)).queue;
  queue = enqueueMessage(queue, item('n1', 'chat-b')).queue;
  assert.deepEqual(
    queue.map((row) => row.id),
    ['m1', 'm2', 'n1'],
  );
  assert.deepEqual(
    queuedFor(queue, 'chat-a').map((row) => row.id),
    ['m1', 'm2'],
  );
  assert.deepEqual(
    queuedFor(queue, 'chat-b').map((row) => row.id),
    ['n1'],
  );
});

test('没有正文或附件时不入队', () => {
  const result = enqueueMessage([], {
    id: 'm1',
    chatId: 'chat-a',
    workspaceId: 'office-home',
    text: '   ',
    files: [],
  });
  assert.equal(result.queue.length, 0);
  assert.match(result.error, /不能为空/);
});

test('附件消息可以只有附件', () => {
  const result = enqueueMessage([], item('m1', 'chat-a', { text: '', files: [{ id: 'f1' }] }));
  assert.equal(result.error, '');
  assert.equal(result.queue.length, 1);
});

test('同一聊天有排队上限', () => {
  let queue = [];
  for (let index = 0; index < QUEUE_LIMIT; index++)
    queue = enqueueMessage(queue, item(`m${index}`)).queue;
  const result = enqueueMessage(queue, item('overflow'));
  assert.equal(result.queue.length, QUEUE_LIMIT);
  assert.match(result.error, new RegExp(String(QUEUE_LIMIT)));
  assert.equal(enqueueMessage(queue, item('other', 'chat-b')).error, '');
});

test('队头发送中或失败时不再下发后续消息', () => {
  const queue = [item('m1'), item('m2')];
  assert.deepEqual(nextQueued(queue, { chatId: 'chat-a', workspaceId: 'office-home' }), queue[0]);
  assert.equal(
    nextQueued(patchQueued(queue, 'm1', { sending: true }), {
      chatId: 'chat-a',
      workspaceId: 'office-home',
    }),
    null,
  );
  assert.equal(
    nextQueued(patchQueued(queue, 'm1', { error: '供应商已变更' }), {
      chatId: 'chat-a',
      workspaceId: 'office-home',
    }),
    null,
  );
});

test('切换到其他空间后不下发原空间的消息', () => {
  const queue = [item('m1')];
  assert.equal(nextQueued(queue, { chatId: 'chat-a', workspaceId: 'government-home' }), null);
});

test('重试会清掉错误并让队头重新可发送', () => {
  const failed = patchQueued([item('m1')], 'm1', { error: '网络未连接' });
  assert.equal(nextQueued(failed, { chatId: 'chat-a', workspaceId: 'office-home' }), null);
  const retried = patchQueued(failed, 'm1', { error: '', sending: false });
  assert.equal(nextQueued(retried, { chatId: 'chat-a', workspaceId: 'office-home' })?.id, 'm1');
});

test('删除只影响目标消息', () => {
  const queue = [item('m1'), item('m2')];
  assert.deepEqual(
    removeQueued(queue, 'm1').map((row) => row.id),
    ['m2'],
  );
  assert.deepEqual(
    removeQueued(queue, 'missing').map((row) => row.id),
    ['m1', 'm2'],
  );
});

test('预览压缩空白并截断长文本', () => {
  assert.equal(queuePreview({ text: '  第一行\n第二行  ' }), '第一行 第二行');
  assert.equal(queuePreview({ text: '一'.repeat(20) }, 8), `${'一'.repeat(8)}…`);
  assert.equal(queuePreview({ text: '', files: [{ id: 'f1' }, { id: 'f2' }] }), '2 个附件');
});

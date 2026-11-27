// Harness 桌面版在运行中按 Enter 默认「排队」，等本轮结束后自动发送
// （`dsh-client-ui-conversation` 的 busyEnter 默认值为 queue）。知行此前直接
// 回「该会话正在运行」，用户只能等或另开聊天。这里是渲染层的排队账本：
// 每条消息绑定自己的聊天、空间与附件，只有队头没有错误时才继续发送。

export const QUEUE_LIMIT = 10;

const textOf = (item) => (typeof item?.text === 'string' ? item.text.trim() : '');

export function hasQueueContent(item) {
  return Boolean(textOf(item) || item?.files?.length);
}

export function queuedFor(queue, chatId) {
  return (Array.isArray(queue) ? queue : []).filter((item) => item.chatId === chatId);
}

export function enqueueMessage(queue, item) {
  const list = Array.isArray(queue) ? queue : [];
  if (!item || typeof item.chatId !== 'string' || !item.chatId) {
    return { queue: list, error: '排队消息缺少所属聊天。' };
  }
  if (!hasQueueContent(item)) return { queue: list, error: '排队消息不能为空。' };
  if (list.filter((row) => row.chatId === item.chatId).length >= QUEUE_LIMIT) {
    return { queue: list, error: `同一聊天最多排队 ${QUEUE_LIMIT} 条消息。` };
  }
  return { queue: [...list, item], error: '' };
}

// 只发送当前聊天的队头；队头失败时整条队列停住，等用户重试或删除，
// 避免后面的消息越过一条失败的交办继续执行。
export function nextQueued(queue, { chatId, workspaceId }) {
  const head = queuedFor(queue, chatId).find((item) => item.workspaceId === workspaceId);
  if (!head || head.sending || head.error) return null;
  return head;
}

export function removeQueued(queue, id) {
  return (Array.isArray(queue) ? queue : []).filter((item) => item.id !== id);
}

export function patchQueued(queue, id, patch) {
  return (Array.isArray(queue) ? queue : []).map((item) =>
    item.id === id ? { ...item, ...patch } : item,
  );
}

export function queuePreview(item, limit = 80) {
  const text = textOf(item).replace(/\s+/g, ' ');
  if (!text) return item?.files?.length ? `${item.files.length} 个附件` : '';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

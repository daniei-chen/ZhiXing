// 把执行面板里看到的子会话转成一份 Markdown 归档。
// 只做排版：内容来自界面上已经显示（脱敏后）的子会话消息，不再二次加工。
const stamp = value => {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '未知';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const roleLabel = row => (row?.role === 'assistant' ? '子任务' : '交办输入');

export function archiveMarkdown({ title, child, index, generatedAt = Date.now() } = {}) {
  if (!child || typeof child !== 'object') throw new Error('没有可归档的子会话。');
  const rows = Array.isArray(child.messages) ? child.messages : [];
  if (!rows.length) throw new Error('这个子任务还没有可归档的对话。');
  const heading = `# 子会话归档 · 子任务 ${index ?? 1}`;
  const meta = [
    `- 所属会话：${title || '未命名会话'}`,
    `- 子任务编号：${index ?? 1}`,
    `- 状态：${child.status || '未知'}`,
    `- 开始：${stamp(child.startedAt)}`,
    `- 结束：${stamp(child.finishedAt)}`,
    `- 消息：${rows.length} 条`,
    `- 归档时间：${stamp(generatedAt)}`,
  ];
  const body = rows.map(row => {
    const truncated = row?.truncated ? '（原始内容过长，归档里是界面显示的部分）' : '';
    return `## ${roleLabel(row)}${truncated}\n\n${String(row?.text ?? '').trim() || '（空消息）'}`;
  });
  return [heading, '', ...meta, '', '---', '', ...body, ''].join('\n');
}

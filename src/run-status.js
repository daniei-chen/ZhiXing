// 发送后用户应该看到「思考中」，而不是内核的初始化阶段名；有工具在跑时直接
// 显示工具动作。这里只做展示映射，不改事件本身。
const TOOL_PREFIX = '调用 · ';

export const IDLE_LABEL = '思考中';

export function runStatusLabel(events, runId) {
  const live = (events || []).filter(event => event && event.runId === runId);
  for (let index = live.length - 1; index >= 0; index -= 1) {
    const event = live[index];
    const label = typeof event.label === 'string' ? event.label.trim() : '';
    if (!label) continue;
    if (event.category === 'tools' && label.startsWith(TOOL_PREFIX)) {
      const tool = label.slice(TOOL_PREFIX.length).trim();
      if (tool) return `正在${tool}`;
    }
    if (event.category === 'tools') return label;
  }
  return IDLE_LABEL;
}

// 最近几条工具事件，用来在消息下方给出紧凑提示（自动展示，不需要展开面板）。
export function liveToolCalls(events, runId, limit = 4) {
  const calls = [];
  for (const event of events || []) {
    if (!event || event.runId !== runId) continue;
    if (event.category !== 'tools') continue;
    const label = typeof event.label === 'string' ? event.label.trim() : '';
    if (!label) continue;
    calls.push({ key: `${event.sequence ?? calls.length}-${label}`, label, status: event.status || '' });
  }
  return calls.slice(-limit);
}

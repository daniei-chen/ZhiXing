// 发送后用户应该看到「思考中」，而不是内核的初始化阶段名；有工具在跑时直接
// 显示工具动作，并把本轮的工具调用排成一条紧凑的时间线贴在消息下方。
// 这里只做展示映射，不改事件本身。
const TOOL_PREFIX = '调用 · ';
const RESULT_SUFFIXES = ['完成', '失败', '未完成'];

export const IDLE_LABEL = '思考中';

const isToolEvent = event => event && event.category === 'tools' && typeof event.label === 'string';

function labelOf(event) {
  return typeof event?.label === 'string' ? event.label.trim() : '';
}

// 结果行（「网页搜索 · 完成」）不是「正在做的事」，运行文案要落回思考中。
function runningToolName(label) {
  if (!label.startsWith(TOOL_PREFIX)) return '';
  return label.slice(TOOL_PREFIX.length).trim();
}

function isResultLabel(label) {
  return RESULT_SUFFIXES.some(suffix => label.endsWith(`· ${suffix}`));
}

export function runStatusLabel(events, runId) {
  const live = (events || []).filter(event => event && event.runId === runId);
  for (let index = live.length - 1; index >= 0; index -= 1) {
    const event = live[index];
    if (!isToolEvent(event)) continue;
    const label = labelOf(event);
    const tool = runningToolName(label);
    if (tool) return `正在${tool}`;
    if (isResultLabel(label)) return IDLE_LABEL;
  }
  return IDLE_LABEL;
}

// 本轮的工具时间线：调用与结果都保留，用来在消息下方自动展示。
export function toolTimeline(trace, limit = 8) {
  const rows = [];
  for (const event of trace || []) {
    if (!isToolEvent(event)) continue;
    const label = labelOf(event);
    if (!label) continue;
    rows.push({
      key: `${event.sequence ?? rows.length}-${label}`,
      label,
      status: typeof event.status === 'string' ? event.status : '',
      durationMs: Number.isSafeInteger(event.durationMs) ? event.durationMs : undefined,
      time: Number.isSafeInteger(event.time) ? event.time : undefined,
    });
  }
  return rows.slice(-limit);
}

// 旧名字保留：只取最近的调用行，供状态位使用。
export function liveToolCalls(events, runId, limit = 4) {
  return toolTimeline((events || []).filter(event => event && event.runId === runId), limit);
}

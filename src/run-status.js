// 发送后用户应该看到「思考中」，而不是内核的初始化阶段名；有工具在跑时直接
// 显示工具动作，并把本轮的工具调用排成一条紧凑的时间线贴在消息下方。
// 这里只做展示映射，不改事件本身。
const TOOL_PREFIX = '调用 · ';
const RESULT_SUFFIXES = ['完成', '失败', '未完成'];

export const IDLE_LABEL = '思考中';

const isToolEvent = event => event && (event.type === 'tool/call' || event.type === 'tool/result'
  || event.category === 'tools' || event.category === 'tool');
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;

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
  // One completed parallel call must not hide another call that is still live.
  const active = toolTimeline(live).findLast(row => row.callId && row.status === 'running');
  if (active) return `正在${runningToolName(active.label) || '执行工具'}`;
  // Old saved projections did not retain correlation ids. Preserve their
  // last-event status behavior without guessing which result ended which call.
  for (let index = live.length - 1; index >= 0; index -= 1) {
    const event = live[index];
    if (!isToolEvent(event)) continue;
    const label = labelOf(event);
    const tool = runningToolName(label);
    if (tool) return `正在${tool}`;
    if (event.type === 'tool/result' || isResultLabel(label)) return IDLE_LABEL;
  }
  return IDLE_LABEL;
}

function eventKind(event, label) {
  if (event.type === 'tool/call' || runningToolName(label)) return 'call';
  if (event.type === 'tool/result' || isResultLabel(label)) return 'result';
  return 'record';
}

function correlationKey(event) {
  if (typeof event.callId !== 'string' || !event.callId) return undefined;
  return JSON.stringify([event.runId ?? null, event.childSessionId ?? null, event.callId]);
}

// The host retains only safe event metadata. Pair using its explicit call id,
// never tool labels: identical tools can run concurrently, including in child
// sessions. The default includes the entire retained trace; UI folding must not
// change the reported count. Legacy results stay visibly unassociated.
export function toolTimeline(trace, limit) {
  const rows = [];
  const byCall = new Map();
  for (const event of Array.isArray(trace) ? trace : []) {
    if (!isToolEvent(event)) continue;
    const kind = eventKind(event, labelOf(event));
    const label = labelOf(event) || (kind === 'call' ? '调用 · 内核工具' : kind === 'result' ? '工具结果' : '');
    if (!label) continue;
    const key = correlationKey(event);
    let row = key && byCall.get(key);
    if (!row) {
      row = {
        key: key || `legacy-${rows.length}-${event.sequence ?? ''}`,
        callId: key ? event.callId : undefined,
        counted: Boolean(key) || kind === 'call',
        unlinked: !key && kind !== 'call',
        label,
        status: '',
        time: number(event.time),
      };
      rows.push(row);
      if (key) byCall.set(key, row);
    }
    if (kind === 'call') {
      row.callLabel = label;
      row.callSeen = true;
      row.time = number(event.time) ?? row.time;
    }
    if (kind === 'result') {
      row.resultSeen = true;
      row.resultLabel = label;
      row.finishedAt = number(event.time);
      row.durationMs = number(event.durationMs) ?? row.durationMs;
      row.status = typeof event.status === 'string' ? event.status : '';
    } else if (!row.resultSeen) {
      row.status = typeof event.status === 'string' ? event.status : kind === 'call' ? 'running' : '';
    }
    row.label = row.resultLabel || row.callLabel || label;
    if (row.unlinked) row.label += '（关联未记录）';
    if (row.durationMs === undefined && row.callSeen && row.resultSeen && row.finishedAt >= row.time) {
      row.durationMs = row.finishedAt - row.time;
    }
  }
  if (!Number.isSafeInteger(limit) || limit < 0) return rows;
  return limit === 0 ? [] : rows.slice(-limit);
}

export function toolTimelineSummary(rows, { truncated = false } = {}) {
  const count = rows.filter(row => row.counted).length;
  const unlinked = rows.filter(row => row.unlinked).length;
  const prefix = truncated ? '已保留 ' : '';
  if (!count) return unlinked ? `${prefix}${unlinked} 条工具记录（调用次数未记录）` : '没有调用工具';
  return `${prefix}${count} 次工具调用${unlinked ? ` · ${unlinked} 条历史结果未关联` : ''}`;
}

// 旧名字保留：只取最近的调用行，供状态位使用。
export function liveToolCalls(events, runId, limit = 4) {
  return toolTimeline((events || []).filter(event => event && event.runId === runId), limit);
}

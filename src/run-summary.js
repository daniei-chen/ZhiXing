import { restoreNotice } from './privacy-warning.js';

// 气泡只显示正文与错误句。想看「这一轮到底做了什么」需要一个稳定的结构：
// 状态、耗时、工具调用次数、子任务、产出、还原情况、错误码。
const STATUS = {
  succeeded: '已完成',
  failed: '未完成',
  cancelled: '已取消',
};

export function durationText(startedAt, finishedAt) {
  if (startedAt == null || finishedAt == null || finishedAt < startedAt) return '';
  const elapsed = finishedAt - startedAt;
  if (elapsed < 1000) return '不到 1 秒';
  const seconds = Math.round(elapsed / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}

export function runSummary(message) {
  const trace = Array.isArray(message?.trace) ? message.trace : [];
  const lastTime = trace.length ? trace[trace.length - 1]?.time : undefined;
  const finishedAt = message?.finishedAt || lastTime || (message?.pending ? undefined : message?.updatedAt);
  const tools = trace.filter(event => event?.type === 'tool/call' || event?.type === 'tool/result' || event?.category === 'tool').length;
  const children = Array.isArray(message?.children) ? message.children.length : 0;
  const deliverables = Array.isArray(message?.deliverables) ? message.deliverables.length : 0;
  const unrestored = Number(message?.unrestored) || 0;
  return {
    status: message?.status || (message?.pending ? 'running' : ''),
    statusLabel: message?.pending ? '进行中' : STATUS[message?.status] || '未知',
    duration: durationText(message?.startedAt, finishedAt),
    tools,
    children,
    deliverables,
    unrestored,
    restoreNote: restoreNotice(unrestored),
    errorCode: message?.errorDetail?.code || '',
  };
}

export function summaryRows(message) {
  const summary = runSummary(message);
  const rows = [
    { key: 'status', label: '状态', value: summary.statusLabel },
    { key: 'duration', label: '耗时', value: summary.duration || '未记录' },
    { key: 'tools', label: '工具调用', value: summary.tools ? `${summary.tools} 条记录` : '没有调用工具' },
    { key: 'children', label: '子任务', value: summary.children ? `${summary.children} 个` : '没有子任务' },
  ];
  if (summary.deliverables) rows.push({ key: 'deliverables', label: '产出文件', value: `${summary.deliverables} 个` });
  if (summary.unrestored) rows.push({ key: 'restore', label: '原文还原', value: `${summary.unrestored} 处占位符无法归属本次任务，按【敏感值待核实】保留` });
  if (summary.errorCode) rows.push({ key: 'error', label: '错误代码', value: summary.errorCode });
  return rows;
}

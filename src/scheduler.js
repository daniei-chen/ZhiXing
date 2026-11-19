export const FREQUENCIES = ['仅一次', '每天', '工作日', '每周', '每月', '每年'];

export function localDate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function parseLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效的起始日期。');
  const result = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(+result) || localDate(result) !== value) throw new Error('请选择有效的起始日期。');
  return result;
}

export function nextOccurrence(task, after = Date.now()) {
  if (!FREQUENCIES.includes(task.frequency)) throw new Error('重复方式无效。');
  if (!/^\d{2}:\d{2}$/.test(task.time || '')) throw new Error('任务时间无效。');
  const [hour, minute] = task.time.split(':').map(Number);
  if (hour > 23 || minute > 59 || !Number.isFinite(+new Date(after))) throw new Error('任务时间无效。');
  const source = task.anchorDate || localDate(new Date(task.createdAt || after));
  // Older tasks used ISO timestamps. Keep their local date and weekday.
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(source) ? parseLocalDate(source) : new Date(source);
  if (!Number.isFinite(+anchor)) throw new Error('重复日期无效。');
  anchor.setHours(hour, minute, 0, 0);
  if (task.frequency === '仅一次') return +anchor > after ? +anchor : null;
  const candidate = new Date(Math.max(+anchor, after));
  candidate.setHours(hour, minute, 0, 0);
  const day = anchor.getDate();
  const clampDay = () => candidate.setDate(Math.min(day, new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate()));
  if (task.frequency === '每周') {
    candidate.setDate(candidate.getDate() + (anchor.getDay() - candidate.getDay() + 7) % 7);
    if (+candidate <= after) candidate.setDate(candidate.getDate() + 7);
  } else if (task.frequency === '每月') {
    candidate.setDate(1); clampDay();
    if (+candidate <= after || +candidate < +anchor) { candidate.setDate(1); candidate.setMonth(candidate.getMonth() + 1); clampDay(); }
  } else if (task.frequency === '每年') {
    candidate.setDate(1); candidate.setMonth(anchor.getMonth()); clampDay();
    if (+candidate <= after || +candidate < +anchor) { candidate.setDate(1); candidate.setFullYear(candidate.getFullYear() + 1); clampDay(); }
  } else {
    if (+candidate <= after) candidate.setDate(candidate.getDate() + 1);
    if (task.frequency === '工作日') while ([0, 6].includes(candidate.getDay())) candidate.setDate(candidate.getDate() + 1);
  }
  return +candidate;
}

export function scheduleLabel(task) {
  const rule = task.rule;
  if (rule?.kind === 'cron') return `Cron · ${rule.expression} · ${rule.timeZone}`;
  if (rule?.kind === 'rrule') return 'RRULE · 日历重复';
  if (rule?.kind === 'every' || rule?.kind === 'after') {
    const duration = rule.seconds % 86400 === 0 ? `${rule.seconds / 86400} 天`
      : rule.seconds % 3600 === 0 ? `${rule.seconds / 3600} 小时`
        : rule.seconds % 60 === 0 ? `${rule.seconds / 60} 分钟` : `${rule.seconds} 秒`;
    return rule.kind === 'every' ? `每 ${duration}` : `${duration}后执行`;
  }
  const anchor = new Date(`${String(task.anchorDate || '').slice(0, 10)}T00:00:00`);
  const suffix = task.frequency === '每周' && Number.isFinite(+anchor) ? ` · ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][anchor.getDay()]}`
    : task.frequency === '每月' && Number.isFinite(+anchor) ? ` · ${anchor.getDate()}日`
    : task.frequency === '每年' && Number.isFinite(+anchor) ? ` · ${anchor.getMonth() + 1}月${anchor.getDate()}日`
    : task.frequency === '仅一次' ? ` · ${task.anchorDate}` : '';
  return `${task.frequency}${suffix} ${task.time}`;
}

export function taskTargetLabel(target) {
  if (target?.kind === 'new_once') return '同一条任务聊天';
  if (target?.kind === 'session') return '已有聊天';
  return '每次新建聊天';
}

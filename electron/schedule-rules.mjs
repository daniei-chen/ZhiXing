import { Cron, RRule } from '@deepseek-ai/dsh-util-time';
import { createAfterScheduleRecord, createEveryScheduleRecord, resolveEveryOccurrence } from '@deepseek-ai/dsh-schedule';
import { nextOccurrence, parseLocalDate } from '../src/scheduler.js';

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const advance = (value) => value ? Date.parse(value) : null;
const scheduleId = 'zhixing-schedule';
const record = (kind, seconds, after) => {
  const create = kind === 'after' ? createAfterScheduleRecord : createEveryScheduleRecord;
  return create(scheduleId, '知行计划', seconds, after, '知行计划');
};

function parseRule(input) {
  if (!input || typeof input !== 'object') throw new Error('请选择有效的计划规则。');
  if (input.kind === 'every' || input.kind === 'after') {
    const min = input.kind === 'every' ? 60 : 1;
    const seconds = Number(input.seconds);
    if (!Number.isInteger(seconds) || seconds < min || seconds > 31536000) {
      throw new Error(`请输入 ${min} 到 31536000 之间的整秒数。`);
    }
    return { kind: input.kind, seconds };
  }
  if (!['cron', 'rrule'].includes(input.kind) || typeof input.expression !== 'string' || input.expression.length > 1024) {
    throw new Error('规则应为不超过 1024 字符的 Cron 或 RRULE。');
  }
  const expression = input.expression.trim();
  const zone = typeof input.timeZone === 'string' && input.timeZone.trim() ? input.timeZone.trim() : localZone();
  const result = input.kind === 'cron'
    ? Cron.parse(expression, zone)
    : RRule.parse(expression, { rejectIneffectiveSetPositions: true });
  if (result.kind !== 'accepted') {
    const label = result.reason === 'time_zone' ? '时区无效'
      : result.reason === 'density' ? '规则触发太频繁' : '规则格式无效';
    throw new Error(`${label}。 ${String(result.detail || '').slice(0, 160)}`);
  }
  return {
    kind: input.kind, expression: result.rule.expression,
    ...(input.kind === 'cron' ? { timeZone: result.rule.timeZone || zone } : {}),
    engine: result.rule,
  };
}

export function normalizeTiming(input, after) {
  if (!input.rule) {
    parseLocalDate(input.anchorDate);
    const timing = { frequency: input.frequency, time: input.time, anchorDate: input.anchorDate };
    return { timing, nextRun: nextOccurrence(timing, after) };
  }
  const { engine, ...rule } = parseRule(input.rule);
  const nextRun = engine ? advance(engine.next(after)) : advance(record(rule.kind, rule.seconds, after).scheduledAt);
  return { timing: { rule }, nextRun };
}

export function nextScheduledTime(task, after) {
  if (!task.rule) return nextOccurrence(task, after);
  return normalizeTiming(task, after).nextRun;
}

export function acceptOccurrence(task, now) {
  if (!task.rule) return { scheduledAt: task.nextRun, nextRun: nextOccurrence(task, now) };
  const parsed = parseRule(task.rule);
  if (parsed.kind === 'after') return { scheduledAt: task.nextRun, nextRun: null };
  const committed = new Date(task.nextRun).toISOString();
  const dates = parsed.kind === 'every'
    ? resolveEveryOccurrence({ scheduledAt: committed, everySeconds: parsed.seconds }, now)
    : parsed.engine.resolve(committed, now);
  return { scheduledAt: Date.parse(dates.occurrenceAt), nextRun: advance(dates.nextScheduledAt) };
}

export function previewTiming(input, now) {
  const { timing, nextRun } = normalizeTiming(input, now);
  const occurrences = [];
  if (nextRun) occurrences.push(nextRun);
  if (!nextRun || timing.rule?.kind === 'after' || timing.frequency === '仅一次') return { timing, occurrences };
  const parsed = timing.rule && parseRule(timing.rule);
  for (let i = 0; i < 2; i++) {
    const last = occurrences.at(-1);
    const next = parsed?.engine ? advance(parsed.engine.next(last))
      : parsed ? advance(record('every', parsed.seconds, last).scheduledAt)
        : nextOccurrence(timing, last);
    if (!next) break;
    occurrences.push(next);
  }
  return { timing, occurrences };
}

import { randomUUID } from 'node:crypto';

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const DEFAULT_ERROR = '本轮未完成，请检查执行记录。';
const MAX_PROGRESS_CHARACTERS = 256 * 1024;
const IDENTITY_FIELDS = ['runId', 'sessionId', 'replyId', 'workspaceId'];
const SUMMARY_STRINGS = {
  type: /^[a-z][a-z0-9/-]{0,79}$/,
  category: /^[a-z][a-z0-9_-]{0,39}$/,
  status: /^[a-z][a-z0-9_-]{0,39}$/,
  callId: /^(?:event-\d+|live-[a-f0-9-]{36})$/,
  childSessionId: /^[\w.-]{1,160}$/,
  itemId: /^[\w.-]{1,160}$/,
};
const SUMMARY_NUMBERS = ['time', 'sequence', 'turn', 'step', 'member', 'durationMs'];

function errorField(error, key) {
  try {
    return error?.[key];
  } catch {
    return undefined;
  }
}

function failureOutcome(error, sanitizeError) {
  let message = DEFAULT_ERROR;
  try {
    const sanitized = sanitizeError(error);
    if (typeof sanitized === 'string' && sanitized) message = sanitized.slice(0, 600);
  } catch {
    // Error-copy failures must not strand the separately retained result.
  }
  const result = errorField(error, 'result');
  const finalization = errorField(error, 'finalization');
  const code = errorField(error, 'code');
  const stage = errorField(error, 'stage');
  return structuredClone({
    status:
      finalization?.executionStatus === 'cancelled' || code === 'RUNTIME_CANCELLED'
        ? 'cancelled'
        : 'failed',
    ...(result === undefined ? {} : { result }),
    ...(finalization === undefined ? {} : { finalization }),
    error: {
      code:
        typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)
          ? code
          : 'RUNTIME_EXECUTION_FAILED',
      stage: typeof stage === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(stage) ? stage : 'query',
      message,
    },
  });
}

function summaryOf(event, binding) {
  if (typeof event.label !== 'string' || !event.label || event.type === 'question') return null;
  const summary = {
    runId: binding.runId,
    sessionId: binding.sessionId,
    label: event.label.slice(0, 240),
  };
  for (const [key, pattern] of Object.entries(SUMMARY_STRINGS)) {
    if (typeof event[key] === 'string' && pattern.test(event[key])) summary[key] = event[key];
  }
  if (!summary.type) return null;
  for (const key of SUMMARY_NUMBERS) {
    if (Number.isSafeInteger(event[key]) && event[key] >= 0) summary[key] = event[key];
  }
  summary.time ??= Date.now();
  return summary;
}

// Private, host-lifetime delivery receipts. These are not a second execution
// engine or an authorization cache. Losing an IPC caller must not lose a
// validated result, and reconnecting must never invoke the model a second time.
export class RuntimeHandoffs {
  constructor({ limit = 16, sanitizeError = () => DEFAULT_ERROR } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16)
      throw new Error('交办恢复容量无效。');
    this.hostEpoch = randomUUID();
    this.limit = limit;
    this.sanitizeError = sanitizeError;
    this.entries = new Map();
    this.acknowledged = new Map();
    // Only admission IDs survive for the host lifetime. Results stay bounded by
    // limit; forgetting a receipt must never make its operation executable again.
    this.usedRunIds = new Set();
  }

  start(binding, execute) {
    for (const field of IDENTITY_FIELDS) {
      if (typeof binding?.[field] !== 'string' || !ID.test(binding[field]))
        throw new Error('交办恢复定位无效。');
    }
    if (typeof execute !== 'function') throw new Error('交办执行入口无效。');
    if (this.usedRunIds.has(binding.runId)) throw new Error('这次交办已经启动，请接回原任务。');
    // Unacknowledged results are never silently evicted to make room.
    if (this.entries.size >= this.limit)
      throw new Error('仍有交办结果尚未保存，请恢复聊天并完成保存后再发送。');
    const entry = {
      binding: Object.freeze({
        ...Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, binding[field]])),
        persist: binding.persist !== false,
        hostEpoch: this.hostEpoch,
      }),
      receiptId: randomUUID(),
      status: 'running',
      startedAt: Date.now(),
      trace: [],
      progressText: '',
      progressTruncated: false,
      traceTruncated: false,
    };
    this.usedRunIds.add(binding.runId);
    this.entries.set(binding.runId, entry);
    // Register before executing: early events and a detached caller still have
    // exactly one owner. Always settle the private promise, including failures.
    entry.done = Promise.resolve()
      .then(execute)
      .then(
        (result) => {
          entry.outcome = { result: structuredClone(result) };
        },
        (error) => {
          entry.outcome = failureOutcome(error, this.sanitizeError);
        },
      )
      .catch(() => {
        // A non-cloneable result or malformed failure is not a deliverable. Keep
        // a settled failure receipt instead of rejecting an unobserved promise.
        entry.outcome = failureOutcome(undefined, () => DEFAULT_ERROR);
      })
      .then(() => {
        entry.status = 'settled';
        entry.finishedAt = Date.now();
      });
    return { ...entry.binding };
  }

  observe(event) {
    const entry = this.entries.get(event?.runId);
    if (!entry || entry.status !== 'running' || event.sessionId !== entry.binding.sessionId) return;
    if (event.type === 'draft') {
      if (typeof event.text !== 'string') return;
      entry.progressText = event.text.slice(0, MAX_PROGRESS_CHARACTERS);
      entry.progressTruncated = event.text.length > MAX_PROGRESS_CHARACTERS;
    } else {
      const summary = summaryOf(event, entry.binding);
      if (!summary) return;
      entry.trace.push(summary);
      if (entry.trace.length > 400) {
        entry.trace.shift();
        entry.traceTruncated = true;
      }
    }
  }

  snapshot() {
    return {
      hostEpoch: this.hostEpoch,
      runs: [...this.entries.values()].map((entry) =>
        structuredClone({
          ...entry.binding,
          status: entry.status,
          startedAt: entry.startedAt,
          progressText: entry.progressText,
          trace: entry.trace,
          traceTruncated: entry.traceTruncated,
          progressTruncated: entry.progressTruncated,
        }),
      ),
    };
  }

  locate(identity) {
    const { hostEpoch, runId, sessionId } = identity ?? {};
    const entry = this.entries.get(runId);
    if (hostEpoch !== this.hostEpoch || !entry || entry.binding.sessionId !== sessionId)
      throw new Error('交办恢复记录已结束或不属于当前会话。');
    return entry;
  }

  async wait(identity) {
    const entry = this.locate(identity);
    await entry.done;
    if (entry.forgotten) throw new Error('交办恢复记录已结束或不属于当前会话。');
    // A duplicate observer can read a receipt; it cannot rerun the operation.
    return structuredClone({
      ...entry.binding,
      receiptId: entry.receiptId,
      outcome: entry.outcome,
      time: entry.finishedAt,
      trace: entry.trace,
      traceTruncated: entry.traceTruncated,
      progressText: entry.progressText,
      progressTruncated: entry.progressTruncated,
    });
  }

  acknowledge(identity, saved) {
    const previous = this.acknowledged.get(identity?.runId);
    if (
      previous &&
      ['hostEpoch', 'sessionId', 'receiptId'].every((key) => previous[key] === identity[key])
    )
      return { acknowledged: true };
    const entry = this.locate(identity);
    if (
      entry.status !== 'settled' ||
      identity.receiptId !== entry.receiptId ||
      typeof saved !== 'function' ||
      saved(entry) !== true
    )
      throw new Error('交办结果尚未确认保存，恢复记录已保留。');
    this.entries.delete(entry.binding.runId);
    this.acknowledged.set(entry.binding.runId, {
      hostEpoch: this.hostEpoch,
      sessionId: entry.binding.sessionId,
      receiptId: entry.receiptId,
    });
    if (this.acknowledged.size > 128)
      this.acknowledged.delete(this.acknowledged.keys().next().value);
    return { acknowledged: true };
  }

  forget(identity) {
    const entry = this.locate(identity);
    if (entry.status !== 'settled') throw new Error('交办仍未结束，恢复记录已保留。');
    entry.forgotten = true;
    entry.outcome = undefined;
    entry.trace = [];
    entry.progressText = '';
    this.entries.delete(entry.binding.runId);
    this.acknowledged.delete(entry.binding.runId);
    return { forgotten: true };
  }

  forgetSession(sessionId) {
    for (const [runId, entry] of this.entries) {
      if (entry.binding.sessionId === sessionId && entry.status === 'settled') {
        entry.forgotten = true;
        entry.outcome = undefined;
        entry.trace = [];
        entry.progressText = '';
        this.entries.delete(runId);
      }
    }
    for (const [runId, identity] of this.acknowledged) {
      if (identity.sessionId === sessionId) this.acknowledged.delete(runId);
    }
  }
}

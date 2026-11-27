import { randomUUID } from 'node:crypto';

// This is the existing desktop approval allowlist, not a new grant policy.
const TOOLS = new Set([
  'office_read_file',
  'office_write_file',
  'office_list_files',
  'office_convert',
  'office_recalculate',
  'write',
  'edit',
  'apply_patch',
  'office_execute',
  'web_search',
  'web_fetch',
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource',
  'office_browser',
  'workflow',
  'office_schedule',
  'present',
]);
const DETAIL_KEYS = new Set(['operation', 'path', 'command', 'network', 'overwrite']);
const ANSWER_KEYS = new Set(['hostEpoch', 'requestId', 'runId', 'rootSessionId', 'outcome']);
const MAX_REASON_BYTES = 128 * 1024;

function record(value) {
  return (
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  );
}

function identity(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}

function displayText(value) {
  return typeof value === 'string' && !value.includes('\0');
}

function presentation(reason) {
  if (typeof reason !== 'string' || Buffer.byteLength(reason, 'utf8') > MAX_REASON_BYTES)
    return null;
  let detail;
  try {
    detail = JSON.parse(reason);
  } catch {
    return null;
  }
  if (
    !record(detail) ||
    Object.keys(detail).some((key) => !DETAIL_KEYS.has(key)) ||
    !displayText(detail.path)
  )
    return null;
  if (detail.operation !== undefined && !displayText(detail.operation)) return null;
  if (
    detail.command !== undefined &&
    (!displayText(detail.command) || detail.command.length > 20000)
  )
    return null;
  if (detail.overwrite !== undefined && typeof detail.overwrite !== 'boolean') return null;

  let network;
  if (Object.hasOwn(detail, 'network')) {
    // JSON.stringify must preserve every represented argument. In particular,
    // JSON's overflowing numeric literals must not silently turn into null.
    const values = [detail.network];
    while (values.length) {
      const value = values.pop();
      if (typeof value === 'number' && !Number.isFinite(value)) return null;
      if (value !== null && typeof value === 'object') values.push(...Object.values(value));
    }
    try {
      network = JSON.stringify(detail.network);
    } catch {
      return null;
    }
  }
  return {
    operation: detail.operation || '操作需要批准',
    path: detail.path,
    ...(detail.command === undefined ? {} : { command: detail.command }),
    ...(network === undefined ? {} : { network }),
    ...(detail.overwrite === undefined ? {} : { overwrite: detail.overwrite }),
  };
}

/** Pending one-shot decisions owned by the main process, independent of React. */
export class RuntimeApprovals {
  #hostEpoch = randomUUID();
  #revision = 0;
  #pending = new Map();
  #closed = false;
  #onChange;

  constructor({ onChange } = {}) {
    this.#onChange = onChange;
  }

  snapshot() {
    return {
      hostEpoch: this.#hostEpoch,
      revision: this.#revision,
      pending: [...this.#pending.values()].map(({ view }) => ({
        ...view,
        presentation: { ...view.presentation },
      })),
    };
  }

  request(input) {
    if (this.#closed || input?.signal?.aborted) return Promise.resolve({ outcome: 'cancelled' });
    if (
      !record(input) ||
      !(input.signal instanceof AbortSignal) ||
      !identity(input.runId) ||
      !identity(input.rootSessionId) ||
      !identity(input.sessionId) ||
      !identity(input.toolName) ||
      (!TOOLS.has(input.toolName) && !input.toolName.startsWith('mcp__')) ||
      (input.callId !== undefined && !identity(input.callId))
    ) {
      return Promise.resolve({ outcome: 'rejected' });
    }
    const content = presentation(input.reason);
    if (content === null) return Promise.resolve({ outcome: 'rejected' });

    const view = {
      requestId: randomUUID(),
      runId: input.runId,
      rootSessionId: input.rootSessionId,
      sourceSessionId: input.sessionId,
      toolName: input.toolName,
      ...(input.callId === undefined ? {} : { callId: input.callId }),
      presentation: content,
      createdAt: Date.now(),
    };
    return new Promise((resolve) => {
      const entry = { view, signal: input.signal, resolve, abort: null };
      entry.abort = () => this.#settle(entry, 'cancelled');
      this.#pending.set(view.requestId, entry);
      input.signal.addEventListener('abort', entry.abort, { once: true });
      this.#changed();
      // A synchronous observer can abort or close while receiving the snapshot.
      if (input.signal.aborted) entry.abort();
    });
  }

  answer(input) {
    if (
      !record(input) ||
      Object.keys(input).length !== ANSWER_KEYS.size ||
      Object.keys(input).some((key) => !ANSWER_KEYS.has(key)) ||
      !['allowed-once', 'rejected'].includes(input.outcome)
    ) {
      return { accepted: false, reason: 'invalid-response' };
    }
    if (input.hostEpoch !== this.#hostEpoch) return { accepted: false, reason: 'stale-host' };
    const entry = this.#pending.get(input.requestId);
    if (entry === undefined) return { accepted: false, reason: 'request-ended' };
    if (input.runId !== entry.view.runId || input.rootSessionId !== entry.view.rootSessionId) {
      return { accepted: false, reason: 'scope-mismatch' };
    }
    if (entry.signal.aborted) {
      this.#settle(entry, 'cancelled');
      return { accepted: false, reason: 'request-cancelled' };
    }
    this.#settle(entry, input.outcome);
    return { accepted: true };
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const entry of this.#pending.values()) this.#settle(entry, 'cancelled');
  }

  #settle(entry, outcome) {
    if (this.#pending.get(entry.view.requestId) !== entry) return;
    this.#pending.delete(entry.view.requestId);
    entry.signal.removeEventListener('abort', entry.abort);
    entry.resolve({ outcome });
    this.#changed();
  }

  #changed() {
    this.#revision += 1;
    try {
      this.#onChange?.(this.snapshot());
    } catch {
      // A failed renderer notification cannot grant, replace, or lose a decision.
      // The authoritative pending set remains available to the next snapshot read.
    }
  }
}

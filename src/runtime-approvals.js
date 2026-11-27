// Live approvals belong to the host. This projection never writes workspace,
// draft, transcript, export, or model data and cannot manufacture a decision.
const EMPTY_PENDING = Object.freeze([]);
const EMPTY_SNAPSHOT = Object.freeze({
  hostEpoch: null,
  revision: -1,
  pending: EMPTY_PENDING,
  connection: 'unavailable',
});
const unavailable = () => new Error('待批准操作尚未同步，请刷新后重试。');

function readSnapshot(value) {
  if (
    !value ||
    typeof value.hostEpoch !== 'string' ||
    !value.hostEpoch ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.pending)
  ) {
    throw unavailable();
  }
  const identities = new Set();
  const pending = value.pending.map((request) => {
    const detail = request?.presentation;
    if (
      !request ||
      ['requestId', 'runId', 'rootSessionId', 'sourceSessionId', 'toolName'].some(
        (key) => typeof request[key] !== 'string' || !request[key],
      ) ||
      identities.has(request.requestId) ||
      !Number.isFinite(request.createdAt) ||
      !detail ||
      typeof detail.operation !== 'string' ||
      typeof detail.path !== 'string' ||
      ['command', 'network'].some(
        (key) => detail[key] !== undefined && typeof detail[key] !== 'string',
      ) ||
      (detail.overwrite !== undefined && typeof detail.overwrite !== 'boolean') ||
      (request.callId !== undefined && typeof request.callId !== 'string')
    ) {
      throw unavailable();
    }
    identities.add(request.requestId);
    return Object.freeze({
      requestId: request.requestId,
      runId: request.runId,
      rootSessionId: request.rootSessionId,
      sourceSessionId: request.sourceSessionId,
      toolName: request.toolName,
      ...(request.callId === undefined ? {} : { callId: request.callId }),
      presentation: Object.freeze({
        operation: detail.operation,
        path: detail.path,
        overwrite: detail.overwrite === true,
        ...(detail.command === undefined ? {} : { command: detail.command }),
        ...(detail.network === undefined ? {} : { network: detail.network }),
      }),
      createdAt: request.createdAt,
    });
  });
  return { hostEpoch: value.hostEpoch, revision: value.revision, pending: Object.freeze(pending) };
}

export function createRuntimeApprovals() {
  let snapshot = EMPTY_SNAPSHOT;
  let binding;
  const listeners = new Set();
  const retiredEpochs = new Set();
  const answers = new Map();
  const keyOf = (epoch, requestId) => `${epoch}:${requestId}`;

  function publish(next) {
    if (
      next.hostEpoch === snapshot.hostEpoch &&
      next.revision === snapshot.revision &&
      next.pending === snapshot.pending &&
      next.connection === snapshot.connection
    ) {
      return;
    }
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  }

  function accept(current, value, eventVersion) {
    if (binding !== current) return;
    const next = readSnapshot(value);
    if (retiredEpochs.has(next.hostEpoch)) return;
    if (next.hostEpoch !== snapshot.hostEpoch) {
      // An event received after a query began is the newer host identity, even
      // when the query's old epoch had not been observed before that event.
      if (eventVersion !== undefined && current.events !== eventVersion) return;
      if (snapshot.hostEpoch) retiredEpochs.add(snapshot.hostEpoch);
    } else if (next.revision < snapshot.revision) {
      return;
    } else if (next.revision === snapshot.revision) {
      publish({ ...snapshot, connection: 'ready' });
      return;
    }
    publish({ ...next, connection: 'ready' });
    const retained = new Set(next.pending.map((item) => keyOf(next.hostEpoch, item.requestId)));
    for (const key of answers.keys()) if (!retained.has(key)) answers.delete(key);
  }

  async function refresh() {
    const current = binding;
    if (!current) throw unavailable();
    const eventVersion = current.events;
    publish({ ...snapshot, connection: 'loading' });
    try {
      const value = await current.api.approvalSnapshot();
      accept(current, value, eventVersion);
      return snapshot;
    } catch {
      if (
        binding === current &&
        current.events !== eventVersion &&
        snapshot.connection === 'ready'
      ) {
        return snapshot;
      }
      if (binding === current) publish({ ...snapshot, connection: 'error' });
      throw unavailable();
    }
  }

  function bind(api) {
    if (binding && binding.api === api) return binding.close;
    binding?.close();
    if (!api?.approvalSnapshot || !api?.onApprovalsChanged || !api?.answerApproval) {
      return () => {};
    }
    const current = { api, events: 0, off: null, close: null };
    current.close = () => {
      if (binding !== current) return;
      binding = undefined;
      current.off?.();
      answers.clear();
      retiredEpochs.clear();
      publish(EMPTY_SNAPSHOT);
    };
    binding = current;
    publish({ ...snapshot, connection: 'loading' });
    try {
      // Subscribe before querying so there is no gap for an added/withdrawn
      // approval. This bridge is installed outside the App error boundary.
      current.off = api.onApprovalsChanged((value) => {
        if (binding !== current) return;
        current.events++;
        try {
          accept(current, value);
        } catch {
          publish({ ...snapshot, connection: 'error' });
        }
      });
      void refresh().catch(() => {
        // The stable snapshot exposes the failure; never log request content.
      });
    } catch {
      publish({ ...snapshot, connection: 'error' });
    }
    return current.close;
  }

  function answer(value) {
    const current = binding;
    const request = snapshot.pending.find((item) => item.requestId === value?.requestId);
    if (
      !current ||
      snapshot.connection !== 'ready' ||
      value?.hostEpoch !== snapshot.hostEpoch ||
      !request ||
      value.runId !== request.runId ||
      value.rootSessionId !== request.rootSessionId ||
      !['allowed-once', 'rejected'].includes(value.outcome)
    ) {
      return Promise.resolve({ accepted: false, reason: 'stale' });
    }
    const key = keyOf(snapshot.hostEpoch, request.requestId);
    if (answers.has(key)) return answers.get(key);
    const task = (async () => {
      try {
        const result = await current.api.answerApproval({
          hostEpoch: snapshot.hostEpoch,
          requestId: request.requestId,
          runId: request.runId,
          rootSessionId: request.rootSessionId,
          outcome: value.outcome,
        });
        if (typeof result?.accepted !== 'boolean') throw unavailable();
        return { accepted: result.accepted };
      } finally {
        if (binding === current) {
          await refresh().catch(() => {
            // A lost acknowledgement must be reconciled, not optimistically
            // removed from pending or reported as an authorization success.
          });
        }
      }
    })();
    answers.set(key, task);
    void task.then(
      (result) => {
        if (!result.accepted && answers.get(key) === task) answers.delete(key);
      },
      () => {
        if (answers.get(key) === task) answers.delete(key);
      },
    );
    return task;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bind,
    refresh,
    answer,
  };
}

export const runtimeApprovals = createRuntimeApprovals();
export const bindRuntimeApprovals = (desktop) => runtimeApprovals.bind(desktop);

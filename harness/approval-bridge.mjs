const OUTCOMES = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable']);
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 4096;

export const name = 'zhixing-approval-bridge';
export const inject = ['agents', 'subagents', 'approval'];

function endpoint(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.port === '0' ||
      url.pathname !== '/approval' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function owns(ctx, rootId, root, agent) {
  if (!root || ctx.agents.get(rootId) !== root || !agent || ctx.agents.get(agent.id) !== agent) {
    return false;
  }
  if (agent === root) return true;
  try {
    return ctx.subagents.rootOf(agent) === root;
  } catch (error) {
    // A detached child or a different live tree is not this answerer's request.
    if (error?.code === 'UNAUTHORIZED') return false;
    // An unexpected native ownership failure is unavailable, not permission
    // for a later answerer to take over. The native service contains this throw.
    throw error;
  }
}

async function outcomeOf(response, signal) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return 'unavailable';
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    signal.throwIfAborted();
    size += chunk.byteLength;
    if (size > MAX_RESPONSE_BYTES) return 'unavailable';
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  const responseBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const outcome = responseBody?.value?.outcome;
  return OUTCOMES.has(outcome) ? outcome : 'unavailable';
}

export function apply(ctx) {
  const {
    ZHIXING_APPROVAL_URL: rawUrl,
    ZHIXING_APPROVAL_TOKEN: token,
    ZHIXING_APPROVAL_SESSION: rootId,
  } = process.env;
  delete process.env.ZHIXING_APPROVAL_URL;
  delete process.env.ZHIXING_APPROVAL_TOKEN;
  delete process.env.ZHIXING_APPROVAL_SESSION;

  const url = endpoint(rawUrl);
  const configured = url !== null && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
  const lifecycle = new AbortController();
  ctx.effect(() => () => lifecycle.abort(), 'approval-bridge.cancelPending()');

  // The native service owns policy, turn enclosure, request IDs and audit events.
  // This answerer only transports one request; call IDs are never approval-cache keys.
  ctx.on('approval/request', async (request, next) => {
    const root = ctx.agents.get(rootId);
    if (!owns(ctx, rootId, root, request.agent)) return next();
    const signal = AbortSignal.any([
      lifecycle.signal,
      ...(request.signal === undefined ? [] : [request.signal]),
    ]);
    if (signal.aborted) return 'cancelled';
    if (!configured) return 'unavailable';
    if (
      typeof request.agent.session?.id !== 'string' ||
      typeof request.toolName !== 'string' ||
      !request.toolName ||
      (request.callId !== undefined && typeof request.callId !== 'string') ||
      (request.reason !== undefined && typeof request.reason !== 'string')
    ) {
      return 'unavailable';
    }

    try {
      const body = JSON.stringify({
        sessionId: request.agent.session.id,
        toolName: request.toolName,
        ...(request.callId === undefined ? {} : { callId: request.callId }),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      });
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) return 'unavailable';
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body,
        signal,
        redirect: 'error',
      });
      const outcome = await outcomeOf(response, signal);
      if (signal.aborted) return 'cancelled';
      return owns(ctx, rootId, root, request.agent) ? outcome : 'unavailable';
    } catch {
      // No transport error, token, reason or response body is logged or exposed.
      return signal.aborted ? 'cancelled' : 'unavailable';
    }
  });
}

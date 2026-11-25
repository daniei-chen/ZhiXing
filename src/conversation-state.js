// Consume only the submitted revision. Once a new conversation exists, its
// recoverable input belongs to that chat and participates in chat deletion.
export function consumeConversationDraft(drafts, submission) {
  const sourceKey = submission.draftKey;
  if (!sourceKey) return null;
  const current = drafts[sourceKey] || { revision: 0, text: '', files: [] };
  if (current.revision !== submission.submittedRevision) return null;
  const key = current.kind === 'new' ? `chat:${submission.sessionId}` : sourceKey;
  if (key !== sourceKey && Object.hasOwn(drafts, key)) return null;
  const cleared = {
    ...current,
    ...(key !== sourceKey ? { kind: 'chat', draftId: submission.sessionId, chatId: submission.sessionId, workspaceId: submission.workspaceId, projectId: submission.projectId || null } : {}),
    revision: current.revision + 1, filesRevision: (current.filesRevision || 0) + 1,
    text: '', files: [], updatedAt: Date.now(),
  };
  const next = { ...drafts, [key]: cleared };
  if (key !== sourceKey) delete next[sourceKey];
  return { drafts: next, key, cleared };
}

// Renderer projection only. The host's finalization is authoritative; this is not a full audit log.
import { errorText } from './error-copy.js';

export function finalizeConversationRun(state, job, outcome = {}) {
  const result = outcome.result || outcome.output || {};
  const finalization = outcome.finalization || result.finalization || job.finalization;
  const executionStatus = finalization?.executionStatus || (job.terminalStatus === 'cancelled' || outcome.status === 'cancelled' ? 'cancelled'
    : job.terminalStatus === 'failed' || outcome.status === 'failed' || outcome.error ? 'failed' : 'completed');
  const stopped = executionStatus === 'cancelled';
  const failed = executionStatus === 'failed';
  const error = finalization?.error || outcome.error;
  const trace = [...(job.trace || [])];
  const terminal = {
    type: 'run/terminal', category: 'session', runId: job.runId, time: outcome.time || Date.now(),
    label: stopped ? '交办已取消' : failed ? '交办失败' : '交办执行完成',
    status: stopped ? 'cancelled' : failed ? 'failed' : 'completed',
    ...(finalization?.eventWatermark !== undefined ? { sequence: finalization.eventWatermark } : {}),
  };
  if (trace.at(-1)?.type === 'run/terminal') trace[trace.length - 1] = terminal;
  else trace.push(terminal);
  return {
    ...state,
    chats: state.chats.map(chat => chat.id !== job.chatId ? chat : {
      ...chat, updatedAt: Date.now(),
      messages: chat.messages.map(message => {
        if (message.id !== job.replyId || message.runId !== job.runId) return message;
        const currentBody = message.progressText || (!message.pending && message.text) || job.progressText || message.text || '';
        const partial = (outcome.displayRedacted || result.displayRedacted) ? currentBody || result.text || '' : result.text || currentBody;
        // 气泡里给人看的是可行动句子；技术原文留在 errorDetail 供执行面板排查。
        const technical = error?.message || (failed ? '本轮未完成。以上部分输出已保留。' : undefined);
        const errorMessage = technical === undefined ? undefined : errorText(technical);
        return {
          ...message, ...result,
          text: partial || (stopped ? '已停止生成。' : failed ? '本轮未完成，未确认任务结果。' : '内核没有返回正文。'),
          pending: false, progressText: '', stopped, error: failed,
          errorMessage, ...(error ? { errorDetail: { code: error.code, stage: error.stage, message: technical } } : {}),
          status: stopped ? 'cancelled' : failed ? 'failed' : 'succeeded',
          finalization,
          finishedAt: terminal.time,
          trace: trace.slice(-400), traceTruncated: !!job.traceTruncated || trace.length > 400,
          children: finalization?.children || result.children || job.children || message.children || [],
          deliverables: finalization?.deliverables || result.deliverables || job.deliverables || message.deliverables || [],
          changes: finalization?.changes || result.changes || job.changes || message.changes || [],
          plan: result.plan || job.plan || message.plan,
          context: result.context || job.context || message.context,
        };
      }),
    }),
  };
}

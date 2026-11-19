import { composePrompt } from './office-workflows.js';

export function automationInput(task, context, history = []) {
  const workspace = context.workspaces?.find(item => item.id === task.workspaceId);
  if (!workspace) throw new Error('工作空间已不存在。');
  const project = task.projectId ? context.projects?.find(item => item.id === task.projectId && item.workspaceId === workspace.id) : null;
  if (task.projectId && !project) throw new Error('任务所属项目已变更，请重新选择。');
  const documents = (task.documentIds || []).map(id => {
    const document = context.documents?.find(item => item.id === id && item.workspaceId === workspace.id);
    if (!document || document.status !== 'ready' || typeof document.text !== 'string') throw new Error('选定的资料无法使用，请重新选择并审阅。');
    return document;
  });
  const prompt = composePrompt(task.description, documents, history, project?.instructions);
  if (prompt.length > 400000) throw new Error('任务资料超过 400,000 字符，请减少所选资料。');
  return { prompt, mode: workspace.type === 'government' ? 'government' : 'office', documents, project };
}

export function applyAutomationResults(state, runs) {
  if (!state.settings.persist) return state;
  const handled = new Set(state.appliedAutomationRuns || []);
  const chats = [...state.chats];
  let changed = false;
  for (const run of runs) {
    const result = run.result, id = result?.chatId;
    if (!id || handled.has(run.id)) continue;
    handled.add(run.id);
    changed = true;
    const index = chats.findIndex(chat => chat.id === id);
    const old = chats[index];
    if (result.targetKind === 'session' && (!old || old.archived || old.workspaceId !== run.workspaceId
      || (old.projectId || null) !== (result.projectId || null))) continue;
    const projectId = state.projects.some(project => project.id === result.projectId && project.workspaceId === run.workspaceId) ? result.projectId : null;
    const messages = [
      { id: `${run.id}-task`, role: 'user', text: run.name, prompt: result.prompt, protected: result.modelInput, privacyMode: result.privacyMode,
        automationRunId: run.id, files: (result.documentNames || []).map(name => ({ name })) },
      { id: `${run.id}-result`, role: 'assistant', text: result.text, masked: result.masked,
        privacyMode: result.privacyMode, finishReason: result.finishReason, automationRunId: run.id },
    ];
    if (old) {
      if (old.messages.some(message => message.automationRunId === run.id)) continue;
      chats[index] = { ...old, updatedAt: Math.max(old.updatedAt || 0, run.finishedAt), messages: [...old.messages, ...messages] };
    } else {
      if (!state.workspaces.some(workspace => workspace.id === run.workspaceId)) continue;
      chats.push({ id, workspaceId: run.workspaceId, projectId, providerId: result.providerId, providerUrl: result.providerUrl,
        automationTaskId: run.taskId, title: `自动化 · ${run.name}`, mode: result.mode, createdAt: run.startedAt, updatedAt: run.finishedAt, messages });
    }
  }
  return changed ? { ...state, chats, appliedAutomationRuns: [...handled].slice(-240) } : state;
}

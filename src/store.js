import {normalisePrivacyPolicy} from './privacy-policy.js';
export const STORAGE_KEY = 'zhixing.workspace.v1';

const seedState = {
  version: 2,
  workspaceId: 'office-home',
  workspaces: [
    { id: 'office-home', name: '个人办公', type: 'office', directory: null, projectId: 'office-general' },
    { id: 'government-home', name: '政务办公', type: 'government', directory: null, projectId: 'government-general' },
  ],
  projects: [
    { id: 'office-general', workspaceId: 'office-home', name: '日常工作', expanded: true },
    { id: 'government-general', workspaceId: 'government-home', name: '事项办理', expanded: true },
  ],
  chats: [],
  drafts: {},
  queuedMessages: [],
  pendingWorkspaceDeletes: [],
  automations: [],
  appliedAutomationRuns: [],
  documents: [],
  settings: { theme: 'system', modelProviderId: null, model: 'deepseek-flash', reasoning: 'high', permission: 'ask', privacyMode: 'redact', privacyPolicy:normalisePrivacyPolicy(),customTerms: [], persist: true, notifications: true, demo: false, voiceLanguage:'zh-CN',personalizationEnabled:false,personalInstructions:'' },
};

const legacySample = new Map([
  ['c1', '核算年度目标考核奖并编制总表'], ['c5', '制作月度工资柱状图初版'],
  ['c2', '构思全新萌物IP'], ['c3', '回应问候'], ['c4', '我想要基于DeepSeek harness设计一款agent'],
  ['c6', 'https://github.com/deepseek-ai/deepseek-harness'],
]);

export function mergeState(saved, { liveRuns = [] } = {}) {
  const defaults = structuredClone(seedState);
  if (![1, 2].includes(saved?.version) || !Array.isArray(saved.projects) || !Array.isArray(saved.chats)) return defaults;

  const decodedSettings = saved.settings || {};
  const settings = Object.fromEntries(Object.entries(defaults.settings).map(([key, fallback]) => [key, decodedSettings[key] ?? fallback]));
  // The old privacy:false flag meant offline, never permission to disclose originals.
  if (saved.version === 1 || settings.privacyMode !== 'raw') settings.privacyMode = 'redact';
  if (!['ask','auto','full'].includes(settings.permission)) settings.permission = 'ask';
  settings.privacyPolicy=normalisePrivacyPolicy(settings.privacyPolicy);
  settings.voiceLanguage=['auto','zh-CN','en-US','yue','ja','ko'].includes(settings.voiceLanguage)?settings.voiceLanguage:'zh-CN';
  settings.personalInstructions=typeof settings.personalInstructions==='string'?settings.personalInstructions.slice(0,4000):'';
  settings.personalizationEnabled=settings.personalizationEnabled===true;

  let workspaces = saved.version === 2 && saved.workspaces?.length ? saved.workspaces : defaults.workspaces;
  let projects = saved.projects;
  let chats = saved.chats;
  let automations = saved.automations || [];
  let documents = saved.documents || [];
  if (saved.version === 1) {
    const home = saved.mode === 'government' ? 'government-home' : 'office-home';
    chats = chats.filter(chat => !(legacySample.get(chat.id) === chat.title && !chat.messages?.length));
    projects = projects.filter(project => !(/^p[1-7]$/.test(project.id) && /^codex[1-7]$/.test(project.name) && !chats.some(chat => chat.projectId === project.id) && !automations.some(task => task.projectId === project.id)));
    projects = [...defaults.projects, ...projects.map(project => ({ ...project, workspaceId: home }))];
    workspaces = workspaces.map(space => ({ ...space, projectId: projects.find(project => project.id === saved.projectId && project.workspaceId === space.id)?.id || space.projectId }));
    automations = automations.map(task => ({ ...task, workspaceId: home, enabled: task.kind === 'reminder' && !!task.enabled, approvedDestination: null, approvedPrivacyMode: null }));
    documents = documents.map(document => ({ ...document, workspaceId: home }));
  }

  const workspaceId = workspaces.some(space => space.id === saved.workspaceId) ? saved.workspaceId
    : saved.mode === 'government' ? 'government-home' : workspaces[0].id;
  projects=projects.map(project=>({...project,directory:Object.hasOwn(project,'directory')?project.directory:workspaces.find(space=>space.id===project.workspaceId)?.directory||null}));
  const projectById = new Map(projects.map(project => [project.id, project]));
  const chatById = new Map(chats.map(chat => [chat.id, chat]));
  return {
    version: 2, workspaceId, workspaces, projects, settings,
    pendingWorkspaceDeletes: Array.isArray(saved.pendingWorkspaceDeletes) ? saved.pendingWorkspaceDeletes.filter(item => item && typeof item.id === 'string' && Array.isArray(item.chatIds) && Array.isArray(item.taskIds)).map(item => ({
      id: item.id, projectId: typeof item.projectId === 'string' ? item.projectId : null,
      chatIds: item.chatIds.filter(id => typeof id === 'string'), taskIds: item.taskIds.filter(id => typeof id === 'string'),
    })) : [],
    drafts: settings.persist && saved.drafts && typeof saved.drafts === 'object' && !Array.isArray(saved.drafts)
      ? Object.fromEntries(Object.entries(saved.drafts).filter(([, draft]) => draft && typeof draft.text === 'string' && Array.isArray(draft.files)).map(([id, draft]) => {
        const owner = chatById.get(draft.chatId || (id.startsWith('chat:') ? id.slice(5) : null));
        const ownerProject = owner && projectById.get(owner.projectId);
        return [id, {
        draftId: typeof draft.draftId === 'string' ? draft.draftId : undefined,
        kind: owner ? 'chat' : draft.kind === 'chat' || draft.kind === 'new' ? draft.kind : undefined,
        workspaceId: owner ? ownerProject?.workspaceId || owner.workspaceId || workspaceId : typeof draft.workspaceId === 'string' ? draft.workspaceId : undefined,
        projectId: owner ? owner.projectId || null : typeof draft.projectId === 'string' ? draft.projectId : null,
        chatId: owner ? owner.id : typeof draft.chatId === 'string' ? draft.chatId : null,
        revision: Number.isSafeInteger(draft.revision) && draft.revision >= 0 ? draft.revision : 0,
        filesRevision: Number.isSafeInteger(draft.filesRevision) && draft.filesRevision >= 0 ? draft.filesRevision : 0,
        text: draft.text.slice(0, 60000),
        files: draft.files.slice(0, 12),
        updatedAt: Number.isFinite(draft.updatedAt) ? draft.updatedAt : Date.now(),
      }]; }))
      : {},
    // 排队消息只随已保存的聊天恢复；恢复后标记上次未发送，等用户确认再发。
    queuedMessages: settings.persist && Array.isArray(saved.queuedMessages) ? saved.queuedMessages.filter(item => item && typeof item.id === 'string' && typeof item.chatId === 'string' && chatById.has(item.chatId) && typeof item.text === 'string' && Array.isArray(item.files)).slice(0, 64).map(item => {
      const owner = chatById.get(item.chatId);
      return {
        id: item.id,
        chatId: item.chatId,
        workspaceId: owner.workspaceId || workspaceId,
        projectId: owner.projectId || null,
        text: item.text.slice(0, 60000),
        files: item.files.filter(file => file && typeof file.id === 'string' && typeof file.name === 'string').slice(0, 12),
        mode: item.mode === 'government' ? 'government' : 'office',
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        error: '上次退出时未发送。请确认后重试。',
      };
    }).filter(item => item.text.trim() || item.files.length) : [],
    appliedAutomationRuns: Array.isArray(saved.appliedAutomationRuns) ? saved.appliedAutomationRuns.filter(id => typeof id === 'string').slice(-240) : [],
    chats: chats.map(chat => ({
      ...chat,
      workspaceId: projectById.get(chat.projectId)?.workspaceId || chat.workspaceId || workspaceId,
      messages: (chat.messages || []).map(message => message.pending && !liveRuns.some(run => run.sessionId === chat.id && run.runId === message.runId && run.replyId === message.id)
        ? { ...message, pending: false, stopped: true, status: 'interrupted', text: message.progressText || message.text || '上次运行已中断。', progressText: '' } : message),
    })),
    automations: automations.map(task => ({ ...task, workspaceId: task.workspaceId || projectById.get(task.projectId)?.workspaceId || workspaceId, kind: task.kind || 'reminder', status: task.status === '运行中' ? '上次运行已中断' : task.status })),
    documents: documents.map(document => ({ ...document, workspaceId: document.workspaceId || workspaceId })),
  };
}

// A live chat owns its draft even when a saved draft still names its former project.
export function workspaceDeletion(state, item, drafts = state.drafts || {}) {
  const projectId = item.type === 'delete-project' ? item.id : null;
  const chatIds = new Set(state.chats.filter(chat => projectId ? chat.projectId === projectId : chat.id === item.id).map(chat => chat.id));
  // Also remove an explicitly deleted chat's legacy orphan draft.
  if (!projectId) chatIds.add(item.id);
  const chatById = new Map(state.chats.map(chat => [chat.id, chat]));
  const nextDrafts = Object.fromEntries(Object.entries(drafts).filter(([key, draft]) => {
    const chatId = draft.chatId || (key.startsWith('chat:') ? key.slice(5) : null);
    if (chatIds.has(chatId)) return false;
    if (chatId && chatById.has(chatId)) return true;
    return !projectId || draft.projectId !== projectId;
  }).map(([key, draft]) => {
    const owner = chatById.get(draft.chatId || (key.startsWith('chat:') ? key.slice(5) : null));
    return [key, owner ? { ...draft, kind: 'chat', chatId: owner.id, projectId: owner.projectId || null, workspaceId: state.projects.find(project => project.id === owner.projectId)?.workspaceId || owner.workspaceId || draft.workspaceId } : draft];
  }));
  return {
    ...state,
    chats: state.chats.filter(chat => !chatIds.has(chat.id)), drafts: nextDrafts,
    queuedMessages: (state.queuedMessages || []).filter(item => !chatIds.has(item.chatId) && (!projectId || item.projectId !== projectId)),
    ...(projectId ? {
      projects: state.projects.filter(project => project.id !== projectId),
      workspaces: state.workspaces.map(space => space.projectId === projectId ? { ...space, projectId: null } : space),
      automations: state.automations.filter(task => task.projectId !== projectId),
      // Library documents are shared, independent records. Unassign rather than destroy them.
      documents: state.documents.map(document => document.projectId === projectId ? { ...document, projectId: null } : document),
    } : {}),
  };
}

export function orphanDrafts(state) {
  return Object.entries(state.drafts || {}).filter(([key, draft]) => {
    if (!draft.text && !draft.files?.length) return false;
    const chatId = draft.chatId || (key.startsWith('chat:') ? key.slice(5) : null);
    if (chatId) return !state.chats.some(chat => chat.id === chatId);
    return draft.kind !== 'new' || !draft.draftId || !state.workspaces.some(space => space.id === draft.workspaceId)
      || !!draft.projectId && !state.projects.some(project => project.id === draft.projectId && project.workspaceId === draft.workspaceId);
  }).map(([key, draft]) => ({ key, ...draft }));
}

// Unsent new conversations are independent drafts, not missing-chat orphans.
// Keep their stored keys so legacy keys can also be opened without copying.
export function newConversationDrafts(state) {
  const deletingProjects = new Set((state.pendingWorkspaceDeletes || []).map(item => item.projectId).filter(Boolean));
  return Object.entries(state.drafts || {}).filter(([key, draft]) => draft.kind === 'new' && draft.draftId
    && !draft.chatId && !key.startsWith('chat:') && (draft.text || draft.files?.length)
    && state.workspaces.some(space => space.id === draft.workspaceId)
    && (!draft.projectId || !deletingProjects.has(draft.projectId)
      && state.projects.some(project => project.id === draft.projectId && project.workspaceId === draft.workspaceId)))
    .map(([key, draft]) => ({ ...draft, key }))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0) || left.key.localeCompare(right.key));
}

export function appendDraftFiles(existing = [], incoming = [], limit = 12) {
  const identities = file => [
    file.id && `id:${file.id}`,
    file.path && `path:${/^(?:[a-z]:|\\\\)/i.test(file.path) ? file.path.replaceAll('\\', '/').toLowerCase() : file.path}`,
    file.sourceUrl && `url:${file.sourceUrl}`,
  ].filter(Boolean);
  const known = new Set(existing.flatMap(identities));
  const files = [...existing];
  let duplicates = 0, rejected = 0;
  for (const file of incoming) {
    const keys = identities(file);
    if (keys.some(key => known.has(key)) || files.includes(file)) { duplicates++; continue; }
    if (files.length >= limit) { rejected++; continue; }
    files.push(file);
    keys.forEach(key => known.add(key));
  }
  return { files, added: files.length - existing.length, duplicates, rejected };
}

export function recoverSubmittedDraft(current, submission) {
  if (!current || current.revision !== submission.submittedRevision + 1 || current.text || current.files?.length) return null;
  return { text: submission.restoreText ?? submission.text, files: submission.attachments || [] };
}

export function restoredDraftView(state) {
  const draft = Object.values(state.drafts || {}).filter(item => {
    if (item.workspaceId !== state.workspaceId || (!item.text && !item.files?.length)) return false;
    if (item.projectId && !state.projects.some(project => project.id === item.projectId && project.workspaceId === item.workspaceId)) return false;
    if (item.chatId && !state.chats.some(chat => chat.id === item.chatId && !chat.archived && chat.workspaceId === item.workspaceId)) return false;
    return item.kind === 'chat' || item.kind === 'new' && !!item.draftId;
  }).sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (!draft) return null;
  return { section: draft.chatId ? 'home' : draft.projectId ? 'project' : 'home', chatId: draft.chatId || null, projectId: draft.projectId || null, newDraftId: draft.draftId };
}

export function initialState() {
  if (window.zhixing) return mergeState(null);
  try { return { ...mergeState(JSON.parse(localStorage.getItem(STORAGE_KEY))), drafts: {} }; }
  catch { return mergeState(null); }
}

export function saveState(state) {
  if (state.settings.persist) {
    const persisted = { ...state };
    delete persisted.drafts;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }
  else localStorage.removeItem(STORAGE_KEY);
}

export function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function chatText(chat, { protectedView = false } = {}) {
  return (chat?.messages || []).filter(message => !message.pending && message.text).map(message => {
    if (protectedView && message.role === 'user') return '';
    const text = protectedView ? message.masked ?? message.text : message.text;
    const status = message.stopped ? '（已停止，部分内容）' : message.error ? '（未完成，部分内容）' : '';
    return `${message.role === 'user' ? '你' : message.imported ? 'DeepSeek（导入）' : '知行'}${message.demo ? '（本地演示）' : ''}${status}\n${text}`;
  }).filter(Boolean).join('\n\n');
}

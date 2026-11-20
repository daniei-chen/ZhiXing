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

export function mergeState(saved) {
  const defaults = structuredClone(seedState);
  if (![1, 2].includes(saved?.version) || !Array.isArray(saved.projects) || !Array.isArray(saved.chats)) return defaults;

  const decodedSettings = saved.settings || {};
  const settings = Object.fromEntries(Object.entries(defaults.settings).map(([key, fallback]) => [key, decodedSettings[key] ?? fallback]));
  // The old privacy:false flag meant offline, never permission to disclose originals.
  if (saved.version === 1 || settings.privacyMode !== 'raw') settings.privacyMode = 'redact';
  if (!['ask','auto','full'].includes(settings.permission)) settings.permission = 'ask';
  settings.privacyPolicy=normalisePrivacyPolicy(settings.privacyPolicy);
  settings.voiceLanguage=['zh-CN','en-US'].includes(settings.voiceLanguage)?settings.voiceLanguage:'zh-CN';
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
  return {
    version: 2, workspaceId, workspaces, projects, settings,
    drafts: settings.persist && saved.drafts && typeof saved.drafts === 'object' && !Array.isArray(saved.drafts)
      ? Object.fromEntries(Object.entries(saved.drafts).filter(([, draft]) => draft && typeof draft.text === 'string' && Array.isArray(draft.files)).map(([id, draft]) => [id, {
        draftId: typeof draft.draftId === 'string' ? draft.draftId : undefined,
        kind: draft.kind === 'chat' || draft.kind === 'new' ? draft.kind : undefined,
        workspaceId: typeof draft.workspaceId === 'string' ? draft.workspaceId : undefined,
        projectId: typeof draft.projectId === 'string' ? draft.projectId : null,
        chatId: typeof draft.chatId === 'string' ? draft.chatId : null,
        revision: Number.isSafeInteger(draft.revision) && draft.revision >= 0 ? draft.revision : 0,
        text: draft.text.slice(0, 60000),
        files: draft.files.slice(0, 12),
        updatedAt: Number.isFinite(draft.updatedAt) ? draft.updatedAt : Date.now(),
      }]))
      : {},
    appliedAutomationRuns: Array.isArray(saved.appliedAutomationRuns) ? saved.appliedAutomationRuns.filter(id => typeof id === 'string').slice(-240) : [],
    chats: chats.map(chat => ({
      ...chat,
      workspaceId: projectById.get(chat.projectId)?.workspaceId || chat.workspaceId || workspaceId,
      messages: (chat.messages || []).map(message => message.pending ? { ...message, pending: false, stopped: true, status: 'interrupted', text: message.progressText || message.text || '上次运行已中断。', progressText: '' } : message),
    })),
    automations: automations.map(task => ({ ...task, workspaceId: task.workspaceId || projectById.get(task.projectId)?.workspaceId || workspaceId, kind: task.kind || 'reminder', status: task.status === '运行中' ? '上次运行已中断' : task.status })),
    documents: documents.map(document => ({ ...document, workspaceId: document.workspaceId || workspaceId })),
  };
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
    const { drafts: _memoryDrafts, ...persisted } = state;
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
  return (chat?.messages || []).filter(message => !message.pending && !message.error && !message.stopped && message.text).map(message => {
    if (protectedView && message.role === 'user') return '';
    const text = protectedView ? message.masked ?? message.text : message.text;
    return `${message.role === 'user' ? '你' : message.imported ? 'DeepSeek（导入）' : '知行'}${message.demo ? '（本地演示）' : ''}\n${text}`;
  }).filter(Boolean).join('\n\n');
}

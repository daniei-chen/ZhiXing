import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowUpRight, Check, CircleNotch, Copy, DownloadSimple, FileText, FolderOpen, Globe, TerminalWindow, NotePencil, Plus, ShieldCheck, SidebarSimple, WarningCircle, Info } from '@phosphor-icons/react';
import { Titlebar, Sidebar, AppRail } from './Sidebar.jsx';
import { Composer } from './Composer.jsx';
import { Dialogs } from './Dialogs.jsx';
import { PrivacyReview, ExportReview } from './Review.jsx';
import { UtilityPage } from './UtilityPage.jsx';
import { Settings } from './Settings.jsx';
import {AgentQuestion} from './AgentQuestion.jsx';
import {Workbench} from './Workbench.jsx';
import {AnswerText} from './AnswerText.jsx';
import {ChatAttachments,ImportedActivity} from './ImportedChat.jsx';
import { BrandMark, IconButton } from './ui.jsx';
import { initialState, mergeState, saveState, downloadText, chatText } from './store.js';
import { PrivacySession } from './privacy-core.js';
import { composePrompt, workflows } from './office-workflows.js';
import { selectedModel } from './provider-options.js';
import { applyAutomationResults } from './automation-core.js';

const desktop = window.zhixing;
const uuid = () => crypto.randomUUID();
const errorText = error => error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
const readyFiles = /\.(txt|md|csv|tsv|json)$/i;
const demoReply = '这是一条本地演示回复。\n\n连接 DeepSeek 后，知行会根据本次交办和所选材料生成实际成果。';
const sortChats = (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);

export function App() {
  const [state, setState] = useState(initialState);
  const [loaded, setLoaded] = useState(!desktop);
  const [nativeProjects,setNativeProjects]=useState(null);
  const [workspaceSave, setWorkspaceSave] = useState({ status: desktop ? 'recovering' : 'saved', requestedRevision: 0, persistedRevision: 0 });
  const [view, setView] = useState(() => ({ section: 'home', chatId: null, projectId: null, newDraftId: uuid() }));
  const [sidebarOpen, setSidebar] = useState(() => innerWidth > 700);
  const [panel, setPanel] = useState(false);
  const [workPage,setWorkPage]=useState('browser');
  const [customTab,setCustomTab]=useState('plugins');
  const [fileRequest,setFileRequest]=useState(null);
  const [input, setInputValue] = useState('');
  const [files, setFilesValue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [settingsPage, setSettingsPage] = useState(null);
  const [question,setQuestion]=useState(null);
  const [toast, setToastState] = useState(null);
  const [runtime, setRuntime] = useState({ configured: false });
  const [events, setEvents] = useState([]);
  const [liveStats, setLiveStats] = useState(null);
  const [unread, setUnread] = useState(false);
  const [running, setRunning] = useState(null);
  const [automationState, setAutomationState] = useState({ revision: -1, tasks: [], runs: [] });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const composer = useRef(null);
  const picker = useRef(null);
  const transcript = useRef(null);
  const active = useRef(null);
  const latest = useRef(state);
  const fileTarget = useRef(null);
  const opening = useRef(null);
  const viewToken = useRef(0);
  const storageFailed = useRef(false);
  const inputRef = useRef('');
  const filesRef = useRef([]);
  const draftMap = useRef({});
  const newDraftIds = useRef(new Map());
  const draftScopes = useRef({});
  const activeDraftKey = useRef('');
  const saveSequence = useRef(0);
  const latestSaveSequence = useRef(0);
  latest.current = state;

  function setToast(message, type) {
    if (!message) { setToastState(null); return; }
    const inferredType = type || (/失败|错误|无法|未保存|未发送|未完成|被拒绝|已中断|已占用|超过/.test(message) ? 'error'
      : /已保存|已创建|已复制|已加入|已导入|已恢复/.test(message) ? 'success' : 'info');
    setToastState({ message, type: inferredType });
  }

  function setInput(value) {
    const next = typeof value === 'function' ? value(inputRef.current) : value;
    inputRef.current = next;
    setInputValue(next);
    persistDraft(activeDraftKey.current, { text: next });
  }

  function setFiles(value) {
    const next = typeof value === 'function' ? value(filesRef.current) : value;
    filesRef.current = next;
    setFilesValue(next);
    persistDraft(activeDraftKey.current, { files: next });
  }

  function draftKeyFor({ workspaceId, projectId, chatId, newDraftId }) {
    const key = chatId ? `chat:${chatId}` : `new:${workspaceId}:${projectId || 'home'}:${newDraftId}`;
    draftScopes.current[key] = { kind: chatId ? 'chat' : 'new', workspaceId, projectId: projectId || null, chatId: chatId || null, draftId: chatId || newDraftId };
    return key;
  }

  function newDraftIdFor(workspaceId, projectId, fresh = false) {
    const scopeKey = `${workspaceId}:${projectId || 'home'}`;
    if (fresh || !newDraftIds.current.has(scopeKey)) {
      const existing = !fresh && Object.values(draftMap.current).filter(draft => draft.kind === 'new' && draft.workspaceId === workspaceId && (draft.projectId || null) === (projectId || null)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      newDraftIds.current.set(scopeKey, existing?.draftId || uuid());
    }
    return newDraftIds.current.get(scopeKey);
  }

  function persistDraft(key, patch, expectedRevision) {
    if (!key) return null;
    const previous = draftMap.current[key] || { revision: 0, text: '', files: [], updatedAt: Date.now() };
    if (expectedRevision !== undefined && previous.revision !== expectedRevision) return null;
    const next = { ...previous, ...(draftScopes.current[key] || {}), ...patch, revision: previous.revision + 1, updatedAt: Date.now() };
    draftMap.current = { ...draftMap.current, [key]: next };
    setState(current => ({ ...current, drafts: draftMap.current }));
    return next;
  }

  function clearSubmittedDraft(key, revision) {
    const current = draftMap.current[key] || { revision: 0, text: '', files: [] };
    if (current.revision !== revision) return false;
    const cleared = { ...current, revision: current.revision + 1, text: '', files: [], updatedAt: Date.now() };
    draftMap.current = { ...draftMap.current, [key]: cleared };
    setState(value => ({ ...value, drafts: draftMap.current }));
    if (activeDraftKey.current === key) {
      inputRef.current = ''; filesRef.current = [];
      setInputValue(''); setFilesValue([]);
    }
    return true;
  }

  async function retryWorkspaceSave() {
    if (['saving', 'recovering'].includes(workspaceSave.status)) return;
    const sequence = ++saveSequence.current;
    latestSaveSequence.current = sequence;
    setWorkspaceSave(previous => ({ ...previous, status: 'saving' }));
    try {
      if (!desktop) saveState(latest.current);
      else if (desktop.retryWorkspaceSave) await desktop.retryWorkspaceSave();
      else {
        const current = latest.current;
        const snapshot = current.settings.persist ? current : { ...current, chats: [], documents: [], drafts: {}, automations: [], settings: { ...current.settings, customTerms: [] } };
        await desktop.saveWorkspace(snapshot);
      }
      if (sequence !== latestSaveSequence.current) return;
      if (desktop?.workspaceSaveStatus) {
        const status = await desktop.workspaceSaveStatus();
        setWorkspaceSave(previous => status.requestedRevision >= (previous.requestedRevision || 0) ? { ...previous, ...status } : previous);
      } else setWorkspaceSave(previous => ({ ...previous, status: 'saved', errorCode: undefined }));
    } catch (error) {
      if (sequence !== latestSaveSequence.current) return;
      setWorkspaceSave(previous => ({ ...previous, status: 'failed', errorCode: errorText(error) || 'WORKSPACE_SAVE_FAILED' }));
    }
  }

  const { section, chatId, projectId } = view;
  const workspace = state.workspaces.find(space => space.id === state.workspaceId) || state.workspaces[0];
  const modeWorkspaceIds=new Set(state.workspaces.filter(space=>space.type===workspace.type).map(space=>space.id));
  const projects = state.projects.filter(project => modeWorkspaceIds.has(project.workspaceId));
  const spaceChats = state.chats.filter(chat => modeWorkspaceIds.has(chat.workspaceId));
  const chats = spaceChats.filter(chat => !chat.archived).sort(sortChats);
  const documents = state.documents.filter(document => modeWorkspaceIds.has(document.workspaceId));
  const automations = (desktop ? automationState.tasks : state.automations).filter(task => modeWorkspaceIds.has(task.workspaceId));
  const taskRuns = (desktop ? automationState.runs : []).filter(run => modeWorkspaceIds.has(run.workspaceId));
  const chat = chats.find(item => item.id === chatId);
  const project = projects.find(item => item.id === (chat?.projectId || projectId));
  const scopeReady=!desktop||!project||nativeProjects?.some(item=>item.id===project.id&&item.workspaceId===project.workspaceId&&(item.directory||null)===(project.directory||null));
  const messages = chat?.messages || [];
  const mode = workspace.type === 'government' ? 'government' : 'office';
  const isDark = state.settings.theme === 'dark' || (state.settings.theme === 'system' && systemDark);
  const runningHere = !!running && running.chatId === chatId;
  const room = section === 'home' || section === 'project';

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = event => setSystemDark(event.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (desktop && loaded && automationState.runs.length) {
      setState(current => applyAutomationResults(current, automationState.runs));
    }
  }, [loaded, automationState]);

  useEffect(() => {
    if (!desktop) return;
    let mounted = true;
    desktop.loadWorkspace().then(saved => {
      if(mounted){
        const initial=mergeState(saved);
        draftMap.current = initial.settings.persist ? initial.drafts || {} : {};
        if(saved)setState(initial);
        setNativeProjects(initial.projects);
      }
    }).catch(() => {
      if (!mounted) return;
      storageFailed.current = true;
      setWorkspaceSave({ status: 'failed', requestedRevision: 0, persistedRevision: 0, errorCode: '无法读取本机工作空间。' });
      setToast('本地工作空间无法读取，已保留磁盘上的数据。');
    }).finally(() => { if (mounted) setLoaded(true); });
    desktop.runtimeStatus().then(status => { if (mounted) setRuntime(status); }).catch(() => {});
    const unsubscribe = desktop.onRuntimeEvent(event => {
      const job = active.current;
      if(event.type==='question'){setQuestion(event);return;}
      if(event.type==='question-closed'){setQuestion(previous=>previous?.requestId===event.requestId?null:previous);return;}
      if(event.type==='live-stats'){
        if(job?.runId===event.runId)setLiveStats({runId:event.runId,context:event.context});
        return;
      }
      if(event.type==='draft'){
        if(job?.runId===event.runId)patchReply(job,{progressText:event.text});
        return;
      }
      const time = event.time ?? Date.now();
      if(job?.runId===event.runId && event.label){
        // Store the trace summary without duplicating full plans and agent snapshots.
        const {children,plan,...summary} = event;
        job.trace.push({...summary,time});
        if(job.trace.length>400){job.trace.shift();job.traceTruncated=true;}
      }
      setEvents(old => [...old.slice(-599), { ...event, time }]);
    });
    const applySaveState = snapshot => {
      if (!mounted || !snapshot || typeof snapshot !== 'object') return;
      setWorkspaceSave(previous => {
        const previousRevision = previous.requestedRevision || 0;
        const nextRevision = snapshot.requestedRevision || 0;
        if (nextRevision < previousRevision) return previous;
        if (nextRevision === previousRevision && previous.status === 'failed' && snapshot.status !== 'failed'
          && (snapshot.persistedRevision || 0) < nextRevision) return previous;
        return { ...previous, ...snapshot };
      });
    };
    const unsubscribeSave = desktop.onWorkspaceSaveState?.(applySaveState) || (() => {});
    desktop.workspaceSaveStatus?.().then(applySaveState).catch(() => {});
    const applyAutomations = snapshot => {
      if (!mounted) return;
      setAutomationState(previous => snapshot.revision > previous.revision ? snapshot : previous);
      if (snapshot.runs.some(run => run.finishedAt && run.finishedAt > Date.now() - 5000)) setUnread(true);
    };
    const unsubscribeAutomations = desktop.onAutomationChange(applyAutomations);
    desktop.listAutomations().then(applyAutomations).catch(() => setToast('自动化记录读取失败，请重新启动知行。'));
    return () => { mounted = false; unsubscribe(); unsubscribeAutomations(); unsubscribeSave(); };
  }, []);

  const renderedDraftKey = draftKeyFor({ workspaceId: workspace.id, projectId: chat?.projectId || projectId, chatId, newDraftId: view.newDraftId });
  useLayoutEffect(() => {
    if (!loaded || activeDraftKey.current === renderedDraftKey) return;
    if (!chatId) newDraftIds.current.set(`${workspace.id}:${chat?.projectId || projectId || 'home'}`, view.newDraftId);
    activeDraftKey.current = renderedDraftKey;
    const draft = draftMap.current[renderedDraftKey] || { revision: 0, text: '', files: [], updatedAt: Date.now() };
    inputRef.current = draft.text;
    filesRef.current = draft.files;
    setInputValue(draft.text);
    setFilesValue(draft.files);
  }, [loaded, renderedDraftKey]);

  useEffect(() => {
    if (!loaded || storageFailed.current) return;
    if (desktop) {
      const sequence = ++saveSequence.current;
      latestSaveSequence.current = sequence;
      const snapshot = state.settings.persist ? state : { ...state, chats: [], documents: [], drafts: {}, automations: [], settings: { ...state.settings, customTerms: [] } };
      setWorkspaceSave(previous => previous.status === 'failed' ? previous : ({ ...previous, status: 'saving', errorCode: undefined }));
      desktop.saveWorkspace(snapshot).then(()=>{
        if (sequence !== latestSaveSequence.current) return;
        setNativeProjects(snapshot.projects);
        if (desktop.workspaceSaveStatus) desktop.workspaceSaveStatus().then(status => {
          if (sequence === latestSaveSequence.current) setWorkspaceSave(previous => status.requestedRevision >= (previous.requestedRevision || 0) ? { ...previous, ...status } : previous);
        }).catch(() => {});
        else setWorkspaceSave(previous => previous.status === 'failed' ? previous : { ...previous, status: 'saved', persistedRevision: Math.max(previous.persistedRevision || 0, previous.requestedRevision || 0) });
      }).catch(error=>{
        if (sequence !== latestSaveSequence.current) return;
        const message=errorText(error);
        setWorkspaceSave(previous => ({ ...previous, status: 'failed', errorCode: message || 'WORKSPACE_SAVE_FAILED' }));
      });
    } else {
      setWorkspaceSave(previous => ({ ...previous, status: 'saving', errorCode: undefined }));
      try { saveState(state); setWorkspaceSave(previous => ({ ...previous, status: 'saved', errorCode: undefined })); }
      catch (error) {
        const message = error.message || '浏览器存储失败';
        setWorkspaceSave(previous => ({ ...previous, status: 'failed', errorCode: message }));
        setToast(`浏览器存储失败：${message}`, 'error');
      }
    }
  }, [state, loaded]);

  useEffect(() => {
    if (!toast) return;
    if (toast.type === 'error') return;
    const timer = setTimeout(() => setToast(null), 4300);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [chatId, messages.length, running]);

  useEffect(() => {
    if (!menu) return;
    const close = event => { if (!event.target.closest('.dropdown')) setMenu(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  useEffect(() => {
    const shortcut = event => {
      if (event.key === 'Escape') { if (modal) return; if (settingsPage) setSettingsPage(null); setMenu(null); return; }
      if ((!event.ctrlKey && !event.metaKey) || event.isComposing || modal || !loaded) return;
      const key = event.key.toLowerCase();
      if (key==='t'){event.preventDefault();setWorkPage('browser');setPanel(true);return;}
      if (key==='`'){event.preventDefault();setWorkPage('terminal');setPanel(true);return;}
      if (key==='p'){event.preventDefault();setWorkPage('files');setPanel(true);return;}
      if (key === 'k') { event.preventDefault(); openModal({ type: 'search' }); }
      if (key === 'n') { event.preventDefault(); newChat(); }
      if (key === 'o') { event.preventDefault(); void chooseFiles(room ? 'draft' : 'library'); }
      if (key === ',') { event.preventDefault(); openModal({ type: 'settings' }); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });

  function setSetting(name, value) {
    if(name==='persist'&&!value&&active.current){setToast('请先停止正在运行的任务，再关闭本地保存。');return;}
    setState(current => {
      if (name === 'modelSelection') {
        const settings = { ...current.settings, model: value.id, modelProviderId: value.providerId || null };
        if (value.levels?.length && !value.levels.includes(settings.reasoning)) {
          settings.reasoning = value.levels.includes('high') ? 'high' : value.levels[0];
        }
        return { ...current, settings };
      }
      if (current.settings[name] === value) return current;
      const settings = { ...current.settings, [name]: value };
      if (name !== 'privacyMode') return { ...current, settings };
      return { ...current, settings, automations: current.automations.map(task => task.kind === 'agent' && task.enabled ? { ...task, enabled: false, status: '发送方式已变更，待启用' } : task) };
    });
  }

  function openModal(value) {
    if (value?.type === 'settings') { setSettingsPage(value); setModal(null); }
    else setModal(value);
    setMenu(null);
  }
  function toggleMenu(name, event) { event?.stopPropagation(); setMenu(previous => previous?.name === name ? null : { name }); }

  function navigate(next, nextChat = null, nextProject = null, freshDraft = false, workspaceOverride = null) {
    viewToken.current++;
    setSettingsPage(null);
    const projectWorkspaceId = nextProject ? latest.current.projects.find(item => item.id === nextProject)?.workspaceId : null;
    const targetWorkspaceId = workspaceOverride || projectWorkspaceId || (nextChat ? latest.current.chats.find(item => item.id === nextChat)?.workspaceId : null) || latest.current.workspaceId;
    const nextView = { section: next, chatId: nextChat, projectId: nextProject, newDraftId: newDraftIdFor(targetWorkspaceId, nextProject, freshDraft) };
    const nextDraftKey = draftKeyFor({ ...nextView, workspaceId: targetWorkspaceId });
    const nextDraft = draftMap.current[nextDraftKey] || { text: '', files: [] };
    activeDraftKey.current = nextDraftKey;
    inputRef.current = nextDraft.text;
    filesRef.current = nextDraft.files;
    setInputValue(nextDraft.text);
    setFilesValue(nextDraft.files);
    setView(nextView);
    setMenu(null); setModal(null);
    setFileRequest(null);
    if (innerWidth <= 700) setSidebar(false);
  }

  function newChat(nextProject = null) {
    if (nextProject) {
      const target = projects.find(item => item.id === nextProject);
      if (!target) return;
      setState(current => ({ ...current, workspaceId: target.workspaceId, workspaces: current.workspaces.map(space => space.id === target.workspaceId ? { ...space, projectId: nextProject } : space) }));
      navigate('project', null, nextProject, true);
    } else navigate('home', null, null, true);
    requestAnimationFrame(() => composer.current?.focus());
  }

  function selectProject(id) {
    const target=projects.find(item=>item.id===id);if(!target)return;
    setState(current => ({ ...current,workspaceId:target.workspaceId,workspaces: current.workspaces.map(space => space.id === target.workspaceId ? { ...space, projectId: id } : space) }));
    navigate('project', null, id);
  }

  function openChat(id) {
    const selected = chats.find(item => item.id === id && !item.archived);
    if (selected) {setState(current=>({...current,workspaceId:selected.workspaceId}));navigate('home', id, selected.projectId);}
  }

  async function importDeepSeek() {
    const result = await desktop.importDeepSeekChats({workspaceId:workspace.id,projectId:project?.id||null});
    if(result?.chats.length)setState(current=>({...current,chats:[...current.chats,...result.chats]}));
    return result;
  }

  function changeWorkspace(id) {
    if (!latest.current.workspaces.some(space => space.id === id)) return;
    if (id !== workspace.id) {
      setState(current => ({ ...current, workspaceId: id }));
      navigate('home', null, null, false, id); setPanel(false);
    }
    setMenu(null);
  }

  function saveWorkspace({ id, name, type, directory }) {
    const newId = id || uuid();
    setState(current => {
      if (id) return { ...current, workspaces: current.workspaces.map(space => space.id === id ? { ...space, name, type, directory } : space) };
      return { ...current, workspaceId: newId, workspaces: [...current.workspaces, { id: newId, name, type, directory, projectId: null }] };
    });
    if (!id) navigate('home');
    setModal(null); setToast(id ? '工作空间已保存。' : '工作空间已创建。');
  }

  function createProject(name, instructions = '', directory = null, worktree = null) {
    const id = uuid();
    setState(current => ({ ...current, projects: [...current.projects, { id, name, instructions,directory,workspaceId: workspace.id, expanded: true, ...(worktree?{worktree}:{}) }], workspaces: current.workspaces.map(space => space.id === workspace.id ? { ...space, projectId: id } : space) }));
    navigate('project', null, id);
  }

  function updateProject(id, patch) {
    setState(current => ({ ...current, projects: current.projects.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }

  function updateChat(id, patch) {
    setState(current => ({ ...current, chats: current.chats.map(item => item.id === id ? { ...item, ...patch } : item) }));
    if (patch.archived && chatId === id) navigate('home');
    setMenu(null);
  }

  function useTemplate(text) {
    if (!room) navigate('home');
    setInput(text); setModal(null); setMenu(null);
    requestAnimationFrame(() => composer.current?.focus());
  }

  function addParsed(imported, target, spaceId, token, draftKey = activeDraftKey.current, requestRevision) {
    if (!imported.length) return;
    if (target === 'library') {
      setState(current => ({ ...current, documents: [...current.documents, ...imported.map(file => ({ ...file, workspaceId: spaceId }))] }));
    } else {
      const current = draftMap.current[draftKey] || { revision: 0, text: '', files: [], updatedAt: Date.now() };
      const known = new Set(current.files.map(file => file.id));
      const nextFiles = [...current.files, ...imported.filter(file => !known.has(file.id))].slice(0, 12);
      if (!persistDraft(draftKey, { files: nextFiles }, requestRevision)) {
        setToast('读取附件期间，这份交办已修改。请重新添加附件。', 'warning');
        return;
      }
      if (draftKey === activeDraftKey.current && token === viewToken.current) {
        filesRef.current = nextFiles;
        setFilesValue(nextFiles);
      }
    }
    if (imported.some(file => file.status !== 'ready')) setToast('部分文件无法解析。点击文件可查看原因。');
  }

  async function chooseFiles(target = 'draft') {
    setMenu(null);
    if (opening.current || busy || !loaded) return;
    const request = { target, spaceId: workspace.id, token: viewToken.current, draftKey: activeDraftKey.current, draftRevision: (draftMap.current[activeDraftKey.current] || { revision: 0 }).revision };
    if (!desktop?.pickFiles) { fileTarget.current = request; picker.current?.click(); return; }
    opening.current = request;
    setBusy(true);
    try { addParsed(await desktop.pickFiles(project?.directory), target, request.spaceId, request.token, request.draftKey, request.draftRevision); }
    catch (error) { setToast(errorText(error)); }
    finally { opening.current = null; setBusy(false); }
  }

  async function addFiles(list, target = 'draft', spaceId = workspace.id, token = viewToken.current, draftKey = activeDraftKey.current) {
    const draftRevision = (draftMap.current[draftKey] || { revision: 0 }).revision;
    setBusy(true);
    try {
      const imported = [];
      for (const file of Array.from(list || []).slice(0, 12)) {
        const meta = { id: uuid(), name: file.name, size: file.size };
        try {
          if (file.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB。');
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (desktop) imported.push({ ...meta, ...await desktop.parseFile({ name: file.name, bytes }) });
          else {
            if (!readyFiles.test(file.name)) throw new Error('浏览器预览仅解析文本。');
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            if (text.includes('\0') || text.length > 220000) throw new Error('请使用较短的 UTF-8 文本。');
            imported.push({ ...meta, text, status: 'ready' });
          }
        } catch (error) { imported.push({ ...meta, status: 'error', reason: errorText(error), text: '' }); }
      }
      addParsed(imported, target, spaceId, token, draftKey, draftRevision);
    } finally { setBusy(false); }
  }

  function attach(document) {
    if (!modeWorkspaceIds.has(document.workspaceId)) return;
    if (document.status !== 'ready') { openModal({ type: 'document', value: document }); return; }
    if (!room) { navigate('home'); setFiles([document]); }
    else setFiles(previous => previous.some(file => file.id === document.id) ? previous : [...previous, document].slice(0, 12));
    setModal(null);
  }

  function patchReply(job, patch) {
    if (Object.hasOwn(patch, 'progressText')) job.progressText = patch.progressText;
    setState(current => ({ ...current, chats: current.chats.map(item => item.id !== job.chatId ? item : {
      ...item, updatedAt: Date.now(), messages: item.messages.map(message => message.id === job.replyId ? { ...message, ...patch } : message),
    }) }));
  }

  function localCommand(command) {
    setInput('');
    if(command==='/model')setMenu({name:'models'});
    else if(command==='/settings')openModal({type:'settings'});
    else if(command==='/skills'){setCustomTab('skills');navigate('skills');}
  }

  async function submit(repeatMessageId = null) {
    if (!loaded || active.current || busy) return;
    const repeatIndex = repeatMessageId ? messages.findIndex(message => message.id === repeatMessageId) : -1;
    const previous = repeatIndex >= 0 ? messages.slice(0, repeatIndex).findLast(message => message.role === 'user') : null;
    if (repeatMessageId && !previous) return;
    const text = repeatMessageId ? previous.text : input.trim();
    if(!repeatMessageId&&['/model','/settings','/skills'].includes(text)){localCommand(text);return;}
    const attachments = repeatMessageId ? [] : files;
    if (!text && !attachments.length) return;
    if (attachments.some(file => file.status !== 'ready')) { setToast('请移除无法解析的附件后再发送。'); return; }
    const draftKey = repeatMessageId ? null : activeDraftKey.current;
    const sourceDraft = draftMap.current[draftKey] || { revision: 0 };
    const submittedRevision = sourceDraft.revision;
    const repeatedFiles = repeatMessageId ? previous.files || [] : [];
    const planText = text?.match(/^\/plan(?:\s+([\s\S]*))?$/)?.[1]?.trim();
    const startInPlanMode = Boolean((repeatMessageId && previous?.startInPlanMode)
      || (planText && planText !== 'off')
      || (text === '/plan' && attachments.length));
    const command = !startInPlanMode && /^\/(compact|plan|goal)(?:\s|$)/.test(text || '') ? text : undefined;
    if (command && attachments.length) {
      setToast('此命令不会读取附件。请移除附件或改为交办内容。');
      return;
    }
    const selection = selectedModel(runtime, state.settings);
    const selectedProvider = runtime.providers?.find(provider => provider.id === selection?.providerId);
    const unboundImport = chat?.importedFrom==='deepseek'&&!chat.providerId;
    const providerChanged = !state.settings.demo && !!chat?.messages?.length && !!selectedProvider && !unboundImport
      && ((chat.providerId || 'deepseek') !== selectedProvider.id || (chat.providerUrl && chat.providerUrl !== selectedProvider.baseUrl));
    const forkScheduled = !state.settings.demo && !!chat?.automationTaskId;
    const sessionId = !providerChanged && !forkScheduled && chat?.id || uuid();
    const preferences = state.settings.personalizationEnabled ? state.settings.personalInstructions : '';
    const taskText = startInPlanMode ? planText || '' : text;
    const prompt = repeatMessageId && previous?.prompt ? previous.prompt : composePrompt(taskText, attachments, [], project?.instructions, preferences);
    const { privacyMode, reasoning, permission, customTerms,privacyPolicy,demo } = state.settings;
    const model = selection?.id || state.settings.model;
    const modelProviderId = selection?.providerId;
    const bootstrapPrompt=repeatMessageId || providerChanged ? prompt : composePrompt(taskText, attachments, messages, project?.instructions, preferences);
    const draft = { sessionId, workspaceId: workspace.id, projectId: project?.id || null, text: text || '请处理附件。', attachments, files: repeatedFiles, prompt, repeatExecution: !!repeatMessageId, draftKey, submittedRevision, mode, model, reasoning, privacyMode, startInPlanMode };
    if (demo) {
      const local = new PrivacySession(sessionId).protect(prompt, customTerms,privacyPolicy);
      if (local.blocked) { openModal({ type: 'privacy', original: prompt, preview: local, blocked: true }); return; }
      await startReply(draft, { text: privacyMode === 'raw' ? prompt : local.text, privacyMode }, true);
      return;
    }
    if (!desktop || !runtime.configured) { openModal({ type: 'settings', tab: '供应商' }); return; }
    const token = viewToken.current;
    setBusy(true);
    try {
      const preview = await desktop.prepareRun({ sessionId, prompt,bootstrapPrompt,command,startInPlanMode,mode, model, modelProviderId, reasoning, permission, workspaceId: workspace.id,projectId:project?.id||null,customTerms,privacyMode,privacyPolicy });
      if (token === viewToken.current) {
        if(preview.blocked)openModal({ type: 'privacy', original: `任务模式：${mode === 'government' ? '政务' : '办公'}\n\n${prompt}`, preview, blocked:true });
        else {
          if (providerChanged) setToast('已为新供应商开启聊天，上一段聊天留在原处。');
          else if (forkScheduled) setToast('已从任务聊天另开交办。');
          await startReply(draft,preview);
        }
      }
    } catch (error) { setToast(`未发送：${errorText(error)}`); }
    finally { setBusy(false); }
  }

  async function startReply(draft, preview, demo = false) {
    if (active.current || draft.workspaceId !== latest.current.workspaceId) return;
    if (draft.draftKey) clearSubmittedDraft(draft.draftKey, draft.submittedRevision);
    const job = { chatId: draft.sessionId, workspaceId: draft.workspaceId, replyId: uuid(), runId: uuid(), demo, trace: [] };
    active.current = job; setRunning(job);
    const user = { id: uuid(), role: 'user', text: draft.text, prompt: draft.prompt, protected: preview.text, privacyMode: preview.privacyMode, startInPlanMode: draft.startInPlanMode, files: (draft.attachments.length ? draft.attachments : draft.files || []).map(({ name, size }) => ({ name, size })) };
    const assistant = { id: job.replyId, role: 'assistant', text: '', pending: true, demo,privacyMode:preview.privacyMode,protectCount:preview.entities?.length||0 };
    setState(current => {
      const target = current.chats.find(item => item.id === draft.sessionId);
      const now = Date.now();
      if (!target) return { ...current, chats: [...current.chats, {
        id: draft.sessionId, projectId: draft.projectId, workspaceId: draft.workspaceId,
        providerId: preview.providerId, providerUrl: preview.baseUrl,
        title: draft.text.replace(/\s+/g, ' ').slice(0, 42), mode: draft.mode, createdAt: now, updatedAt: now, messages: [user, assistant],
      }] };
      const history = [...target.messages];
      history.push(user);
      const binding = target.importedFrom==='deepseek'&&!target.providerId&&!demo ? {providerId:preview.providerId,providerUrl:preview.baseUrl} : {};
      return { ...current, chats: current.chats.map(item => item.id === target.id ? { ...item,...binding, updatedAt: now, messages: [...history, assistant] } : item) };
    });
    navigate('home', draft.sessionId, draft.projectId);
    try {
      const result = demo ? { text: demoReply, masked: demoReply } : await desktop.runPrepared({ runId: job.runId, preparationId: preview.preparationId });
      if (active.current === job) patchReply(job, { text: result.text || '内核没有返回正文。', masked: result.masked,plan:result.plan,context:result.context,children:result.children,deliverables:result.deliverables,protectCount:result.protectCount||0,pending: false, finishReason: result.finishReason, trace:job.trace, traceTruncated:job.traceTruncated });
    } catch (error) {
      if (active.current === job) patchReply(job, { text: `运行未完成：${errorText(error)}`, pending: false, error: true, trace:job.trace, traceTruncated:job.traceTruncated });
    } finally {
      if (active.current === job) { active.current = null; setRunning(null); }
    }
  }

  async function stop() {
    const job = active.current;
    if (!job) return;
    setRunning(previous => previous?.runId === job.runId ? { ...previous, status: 'cancelling' } : previous);
    patchReply(job, { status: 'cancelling' });
    if (!job.demo) {
      try {
        await desktop.cancelRun(job.runId);
        if (active.current === job) patchReply(job, { text: job.progressText || '已请求停止，正在等待任务结束…', pending: true, stopped: false, status: 'cancelling', trace: job.trace, traceTruncated: job.traceTruncated });
      } catch (error) { setToast(`停止状态未确认：${errorText(error)}`, 'error'); }
    }
  }

  async function taskAction(action) {
    if (!desktop) { setToast('请在桌面版运行自动化。'); return; }
    try { await action(); }
    catch (error) { setToast(errorText(error)); }
  }

  function toggleTask(task, enabled) {
    if (enabled && task.kind === 'agent') { openModal({ type: 'enable-task', value: task }); return; }
    void taskAction(() => desktop.toggleAutomation(task.id, enabled));
  }
  async function runTask(task){
    if(!desktop){setToast('请在桌面版运行自动化。');return;}
    if(task.kind==='agent'){openModal({type:'run-task',value:task});return;}
    await taskAction(()=>desktop.remindAutomation(task.id));
  }

  function openRun(run) {
    if (!run.result) return;
    const result = run.result;
    const chat = latest.current.chats.find(item => item.id === (result.chatId || result.sessionId) && !item.archived
      && item.messages.some(message => message.automationRunId === run.id)) ||
      (!result.chatId && latest.current.chats.find(item => item.id === result.sessionId && !item.archived));
    if (chat) { navigate('home', chat.id, chat.projectId); return; }
    const id = `archived-run-${run.id}`;
    setState(current => {
      if (current.chats.some(item => item.id === id && !item.archived)) return current;
      const fallback = { ...run, result: { ...result, chatId: id, targetKind: 'new' } };
      return applyAutomationResults({ ...current, chats: current.chats.filter(item => item.id !== id),
        appliedAutomationRuns: (current.appliedAutomationRuns || []).filter(item => item !== run.id) }, [fallback]);
    });
    navigate('home', id, result.projectId);
  }

  async function removeItem(item) {
    const ids = item.type === 'delete-project' ? spaceChats.filter(child => child.projectId === item.id).map(child => child.id) : [item.id];
    if (ids.includes(active.current?.chatId)) throw new Error('请先停止此会话的生成。');
    if (item.type === 'delete-project' && automations.some(task => task.projectId === item.id && task.status === '运行中')) throw new Error('请等此项目的任务运行结束。');
    if (item.type === 'delete-project' && desktop) for (const task of automations.filter(task => task.projectId === item.id)) await desktop.removeAutomation(task.id);
    for (const id of ids) await desktop?.forgetSession(id);
    setState(current => {
      const following = { ...current, chats: current.chats.filter(entry => !ids.includes(entry.id)) };
      if (item.type !== 'delete-project') return following;
      return { ...following,
        projects: current.projects.filter(project => project.id !== item.id),
        workspaces: current.workspaces.map(space => space.projectId === item.id ? { ...space, projectId: null } : space),
        automations: current.automations.filter(task => task.projectId !== item.id),
        documents: current.documents.map(document => document.projectId === item.id ? { ...document, projectId: null } : document),
      };
    });
    if (ids.includes(chatId) || (item.type === 'delete-project' && view.projectId === item.id)) navigate('home');
    setModal(null);
  }

  function openExport(message) {
    const original = message?.text || chatText(chat);
    if (!original) return;
    openModal({ type: 'export-review', original, masked: message?.masked ?? (message ? undefined : chatText(chat, { protectedView: true })), title: chat?.title || '知行成果' });
  }

  async function saveExport({ text, name, format }) {
    try {
      if (desktop) {
        const result = await desktop.exportFile({ text, name, format, directory: project?.directory });
        if (result.cancelled) return false;
      } else downloadText(`${name}.txt`, text);
      setToast('已保存交付文件。'); setModal(null); return true;
    } catch (error) { setToast(`导出失败：${errorText(error)}`); return false; }
  }

  const privacyView = ['privacy', 'send-review'].includes(modal?.type);
  const reviewOriginal = privacyView ? modal.original ?? (input || files.length ? composePrompt(input, files.filter(file => file.status === 'ready')) : '示例：联系人：测试员，电话 138-0000-0000。') : '';
  const visibleEvents = events.filter(event => spaceChats.some(item => item.id === event.sessionId));
  const workContext={workspaceId:workspace.id,projectId:project?.id||null,sessionId:chat?.id||null};
  const workScopeKey=`${workspace.id}:${project?.id||chat?.id||'home'}`;
  const runEvents=runningHere?events.filter(event=>event.runId===running.runId):[];
  const statsHere=runningHere&&liveStats?.runId===running.runId?liveStats.context:null;
  function showWorkPage(page){setWorkPage(page);setPanel(true);setMenu(null);}
  function attachWorkingMaterial(file){if(file.status!=='ready'){setToast('这份资料尚未解析。');return;}setFiles(old=>old.some(item=>item.id===file.id)?old:[...old,{...file,workspaceId:workspace.id}].slice(0,12));setToast('已加入本次交办，发送时按设置自动处理。');}
  async function openAnswerUrl(url){showWorkPage('browser');if(desktop)try{await desktop.browserAction({...workContext,action:'new',url});}catch(error){setToast(errorText(error));}}
  const scopeProps = { workspace, projects, chats, spaceChats, documents, automations, taskRuns, project, mode };

  return <div className={`app-shell ${isDark ? 'dark' : ''} ${sidebarOpen ? '' : 'sidebar-hidden'} ${settingsPage ? 'settings-open' : ''}`}>
    <div className="app-body" inert={!!modal || !!settingsPage||!!question} aria-hidden={settingsPage ? true : undefined}>
      <Titlebar desktop={desktop} sidebarOpen={sidebarOpen} setSidebar={setSidebar} workspace={workspace}/>
      {sidebarOpen && <Sidebar state={state} workspace={workspace} projects={projects} chats={chats} activeChat={chat?.id} runningChatId={running?.chatId} activeProject={project} section={section} newChat={newChat} openChat={openChat} selectProject={selectProject} navigate={navigate} changeWorkspace={changeWorkspace} updateChat={updateChat} expandProject={id => updateProject(id, { expanded: !projects.find(item => item.id === id)?.expanded })} menu={menu} toggleMenu={toggleMenu} closeMenu={() => setMenu(null)} openModal={openModal} unread={unread} automations={automations} documents={documents} chooseFiles={chooseFiles} customTab={customTab} setCustomTab={setCustomTab}/>}
      <main className={`main-panel ${panel&&room?'with-workbench':''}`}>
        <div className="main-columns">
          <div className="main-content">
        <div className="main-topbar">
          <div className="top-path">{panel&&room?<><FolderOpen size={15}/><strong title={chat?.title||project?.name||workspace.name}>{chat?.title||project?.name||workspace.name}</strong></>:<><button onClick={() => navigate('home')}>{workspace.name}</button>{project && <><span>/</span><button onClick={() => selectProject(project.id)}>{project.name}</button></>}{chat && <><span>/</span><strong title={chat.title}>{chat.title}</strong></>}</>}</div>
          <div className="top-actions">
            {chat && (panel?<IconButton icon={DownloadSimple} label="导出聊天" onClick={()=>openExport()}/>:<button className="header-action" onClick={() => openExport()}><DownloadSimple size={17}/>导出</button>)}
            {running && !runningHere && <button className="header-action" onClick={() => running.workspaceId === workspace.id ? openChat(running.chatId) : changeWorkspace(running.workspaceId)}><CircleNotch size={16}/>正在生成</button>}
            {room&&!panel&&<><IconButton icon={Globe} label="打开内置浏览器" onClick={()=>showWorkPage('browser')}/><IconButton icon={FolderOpen} label="浏览项目文件" onClick={()=>showWorkPage('files')}/><IconButton icon={TerminalWindow} label="打开交互终端" onClick={()=>showWorkPage('terminal')}/>{chat&&<IconButton icon={CircleNotch} label="打开执行轨迹" onClick={()=>showWorkPage('activity')}/>}<IconButton icon={SidebarSimple} label="打开工作面板" aria-expanded={false} onClick={()=>setPanel(true)}/></>}
          </div>
        </div>
            {room ? <>
              {chat ? <section className="transcript" ref={transcript} aria-label="聊天记录">
                {!messages.length && <p className="transcript-empty">这段聊天还没有消息。</p>}
                {messages.map((message, index) => message.role === 'user' ? <article className="user-message" key={message.id || index}>{message.text&&<p>{message.text}</p>}<ChatAttachments files={message.files}/></article> : <article className={`assistant-message ${message.error ? 'error-message' : ''}`} key={message.id || index}>
                  <div className="assistant-byline"><span className="assistant-icon"><NotePencil size={17}/></span><strong>{message.imported?'DeepSeek':'知行'}</strong><small>{message.imported?'导入记录':message.demo ? '演示回复' : message.error ? '运行错误' : message.stopped ? '已停止' : message.privacyMode === 'raw' ? '非脱敏模式' : '脱敏模式'}</small></div>
                  {message.imported&&<ImportedActivity message={message} onOpenUrl={openAnswerUrl}/>}
                  <AgentChildren items={message.pending?runEvents.findLast(event=>event.type==='subagents')?.children:message.children} onView={()=>showWorkPage('activity')}/>
                  <TaskPlan items={message.pending?events.findLast(event=>event.runId===running?.runId&&event.type==='plan')?.plan:message.plan}/>
                  {message.deliverables?.length>0&&<div className="deliverable-files">{message.deliverables.map((file,index)=><button key={index} onClick={()=>{showWorkPage('files');setFileRequest({path:file.path,revision:uuid()});}}><FileText size={18}/><span><strong>{file.path.split(/[\\/]/).at(-1)}</strong><small>{file.description||'成果文件'}</small></span></button>)}</div>}
                  {message.context?.planning&&<p className="context-usage">规划模式 · 只读调查与方案设计 <button disabled={!!running} onClick={()=>setInput('/plan off')}>退出规划模式</button></p>}
                  {message.context?.goal&&<p className="context-usage">持续目标 · {({active:'进行中',paused:'已暂停',complete:'已完成',blocked:'需要补充'})[message.context.goal.phase]||message.context.goal.phase} · 第 {message.context.goal.roundsStarted} / {message.context.goal.maxGoalRounds} 轮 <button disabled={!!running} onClick={()=>setInput(message.context.goal.phase==='active'?'/goal pause':'/goal resume')}>{message.context.goal.phase==='active'?'暂停目标':'查看并继续'}</button></p>}
                  {message.pending&&message.progressText&&<AnswerText text={message.progressText} onOpenUrl={openAnswerUrl}/>}
                  {message.pending ? <div className="thinking-label" role="status"><CircleNotch size={17}/>{events.findLast(event => event.sessionId === chatId)?.label || '正在生成…'}</div> : <AnswerText text={message.text} onOpenUrl={openAnswerUrl}/>}
                  {message.context?.measurement&&<p className="context-usage">上下文 {message.context.measurement.totalTokens.toLocaleString()} / {(message.context.pressure?.contextWindow||128000).toLocaleString()} tokens · <button type="button" onClick={()=>setInput('/compact')} disabled={!!running}>压缩上下文</button></p>}
                  {message.finishReason === 'max-tokens' && <p className="muted">本轮达到输出上限，可以继续交办剩余部分。</p>}
                  {!message.pending && <div className="answer-actions">
                    {!message.error && !message.stopped && <><IconButton icon={Copy} label="复制回复" onClick={() => navigator.clipboard.writeText(message.text).then(() => setToast('已复制。')).catch(() => setToast('请选中文字后复制。'))}/><IconButton icon={DownloadSimple} label="导出成果" onClick={() => openExport(message)}/></>}
                    {index === messages.length - 1 && !message.imported && <IconButton icon={ArrowCounterClockwise} label="再次执行" disabled={!!running || busy} onClick={() => submit(message.id)}/>}
                    {message.masked && <IconButton icon={ShieldCheck} label="查看发送详情" onClick={() => {
                      const source = messages.slice(0, index).findLast(item => item.role === 'user');
                      openModal({ type: 'privacy', original: source?.prompt || source?.text, preview: { text: source?.protected, privacyMode: source?.privacyMode }, output: message.masked });
                    }}/>}
                  </div>}
                </article>)}
              </section> : <div className="empty-stage"><section className="welcome" aria-label={project ? '项目交办' : '新建交办'}>
                {project ? <span className="welcome-icon"><FolderOpen size={28} weight="light"/></span> : <BrandMark className="brand-welcome"/>}
                <h1>{project ? project.name : mode === 'government' ? '今天要办理什么？' : '今天，有什么事交给知行？'}</h1>
                <p>{project ? `${chats.filter(item => item.projectId === project.id).length} 段聊天` : '知你所需，行你所托。'}</p>
                <div className="quick-workflows">{workflows[mode].slice(0, 3).map(([label, prompt]) => <button key={label} onClick={() => useTemplate(prompt)}>{label}<ArrowUpRight size={13}/></button>)}</div>
                {project && <button className="text-button" onClick={() => openModal({ type: 'project-settings', value: project })}>项目说明</button>}
              </section></div>}
              <Composer settings={state.settings} files={files} input={input} setInput={setInput} setFiles={setFiles} setSetting={setSetting} onSubmit={() => submit()} onStop={stop} running={runningHere} disabled={!loaded || (!!running && !runningHere)} busy={busy} chooseFiles={chooseFiles} addFiles={addFiles} openModal={openModal} menu={menu} toggleMenu={toggleMenu} closeMenu={() => setMenu(null)} composer={composer} runtime={runtime} setRuntime={setRuntime} openWorkbench={showWorkPage} scopeKey={viewToken.current} onLocalCommand={localCommand} suspended={!!modal||!!settingsPage||!!question}/>
            </> : <UtilityPage key={section} section={section} sidebarOpen={sidebarOpen} scope={scopeProps} chooseFiles={chooseFiles} attach={attach} toggleTask={toggleTask} runTask={runTask} taskAction={taskAction} openRun={openRun} openModal={openModal} openChat={openChat} useTemplate={useTemplate} events={visibleEvents} customTab={customTab} setCustomTab={setCustomTab}/>}
          </div>
          {room&&<Workbench key={workScopeKey} visible={panel} suspended={!!modal||!!settingsPage||!!question} onClose={()=>setPanel(false)} page={workPage} setPage={setWorkPage} context={workContext} scopeKey={workScopeKey} scopeReady={scopeReady} scopeError={workspaceSave.status==='failed'?(workspaceSave.errorCode||'本机工作空间保存失败。'):''} project={project} files={files} fileRequest={fileRequest} statsContext={statsHere||messages.findLast(message=>message.context)?.context} statsLive={!!statsHere} liveTrace={runEvents} liveRun={runningHere?running.runId:null} traceTruncated={runningHere&&running.traceTruncated} messages={messages} attach={attachWorkingMaterial} openProject={()=>openModal(project?{type:'project-settings',value:project}:{type:'new-project'})} mode={mode} privacyMode={state.settings.privacyMode}/>}

        </div>
      </main>
    </div>
    {settingsPage && <div className="settings-shell" inert={!!modal||!!question}>
      <Titlebar desktop={desktop} sidebarOpen={sidebarOpen} setSidebar={setSidebar} workspace={workspace} settingsMode/>
      <AppRail section={section} settings navigate={navigate} openModal={openModal}/>
      <Settings key={settingsPage.tab || '常规'} modal={settingsPage} close={() => setSettingsPage(null)} setModal={openModal} state={state} scope={scopeProps} setSetting={setSetting} runtime={runtime} setRuntime={setRuntime} changeWorkspace={changeWorkspace} notify={setToast}/>
    </div>}
    <input hidden ref={picker} type="file" accept=".txt,.md,.csv,.tsv,.json,.docx,.xlsx,.pptx,.pdf,.png,.jpg,.jpeg,.bmp,.tif,.tiff" multiple onChange={event => {
      const list = Array.from(event.target.files); event.target.value = '';
      const request = fileTarget.current; fileTarget.current = null;
      if (request) void addFiles(list, request.target, request.spaceId, request.token);
    }}/>
    <section className={`workspace-save-banner ${workspaceSave.status}`} role={workspaceSave.status === 'failed' ? 'alert' : 'status'} aria-live={workspaceSave.status === 'failed' ? 'assertive' : 'polite'}>
      {workspaceSave.status === 'failed' ? <WarningCircle size={17}/> : workspaceSave.status === 'saved' ? <Check size={17}/> : <CircleNotch className={workspaceSave.status === 'saving' ? 'spinning' : ''} size={17}/>}
      <span>{workspaceSave.status === 'failed' ? `工作空间保存失败：${workspaceSave.errorCode || '请检查磁盘空间和本机权限。'}` : workspaceSave.status === 'recovering' ? '正在读取并恢复本机工作空间…' : workspaceSave.status === 'saved' ? '工作空间已保存' : '正在保存工作空间…'}</span>
      {workspaceSave.status === 'failed' && <button type="button" className="secondary-button" onClick={() => void retryWorkspaceSave()}>重试保存</button>}
    </section>
    {toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>{toast.type === 'error' ? <WarningCircle size={15}/> : toast.type === 'success' ? <Check size={15}/> : <Info size={15}/>}<span>{toast.message}</span>{toast.type === 'error'&&<button type="button" className="toast-dismiss" aria-label="关闭错误提示" onClick={()=>setToast(null)}>×</button>}</div>}
    {question&&<AgentQuestion key={question.requestId} request={question} onAnswer={value=>desktop.answerQuestion(value)}/>}
    {privacyView && <PrivacyReview key={modal.type} modal={modal} original={reviewOriginal} terms={state.settings.customTerms} policy={state.settings.privacyPolicy} currentMode={state.settings.privacyMode} onClose={() => setModal(null)} onSettings={() => openModal({ type: 'settings', tab: '隐私与数据' })} onSend={() => startReply(modal.draft, modal.preview)}/>}
    {modal?.type === 'export-review' && <ExportReview title={modal.title} original={modal.original} masked={modal.masked} terms={state.settings.customTerms} desktop={!!desktop} onClose={() => setModal(null)} onExport={saveExport}/>}
    {modal && !privacyView && modal.type !== 'export-review' && <Dialogs key={`${modal.type}-${modal.id || ''}`} modal={modal} setModal={openModal} state={state} setState={setState} scope={scopeProps} openChat={openChat} importDeepSeek={importDeepSeek} runtime={runtime} setRuntime={setRuntime} setSetting={setSetting} useTemplate={useTemplate} removeItem={removeItem} updateChat={updateChat} createProject={createProject} updateProject={updateProject} saveWorkspace={saveWorkspace} changeWorkspace={changeWorkspace} attach={attach} taskAction={taskAction} openRun={openRun} notify={setToast} markRead={() => setUnread(false)}/>}
  </div>;
}

function TaskPlan({items}) {
  if(!items?.length)return null;
  return <details className="agent-plan" open><summary>工作计划 · {items.filter(item=>item.status==='completed').length}/{items.length}</summary><ol>{items.map((item,index)=><li key={index} data-status={item.status}><span className="plan-status">{item.status==='completed'?<Check size={14}/>:item.status==='in_progress'?<CircleNotch size={14}/>:<span/>}</span><span>{item.content.replace(/⟦ZX-[^⟧]+⟧/g,'【已保护信息】')}</span></li>)}</ol></details>;
}

function AgentChildren({items,onView}){if(!items?.length)return null;return <div className="agent-children"><button className="text-button" onClick={onView}>查看 {items.length} 个协作子任务</button></div>;}

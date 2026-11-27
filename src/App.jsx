import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowUpRight, Check, CircleNotch, Copy, DownloadSimple, FileText, FloppyDisk, FolderOpen, ListBullets, NotePencil, ShareNetwork, ShieldCheck, SidebarSimple, ThumbsDown, ThumbsUp, WarningCircle, Info } from '@phosphor-icons/react';
import { Titlebar, Sidebar, AppRail } from './Sidebar.jsx';
import { contextUsageText, contextWindowTokens } from './context-window.js';
import { Composer } from './Composer.jsx';
import { Dialogs } from './Dialogs.jsx';
import { PrivacyReview, ExportReview } from './Review.jsx';
import { UtilityPage } from './UtilityPage.jsx';
import { Settings } from './Settings.jsx';
import {AgentQuestion} from './AgentQuestion.jsx';
import { ApprovalPanel } from './ApprovalPanel.jsx';
import { useRuntimeApprovals } from './use-runtime-approvals.js';
import {Workbench} from './Workbench.jsx';
import {ConversationResources} from './ConversationResources.jsx';
import {AnswerText} from './AnswerText.jsx';
import {DeliveryCards} from './DeliveryCards.jsx';
import { DeliveryPreview } from './DeliveryPreview.jsx';
import { useDeliveryPreview } from './use-delivery-preview.js';
import {ChangedFiles} from './ChangedFiles.jsx';
import {actionDoneLabel,actionFailureLabel} from './file-actions.js';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { StreamingAnswer } from './StreamingAnswer.jsx';
import { createKeyedStore } from './keyed-store.js';
import { createDebouncedWriter } from './debounced-writer.js';
import { registerRendererDurability } from './renderer-durability.js';
import {ChatAttachments,ImportedActivity} from './ImportedChat.jsx';
import { BrandMark, IconButton, MenuItem, Modal } from './ui.jsx';
import { initialState, mergeState, restoredDraftView, saveState, downloadText, chatText, workspaceDeletion, orphanDrafts, newConversationDrafts, appendDraftFiles, recoverSubmittedDraft } from './store.js';
import { errorText } from './error-copy.js';
import { consumeConversationDraft, finalizeConversationRun } from './conversation-state.js';
import { PrivacySession } from './privacy-core.js';
import { privacyPolicyForMode } from './privacy-policy.js';
import { composePrompt, workflows } from './office-workflows.js';
import { REASONING_LEVELS } from './model-options.js';
import { summaryRows } from './run-summary.js';
import { selectedModel } from './provider-options.js';
import { runStatusLabel, toolTimeline, toolTimelineSummary } from './run-status.js';
import { restoreNotice, exportNote, sumUnrestored } from './privacy-warning.js';
import { applyAutomationResults } from './automation-core.js';
import { acceptsGoalImages, formatSessionCommand, parseSessionCommand } from './session-commands.js';
import { FEEDBACK_CATEGORIES, FEEDBACK_NOTE_MAX_BYTES, feedbackFor, feedbackLabel, noteBytes } from './message-feedback.js';
import { enqueueMessage, nextQueued, patchQueued, queuedFor, removeQueued } from './message-queue.js';
import { fallbackTitle } from './session-title.js';
import { sendFailureToast, sendRecoveryState } from './send-failure.js';

const desktop = window.zhixing;
const uuid = () => crypto.randomUUID();
// 底层错误直接抛给用户时是一串技术文本（fetch failed、401、ENOTFOUND），
// 用户看不出下一步该做什么。这里按可行动性归类；匹配不到的保持原文，
// 不做猜测性改写。原始文本仍会进诊断日志。

const readyFiles = /\.(txt|md|csv|tsv|json)$/i;
const demoReply = '这是一条本地演示回复。\n\n连接 DeepSeek 后，知行会根据本次交办和所选材料生成实际成果。';
const sortChats = (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);

export function App() {
  const [state, setState] = useState(initialState);
  const [loaded, setLoaded] = useState(!desktop);
  const [nativeProjects,setNativeProjects]=useState(null);
  const [workspaceSave, setWorkspaceSave] = useState({ status: desktop ? 'recovering' : 'saved', requestedRevision: 0, persistedRevision: 0 });
  const [feedbackEntries, setFeedbackEntries] = useState([]);
  const [feedbackDraft, setFeedbackDraft] = useState(null);
  const [view, setView] = useState(() => ({ section: 'home', chatId: null, projectId: null, newDraftId: uuid() }));
  const [sidebarOpen, setSidebar] = useState(() => innerWidth > 700);
  const [panel, setPanel] = useState(false);
  const [workPage,setWorkPage]=useState('browser');
  const [sideSelection,setSideSelection]=useState({scope:'',id:null});
  const [customTab,setCustomTab]=useState('plugins');
  const [fileRequest,setFileRequest]=useState(null);
  const [draftSlices] = useState(() => {
    const store = createKeyedStore();
    store.replace(state.drafts || {});
    return store;
  });
  const [liveReplies] = useState(createKeyedStore);
  const [, refreshDraftInventory] = useState(0);
  const [files, setFilesValue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [settingsPage, setSettingsPage] = useState(null);
  const [questions,setQuestions]=useState([]);
  const approvals = useRuntimeApprovals();
  const [queue,setQueue]=useState([]);
  const queueRef = useRef([]);
  const queueBusy = useRef(false);
  const [toast, setToastState] = useState(null);
  const [deliverableBusy, setDeliverableBusy] = useState({});
  const [reviewPath, setReviewPath] = useState("");
  const [transcriptHasNew,setTranscriptHasNew]=useState(false);
  const [runtime, setRuntime] = useState({ configured: false });
  const [events, setEvents] = useState([]);
  const [liveStats, setLiveStats] = useState(null);
  const [unread, setUnread] = useState(false);
  const [running, setRunning] = useState(null);
  const [automationState, setAutomationState] = useState({ revision: -1, tasks: [], runs: [] });
  const [cleanupPending, setCleanupPending] = useState([]);
  const [recoveryAction, setRecoveryAction] = useState('');
  const [deletionError, setDeletionError] = useState('');
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const composer = useRef(null);
  const picker = useRef(null);
  const transcript = useRef(null);
  const transcriptNearBottom = useRef(true);
  const transcriptPositions = useRef(new Map());
  const transcriptChatId = useRef(null);
  const active = useRef(null);
  const latest = useRef(state);
  const fileTarget = useRef(null);
  const opening = useRef(null);
  const viewToken = useRef(0);
  const storageFailed = useRef(false);
  const loadedRef = useRef(loaded);
  const inputRef = useRef('');
  const filesRef = useRef([]);
  const draftMap = useRef(state.drafts || {});
  const draftProducersLive = useRef(true);
  const newDraftIds = useRef(new Map());
  const draftScopes = useRef({});
  const removedDraftKeys = useRef(new Set());
  const runJobs = useRef(new Map());
  const pendingRunSettlements = useRef(new Set());
  const pendingReceiptAcks = useRef(new Map());
  const questionRevision = useRef(-1);
  const forgottenRuntimeIds = useRef({ sessions: new Set(), runs: new Set() });
  const deletionBusy = useRef(false);
  const automationLatest = useRef(automationState);
  const activeDraftKey = useRef('');
  const saveSequence = useRef(0);
  const latestSaveSequence = useRef(0);
  const [draftWriter] = useState(() => createDebouncedWriter({
    snapshot: () => latest.current.settings.persist ? draftMap.current : {},
    write: async drafts => {
      if (!loadedRef.current || storageFailed.current) throw new Error('本机工作空间尚未成功读取。');
      if (desktop?.saveDrafts) await desktop.saveDrafts(drafts);
      else await persistWorkspaceSnapshot(latest.current);
    },
    onError: error => setWorkspaceSave(previous => ({ ...previous, status: 'failed', errorCode: errorText(error) || 'DRAFT_SAVE_FAILED' })),
  }));
  latest.current = state;
  loadedRef.current = loaded;
  automationLatest.current = automationState;
  const input = inputRef.current;

  function setInputValue(text) {
    const key = activeDraftKey.current;
    draftSlices.set(key, { ...(draftMap.current[key] || {}), text, files: filesRef.current });
  }

  function workspaceSnapshot(current = latest.current) {
    return current.settings.persist ? { ...current, drafts: draftMap.current }
      : { ...current, chats: [], documents: [], drafts: {}, queuedMessages: [], automations: [], settings: { ...current.settings, customTerms: [] } };
  }

  function publishDrafts() {
    draftSlices.replace(draftMap.current);
    refreshDraftInventory(value => value + 1);
  }

  function setToast(message, type) {
    if (!message) { setToastState(null); return; }
    const inferredType = type || (/失败|错误|无法|未保存|未发送|未完成|被拒绝|已中断|已占用|超过/.test(message) ? 'error'
      : /已保存|已创建|已复制|已加入|已导入|已恢复/.test(message) ? 'success' : 'info');
    setToastState({ message, type: inferredType });
  }

  function setInput(value) {
    const next = typeof value === 'function' ? value(inputRef.current) : value;
    inputRef.current = next;
    persistDraft(activeDraftKey.current, { text: next });
  }

  function setFiles(value) {
    const next = typeof value === 'function' ? value(filesRef.current) : value;
    filesRef.current = next;
    setFilesValue(next);
    persistDraft(activeDraftKey.current, { files: next });
  }

  function draftKeyFor({ workspaceId, projectId, chatId, newDraftId }) {
    const canonicalKey = chatId ? `chat:${chatId}` : `new:${workspaceId}:${projectId || 'home'}:${newDraftId}`;
    const key = chatId || Object.hasOwn(draftMap.current, canonicalKey) ? canonicalKey
      : Object.keys(draftMap.current).find(key => {
        const draft = draftMap.current[key];
        return !key.startsWith('chat:') && draft.kind === 'new' && !draft.chatId && draft.draftId === newDraftId && draft.workspaceId === workspaceId && (draft.projectId || null) === (projectId || null);
      }) || canonicalKey;
    draftScopes.current[key] = { kind: chatId ? 'chat' : 'new', workspaceId, projectId: projectId || null, chatId: chatId || null, draftId: chatId || newDraftId };
    return key;
  }

  function newDraftIdFor(workspaceId, projectId, fresh = false) {
    const scopeKey = `${workspaceId}:${projectId || 'home'}`;
    if (fresh || !newDraftIds.current.has(scopeKey)) {
      const existing = !fresh && newConversationDrafts({ ...latest.current, drafts: draftMap.current }).find(draft => draft.workspaceId === workspaceId && (draft.projectId || null) === (projectId || null));
      newDraftIds.current.set(scopeKey, existing?.draftId || uuid());
    }
    return newDraftIds.current.get(scopeKey);
  }

  function persistDraft(key, patch, expectedRevision) {
    if (!draftProducersLive.current || !key || removedDraftKeys.current.has(key)) return null;
    const previous = draftMap.current[key] || { revision: 0, text: '', files: [], updatedAt: Date.now() };
    if (expectedRevision !== undefined && previous.revision !== expectedRevision) return null;
    const next = { ...previous, ...(draftScopes.current[key] || {}), ...patch, revision: previous.revision + 1, filesRevision: (previous.filesRevision || 0) + (Object.hasOwn(patch, 'files') ? 1 : 0), updatedAt: Date.now() };
    draftMap.current = { ...draftMap.current, [key]: next };
    draftSlices.set(key, next);
    // The banner counts drafts; editing their body does not invalidate App.
    if (!!(previous.text.trim() || previous.files.length) !== !!(next.text.trim() || next.files.length)) refreshDraftInventory(value => value + 1);
    draftWriter.schedule();
    return next;
  }

  function retireDraft(key) {
    const scope = draftMap.current[key] || draftScopes.current[key];
    removedDraftKeys.current.add(key);
    delete draftScopes.current[key];
    const scopeKey = scope && `${scope.workspaceId}:${scope.projectId || 'home'}`;
    if (scope?.kind === 'new' && newDraftIds.current.get(scopeKey) === scope.draftId) newDraftIds.current.delete(scopeKey);
  }

  function clearSubmittedDraft(submission) {
    const key = submission.draftKey;
    if (removedDraftKeys.current.has(key)) return null;
    const consumed = consumeConversationDraft(draftMap.current, submission);
    if (!consumed) return null;
    if (consumed.key !== key) {
      retireDraft(key);
      draftScopes.current[consumed.key] = { kind: 'chat', draftId: submission.sessionId, chatId: submission.sessionId, workspaceId: submission.workspaceId, projectId: submission.projectId || null };
    }
    draftMap.current = consumed.drafts;
    publishDrafts();
    setState(value => ({ ...value, drafts: draftMap.current }));
    if (activeDraftKey.current === key) {
      inputRef.current = ''; filesRef.current = [];
      setInputValue(''); setFilesValue([]);
    }
    return { draftKey: consumed.key, submittedRevision: consumed.cleared.revision - 1 };
  }

  async function readWorkspaceWithHandoffs() {
    const saved = await desktop.loadWorkspace();
    const handoffs = desktop.runHandoffs ? await desktop.runHandoffs() : { runs: [] };
    return { saved, handoffs };
  }

  function restoreLoadedWorkspace(saved, handoffs, { preserveLocalDrafts = false } = {}) {
    const initial = mergeState(saved, { liveRuns: handoffs.runs });
    if (preserveLocalDrafts)
      initial.drafts = initial.settings.persist ? { ...initial.drafts, ...draftMap.current } : {};
    const reconnecting = handoffs.runs.filter((run) =>
      initial.chats.some(
        (chat) =>
          chat.id === run.sessionId &&
          chat.messages.some((message) => message.id === run.replyId && message.runId === run.runId),
      ),
    );
    const liveChat = initial.chats.find((chat) => chat.id === reconnecting[0]?.sessionId);
    if (liveChat) initial.workspaceId = liveChat.workspaceId;
    latest.current = initial;
    draftMap.current = initial.settings.persist ? initial.drafts || {} : {};
    draftSlices.replace(draftMap.current);
    // A save-retry reload keeps locally queued messages; a normal load adopts the saved queue.
    initial.queuedMessages = preserveLocalDrafts ? queueRef.current : initial.settings.persist ? initial.queuedMessages || [] : [];
    queueRef.current = initial.queuedMessages;
    setQueue(initial.queuedMessages);
    const restored = liveChat
      ? { section: 'home', chatId: liveChat.id, projectId: liveChat.projectId || null }
      : restoredDraftView(initial) ||
        (preserveLocalDrafts
          ? {
              section: 'home',
              chatId: null,
              projectId: null,
              newDraftId: newDraftIdFor(initial.workspaceId, null),
            }
          : null);
    if (preserveLocalDrafts) {
      const key = draftKeyFor({ ...restored, workspaceId: initial.workspaceId });
      const draft = draftMap.current[key] || { text: '', files: [] };
      activeDraftKey.current = key;
      inputRef.current = draft.text;
      filesRef.current = draft.files;
      setInputValue(draft.text);
      setFilesValue(draft.files);
    }
    if (saved || preserveLocalDrafts) {
      setState(initial);
      if (restored) setView(restored);
    }
    setNativeProjects(initial.projects);
    for (const run of reconnecting) void reconnectRun(run);
  }

  async function retryWorkspaceSave() {
    if (['saving', 'recovering'].includes(workspaceSave.status)) return;
    if (storageFailed.current) {
      setWorkspaceSave(previous => ({ ...previous, status: 'recovering' }));
      try {
        await desktop.retryWorkspaceSave?.();
        const { saved, handoffs } = await readWorkspaceWithHandoffs();
        if (!draftProducersLive.current) return;
        restoreLoadedWorkspace(saved, handoffs, { preserveLocalDrafts: true });
        storageFailed.current = false;
        setWorkspaceSave(previous => ({ ...previous, status: 'saved', errorCode: undefined }));
      } catch (error) {
        setWorkspaceSave(previous => ({ ...previous, status: 'failed', errorCode: errorText(error) }));
      }
      return;
    }
    const sequence = ++saveSequence.current;
    latestSaveSequence.current = sequence;
    setWorkspaceSave(previous => ({ ...previous, status: 'saving' }));
    try {
      await draftWriter.flush();
      if (!desktop) saveState(workspaceSnapshot());
      else if (desktop.retryWorkspaceSave) await desktop.retryWorkspaceSave();
      else {
        const snapshot = workspaceSnapshot();
        await desktop.saveWorkspace(snapshot);
      }
      // A queue retry can durably save a complete result without another React
      // state change. Confirm only receipts present in the host's saved snapshot;
      // the host independently checks that same run/message/receipt identity.
      if (desktop && pendingReceiptAcks.current.size) await acknowledgeSavedHandoffs(await desktop.loadWorkspace());
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
  const chatApprovals = approvals.pending.filter(request => request.rootSessionId === chatId);
  const question = questions.find(request => (request.rootSessionId || request.sessionId) === chatId);
  const otherInteractionRoots = [...new Set([...approvals.pending.map(item => item.rootSessionId), ...questions.map(item => item.rootSessionId || item.sessionId)])].filter(id => id !== chatId);
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
  const reviewSource=[...messages].reverse().find(item=>item.changes?.length)||null;
  const currentContextMessage = messages.findLast(message => message.context && (message.privacyMode || 'redact') === state.settings.privacyMode);
  const currentGoal = currentContextMessage?.context?.goal;
  const goalAction = currentGoal?.phase === 'complete' ? ['/goal', '查看目标']
    : currentGoal?.phase === 'active' && (!currentGoal.activation || currentGoal.activation === 'armed') ? ['/goal pause', '暂停目标']
    : ['/goal resume', '继续目标'];
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
      setState(current => {
        const next = applyAutomationResults(current, automationState.runs);
        const outcomes = new Map(automationState.runs.map(run => [run.id, run]));
        let changed = next !== current;
        const chats = next.chats.map(chat => {
          let updated = false;
          const messages = chat.messages.map(message => {
            const run = message.role === 'assistant' && outcomes.get(message.automationRunId);
            if (!run?.finalization && !run?.result?.finalization) return message;
            const finalization = run.finalization || run.result.finalization;
            if (JSON.stringify(message.finalization) === JSON.stringify(finalization)) return message;
            updated = true;
            return { ...message, finalization, trace: run.result?.trace || message.trace, children: finalization.children || run.result?.children || message.children, deliverables: finalization.deliverables || run.result?.deliverables || message.deliverables, changes: finalization.changes || run.result?.changes || message.changes };
          });
          if (!updated) return chat;
          changed = true;
          return { ...chat, messages };
        });
        return changed ? { ...next, chats } : current;
      });
    }
  }, [loaded, automationState]);

  useEffect(() => {
    if (!desktop) return;
    let mounted = true;
    readWorkspaceWithHandoffs().then(({ saved, handoffs }) => {
      if (mounted) restoreLoadedWorkspace(saved, handoffs);
    }).catch(() => {
      if (!mounted) return;
      storageFailed.current = true;
      setWorkspaceSave({ status: 'failed', requestedRevision: 0, persistedRevision: 0, errorCode: '无法读取本机工作空间。' });
      setToast('本地工作空间无法读取，已保留磁盘上的数据。');
    }).finally(() => { if (mounted) setLoaded(true); });
    if (desktop.loadFeedback) desktop.loadFeedback().then(result => { if (mounted) setFeedbackEntries(result?.entries ?? []); }).catch(() => {});
    desktop.runtimeStatus().then(status => { if (mounted) setRuntime(status); }).catch(() => {});
    desktop.runtimeCleanupStatus?.().then(value => { if (mounted) setCleanupPending(value); }).catch(() => {});
    const unsubscribe = desktop.onRuntimeEvent(event => {
      if (forgottenRuntimeIds.current.sessions.has(event.sessionId) || forgottenRuntimeIds.current.runs.has(event.runId)) return;
      const job = active.current;
      if(event.questionsSnapshot){applyQuestions(event.questionsSnapshot);return;}
      if(event.type==='question'){setQuestions(previous=>[...previous.filter(item=>item.requestId!==event.requestId),event]);return;}
      if(event.type==='question-closed'){setQuestions(previous=>previous.filter(item=>item.requestId!==event.requestId));return;}
      if(event.type==='live-stats'){
        if(job?.runId===event.runId)setLiveStats({runId:event.runId,context:event.context});
        return;
      }
      if(event.type==='draft'){
        if(job?.runId===event.runId)patchReply(job,{progressText:event.text});
        return;
      }
      if(event.type==='run/terminal'){
        const archived = runJobs.current.get(event.runId);
        if (archived) {
          archived.terminalStatus = event.status;
          finalizeRun(archived, event);
        } else if (event.finalization) setState(current => ({ ...current, chats: current.chats.map(chat => ({ ...chat, messages: chat.messages.map(message => message.runId === event.runId ? { ...message, finalization: event.finalization } : message) })) }));
        if (event.finalization?.processStatus === 'cleanup_pending') setCleanupPending(old => [...old.filter(row => row.runId !== event.runId), { runId: event.runId, sessionId: event.sessionId, finalization: event.finalization }]);
        else if (event.finalization?.processStatus === 'exited') setCleanupPending(old => old.filter(row => row.runId !== event.runId));
        if(event.status!=='succeeded' && job?.runId===event.runId){active.current=null;setRunning(null);}
        setEvents(old=>[...old.slice(-599),{...event,time:event.time??Date.now()}]);
        return;
      }
      const time = event.time ?? Date.now();
      if(job?.runId===event.runId && event.label){
        // Store the trace summary without duplicating full plans and agent snapshots.
        const {children,plan,...summary} = event;
        job.trace.push({...summary,time});
        if (children) job.children = children;
        if (plan) job.plan = plan;
        if (event.deliverables) job.deliverables = event.deliverables;
        if(job.trace.length>400){job.trace.shift();job.traceTruncated=true;}
      }
      setEvents(old => [...old.slice(-599), { ...event, time }]);
    });
    desktop.questionSnapshot?.().then(snapshot => { if (mounted) applyQuestions(snapshot); }).catch(() => {});
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
      setAutomationState(previous => snapshot.revision >= previous.revision ? snapshot : previous);
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
      const snapshot = workspaceSnapshot(state);
      setWorkspaceSave(previous => previous.status === 'failed' ? previous : ({ ...previous, status: 'saving', errorCode: undefined }));
      desktop.saveWorkspace(snapshot, state.settings.persist ? undefined : state.settings.customTerms).then(()=>{
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
      try { saveState(workspaceSnapshot(state)); setWorkspaceSave(previous => ({ ...previous, status: 'saved', errorCode: undefined })); }
      catch (error) {
        const message = error.message || '浏览器存储失败';
        setWorkspaceSave(previous => ({ ...previous, status: 'failed', errorCode: message }));
        setToast(`浏览器存储失败：${message}`, 'error');
      }
    }
  }, [state, loaded]);

  useEffect(() => {
    draftProducersLive.current = true;
    draftWriter.resume();
    registerRendererDurability(async ({ reason } = {}) => {
      // A failed/unfinished read has disabled editing; preserve the original
      // files and allow another read without saving an empty initial state.
      if (reason !== 'quit' && (!loadedRef.current || storageFailed.current)) return;
      if (!loadedRef.current) await new Promise((resolve, reject) => {
        let frames = 0;
        const check = () => {
          if (loadedRef.current) { resolve(); return; }
          if (frames++ > 150) { reject(new Error('本机工作空间尚未完成读取。')); return; }
          requestAnimationFrame(check);
        };
        check();
      });
      if (storageFailed.current) throw new Error('本机工作空间读取失败，现有文件保持在磁盘中。');
      if (active.current && !active.current.demo && (reason === 'recovery' || reason === 'quit' && active.current.awaitingInitialSave)) {
        // This also pre-cancels a run still waiting for its initial save/begin
        // IPC, which is not yet present in the host's handoff snapshot. Normal
        // quit has already closed registered runs; retain their full handoff.
        active.current.preflightCancelled = true;
        await desktop.cancelRun(active.current.runId);
      }
      // The private run promise carries the complete local result. A terminal
      // event can clear active before that promise settles, and runJobs can be
      // pruned by deletion, so keep these handoffs outside both projections.
      while (pendingRunSettlements.current.size) await Promise.all([...pendingRunSettlements.current]);
      // The host can send a final run event immediately before asking to quit.
      // Keep the existing two-frame barrier so React commits that outcome
      // before latest.current is used for the final workspace snapshot.
      if (reason === 'quit') await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await draftWriter.flush();
      await persistWorkspaceSnapshot(latest.current);
    });
    const flush = () => { void draftWriter.flush().catch(() => {}); };
    window.addEventListener('blur', flush);
    window.addEventListener('pagehide', flush);
    const beforeUnload = () => {
      if (!desktop && loadedRef.current && !storageFailed.current) {
        // Persist only the allowed browser metadata. saveState deliberately
        // excludes draft bodies and attachments from localStorage.
        try { saveState(workspaceSnapshot()); } catch { /* The visible save error is retained until unload. */ }
      } else flush();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      draftProducersLive.current = false;
      window.removeEventListener('blur', flush);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', beforeUnload);
      // React errors must not cancel an outstanding draft save.
      flush();
      draftWriter.dispose();
    };
  }, [draftWriter]);

  useEffect(() => {
    if (!toast) return;
    if (toast.type === 'error') return;
    const timer = setTimeout(() => setToast(null), 4300);
    return () => clearTimeout(timer);
  }, [toast]);

  useLayoutEffect(()=>{
    const element=transcript.current;
    if(!element)return;
    const previousChatId=transcriptChatId.current;
    if(previousChatId&&previousChatId!==chatId)transcriptPositions.current.set(previousChatId,element.scrollTop);
    if(previousChatId!==chatId){
      const saved=chatId?transcriptPositions.current.get(chatId):undefined;
      element.scrollTop=saved??element.scrollHeight;
      transcriptChatId.current=chatId;
      transcriptNearBottom.current=element.scrollHeight-element.scrollTop-element.clientHeight<72;
      setTranscriptHasNew(false);
      return;
    }
    if(transcriptNearBottom.current){
      element.scrollTop=element.scrollHeight;
      transcriptPositions.current.set(chatId,element.scrollTop);
      setTranscriptHasNew(false);
    }else setTranscriptHasNew(true);
  },[chatId,messages.length,messages.at(-1)?.text,messages.at(-1)?.progressText,messages.at(-1)?.pending,running?.runId,running?.status]);

  function onTranscriptScroll(){
    const element=transcript.current;
    if(!element)return;
    transcriptNearBottom.current=element.scrollHeight-element.scrollTop-element.clientHeight<72;
    if(chatId)transcriptPositions.current.set(chatId,element.scrollTop);
    if(transcriptNearBottom.current)setTranscriptHasNew(false);
  }

  function onStreamProgress() {
    const element = transcript.current;
    if (!element) return;
    if (transcriptNearBottom.current) {
      element.scrollTop = element.scrollHeight;
      if (chatId) transcriptPositions.current.set(chatId, element.scrollTop);
    } else setTranscriptHasNew(true);
  }

  function returnTranscriptToBottom(){
    if(!transcript.current)return;
    transcript.current.scrollTop=transcript.current.scrollHeight;
    transcriptNearBottom.current=true;
    if(chatId)transcriptPositions.current.set(chatId,transcript.current.scrollTop);
    setTranscriptHasNew(false);
  }

  useEffect(() => {
    if (!menu) return;
    const close = event => { if (!event.target.closest('.dropdown')) setMenu(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  useEffect(() => {
    if (menu?.name !== 'session-actions') return;
    requestAnimationFrame(() => document.querySelector('.session-actions-menu [role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }));
  }, [menu?.name]);

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

  // 本轮结束后自动发送当前聊天的队头。只处理正在看的聊天；用户切走后
  // 队列保留，回来时继续，避免在后台对看不见的会话连续执行。
  useEffect(() => {
    if (!loaded || storageFailed.current || busy || queueBusy.current || active.current || running) return;
    const head = nextQueued(queueRef.current, { chatId, workspaceId: state.workspaceId });
    if (head) void dispatchQueued(head.id);
    // dispatchQueued 读的是最新 refs；真正需要触发重算的是队列、运行态与当前聊天。
  }, [queue, running, busy, loaded, chatId, state.workspaceId]);

  function setSetting(name, value) {
    if(name==='persist'&&!value&&active.current){setToast('请先停止正在运行的任务，再关闭本地保存。');return;}
    setState(current => {
      if (name === 'modelSelection') {
        const settings = { ...current.settings, model: value.id, modelProviderId: value.providerId || null };
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

  function navigate(next, nextChat = null, nextProject = null, freshDraft = false, workspaceOverride = null, draftId = null) {
    void draftWriter.flush().catch(() => {});
    viewToken.current++;
    if(chatId&&transcript.current)transcriptPositions.current.set(chatId,transcript.current.scrollTop);
    if(nextChat!==chatId||!['home','project'].includes(next))transcriptChatId.current=null;
    setSettingsPage(null);
    const projectWorkspaceId = nextProject ? latest.current.projects.find(item => item.id === nextProject)?.workspaceId : null;
    const targetWorkspaceId = workspaceOverride || projectWorkspaceId || (nextChat ? latest.current.chats.find(item => item.id === nextChat)?.workspaceId : null) || latest.current.workspaceId;
    const nextView = { section: next, chatId: nextChat, projectId: nextProject, newDraftId: draftId || newDraftIdFor(targetWorkspaceId, nextProject, freshDraft) };
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

  function openNewDraft(key) {
    if (!loaded || storageFailed.current || removedDraftKeys.current.has(key)) return;
    const draft = newConversationDrafts({ ...latest.current, drafts: draftMap.current }).find(item => item.key === key);
    if (!draft || !modeWorkspaceIds.has(draft.workspaceId)) return;
    setState(current => ({ ...current, workspaceId: draft.workspaceId }));
    newDraftIds.current.set(`${draft.workspaceId}:${draft.projectId || 'home'}`, draft.draftId);
    navigate(draft.projectId ? 'project' : 'home', null, draft.projectId, false, draft.workspaceId, draft.draftId);
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

  function applyTemplate(text) {
    if (!room) navigate('home');
    setInput(text); setModal(null); setMenu(null);
    requestAnimationFrame(() => composer.current?.focus());
  }

  function addParsed(imported, target, spaceId, token, draftKey = activeDraftKey.current, requestFilesRevision) {
    if (!imported.length) return;
    if (target === 'library') {
      setState(current => ({ ...current, documents: [...current.documents, ...imported.map(file => ({ ...file, workspaceId: spaceId }))] }));
    } else {
      const current = draftMap.current[draftKey] || { revision: 0, text: '', files: [], updatedAt: Date.now() };
      if (requestFilesRevision !== undefined && (current.filesRevision || 0) !== requestFilesRevision) {
        setToast('读取附件期间，附件列表已修改。请重新添加附件。', 'warning');
        return;
      }
      const appended = appendDraftFiles(current.files, imported);
      const nextFiles = appended.files;
      if (!persistDraft(draftKey, { files: nextFiles }, current.revision)) return;
      if (draftKey === activeDraftKey.current && token === viewToken.current) {
        filesRef.current = nextFiles;
        setFilesValue(nextFiles);
      }
      if (appended.rejected) { setToast(`每份交办最多 12 个附件，${appended.rejected} 个未加入。已有附件已保留。`, 'warning'); return; }
    }
    if (imported.some(file => file.status !== 'ready')) setToast('部分文件无法解析。点击文件可查看原因。');
  }

  async function chooseFiles(target = 'draft') {
    setMenu(null);
    if (opening.current || busy || !loaded) return;
    const request = { target, spaceId: workspace.id, token: viewToken.current, draftKey: activeDraftKey.current, filesRevision: draftMap.current[activeDraftKey.current]?.filesRevision || 0 };
    if (!desktop?.pickFiles) { fileTarget.current = request; picker.current?.click(); return; }
    opening.current = request;
    setBusy(true);
    try { addParsed(await desktop.pickFiles(project?.directory), target, request.spaceId, request.token, request.draftKey, request.filesRevision); }
    catch (error) { setToast(errorText(error)); }
    finally { opening.current = null; setBusy(false); }
  }

  async function addFiles(list, target = 'draft', spaceId = workspace.id, token = viewToken.current, draftKey = activeDraftKey.current, filesRevision = draftMap.current[draftKey]?.filesRevision || 0) {
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
      addParsed(imported, target, spaceId, token, draftKey, filesRevision);
    } finally { setBusy(false); }
  }

  function attach(document) {
    if (!modeWorkspaceIds.has(document.workspaceId)) return;
    if (document.status !== 'ready') { openModal({ type: 'document', value: document }); return; }
    if (!room) navigate('home');
    appendMaterials([document]);
    setModal(null);
  }

  function appendMaterials(incoming) {
    const appended = appendDraftFiles(filesRef.current, incoming);
    if (appended.added) setFiles(appended.files);
    if (appended.rejected) setToast(`每份交办最多 12 个附件，${appended.rejected} 个未加入。已有附件已保留。`, 'warning');
    else if (appended.added) setToast('已加入本次交办，发送时按设置自动处理。');
    else setToast('这份资料已在本次交办中。');
  }

  function patchReply(job, patch) {
    if (Object.hasOwn(patch, 'progressText')) {
      job.progressText = patch.progressText;
      liveReplies.set(job.runId, patch.progressText);
      if (Object.keys(patch).length === 1) return;
    }
    setState(current => ({ ...current, chats: current.chats.map(item => item.id !== job.chatId ? item : {
      ...item, updatedAt: Date.now(), messages: item.messages.map(message => message.id === job.replyId ? { ...message, ...patch } : message),
    }) }));
  }

  function finalizeRun(job, outcome) {
    const incoming = outcome.finalization || outcome.result?.finalization;
    // A late promise resolution must not undo a host-confirmed cleanup retry.
    if (incoming && !(job.finalization?.processStatus === 'exited' && incoming.processStatus === 'cleanup_pending')) job.finalization = incoming;
    if (!draftProducersLive.current) {
      // React ignores updates after global fallback unmounts App. Preserve the
      // result for its retained durability barrier without writing over a new
      // App: remount/reload must wait for the complete handoff before saving.
      latest.current = finalizeConversationRun(latest.current, job, { ...outcome, finalization: job.finalization });
      return;
    }
    setState(current => finalizeConversationRun(current, job, { ...outcome, finalization: job.finalization }));
  }

  function applyQuestions(snapshot) {
    if (!Number.isSafeInteger(snapshot?.revision) || snapshot.revision < questionRevision.current) return;
    questionRevision.current = snapshot.revision;
    setQuestions(snapshot.pending || []);
  }

  async function acknowledgeSavedHandoffs(snapshot) {
    if (!desktop?.acknowledgeRunHandoff) return;
    for (const [runId, identity] of pendingReceiptAcks.current) {
      const message = snapshot.chats.find(chat => chat.id === identity.sessionId)?.messages.find(message => message.runId === runId && message.resultReceiptId === identity.receiptId && !message.pending);
      // A deliberately nonpersistent conversation is delivered to memory only.
      if (snapshot.settings.persist && !message) continue;
      await desktop.acknowledgeRunHandoff(identity);
      pendingReceiptAcks.current.delete(runId);
    }
  }

  async function receiveHandoff(job, identity) {
    const receipt = await desktop.awaitRunHandoff(identity);
    Object.assign(job, { trace: receipt.trace, traceTruncated: receipt.traceTruncated, progressText: receipt.progressText, children: receipt.children, plan: receipt.plan });
    const acknowledgement = { hostEpoch: receipt.hostEpoch, runId: receipt.runId, sessionId: receipt.sessionId, receiptId: receipt.receiptId };
    pendingReceiptAcks.current.set(job.runId, acknowledgement);
    finalizeRun(job, { ...receipt.outcome, time: receipt.time, receiptId: receipt.receiptId });
    try {
      if (draftProducersLive.current) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const savedReply = latest.current.chats.find(chat => chat.id === job.chatId)?.messages.find(message => message.id === job.replyId);
      if (savedReply?.resultReceiptId !== receipt.receiptId) throw new Error('交办结果尚未接回原消息，主机恢复记录已保留。');
      await persistWorkspaceSnapshot(latest.current);
    } catch (error) {
      setWorkspaceSave(previous => ({ ...previous, status: 'failed', errorCode: errorText(error) }));
    }
    return receipt.outcome;
  }

  async function reconnectRun(run) {
    if (runJobs.current.has(run.runId)) return;
    const job = { ...run, chatId: run.sessionId, demo: false };
    runJobs.current.set(job.runId, job);
    liveReplies.set(job.runId, job.progressText || '');
    if (run.status === 'running' && !active.current) { active.current = job; setRunning(job); }
    setEvents(previous => [...previous, ...(run.trace || [])].slice(-600));
    let releaseSettlement;
    const settled = new Promise(resolve => { releaseSettlement = resolve; });
    pendingRunSettlements.current.add(settled);
    try {
      await receiveHandoff(job, run);
    } catch {
      setToast('暂时无法接回交办结果。主机保留了恢复记录，请重新载入界面后重试。', 'error');
    } finally {
      if (active.current === job) { active.current = null; setRunning(null); }
      pendingRunSettlements.current.delete(settled);
      releaseSettlement();
    }
  }

  function localCommand(command) {
    setInput('');
    if(command==='/model')setMenu({name:'models'});
    else if(command==='/settings')openModal({type:'settings'});
    else if(command==='/skills'){setCustomTab('skills');navigate('skills');}
  }

  function publishQueue(next) {
    queueRef.current = next;
    setQueue(next);
    // 排队内容与聊天同属加密工作空间；先更新内存快照，再走现有保存队列，
    // 避免刷新或退出后把已经排好的交办静默丢掉。
    const snapshot = { ...latest.current, queuedMessages: next };
    latest.current = snapshot;
    setState(current => ({ ...current, queuedMessages: next }));
    if (!loadedRef.current || storageFailed.current || !snapshot.settings?.persist) return;
    void persistWorkspaceSnapshot(snapshot).catch(error => setWorkspaceSave(previous => ({ ...previous, status: 'failed', errorCode: errorText(error) || 'WORKSPACE_SAVE_FAILED' })));
  }

  // 运行中按发送先落到队里，不打断当前交办。队列按聊天隔离并随加密工作空间保存；
  // 恢复后条目带「上次退出时未发送」标记，必须由用户确认才重试，不会静默重放。
  function queueCurrentDraft() {
    const key = activeDraftKey.current;
    const draft = draftMap.current[key] || { text: inputRef.current, files: filesRef.current };
    const text = (inputRef.current || draft.text || '').trim();
    const files = filesRef.current.length ? filesRef.current : draft.files || [];
    if (!text && !files.length) return;
    if (files.some(file => file.status !== 'ready')) { setToast('请移除无法解析的附件后再排队。', 'error'); return; }
    const nativeCommand = parseSessionCommand(text || '');
    if (nativeCommand?.error) { setToast(nativeCommand.error, 'error'); return; }
    const next = { id: uuid(), chatId, workspaceId: state.workspaceId, projectId: project?.id || null, text, files, mode, createdAt: Date.now() };
    const result = enqueueMessage(queueRef.current, next);
    if (result.error) { setToast(result.error, 'error'); return; }
    publishQueue(result.queue);
    if (key && draftMap.current[key]) persistDraft(key, { text: '', files: [] }, draftMap.current[key].revision);
    inputRef.current = ''; filesRef.current = [];
    setInputValue(''); setFilesValue([]);
    setToast(`已排队 ${queuedFor(result.queue, chatId).length} 条消息，本轮结束后按顺序发送。`, 'success');
  }

  // 内核接手本轮后：移除该项，并立刻释放派发锁。锁若一直持有到整轮结束，
  // 自动派发的那一轮里用户再也排不进新消息（Enter 会被 submit 的早退吞掉）。
  function acceptQueued(itemId) {
    queueBusy.current = false;
    publishQueue(removeQueued(queueRef.current, itemId));
  }

  function discardQueued(id) {
    publishQueue(removeQueued(queueRef.current, id));
  }

  function retryQueued(id) {
    publishQueue(patchQueued(queueRef.current, id, { error: '', sending: false }));
  }

  function editQueued(item) {
    setInput(previous => (previous.trim() ? `${previous.trimEnd()}\n${item.text}` : item.text));
    if (item.files.length) setFiles(previous => [...previous, ...item.files.filter(file => !previous.some(row => row.id === file.id))]);
    discardQueued(item.id);
    requestAnimationFrame(() => composer.current?.focus());
  }

  async function dispatchQueued(itemId) {
    const item = queueRef.current.find(row => row.id === itemId);
    if (!item || item.sending || item.error || active.current || queueBusy.current) return;
    const current = latest.current;
    const targetChat = current.chats.find(chat => chat.id === item.chatId && !chat.archived && chat.workspaceId === current.workspaceId);
    if (!targetChat) {
      publishQueue(patchQueued(queueRef.current, itemId, { error: '这段聊天已删除或不在当前工作空间。' }));
      return;
    }
    queueBusy.current = true;
    publishQueue(patchQueued(queueRef.current, itemId, { sending: true, error: '' }));
    try {
      const settings = current.settings;
      const targetProject = current.projects.find(project => project.id === targetChat.projectId) || null;
      const selection = selectedModel(runtime, settings);
      if (!settings.demo && !selection) throw new Error('所选供应商或型号当前不可用。请选择目录中的有效模型后再发送。');
      if (!settings.demo && selection.reasoningCapability === 'unknown') throw new Error('当前模型的思考能力尚未确认，请刷新模型目录后再发送。');
      if (!settings.demo && selection && !selection.levels.includes(settings.reasoning)) throw new Error('所选模型不支持当前的思考档位，请重新选择。');
      const targetProvider = runtime.providers?.find(provider => provider.id === selection?.providerId);
      if (!settings.demo && targetChat.messages.length && targetProvider
        && ((targetChat.providerId || 'deepseek') !== targetProvider.id || (targetChat.providerUrl && targetChat.providerUrl !== targetProvider.baseUrl))) {
        throw new Error('这段聊天使用了另一个模型服务。请先在聊天中继续发送，再排队新的交办。');
      }
      if (!settings.demo && targetChat.automationTaskId && parseSessionCommand(item.text || '')) throw new Error('任务聊天里的命令需要回到原聊天执行。');
      const nativeCommand = parseSessionCommand(item.text || '');
      const planText = nativeCommand?.name === 'plan' && !nativeCommand.verb ? nativeCommand.argument : '';
      const startInPlanMode = Boolean(nativeCommand?.name === 'plan' && !nativeCommand.verb && (planText || item.files.length));
      const command = nativeCommand && !startInPlanMode ? formatSessionCommand(nativeCommand) : undefined;
      if (command && item.files.length && (!acceptsGoalImages(nativeCommand) || item.files.some(file => !file.visual?.visualId))) throw new Error('命令附件仅支持创建或编辑目标时添加的图片。');
      const preferences = settings.personalizationEnabled ? settings.personalInstructions : '';
      const history = targetChat.messages.filter(message => !message.pending);
      // 与直接交办一致：prompt 不带历史（会话已恢复则内核自己带），
      // bootstrapPrompt 才包含历史；否则每轮排队都会把旧对话当正文再发一遍。
      const taskText = startInPlanMode ? planText || '' : item.text;
      const prompt = composePrompt(taskText, item.files, [], targetProject?.instructions, preferences);
      const bootstrapPrompt = composePrompt(taskText, item.files, history, targetProject?.instructions, preferences);
      const chatMode = targetChat.mode || item.mode || mode;
      const draft = {
        sessionId: item.chatId, workspaceId: current.workspaceId, projectId: targetChat.projectId || null,
        text: item.text || '请处理附件。', restoreText: '', attachments: item.files, files: [],
        prompt, repeatExecution: false, draftKey: null, submittedRevision: 0,
        mode: chatMode, model: selection?.id || settings.model, reasoning: settings.reasoning,
        privacyMode: settings.privacyMode, startInPlanMode, sideScope: null, queued: true, queueId: item.id,
      };
      if (settings.demo) {
        const local = new PrivacySession(item.chatId).protect(prompt, settings.customTerms, privacyPolicyForMode(settings.privacyPolicy, settings.privacyMode));
        if (local.blocked) throw new Error('排队消息包含疑似凭证，请修改后再发送。');
        const demoJob = await startReply(draft, { text: settings.privacyMode === 'raw' ? prompt : local.text, privacyMode: settings.privacyMode }, true, { silent: true, reportFailure: false, onAccepted: () => acceptQueued(itemId) });
        if (!demoJob?.accepted) throw new Error(demoJob?.failureMessage || '当前无法开始新的交办，请稍后重试。');
        return;
      }
      if (!desktop || !runtime.configured) throw new Error('尚未连接模型，请先在设置中配置供应商。');
      const visualIds = item.files.flatMap(file => (file.visual?.visualId ? [file.visual.visualId] : []));
      const preview = await desktop.prepareRun({
        sessionId: item.chatId, prompt, bootstrapPrompt, command, startInPlanMode, mode: chatMode,
        model: selection.id, modelProviderId: selection.providerId, reasoning: settings.reasoning,
        permission: settings.permission, workspaceId: current.workspaceId, projectId: targetChat.projectId || null,
        customTerms: settings.customTerms, privacyMode: settings.privacyMode, privacyPolicy: settings.privacyPolicy, visualIds,
      });
      if (preview.blocked) throw new Error('排队消息包含疑似凭证，请修改后再发送。');
      if (active.current || latest.current.workspaceId !== current.workspaceId) throw new Error('工作空间或运行状态已变化，请稍后重试。');
      // 先确认内核已接手本轮，再从队列删除；否则消息会既不在队列也没有运行。
      const job = await startReply(draft, preview, false, { silent: true, reportFailure: false, onAccepted: () => acceptQueued(itemId) });
      if (!job?.accepted) throw new Error(job?.failureMessage || '当前无法开始新的交办，请稍后重试。');
    } catch (error) {
      queueBusy.current = false;
      publishQueue(patchQueued(queueRef.current, itemId, { sending: false, error: errorText(error) }));
      setToast(`排队消息未发送：${errorText(error)}`, 'error');
    }
  }

  async function submit(repeatMessageId = null, sideTarget = null, actionCommand = null) {
    if (!loaded || storageFailed.current || busy || queueBusy.current) return;
    if (active.current) {
      if (!sideTarget && !repeatMessageId && !actionCommand && active.current.chatId === chatId) queueCurrentDraft();
      return;
    }
    const targetChat = sideTarget ? state.chats.find(item => item.id === sideTarget.chatId && item.workspaceId === workspace.id && (item.projectId||null) === (project?.id||null) && !item.archived) : chat;
    if(sideTarget&&(!targetChat||targetChat.id===chatId||sideTarget.scope!==workScopeKey)) { setToast('侧边聊天已变更，请重新选择有效会话。'); return; }
    const targetMessages = targetChat?.messages || [];
    const repeatIndex = repeatMessageId ? targetMessages.findIndex(message => message.id === repeatMessageId) : -1;
    const previous = repeatIndex >= 0 ? targetMessages.slice(0, repeatIndex).findLast(message => message.role === 'user') : null;
    if (repeatMessageId && !previous) return;
    const draftKey = repeatMessageId || actionCommand ? null : sideTarget ? `chat:${sideTarget.chatId}` : activeDraftKey.current;
    const sourceDraft = draftMap.current[draftKey] || { revision: 0, text: '' };
    const text = actionCommand ?? (repeatMessageId ? previous.text : (sideTarget ? sourceDraft.text : inputRef.current).trim());
    if(!repeatMessageId&&!sideTarget&&['/model','/settings','/skills'].includes(text)){localCommand(text);return;}
    const attachments = repeatMessageId || actionCommand ? [] : sideTarget ? sourceDraft.files||[] : filesRef.current;
    if (!text && !attachments.length) return;
    if (attachments.some(file => file.status !== 'ready')) { setToast('请移除无法解析的附件后再发送。'); return; }
    const submittedRevision = sourceDraft.revision;
    const repeatedFiles = repeatMessageId ? previous.files || [] : [];
    const nativeCommand = parseSessionCommand(text || '');
    if (nativeCommand?.error) { setToast(nativeCommand.error, 'error'); return; }
    const planText = nativeCommand?.name === 'plan' && !nativeCommand.verb ? nativeCommand.argument : '';
    const startInPlanMode = Boolean((repeatMessageId && previous?.startInPlanMode)
      || (nativeCommand?.name === 'plan' && !nativeCommand.verb && (planText || attachments.length)));
    const command = nativeCommand && !startInPlanMode ? formatSessionCommand(nativeCommand) : undefined;
    const submittedFiles = repeatMessageId ? repeatedFiles : attachments;
    if (command && submittedFiles.length && (!acceptsGoalImages(nativeCommand) || submittedFiles.some(file => !file.visual?.visualId))) {
      setToast('命令附件仅支持创建或编辑目标时添加的 PNG、JPEG、WebP 或 GIF 图片。', 'error');
      return;
    }
    const { privacyMode, reasoning, permission, customTerms,privacyPolicy,demo } = state.settings;
    if (demo && nativeCommand) { setToast('请连接模型并关闭演示模式，再执行内核命令。', 'error'); return; }
    const selection = selectedModel(runtime, state.settings);
    if(!demo&&!selection){setToast('所选供应商或型号当前不可用。请选择目录中的有效模型后再发送。','error');return;}
    if(!demo&&selection.reasoningCapability==='unknown'){setToast('当前模型的思考能力尚未确认，暂不能发送。请刷新模型目录或选择已确认的型号。','error');return;}
    if(!demo&&selection&&!selection.levels.includes(reasoning)){const label=REASONING_LEVELS.find(level=>level.id===reasoning)?.label||reasoning;setToast(`所选模型不支持「${label}」思考档位。请选择该模型支持的档位后再发送。`,'error');return;}
    const selectedProvider = runtime.providers?.find(provider => provider.id === selection?.providerId);
    const unboundImport = targetChat?.importedFrom==='deepseek'&&!targetChat.providerId;
    const providerChanged = !state.settings.demo && !!targetChat?.messages?.length && !!selectedProvider && !unboundImport
      && ((targetChat.providerId || 'deepseek') !== selectedProvider.id || (targetChat.providerUrl && targetChat.providerUrl !== selectedProvider.baseUrl));
    const forkScheduled = !state.settings.demo && !!targetChat?.automationTaskId;
    if ((actionCommand || command && targetMessages.length) && (!targetChat || providerChanged || forkScheduled)) {
      setToast('此操作需要在当前会话的原供应商和发送设置下执行。', 'error');
      return;
    }
    const sessionId = !providerChanged && !forkScheduled && targetChat?.id || uuid();
    const preferences = state.settings.personalizationEnabled ? state.settings.personalInstructions : '';
    const taskText = startInPlanMode ? planText || '' : text;
    const prompt = repeatMessageId && previous?.prompt ? previous.prompt : composePrompt(taskText, attachments, [], project?.instructions, preferences);
    const model = selection?.id || state.settings.model;
    const modelProviderId = selection?.providerId;
    const bootstrapPrompt=repeatMessageId || providerChanged ? prompt : composePrompt(taskText, attachments, targetMessages, project?.instructions, preferences);
    const draft = { sessionId, workspaceId: workspace.id, projectId: project?.id || null, text: text || '请处理附件。', restoreText: sourceDraft.text, attachments, files: repeatedFiles, prompt, repeatExecution: !!repeatMessageId, draftKey, submittedRevision, mode, model, reasoning, privacyMode, startInPlanMode, sideScope: sideTarget?.scope };
    if (demo) {
      const local = new PrivacySession(sessionId).protect(prompt, customTerms,privacyPolicyForMode(privacyPolicy,privacyMode));
      if (local.blocked) { openModal({ type: 'privacy', original: prompt, preview: local, blocked: true }); return; }
      // 不在提交里等整轮运行结束：busy 只表示「正在准备发送」，
      // 否则运行中的输入框会被一直占住，排队和后续操作都无法进行。
      void startReply(draft, { text: privacyMode === 'raw' ? prompt : local.text, privacyMode }, true);
      return;
    }
    if (!desktop || !runtime.configured) { openModal({ type: 'settings', tab: '供应商' }); return; }
    const token = viewToken.current;
    setBusy(true);
    try {
      await draftWriter.flush();
      // The host authorizes against its durable project/settings snapshot.
      await persistWorkspaceSnapshot(latest.current);
      if (token !== viewToken.current) return;
      const visualIds = submittedFiles.flatMap(file => file.visual?.visualId ? [file.visual.visualId] : []);
      const preview = await desktop.prepareRun({ sessionId, prompt,bootstrapPrompt,command,startInPlanMode,mode, model, modelProviderId, reasoning, permission, workspaceId: workspace.id,projectId:project?.id||null,customTerms,privacyMode,privacyPolicy,visualIds });
      if (token === viewToken.current) {
        if(preview.blocked)openModal({ type: 'privacy', original: `任务模式：${mode === 'government' ? '政务' : '办公'}\n\n${prompt}`, preview, blocked:true });
        else {
          if (providerChanged) setToast('已为新供应商开启聊天，上一段聊天留在原处。');
          else if (forkScheduled) setToast('已从任务聊天另开交办。');
          void startReply(draft,preview);
        }
      }
    } catch (error) { setToast(`未发送：${errorText(error)}`); }
    finally { setBusy(false); }
  }

  function restoreFailedSubmission(draft, recovery, job, executionStatus) {
      if (recovery && !['completed', 'cancelled'].includes(executionStatus) && job.terminalStatus !== 'cancelled') {
        const currentDraft = draftMap.current[recovery.draftKey];
        const restored = recoverSubmittedDraft(currentDraft, { ...draft, ...recovery });
        if (restored) {
          const next = persistDraft(recovery.draftKey, restored, currentDraft.revision);
          if (next && activeDraftKey.current === recovery.draftKey && !inputRef.current && !filesRef.current.length) {
            inputRef.current = next.text; filesRef.current = next.files;
            setInputValue(next.text); setFilesValue(next.files);
          }
          return next;
        }
      }
      return null;
  }

  // 保存还没落定，草稿槽就可能被这段新输入占用（再打一段字或按回车排队），
  // recoverSubmittedDraft 的 revision 守卫因此拒绝还原。这里把没送出的那段接到
  // 当前草稿后面，与「编辑排队消息」同一做法：用户正在打的内容在前，原交办在后。
  function rejoinRejectedDraft(draft, recovery) {
    const current = draftMap.current[recovery.draftKey];
    if (!current) return null;
    const text = draft.restoreText ?? draft.text ?? '';
    const files = (draft.attachments || []).filter(file => !(current.files || []).some(row => row.id === file.id));
    if (!String(text).trim() && !files.length) return null;
    const next = persistDraft(recovery.draftKey, {
      text: [current.text, text].filter(value => value && value.trim()).join('\n'),
      files: [...(current.files || []), ...files],
    }, current.revision);
    if (!next) return null;
    if (activeDraftKey.current === recovery.draftKey) {
      inputRef.current = next.text; filesRef.current = next.files;
      setInputValue(next.text); setFilesValue(next.files);
    }
    return next;
  }

  async function startReply(draft, preview, demo = false, { silent = false, onAccepted, reportFailure = true } = {}) {
    if (!draftProducersLive.current || active.current || draft.workspaceId !== latest.current.workspaceId) return null;
    const recovery = draft.draftKey ? clearSubmittedDraft(draft) : null;
    const job = { chatId: draft.sessionId, workspaceId: draft.workspaceId, replyId: uuid(), runId: uuid(), demo, trace: [], awaitingInitialSave: true, accepted: false };
    // 只有宿主真正接手本轮（demo 直接开始／begin 成功）才算接受。保存失败、
    // 预检取消或 begin 被拒都不能让排队项消失，也不能留下假的失败气泡。
    let accepted = false;
    const accept = () => {
      if (accepted) return;
      accepted = true;
      job.accepted = true;
      try { onAccepted?.(); } catch { /* 队列记账失败不能阻断本轮。 */ }
    };
    runJobs.current.set(job.runId, job);
    if (runJobs.current.size > 80) for (const [id, old] of runJobs.current) {
      if (old !== job && old.finalization?.processStatus !== 'cleanup_pending' && old !== active.current) { runJobs.current.delete(id); liveReplies.set(id, undefined); break; }
    }
    active.current = job; setRunning(job);
    const user = { id: uuid(), role: 'user', text: draft.text, prompt: draft.prompt, protected: preview.text, privacyMode: preview.privacyMode, startInPlanMode: draft.startInPlanMode, ...(draft.queueId ? { queueId: draft.queueId } : {}), files: (draft.attachments.length ? draft.attachments : draft.files || []).map(({ id, name, size, path, sourceUrl, visual }) => ({ id, name, size, path, sourceUrl, ...(visual ? { visual } : {}) })) };
    const assistant = { id: job.replyId, runId: job.runId, role: 'assistant', text: '', pending: true, demo,privacyMode:preview.privacyMode,protectCount:preview.entities?.length||0, startedAt: Date.now() };
    let createdChat = false;
    const appendSubmission = current => {
      const target = current.chats.find(item => item.id === draft.sessionId);
      const now = Date.now();
      if (!target) {
        createdChat = true;
        return { ...current, chats: [...current.chats, {
        id: draft.sessionId, projectId: draft.projectId, workspaceId: draft.workspaceId,
        providerId: preview.providerId, providerUrl: preview.baseUrl,
        title: fallbackTitle(draft.text) || '新的交办', mode: draft.mode, createdAt: now, updatedAt: now, messages: [user, assistant],
        }] };
      }
      const history = [...target.messages];
      history.push(user);
      const binding = !demo&&(!target.messages.length||target.importedFrom==='deepseek'&&!target.providerId) ? {providerId:preview.providerId,providerUrl:preview.baseUrl} : {};
      if(!target.messages.length)binding.title=fallbackTitle(draft.text)||'新的交办';
      return { ...current, chats: current.chats.map(item => item.id === target.id ? { ...item,...binding, updatedAt: now, messages: [...history, assistant] } : item) };
    };
    const submittedState = appendSubmission({ ...latest.current, drafts: draftMap.current });
    latest.current = submittedState;
    setState(submittedState);
    if (draft.sideScope) setSideSelection({scope:draft.sideScope,id:draft.sessionId});
    else if (!silent) navigate('home', draft.sessionId, draft.projectId);
    let releaseSettlement;
    const settled = new Promise(resolve => { releaseSettlement = resolve; });
    pendingRunSettlements.current.add(settled);
    try {
      // Persist the run/reply binding before any model or tool can execute.
      // This is the anchor used after a renderer reload, never a second run.
      await persistWorkspaceSnapshot(submittedState);
      job.awaitingInitialSave = false;
      if (!draftProducersLive.current || job.preflightCancelled) {
        job.terminalStatus = 'cancelled';
        throw Object.assign(new Error('交办已停止，未启动新的内核。'), { code: 'RUNTIME_CANCELLED', stage: 'prepare' });
      }
      if (!demo && desktop.beginRun) {
        const identity = await desktop.beginRun({ runId: job.runId, replyId: job.replyId, preparationId: preview.preparationId });
        accept();
        const outcome = await receiveHandoff(job, identity);
        if (outcome.status === 'failed') restoreFailedSubmission(draft, recovery, job, outcome.finalization?.executionStatus || outcome.result?.finalization?.executionStatus);
      } else {
        accept();
        const result = demo ? { text: demoReply, masked: demoReply } : await desktop.runPrepared({ runId: job.runId, preparationId: preview.preparationId });
        finalizeRun(job, { result });
      }
    } catch (error) {
      job.failureMessage = errorText(error);
      if (!accepted) {
        if (reportFailure && job.terminalStatus === 'cancelled') {
          // 用户在宿主接手前自己停止：直接发送的交办留在记录里，气泡标为已取消。
          finalizeRun(job, { status: 'cancelled' });
        } else {
          // 宿主从未接手（保存失败、begin 被拒）：草稿在被消费的那一刻就没了，
          // 先把它还给输入框，再撤回这次乐观追加的用户/助手双气泡。排队消息也
          // 一律撤回，否则队列重试时同一段交办会在记录里出现两次。
          let restored = restoreFailedSubmission(draft, recovery, job);
          if (!restored && recovery) restored = rejoinRejectedDraft(draft, recovery);
          // 草稿没被消费（保存还没落定时又打了字，revision 校验因此不通过）时
          // 内容本来就在输入框里，不能说成「没能恢复」。
          const untouched = !recovery && draft.draftKey ? draftMap.current[draft.draftKey] : null;
          const recoveryState = sendRecoveryState({
            hadDraft: Boolean(draft.draftKey),
            consumed: Boolean(recovery),
            restored: Boolean(restored),
            kept: Boolean(untouched && (untouched.text?.trim() || untouched.files?.length)),
          });
          const rollback = {
            ...latest.current,
            chats: latest.current.chats
              .map(chat => (chat.id === job.chatId ? { ...chat, messages: chat.messages.filter(message => message.id !== user.id && message.id !== assistant.id) } : chat))
              .filter(chat => !(createdChat && chat.id === job.chatId && chat.messages.length === 0)),
          };
          latest.current = rollback;
          if (draftProducersLive.current) setState(rollback);
          // 气泡被撤回了，失败原因必须另外呈现。排队消息由队列自己带着上下文报，
          // 直接发送没有别的出口，就在这里给出与发送失败一致的提示。
          // 内容没能接回输入框时必须直说，不能让「未发送」听上去像什么都在。
          if (reportFailure) setToast(sendFailureToast(job.failureMessage, recoveryState), 'error');
        }
      } else {
        const executionStatus = error.finalization?.executionStatus || job.finalization?.executionStatus;
        restoreFailedSubmission(draft, recovery, job, executionStatus);
        finalizeRun(job, { status: job.terminalStatus || 'failed', result: error.result, output: error.output, finalization: error.finalization, error: { code: error.code, stage: error.stage, message: `运行未完成：${errorText(error)}` } });
      }
    } finally {
      if (active.current === job) { active.current = null; setRunning(null); }
      pendingRunSettlements.current.delete(settled);
      releaseSettlement();
    }
    // accepted 才是「宿主已接手」的判据：保存失败、预检取消或 begin 被拒都
    // 不能当成已开始的一轮，否则排队项会永远停在「发送中」。
    return job;
  }

  async function stop(runId) {
    const job = typeof runId === 'string' ? runJobs.current.get(runId) : active.current;
    if (!job) { if (typeof runId === 'string') await desktop?.cancelRun(runId); return; }
    job.preflightCancelled = true;
    if(job.demo){
      job.terminalStatus = 'cancelled';
      finalizeRun(job, { status: 'cancelled' });
      active.current=null;setRunning(null);return;
    }
    setRunning(previous => previous?.runId === job.runId ? { ...previous, status: 'cancelling' } : previous);
    patchReply(job, { status: 'cancelling' });
    if (!job.demo) {
      try {
        await desktop.cancelRun(job.runId);
        if (active.current === job) patchReply(job, { text: job.progressText || '已请求停止，正在等待任务结束…', pending: true, stopped: false, status: 'cancelling', trace: job.trace, traceTruncated: job.traceTruncated });
      } catch (error) {
        setRunning(previous=>previous?.runId===job.runId?{...previous,status:'running'}:previous);
        patchReply(job,{status:'running'});
        setToast(`停止状态未确认：${errorText(error)}`, 'error');
      }
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
    if (!loaded || storageFailed.current) throw new Error('请先完成本机工作空间读取。');
    if (deletionBusy.current) throw new Error('另一项删除正在保存，请稍后重试。');
    const current = { ...latest.current, drafts: draftMap.current };
    const following = workspaceDeletion(current, item);
    const ids = current.chats.filter(chat => !following.chats.some(next => next.id === chat.id)).map(chat => chat.id);
    if (item.type === 'delete-chat' && !ids.includes(item.id)) ids.push(item.id);
    if (ids.includes(active.current?.chatId)) throw new Error('请先停止此会话的生成。');
    const tasks = item.type === 'delete-project' ? (desktop ? automationLatest.current.tasks : current.automations).filter(task => task.projectId === item.id) : [];
    if (tasks.some(task => task.status === '运行中')) throw new Error('请等此项目的任务运行结束。');
    const operation = { id: uuid(), projectId: item.type === 'delete-project' ? item.id : null, chatIds: ids, taskIds: tasks.map(task => task.id) };
    // A pending file read may own a scope before it has any persisted content.
    const scopedDrafts = { ...draftScopes.current, ...draftMap.current };
    const survivingScopes = workspaceDeletion(current, item, scopedDrafts).drafts;
    for (const key of Object.keys(scopedDrafts)) if (!Object.hasOwn(survivingScopes, key)) {
      retireDraft(key);
    }
    draftMap.current = following.drafts;
    publishDrafts();
    draftWriter.schedule();
    // 队列与草稿同样会被删除影响：不在这里同步，后续任何一次排队都会用旧 ref
    // 把已删除聊天的正文与附件重新写回加密工作空间。
    queueRef.current = following.queuedMessages || [];
    setQueue(queueRef.current);
    const next = { ...following, pendingWorkspaceDeletes: [...(current.pendingWorkspaceDeletes || []), operation] };
    latest.current = next;
    setState(next);
    if (ids.includes(chatId) || (item.type === 'delete-project' && view.projectId === item.id)) navigate('home');
    setModal(null);
    await finishWorkspaceDeletion(operation);
  }

  async function persistWorkspaceSnapshot(snapshot) {
    const saved = workspaceSnapshot(snapshot);
    if (desktop) await desktop.saveWorkspace(saved);
    else saveState(saved);
    await acknowledgeSavedHandoffs(snapshot);
  }

  async function finishWorkspaceDeletion(operation) {
    deletionBusy.current = true;
    setRecoveryAction(`delete:${operation.id}`);
    setDeletionError('');
    try {
      // First persist the removal and its cleanup intent. A failed save never masquerades as a finished delete.
      await draftWriter.flush();
      await persistWorkspaceSnapshot(latest.current);
      for (const id of operation.taskIds) {
        const task = automationLatest.current.tasks.find(task => task.id === id);
        if (task && task.projectId === operation.projectId) await desktop?.removeAutomation(id);
      }
      for (const id of operation.chatIds) {
        // A moved chat is not part of this deletion; its native session must be preserved too.
        if (latest.current.chats.some(chat => chat.id === id)) continue;
        await desktop?.forgetSession(id);
        // Only a confirmed host forget releases this chat's renderer caches.
        // Keep ID-only tombstones so queued events cannot retain its body again.
        const removedRuns = new Set();
        for (const [runId, job] of runJobs.current) if (job.chatId === id && job !== active.current) {
          removedRuns.add(runId);
          runJobs.current.delete(runId);
          liveReplies.set(runId, undefined);
        }
        for (const event of events) if (event.sessionId === id && event.runId) removedRuns.add(event.runId);
        forgottenRuntimeIds.current.sessions.add(id);
        for (const runId of removedRuns) forgottenRuntimeIds.current.runs.add(runId);
        transcriptPositions.current.delete(id);
        if (transcriptChatId.current === id) transcriptChatId.current = null;
        for (const [key, scope] of Object.entries(draftScopes.current)) if (key === `chat:${id}` || scope.chatId === id) delete draftScopes.current[key];
        setEvents(previous => previous.filter(event => event.sessionId !== id && !removedRuns.has(event.runId)));
        setLiveStats(previous => removedRuns.has(previous?.runId) ? null : previous);
        setQuestions(previous => previous.filter(item => (item.rootSessionId || item.sessionId) !== id && !removedRuns.has(item.runId)));
        for (const runId of removedRuns) pendingReceiptAcks.current.delete(runId);
        setCleanupPending(previous => previous.filter(row => row.sessionId !== id && !removedRuns.has(row.runId)));
        setSideSelection(previous => previous.id === id ? { scope: '', id: null } : previous);
      }
      const next = { ...latest.current, pendingWorkspaceDeletes: (latest.current.pendingWorkspaceDeletes || []).filter(item => item.id !== operation.id) };
      await persistWorkspaceSnapshot(next);
      latest.current = { ...latest.current, pendingWorkspaceDeletes: (latest.current.pendingWorkspaceDeletes || []).filter(item => item.id !== operation.id) };
      setState(current => ({ ...current, pendingWorkspaceDeletes: (current.pendingWorkspaceDeletes || []).filter(item => item.id !== operation.id) }));
    } catch (error) {
      const message = errorText(error);
      setDeletionError(`删除尚未完成保存或内核记录清理：${message}。可重试，原磁盘记录可能仍在。`);
      throw error;
    } finally {
      deletionBusy.current = false;
      setRecoveryAction('');
    }
  }

  function recoverOrphanDraft(key) {
    const draft = draftMap.current[key];
    if (!draft || !orphanDrafts({ ...latest.current, drafts: draftMap.current }).some(item => item.key === key)) return;
    const id = uuid();
    const targetWorkspaceId = latest.current.workspaceId;
    const targetKey = draftKeyFor({ workspaceId: targetWorkspaceId, projectId: null, chatId: null, newDraftId: id });
    const next = { ...draft, ...draftScopes.current[targetKey], revision: draft.revision + 1, updatedAt: Date.now() };
    const drafts = { ...draftMap.current, [targetKey]: next };
    delete drafts[key];
    retireDraft(key);
    draftMap.current = drafts;
    publishDrafts();
    draftWriter.schedule();
    setState(current => ({ ...current, drafts }));
    newDraftIds.current.set(`${targetWorkspaceId}:home`, id);
    navigate('home');
    setToast('已恢复为当前空间的交办草稿，请核对附件后发送。');
  }

  function discardOrphanDraft(key) {
    if (!orphanDrafts({ ...latest.current, drafts: draftMap.current }).some(item => item.key === key)) return;
    const drafts = { ...draftMap.current };
    delete drafts[key];
    retireDraft(key);
    draftMap.current = drafts;
    publishDrafts();
    draftWriter.schedule();
    setState(current => ({ ...current, drafts }));
  }

  async function retryCleanup(runId) {
    setRecoveryAction(`cleanup:${runId}`);
    try {
      const result = await desktop.retryRuntimeCleanup(runId);
      if (result.status === 'exited') setCleanupPending(old => old.filter(item => item.runId !== runId));
      else setCleanupPending(old => old.map(item => item.runId === runId ? result : item));
      if (result.finalization) setState(current => ({ ...current, chats: current.chats.map(chat => ({ ...chat, messages: chat.messages.map(message => message.runId === runId ? { ...message, finalization: result.finalization } : message) })) }));
    } catch (error) { setToast(`内核退出仍未确认：${errorText(error)}`, 'error'); }
    finally { setRecoveryAction(''); }
  }

  async function retryAutomationSave(runId) {
    setRecoveryAction(`automation:${runId}`);
    try {
      const snapshot = await desktop.retryAutomationSave(runId);
      if (snapshot?.tasks && snapshot?.runs) setAutomationState(snapshot);
      else setAutomationState(await desktop.listAutomations());
    } catch (error) { setToast(`自动化结果仍未保存：${errorText(error)}`, 'error'); }
    finally { setRecoveryAction(''); }
  }

  function openExport(message, { format, titleSuffix = '', includeHistory = false } = {}) {
    // 导出与分享的正文是纯文本，气泡里的「待核实」灰字带不过去，附一句同样的说明。
    const gap = message ? exportNote(message.unrestored) : exportNote(sumUnrestored(chat?.messages), { whole: true });
    const withGap = value => value ? value + gap : value;
    const original = withGap(message?.text || chatText(chat));
    if (!original) return;
    const history = includeHistory && desktop && chat ? {sessionId:chat.id,workspaceId:chat.workspaceId,projectId:chat.projectId||null} : undefined;
    openModal({ type: 'export-review', original, masked: withGap(message?.masked ?? (message ? undefined : chatText(chat, { protectedView: true }))), title: `${chat?.title || '知行成果'}${titleSuffix}`, history, ...(format?{format}:{}) });
  }

  async function saveExport(delivery) {
    try {
      if (desktop) {
        const result = await desktop.exportFile(delivery);
        if (result.cancelled) return { cancelled: true };
      } else downloadText(`${delivery.name}.txt`, delivery.text);
      setToast('已保存交付文件。'); setModal(null); return true;
    } catch (error) { setToast(`导出失败：${errorText(error)}`); if (desktop) throw error; return false; }
  }

  async function saveCurrentChat() {
    if (!loaded || storageFailed.current) {
      setToast('本机工作空间尚未成功读取，请先重试读取。', 'error');
      return;
    }
    try {
      if (!latest.current.settings.persist) {
        setMenu(null);
        setToast('本地保存已关闭，请使用导出菜单保存会话副本。');
        openExport(undefined,{format:'txt',titleSuffix:'（会话副本）'});
        return;
      }
      await draftWriter.flush();
      await persistWorkspaceSnapshot(latest.current);
      setMenu(null);
      setToast('当前会话已保存。');
    } catch (error) { setToast(`保存会话失败：${errorText(error)}`); }
  }

  async function shareCurrentChat() {
    const original = chatText(chat) + exportNote(sumUnrestored(chat?.messages), { whole: true });
    if (!original) return;
    openModal({ type: 'export-review', action: 'share', original, masked: chatText(chat, { protectedView: true }), title: chat.title || '知行会话' });
  }

  function writeClipboardText(text) {
    return desktop?.writeClipboardText ? desktop.writeClipboardText(text) : navigator.clipboard.writeText(text);
  }

  // 反馈只落本机：桌面版 dsh-message-feedback 同样只写 Session 日志、不进模型历史。
  // 这里没有 Session 日志可写，就单独存一份加密文件，并明确告诉用户可以清除。
  function openFeedback(message, rating) {
    const existing = feedbackFor(feedbackEntries, chat?.id ?? '', message.id);
    setFeedbackDraft({
      messageId: message.id,
      rating: existing?.rating === rating ? existing.rating : rating,
      category: existing?.category ?? null,
      note: existing?.note ?? '',
    });
  }

  async function saveFeedbackDraft() {
    if (!feedbackDraft || !desktop?.saveFeedback) return;
    try {
      const saved = await desktop.saveFeedback({
        conversationId: chat?.id ?? '', messageId: feedbackDraft.messageId,
        rating: feedbackDraft.rating, category: feedbackDraft.category, note: feedbackDraft.note,
      });
      setFeedbackEntries(current => [...current.filter(item => !(item.conversationId === saved.conversationId && item.messageId === saved.messageId)), saved]);
      setFeedbackDraft(null);
      setToast('反馈已记录在本机，不会发给模型。');
    } catch (error) {
      setToast(errorText(error), 'error');
    }
  }

  async function clearFeedbackDraft() {
    if (!feedbackDraft || !desktop?.clearFeedback) return;
    try {
      await desktop.clearFeedback({ conversationId: chat?.id ?? '', messageId: feedbackDraft.messageId });
      setFeedbackEntries(current => current.filter(item => !(item.conversationId === (chat?.id ?? '') && item.messageId === feedbackDraft.messageId)));
      setFeedbackDraft(null);
      setToast('已清除这条反馈。');
    } catch (error) {
      setToast(errorText(error), 'error');
    }
  }

  async function shareReviewedChat(delivery) {
    try {
      if (desktop) {
        await desktop.shareReviewed(delivery);
        setToast('已复制经主机审阅的会话内容，可粘贴到其他应用。');
      } else if (navigator.share) {
        await navigator.share({ title: modal.title, text: delivery.text });
        setToast('已交给系统分享。');
      } else {
        await writeClipboardText(delivery.text);
        setToast('已复制审阅后的会话内容，可粘贴到其他应用。');
      }
      setModal(null);
      return true;
    } catch (error) {
      if (error.name !== 'AbortError') setToast(error.message || '分享失败。');
      if (desktop) throw error;
      return false;
    }
  }

  function sessionMenuKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
      requestAnimationFrame(() => document.querySelector('.session-actions-anchor > .icon-button')?.focus({ preventScroll: true }));
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    if (!items.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }

  const privacyView = ['privacy', 'send-review'].includes(modal?.type);
  const reviewOriginal = privacyView ? modal.original ?? (input || files.length ? composePrompt(input, files.filter(file => file.status === 'ready')) : '示例：联系人：测试员，电话 138-0000-0000。') : '';
  const visibleEvents = events.filter(event => spaceChats.some(item => item.id === event.sessionId));
  const workContext={workspaceId:workspace.id,projectId:project?.id||null,sessionId:chat?.id||null};
  const workScopeKey=`${workspace.id}:${project?.id||chat?.id||'home'}`;
  const deliveryPreview = useDeliveryPreview({
    api: desktop,
    context: workContext,
    scopeKey: JSON.stringify([workspace.id, project?.id, project?.directory, chat?.id, viewToken.current]),
  });
  const sideChats=chats.filter(item=>item.workspaceId===workspace.id&&(item.projectId||null)===(project?.id||null)&&item.id!==chatId);
  const sideChatId=sideSelection.scope===workScopeKey&&sideChats.some(item=>item.id===sideSelection.id)?sideSelection.id:null;
  const sideChat=sideChats.find(item=>item.id===sideChatId);
  const sideDraftState=sideChatId?draftMap.current[`chat:${sideChatId}`]:null;
  const sideDraft=sideDraftState?.text||'';
  function selectSideChat(id) { setSideSelection({scope:workScopeKey,id}); }
  function createSideChat() {
    const id=uuid(),now=Date.now();
    setState(current=>({...current,chats:[...current.chats,{id,workspaceId:workspace.id,projectId:project?.id||null,title:'侧边聊天',mode,createdAt:now,updatedAt:now,messages:[]}]}));
    selectSideChat(id);
  }
  function setSideText(text) {
    if (!sideChatId) return;
    const key=draftKeyFor({workspaceId:workspace.id,projectId:project?.id,chatId:sideChatId});
    persistDraft(key,{text});
  }
  const runEvents=runningHere?events.filter(event=>event.runId===running.runId):[];
  const statsHere=runningHere&&liveStats?.runId===running.runId?liveStats.context:null;
  function openReview(path){ setReviewPath(typeof path==="string"?path:""); showWorkPage("review"); }
  function showWorkPage(page){setWorkPage(page);setPanel(true);setMenu(null);}
  function closeWorkPanel(){deliveryPreview.close();setPanel(false);}
  function returnToRunningChat() {
    const target = latest.current.chats.find(item => item.id === running?.chatId);
    if (!target) return;
    setState(current => ({ ...current, workspaceId: target.workspaceId }));
    navigate('home', target.id, target.projectId, false, target.workspaceId);
    showWorkPage('activity');
  }
  async function deliverableAction(file, action) {
    if (!desktop?.deliverableAction || !chat?.id) { setToast('打开或定位文件需要在桌面版的所属会话中进行。'); return; }
    const token=viewToken.current;
    setDeliverableBusy(current=>({...current,[file.path]:action}));
    try {
      const references=await desktop.listDeliverables(workContext);
      const reference=references.findLast(item=>item.path===file.path);
      if (!reference?.available || !reference.id) throw new Error(reference?.reason||'没有找到可核验的原生交付记录，请在原会话中重新交付。');
      const outcome=await desktop.deliverableAction({...workContext,id:reference.id,action});
      if (token!==viewToken.current) return;
      setToast(outcome?.kind==='revealed'?actionDoneLabel('reveal'):actionDoneLabel('open'));
    } catch (error) { if (token===viewToken.current) setToast(actionFailureLabel(action)+errorText(error),'error'); }
    finally { setDeliverableBusy(current=>{const next={...current};delete next[file.path];return next;}); }
  }
  function openDeliverable(file) {
    showWorkPage('deliverables');
    void deliveryPreview.open(file);
  }
  function attachWorkingMaterial(file){if(file.status!=='ready'){setToast('这份资料尚未解析。');return;}appendMaterials([{...file,workspaceId:workspace.id}]);}
  async function openAnswerUrl(url){showWorkPage('browser');if(desktop)try{await desktop.browserAction({...workContext,action:'new',url});}catch(error){setToast(errorText(error));}}
  function openConversationSource(source) {
    if (source.url) { void openAnswerUrl(source.url); return; }
    if (source.file) openModal({type:'document',value:{...source.file,status:source.file.status||'record',reason:source.recordOnly?'仅保留附件记录，原文件内容没有保存在此会话中。':source.file.reason}});
  }
  const draftState = { ...state, drafts: draftMap.current };
  const unresolvedDrafts = orphanDrafts(draftState);
  const unsentDrafts = newConversationDrafts(draftState).filter(draft => modeWorkspaceIds.has(draft.workspaceId));
  const pendingOutcomes = automationState.pendingOutcomes || [];
  const scopeProps = { workspace, projects, chats, spaceChats, documents, automations, taskRuns, project, mode, orphanDrafts: unresolvedDrafts };

  return <div className={`app-shell ${isDark ? 'dark' : ''} ${sidebarOpen ? '' : 'sidebar-hidden'} ${settingsPage ? 'settings-open' : ''}`}>
    <div className="app-body" inert={!!modal || !!settingsPage} aria-hidden={settingsPage ? true : undefined}>
      <Titlebar desktop={desktop} sidebarOpen={sidebarOpen} setSidebar={setSidebar} workspace={workspace}/>
      {sidebarOpen && <Sidebar state={state} workspace={workspace} projects={projects} chats={chats} activeChat={chat?.id} runningChatId={running?.chatId} activeProject={project} section={section} newChat={newChat} openChat={openChat} selectProject={selectProject} navigate={navigate} changeWorkspace={changeWorkspace} updateChat={updateChat} expandProject={id => updateProject(id, { expanded: !projects.find(item => item.id === id)?.expanded })} menu={menu} toggleMenu={toggleMenu} closeMenu={() => setMenu(null)} openModal={openModal} unread={unread} automations={automations} documents={documents} chooseFiles={chooseFiles} customTab={customTab} setCustomTab={setCustomTab}/>}
      <main className={`main-panel ${panel&&room?'with-workbench':''}`}>
        <div className="main-columns">
          <div className="main-content">
        <div className="main-topbar">
          <div className="top-path">{panel&&room?<><FolderOpen size={15}/><strong title={chat?.title||project?.name||workspace.name}>{chat?.title||project?.name||workspace.name}</strong></>:<><button onClick={() => navigate('home')}>{workspace.name}</button>{project && <><span>/</span><button onClick={() => selectProject(project.id)}>{project.name}</button></>}{chat && <><span>/</span><strong title={chat.title}>{chat.title}</strong></>}</>}</div>
          <div className="top-actions">
            {room&&<>
              <div className="menu-anchor session-actions-anchor">
                <IconButton icon={ShareNetwork} label="会话操作" aria-expanded={menu?.name==='session-actions'} onClick={event=>toggleMenu('session-actions',event)}/>
                {menu?.name==='session-actions'&&<div className="dropdown session-actions-menu" role="menu" aria-label="会话操作" onKeyDown={sessionMenuKeydown}>
                  <MenuItem icon={FloppyDisk} disabled={!loaded||storageFailed.current} onClick={saveCurrentChat}>保存会话</MenuItem>
                  <MenuItem icon={ShareNetwork} disabled={!chatText(chat)} onClick={shareCurrentChat}>分享或转发…</MenuItem>
                  <MenuItem icon={FileText} disabled={!chatText(chat)} onClick={()=>openExport(undefined,{format:'txt',titleSuffix:'（会话副本）'})}>复制为文件…</MenuItem>
                  <div className="menu-separator"/>
                  <MenuItem icon={DownloadSimple} disabled={!chatText(chat)} onClick={()=>openExport(undefined,{includeHistory:true})}>导出聊天文件…</MenuItem>
                </div>}
              </div>
              <div className="menu-anchor resources-anchor">
                <IconButton icon={ListBullets} label="查看当前对话产出与来源" aria-expanded={menu?.name==='resources'} onClick={event=>toggleMenu('resources',event)}/>
                {menu?.name==='resources'&&<ConversationResources messages={messages} liveTrace={runEvents} running={running} runningTitle={state.chats.find(item=>item.id===running?.chatId)?.title} onOpenDeliverable={openDeliverable} onOpenSource={openConversationSource} onViewActivity={()=>showWorkPage('activity')} onViewFiles={()=>showWorkPage('files')} onAddSource={()=>showWorkPage('browser')} onReturnToRun={returnToRunningChat} onClose={()=>setMenu(null)}/>}
              </div>
              <IconButton icon={SidebarSimple} label={panel?'隐藏工作面板':'打开工作面板'} aria-expanded={panel} onClick={()=>panel?closeWorkPanel():setPanel(true)}/>
            </>}
          </div>
        </div>
            {!!state.pendingWorkspaceDeletes?.length && <section className="running-return deletion-pending" role="alert"><WarningCircle size={15}/><span title={deletionError || '删除需要保存并完成内核记录清理。'}>{deletionError || '删除正在保存或等待清理，尚未确认完成。'}</span>{state.pendingWorkspaceDeletes.map(item => <button key={item.id} type="button" disabled={!!recoveryAction} onClick={() => void finishWorkspaceDeletion(item).catch(() => {})}>重试完成删除</button>)}</section>}
            {!!unresolvedDrafts.length && <section className="running-return orphan-drafts" role="status"><Info size={15}/><span>有 {unresolvedDrafts.length} 份旧草稿的聊天或项目已不存在，内容仍保留。</span><button type="button" onClick={() => openModal({ type: 'orphan-drafts' })}>恢复或删除</button></section>}
            {!!unsentDrafts.length && <section className="running-return unsent-drafts" role="status"><NotePencil size={15}/><span>有 {unsentDrafts.length} 份未发送的新草稿。</span><button type="button" onClick={() => openModal({ type: 'new-drafts' })}>查看草稿</button></section>}
            {cleanupPending.map(item => <section className="running-return runtime-cleanup-pending" role="alert" key={item.runId}><WarningCircle size={15}/><span title={item.finalization?.error?.message}>内核退出尚未确认，该会话暂不能重新执行。</span>{desktop?.retryRuntimeCleanup && <button type="button" disabled={!!recoveryAction} onClick={() => void retryCleanup(item.runId)}>重试清理</button>}</section>)}
            {pendingOutcomes.map(item => <section className="running-return automation-save-pending" role="alert" key={item.runId}><WarningCircle size={15}/><span title={item.persistenceError?.message}>自动化执行已结束，结果尚未保存；后续调度已暂停。</span>{item.result && <button type="button" onClick={() => openRun(item)}>查看结果</button>}{desktop?.retryAutomationSave && <button type="button" disabled={!!recoveryAction} onClick={() => void retryAutomationSave(item.runId)}>重试保存结果</button>}</section>)}
            {automationState.persistenceError && !pendingOutcomes.length && <section className="running-return automation-save-error" role="alert"><WarningCircle size={15}/><span>{automationState.persistenceError.message || '自动化记录保存失败，待恢复。'}</span></section>}
            {running&&!runningHere&&<div className="running-return" role="status"><CircleNotch size={14}/><span>{state.chats.find(item=>item.id===running.chatId)?.title||'另一段聊天'}{approvals.pending.some(item=>item.runId===running.runId)?'有待批准操作':questions.some(item=>item.runId===running.runId)?'需要补充信息':'正在执行'}</span><button type="button" onClick={returnToRunningChat}>返回任务</button></div>}
            {otherInteractionRoots.map(rootId => <section key={rootId} className="running-return interaction-return" role="status"><Info size={15}/><span>{state.chats.find(item=>item.id===rootId)?.title||'另一段交办'}等待你处理</span><button type="button" onClick={()=>{
              const target=latest.current.chats.find(item=>item.id===rootId);
              if(target){setState(current=>({...current,workspaceId:target.workspaceId}));navigate('home',target.id,target.projectId,false,target.workspaceId);}
            }}>查看待处理</button></section>)}
            {room ? <>
              {chat ? <section className="transcript" ref={transcript} onScroll={onTranscriptScroll} aria-label="聊天记录">
                {!messages.length && <p className="transcript-empty">这段聊天还没有消息。</p>}
                {messages.map((message, index) => message.role === 'user' ? <article className="user-message" key={message.id || index}>{message.text&&<p>{message.text}</p>}<ChatAttachments files={message.files}/></article> : <article className={`assistant-message ${message.error ? 'error-message' : ''}`} key={message.id || index}>
                  <div className="assistant-byline"><BrandMark className="assistant-icon"/><strong>{message.imported?'DeepSeek':'知行'}</strong><small>{message.imported?'导入记录':message.demo ? '演示回复' : message.error ? '运行错误' : message.stopped ? '已停止' : message.privacyMode === 'raw' ? '非脱敏模式' : '脱敏模式'}</small></div>
                  <div className="assistant-content">
                  {message.imported&&<ImportedActivity message={message} onOpenUrl={openAnswerUrl}/>}
                  <AgentChildren items={message.pending?runEvents.findLast(event=>event.type==='subagents')?.children:message.children} onView={()=>showWorkPage('activity')}/>
                  <TaskPlan items={message.pending?events.findLast(event=>event.runId===running?.runId&&event.type==='plan')?.plan:message.plan}/>
                  {message === currentContextMessage && message.context.planning && <p className="context-usage">规划模式 · 只读调查与方案设计 <button type="button" disabled={!!running || busy} onClick={() => void submit(null, null, '/plan off')}>退出规划模式</button></p>}
                  {message === currentContextMessage && currentGoal && <p className="context-usage">持续目标 · {({active:'进行中',paused:'已暂停',complete:'已完成',blocked:'需要补充'})[currentGoal.phase] || currentGoal.phase} · 第 {currentGoal.roundsStarted} / {currentGoal.maxGoalRounds} 轮 <button type="button" disabled={!!running || busy} onClick={() => void submit(null, null, goalAction[0])}>{goalAction[1]}</button></p>}
                  {(() => {
                    const rows = toolTimeline(message.pending ? runEvents : message.trace);
                    if (!rows.length) return null;
                    const truncated = message.pending ? running?.traceTruncated : message.traceTruncated;
                    return <details className="tool-strip">
                      <summary>{toolTimelineSummary(rows, { truncated })}</summary>
                      <ol>{rows.map(row => <li key={row.key} data-status={row.status}>
                        <span>{row.label}</span>
                        {Number.isSafeInteger(row.durationMs) && row.durationMs >= 100 ? <small>{(row.durationMs / 1000).toFixed(1)}s</small> : null}
                      </li>)}</ol>
                    </details>;
                  })()}
                  {message.pending&&<StreamingAnswer store={liveReplies} runId={message.runId} initialText={message.progressText} onOpenUrl={openAnswerUrl} onProgress={onStreamProgress}/>}
                  {message.pending ? <div className="thinking-label" role="status"><CircleNotch size={17}/>{running?.status==='cancelling'?'正在停止并保存已生成内容…':chatApprovals.some(item=>item.runId===message.runId)?'等待你批准':question?.runId===message.runId?'等待你补充信息':runStatusLabel(events,running?.runId)}</div> : <AnswerText text={message.text} onOpenUrl={openAnswerUrl} references={message.deliverables} onOpenFile={openDeliverable}/>}
                  {message.unrestored>0 && <p className="restore-note" role="status">{restoreNotice(message.unrestored)}</p>}
                  {!message.pending&&message.changes?.length>0&&<ChangedFiles files={message.changes} onOpen={file=>openReview(file?.path)}/>}
                  {!message.pending&&message.deliverables?.length>0&&<DeliveryCards files={message.deliverables} onOpen={openDeliverable} onAction={deliverableAction} pending={deliverableBusy}/>}
                  {!message.pending&&<details className="run-summary"><summary>详情</summary><dl>{summaryRows(message).map(row => <div className="run-summary-row" key={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></details>}
            {message.errorMessage&&<p className="run-error-detail" role="alert">{message.errorMessage}</p>}
                  {message.context?.measurement && <p className="context-usage">{contextUsageText(message.context.measurement.totalTokens, contextWindowTokens(runtime, state.settings, message.context.pressure?.contextWindow))} {message === currentContextMessage && <button type="button" disabled={!!running || busy} onClick={() => void submit(null, null, '/compact')}>压缩上下文</button>}</p>}
                  {message.finalization?.processStatus === 'cleanup_pending' && <p className="muted" role="status">执行已结束，内核退出仍待确认；请使用上方的重试清理。</p>}
                  {['pending', 'failed'].includes(message.finalization?.persistenceStatus) && <p className="muted" role="status">本次执行结果尚未保存。重试保存不会重新运行工具。</p>}
                  {message.finishReason === 'max-tokens' && <p className="muted">本轮达到输出上限，可以继续交办剩余部分。</p>}
                  {!message.pending && <div className="answer-actions">
                    {!!message.text && <><IconButton icon={Copy} label="复制回复" onClick={() => writeClipboardText(message.text).then(() => setToast('已复制。')).catch(error => setToast(errorText(error), 'error'))}/><IconButton icon={DownloadSimple} label="导出成果" onClick={() => openExport(message)}/></>}
                    {!message.imported && <><IconButton icon={ThumbsUp} label="赞这条回复" className={feedbackFor(feedbackEntries, chat?.id ?? '', message.id)?.rating === 'up' ? 'feedback-on' : ''} onClick={() => openFeedback(message, 'up')}/><IconButton icon={ThumbsDown} label="踩这条回复" className={feedbackFor(feedbackEntries, chat?.id ?? '', message.id)?.rating === 'down' ? 'feedback-on' : ''} onClick={() => openFeedback(message, 'down')}/></>}
                    {index === messages.length - 1 && !message.imported && <IconButton icon={ArrowCounterClockwise} label="再次执行" disabled={!!running || busy} onClick={() => submit(message.id)}/>}
                    {message.masked && <IconButton icon={ShieldCheck} label="查看发送详情" onClick={() => {
                      const source = messages.slice(0, index).findLast(item => item.role === 'user');
                      openModal({ type: 'privacy', original: source?.prompt || source?.text, preview: { text: source?.protected, privacyMode: source?.privacyMode }, output: message.masked });
                    }}/>}
                  </div>}
                  {(() => {
                    const saved = feedbackFor(feedbackEntries, chat?.id ?? '', message.id);
                    if (!saved) return null;
                    return <p className="feedback-recorded">本机反馈：{feedbackLabel(saved)}</p>;
                  })()}
                  {feedbackDraft?.messageId === message.id && <section className="feedback-panel" aria-label="消息反馈">
                    <p className="feedback-hint">只记在本机，不会发给模型，也不会随工作空间导出。</p>
                    <div className="feedback-categories" role="group" aria-label="反馈分类">
                      {FEEDBACK_CATEGORIES.map(item => <button key={item.id} type="button" className={feedbackDraft.category === item.id ? 'feedback-chip active' : 'feedback-chip'} aria-pressed={feedbackDraft.category === item.id} onClick={() => setFeedbackDraft(current => ({ ...current, category: current.category === item.id ? null : item.id }))}>{item.label}</button>)}
                    </div>
                    <textarea aria-label="反馈备注" rows={3} value={feedbackDraft.note} placeholder="补充说明（可选）" onChange={event => setFeedbackDraft(current => ({ ...current, note: event.target.value }))}/>
                    <div className="feedback-actions">
                      <small className={noteBytes(feedbackDraft.note) > FEEDBACK_NOTE_MAX_BYTES ? 'feedback-count over' : 'feedback-count'}>{noteBytes(feedbackDraft.note)} / {FEEDBACK_NOTE_MAX_BYTES} 字节</small>
                      <button type="button" className="secondary-button" onClick={() => setFeedbackDraft(null)}>取消</button>
                      <button type="button" className="secondary-button" onClick={() => void clearFeedbackDraft()}>清除</button>
                      <button type="button" className="primary-button" disabled={noteBytes(feedbackDraft.note) > FEEDBACK_NOTE_MAX_BYTES} onClick={() => void saveFeedbackDraft()}>保存反馈</button>
                    </div>
                  </section>}
                  </div>
                </article>)}
                {transcriptHasNew&&<button className="transcript-new-content" type="button" onClick={returnTranscriptToBottom}>有新内容 · 回到底部</button>}
              </section> : <div className="empty-stage"><section className="welcome" aria-label={project ? '项目交办' : '新建交办'}>
                {project ? <span className="welcome-icon"><FolderOpen size={28} weight="light"/></span> : <BrandMark className="brand-welcome"/>}
                <h1>{project ? project.name : mode === 'government' ? '今天要办理什么？' : '今天，有什么事交给知行？'}</h1>
                <p>{project ? `${chats.filter(item => item.projectId === project.id).length} 段聊天` : '知你所需，行你所托。'}</p>
                <div className="quick-workflows">{workflows[mode].slice(0, 3).map(([label, prompt]) => <button key={label} onClick={() => applyTemplate(prompt)}>{label}<ArrowUpRight size={13}/></button>)}</div>
                {project && <button className="text-button" onClick={() => openModal({ type: 'project-settings', value: project })}>项目说明</button>}
              </section></div>}
              <Composer takeover={chatApprovals.length ? <ApprovalPanel hostEpoch={approvals.hostEpoch} requests={chatApprovals} connection={approvals.connection} onStop={()=>stop(chatApprovals[0].runId)}/> : question ? <AgentQuestion key={question.requestId} inline request={question} count={questions.filter(item=>(item.rootSessionId||item.sessionId)===chatId).length} onStop={()=>stop(question.runId)} onAnswer={value=>desktop.answerQuestion({...value,runId:question.runId,rootSessionId:question.rootSessionId||question.sessionId})}/> : null} queue={queuedFor(queue, chatId)} onRemoveQueued={discardQueued} onRetryQueued={retryQueued} onEditQueued={editQueued} settings={state.settings} files={files} input={input} draftStore={draftSlices} draftKey={renderedDraftKey} setInput={setInput} setFiles={setFiles} setSetting={setSetting} onSubmit={() => submit()} onStop={stop} running={runningHere} disabled={!loaded || storageFailed.current || (!!running && !runningHere)} busy={busy} chooseFiles={chooseFiles} addFiles={addFiles} openModal={openModal} menu={menu} toggleMenu={toggleMenu} closeMenu={() => setMenu(null)} composer={composer} runtime={runtime} setRuntime={setRuntime} openWorkbench={showWorkPage} scopeKey={viewToken.current} onLocalCommand={localCommand} suspended={!!modal||!!settingsPage}/>
            </> : <UtilityPage key={section} section={section} sidebarOpen={sidebarOpen} scope={scopeProps} chooseFiles={chooseFiles} attach={attach} toggleTask={toggleTask} runTask={runTask} taskAction={taskAction} openRun={openRun} openModal={openModal} openChat={openChat} useTemplate={applyTemplate} events={visibleEvents} customTab={customTab} setCustomTab={setCustomTab}/>}
          </div>
          {room&&<ErrorBoundary key={workScopeKey} scope="workbench" hidden={!panel}><Workbench deliveryPreview={deliveryPreview.preview && <DeliveryPreview preview={deliveryPreview.preview} onBack={deliveryPreview.close} onRetry={deliveryPreview.retry} onEnlarge={value => openModal({type:'document',value})}/>} draftStore={draftSlices} liveReplies={liveReplies} key={workScopeKey} visible={panel} suspended={!!modal||!!settingsPage||!!menu} onClose={closeWorkPanel} page={workPage} setPage={setWorkPage} chatTitle={chat?.title} context={workContext} scopeKey={workScopeKey} scopeReady={scopeReady} scopeError={workspaceSave.status==='failed'?(workspaceSave.errorCode||'本机工作空间保存失败。'):''} project={project} files={files} fileRequest={fileRequest} statsContext={statsHere||messages.findLast(message=>message.context)?.context} statsLive={!!statsHere} liveTrace={runEvents} liveRun={runningHere?running.runId:null} traceTruncated={runningHere&&running.traceTruncated} messages={messages} changes={reviewSource?.changes||[]} changeDiffs={reviewSource?.changeDiffs||[]} reviewPath={reviewPath} onReviewSelect={setReviewPath} attach={attachWorkingMaterial} openProject={()=>openModal(project?{type:'project-settings',value:project}:{type:'new-project'})} openDeliverable={openDeliverable} mode={mode} privacyMode={state.settings.privacyMode} sideChat={sideChat} sideChatId={sideChatId} sideChats={sideChats} sideDraft={sideDraft} sideFiles={sideDraftState?.files||[]} onOpenUrl={openAnswerUrl} onSideText={setSideText} onSideSelect={selectSideChat} onSideNew={createSideChat} onSideSubmit={()=>submit(null,{chatId:sideChatId,scope:workScopeKey})} sideRunning={!!running&&running.chatId===sideChatId} sendDisabled={!loaded||busy||!!running||storageFailed.current} onStop={stop}/></ErrorBoundary>}

        </div>
      </main>
    </div>
    {settingsPage && <div className="settings-shell" inert={!!modal}>
      <Titlebar desktop={desktop} sidebarOpen={sidebarOpen} setSidebar={setSidebar} workspace={workspace} settingsMode/>
      <AppRail section={section} settings navigate={navigate} openModal={openModal}/>
      <Settings key={settingsPage.tab || '常规'} modal={settingsPage} close={() => setSettingsPage(null)} setModal={openModal} state={state} scope={scopeProps} setSetting={setSetting} runtime={runtime} setRuntime={setRuntime} changeWorkspace={changeWorkspace} notify={setToast}/>
    </div>}
    <input hidden ref={picker} type="file" accept=".txt,.md,.csv,.tsv,.json,.docx,.xlsx,.pptx,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" multiple onChange={event => {
      const list = Array.from(event.target.files); event.target.value = '';
      const request = fileTarget.current; fileTarget.current = null;
      if (request) void addFiles(list, request.target, request.spaceId, request.token, request.draftKey, request.filesRevision);
    }}/>
    <section hidden={workspaceSave.status==='saved'} data-save-status={workspaceSave.status} className={`workspace-save-banner ${workspaceSave.status}`} role={workspaceSave.status === 'failed' ? 'alert' : 'status'} aria-live={workspaceSave.status === 'failed' ? 'assertive' : 'polite'}>
      {workspaceSave.status === 'failed' ? <WarningCircle size={17}/> : workspaceSave.status === 'saved' ? <Check size={17}/> : <CircleNotch className={workspaceSave.status === 'saving' ? 'spinning' : ''} size={17}/>}
      <span>{workspaceSave.status === 'failed' ? `${storageFailed.current?'工作空间读取失败':'工作空间保存失败'}：${workspaceSave.errorCode || '请检查磁盘空间和本机权限。'}` : workspaceSave.status === 'recovering' ? '正在读取并恢复本机工作空间…' : workspaceSave.status === 'saved' ? '' : '正在保存工作空间…'}</span>
      {workspaceSave.status === 'failed' && <button type="button" className="secondary-button" onClick={() => void retryWorkspaceSave()}>{storageFailed.current?'重试读取':'重试保存'}</button>}
    </section>
    {toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>{toast.type === 'error' ? <WarningCircle size={15}/> : toast.type === 'success' ? <Check size={15}/> : <Info size={15}/>}<span>{toast.message}</span>{toast.type === 'error'&&<button type="button" className="toast-dismiss" aria-label="关闭错误提示" onClick={()=>setToast(null)}>×</button>}</div>}

    {privacyView && <PrivacyReview key={modal.type} modal={modal} original={reviewOriginal} terms={state.settings.customTerms} policy={state.settings.privacyPolicy} currentMode={state.settings.privacyMode} onClose={() => setModal(null)} onSettings={() => openModal({ type: 'settings', tab: '隐私与数据' })} onSend={() => startReply(modal.draft, modal.preview)}/>}
    {modal?.type === 'export-review' && <ExportReview title={modal.title} original={modal.original} masked={modal.masked} history={state.settings.persist?modal.history:undefined} terms={state.settings.customTerms} policy={state.settings.privacyPolicy} privacyMode={state.settings.privacyMode} desktop={desktop} action={modal.action} defaultFormat={modal.format} onClose={() => setModal(null)} onExport={modal.action==='share'?shareReviewedChat:saveExport}/>}
    {modal?.type === 'new-drafts' && <Modal title="未发送的新草稿" onClose={() => setModal(null)}><p className="modal-copy">选择一份继续编辑。草稿保留在各自的空间和项目中。</p><div className="record-list">{unsentDrafts.map(draft => <article key={draft.key} data-draft-key={draft.key}><NotePencil size={16}/><span><strong>{draft.text.trim().replace(/\s+/g, ' ').slice(0, 80) || '仅附件草稿'}</strong><small>{state.workspaces.find(space => space.id === draft.workspaceId)?.name} · {state.projects.find(project => project.id === draft.projectId)?.name || '未归入项目'}</small><small>{draft.text.length} 字 · {draft.files.length} 个附件 · {new Date(draft.updatedAt).toLocaleString('zh-CN')}</small></span><button type="button" className="secondary-button" onClick={() => openNewDraft(draft.key)}>继续编辑</button></article>)}{!unsentDrafts.length && <p className="empty-note">没有未发送的新草稿。</p>}</div></Modal>}
    {modal && !privacyView && !['export-review', 'new-drafts'].includes(modal.type) && <Dialogs key={`${modal.type}-${modal.id || ''}`} modal={modal} setModal={openModal} state={draftState} setState={setState} scope={scopeProps} recoverDraft={recoverOrphanDraft} discardDraft={discardOrphanDraft} openChat={openChat} importDeepSeek={importDeepSeek} runtime={runtime} setRuntime={setRuntime} setSetting={setSetting} useTemplate={applyTemplate} removeItem={removeItem} updateChat={updateChat} createProject={createProject} updateProject={updateProject} saveWorkspace={saveWorkspace} changeWorkspace={changeWorkspace} attach={attach} taskAction={taskAction} openRun={openRun} notify={setToast} markRead={() => setUnread(false)}/>}
  </div>;
}

function TaskPlan({items}) {
  if(!items?.length)return null;
  return <details className="agent-plan" open><summary>工作计划 · {items.filter(item=>item.status==='completed').length}/{items.length}</summary><ol>{items.map((item,index)=><li key={index} data-status={item.status}><span className="plan-status">{item.status==='completed'?<Check size={14}/>:item.status==='in_progress'?<CircleNotch size={14}/>:<span/>}</span><span>{item.content.replace(/⟦ZX-[^⟧]+⟧/g,'【已保护信息】')}</span></li>)}</ol></details>;
}

function AgentChildren({items,onView}){if(!items?.length)return null;return <div className="agent-children"><button className="text-button" onClick={onView}>查看 {items.length} 个协作子任务</button></div>;}


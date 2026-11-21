import { createHash, randomUUID } from 'node:crypto';
import { acceptOccurrence, nextScheduledTime, normalizeTiming, previewTiming } from './schedule-rules.mjs';
import { automationInput } from '../src/automation-core.js';
import { PrivacySession } from '../src/privacy-core.js';
import { PRIVACY_ENGINE_VERSION } from '../src/privacy-policy.js';
import {containsCredential} from '../src/privacy-recognizers.js';
import {assertModelCredential} from '../src/provider-options.js';

const copy = value => structuredClone(value);
const ID = /^[\w-]{1,100}$/;
const MAX_BYTES = 8 * 1024 * 1024;

function readTarget(task, context) {
  if (task.kind !== 'agent') return { kind: 'new' };
  const target = task.target ?? { kind: 'new' };
  if (target.kind === 'session') {
    const chat = context.chats?.find(candidate => candidate.id === target.chatId && candidate.workspaceId === task.workspaceId
      && (candidate.projectId || null) === (task.projectId || null) && !candidate.archived && !candidate.automationTaskId);
    if (!chat) throw new Error('所选聊天已归档、删除或移出当前项目。');
    const history = (chat.messages || []).filter(message => !message.automationRunId && !message.pending && !message.demo && !message.error && !message.stopped && message.text).slice(-6);
    return { kind: 'session', chat, history };
  }
  if (!['new', 'new_once'].includes(target.kind)) throw new Error('请选择有效的任务结果位置。');
  return { kind: target.kind };
}

export class AutomationService {
  constructor({ read, write, getContext, getConfiguration, getKey, runtime, onChange, notify, now = Date.now }) {
    Object.assign(this, { read, write, getContext, getConfiguration, getKey, runtime, onChange, notify, now });
    this.state = { version: 1, revision: 0, tasks: [], runs: [] };
    this.tail = Promise.resolve(); this.active = new Map(); this.pendingOutcomes = new Map(); this.saveRetries = new Map(); this.approvals = new Map(); this.working = false; this.closed = false;
  }

  async initialise(legacy = []) {
    const saved = await this.read();
    if (saved && (saved.version !== 1 || !Array.isArray(saved.tasks) || !Array.isArray(saved.runs))) throw new Error('自动化记录无法读取，原文件已保留。');
    this.state = saved || { version: 1, revision: 0, tasks: copy(legacy), runs: [] };
    this.state.tasks = this.state.tasks.map(task => ({ ...task, documentIds: task.documentIds || [],
      ...(task.kind === 'agent' && task.approval?.privacyEngineVersion!==PRIVACY_ENGINE_VERSION ? { enabled: false, status: '待重新审阅', approval:null } : {}),
      ...(task.status === '运行中' || this.state.runs.some(run => run.taskId === task.id && run.status === 'running') ? { enabled: false, status: '上次运行已中断' } : {}),
    }));
    this.state.runs = this.state.runs.map(run => run.status === 'running' ? { ...run, status: 'interrupted', finishedAt: this.now(), message: '上次运行的最终状态未保存，任务已暂停；请先核对可能已发生的操作，再决定是否重新运行。' } : run);
    await this.commit(() => {});
    return this.snapshot();
  }

  snapshot() {
    const tasks = copy(this.state.tasks), runs = copy(this.state.runs), pendingOutcomes = copy([...this.pendingOutcomes.values()]);
    for (const outcome of pendingOutcomes) {
      const run = runs.find(item => item.id === outcome.runId);
      if (run) Object.assign(run, this.outcomeFields(outcome));
      const task = tasks.find(item => item.id === outcome.taskId);
      if (task) Object.assign(task, { enabled: false, status: this.pendingLabel(outcome) });
    }
    return { revision: this.state.revision, tasks, runs, pendingOutcomes,
      persistenceError: pendingOutcomes.length ? { code: 'AUTOMATION_SAVE_FAILED', stage: 'persist', message: '自动化结果尚未保存，请重试保存；受影响任务已暂停。', runIds: pendingOutcomes.map(item => item.runId) } : null };
  }

  list() { return this.snapshot(); }
  changed() { try { this.onChange?.(this.snapshot()); } catch { /* A renderer notification cannot undo a durable write. */ } }
  pendingLabel(outcome) { return outcome.finalization.executionStatus === 'completed' ? '执行完成，结果保存失败' : outcome.finalization.executionStatus === 'cancelled' ? '执行已停止，状态保存失败' : '执行失败，状态保存失败'; }
  hasPending(taskId) { return [...this.pendingOutcomes.values()].some(outcome => outcome.taskId === taskId); }
  requireSaved(taskId) { if (this.hasPending(taskId)) throw new Error('此任务有尚未保存的结果，请先重试保存。'); }
  outcomeFields(outcome) { return { status: outcome.status, finishedAt: outcome.finishedAt, message: outcome.message, finalization: copy(outcome.finalization), ...(outcome.result ? { result: copy(outcome.result) } : {}) }; }
  applyOutcome(draft, outcome, wasPending = false) {
    const run = draft.runs.find(item => item.id === outcome.runId);
    if (!run) throw new Error('待保存的运行记录不存在，原结果已保留。');
    Object.assign(run, this.outcomeFields(outcome));
    const live = draft.tasks.find(item => item.id === outcome.taskId);
    if (live) {
      live.status = outcome.status === 'completed' ? live.kind === 'reminder' ? '已提醒' : '已完成' : outcome.status === 'stopped' ? '已停止' : '运行失败';
      if (outcome.result) live.resultChatId = outcome.result.chatId;
      if (wasPending) live.enabled = false;
      if (outcome.finalization.processStatus === 'cleanup_pending') Object.assign(live, { enabled: false, status: '内核退出待确认，任务已暂停' });
    }
  }

  persistenceFailure(error) { return { code: 'AUTOMATION_SAVE_FAILED', stage: 'persist', message: `自动化结果保存失败：${this.safeError(error)}` }; }

  async retrySave(runId) {
    if (typeof runId !== 'string' || !ID.test(runId)) throw new Error('运行编号无效。');
    if (this.saveRetries.has(runId)) return this.saveRetries.get(runId);
    const outcome = this.pendingOutcomes.get(runId);
    if (!outcome) {
      if (this.state.runs.some(run => run.id === runId && run.status !== 'running')) return this.snapshot();
      throw new Error('没有对应的待保存结果。');
    }
    const retry = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = this.pendingOutcomes.get(runId), version = current.finalization;
          const saved = copy(current); saved.finalization.persistenceStatus = 'saved';
          // A persistence error is cleared by this write; execution/cleanup errors remain.
          if (saved.finalization.error?.code === 'AUTOMATION_SAVE_FAILED') delete saved.finalization.error;
          await this.commit(draft => this.applyOutcome(draft, saved, true));
          // Exit may have been confirmed while the write was in flight. Save
          // that newer state as well before discarding the in-memory outcome.
          if (current.finalization !== version) continue;
          this.pendingOutcomes.delete(runId); this.changed();
          return this.snapshot();
        }
        throw new Error('内核收尾状态仍在更新，结果已保留，请再次保存。');
      } catch (cause) {
        outcome.persistenceError = this.persistenceFailure(cause); this.changed();
        throw Object.assign(new Error(outcome.persistenceError.message, { cause }), { code: 'AUTOMATION_SAVE_FAILED', stage: 'persist' });
      } finally { this.saveRetries.delete(runId); }
    })();
    this.saveRetries.set(runId, retry);
    return retry;
  }

  commit(mutate, retainRunIds = []) {
    const job = this.tail.then(async () => {
      const draft = copy(this.state);
      for (const outcome of this.pendingOutcomes.values()) {
        const task = draft.tasks.find(item => item.id === outcome.taskId);
        if (task) Object.assign(task, { enabled: false, status: this.pendingLabel(outcome) });
      }
      const value = mutate(draft);
      draft.revision = (draft.revision || 0) + 1;
      const retained = new Set([...this.pendingOutcomes.keys(), ...retainRunIds]);
      const removableRun = () => draft.runs.findIndex(run => run.status !== 'running' && !retained.has(run.id));
      while (draft.runs.length > 120) {
        const removable = removableRun();
        if (removable < 0) throw new Error('运行中与待保存的自动化记录不能清理，请先完成保存。');
        draft.runs.splice(removable, 1);
      }
      while (draft.runs.length && Buffer.byteLength(JSON.stringify(draft)) > MAX_BYTES) {
        const removable = removableRun();
        if (removable < 0) break;
        draft.runs.splice(removable, 1);
      }
      if (Buffer.byteLength(JSON.stringify(draft)) > MAX_BYTES) throw new Error('自动化记录空间不足，请减少任务数量或资料。');
      await this.write(draft); this.state = draft;
      this.changed();
      return value;
    });
    this.tail = job.catch(() => {});
    return job;
  }

  task(id) {
    const task = this.state.tasks.find(item => item.id === id);
    if (!task) throw new Error('任务已不存在。');
    return copy(task);
  }

  previewTiming(value) {
    return previewTiming(value, this.now());
  }

  async save(value) {
    if (this.closed) throw new Error('调度器正在关闭。');
    const context = this.getContext();
    if (!context.settings?.persist) throw new Error('请先在设置中开启保存聊天与资料，再创建桌面自动化。');
    const id = value.id || randomUUID();
    if (!ID.test(id) || (value.id && !this.state.tasks.some(task => task.id === id))) throw new Error('任务编号无效。');
    this.requireSaved(id);
    if (this.active.has(id)) throw new Error('请先停止此任务再编辑。');
    if (this.state.tasks.length >= 100 && !value.id) throw new Error('最多保存 100 个自动化任务。');
    if (!['agent', 'reminder'].includes(value.kind) || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60 || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 24000) throw new Error('任务名称、说明或类型无效。');
    if (!Array.isArray(value.documentIds || []) || (value.documentIds || []).length > 12 || new Set(value.documentIds || []).size !== (value.documentIds || []).length) throw new Error('所选资料无效。');
    const old = value.id ? this.task(id) : {};
    const now = this.now();
    const { timing, nextRun } = normalizeTiming(value, now);
    const selectedTarget = readTarget(value, context);
    const target = { kind: selectedTarget.kind, ...(selectedTarget.chat ? { chatId: selectedTarget.chat.id } : {}) };
    const sameTarget = JSON.stringify(old.target) === JSON.stringify(target);
    const task = { id, workspaceId: value.workspaceId, projectId: value.projectId || null, kind: value.kind,
      name: value.name.trim(), description: value.description.trim(), ...timing,
      documentIds: value.kind === 'agent' ? value.documentIds || [] : [],
      createdAt: old.createdAt || now, updatedAt: now, revisionToken: randomUUID(), enabled: false, status: '已暂停',
      target, reservedSessionId: target.kind === 'new_once' ? (sameTarget ? old.reservedSessionId : null) || randomUUID() : null,
      resultChatId: sameTarget ? old.resultChatId ?? null : null, lastRun: old.lastRun || null, approval: null, nextRun,
    };
    automationInput(task, context);
    if (!nextRun) throw new Error('这条规则没有未来的执行时间，请调整后保存。');
    await this.commit(draft => {
      const current = draft.tasks.find(item => item.id === id);
      if (this.active.has(id) || (value.id && (!current || current.revisionToken !== old.revisionToken))) throw new Error('任务正在运行或已变更，请刷新后重试。');
      draft.tasks = [...draft.tasks.filter(item => item.id !== id), task];
    });
    return this.snapshot();
  }

  async spec(task) {
    const context = this.getContext();
    if (!context.settings?.persist) throw new Error('本地保存已关闭，自动化已暂停。');
    const target = readTarget(task, context);
    const input = automationInput(task, context, target.history), settings = context.settings;
    // Scheduled tasks only use the reviewed material snapshot; never inherit interactive file access.
    const config = { model: settings.model, reasoning: settings.reasoning, ...this.getConfiguration(settings), permission: 'ask', workspaceRoot: undefined,privacyPolicy:settings.privacyPolicy,allowQuestions:false,allowNetwork:false,mcpServers:[] };
    if (!['redact', 'raw'].includes(settings.privacyMode)) throw new Error('发送模式无效。');
    const descriptor = { taskId: task.id, workspaceId: task.workspaceId, projectId: task.projectId, kind: task.kind,
      name: task.name, prompt: input.prompt, mode: input.mode, frequency: task.frequency, time: task.time, anchorDate: task.anchorDate,
      ...(task.rule ? { rule: task.rule } : {}),
      ...(task.target && task.target.kind !== 'new' ? { target: task.target } : {}),
      ...(task.revisionToken ? { revisionToken: task.revisionToken } : {}),
      privacyMode: settings.privacyMode, privacyEngineVersion:PRIVACY_ENGINE_VERSION, customTerms: settings.customTerms || [], config,
    };
    const digest = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
    const sessionId = task.reservedSessionId
      ? `auto-${createHash('sha256').update(task.reservedSessionId + digest).digest('hex').slice(0, 40)}`
      : randomUUID();
    return { ...input, digest, config, sessionId, targetChat: target.chat, privacyMode: settings.privacyMode, customTerms: settings.customTerms || [] };
  }

  async prepare(id, action) {
    if (!['enable', 'run'].includes(action)) throw new Error('审阅操作无效。');
    const task = this.task(id);
    this.requireSaved(id);
    if (task.kind !== 'agent' || this.active.has(id)) throw new Error('此任务无需模型审阅或正在运行。');
    const spec = await this.spec(task), key = await this.getKey(spec.config);
    if (!key) throw new Error('请先配置模型连接。');
    assertModelCredential(key);
    if (containsCredential(spec.prompt,key)) throw new Error('任务包含已配置的模型凭证，请移除。');
    const { sessionId } = spec;
    const preview = await this.runtime.preview({ sessionId, prompt: spec.prompt, mode: spec.mode, privacyMode: spec.privacyMode, customTerms: spec.customTerms }, spec.config);
    if (preview.blocked || !preview.preparationId) return { ...preview, approvalId: null };
    const approvalId = randomUUID(), now = this.now();
    for (const [token, entry] of this.approvals) if (entry.expires <= now || entry.taskId === id) this.approvals.delete(token);
    if (this.approvals.size >= 12) this.approvals.delete(this.approvals.keys().next().value);
    this.approvals.set(approvalId, { taskId: id, action, digest: spec.digest, preparationId: preview.preparationId, sessionId, expires: now + 10 * 60 * 1000 });
    return { ...preview, approvalId, targetTitle: spec.targetChat?.title, original: `任务模式：${spec.mode === 'government' ? '政务' : '办公'}\n\n${spec.prompt}`, documentNames: spec.documents.map(file => file.name) };
  }

  async confirm(approvalId) {
    const approval = this.approvals.get(approvalId);
    this.approvals.delete(approvalId);
    if (!approval || approval.expires <= this.now()) throw new Error('审阅已过期，请重新预览。');
    const task = this.task(approval.taskId), spec = await this.spec(task);
    this.requireSaved(task.id);
    if (spec.digest !== approval.digest) throw new Error('任务、资料或模型设置已变化，请重新审阅。');
    if (approval.action === 'run') return this.launch(task, { preparationId: approval.preparationId, sessionId: approval.sessionId, spec, manual: true });
    const nextRun = nextScheduledTime(task, this.now());
    if (!nextRun) throw new Error('任务时间已过，请重新编辑时间。');
    await this.commit(draft => {
      const live = draft.tasks.find(item => item.id === task.id);
      this.requireSaved(task.id);
      if (!live || live.revisionToken !== task.revisionToken) throw new Error('任务已变化，请重新审阅。');
      Object.assign(live, { enabled: true, nextRun, status: '待执行', approval: { digest: spec.digest, privacyEngineVersion:PRIVACY_ENGINE_VERSION, privacyMode: spec.privacyMode, baseUrl: spec.config.baseUrl, model: spec.config.model, approvedAt: this.now() } });
    });
    return { enabled: true };
  }

  async toggle(id, enabled) {
    const task = this.task(id);
    this.requireSaved(id);
    if (enabled && task.kind === 'agent') throw new Error('AI 自动化需要先审阅并确认发送内容。');
    if (enabled && !this.getContext().settings?.persist) throw new Error('请先开启本地保存。');
    const nextRun = enabled ? nextScheduledTime(task, this.now()) : task.nextRun;
    if (enabled && !nextRun) throw new Error('任务时间已过，请重新编辑。');
    await this.commit(draft => {
      const current = draft.tasks.find(item => item.id === id);
      this.requireSaved(id);
      if (!current || current.revisionToken !== task.revisionToken) throw new Error('任务已变更，请刷新后重试。');
      Object.assign(current, { enabled: !!enabled, nextRun, ...(this.active.has(id) ? {} : { status: enabled ? '待执行' : '已暂停' }) });
    });
    return this.snapshot();
  }

  async remove(id) {
    this.task(id);
    this.requireSaved(id);
    if (this.active.has(id)) throw new Error('请先停止正在运行的任务。');
    await this.commit(draft => { draft.tasks = draft.tasks.filter(task => task.id !== id); });
    return this.snapshot();
  }

  async runReminder(id) {
    const task = this.task(id);
    if (task.kind !== 'reminder') throw new Error('AI 任务需要先审阅。');
    return this.launch(task, { manual: true });
  }

  async pauseInvalid(task, reason) {
    await this.commit(draft => { const current = draft.tasks.find(item => item.id === task.id); if (current) Object.assign(current, { enabled: false, status: reason }); });
  }

  start(interval = 1500) {
    this.closed = false;
    if (this.timer) return;
    this.interval = interval;
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, interval);
    this.timer.unref?.();
    void this.tick().catch(() => {});
  }

  async tick() {
    if (this.closed || this.working) return;
    this.working = true;
    try {
      for (const task of this.state.tasks.filter(item => item.enabled)) {
        if (this.active.has(task.id) || this.hasPending(task.id)) continue;
        if (!this.getContext().settings?.persist) { await this.pauseInvalid(task, '本地保存已关闭，待启用'); continue; }
        if (!this.getContext().workspaces?.some(space => space.id === task.workspaceId)) { await this.pauseInvalid(task, '工作空间已不存在'); continue; }
        let spec;
        if (task.kind === 'agent') {
          try { spec = await this.spec(task); } catch { await this.pauseInvalid(task, '资料、聊天或模型连接已变更，待审阅'); continue; }
          if (task.approval?.digest !== spec.digest) { await this.pauseInvalid(task, '任务、资料或发送设置已变更，待审阅'); continue; }
        }
        if (this.active.size || !Number.isFinite(task.nextRun) || task.nextRun > this.now()) continue;
        await this.launch(task, { manual: false, spec });
      }
    } finally { this.working = false; }
  }

  async launch(task, { manual, spec, preparationId, sessionId = spec?.sessionId || randomUUID() }) {
    this.requireSaved(task.id);
    if (this.closed || this.active.has(task.id)) throw new Error('此任务正在运行或调度器正在关闭。');
    if (this.active.size >= 1) throw new Error('另一个自动化任务正在运行，请稍后再试。');
    const runId = randomUUID(), startedAt = this.now(), active = { runId, cancelled: false, promise: null };
    this.active.set(task.id, active);
    let ready;
    active.promise = new Promise(resolve => { ready = resolve; });
    try {
      await this.commit(draft => {
        const live = draft.tasks.find(item => item.id === task.id);
        if (!live || live.revisionToken !== task.revisionToken) throw new Error('任务已变化，请重新加载。');
        let scheduledAt = null;
        if (!manual) {
          if (!live.enabled || live.nextRun !== task.nextRun) throw new Error('任务计划已变化。');
          ({ scheduledAt, nextRun: live.nextRun } = acceptOccurrence(live, startedAt));
          if (!live.nextRun) live.enabled = false;
        }
        Object.assign(live, { lastRun: startedAt, status: '运行中' });
        draft.runs.push({ id: runId, taskId: task.id, workspaceId: task.workspaceId, name: task.name, kind: task.kind, manual, startedAt, scheduledAt, status: 'running', events: [], privacyMode: spec?.privacyMode, model: spec?.config.model });
      });
    } catch (error) { this.active.delete(task.id); ready(); throw error; }
    void this.execute(task, active, { spec, preparationId, sessionId }).finally(ready);
    return { runId };
  }

  async execute(task, active, { spec, preparationId, sessionId }) {
    let result, executionSpec, runtimeFinalization, executionError, status = 'completed', message = task.kind === 'reminder' ? '本机提醒已触发。' : '任务已完成。';
    try {
      if (active.cancelled) throw new Error('已停止。');
      if (task.kind === 'agent') {
        const fresh = await this.spec(this.task(task.id));
        executionSpec = fresh;
        if (!spec || fresh.digest !== spec.digest) throw new Error('任务、资料或发送设置已变化，请重新审阅。');
        const key = await this.getKey(fresh.config);
        if (active.cancelled) throw new Error('已停止。');
        const answer = preparationId
          ? await this.runtime.runPrepared({ runId: active.runId, preparationId }, fresh.config, key)
          : await this.runtime.run({ runId: active.runId, sessionId, prompt: fresh.prompt, mode: fresh.mode, privacyMode: fresh.privacyMode, customTerms: fresh.customTerms }, fresh.config, key);
        runtimeFinalization = answer.finalization;
        result = this.resultFromAnswer(answer, fresh, task);
        if (active.cancelled) throw new Error('已停止。');
      }
    } catch (error) {
      runtimeFinalization = error.finalization || runtimeFinalization;
      // Only RuntimeManager's fully validated result is attached to an error;
      // unvalidated model text is never used as an automation outcome.
      if (error.result && executionSpec) result = this.resultFromAnswer(error.result, executionSpec, task);
      status = active.cancelled ? 'stopped' : 'failed';
      message = status === 'stopped' ? '已停止本次运行。' : this.safeError(error);
      executionError = { code: error.code || (active.cancelled ? 'RUNTIME_CANCELLED' : 'AUTOMATION_EXECUTION_FAILED'), stage: error.stage || 'execute', message };
    }
    const finalization = { ...runtimeFinalization, runId: active.runId,
      executionStatus: runtimeFinalization?.executionStatus || (status === 'completed' ? 'completed' : status === 'stopped' ? 'cancelled' : 'failed'),
      persistenceStatus: 'saved', processStatus: runtimeFinalization?.processStatus || 'exited', eventWatermark: runtimeFinalization?.eventWatermark || 0,
      ...(runtimeFinalization?.error || executionError ? { error: runtimeFinalization?.error || executionError } : {}) };
    active.executionFinished = true;
    const outcome = { id: active.runId, runId: active.runId, taskId: task.id, status, finishedAt: this.now(), message, ...(result ? { result } : {}), finalization };
    try {
      await this.commit(draft => this.applyOutcome(draft, outcome), [outcome.runId]);
      try { if (this.getContext().settings?.notifications) this.notify?.({ label: status === 'completed' ? task.kind === 'reminder' ? '有一项本机提醒，请打开知行查看。' : '自动化任务已完成，请打开知行查看。' : '自动化任务状态有更新，请打开知行查看。' }); } catch { /* Notification is independent of execution and persistence. */ }
    } catch (error) {
      outcome.persistenceError = this.persistenceFailure(error);
      outcome.finalization.persistenceStatus = 'pending';
      outcome.finalization.error ||= outcome.persistenceError;
      this.pendingOutcomes.set(outcome.runId, outcome);
      this.changed();
    }
    finally {
      this.active.delete(task.id);
      const latest = active.latestFinalization;
      if (latest && (latest.processStatus !== outcome.finalization.processStatus || latest.eventWatermark !== outcome.finalization.eventWatermark)) {
        await this.recordEvent({ type: 'run/terminal', runId: active.runId, finalization: latest });
      }
    }
  }

  resultFromAnswer(answer, spec, task) {
    return { text: answer.text, masked: answer.masked, modelInput: answer.modelInput, privacyMode: answer.privacyMode, finishReason: answer.finishReason, sessionId: answer.sessionId,
      providerId: spec.config.providerId, providerUrl: spec.config.baseUrl,
      chatId: spec.targetChat?.id || task.reservedSessionId || answer.sessionId, targetKind: task.target?.kind || 'new',
      prompt: spec.prompt, documentNames: spec.documents.map(file => file.name), projectId: task.projectId, mode: spec.mode,
      ...(answer.deliverables ? { deliverables: answer.deliverables } : {}), ...(answer.children ? { children: answer.children } : {}) };
  }

  safeError(error) {
    const text = new PrivacySession('automation-error').protect(String(error?.message || '运行未完成。')).text;
    if (/dsh profile|ERR_MODULE_NOT_FOUND|stderr tail/i.test(text)) return '内核启动未完成，请在模型连接中检查内核。';
    return text.replace(/⟦ZX-[^⟧]+⟧/g, '【已隐藏】').slice(0, 400);
  }

  async recordEvent(event) {
    if (event.type === 'run/terminal' && event.finalization) {
      const active = [...this.active.values()].find(run => run.runId === event.runId);
      if (active) { active.latestFinalization = copy(event.finalization); return; }
      const pending = this.pendingOutcomes.get(event.runId);
      if (pending) {
        pending.finalization = { ...copy(event.finalization), persistenceStatus: 'pending' };
        pending.finalization.error ||= pending.persistenceError;
        this.changed(); return;
      }
      const run = this.state.runs.find(item => item.id === event.runId && item.status !== 'running');
      if (!run) return;
      const outcome = { id: run.id, runId: run.id, taskId: run.taskId, status: run.status, finishedAt: run.finishedAt, message: run.message,
        ...(run.result ? { result: copy(run.result) } : {}), finalization: copy(event.finalization) };
      try { await this.commit(draft => this.applyOutcome(draft, outcome), [outcome.runId]); }
      catch (error) {
        outcome.persistenceError = this.persistenceFailure(error); outcome.finalization.persistenceStatus = 'pending';
        outcome.finalization.error ||= outcome.persistenceError; this.pendingOutcomes.set(outcome.runId, outcome); this.changed();
      }
      return;
    }
    if(!event.label)return;
    if (![...this.active.values()].some(run => run.runId === event.runId)) return;
    await this.commit(draft => {
      const run = draft.runs.find(item => item.id === event.runId);
      if (run) run.events = [...(run.events || []).slice(-29), { type: event.type, label: this.safeError({ message: event.label }), at: this.now() }];
    });
  }

  async cancel(id) {
    const active = this.active.get(id);
    if (!active) return { cancelled: false };
    if (active.executionFinished) { await active.promise; return { cancelled: false }; }
    const previous = active.cancelled;
    active.cancelled = true;
    let response;
    try { response = await this.runtime.cancel(active.runId); }
    catch (error) { active.cancelled = previous; throw error; }
    if (response?.accepted === false) active.cancelled = previous;
    await active.promise;
    return { cancelled: response?.accepted !== false };
  }

  async close() {
    const wasClosed = this.closed, interval = this.timer ? this.interval : null;
    this.closed = true; clearInterval(this.timer); this.timer = null;
    await Promise.allSettled([...this.active.keys()].map(id => this.cancel(id)));
    await this.tail;
    await Promise.allSettled([...this.pendingOutcomes.keys()].map(runId => this.retrySave(runId)));
    if (this.pendingOutcomes.size) {
      this.closed = wasClosed;
      if (!wasClosed && interval) this.start(interval);
      throw Object.assign(new Error('自动化结果尚未保存，已保留本次结果；请恢复磁盘写入后重试保存。'), { code: 'AUTOMATION_SAVE_FAILED', stage: 'persist' });
    }
  }

  async clearSavedData() {
    await Promise.allSettled([...this.active.keys()].map(id => this.cancel(id)));
    if (this.pendingOutcomes.size) throw new Error('自动化仍有尚未保存的结果，请先重试保存。');
    this.approvals.clear();
    await this.commit(draft => { draft.tasks = []; draft.runs = []; });
  }
}

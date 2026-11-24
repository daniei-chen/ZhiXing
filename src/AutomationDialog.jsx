import { useEffect, useState } from 'react';
import { ArrowRight, FileText, ShieldCheck } from '@phosphor-icons/react';
import { Modal } from './ui.jsx';
import { FREQUENCIES, localDate, nextOccurrence, scheduleLabel, taskTargetLabel } from './scheduler.js';
import { errorText } from './error-copy.js';
import { automationInput } from './automation-core.js';

const statusLabels = { running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止', interrupted: '已中断' };

const desktopTiming = window.zhixing?.previewAutomationTiming;
const advancedRules = [['cron', 'Cron 表达式'], ['rrule', 'RRULE 日历规则'], ['after', '延迟一次'], ['every', '固定间隔']];
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function AutomationDialog(props) {
  if (props.modal.type === 'task-history') return <TaskHistory {...props}/>;
  if (['enable-task', 'run-task'].includes(props.modal.type)) return <TaskApproval {...props}/>;
  if (props.modal.type === 'delete-task') return <DeleteTask {...props}/>;
  return <TaskEditor {...props}/>;
}

function TaskEditor({ modal, state, scope, setState, notify, close }) {
  const task = modal.value || {};
  const [name, setName] = useState(task.name || '');
  const [description, setDescription] = useState(task.description || '');
  const [kind, setKind] = useState(task.kind || 'agent');
  const [ruleKind, setRuleKind] = useState(task.rule?.kind || 'calendar');
  const [cron, setCron] = useState(task.rule?.kind === 'cron' ? task.rule.expression : '0 9 * * 1-5');
  const [timeZone, setTimeZone] = useState(task.rule?.timeZone || localZone);
  const [rrule, setRrule] = useState(task.rule?.kind === 'rrule' ? task.rule.expression : `DTSTART;TZID=${localZone}:${localDate().replaceAll('-', '')}T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR`);
  const [seconds, setSeconds] = useState(task.rule?.seconds || 3600);
  const [frequency, setFrequency] = useState(task.frequency || '每天');
  const [time, setTime] = useState(task.time || '09:00');
  const [anchor, setAnchor] = useState(task.anchorDate?.slice(0, 10) || localDate());
  const [projectId, setProjectId] = useState(task.projectId || scope.project?.id || '');
  const [documentIds, setDocumentIds] = useState(task.documentIds || []);
  const [targetKind, setTargetKind] = useState(task.target?.kind || 'new');
  const [targetId, setTargetId] = useState(task.target?.chatId || '');
  const workspaceId = task.workspaceId || scope.workspace.id;
  const chats = scope.chats.filter(chat => chat.workspaceId === workspaceId && (chat.projectId || '') === projectId && !chat.automationTaskId);
  const documents = scope.documents.filter(file => file.workspaceId === workspaceId && file.status === 'ready');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [timingPreview, setTimingPreview] = useState(null);
  const timing = ruleKind === 'calendar' ? { frequency, time, anchorDate: anchor }
    : { rule: ruleKind === 'cron' ? { kind: ruleKind, expression: cron, timeZone }
      : ruleKind === 'rrule' ? { kind: ruleKind, expression: rrule } : { kind: ruleKind, seconds } };
  const timingKey = JSON.stringify(timing);
  const target = kind !== 'agent' ? { kind: 'new' }
    : { kind: targetKind, ...(targetKind === 'session' ? { chatId: targetId } : {}) };
  const hasTarget = target.kind !== 'session' || chats.some(chat => chat.id === targetId);
  const data = { ...(task.id ? { id: task.id } : {}), name: name.trim(), description: description.trim(), kind, ...timing,
    projectId: projectId || null, workspaceId, documentIds: kind === 'agent' ? documentIds : [], target };
  useEffect(() => {
    if (!desktopTiming) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const result = await desktopTiming(JSON.parse(timingKey));
        if (active) setTimingPreview({ key: timingKey, ...result });
      } catch (cause) {
        if (active) setTimingPreview({ key: timingKey, error: errorText(cause) });
      }
    }, 160);
    return () => { active = false; clearTimeout(timer); };
  }, [timingKey]);
  const currentPreview = timingPreview?.key === timingKey ? timingPreview : null;
  let occurrences = currentPreview?.occurrences || [];
  if (!desktopTiming && ruleKind === 'calendar') {
    try { const computed = nextOccurrence(timing); if (computed) occurrences = [computed]; } catch {}
  }
  const next = occurrences[0];

  async function save(event) {
    event.preventDefault();
    if (busy || !data.name || !data.description || !hasTarget) return;
    setBusy(true); setError('');
    try {
      automationInput(data, state);
      if (!next) throw new Error('请选择有效且尚未结束的计划时间。');
      if (window.zhixing) await window.zhixing.saveAutomation(data);
      else setState(current => {
        const value = { ...data, id: task.id || crypto.randomUUID(), createdAt: task.createdAt || Date.now(), nextRun: next, enabled: false, status: '浏览器草稿，未启用' };
        return { ...current, automations: task.id ? current.automations.map(item => item.id === task.id ? value : item) : [...current.automations, value] };
      });
      close(); notify('计划已保存，启用后才会自动执行。');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return <Modal title={task.id ? '编辑定时任务' : '新建定时任务'} onClose={busy ? () => {} : close} className="automation-modal">
    <form onSubmit={save} className="automation-form"><div className="automation-fields">
      <label className="form-label">任务名称<input autoFocus value={name} maxLength={60} required onChange={event => setName(event.target.value)} placeholder="例如，每周五整理进度"/></label>
      <label className="form-label">{kind === 'reminder' ? '提醒内容' : '交办说明'}<textarea aria-label="任务说明" rows={4} maxLength={24000} value={description} required onChange={event => setDescription(event.target.value)} placeholder="说明要完成的工作、输出形式和需要核对的事项"/></label>
      <div className="form-grid">
        <label className="form-label">任务类型<select aria-label="任务类型" value={kind} onChange={event => setKind(event.target.value)}><option value="agent">AI 任务</option><option value="reminder">本机提醒</option></select></label>
        <label className="form-label">归入项目<select aria-label="归入项目" value={projectId} onChange={event => { setProjectId(event.target.value); setTargetId(''); }}><option value="">不归入项目</option>{scope.projects.filter(project => project.workspaceId === workspaceId).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      </div>
      {kind === 'agent' && <fieldset className="task-documents"><legend><FileText size={15}/>工作资料 <small>选填 · 最多 12 份</small></legend>
        {documents.map(file => <label className="checkbox-row" key={file.id}><input type="checkbox" checked={documentIds.includes(file.id)} disabled={!documentIds.includes(file.id) && documentIds.length >= 12} onChange={event => setDocumentIds(ids => event.target.checked ? [...ids, file.id] : ids.filter(id => id !== file.id))}/><span>{file.name}</span></label>)}
        {!documents.length && <p>可先在资料空间添加文件，再关联到任务。</p>}
        {!!documentIds.filter(id => !documents.some(file => file.id === id)).length && <p className="callout bad">有资料已被移除，请重新选择。</p>}
        <small>使用所选资料的本机副本。内容变更后需要重新审阅。</small>
      </fieldset>}
      {kind === 'agent' && <div className="form-grid task-target-fields">
        <label className="form-label">结果位置<select aria-label="结果位置" value={targetKind} onChange={event => setTargetKind(event.target.value)}>
          <option value="new">每次新建聊天</option><option value="new_once">同一条任务聊天</option><option value="session">已有聊天</option>
        </select></label>
        {targetKind === 'session' && <label className="form-label">选择聊天<select aria-label="选择聊天" value={targetId} required onChange={event => setTargetId(event.target.value)}><option value="">选择当前项目的聊天</option>{chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</select></label>}
        {targetKind === 'session' && <small>审阅包含已有聊天的最近六条有效消息。相关消息变化后需要重新审阅。</small>}
        {targetKind === 'new_once' && <small>每次结果汇入同一条任务聊天。直接交办时会另开聊天。</small>}
      </div>}
      <label className="form-label">触发规则<select aria-label="触发规则" value={ruleKind} onChange={event => setRuleKind(event.target.value)}>
        <option value="calendar">日历计划</option>
        {advancedRules.map(([id, label]) => <option key={id} value={id} disabled={!desktopTiming && id !== ruleKind}>{label}</option>)}
      </select></label>
      {ruleKind === 'calendar' && <><div className="form-grid">
        <label className="form-label">重复<select aria-label="重复" value={frequency} onChange={event => setFrequency(event.target.value)}>{FREQUENCIES.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="form-label">本机时间<input type="time" required value={time} onChange={event => setTime(event.target.value)}/></label>
      </div>
      <label className="form-label">{frequency === '仅一次' ? '执行日期' : '起始日期'}<input type="date" required value={anchor} onChange={event => setAnchor(event.target.value)}/></label></>}
      {ruleKind === 'cron' && <div className="form-grid">
        <label className="form-label">Cron 表达式<input required maxLength={1024} value={cron} onChange={event => setCron(event.target.value)} spellCheck={false}/><small>分、时、日、月、星期</small></label>
        <label className="form-label">时区<input required maxLength={100} value={timeZone} onChange={event => setTimeZone(event.target.value)} spellCheck={false}/><small>例如 Asia/Shanghai</small></label>
      </div>}
      {ruleKind === 'rrule' && <label className="form-label">RRULE 日历规则<textarea spellCheck={false} required rows={3} maxLength={1024} value={rrule} onChange={event => setRrule(event.target.value)}/><small>填写 DTSTART 和 RRULE，各占一行。</small></label>}
      {['after', 'every'].includes(ruleKind) && <label className="form-label">{ruleKind === 'after' ? '延迟（秒）' : '间隔（秒）'}<input required type="number" min={ruleKind === 'after' ? 1 : 60} max={31536000} step={1} value={seconds} onChange={event => setSeconds(event.target.value)}/><small>以启用计划的时间为起点。</small></label>}
      <div className="task-timing-preview" aria-live="polite">
        {next ? <><strong>接下来{occurrences.length > 1 ? ` ${occurrences.length} 次执行` : '的执行时间'}</strong><ul>{occurrences.map(timestamp => <li key={timestamp}><time dateTime={new Date(timestamp).toISOString()}>{new Date(timestamp).toLocaleString('zh-CN')}</time></li>)}</ul></>
          : <span>{currentPreview?.error || (currentPreview ? '这条规则没有未来的执行时间。' : '正在核对执行时间…')}</span>}
        <small>以上时间按本机时区显示。知行运行时执行，重开后每项补执行最近一次到期计划。</small>
      </div>
      {error && <p className="callout bad" role="alert">{error}</p>}
      </div><div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={close}>取消</button><button className="primary-button" disabled={busy || !data.name || !data.description || !next || !hasTarget}>{busy ? '正在保存…' : task.id ? '保存' : '创建'}</button></div>
    </form>
  </Modal>;
}

function TaskApproval({ modal, close, notify }) {
  const manual = modal.type === 'run-task';
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [lens, setLens] = useState('model');
  useEffect(() => {
    let mounted = true;
    if (!window.zhixing) { setError('请在桌面端配置模型并审阅。'); return; }
    window.zhixing.prepareAutomation({ id: modal.value.id, action: manual ? 'run' : 'enable' }).then(value => { if (mounted) setPreview(value); }).catch(cause => { if (mounted) setError(errorText(cause)); });
    return () => { mounted = false; };
  }, [modal.value.id, manual]);
  async function confirm() {
    if (!preview?.approvalId || busy) return;
    setBusy(true); setError('');
    try { await window.zhixing.confirmAutomation(preview.approvalId); close(); notify(manual ? '任务已开始，可在执行记录中查看。' : '任务已启用。'); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title={manual ? '立即运行 AI 任务' : '启用 AI 定时任务'} onClose={busy ? () => {} : close} className="privacy-modal">
    <div className="review-meta"><span className="review-icon"><ShieldCheck size={21}/></span><span><strong>{modal.value.name}</strong><small>{scheduleLabel(modal.value)}</small></span></div>
    {preview && <><p className={`callout ${preview.privacyMode === 'raw' ? 'raw' : ''}`}>{preview.privacyMode === 'raw' ? '非脱敏模式 · 下方原文将发送给模型服务。' : `脱敏模式 · 已替换 ${preview.entities?.length || 0} 个敏感值。`}</p><p className="endpoint-text muted">{preview.model} · {preview.baseUrl}</p>
      <p className="muted">结果位置 · {preview.targetTitle || taskTargetLabel(modal.value.target)}</p>
      <div className="privacy-tabs" role="tablist" aria-label="自动化审阅视图">{[['model', '发送内容'], ['original', '本机原文']].map(([id, label]) => <button key={id} role="tab" aria-selected={lens === id} className={lens === id ? 'active' : ''} onClick={() => setLens(id)}>{label}</button>)}</div>
      <div className="privacy-text" role="tabpanel"><pre>{lens === 'model' ? preview.text : preview.original}</pre></div>
      {preview.blocked && <p className="callout bad">检测到疑似凭证，请先编辑任务或资料。</p>}
      {!manual && <p className="task-schedule-note">确认后按计划发送这些资料。修改任务、资料、项目说明、发送方式或模型连接后，计划会暂停并要求重新审阅。</p>}
    </>}
    {!preview && !error && <p className="empty-note" role="status">正在准备发送内容…</p>}
    {error && <p className="callout bad" role="alert">{error}</p>}
    <div className="form-actions"><button className="secondary-button" disabled={busy} onClick={close}>取消</button><button className="primary-button" disabled={!preview?.approvalId || busy || !!error} onClick={confirm}>{busy ? '正在提交…' : manual ? '确认运行' : '确认启用'}<ArrowRight size={15}/></button></div>
  </Modal>;
}

function DeleteTask({ modal, close, setState }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Modal title="删除定时任务" onClose={close}><p className="modal-copy">删除「{modal.value.name}」？已完成的执行记录和聊天会保留。</p>{error && <p role="alert" className="callout bad">{error}</p>}<div className="form-actions"><button className="secondary-button" onClick={close}>取消</button><button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); try { if (window.zhixing) await window.zhixing.removeAutomation(modal.value.id); else setState(current => ({ ...current, automations: current.automations.filter(task => task.id !== modal.value.id) })); close(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }}>删除</button></div></Modal>;
}

function TaskHistory({ modal, scope, close, openRun }) {
  const runs = scope.taskRuns.filter(run => run.taskId === modal.value.id).slice().reverse();
  return <Modal title={`${modal.value.name} · 执行记录`} onClose={close} className="task-history-modal">
    {!runs.length && <p className="empty-note">还没有执行记录。</p>}
    <div className="task-history-list">{runs.map(run => <article key={run.id}>
      <div className="task-run-heading"><strong>{statusLabels[run.status] || run.status}</strong><small>{run.manual ? '手动运行' : '计划触发'} · {new Date(run.startedAt).toLocaleString('zh-CN')}</small>{run.result && <button className="secondary-button" onClick={() => openRun(run)}>打开结果</button>}</div>
      {run.scheduledAt && run.scheduledAt !== run.startedAt && <small className="muted">计划时间 {new Date(run.scheduledAt).toLocaleString('zh-CN')}</small>}
      <p className={run.status === 'failed' ? 'task-run-error' : 'muted'}>{run.message || '任务正在执行。'}</p>
      {run.finishedAt && <small className="muted">耗时 {Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000))} 秒{run.model ? ` · ${run.model}` : ''}</small>}
      {!!run.events?.length && <details><summary>运行步骤 · {run.events.length}</summary><ol className="run-events">{run.events.map((event, index) => <li key={index}><span>{event.label}</span><time>{new Date(event.at).toLocaleTimeString('zh-CN')}</time></li>)}</ol></details>}
    </article>)}</div>
  </Modal>;
}

export { statusLabels as taskRunStatusLabels };


import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Eye, FileText, LockKey, ShieldCheck } from '@phosphor-icons/react';
import { Modal } from './ui.jsx';
import { PrivacySession, TYPE_LABELS } from './privacy-core.js';
import { permissionMode } from './permissions.js';
import { privacyPolicyForMode } from './privacy-policy.js';

const placeholder = /⟦ZX-[a-f0-9]{12}-([A-Z]+)-\d+⟧/g;
const hideTokens = text => text.replace(placeholder, (_token, type) => `【${TYPE_LABELS[type] || '敏感信息'}已隐藏】`);

export function PrivacyReview({ modal, original, terms,policy,currentMode, onClose, onSettings, onSend }) {
  const sending = modal.type === 'send-review';
  const [lens, setLens] = useState('model');
  const local = useMemo(() => new PrivacySession('review').protect(original, terms,privacyPolicyForMode(policy,currentMode)), [original, terms,policy,currentMode]);
  const hasPreview = typeof modal.preview?.text === 'string';
  const mode = modal.preview?.privacyMode || currentMode;
  const raw = mode === 'raw';
  const preview = hasPreview ? modal.preview : { ...local, text: raw && !local.blocked ? original : local.text };
  const blocked = modal.blocked || preview.blocked;
  const tabs = [
    ['model', sending || !hasPreview ? '发送内容' : '已发送内容'],
    ...(!raw ? [['original', '本机原文']] : []),
    ...(modal.output ? [['result', '接收方预览']] : []),
  ];
  const recipient = useMemo(() => new PrivacySession('result').protect(modal.output || '', terms,privacyPolicyForMode(policy,'raw')), [modal.output, terms,policy]);
  const content = lens === 'original' ? original : lens === 'result' ? hideTokens(recipient.text) : preview.text;

  return <Modal title={sending ? '发送前审阅' : '脱敏审阅'} onClose={onClose} className="privacy-modal review-modal">
    <div className="review-meta"><span className={`review-icon ${raw ? 'raw' : ''}`}>{raw ? <Eye size={21}/> : <ShieldCheck size={21}/>}</span><span><strong>{blocked ? '命中拦截规则' : raw ? '非脱敏模式' : '脱敏模式'}</strong><small className="endpoint-text">{sending ? `${preview.model} · ${preview.baseUrl}` : hasPreview ? '该条交办使用的发送方式' : '以下内容仅为本机预览'}</small></span></div>
    {raw && sending && !blocked && <p className="callout raw">模型服务将收到下面的原文，包括所选资料与相关上下文。</p>}
    {sending && <p className="settings-note">{permissionMode(preview.permission).short} · {preview.workspaceRoot ? `工作目录：${preview.workspaceRoot}` : '未关联本机目录，只使用已提供资料和计算工具'}</p>}
    <div className="privacy-tabs" role="tablist" aria-label="脱敏内容视图">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={lens === id} className={lens === id ? 'active' : ''} onClick={() => setLens(id)}>{label}</button>)}</div>
    <div className="privacy-text" role="tabpanel"><pre>{content || '暂无内容'}</pre></div>
    {lens === 'result' && recipient.blocked && <p className="callout bad">接收方预览命中当前拦截规则。交付时仍需由桌面主机重新审阅。</p>}
    {blocked ? <p className="callout bad">内容没有发送。请修改原文或在隐私设置中调整对应规则。</p> : !raw && sending && <p className="muted review-note">已替换 {preview.entities?.length ?? 0} 个值。</p>}
    <div className="form-actions"><button className="secondary-button" onClick={onClose}>{sending ? '返回编辑' : '关闭'}</button>{sending ? <button className="primary-button" disabled={blocked || !preview.preparationId} onClick={onSend}>{raw ? '确认发送原文' : '确认发送'}<ArrowRight size={15}/></button> : <button className="primary-button" onClick={onSettings}>隐私与数据设置</button>}</div>
  </Modal>;
}

export function ExportReview({ title, original, masked, history, terms, policy, privacyMode, desktop, action='export', defaultFormat='txt', onClose, onExport }) {
  const [scope, setScope] = useState('recipient'), [confirmation, setConfirmation] = useState(null), [format, setFormat] = useState(defaultFormat), [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null), [failure, setFailure] = useState(null), [refresh, setRefresh] = useState(0);
  const [historyMode, setHistoryMode] = useState(privacyMode === 'raw' ? 'raw' : 'redact');
  const sharing = action === 'share', selectedFormat = sharing || !desktop || format === 'md' && !history ? 'txt' : format;
  const isNative = selectedFormat === 'md';
  const policyKey = JSON.stringify({policy,terms,privacyMode});
  // An old host reply or confirmation becomes unusable during this render,
  // before the next effect runs. Changing renderer settings only requests a new
  // host review; the host independently reads flushed authoritative settings.
  const request = useMemo(() => ({}), [title,original,masked,history,historyMode,scope,action,selectedFormat,policyKey,desktop,refresh]);
  const demo = useMemo(() => {
    if(desktop)return null;
    const checked = new PrivacySession('delivery-demo').protect(original, terms, privacyPolicyForMode(policy,'raw'));
    return {reviewId:crypto.randomUUID(),recipientScope:scope,format:selectedFormat,text:scope==='recipient'||checked.blocked?hideTokens(checked.text):original,findings:checked.findings,blocked:checked.blocked,allowedActions:checked.blocked?[]:[action],name:scope==='recipient'?'知行交付（对外版）':`${title}（本人版）`,expiresAt:Infinity};
  }, [request]);
  const snapshot = desktop ? review?.request === request ? review.snapshot : null : demo;
  const error = failure?.request === request ? failure.message : null;
  const confirmed = !!snapshot && confirmation === snapshot.reviewId && !error;
  const allowed = !!snapshot && !snapshot.blocked && snapshot.allowedActions.includes(action) && snapshot.expiresAt > Date.now() && !error;
  useEffect(() => {
    if(!desktop)return;
    let current = true;
    setReview(null);setConfirmation(null);setFailure(null);
    async function prepare() {
      try {
        if(typeof desktop.prepareDelivery!=='function')throw new Error('桌面交付审阅接口不可用，请更新应用后重试。');
        const source = isNative ? {history:{...history,mode:historyMode}} : {original,masked,title};
        const value = await desktop.prepareDelivery({...source,action,recipientScope:scope,format:selectedFormat});
        if(!value || !['reviewId','contentHash','policyRevision','text'].every(key=>typeof value[key]==='string') || value.recipientScope!==scope || value.format!==selectedFormat || value.action!==action || typeof value.blocked!=='boolean' || !Array.isArray(value.allowedActions) || !Number.isFinite(value.expiresAt) || isNative && !Object.entries(source.history).every(([key,item])=>value.history?.[key]===item))throw new Error('桌面审阅快照无效，请重新审阅。');
        if(current)setReview({request,snapshot:value});
      } catch(cause) { if(current)setFailure({request,message:cause.message || '交付审阅失败，请重新审阅。'}); }
    }
    prepare();
    return () => {current=false;};
  }, [request]);
  useEffect(() => {
    if(!desktop || !snapshot)return;
    const timer=setTimeout(()=>{setConfirmation(null);setFailure({request,message:'交付审阅已过期，请重新审阅。'});},Math.max(0,snapshot.expiresAt-Date.now()));
    return () => clearTimeout(timer);
  }, [desktop,snapshot,request]);
  async function exportSelected() {
    if (!confirmed || busy || !allowed) return;
    setBusy(true);
    try {
      const binding = desktop ? {reviewId:snapshot.reviewId,contentHash:snapshot.contentHash,policyRevision:snapshot.policyRevision,recipientScope:snapshot.recipientScope,format:selectedFormat,name:snapshot.name} : {text:snapshot.text,name:snapshot.name,format:selectedFormat,recipientScope:scope,demo:true};
      const result = await onExport(binding);
      setConfirmation(null);
      if(!result?.cancelled)setRefresh(value=>value+1);
    } catch(cause) {setConfirmation(null);setFailure({request,message:cause.message || '交付未完成，请重新审阅后重试。'});}
    finally { setBusy(false); }
  }
  return <Modal title={sharing?'分享审阅':'交付审阅'} onClose={onClose} canDismiss={!busy} className="privacy-modal review-modal">
    <div className="review-meta"><span className="review-icon"><FileText size={21}/></span><span><strong>{title}</strong><small>{sharing?'选择要分享的版本并核对接收范围':'选择要保存的版本和格式'}</small></span></div>
    {!desktop && <p className="settings-note">浏览器本机预览，未经桌面主机审阅；不读取已保存的配置凭据。</p>}
    {isNative && <div className="review-export-actions"><label>历史来源 <select aria-label="历史来源" value={historyMode} disabled={busy} onChange={event=>{setHistoryMode(event.target.value);setConfirmation(null);}}><option value="redact">脱敏会话</option><option value="raw">非脱敏会话</option></select></label></div>}
    <div className="privacy-tabs" role="tablist" aria-label="交付版本">{[['recipient', '接收方版', ShieldCheck], ['self', '本人版', Eye]].map(([id, label, Icon]) => <button key={id} role="tab" disabled={busy} aria-selected={scope === id} className={scope === id ? 'active' : ''} onClick={() => { setScope(id); setConfirmation(null); }}><Icon size={15}/>{label}</button>)}</div>
    <div className="privacy-text" role="tabpanel" aria-busy={desktop&&!snapshot&&!error}><pre>{snapshot ? snapshot.text || '暂无内容' : error?'审阅未完成。':'正在准备主机审阅…'}</pre></div>
    {snapshot && <p className="settings-note">{desktop?'主机审阅':'本机演示'}检测到 {snapshot.findings?.length || 0} 处规则匹配{snapshot.findings?.length?`（${[...new Set(snapshot.findings.map(item=>item.label || TYPE_LABELS[item.type] || '敏感信息'))].join('、')}）`:''}。</p>}
    {scope === 'self' && <p className="callout raw"><LockKey size={14}/>{isNative?'本人版保留日志中已有的值，不还原占位符；凭据和当前禁止规则仍会拦截。':'本人版保留普通信息原值；凭据和当前禁止规则仍会拦截。'}</p>}
    {snapshot?.blocked && <p className="callout bad" role="alert">当前隐私规则阻止交付。请修改内容或隐私设置后重新审阅。</p>}
    {error && <p className="callout bad" role="alert">{error}</p>}
    {(error||snapshot?.blocked) && <button type="button" className="secondary-button" disabled={busy} onClick={()=>{setConfirmation(null);setRefresh(value=>value+1);}}>重新审阅</button>}
    <label className="checkbox-row"><input type="checkbox" disabled={busy||!allowed} checked={confirmed} onChange={e => setConfirmation(e.target.checked?snapshot.reviewId:null)}/>我已核对要{sharing?'分享':'保存'}的内容与接收范围</label>
    <div className="review-export-actions">{!sharing&&<label>文件格式 <select aria-label="文件格式" disabled={busy} value={selectedFormat} onChange={e => {setFormat(e.target.value);setConfirmation(null);}}><option value="txt">TXT 文本</option>{desktop && <><option value="docx">DOCX 文档</option><option value="xlsx">XLSX 表格</option>{history&&<option value="md">Markdown（Harness 会话）</option>}</>}</select></label>}<button className="primary-button" disabled={!confirmed || busy || !allowed} onClick={exportSelected}>{busy ? sharing?'等待分享…':'等待保存…' : sharing?'分享或复制':'保存文件'}</button></div>
  </Modal>;
}

import { useMemo, useState } from 'react';
import { ArrowRight, Eye, FileText, LockKey, ShieldCheck } from '@phosphor-icons/react';
import { Modal } from './ui.jsx';
import { PrivacySession, TYPE_LABELS } from './privacy-core.js';
import { permissionMode } from './permissions.js';

const placeholder = /⟦ZX-[a-f0-9]{12}-([A-Z]+)-\d+⟧/g;
const hideTokens = text => text.replace(placeholder, (_token, type) => `【${TYPE_LABELS[type] || '敏感信息'}已隐藏】`);

export function PrivacyReview({ modal, original, terms,policy,currentMode, onClose, onSettings, onSend }) {
  const sending = modal.type === 'send-review';
  const [lens, setLens] = useState('model');
  const local = useMemo(() => new PrivacySession('review').protect(original, terms,policy), [original, terms,policy]);
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
  const recipient = useMemo(() => hideTokens(new PrivacySession('result').protect(modal.output || '', terms).text), [modal.output, terms]);
  const content = lens === 'original' ? original : lens === 'result' ? recipient : preview.text;

  return <Modal title={sending ? '发送前审阅' : '脱敏审阅'} onClose={onClose} className="privacy-modal review-modal">
    <div className="review-meta"><span className={`review-icon ${raw ? 'raw' : ''}`}>{raw ? <Eye size={21}/> : <ShieldCheck size={21}/>}</span><span><strong>{blocked ? '命中拦截规则' : raw ? '非脱敏模式' : '脱敏模式'}</strong><small className="endpoint-text">{sending ? `${preview.model} · ${preview.baseUrl}` : hasPreview ? '该条交办使用的发送方式' : '以下内容仅为本机预览'}</small></span></div>
    {raw && sending && !blocked && <p className="callout raw">模型服务将收到下面的原文，包括所选资料与相关上下文。</p>}
    {sending && <p className="settings-note">{permissionMode(preview.permission).short} · {preview.workspaceRoot ? `工作目录：${preview.workspaceRoot}` : '未关联本机目录，只使用已提供资料和计算工具'}</p>}
    <div className="privacy-tabs" role="tablist" aria-label="脱敏内容视图">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={lens === id} className={lens === id ? 'active' : ''} onClick={() => setLens(id)}>{label}</button>)}</div>
    <div className="privacy-text" role="tabpanel"><pre>{content || '暂无内容'}</pre></div>
    {blocked ? <p className="callout bad">内容没有发送。请修改原文或在隐私设置中调整对应规则。</p> : !raw && sending && <p className="muted review-note">已替换 {preview.entities?.length ?? 0} 个值。</p>}
    <div className="form-actions"><button className="secondary-button" onClick={onClose}>{sending ? '返回编辑' : '关闭'}</button>{sending ? <button className="primary-button" disabled={blocked || !preview.preparationId} onClick={onSend}>{raw ? '确认发送原文' : '确认发送'}<ArrowRight size={15}/></button> : <button className="primary-button" onClick={onSettings}>隐私与数据设置</button>}</div>
  </Modal>;
}

export function ExportReview({ title, original, masked, terms, desktop, onClose, onExport }) {
  const [scope, setScope] = useState('recipient'), [confirmed, setConfirmed] = useState(false), [format, setFormat] = useState('txt'), [busy, setBusy] = useState(false);
  const redacted = useMemo(() => {
    const value = new PrivacySession('export').protect(masked || original, terms);
    return hideTokens(value.text);
  }, [masked, original, terms]);
  const local = useMemo(() => new PrivacySession('export-check').protect(original, terms), [original, terms]);
  const text = scope === 'recipient' ? redacted : original;
  async function exportSelected() {
    if (!confirmed || busy) return;
    setBusy(true);
    try { await onExport({ text, name: scope === 'recipient' ? '知行交付（对外版）' : `${title}（本人版）`, format }); }
    finally { setBusy(false); }
  }
  return <Modal title="交付审阅" onClose={onClose} className="privacy-modal review-modal">
    <div className="review-meta"><span className="review-icon"><FileText size={21}/></span><span><strong>{title}</strong><small>选择要保存的版本和格式</small></span></div>
    <div className="privacy-tabs" role="tablist" aria-label="交付版本">{[['recipient', '接收方版', ShieldCheck], ['self', '本人版', Eye]].map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={scope === id} className={scope === id ? 'active' : ''} onClick={() => { setScope(id); setConfirmed(false); }}><Icon size={15}/>{label}</button>)}</div>
    <div className="privacy-text" role="tabpanel"><pre>{text}</pre></div>
    {scope === 'self' && <p className="callout raw"><LockKey size={14}/>本人版保留原值，请核对接收范围。</p>}
    <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>我已核对要保存的内容与接收范围</label>
    <div className="review-export-actions"><label>文件格式 <select aria-label="文件格式" value={format} onChange={e => setFormat(e.target.value)}><option value="txt">TXT 文本</option>{desktop && <><option value="docx">DOCX 文档</option><option value="xlsx">XLSX 表格</option></>}</select></label><button className="primary-button" disabled={!confirmed || busy || (scope === 'self' && local.blocked)} onClick={exportSelected}>{busy ? '等待保存…' : '保存文件'}</button></div>
  </Modal>;
}

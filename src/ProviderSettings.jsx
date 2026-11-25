import { useState } from 'react';
import { ArrowClockwise, ArrowLeft, Check, Plug, Plus, SlidersHorizontal, Trash } from '@phosphor-icons/react';
import { PROVIDER_PRESETS } from './provider-options.js';
import { errorText } from './error-copy.js';

const CUSTOM = { name: '', protocol: 'openai', baseUrl: '' };
const protocolLabel = { deepseek: '原生 DeepSeek', anthropic: 'Anthropic Messages', openai: 'Chat Completions' };


export function ProviderSettings({ runtime, setRuntime, desktop, settings, setSetting }) {
  const currentModel = settings?.model;
  const currentProvider = settings?.modelProviderId;
  const [draft, setDraft] = useState(null);
  const [action, setAction] = useState('');
  const [notice, setNotice] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [removing, setRemoving] = useState(false);
  const providers = runtime.providers || [];

  function open(provider, saved = false) {
    setDraft({ ...provider, id: saved ? provider.id : undefined, preset: saved ? provider.preset : provider.id,
      manualModels: provider.models?.filter(model => model.source === 'configured').map(model => model.id).join('\n') || '',
      apiKey: '', reasoningStyle: provider.reasoningStyle || 'none' });
    setNotice(null);
    setAdvanced(false);
    setRemoving(false);
  }

  function update(field, value) {
    setDraft(current => ({ ...current, [field]: value }));
  }

  async function hideModel(model) {
    if (!desktop || action) return;
    setAction('hide');
    setNotice(null);
    try {
      const next = await desktop.hideProviderModel({ providerId: draft.id, modelId: model.id, hidden: true });
      setRuntime(next);
      const left = (draft.models || []).filter(row => row.id !== model.id);
      setDraft(current => ({ ...current, models: left, hiddenModels: [...(current.hiddenModels || []), model.id] }));
      if (currentModel === model.id && currentProvider === draft.id && left.length && setSetting) {
        setSetting('modelSelection', { id: left[0].id, providerId: draft.id });
        setNotice({ text: `已移除「${model.name || model.id}」，当前模型换成「${left[0].name || left[0].id}」` });
      } else {
        setNotice({ text: `已移除「${model.name || model.id}」` });
      }
    } catch (error) {
      setNotice({ error: true, text: errorText(error) });
    } finally {
      setAction('');
    }
  }

  async function restoreModels() {
    if (!desktop || action) return;
    setAction('restore');
    setNotice(null);
    try {
      let next = null;
      for (const modelId of draft.hiddenModels || []) {
        next = await desktop.hideProviderModel({ providerId: draft.id, modelId, hidden: false });
      }
      if (next) setRuntime(next);
      const provider = (next?.providers || []).find(row => row.id === draft.id);
      setDraft(current => ({ ...current, models: provider?.models || current.models, hiddenModels: provider?.hiddenModels || [] }));
      setNotice({ text: '已恢复全部模型' });
    } catch (error) {
      setNotice({ error: true, text: errorText(error) });
    } finally {
      setAction('');
    }
  }

  async function perform(kind) {
    if (!desktop || action) return;
    setAction(kind);
    setNotice(null);
    try {
      const result = kind === 'remove' ? await desktop.removeProvider(draft.id)
        : await desktop.saveProvider({ ...draft, discover: kind === 'discover' });
      setRuntime(result);
      setDraft(null);
      setNotice({ text: kind === 'remove' ? '已移除供应商' : kind === 'discover' ? '模型已更新，可在输入框切换' : '供应商已保存' });
    } catch (error) {
      setNotice({ error: true, text: errorText(error) });
    } finally {
      setAction('');
    }
  }

  const compatible = PROVIDER_PRESETS.filter(preset => !providers.some(row => row.id === preset.id));
  const changedEndpoint = draft?.id && !draft.preset && providers.some(row => row.id === draft.id && (row.baseUrl !== draft.baseUrl.trim() || row.protocol !== draft.protocol));
  const canSave = !!desktop && !action && Boolean(draft?.apiKey.trim() || draft?.configured && !changedEndpoint);
  return <div className="provider-settings">
    {!desktop && <p className="callout">在 Windows 桌面端连接供应商。</p>}
    {!draft ? <>
      {!!providers.length && <section>
        <h3 className="settings-section-title">已连接</h3>
        <div className="settings-card provider-list">{providers.map(provider => <button key={provider.id} type="button" className="provider-row" onClick={() => open(provider, true)}>
          <span className="provider-glyph"><Plug size={17}/></span>
          <span className="provider-row-name"><strong>{provider.name}</strong><small>{provider.credentialReentryRequired?'需重新配置 API Key':`${provider.models.length} 个模型 · ${protocolLabel[provider.protocol]}`}</small></span>
          <SlidersHorizontal size={16}/>
        </button>)}</div>
      </section>}
      <section>
        <h3 className="settings-section-title">添加供应商</h3>
        <div className="provider-presets">
          {compatible.map(preset => <button key={preset.id} type="button" className="provider-preset" onClick={() => open(preset)} disabled={!desktop}>
            <span>{preset.name}</span><Plus size={15}/>
          </button>)}
          <button type="button" className="provider-preset" onClick={() => open(CUSTOM)} disabled={!desktop}><span>自定义</span><Plus size={15}/></button>
        </div>
      </section>
    </> : <>
      <button type="button" className="text-button provider-back" onClick={() => { setDraft(null); setNotice(null); }} disabled={!!action}><ArrowLeft size={15}/>所有供应商</button>
      <div className="provider-heading"><span className="provider-glyph"><Plug size={20}/></span><div><h3>{draft.preset ? draft.name : draft.id ? providers.find(row => row.id === draft.id)?.name : '自定义供应商'}</h3><small>{draft.preset ? draft.baseUrl : protocolLabel[draft.protocol]}</small></div></div>
      <form className="connection-form" onSubmit={event => { event.preventDefault(); void perform('discover'); }}>
        <fieldset disabled={!!action}>
          {!draft.preset && <div className="provider-custom-fields">
            <label className="form-label">名称<input required maxLength={60} value={draft.name} onChange={event => update('name', event.target.value)} placeholder="例如，公司模型网关"/></label>
            <label className="form-label">接口协议<select aria-label="接口协议" value={draft.protocol} onChange={event => {
              const protocol = event.target.value;
              setDraft(current => ({ ...current, protocol, reasoningStyle: current.reasoningStyle === 'deepseek' ? 'none' : current.reasoningStyle }));
            }}><option value="openai">OpenAI Chat Completions</option><option value="anthropic">Anthropic Messages</option></select></label>
            <label className="form-label">API 地址<input required type="url" value={draft.baseUrl} onChange={event => update('baseUrl', event.target.value)} placeholder="https://api.example.com/v1"/></label>
          </div>}
          <label className="form-label">API Key<input type="password" autoComplete="off" minLength={8} maxLength={1024} value={draft.apiKey} onChange={event => update('apiKey', event.target.value)} placeholder={draft.configured && !changedEndpoint && !draft.credentialReentryRequired ? '留空沿用已保存的密钥' : '输入 API Key'}/><small>8–1024 个可打印 ASCII 字符，不含空格。旧的过短密钥需重新配置。</small></label>
          <button type="button" className="text-button provider-back" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><SlidersHorizontal size={15}/>高级设置</button>
          {advanced && <div className="model-limits">
            <label className="form-label">上下文窗口<input type="number" min={8192} max={2000000} value={draft.contextWindow ?? 128000} onChange={event => update('contextWindow', event.target.value)}/></label>
            <label className="form-label">输出上限<input type="number" min={1024} max={262144} value={draft.maxTokens ?? 8192} onChange={event => update('maxTokens', event.target.value)}/></label>
            {!draft.preset && <label className="form-label provider-wide">思考参数<select aria-label="思考参数" value={draft.reasoningStyle} onChange={event => update('reasoningStyle', event.target.value)}>
              <option value="none">使用服务端默认值</option>
              <option value="standard">{draft.protocol === 'anthropic' ? 'Anthropic 扩展思考' : 'OpenAI reasoning_effort'}</option>
              {draft.protocol === 'openai' && <option value="deepseek">DeepSeek thinking / reasoning_effort</option>}
            </select></label>}
            <label className="form-label provider-wide">手动添加模型 ID<textarea rows={3} maxLength={8050} value={draft.manualModels} onChange={event => update('manualModels', event.target.value)} placeholder="服务没有模型列表时，每行填写一个 ID"/></label>
          </div>}
          {draft.models?.length > 0 && <details className="provider-catalog" open><summary>已保存的模型（{draft.models.length}）</summary><ul>{draft.models.map(model => <li key={model.id}><span>{model.name || model.id}</span><span className="model-actions">{setSetting && draft.id ? (currentModel === model.id && currentProvider === draft.id ? <span className="model-current"><Check size={13}/>当前</span> : <button type="button" className="plain-button model-pick" onClick={() => { setSetting('modelSelection', { id: model.id, providerId: draft.id }); setNotice({ text: `已把「${model.name || model.id}」设为当前模型` }); }}>设为当前</button>) : null}{desktop && draft.id ? <button type="button" className="plain-button model-hide" title="从列表里移除这个模型" aria-label={`移除 ${model.name || model.id}`} disabled={!!action} onClick={() => hideModel(model)}><Trash size={13}/></button> : null}</span></li>)}</ul>{draft.hiddenModels?.length ? <p className="provider-hidden-note">已隐藏 {draft.hiddenModels.length} 个模型<button type="button" className="plain-button" disabled={!!action} onClick={restoreModels}>恢复全部</button></p> : null}</details>}
        </fieldset>
        <div className="form-actions">
          {!!draft.id && <button type="button" className="plain-button provider-remove" disabled={!!action} onClick={() => setRemoving(true)}><Trash size={15}/>移除</button>}
          {advanced && (draft.manualModels.trim() || draft.id) && <button type="button" className="secondary-button" disabled={!canSave || !!changedEndpoint && !draft.manualModels.trim()} onClick={() => perform('save')}>保存设置</button>}
          <button type="submit" className="primary-button" disabled={!canSave}><ArrowClockwise size={15}/>{action === 'discover' ? '正在拉取…' : '拉取模型并保存'}</button>
        </div>
        {removing && <div className="provider-removal">
          <span>移除后，使用此供应商的定时任务需要重新审阅。</span>
          <button type="button" className="secondary-button" disabled={!!action} onClick={() => setRemoving(false)}>取消</button>
          <button type="button" className="secondary-button" disabled={!!action} onClick={() => perform('remove')}>确认移除</button>
        </div>}
      </form>
    </>}
    {notice && <p className={`setting-notice ${notice.error ? 'bad' : ''}`} role={notice.error ? 'alert' : 'status'}>{!notice.error && <Check size={16}/>} {notice.text}</p>}
  </div>;
}


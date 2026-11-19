import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowClockwise, CaretDown, CaretRight, Check, CircleNotch, Lightning, MagnifyingGlass, SlidersHorizontal } from '@phosphor-icons/react';
import { availableModels, REASONING_LEVELS } from './model-options.js';
import { selectedModel } from './provider-options.js';
import { IconButton } from './ui.jsx';

export function ModelControls({ settings, runtime, setRuntime, setSetting, disabled, menu, toggleMenu, closeMenu, openConnection }) {
  const panel = menu === 'models' || menu === 'reasoning' ? menu : null;
  const trigger = useRef(null);
  const surface = useRef(null);
  const modelPanelId = useId();
  const effortPanelId = useId();
  const descriptionId = useId();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const models = runtime.configured ? runtime.models || [] : availableModels([], settings.model);
  const matchingModels = runtime.configured ? models.filter(model => model.id === settings.model) : [];
  const currentModel = runtime.configured
    ? settings.modelProviderId
      ? matchingModels.find(model => model.providerId === settings.modelProviderId)
      : matchingModels.length === 1 ? matchingModels[0] : undefined
    : selectedModel(runtime, settings);
  const effortCapabilityKnown = Array.isArray(currentModel?.levels);
  const modelName = currentModel?.name || (runtime.configured ? `不可用 · ${settings.model}` : settings.model);
  const modelCaption = [modelName, currentModel?.providerName].filter(Boolean).join(' · ');
  const levels = effortCapabilityKnown
    ? REASONING_LEVELS.filter(level => currentModel.levels.includes(level.id))
    : runtime.configured ? [] : REASONING_LEVELS;
  const adjustable = levels.length > 1;
  const effort = levels.find(level => level.id === settings.reasoning);
  const requestedEffort = REASONING_LEVELS.find(level => level.id === settings.reasoning);
  const effortIndex = levels.indexOf(effort);
  const lastEffortIndex = levels.length - 1;
  const effortLabel = effort ? adjustable ? effort.label : '默认' : currentModel ? `请选择思考档位（当前${requestedEffort?.label || settings.reasoning}不可用）` : '能力未知';
  const search = query.trim().toLowerCase();
  const visibleModels = search ? models.filter(model => `${model.name} ${model.id} ${model.providerName || ''}`.toLowerCase().includes(search)) : models;
  const isSelected = model => model.id === currentModel?.id && model.providerId === currentModel?.providerId;

  useLayoutEffect(() => {
    if (!panel) return;
    const initial = surface.current?.querySelector(
      panel === 'reasoning' ? 'input[type="range"]' : 'input[type="search"], [aria-pressed="true"]'
    ) || surface.current?.querySelector('button');
    initial?.focus({ preventScroll: true });
  }, [panel]);

  function close(returnFocus = false) {
    closeMenu();
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event) {
    if (panel && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  }

  function navigateModels(event) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const rows = [...event.currentTarget.querySelectorAll('button')];
    const index = rows.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    let next = 0;
    if (event.key === 'End') next = rows.length - 1;
    if (event.key === 'ArrowUp') next = (index - 1 + rows.length) % rows.length;
    if (event.key === 'ArrowDown') next = (index + 1) % rows.length;
    rows[next]?.focus();
  }

  function openModels(event) {
    setQuery('');
    setNotice('');
    toggleMenu('models', event);
  }

  async function refreshModels() {
    if (!window.zhixing?.refreshProvider || !currentModel?.providerId || refreshing) return;
    setRefreshing(true);
    setNotice('');
    try {
      setRuntime(await window.zhixing.refreshProvider(currentModel.providerId));
    } catch (error) {
      setNotice(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setRefreshing(false);
    }
  }

  return <div className="model-controls" onKeyDown={onKeyDown} onBlur={event => {
    if (panel && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <button
      ref={trigger}
      type="button"
      className="model-trigger"
      aria-label={`模型与思考强度：${modelCaption}，${effortLabel}`}
      aria-haspopup="dialog"
      aria-expanded={!!panel}
      aria-controls={panel === 'models' ? modelPanelId : panel === 'reasoning' ? effortPanelId : undefined}
      data-effort={effort?.id || 'unavailable'}
      title={`${modelCaption} · ${effortLabel}`}
      disabled={disabled}
      onClick={event => panel ? close() : toggleMenu('reasoning', event)}
    >
      <Lightning size={14} weight="fill"/>
      {panel === 'reasoning' ? <span className="model-trigger-open-label">选择思考强度</span> : <>
        <span className="model-trigger-name">{modelCaption}</span>
        <span className="model-trigger-effort">{effortLabel}</span>
      </>}
      <CaretDown size={10} className="model-trigger-caret"/>
    </button>
    {panel === 'reasoning' && <section
      ref={surface}
      className="dropdown composer-dropdown model-popover effort-popover"
      id={effortPanelId}
      role="dialog"
      aria-label="思考强度"
      data-effort={effort?.id || 'unavailable'}
    >
      <div className="effort-heading">
        <Lightning size={16} weight="fill" aria-hidden="true"/>
        <h2>{effortLabel}</h2>
      </div>
      <button type="button" className="effort-model-link" aria-label={`切换模型，当前 ${modelCaption}`} title={modelCaption} onClick={openModels}>
        <span>{modelCaption}</span><CaretRight size={11} aria-hidden="true"/>
      </button>
      {adjustable && effort ? <div className="effort-rail" style={{ '--effort-position': effortIndex / lastEffortIndex }}>
        <div className="effort-track" aria-hidden="true"><div className="effort-fill"/></div>
        <input
          type="range"
          className="effort-slider"
          min={0}
          max={lastEffortIndex}
          step={1}
          value={effortIndex}
          aria-label="思考强度"
          aria-valuetext={effort.label}
          aria-describedby={descriptionId}
          onChange={event => setSetting('reasoning', levels[event.target.valueAsNumber].id)}
        />
      </div> : currentModel && !effort && effortCapabilityKnown ? <div className="model-picker-status" role="group" aria-label="选择支持的思考档位">
        <p>已保存的「{requestedEffort?.label || settings.reasoning}」档位不受当前模型支持。请选择档位后再交办。</p>
        <div className="form-actions">{levels.map(level => <button type="button" className="secondary-button" key={level.id} onClick={() => setSetting('reasoning', level.id)}>{level.label}</button>)}</div>
      </div> : currentModel && !effortCapabilityKnown ? <p className="model-picker-status" role="status">当前模型的思考能力未知。请刷新目录或选择能力已确认的模型。</p> : currentModel ? <p className="model-picker-status">此模型使用服务端默认思考方式</p> : <p className="model-picker-status" role="alert">所选模型已从当前目录移除，或供应商选择不再有效。请选择可用模型后再交办。</p>}
      {effort && <span id={descriptionId} className="screen-reader-only">{effort.description}</span>}
    </section>}
    {panel === 'models' && <section ref={surface} className="dropdown composer-dropdown model-popover model-picker" id={modelPanelId} role="dialog" aria-label="模型">
      <header className="model-picker-header">
        <h2>选择模型</h2>
        {window.zhixing?.refreshProvider && currentModel?.providerId && <IconButton icon={refreshing ? CircleNotch : ArrowClockwise} label={`刷新 ${currentModel.providerName} 的模型`} disabled={refreshing} onClick={refreshModels}/>}
      </header>
      {models.length > 6 && <label className="model-picker-search">
        <MagnifyingGlass size={15}/>
        <input type="search" aria-label="搜索模型" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模型"/>
      </label>}
      <div className="model-picker-list" role="group" aria-label="可用模型" onKeyDown={navigateModels} aria-busy={refreshing}>
        {visibleModels.map(model => <button
          type="button"
          aria-pressed={isSelected(model)}
          className="model-picker-option"
          key={`${model.providerId || ''}:${model.id}`}
          title={model.id}
          onClick={() => { setSetting('modelSelection', model); close(true); }}
        >
          <span className="model-picker-label">{model.name}{model.providerName && <small> · {model.providerName}</small>}</span>
          {isSelected(model) && <Check size={15}/>}
        </button>)}
      </div>
      {!visibleModels.length && <p className="model-picker-status">没有匹配的模型</p>}
      {notice && <p className="model-picker-status" role="status">{notice}</p>}
      <footer className="model-picker-footer"><button type="button" onClick={openConnection}><SlidersHorizontal size={14}/>管理供应商</button></footer>
    </section>}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { Check, CircleNotch, Microphone, Stop, X } from '@phosphor-icons/react';
import { IconButton } from './ui.jsx';

export function VoiceInput({ disabled, language = 'zh-CN', scopeKey, onAccept, onActiveChange, openSettings }) {
  const api = window.zhixing;
  const [state, setState] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const active = useRef(null);
  const generation = useRef(0);
  const trigger = useRef(null);
  const panel = useRef(null);
  const latest = useRef(onActiveChange);
  latest.current = onActiveChange;

  useEffect(() => {
    const off = api?.onSpeechEvent?.(event => {
      if (event.id !== active.current) return;
      if (event.type === 'ended') active.current = null;
      setState(previous => {
        if (!previous) return previous;
        if (event.type === 'ready') return previous.status === 'starting' ? { ...previous, status: 'listening' } : previous;
        if (event.type === 'text') return { ...previous, text: event.text, partial: '' };
        if (event.type === 'partial') return { ...previous, partial: event.text };
        if (event.type === 'level') return { ...previous, level: Math.min(100, Math.max(0, Number(event.text) || 0)) };
        if (event.type === 'error') return { ...previous, error: event.text, status: 'stopping' };
        if (event.type === 'limit') return { ...previous, status: 'stopping' };
        if (event.type === 'ended') return { ...previous, text: event.text || previous.text, partial: '', status: 'ended', error: event.error || previous.error };
        return previous;
      });
    });
    return () => {
      generation.current++;
      off?.();
      if (active.current) void api?.cancelSpeech?.(active.current).catch(() => {});
      active.current = null;
      latest.current(false);
    };
  }, [api, scopeKey]);
  useEffect(() => { if (state?.status !== 'listening') return; const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer); }, [state?.status]);
  useEffect(() => {
    if (!disabled) return;
    generation.current++;
    if (active.current) void api?.cancelSpeech?.(active.current).catch(() => {});
    active.current = null;
    setState(null);
    latest.current(false);
  }, [disabled, api]);
  const opened = Boolean(state);
  useEffect(() => {
    if (opened) panel.current?.focus({ preventScroll: true });
  }, [opened]);

  function dismiss(returnFocus = true) {
    generation.current++;
    if (active.current) void api?.cancelSpeech?.(active.current).catch(() => {});
    active.current = null;
    setState(null);
    onActiveChange(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }
  async function start() {
    if (state) { dismiss(); return; }
    if (!api?.startSpeech) { setState({ status: 'unsupported' }); return; }
    const current = ++generation.current;
    const id = crypto.randomUUID();
    active.current = id;
    setSeconds(0); setState({ status: 'starting', text: '', partial: '', level: 0 }); onActiveChange(true);
    try {
      await api.startSpeech(language, id);
      if (generation.current !== current) await api.cancelSpeech(id);
    } catch {
      if (generation.current !== current) return;
      active.current = null;
      setState({ status: 'ended', text: '', error: '无法开始本机听写。请在语音设置中检查语音语言和麦克风权限。' });
    }
  }
  async function finish() {
    if (!active.current) return;
    const current = generation.current, id = active.current;
    setState(previous => ({ ...previous, status: 'stopping' }));
    try { const result = await api.stopSpeech(id); if (generation.current === current) { active.current = null; setState(previous => ({ ...previous, status: 'ended', text: result.text || previous?.text || '', error: result.error })); } }
    catch { if (generation.current === current) setState(previous => ({ ...previous, status: 'ended', error: '听写已中断，已识别的文字仍可保留。' })); }
  }
  return <>
    <IconButton ref={trigger} icon={Microphone} label="听写" disabled={disabled && !state} aria-expanded={opened} className={`dictation-trigger ${state && state.status !== 'unsupported' ? 'active' : ''}`} onClick={start}/>
    {state && <section ref={panel} tabIndex={-1} className="dropdown dictation-panel" role="dialog" aria-label="语音听写" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss(); } }}>
      <header><span><Microphone size={16}/>{state.status === 'listening' ? '正在听写' : state.status === 'starting' ? '正在打开麦克风…' : state.status === 'stopping' ? '正在整理文字…' : '语音听写'}</span><IconButton icon={X} label="取消听写" onClick={() => dismiss()}/></header>
      {state.status === 'unsupported' ? <><p>本机听写在 Windows 桌面版中使用。音频由本机语音组件处理。</p><button type="button" className="secondary-button" onClick={() => { dismiss(); openSettings(); }}>查看语音设置</button></> : <>
        <div className="dictation-transcript" aria-live="polite">{state.text}<span className="muted">{state.partial}</span>{!state.text && !state.partial && <span className="muted">{state.status === 'ended' ? '没有识别到文字，请检查麦克风后重试。' : '请说出要交办的事情…'}</span>}</div>
        {state.error && <p className="dictation-error" role="alert">{state.error}</p>}
        <footer><span className="dictation-meta"><meter min="0" max="100" value={state.level || 0} aria-label="麦克风音量"/>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · 本机处理</span><div>{state.status === 'listening' ? <button type="button" className="secondary-button" onClick={finish}><Stop size={13}/>结束听写</button> : state.status === 'starting' || state.status === 'stopping' ? <CircleNotch className="spinning" size={17}/> : <button type="button" className="primary-button" disabled={!state.text} onClick={() => { const text = state.text; dismiss(false); onAccept(text); }}><Check size={14}/>插入文字</button>}</div></footer>
        <small>仅把确认后的文字放入输入框，发送时遵循当前脱敏设置。</small>
      </>}
    </section>}
  </>;
}

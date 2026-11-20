import { useEffect, useRef, useState } from 'react';
import { Check, CircleNotch, Microphone, Stop, X } from '@phosphor-icons/react';
import { IconButton } from './ui.jsx';
import { recordingToWavBase64 } from './speech-audio.js';

const PREPARING_PHASES = new Set(['checking', 'downloading', 'loading', 'waking', 'cancelling']);

function preparationLabel(preparation) {
  if (!preparation || preparation.phase === 'checking') return '正在检查本机语音模型…';
  if (preparation.phase === 'downloading') {
    const mb = value => `${(value / 1024 / 1024).toFixed(0)} MB`;
    return `下载 ${preparation.resource || '语音模型'} · ${mb(preparation.completedBytes || 0)}${preparation.totalBytes ? ` / ${mb(preparation.totalBytes)}` : ''}`;
  }
  if (preparation.phase === 'loading') return '正在验证并加载本机语音模型…';
  if (preparation.phase === 'waking') return '正在启动本机语音识别…';
  if (preparation.phase === 'cancelling') return '正在取消准备…';
  if (preparation.phase === 'failed') return preparation.message || '准备失败，请检查网络和磁盘空间后重试。';
  if (preparation.phase === 'cancelled') return '模型准备已取消。';
  return '首次使用需要下载约 240 MB 的本机识别模型，建议预留 1 GB 磁盘和内存。';
}

function preparationView(preparation) {
  if (['ready', 'standby'].includes(preparation?.phase)) return 'ready';
  if (PREPARING_PHASES.has(preparation?.phase)) return 'preparing';
  return 'needs-preparation';
}

export function VoiceInput({ disabled, language = 'zh-CN', scopeKey, onAccept, onActiveChange, openSettings }) {
  const api = window.zhixing;
  const [state, setState] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [speechStatus, setSpeechStatus] = useState(null);
  const generation = useRef(0);
  const active = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const stream = useRef(null);
  const recorder = useRef(null);
  const recordingOwner = useRef(null);
  const trackListeners = useRef([]);
  const audioContext = useRef(null);
  const audioClosing = useRef(Promise.resolve());
  const meterFrame = useRef(null);
  const limitTimer = useRef(null);
  const latest = useRef({ onActiveChange });
  latest.current = { onActiveChange };

  function releaseRecording(owner = recordingOwner.current) {
    if (!owner || recordingOwner.current !== owner) return Promise.resolve();
    recordingOwner.current = null;
    clearTimeout(limitTimer.current);
    cancelAnimationFrame(meterFrame.current);
    trackListeners.current.forEach(({ track, handler }) => track.removeEventListener('ended', handler));
    trackListeners.current = [];
    const recording = recorder.current;
    recorder.current = null;
    if (recording) {
      recording.ondataavailable = null;
      recording.onstop = null;
      recording.onerror = null;
      if (recording.state !== 'inactive') recording.stop();
    }
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    const context = audioContext.current;
    audioContext.current = null;
    if (context && context.state !== 'closed') audioClosing.current = context.close().catch(() => {});
    return audioClosing.current;
  }

  function dismiss(returnFocus = true) {
    generation.current++;
    const id = active.current;
    active.current = null;
    void releaseRecording();
    if (id) void api?.cancelSpeech(id).catch(() => {});
    setState(null);
    latest.current.onActiveChange(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    setState(null);
    const off = api?.onSpeechEvent(event => {
      if (event.type === 'snapshot') {
        const provider = event.snapshot.providers?.find(item => item.id === 'sensevoice-local');
        if (!provider) return;
        setSpeechStatus({ ...provider, supported: true, providerName: provider.name });
        setState(previous => ['preparing', 'needs-preparation'].includes(previous?.status)
          ? { status: preparationView(provider.preparation) } : previous);
      }
      if (!active.current || event.id !== active.current) return;
      if (event.type === 'limit') finishRecording();
      if (event.type === 'cancelled') dismiss(false);
    });
    const hidden = () => { if (document.hidden && active.current) dismiss(false); };
    const blurred = () => { if (recorder.current?.state === 'recording') dismiss(false); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', blurred);
    return () => {
      generation.current++;
      off?.();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blurred);
      void releaseRecording();
      if (active.current) void api?.cancelSpeech(active.current).catch(() => {});
      active.current = null;
      latest.current.onActiveChange(false);
    };
  }, [api, scopeKey]);

  useEffect(() => {
    if (disabled) dismiss(false);
  }, [disabled]);

  useEffect(() => {
    if (state?.status !== 'recording') return undefined;
    const startedAt = performance.now();
    const timer = setInterval(() => setSeconds(Math.floor((performance.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [state?.status]);

  const opened = Boolean(state);
  useEffect(() => { if (opened) panel.current?.focus({ preventScroll: true }); }, [opened]);

  async function open() {
    if (state) { dismiss(); return; }
    const current = ++generation.current;
    setState({ status: 'checking' });
    try {
      if (!api?.speechStatus) throw new Error('本机语音识别需要 Windows 桌面版。');
      const status = await api.speechStatus();
      if (generation.current !== current) return;
      setSpeechStatus(status);
      if (!status.supported) throw new Error(status.message || '本机语音识别不可用。');
      if (preparationView(status.preparation) === 'ready') await beginRecording();
      else setState({ status: preparationView(status.preparation) });
    } catch (error) {
      if (generation.current === current) setState({ status: 'error', error: error.message });
    }
  }

  async function prepare() {
    const current = generation.current;
    setState({ status: 'preparing' });
    try {
      const result = await api.prepareSpeech();
      if (generation.current !== current) return;
      setSpeechStatus(result);
      setState({ status: preparationView(result.preparation) });
    } catch (error) {
      if (generation.current === current) setState({ status: 'needs-preparation', error: error.message });
    }
  }

  async function cancelPreparation() {
    const current = generation.current;
    try {
      const result = await api.cancelSpeechPreparation();
      if (generation.current !== current) return;
      setSpeechStatus(result);
      setState({ status: preparationView(result.preparation) });
    } catch (error) {
      if (generation.current === current) setState(previous => ({ ...previous, error: error.message }));
    }
  }

  function monitorLevel(media) {
    const context = new AudioContext();
    audioContext.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(media).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let updatedAt = 0;
    const tick = now => {
      if (audioContext.current !== context) return;
      if (now - updatedAt > 100) {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((total, value) => total + value * value, 0) / samples.length);
        setLevel(Math.min(100, Math.round(rms * 400)));
        updatedAt = now;
      }
      meterFrame.current = requestAnimationFrame(tick);
    };
    meterFrame.current = requestAnimationFrame(tick);
    void context.resume().catch(() => {});
  }

  async function beginRecording() {
    const current = ++generation.current;
    const id = crypto.randomUUID();
    active.current = id;
    recordingOwner.current = id;
    setState({ status: 'starting' });
    setSeconds(0);
    setLevel(0);
    latest.current.onActiveChange(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('当前环境无法打开麦克风录音。');
      await audioClosing.current;
      if (generation.current !== current) return;
      await api.startSpeech(language, id);
      if (generation.current !== current) { await api.cancelSpeech(id); return; }
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation.current !== current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const recording = new MediaRecorder(media);
      recorder.current = recording;
      const chunks = [];
      recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recording.onerror = () => {
        if (generation.current !== current) return;
        generation.current++;
        void releaseRecording(id);
        void api.cancelSpeech(id).catch(() => {});
        active.current = null;
        latest.current.onActiveChange(false);
        setState({ status: 'error', error: '麦克风录音中断，请检查设备后重试。' });
      };
      trackListeners.current = media.getAudioTracks().map(track => {
        const handler = recording.onerror;
        track.addEventListener('ended', handler, { once: true });
        return { track, handler };
      });
      recording.onstop = async () => {
        if (generation.current !== current) { await releaseRecording(id); return; }
        const audio = new Blob(chunks, { type: recording.mimeType });
        await releaseRecording(id);
        if (generation.current !== current) return;
        setState({ status: 'transcribing' });
        try {
          if (!audio.size) throw new Error('没有录到声音，请检查麦克风后重试。');
          const encoded = await recordingToWavBase64(audio);
          if (generation.current !== current) return;
          const result = await api.transcribeSpeech(id, encoded);
          if (generation.current === current) setState({ status: 'ended', text: result.text, error: result.text ? '' : '没有识别到文字，请检查麦克风后重试。' });
        } catch (error) {
          if (generation.current === current) setState({ status: 'error', error: error.message });
        } finally {
          await api.cancelSpeech(id).catch(() => {});
          if (generation.current === current) {
            active.current = null;
            latest.current.onActiveChange(false);
          }
        }
      };
      recording.start(250);
      monitorLevel(media);
      setState({ status: 'recording' });
      limitTimer.current = setTimeout(() => finishRecording(id), 120000);
    } catch (error) {
      await releaseRecording(id);
      await api?.cancelSpeech(id).catch(() => {});
      if (generation.current !== current) return;
      active.current = null;
      latest.current.onActiveChange(false);
      setState({ status: 'error', error: error.name === 'NotAllowedError' ? '麦克风权限被拒绝，请检查 Windows 麦克风权限后重试。' : error.message || '无法打开麦克风，请检查设备后重试。' });
    }
  }

  function finishRecording(owner = recordingOwner.current) {
    if (recordingOwner.current !== owner) return;
    clearTimeout(limitTimer.current);
    if (recorder.current?.state !== 'recording') return;
    setState({ status: 'transcribing' });
    recorder.current.stop();
  }

  function dialogKeys(event) {
    if (event.key === 'Escape') { event.stopPropagation(); dismiss(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  const preparation = speechStatus?.preparation;
  const preparing = state?.status === 'preparing';
  return <>
    <IconButton ref={trigger} icon={Microphone} label="本机语音听写" disabled={disabled} aria-expanded={opened} className={`dictation-trigger ${state?.status === 'recording' ? 'active' : ''}`} onClick={open}/>
    {state && <section ref={panel} tabIndex={-1} className="dropdown dictation-panel" role="dialog" aria-label="本机语音听写" onKeyDown={dialogKeys}>
      <header><span><Microphone size={16}/>{state.status === 'recording' ? '正在听写' : state.status === 'starting' ? '正在打开麦克风…' : state.status === 'transcribing' ? 'SenseVoice 正在识别…' : preparing ? '准备本机语音模型' : '本机语音听写'}</span><IconButton icon={X} label="关闭语音听写" onClick={() => dismiss()}/></header>
      {state.status === 'needs-preparation' || preparing ? <>
        <p className={`dictation-preparation ${preparation?.phase === 'failed' ? 'dictation-error' : ''}`} role={preparation?.phase === 'failed' ? 'alert' : 'status'}>{state.error || preparationLabel(preparation)}</p>
        <div className="dictation-actions"><button type="button" className="secondary-button" onClick={() => { dismiss(false); openSettings(); }}>语音设置</button>{preparing ? <button type="button" className="secondary-button" disabled={preparation?.phase === 'cancelling'} onClick={cancelPreparation}>取消准备</button> : <button type="button" className="primary-button" onClick={prepare}>{preparation?.phase === 'failed' ? '重试准备' : '下载并准备'}</button>}</div>
      </> : state.status === 'recording' ? <>
        <div className="dictation-transcript">请说出要交办的事情…</div>
        <footer><span className="dictation-meta"><meter min="0" max="100" value={level} aria-label="麦克风音量"/>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} / 2:00</span><button type="button" className="secondary-button" onClick={() => finishRecording()}><Stop size={13}/>结束听写</button></footer>
      </> : ['transcribing', 'starting', 'checking'].includes(state.status) ? <div className="dictation-wait" role="status"><CircleNotch className="spinning" size={17}/>{state.status === 'transcribing' ? '正在本机识别录音…' : state.status === 'starting' ? '等待麦克风就绪…' : '正在检查语音模型…'}</div> : <>
        {state.status === 'ready' ? <p>本机语音模型已准备好。</p> : state.text ? <div className="dictation-transcript" aria-live="polite">{state.text}</div> : <p className="dictation-error" role="alert">{state.error}</p>}
        <footer><span className="dictation-meta">SenseVoice · 本机处理</span>{state.text ? <button type="button" className="primary-button" onClick={() => { const text = state.text; dismiss(false); onAccept(text); }}><Check size={14}/>插入文字</button> : <button type="button" className="secondary-button" onClick={beginRecording}>{state.status === 'ready' ? '开始听写' : '重试听写'}</button>}</footer>
      </>}
      <small>确认后插入草稿。录音临时在本机识别，发送文字时沿用当前脱敏设置。</small>
    </section>}
  </>;
}

import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text';
import * as SenseVoice from '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice';
import { validateWave } from '@deepseek-ai/dsh-experimental-speech-to-text/wave';

const PROVIDER_ID = 'sensevoice-local';
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_DURATION_SECONDS = 120;
const LANGUAGE_HINTS = new Map([
  ['auto', 'auto'], ['zh-CN', 'zh'], ['en-US', 'en'], ['yue', 'yue'], ['ja', 'ja'], ['ko', 'ko'],
]);

class SpeechSubprocess extends LocalSubprocess {
  spawn(spec) {
    if (!process.versions.electron) return super.spawn(spec);
    const previous = process.env.ELECTRON_RUN_AS_NODE;
    // Upstream's Windows Job runner inherits the host environment before it
    // receives the worker's env. Both processes must start Electron as Node.
    // spawn is synchronous, so restore the host before another task can run.
    process.env.ELECTRON_RUN_AS_NODE = '1';
    try { return super.spawn(spec); }
    finally {
      if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = previous;
    }
  }
}

function publicError(error) {
  return String(error?.message || '本机语音识别未完成。')
    .replace(/https?:\/\/[^\s)]+/gi, '语音模型下载源')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 400);
}

export function decodeSpeechRecording(audioBase64) {
  if (typeof audioBase64 !== 'string' || audioBase64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) {
    throw new Error('录音内容为空或超过本机识别限制。');
  }
  const audio = Buffer.from(audioBase64, 'base64');
  if (audio.toString('base64') !== audioBase64 || audio.length > MAX_AUDIO_BYTES) throw new Error('录音格式无效或超过本机识别限制。');
  try { return { audio, audioSeconds: validateWave(audio, MAX_DURATION_SECONDS) }; }
  catch { throw new Error('录音必须是有效的 16 kHz 单声道 PCM16 WAV，且不超过两分钟。'); }
}

export class SpeechService {
  constructor(onEvent, { dataRoot }) {
    this.onEvent = onEvent;
    this.dataRoot = path.resolve(dataRoot);
    this.context = null;
    this.speech = null;
    this.initialising = null;
    this.active = null;
    this.observer = null;
    this.preparationRequest = null;
    this.closed = false;
  }

  async initialise() {
    if (this.closed) throw new Error('语音服务已关闭。');
    if (this.initialising) return await this.initialising;
    this.initialising = (async () => {
      const context = new Context();
      try {
        await context.plugin(SpeechSubprocess);
        await context.plugin(SpeechToText, { defaultProvider: PROVIDER_ID, language: 'zh' });
        await context.plugin(SenseVoice, {
          dataRoot: this.dataRoot,
          precision: 'int8',
          threads: 2,
          maxAudioBytes: MAX_AUDIO_BYTES,
          prepareTimeoutMs: 60 * 60 * 1000,
          inferenceTimeoutMs: 120 * 1000,
          idleTimeoutMs: 5 * 60 * 1000,
          maxPending: 1,
        });
        this.context = context;
        this.speech = context.get('speechToText');
        const observer = new AbortController();
        this.observer = observer;
        void this.follow(observer.signal);
        return this.speech;
      } catch (error) {
        await context.fiber.dispose().catch(() => {});
        this.initialising = null;
        throw error;
      }
    })();
    return await this.initialising;
  }

  async follow(signal) {
    try {
      for await (const snapshot of this.speech.follow(signal)) {
        this.emit({ type: 'snapshot', snapshot });
      }
    } catch (error) {
      if (!signal.aborted) this.emit({ type: 'service-error', text: publicError(error) });
    }
  }

  emit(event) {
    try { this.onEvent?.(event); } catch { /* The window may close during local inference. */ }
  }

  async status() {
    if (process.platform !== 'win32') return { supported: false, languages: [], message: 'SenseVoice 本机识别目前提供 Windows x64 运行包。' };
    try {
      const speech = await this.initialise();
      const snapshot = speech.snapshot();
      const provider = snapshot.providers.find(item => item.id === PROVIDER_ID);
      return {
        supported: !!provider,
        providerId: PROVIDER_ID,
        providerName: provider?.name || 'SenseVoice 本机识别',
        location: provider?.location,
        languages: provider?.languages || [],
        downloadSources: provider?.downloadSources || [],
        setupEstimate: provider?.setupEstimate,
        preparation: provider?.preparation || { phase: 'unprepared' },
      };
    } catch (error) {
      return { supported: false, languages: [], message: publicError(error) };
    }
  }

  async prepare(downloadSource) {
    if (process.platform !== 'win32') throw new Error('SenseVoice 本机识别需要 Windows x64。');
    const speech = await this.initialise();
    if (this.closed) throw new Error('语音服务已关闭。');
    const provider = speech.snapshot().providers.find(item => item.id === PROVIDER_ID);
    if (!provider) throw new Error('SenseVoice 识别器不可用。');
    if (downloadSource && !provider.downloadSources?.includes(downloadSource)) throw new Error('所选下载源不可用。');
    if (this.preparationRequest) {
      if (this.preparationRequest.downloadSource !== downloadSource) throw new Error('请先取消当前模型准备，再切换下载源。');
      return await this.preparationRequest.promise;
    }
    const request = { downloadSource, controller: new AbortController(), promise: null };
    this.preparationRequest = request;
    request.promise = (async () => {
      // The upstream inspection owns its preparation slot until its final promise settles.
      if (provider.preparation?.phase === 'checking' && provider.preparation.step === 'check') {
        for await (const snapshot of speech.follow(request.controller.signal)) {
          const current = snapshot.providers.find(item => item.id === PROVIDER_ID);
          if (current?.preparation?.phase !== 'checking' || current.preparation.step !== 'check') break;
        }
      }
      await new Promise(resolve => setImmediate(resolve));
      request.controller.signal.throwIfAborted();
      if (this.closed) throw new Error('语音服务已关闭。');
      speech.prepare(PROVIDER_ID, downloadSource ? { downloadSource } : undefined);
      return await this.status();
    })().finally(() => {
      if (this.preparationRequest === request) this.preparationRequest = null;
    });
    return await request.promise;
  }

  async cancelPreparation() {
    const speech = await this.initialise();
    const request = this.preparationRequest;
    request?.controller.abort(new Error('语音模型准备已取消。'));
    await request?.promise.catch(() => {});
    await speech.cancelPreparation(PROVIDER_ID);
    return this.status();
  }

  async start(language = 'zh-CN', id) {
    if (!['zh-CN', 'en-US', 'auto', 'yue', 'ja', 'ko'].includes(language)) throw new Error('不支持所选听写语言。');
    if (typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) throw new Error('听写编号无效。');
    if (process.platform !== 'win32') throw new Error('SenseVoice 本机识别需要 Windows x64。');
    if (this.active) throw new Error('听写正在进行。');
    const speech = await this.initialise();
    if (this.closed) throw new Error('语音服务已关闭。');
    if (this.active) throw new Error('听写正在进行。');
    const snapshot = speech.snapshot();
    const provider = snapshot.providers.find(item => item.id === PROVIDER_ID);
    if (!provider || !['ready', 'standby'].includes(provider.preparation.phase)) {
      throw new Error('请先下载并准备本机语音模型。');
    }
    const hint = LANGUAGE_HINTS.get(language);
    if (!provider.languages.includes(hint)) throw new Error('SenseVoice 不支持所选听写语言。');
    const entry = { id, language: hint, controller: new AbortController(), timer: null, promise: null, finished: false, transcribing: false, captureUntil: Date.now() + MAX_DURATION_SECONDS * 1000 };
    entry.timer = setTimeout(() => this.emit({ id, type: 'limit', text: '已达到两分钟听写上限。' }), MAX_DURATION_SECONDS * 1000);
    entry.timer.unref?.();
    this.active = entry;
    return { id };
  }

  canCapture() {
    return !!this.active && !this.active.transcribing && !this.active.controller.signal.aborted && this.active.captureUntil > Date.now();
  }

  async transcribe(id, audioBase64) {
    const entry = this.active;
    if (!entry || entry.id !== id) throw new Error('这次听写已结束。');
    if (entry.transcribing) throw new Error('这段录音正在识别。');
    entry.transcribing = true;
    clearTimeout(entry.timer);
    entry.promise = (async () => {
      try {
        const { audio, audioSeconds } = decodeSpeechRecording(audioBase64);
        const speech = await this.initialise();
        entry.controller.signal.throwIfAborted();
        const spec = speech.resolve({ audio, providerId: PROVIDER_ID, language: entry.language });
        const result = await speech.transcribe(spec, entry.controller.signal);
        entry.controller.signal.throwIfAborted();
        const text = typeof result.text === 'string' ? result.text.slice(0, 60000) : '';
        this.emit({ id, type: 'text', text });
        return { id, text, audioSeconds: result.audioSeconds ?? audioSeconds };
      } catch (error) {
        const message = publicError(error);
        if (!entry.controller.signal.aborted) this.emit({ id, type: 'error', text: message });
        throw new Error(message);
      } finally {
        await this.finish(entry);
      }
    })();
    return await entry.promise;
  }

  async finish(entry) {
    if (entry.finished) return;
    entry.finished = true;
    clearTimeout(entry.timer);
    if (this.active === entry) this.active = null;
    this.emit({ id: entry.id, type: 'ended' });
  }

  async stop(id, audioBase64) {
    if (!this.active || this.active.id !== id) throw new Error('这次听写已结束。');
    if (typeof audioBase64 !== 'string') throw new Error('录音内容为空。');
    return await this.transcribe(id, audioBase64);
  }

  async cancel(id) {
    const entry = this.active;
    if (!entry || entry.id !== id) return true;
    clearTimeout(entry.timer);
    entry.controller.abort(new Error('听写已取消。'));
    await entry.promise?.catch(() => {});
    await this.finish(entry);
    return true;
  }

  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.preparationRequest?.controller.abort(new Error('语音服务已关闭。'));
    this.closing = (async () => {
      await this.initialising?.catch(() => {});
      await this.preparationRequest?.promise.catch(() => {});
      if (this.active) await this.cancel(this.active.id);
      this.observer?.abort();
      this.observer = null;
      if (this.context) await this.context.fiber.dispose();
      this.context = null;
      this.speech = null;
    })();
    return this.closing;
  }
}

import {TYPE_LABELS} from '../src/privacy-core.js';
import {randomUUID} from 'node:crypto';

const HOLD_BACK = 320;
const MAX_STREAM_LENGTH = 2 * 1024 * 1024;
const TOKEN = /⟦ZX-[a-f0-9]{12}-([A-Z]+)-\d+⟧/g;

export class AssistantTextStream {
  constructor({session, terms = [], policy = {}, apiKey = ''}) {
    this.session = session;
    this.terms = terms;
    this.policy = policy;
    this.apiKey = apiKey;
    this.allowedTokens = new Set(session.entries().map(entry => entry.token));
    this.reset();
  }

  reset() {
    this.attemptId = null;
    this.nextIndex = 0;
    this.raw = '';
    this.text = '';
    this.attemptBase = '';
    this.blocked = false;
  }

  push(frame) {
    if (frame?.type === 'start' && typeof frame.attemptId === 'string') {
      if (this.blocked) return {text: this.text, changed: false, blocked: true};
      const previousText = this.text;
      if (this.attemptId) this.text = this.attemptBase;
      this.attemptId = frame.attemptId;
      this.nextIndex = 0;
      this.raw = '';
      this.attemptBase = this.text;
      this.blocked = false;
      return {text: this.text, changed: previousText !== this.text, blocked: false, rollback: previousText !== this.text};
    }
    if (frame?.type === 'end' && frame.attemptId === this.attemptId) {
      return this.finishAttempt(frame.commit !== false);
    }
    if (frame?.type !== 'chunk' || frame.attemptId !== this.attemptId || frame.index !== this.nextIndex) return false;
    this.nextIndex += 1;
    const chunk = frame.chunk?.type === 'text-delta' ? frame.chunk.text : '';
    if (typeof chunk !== 'string' || !chunk) return {text: this.text, changed: false, blocked: this.blocked};
    this.raw += chunk;
    if (this.raw.length > MAX_STREAM_LENGTH) throw new Error('正在生成的正文过长，已暂停预览。');
    return this.update(false);
  }

  finish() {
    return this.update(true);
  }

  beginAttempt() {
    return this.push({type: 'start', attemptId: randomUUID()});
  }

  appendText(text) {
    if (typeof text !== 'string' || !text) return {text: this.text, changed: false, blocked: this.blocked};
    if (!this.attemptId) {
      const started = this.beginAttempt();
      if (started.blocked) return started;
    }
    return this.push({
      type: 'chunk',
      attemptId: this.attemptId,
      index: this.nextIndex,
      chunk: {type: 'text-delta', text},
    });
  }

  finishAttempt(commit = true) {
    if (!this.attemptId) return {text: this.text, changed: false, blocked: this.blocked};
    const result = this.finish();
    const previousText = this.text;
    if (!result.blocked && commit) this.attemptBase = this.text;
    if (!commit && !result.blocked) this.text = this.attemptBase;
    this.attemptId = null;
    this.nextIndex = 0;
    this.raw = '';
    if (previousText !== this.text) return {text: this.text, changed: true, blocked: false, rollback: true};
    return result;
  }

  update(final) {
    if (this.blocked || (this.apiKey.length >= 12 && this.raw.includes(this.apiKey))) {
      this.blocked = true;
      return {text: this.text, changed: false, blocked: true};
    }

    let rawEnd = final ? this.raw.length : Math.max(0, this.raw.length - HOLD_BACK);
    if (this.apiKey.length >= 12) {
      const earliestCandidate = Math.max(0, this.raw.length - this.apiKey.length + 1);
      for (let start = earliestCandidate; start < this.raw.length; start += 1) {
        const suffix = this.raw.slice(start);
        if (suffix.length < this.apiKey.length && this.apiKey.startsWith(suffix)) rawEnd = Math.min(rawEnd, start);
      }
    }
    const checked = this.session.protect(this.raw.slice(0, rawEnd), this.terms, this.policy);
    if (checked.blocked) {
      this.blocked = true;
      return {text: this.text, changed: false, blocked: true};
    }
    const restored = this.session.restore(checked.text, {allowedTokens: this.allowedTokens});
    const text = restored.text.replace(TOKEN, (_token, type) => `【${TYPE_LABELS[type] || '敏感信息'}已隐藏】`)
      .replace(/⟦ZX-[^⟧]+⟧/g, '【敏感值待核实】');
    const next = this.attemptBase + text;
    if (next === this.text) return {text: this.text, changed: false, blocked: false};
    if (!next.startsWith(this.text)) return {text: this.text, changed: false, blocked: false};
    this.text = next;
    return {text: this.text, changed: true, blocked: false};
  }
}

function readStreamEvent(data) {
  if (data === '[DONE]') return {complete: true};
  let event;
  try { event = JSON.parse(data); } catch { return {}; }

  if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
    return {text: typeof event.delta.text === 'string' ? event.delta.text : ''};
  }
  if (event?.type === 'message_delta' && event.delta?.stop_reason) {
    return {outcome: event.delta.stop_reason === 'tool_use' ? 'discard' : 'commit'};
  }
  if (event?.type === 'message_stop') return {complete: true};

  if (!Array.isArray(event?.choices)) return {};
  const text = event.choices.flatMap(choice => {
    const content = choice?.delta?.content;
    if (typeof content === 'string') return [content];
    if (!Array.isArray(content)) return [];
    return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text);
  }).join('');
  const finishReason = event.choices.find(choice => choice?.finish_reason)?.finish_reason;
  return {
    ...text ? {text} : {},
    ...finishReason ? {outcome: ['tool_calls', 'function_call'].includes(finishReason) ? 'discard' : 'commit'} : {},
  };
}

export function createAssistantStreamDecoder(onText) {
  const decoder = new TextDecoder();
  let pending = '';
  let dataLines = [];
  let dataLength = 0;
  let discarding = false;
  let complete = false;
  let outcome = 'commit';

  const dispatch = () => {
    if (!discarding && dataLines.length) {
      const event = readStreamEvent(dataLines.join('\n'));
      if (event.text) onText(event.text);
      if (event.outcome) outcome = event.outcome;
      if (event.complete) complete = true;
    }
    dataLines = [];
    dataLength = 0;
    discarding = false;
  };

  const line = value => {
    const normalized = value.endsWith('\r') ? value.slice(0, -1) : value;
    if (!normalized) {
      dispatch();
      return;
    }
    if (normalized.startsWith(':') || !normalized.startsWith('data:')) return;
    if (discarding) return;
    const data = normalized.slice(5).replace(/^ /, '');
    dataLength += data.length;
    if (dataLength > MAX_STREAM_LENGTH) {
      discarding = true;
      dataLines = [];
      return;
    }
    dataLines.push(data);
  };

  const consume = final => {
    let lineStart = 0;
    for (let index = 0; index < pending.length; index += 1) {
      if (pending[index] === '\n') {
        line(pending.slice(lineStart, index));
        lineStart = index + 1;
      } else if (pending[index] === '\r') {
        if (index === pending.length - 1 && !final) break;
        line(pending.slice(lineStart, index));
        if (pending[index + 1] === '\n') index += 1;
        lineStart = index + 1;
      }
    }
    if (lineStart) pending = pending.slice(lineStart);
    if (pending.length > MAX_STREAM_LENGTH) {
      pending = '';
      discarding = true;
    }
    if (final) {
      if (pending) line(pending);
      pending = '';
      dispatch();
    }
  };

  return {
    push(chunk) {
      pending += decoder.decode(chunk, {stream: true});
      consume(false);
    },
    finish() {
      pending += decoder.decode();
      consume(true);
      return complete ? outcome : 'abort';
    },
  };
}

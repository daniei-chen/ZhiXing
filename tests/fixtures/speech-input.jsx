import React from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceInput } from '../../src/VoiceInput.jsx';

const pendingMedia = [];
const recordings = [];
const contexts = [];
const activeEvents = [];
const cancelled = [];
let startGate = null;
let starts = 0;
let properties = { scopeKey: 'first', disabled: false };

window.zhixing = {
  speechStatus: async () => ({ supported: true, preparation: { phase: 'ready' } }),
  onSpeechEvent: () => () => {},
  startSpeech: async () => { starts += 1; await startGate?.promise; },
  cancelSpeech: async id => { cancelled.push(id); },
  transcribeSpeech: async () => ({ text: '合成组件结果' }),
};
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  getUserMedia: () => {
    const pending = Promise.withResolvers();
    pendingMedia.push(pending);
    return pending.promise;
  },
} });
window.MediaRecorder = class {
  constructor(media) { this.media = media; this.state = 'inactive'; this.mimeType = 'audio/webm'; recordings.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    const handler = this.onstop;
    if (handler) queueMicrotask(() => handler());
  }
};
window.AudioContext = class {
  constructor() { this.state = 'running'; contexts.push(this); }
  createAnalyser() { return { fftSize: 512, getFloatTimeDomainData: samples => samples.fill(0) }; }
  createMediaStreamSource() { return { connect() {} }; }
  resume() { return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
};

const root = createRoot(document.body.appendChild(document.createElement('div')));
function render(patch = {}) {
  properties = { ...properties, ...patch };
  root.render(<VoiceInput {...properties} onActiveChange={value => activeEvents.push(value)} onAccept={() => {}} openSettings={() => {}}/>);
}
function assert(value, message) { if (!value) throw new Error(message); }
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
async function waitFor(predicate, label) {
  const deadline = performance.now() + 4000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${label}. starts=${starts}, media=${pendingMedia.length}, page=${document.body.innerText}`);
    await tick();
  }
}
const trigger = () => document.querySelector('[aria-label="本机语音听写"]');
function dismiss() { document.querySelector('[aria-label="关闭语音听写"]').click(); }
function media() {
  const handlers = new Set();
  const track = {
    stops: 0, stop() { this.stops += 1; },
    addEventListener(_event, handler) { handlers.add(handler); },
    removeEventListener(_event, handler) { handlers.delete(handler); },
    handlers,
  };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}
async function pendingCapture() {
  const count = pendingMedia.length;
  trigger().click();
  await waitFor(() => pendingMedia.length === count + 1, 'getUserMedia');
  return pendingMedia.at(-1);
}
async function readyCapture() {
  const pending = await pendingCapture();
  const stream = media();
  pending.resolve(stream);
  await waitFor(() => recordings.at(-1)?.media === stream && recordings.at(-1).state === 'recording', 'recording');
  return { stream, recording: recordings.at(-1) };
}

window.runSpeechInputTests = async () => {
  const results = [];
  render();
  await waitFor(trigger, 'mounted VoiceInput');

  const old = await pendingCapture();
  dismiss();
  await tick();
  const current = await readyCapture();
  old.reject(Object.assign(new Error('old permission rejection'), { name: 'NotAllowedError' }));
  await tick();
  assert(current.stream.track.stops === 0 && current.recording.state === 'recording', 'Old getUserMedia rejection stopped the new recording');
  assert(activeEvents.at(-1) === true, 'Old failure reset the new active state');
  dismiss();
  await tick();
  assert(current.stream.track.stops === 1 && current.stream.track.handlers.size === 0, 'Cancel did not release tracks and ended listeners');
  results.push('late getUserMedia rejection preserves a newer recording');

  const late = await pendingCapture();
  dismiss();
  await tick();
  const replacement = await readyCapture();
  const lateStream = media();
  late.resolve(lateStream);
  await tick();
  assert(lateStream.track.stops === 1, 'Cancelled late media was not stopped');
  assert(replacement.stream.track.stops === 0, 'Late media cleaned the replacement stream');
  const staleStop = replacement.recording.onstop;
  dismiss();
  await tick();
  const newest = await readyCapture();
  await staleStop();
  assert(newest.stream.track.stops === 0, 'Queued old onstop stopped a newer recording');
  dismiss();
  await tick();
  results.push('late media and queued old onstop release only their own capture');

  const scoped = await readyCapture();
  render({ scopeKey: 'second' });
  await waitFor(() => !document.querySelector('[aria-label="关闭语音听写"]'), 'scope dismissal');
  assert(scoped.stream.track.stops === 1 && activeEvents.at(-1) === false, 'Scope change kept microphone resources');
  results.push('scope changes dismiss the panel and release the microphone');

  const suspended = await readyCapture();
  render({ disabled: true });
  await waitFor(() => !document.querySelector('[aria-label="关闭语音听写"]'), 'modal suspension');
  assert(suspended.stream.track.stops === 1 && trigger().disabled, 'Suspension kept microphone resources');
  render({ disabled: false });
  await waitFor(() => !trigger().disabled, 'resume');
  results.push('modal suspension cancels recording and permits a fresh attempt');

  startGate = Promise.withResolvers();
  const priorStarts = starts;
  const priorMedia = pendingMedia.length;
  trigger().click();
  await waitFor(() => starts === priorStarts + 1, 'pending host admission');
  dismiss();
  startGate.resolve();
  startGate = null;
  await tick();
  assert(pendingMedia.length === priorMedia && activeEvents.at(-1) === false, 'Cancelled start opened a microphone after host admission');
  results.push('cancel during host admission never opens getUserMedia');

  const unmounted = await readyCapture();
  root.unmount();
  await tick();
  assert(unmounted.stream.track.stops === 1, 'Unmount left a live microphone');
  assert(contexts.every(context => context.state === 'closed'), 'An audio meter context survived cleanup');
  assert(activeEvents.at(-1) === false && cancelled.length >= 6, 'Unmount did not finish local cancellation');
  results.push('unmount closes every owned audio context');
  return results;
};

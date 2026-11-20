import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { encodePcm16Wav } from '../src/speech-audio.js';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const load = file => import(packed ? pathToFileURL(path.join(packed, 'electron', file)).href : `../electron/${file}`);
const { SpeechService } = await load('speech-service.mjs');
const { permitsSpeechCapture } = await load('speech-policy.mjs');
const dataRoot = path.join(os.tmpdir(), 'zhixing-speech-lifecycle-fixture');

function localFixture(transcribe) {
  return {
    snapshot: () => ({ providers: [{ id: 'sensevoice-local', languages: ['zh', 'en'], preparation: { phase: 'ready' } }] }),
    resolve: input => input,
    transcribe,
  };
}

test('speech capture permission requires an armed main-window audio request', () => {
  const request = { permission: 'media', isMainWindow: true, armed: true, details: { isMainFrame: true, requestingUrl: 'zhixing://app/index.html', mediaTypes: ['audio'] } };
  assert.equal(permitsSpeechCapture(request), true);
  assert.equal(permitsSpeechCapture({ ...request, armed: false }), false);
  assert.equal(permitsSpeechCapture({ ...request, isMainWindow: false }), false);
  for (const mediaTypes of [['video'], ['audio', 'video'], []]) assert.equal(permitsSpeechCapture({ ...request, details: { ...request.details, mediaTypes } }), false);
  assert.equal(permitsSpeechCapture({ ...request, details: { ...request.details, requestingUrl: 'https://example.invalid' } }), false);
  assert.equal(permitsSpeechCapture({ ...request, details: { ...request.details, isMainFrame: false } }), false);
  assert.equal(permitsSpeechCapture({ ...request, details: { isMainFrame: true, requestingUrl: 'zhixing://app/index.html', mediaType: 'audio' } }), true);
});

test('simultaneous recording admissions reserve one local recognizer', async () => {
  const voice = new SpeechService(null, { dataRoot });
  const gate = Promise.withResolvers();
  voice.initialise = () => gate.promise;
  const ids = [randomUUID(), randomUUID()];
  const attempts = ids.map(id => voice.start('zh-CN', id));
  gate.resolve(localFixture());
  const results = await Promise.allSettled(attempts);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(voice.canCapture(), true);
  await voice.cancel(randomUUID());
  assert.equal(voice.canCapture(), true);
  await voice.cancel(voice.active.id);
  assert.equal(voice.canCapture(), false);
  await voice.close();
});

test('cancellation joins inference cleanup, rejects duplicate audio and publishes one terminal event', async () => {
  const events = [], started = Promise.withResolvers(), cleanup = Promise.withResolvers();
  const voice = new SpeechService(event => events.push(event), { dataRoot });
  let calls = 0;
  voice.initialise = async () => localFixture(async (_input, signal) => {
    calls++;
    started.resolve();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    await cleanup.promise;
    signal.throwIfAborted();
  });
  const id = randomUUID();
  await voice.start('zh-CN', id);
  const audio = encodePcm16Wav([Float32Array.of(0, 0)], 16000);
  const transcript = voice.transcribe(id, audio);
  const failed = assert.rejects(transcript, /听写已取消/);
  await started.promise;
  assert.equal(voice.canCapture(), false);
  await assert.rejects(voice.transcribe(id, audio), /正在识别/);
  let cancelled = false;
  const cancellation = voice.cancel(id).then(() => { cancelled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, false);
  assert.equal(voice.active.id, id);
  cleanup.resolve();
  await Promise.all([cancellation, failed]);
  assert.equal(calls, 1);
  assert.equal(voice.active, null);
  assert.equal(events.filter(event => event.type === 'ended').length, 1);
  assert.equal(events.filter(event => event.type === 'text' || event.type === 'error').length, 0);
  await voice.close();
});

test('closing during actual local provider startup disposes initialization and refuses later work', async () => {
  const voice = new SpeechService(null, { dataRoot });
  const startup = voice.initialise();
  const closed = voice.close();
  await Promise.all([startup, closed]);
  assert.equal(voice.context, null);
  assert.equal(voice.speech, null);
  assert.equal(voice.canCapture(), false);
  await assert.rejects(voice.initialise(), /已关闭/);
});

test('prepare waits for initial cache inspection and starts once its upstream slot is released', async () => {
  const inspected = Promise.withResolvers();
  let phase = 'checking', prepared = 0, inspectionOwnsSlot = true;
  const snapshot = () => ({ providers: [{ id: 'sensevoice-local', preparation: { phase, step: phase === 'checking' ? 'check' : undefined } }] });
  const speech = {
    snapshot,
    async *follow() {
      yield snapshot();
      await inspected.promise;
      phase = 'standby';
      queueMicrotask(() => { inspectionOwnsSlot = false; });
      yield snapshot();
    },
    prepare() { assert.equal(inspectionOwnsSlot, false); prepared += 1; },
  };
  const voice = new SpeechService(null, { dataRoot });
  voice.initialise = async () => speech;
  const first = voice.prepare();
  const duplicate = voice.prepare();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prepared, 0);
  inspected.resolve();
  await Promise.all([first, duplicate]);
  assert.equal(prepared, 1);
  await voice.close();
});

test('cancel during initial inspection never starts a late model preparation', async () => {
  let prepared = 0, cancelled = 0;
  const speech = {
    snapshot: () => ({ providers: [{ id: 'sensevoice-local', preparation: { phase: 'checking', step: 'check' } }] }),
    async *follow(signal) {
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      signal.throwIfAborted();
    },
    prepare() { prepared += 1; },
    async cancelPreparation() { cancelled += 1; },
  };
  const voice = new SpeechService(null, { dataRoot });
  voice.initialise = async () => speech;
  const preparation = voice.prepare();
  const rejected = assert.rejects(preparation, /准备已取消/);
  await new Promise(resolve => setImmediate(resolve));
  await voice.cancelPreparation();
  await rejected;
  assert.equal(prepared, 0);
  assert.equal(cancelled, 1);
  assert.equal(voice.preparationRequest, null);
  await voice.close();
});

test('invalid audio and a failed inference release admission and permit a successful retry', async () => {
  let calls = 0;
  const voice = new SpeechService(null, { dataRoot });
  voice.initialise = async () => localFixture(async () => {
    if (++calls === 1) throw new Error('合成识别失败');
    return { text: '重试成功', audioSeconds: 0.001 };
  });
  const invalid = randomUUID();
  await voice.start('zh-CN', invalid);
  await assert.rejects(voice.transcribe(invalid, '%%%'), /格式无效/);
  assert.equal(voice.active, null);
  const failed = randomUUID();
  const audio = encodePcm16Wav([Float32Array.of(0, 0)], 16000);
  await voice.start('zh-CN', failed);
  await assert.rejects(voice.transcribe(failed, audio), /合成识别失败/);
  assert.equal(voice.active, null);
  const retry = randomUUID();
  await voice.start('zh-CN', retry);
  assert.equal((await voice.transcribe(retry, audio)).text, '重试成功');
  assert.equal(voice.canCapture(), false);
  await voice.close();
});

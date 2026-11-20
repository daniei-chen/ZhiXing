import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodePcm16Wav, recordingToWavBase64 } from '../src/speech-audio.js';
const packed = process.env.ZHIXING_TEST_PACKED_APP;
const { decodeSpeechRecording } = await import(packed ? pathToFileURL(path.join(packed, 'electron/speech-service.mjs')).href : '../electron/speech-service.mjs');

test('mono 16 kHz PCM16 WAV is canonical and survives host validation', () => {
  const encoded = encodePcm16Wav([Float32Array.from([0.25, -0.25, 0.75, -0.75])], 16000, 4 / 16000);
  const { audio, audioSeconds } = decodeSpeechRecording(encoded);
  assert.equal(audioSeconds, 4 / 16000);
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  assert.equal(audio.toString('ascii', 8, 12), 'WAVE');
  assert.equal(audio.readUInt32LE(24), 16000);
  assert.equal(audio.readUInt16LE(22), 1);
  assert.equal(audio.readUInt16LE(34), 16);
  assert.equal(audio.readInt16LE(44), 8192);
});

test('stereo audio downmixes; non-16kHz recordings are resampled without clipping', () => {
  const encoded = encodePcm16Wav([
    Float32Array.from([1, -1, 0.25, -0.25]),
    Float32Array.from([-1, 1, 0.25, -0.25]),
  ], 8000, 0.0005);
  const { audio } = decodeSpeechRecording(encoded);
  assert.equal(audio.readUInt16LE(40), 16);
  assert.deepEqual([audio.readInt16LE(44), audio.readInt16LE(46), audio.readInt16LE(48), audio.readInt16LE(50)], [0, 0, 0, 4096]);
});

test('MediaRecorder output can be decoded and converted with the browser audio API contract', async () => {
  class Decoder {
    async decodeAudioData() {
      return { numberOfChannels: 1, duration: 2 / 16000, sampleRate: 16000, getChannelData: () => Float32Array.from([0, 0.5]) };
    }
  }
  const recording = { arrayBuffer: async () => new ArrayBuffer(1) };
  const { audio } = decodeSpeechRecording(await recordingToWavBase64(recording, Decoder));
  assert.equal(audio.length, 48);
  assert.equal(audio.readInt16LE(46), 16384);
});

test('invalid payloads and recordings over two minutes are refused locally', () => {
  assert.throws(() => decodeSpeechRecording('%%%'), /格式无效/);
  assert.throws(() => encodePcm16Wav([new Float32Array(120 * 16000 + 1)], 16000, 120.0001), /录音时间超出限制/);
  assert.throws(() => encodePcm16Wav([Float32Array.of(0)], 0), /录音格式无效/);
});

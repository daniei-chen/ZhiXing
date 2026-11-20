const MAX_SECONDS = 120;
const TARGET_SAMPLE_RATE = 16000;

export function encodePcm16Wav(channels, sampleRate, seconds = 0) {
  if (!Array.isArray(channels) || !channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('录音格式无效。');
  const source = channels.map(channel => channel instanceof Float32Array ? channel : Float32Array.from(channel));
  const inputLength = Math.min(...source.map(channel => channel.length));
  const frameCount = Math.ceil((seconds || inputLength / sampleRate) * TARGET_SAMPLE_RATE);
  if (inputLength < 1 || !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > MAX_SECONDS * TARGET_SAMPLE_RATE) throw new Error('录音时间超出限制，请缩短后重试。');

  const buffer = new ArrayBuffer(44 + frameCount * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  writeText(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); writeText(8, 'WAVE');
  writeText(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, TARGET_SAMPLE_RATE, true); view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeText(36, 'data'); view.setUint32(40, frameCount * 2, true);
  const pcm = new Int16Array(buffer, 44);
  for (let frame = 0; frame < frameCount; frame++) {
    const sourcePosition = Math.min(inputLength - 1, frame * sampleRate / TARGET_SAMPLE_RATE);
    const sourceFrame = Math.floor(sourcePosition);
    const nextFrame = Math.min(inputLength - 1, sourceFrame + 1);
    const fraction = sourcePosition - sourceFrame;
    let sample = 0;
    for (const channel of source) sample += (channel[sourceFrame] || 0) * (1 - fraction) + (channel[nextFrame] || 0) * fraction;
    sample = Math.max(-1, Math.min(1, sample / source.length));
    pcm[frame] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export async function recordingToWavBase64(recording, AudioContextType = OfflineAudioContext) {
  const decoder = new AudioContextType(1, 1, TARGET_SAMPLE_RATE);
  const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());
  // decodeAudioData resamples into this context's 16 kHz rate. Limit any
  // final MediaRecorder chunk extending beyond the two-minute stop timer.
  const maxSamples = Math.floor(decoded.sampleRate * MAX_SECONDS);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index).subarray(0, maxSamples));
  return encodePcm16Wav(channels, decoded.sampleRate);
}

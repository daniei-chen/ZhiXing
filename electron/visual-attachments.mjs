import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { PrivacySession } from '../src/privacy-core.js';
import { PRIVACY_ENGINE_VERSION, privacyPolicyForMode } from '../src/privacy-policy.js';
import { canonicalText, containsCredential } from '../src/privacy-recognizers.js';
import { recognizeImage } from './ocr-service.mjs';

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 20_000_000;
export const VISUAL_MAX_BYTES = 1024 * 1024;
export const VISUAL_MAX_PIXELS = 2_000_000;
export const VISUAL_MAX_PER_REQUEST = 4;
export const VISUAL_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const inputFormats = new Map([['.png', 'png'], ['.jpg', 'jpeg'], ['.jpeg', 'jpeg'], ['.webp', 'webp'], ['.gif', 'gif']]);
const outputTypes = new Set(['image/png', 'image/jpeg']);

const digest = value => createHash('sha256').update(value).digest('hex');
export const supportsVisualImage = name => typeof name === 'string' && inputFormats.has(path.extname(name).toLowerCase());

export function visionPrivacy(settings = {}, credentials = []) {
  const privacyMode = settings.privacyMode === 'raw' ? 'raw' : 'redact';
  const policy = privacyPolicyForMode(settings.privacyPolicy, privacyMode);
  const sourceTerms = Array.isArray(settings.customTerms) ? settings.customTerms : [];
  const terms = [...new Set(sourceTerms.filter(term => typeof term === 'string' && term.length <= 120 && term.trim()))].sort().slice(0, 100);
  const secrets = [...new Set(credentials.filter(value => typeof value === 'string' && value))];
  const key = digest(JSON.stringify({
    version: 'vision-v1', engine: PRIVACY_ENGINE_VERSION, privacyMode, policy, terms, secrets: secrets.map(digest).sort(),
  }));
  return { key, privacyMode, policy, terms, secrets };
}

function positionedLines(lines, width, height) {
  if (!Array.isArray(lines)) throw new Error('本机 OCR 未提供图片坐标，无法准备视觉副本。');
  let offset = 0;
  return lines.map(line => {
    if (typeof line.text !== 'string' || !Array.isArray(line.words)) throw new Error('本机 OCR 布局无效。');
    const start = offset;
    offset += line.text.length + 1;
    let cursor = 0;
    const words = line.words.map(word => {
      const text = word.text;
      const index = typeof text === 'string' && text.length ? line.text.indexOf(text, cursor) : -1;
      const { x, y, width: w, height: h } = word;
      if (index < 0 || ![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height) {
        throw new Error('本机 OCR 词框无法与像素对应，请重新选择清晰的图片。');
      }
      cursor = index + text.length;
      return { start: start + index, end: start + cursor, x, y, right: x + w, bottom: y + h };
    });
    return { text: line.text, start, end: offset - 1, words };
  });
}

function visualBoxes(lines, width, height, privacy) {
  const positioned = positionedLines(lines, width, height);
  const text = positioned.map(line => line.text).join('\n');
  const joinedText = text.replace(/\n/g, ' ');
  const compact = canonicalText(text).replace(/\s+/gu, '').toLowerCase();
  if (privacy.secrets.some(secret => {
    const comparable = canonicalText(secret).replace(/\s+/gu, '').toLowerCase();
    return containsCredential(text, secret) || comparable && compact.includes(comparable);
  })) throw new Error('图片 OCR 结果含有已配置的凭证，无法准备视觉副本。');

  const inspect = value => new PrivacySession(randomUUID()).protect(value, privacy.terms, privacy.policy);
  const checks = [inspect(text), ...(joinedText !== text ? [inspect(joinedText)] : [])];
  if (checks.some(check => check.blocked)) throw new Error('图片 OCR 结果命中阻断规则，无法准备视觉副本。');
  if (privacy.privacyMode === 'raw') return [];

  // The two views use identical offsets. Check each affected line and mask the
  // whole selected word even when the detector matched only part of it.
  const boxes = new Set();
  const findings = checks.flatMap(check => check.findings);
  if (findings.length > 2000) throw new Error('图片敏感区域过多，请分成较小的图片。');
  for (const { start, end } of findings) {
    let found = false;
    for (const line of positioned) {
      if (line.end <= start || line.start >= end) continue;
      const first = Math.max(start, line.start), last = Math.min(end, line.end);
      const words = line.words.filter(word => word.start < last && word.end > first);
      let checkedThrough = first;
      for (const word of words) {
        if (/\S/u.test(text.slice(checkedThrough, Math.max(checkedThrough, word.start)))) {
          throw new Error('图片敏感文字与词框未完整对应，已停止生成副本。');
        }
        checkedThrough = Math.max(checkedThrough, word.end);
        boxes.add(word);
        found = true;
      }
      if (/\S/u.test(text.slice(Math.min(last, checkedThrough), last))) {
        throw new Error('图片敏感文字与词框未完整对应，已停止生成副本。');
      }
    }
    if (!found) throw new Error('图片敏感文字缺少词框，已停止生成副本。');
  }
  return [...boxes].map(({ x, y, right, bottom }) => {
    const left = Math.max(0, Math.floor(x) - 4), top = Math.max(0, Math.floor(y) - 4);
    return { x: left, y: top, width: Math.min(width, Math.ceil(right) + 4) - left, height: Math.min(height, Math.ceil(bottom) + 4) - top };
  });
}

async function fitWireImage(png, width, height, original, outputMediaType) {
  const scale = Math.min(1, Math.sqrt(VISUAL_MAX_PIXELS / (width * height)), 2048 / Math.max(width, height));
  const w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
  const raster = sharp(png).resize(w, h, { fit: 'fill', withoutEnlargement: true });
  for (const compressionLevel of outputMediaType === 'image/jpeg' ? [] : [6, 9]) {
    const lossless = await raster.clone().png({ compressionLevel }).toBuffer();
    if (lossless.length <= VISUAL_MAX_BYTES && !lossless.equals(original)) return { bytes: lossless, mediaType: 'image/png' };
  }
  for (const quality of outputMediaType === 'image/png' ? [] : [88, 74, 60]) {
    const compressed = await raster.clone().jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer();
    if (compressed.length <= VISUAL_MAX_BYTES && !compressed.equals(original)) return { bytes: compressed, mediaType: 'image/jpeg' };
  }
  throw new Error('图片副本超过 1 MiB，请裁剪图片后重新添加。');
}

export async function prepareVisualAttachment({ name, bytes, privacy, signal, outputMediaType } = {}) {
  signal?.throwIfAborted();
  if (outputMediaType !== undefined && !outputTypes.has(outputMediaType)) throw new Error('不支持选定的视觉副本格式。');
  if (!supportsVisualImage(name) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_SOURCE_BYTES) {
    throw new Error('请选择 10 MB 以内的 PNG、JPEG、WebP 或 GIF 图片。');
  }
  const image = sharp(bytes, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: 'warning' });
  const metadata = await image.metadata().catch(() => null);
  if (!metadata || metadata.format !== inputFormats.get(path.extname(name).toLowerCase()) || (metadata.pages || 1) !== 1) {
    throw new Error('图片格式与文件名不符，或图片包含多个画面（动图暂不支持，请提供单帧图片）。');
  }
  // Remove metadata and hidden transparent pixels before OCR. The OCR worker
  // and the pixel mask use the same raster and its orientation.
  const { data: canonical, info } = await image.autoOrient().toColourspace('srgb').flatten({ background: '#ffffff' })
    .png().toBuffer({ resolveWithObject: true });
  const ocr = await recognizeImage('visual.png', canonical, { signal, includeLayout: true, allowEmpty: true, maxBytes: 64 * 1024 * 1024 });
  const { width, height } = info;
  if (ocr.layout.width !== width || ocr.layout.height !== height) throw new Error('本机 OCR 尺寸与图片副本不一致。');
  const boxes = visualBoxes(ocr.layout.lines, width, height, privacy);

  let masked = canonical;
  if (boxes.length) {
    const rects = boxes.map(box => '<rect x="' + box.x + '" y="' + box.y + '" width="' + box.width + '" height="' + box.height + '" fill="#111111"/>').join('');
    const overlay = '<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg">' + rects + '</svg>';
    masked = await sharp(canonical).composite([{ input: Buffer.from(overlay) }]).png().toBuffer();
  }
  const wire = await fitWireImage(masked, width, height, bytes, outputMediaType);
  signal?.throwIfAborted();

  const visualId = randomUUID(), hash = digest(wire.bytes);
  const visual = { visualId, sha256: hash, mediaType: wire.mediaType, maskCount: boxes.length, privacyMode: privacy.privacyMode };
  const coverage = {
    ...ocr.coverage,
    kind: 'ocr-vision',
    masking: privacy.privacyMode === 'raw' ? 'raw' : 'recognized-sensitive-regions',
    maskCount: boxes.length,
    notice: privacy.privacyMode === 'raw'
      ? '非脱敏模式保留图像内容，副本去除文件元数据。识别出的凭证仍受阻断规则约束。'
      : ocr.text.trim()
        ? '图片在本机生成去元数据副本。遮罩仅覆盖 OCR 识别且命中规则的文字。'
        : '本机 OCR 未读到文字。图片副本去除文件元数据，图像内容仍可能包含敏感信息。',
  };
  return {
    parsed: { id: visualId, name, size: bytes.length, status: 'ready', text: ocr.text, coverage, visual },
    record: { id: visualId, policyKey: privacy.key, sha256: hash, mediaType: wire.mediaType, bytes: wire.bytes.length, data: wire.bytes.toString('base64') },
  };
}

export function readVisualAttachment(record, visualId, policyKey) {
  if (typeof visualId !== 'string' || !VISUAL_ID.test(visualId) || !record || record.id !== visualId || record.policyKey !== policyKey) {
    throw new Error('图片副本不可用或隐私规则已变化，请移除旧附件并重新添加图片。');
  }
  if (!DIGEST.test(record.sha256) || !outputTypes.has(record.mediaType) || !Number.isInteger(record.bytes) || record.bytes < 1 || record.bytes > VISUAL_MAX_BYTES
    || typeof record.data !== 'string' || record.data.length !== Math.ceil(record.bytes / 3) * 4) {
    throw new Error('图片副本信息不完整，请重新添加图片。');
  }
  const data = Buffer.from(record.data, 'base64');
  if (data.length !== record.bytes || data.toString('base64') !== record.data || digest(data) !== record.sha256) {
    throw new Error('图片副本内容已变化，请重新添加图片。');
  }
  return record;
}

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PrivacySession } from '../src/privacy-core.js';
import { privacyPolicyForMode } from '../src/privacy-policy.js';
import { recognizeImage, supportsOcrImage } from './ocr-service.mjs';

const MAX_BYTES = 10 * 1024 * 1024;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function rectangleSpans(line, session, terms, policy) {
  const checked = session.protect(line.text || '', terms, policy);
  return checked.findings.filter(item => item.type && item.end > item.start);
}

function maskBoxes(lines, session, terms, policy) {
  const boxes = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const findings = rectangleSpans(line, session, terms, policy);
    if (!findings.length) continue;
    const words = Array.isArray(line.words) ? line.words : [];
    let cursor = 0;
    const positioned = words.map(word => {
      const text = String(word?.text || '');
      const start = Math.max(0, (line.text || '').indexOf(text, cursor));
      cursor = start >= 0 ? start + text.length : cursor + text.length + 1;
      return { ...word, start: start < 0 ? cursor : start, end: (start < 0 ? cursor : start) + text.length };
    });
    for (const finding of findings) {
      const selected = positioned.filter(word => word.end > finding.start && word.start < finding.end);
      if (!selected.length) continue;
      const x = Math.min(...selected.map(word => Number(word.x) || 0));
      const y = Math.min(...selected.map(word => Number(word.y) || 0));
      const right = Math.max(...selected.map(word => (Number(word.x) || 0) + (Number(word.width) || 0)));
      const bottom = Math.max(...selected.map(word => (Number(word.y) || 0) + (Number(word.height) || 0)));
      if (right > x && bottom > y) boxes.push({ x, y, width: right - x, height: bottom - y, type: finding.type });
    }
  }
  return boxes;
}

async function maskImage(bytes, width, height, boxes) {
  if (!boxes.length) return Buffer.from(bytes);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${boxes.map(box => `<rect x="${Math.max(0, box.x - 2)}" y="${Math.max(0, box.y - 2)}" width="${box.width + 4}" height="${box.height + 4}" fill="#111111"/>`).join('')}</svg>`;
  return sharp(bytes).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer();
}

function sourceMediaType(name) {
  const ext = path.extname(name).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
}

export async function prepareVisualAttachment({ root, name, bytes, privacyMode = 'redact', customTerms = [], privacyPolicy = {}, signal } = {}) {
  signal?.throwIfAborted();
  if (!root || !path.isAbsolute(root)) throw new Error('视觉附件存储位置无效。');
  if (!supportsOcrImage(name) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new Error('请选择 10 MB 以内的 PNG、JPEG、BMP 或 TIFF 图片。');
  const ocr = await recognizeImage(name, bytes, { signal, includeLayout: true });
  signal?.throwIfAborted();
  const policy = privacyPolicyForMode(privacyPolicy, privacyMode);
  const session = new PrivacySession(`visual-${randomUUID()}`);
  const textCheck = session.protect(ocr.text, customTerms, policy);
  if (textCheck.blocked) throw new Error('图片 OCR 结果包含被拦截的凭证或敏感值，未准备视觉附件。');
  const boxes = privacyMode === 'raw' ? [] : maskBoxes(ocr.layout?.lines, session, customTerms, policy);
  const sourceType = sourceMediaType(name);
  const preserveSource = privacyMode === 'raw' && (sourceType === 'image/png' || sourceType === 'image/jpeg') && !boxes.length;
  const maskedBytes = preserveSource ? Buffer.from(bytes) : await maskImage(bytes, ocr.layout?.width || 1, ocr.layout?.height || 1, boxes);
  signal?.throwIfAborted();
  const id = randomUUID();
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, `${id}.png`);
  await fs.writeFile(file, maskedBytes, { flag: 'wx' });
  return {
    id,
    visualId: id,
    name,
    mediaType: preserveSource ? sourceType : 'image/png',
    bytes: maskedBytes.length,
    sha256: digest(maskedBytes),
    originalSha256: digest(bytes),
    masked: privacyMode !== 'raw',
    privacyMode,
    maskCount: boxes.length,
    coverage: {
      ...ocr.coverage,
      kind: 'ocr-vision',
      masking: privacyMode === 'raw' ? 'raw' : 'recognized-sensitive-regions',
      maskCount: boxes.length,
      notice: privacyMode === 'raw'
        ? '已按非脱敏模式发送原图；凭证仍由主进程单独阻断。'
        : '模型收到本机生成的遮罩副本；遮罩仅覆盖 OCR 识别并命中本机规则的区域，未识别文字和图像语义仍需人工核对。',
    },
  };
}

export async function readVisualAttachment(root, visual, expectedPrivacyMode) {
  if (!root || !path.isAbsolute(root) || !visual || typeof visual.visualId !== 'string' || !/^[0-9a-f-]{36}$/i.test(visual.visualId)) throw new Error('视觉附件引用无效。');
  if (visual.privacyMode !== expectedPrivacyMode || typeof visual.sha256 !== 'string') throw new Error('视觉附件策略已变化，请重新添加图片。');
  const bytes = await fs.readFile(path.join(root, `${visual.visualId}.png`));
  if (digest(bytes) !== visual.sha256) throw new Error('视觉附件副本已变化，请重新添加图片。');
  return { ...visual, data: bytes.toString('base64'), mediaType: visual.mediaType || 'image/png' };
}

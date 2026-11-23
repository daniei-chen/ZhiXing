import fs from 'node:fs/promises';
import {Context} from '@deepseek-ai/cordis';
import {OfficeKit, OfficeSourceKey} from '@deepseek-ai/dsh-office-kit';

const maxInputBytes = 10 * 1024 * 1024;
const maxOutputBytes = 20 * 1024 * 1024;
const base64 = bytes => Buffer.from(bytes).toString('base64');
const sourceOf = (key, bytes) => ({
 key: OfficeSourceKey(key),
 version: '1',
 bytes: bytes.length,
 async read(signal, limit) {
  signal.throwIfAborted();
  if (bytes.length > limit) throw new Error('文件超过可处理的大小。');
  return {bytes, version: '1'};
 },
});

try {
 const [directory, options] = process.argv.slice(2);
 const {action, extension, page, format, sheet, pages, range, dpi, maxRenderImages} = JSON.parse(options);
 const chunks = [];
 let size = 0;
 for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > maxInputBytes) throw new Error('文件超过 10 MB。');
  chunks.push(chunk);
 }

 const context = new Context();
 const kit = new OfficeKit(context, OfficeKit.Config({
  outputDirectory: directory, maxInputBytes: maxOutputBytes, maxOutputBytes,
  maxSourceBytes: maxOutputBytes, maxCachedBytes: maxOutputBytes,
  maxUncompressedBytes: 100 * 1024 * 1024, timeoutMs: 35000,
 }));
 const source = sourceOf('document', Buffer.concat(chunks));
 let value;
 if (action === 'preview') {
  // Use print-layout pages for worksheets, with the same navigation as Word and slides.
  let preview = {extension, source};
  let missingFonts = [];
  if (['xls', 'xlsx', 'ods', 'odt', 'odp'].includes(extension)) {
   const result = await kit.convertTo({extension, source, format: 'pdf', output: {owner: 'preview', name: 'preview.pdf'}});
   missingFonts = result.missingFonts;
   preview = {extension: 'pdf', source: sourceOf('print-layout', await fs.readFile(result.path))};
  }
  const result = await kit.renderImages({
   ...preview, pages: [page], maxImages: 1, dpi: 125,
   maxPixels: 5000000, maxDimension: 3200, maxBytes: 4 * 1024 * 1024,
  });
  if (result.images.length !== 1) throw new Error('找不到这一页。');
  value = {page, pageCount: result.pageCount, missingFonts: [...new Set([...missingFonts, ...result.missingFonts])], png: base64(result.images[0].png)};
 } else if (action === 'render') {
  const {images, pageCount, dpi: resolution, missingFonts} = await kit.renderImages({
   extension, source, pages, sheet, range, dpi, maxImages: maxRenderImages,
   maxPixels: 5_000_000, maxDimension: 3200, maxBytes: 4 * 1024 * 1024,
  });
  value = {pageCount, dpi:resolution, missingFonts, images:images.map(({png, page, sheet, range}) => ({png:base64(png), page, sheet, range}))};
 } else {
  const request = {extension, source, format, output: {owner: 'export', name: `result.${format}`}};
  const result = action === 'recalculate' ? await kit.recalculate(request) : await kit.convertTo({...request, sheet});
  value = {missingFonts: result.missingFonts, pageCount: result.pageCount, bytes: base64(await fs.readFile(result.path))};
 }
 process.stdout.write(JSON.stringify({value}));
} catch (error) {
 const messages = {
  unavailable: '本机 Office 引擎未能启动。',
  'invalid-document': '本机 Office 引擎无法打开这个文件。',
  'invalid-request': '所选页码、工作表或输出格式无法处理。',
  'output-too-large': '生成结果超过大小或尺寸限制。',
  timeout: 'Office 处理超时，请尝试拆分文件。',
 };
 process.stdout.write(JSON.stringify({error: messages[error.code] || '本机 Office 处理失败。请检查文件是否受密码保护或已损坏。'}));
 process.exitCode = 1;
}

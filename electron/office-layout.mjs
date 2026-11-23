import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runDocumentWorker} from './document-service.mjs';
import {readWorkspaceBytes} from './workspace-files.mjs';
import {officeConversions, officeWorkbookFormats, officeRecalculationFormats} from './office-formats.mjs';
import {recognizeImage} from './ocr-service.mjs';

const outputLimit = 20 * 1024 * 1024;

export async function recognizeOfficePage(workspaceRoot,options){
 const result=await runOfficeLayout(workspaceRoot,{...options,action:'preview'});
 const file=await recognizeImage('page.png',Buffer.from(result.png,'base64'));
 return {...file,name:`${result.name} · 第 ${result.page} 页`,coverage:{...file.coverage,pages:1,page:result.page}};
}

export async function runOfficeLayout(workspaceRoot, input, {signal, maxRenderImages = 4} = {}) {
 signal?.throwIfAborted();
 const {action, page, format, sheet, pages, range, dpi} = input;
 const {name, bytes} = await readWorkspaceBytes(workspaceRoot, input.path);
 const extension = path.extname(name).slice(1).toLowerCase();
 const version = createHash('sha256').update(bytes).digest('hex');
 if(input.version!==undefined&&input.version!==version)throw new Error('文件已更新，请重新打开文件预览。');
 if (!Object.hasOwn(officeConversions, extension)) throw new Error('此文件格式不支持版面预览。');
 if (action === 'preview') {
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error('请输入有效的页码。');
 } else if (action === 'render') {
  const workbook = officeWorkbookFormats.includes(extension);
  if (!Number.isInteger(maxRenderImages) || maxRenderImages < 1 || maxRenderImages > 4) throw new Error('当前会话的视觉资料已达到上限。');
  if (pages !== undefined && (workbook || !Array.isArray(pages) || !pages.length || pages.length > maxRenderImages
   || pages.some(item => !Number.isSafeInteger(item) || item < 1 || item > 10000) || new Set(pages).size !== pages.length)) throw new Error('页码必须为不同的正整数，且不能超过当前可发送的图片数量。工作簿请选择工作表和区域。');
  if (sheet !== undefined && (!workbook || typeof sheet !== 'string' || !sheet.trim() || sheet.length > 100)) throw new Error('请输入工作簿中的准确工作表名称。');
  if (range !== undefined && (sheet === undefined || typeof range !== 'string' || !/^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?$/i.test(range))) throw new Error('指定区域时需要选择工作表并填写有效的 A1 区域。');
  if (dpi !== undefined && (!Number.isSafeInteger(dpi) || dpi < 24 || dpi > 600)) throw new Error('渲染分辨率应为 24 至 600 DPI 的整数。');
 } else if (action === 'convert') {
  if (!officeConversions[extension].includes(format)) throw new Error('此文件不支持选定的转换格式。');
  if (sheet !== undefined && (format !== 'csv' || typeof sheet !== 'string' || sheet.length > 100 || !sheet.trim())) throw new Error('工作表名称无效。');
 } else if (action === 'recalculate') {
  if (!officeWorkbookFormats.includes(extension) || !officeRecalculationFormats.includes(format)) throw new Error('请选择可重算的工作簿与输出格式。');
 } else {
  throw new Error('未知的 Office 操作。');
 }

 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-office-'));
 try {
  const result = await runDocumentWorker('office-layout-worker.mjs', [
   directory, JSON.stringify({action, extension, page, format, sheet, pages, range, dpi, maxRenderImages}),
  ], bytes, {signal, timeoutMs: 75000, maxBytes: Math.ceil(outputLimit * 4 / 3) + 16384});
  return {...result, name, version};
 } finally {
  await fs.rm(directory, {recursive: true, force: true, maxRetries: 4, retryDelay: 100});
 }
}

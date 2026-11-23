import {runOfficeLayout} from './office-layout.mjs';
import {prepareVisualAttachment,supportsVisualImage} from './visual-attachments.mjs';
import {readWorkspaceBytes} from './workspace-files.mjs';
import {containsCredentialValue} from '../src/privacy-recognizers.js';

export async function renderOfficeVision(workspaceRoot, {input, pages, sheet, range, dpi}, privacy, {signal, maxRenderImages}) {
 const result = await runOfficeLayout(workspaceRoot, {action:'render', path:input, pages, sheet, range, dpi}, {signal, maxRenderImages});
 if (!result.images.length || result.images.length > maxRenderImages) throw new Error('没有可发送的办公页面，请缩小页码或工作表范围。');
 const metadata = {path:input, missingFonts:result.missingFonts, sheets:result.images.map(image=>image.sheet)};
 if (privacy.secrets.some(secret=>containsCredentialValue(metadata,secret))) throw new Error('办公页面的元数据含已配置的凭证，已停止发送。');
 const images = [], records = [];
 for (const {png, page, sheet:worksheet, range:area} of result.images) {
  const {record, parsed} = await prepareVisualAttachment({name:'office-page.png', bytes:Buffer.from(png, 'base64'), privacy, signal});
  records.push(record);
  images.push({...(page === undefined ? {} : {page}), ...(worksheet === undefined ? {} : {sheet:worksheet}),
   ...(area === undefined ? {} : {range:area}), maskCount:parsed.visual.maskCount});
 }
 return {receipt:{operation:'render', path:input, pageCount:result.pageCount, dpi:result.dpi, missingFonts:result.missingFonts, images}, records};
}

export async function readProjectVision(workspaceRoot,input,privacy,signal){
 if(!supportsVisualImage(input))throw new Error('项目图片支持单帧 PNG 或 JPEG。');
 if(privacy.secrets.some(secret=>containsCredentialValue(input,secret)))throw new Error('图片路径含已配置的凭证，已停止发送。');
 const {name,bytes}=await readWorkspaceBytes(workspaceRoot,input);
 const outputMediaType=/\.png$/i.test(name)?'image/png':'image/jpeg';
 const {record}=await prepareVisualAttachment({name,bytes,privacy,signal,outputMediaType});
 return {records:[record]};
}

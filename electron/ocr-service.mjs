import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const imageExtensions=new Set(['.png','.jpg','.jpeg','.bmp','.tiff','.tif']);
export const supportsOcrImage=name=>typeof name==='string'&&imageExtensions.has(path.extname(name).toLowerCase());
const worker=fileURLToPath(new URL('./ocr-worker.ps1',import.meta.url));
const run=promisify(execFile);
let running=0;

export async function recognizeImage(name,bytes,{signal,includeLayout=false}={}){
 signal?.throwIfAborted();
 if(process.platform!=='win32')throw new Error('图片文字识别需要 Windows 桌面版。');
 if(!supportsOcrImage(name)||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10*1024*1024)throw new Error('请选择 10 MB 以内的 PNG、JPEG、BMP 或 TIFF 图片。');
 if(running>=2)throw new Error('本机文字识别正忙，请稍后重试。');
 running++;
 let directory;
 try{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-ocr-'));
  const image=path.join(directory,`image${path.extname(name).toLowerCase()}`);
  await fs.writeFile(image,bytes);
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATH'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  let result;
  try{
  const {stdout}=await run(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',worker,'-Image',image],{windowsHide:true,timeout:25000,maxBuffer:750000,env,signal});
   signal?.throwIfAborted();
   result=JSON.parse(stdout.replace(/^\uFEFF/,'').trim());
  }catch(error){
   if(error?.name==='AbortError'||error?.code==='ABORT_ERR')throw new Error('图片文字识别已取消。');
   throw new Error('Windows 文字识别未能启动或已超时。');
  }
  if(result.error==='no-language')throw new Error('请先在 Windows「语言和区域」中安装具有文字识别功能的语言。');
  if(result.error==='dimensions')throw new Error(`图片尺寸超过本机引擎上限（单边 ${result.max} 像素）。`);
  if(result.error||typeof result.text!=='string')throw new Error('本机文字识别无法处理此图片。');
  if(!result.text.trim())throw new Error('未在图片中识别到文字。');
  return {id:randomUUID(),name,size:bytes.length,status:'ready',text:result.text.slice(0,60000),coverage:{
   kind:'ocr-text',language:result.language,
   notice:'文字由本机 OCR 识别，可能出现错字或顺序变化。加入交办时仅使用识别出的文字。',
  },...(includeLayout?{layout:{width:result.width,height:result.height,lines:Array.isArray(result.lines)?result.lines:[]}}:{})};
 }finally{
  try{if(directory)await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
  finally{running--;}
 }
}

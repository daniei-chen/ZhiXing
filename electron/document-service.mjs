import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
let active=0;const waiting=[];
async function slot(signal){signal?.throwIfAborted();if(active<2){active++;return releaseSlot;}if(waiting.length>=12)throw new Error('等待读取的资料过多，请稍后重试。');return new Promise((resolve,reject)=>{const row={resolve,reject,signal};row.abort=()=>{const index=waiting.indexOf(row);if(index>=0)waiting.splice(index,1);reject(new Error('资料读取已取消。'));};signal?.addEventListener('abort',row.abort,{once:true});waiting.push(row);});}
function releaseSlot(){const next=waiting.shift();if(next){next.signal?.removeEventListener('abort',next.abort);next.resolve(releaseSlot);}else active--;}
export async function parseDocumentFile(name,buffer,{signal}={}){
 if(typeof name!=='string'||!Buffer.isBuffer(buffer)||buffer.length>10*1024*1024)throw new Error('文件参数无效或超过 10 MB。');
 const result=await runDocumentWorker('document-worker.mjs',[path.basename(name)],buffer,{signal,maxBytes:2*1024*1024,timeoutMs:45000});
 if(typeof result?.text!=='string'||result.text.length>220000)throw new Error('资料读取结果无效。');
 return result;
}
export async function runDocumentWorker(entry,args,buffer,{signal,maxBytes,timeoutMs}){
 const worker=fileURLToPath(new URL(entry,import.meta.url));
 const release=await slot(signal);
 try{return await new Promise((resolve,reject)=>{
  const exe=existsSync(path.join(root,'runtime','node.exe'))?path.join(root,'runtime','node.exe'):process.execPath;
  const env={ELECTRON_RUN_AS_NODE:'1'};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path'])if(process.env[key])env[key]=process.env[key];
  const child=spawn(exe,['--max-old-space-size=384',worker,...args],{cwd:root,env,stdio:['pipe','pipe','pipe'],windowsHide:true});let size=0,failure,ended=false;const output=[];
  const abort=()=>{failure=new Error('资料处理已取消。');child.kill();};signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{failure=new Error('本机处理超时，请尝试拆分文件。');child.kill();},timeoutMs);
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  child.stdout.on('data',chunk=>{if((size+=chunk.length)>maxBytes){failure=new Error('资料处理结果超过限制。');child.kill();return;}output.push(chunk);});child.stderr.resume();child.stdin.on('error',()=>{});
  child.once('error',()=>{if(ended)return;ended=true;cleanup();reject(new Error('本机资料读取服务未能启动。'));});
  child.once('close',code=>{if(ended)return;ended=true;cleanup();if(failure){reject(failure);return;}let result;try{result=JSON.parse(Buffer.concat(output).toString('utf8'));}catch{reject(new Error('资料读取进程意外结束，文件可能超出内存限制。'));return;}if(code!==0||result.error){reject(new Error(result.error||'资料读取失败。'));return;}resolve(result.value);});
  if(signal?.aborted)abort();else child.stdin.end(buffer);
 });}finally{release();}
}

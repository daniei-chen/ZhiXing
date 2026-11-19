import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
export class TerminalService{
 constructor({onEvent}){this.onEvent=onEvent;this.pending=new Map();this.worker=null;this.ready=null;this.closed=false;}
 start(){
  if(this.ready)return this.ready;if(this.closed)throw new Error('终端服务正在关闭。');
  const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC','PATHEXT'])if(process.env[key])env[key]=process.env[key];
  env.ELECTRON_RUN_AS_NODE='1';
  const worker=spawn(process.execPath,[fileURLToPath(new URL('./terminal-worker.mjs',import.meta.url))],{env,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});this.worker=worker;
  worker.stderr.resume();
  this.ready=new Promise((resolve,reject)=>{let ended=false;const timer=setTimeout(()=>{worker.kill();failed('终端服务启动超时。');},20000);worker.on('message',message=>{if(ended)return;if(message.event==='ready'){clearTimeout(timer);resolve();}else if(message.requestId){const waiting=this.pending.get(message.requestId);if(waiting){this.pending.delete(message.requestId);clearTimeout(waiting.timer);message.error?waiting.reject(new Error(message.error)):waiting.resolve(message.value);}}else this.onEvent?.(message);});
   const failed=(message='终端服务已退出。')=>{if(ended)return;ended=true;clearTimeout(timer);reject(new Error(message));if(this.worker!==worker)return;for(const waiting of this.pending.values()){clearTimeout(waiting.timer);waiting.reject(new Error('终端服务已退出。'));}this.pending.clear();this.ready=null;this.worker=null;if(!this.closed)this.onEvent?.({event:'unavailable'});};worker.once('error',()=>failed());worker.once('exit',()=>failed());
  });return this.ready;
 }
 async request(options){
  if(!options||typeof options.scope!=='string'||options.scope.length>180)throw new Error('终端所属范围无效。');
  if(!['create','list','write','resize','snapshot','close'].includes(options.action))throw new Error('终端操作无效。');
  if(options.action==='write'&&(typeof options.data!=='string'||Buffer.byteLength(options.data)>65536))throw new Error('单次终端输入过长。');
  if(['create','resize'].includes(options.action)&&(!Number.isInteger(options.cols)||!Number.isInteger(options.rows)||options.cols<10||options.cols>400||options.rows<3||options.rows>160))throw new Error('终端尺寸无效。');
  if(options.shell&&!['powershell','pwsh','cmd'].includes(options.shell))throw new Error('Shell 选择无效。');
  await this.start();const requestId=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('终端操作超时，请检查运行状态。'));},25000);this.pending.set(requestId,{resolve,reject,timer});const failed=error=>{if(!error)return;clearTimeout(timer);this.pending.delete(requestId);reject(new Error('终端连接已断开。'));};try{this.worker.send({...options,requestId},failed);}catch(error){failed(error);}});
 }
 async close(){this.closed=true;const worker=this.worker;if(!worker)return;await new Promise(resolve=>{const timer=setTimeout(()=>{worker.kill();resolve();},6000);worker.once('exit',()=>{clearTimeout(timer);resolve();});worker.send({action:'shutdown'});});}
}

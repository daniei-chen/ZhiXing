import {AsyncLocalStorage} from 'node:async_hooks';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {workspaceTarget, workspaceWriteTarget} from '../electron/workspace-files.mjs';

const require = createRequire(import.meta.url);
const harnessRequire = createRequire(require.resolve('@deepseek-ai/dsh/lib/bin.js'));
const fsPath=harnessRequire.resolve('@deepseek-ai/dsh-fs-local');
const fsRequire=createRequire(fsPath);
const {LocalFileSystem} = await import(pathToFileURL(fsPath).href);
const {FsError}=await import(pathToFileURL(fsRequire.resolve('@deepseek-ai/dsh-fs')).href);
const {parsePatch,applyHunks}=await import(pathToFileURL(fsRequire.resolve('@deepseek-ai/dsh-fs-patch')).href);
const scope = new AsyncLocalStorage();

export const NATIVE_PROJECT_SEARCH_TOOLS = ['glob','grep'];
export const NATIVE_PROJECT_FILE_TOOLS = ['read','read_image','write','edit','apply_patch',...NATIVE_PROJECT_SEARCH_TOOLS];
const MAX_WRITE_BYTES = 1024 * 1024;

export function installNativeProjectFilePolicy(ctx, {root, restoreValue, permit, protectedValue}) {
 ctx.on('tools/execute', (exec, next) => {
  if (!NATIVE_PROJECT_FILE_TOOLS.includes(exec.name)) return next();
  return scope.run({root, restoreValue, protectedValue, exec, permit, patchTargets:null}, next);
 });
 ctx.on('tools/post-execute', async (exec, result, next) => {
  const decision = await next();
  if (!NATIVE_PROJECT_FILE_TOOLS.includes(exec.name) || decision.kind !== 'accept') return decision;
  const block = (text, info) => ({kind:'block', feedback:[{type:'text', text}], ...(info ? {info} : {})});
  try {
   if (result.isError) {
    const code = result.error.info?.code;
    const info = /^(?:FS|PATCH|SEARCH)_[A-Z_]+$/.test(code) ? {name:code.startsWith('SEARCH')?'SearchError':'FsError', code} : undefined;
    return block(await protectedValue(result.error.message), info);
   }
   const value = decision.value ?? result.value;
   if (NATIVE_PROJECT_SEARCH_TOOLS.includes(exec.name)) return decision;
   if (exec.name === 'read_image') {
    const file=await protectedValue(value.path);
    const name=value.image.mediaType==='image/jpeg'?'project-image.jpg':'project-image.png';
    return {kind:'accept',value:{path:file,image:{...value.image,name}}};
   }
   if (exec.name === 'read') {
    const [file,...lines] = await protectedValue([value.path,...value.lines.map(line=>line.text)]);
    return {kind:'accept', value:{...value,path:file,lines:value.lines.map((line,index)=>({...line,text:lines[index]}))}};
   }
   if (exec.name === 'apply_patch') return {kind:'accept',value:await protectPatchResult(value,protectedValue)};
   const [file,before,after] = await protectedValue([value.path,value.before,value.after]);
   return {kind:'accept', value:{...value,path:file,before,after}};
  } catch {
   return block('文件结果含受保护信息，已停止向模型返回。');
  }
 });
}

export async function prepareNativeImage(file){
 const current=scope.getStore();
 if(!current)throw new Error('只能在当前 Windows 项目交办中读取图片。');
 const spelling=await current.restoreValue(file);
 if(!/\.(?:png|jpe?g|webp|gif)$/i.test(spelling))throw new Error('项目图片支持单帧 PNG、JPEG、WebP 或 GIF。');
 await current.protectedValue(spelling);
 return spelling;
}

export async function prepareNativeSearch(args,exec){
 const current=scope.getStore();
 if(!current)throw new Error('只能在当前项目中搜索。');
 if(args.pattern.length>2000||args.include?.length>1000||args.pattern.includes('\0')||args.include?.includes('\0'))throw new Error('搜索式超出支持范围。');
 if(/⟦ZX-/.test(args.pattern)||/⟦ZX-/.test(args.include||''))throw new Error('请使用普通文本或通配符搜索，敏感占位符可用于已知文件路径。');
 const selected=args.path===undefined?'.':await current.restoreValue(args.path);
 const {target}=await workspaceTarget(current.root,selected);
 const info=await fs.stat(target);
 if(!info.isDirectory()&&(exec.name==='glob'||!info.isFile()||info.nlink!==1))throw new Error('请选择项目中的搜索目录或普通文本文件。');
 await current.protectedValue([selected,args.pattern,args.include??null]);
 return {...args,path:target};
}

export async function protectNativeSearch(value,exec){
 const current=scope.getStore();
 const checked=new Map();
 async function visible(file){
  if(checked.has(file))return checked.get(file);
  exec.signal.throwIfAborted();
  let result;
  try {
   const resolved=await workspaceTarget(current.root,file);
   const stat=await fs.lstat(resolved.target);
   if(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1)result=resolved.relative;
  } catch { /* Results may disappear or move while the search is running. */ }
  checked.set(file,result);
  return result;
 }
 if(exec.name==='glob'){
  const paths=[];
  for(const file of value.paths){const allowed=await visible(file);if(allowed!==undefined)paths.push(allowed);}
  const [root,...masked]=await current.protectedValue([value.root,...paths]);
  return {root,paths:masked};
 }
 const matches=[];
 for(const row of value.matches){const allowed=await visible(row.path);if(allowed!==undefined)matches.push({...row,path:allowed});}
 const payload=await current.protectedValue(matches.map(({path,line})=>[path,line]));
 return {matches:matches.map(({lineNumber},index)=>({path:payload[index][0],line:payload[index][1],lineNumber}))};
}

async function protectPatchResult(value,protect) {
 const operations=[];
 for (const operation of value.operations) {
  const [file,destination,message]=await protect([operation.path,operation.destination??null,operation.message??null]);
  const changes=[];
  for (const change of operation.changes??[]) {
   const [file,before,after]=await protect([change.path,change.before,change.after]);
   changes.push({path:file,before,after});
  }
  operations.push({...operation,path:file,...(destination===null?{}:{destination}),...(message===null?{}:{message}),
   ...(operation.changes===undefined?{}:{changes})});
 }
 return {...value,operations,affectedPaths:await protect(value.affectedPaths)};
}

async function projectTarget(root, file) {
 try {
  const location = await workspaceWriteTarget(root, file);
  const stat = await fs.lstat(location.target).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw new Error('请选择项目内的普通文件。');
  return {...location, exists:stat !== null, size:stat?.size, fileDevice:stat?.dev, fileInode:stat?.ino};
 } catch (error) {
  if (/^E[A-Z0-9]+$/.test(error.code)) throw new Error('无法访问该项目文件，请核对目录和权限。');
  throw error;
 }
}

async function approveMutation(policy, target, operation, inspectCurrent) {
 const {root, permit, exec} = policy;
 const initial = await projectTarget(root, target.displayPath);
 if (initial.target !== target.targetKey) throw new Error('项目文件位置已变化，请重新操作。');
 if (initial.exists && initial.size >= MAX_WRITE_BYTES) throw new Error('原生文本编辑支持小于 1 MiB 的文件。');
 await permit(exec, initial, operation);
 exec.signal.throwIfAborted();
 const approved = await projectTarget(root, target.displayPath);
 if (!sameLocation(initial,approved)) {
  throw new Error('项目文件位置已变化，请重新操作。');
 }
 if (approved.exists) await inspectCurrent();
 if (!sameLocation(approved,await projectTarget(root,target.displayPath))) throw new Error('项目文件位置已变化，请重新操作。');
 exec.signal.throwIfAborted();
}

function sameLocation(left,right) {
 return ['target','device','inode','exists','fileDevice','fileInode'].every(key=>left[key]===right[key]);
}

function patchShape(operations) {
 return operations.map(operation=>[operation.kind,operation.lineNumber,Boolean(operation.moveTo),
  operation.hunks?.map(hunk=>[hunk.lineNumber,hunk.oldLines.length,hunk.newLines.length,hunk.isEndOfFile])]);
}

function patchFailure(message,code='FS_PERMISSION_DENIED') {return new FsError(message,code);}

export async function prepareNativePatch(input) {
 const current=scope.getStore();
 if(!current)throw patchFailure('原生补丁须在当前项目交办中执行。');
 const {root,restoreValue,protectedValue,permit,exec}=current;
 if(Buffer.byteLength(input)>128*1024)throw patchFailure('补丁文本超过 128 KiB。','FS_TOO_LARGE');
 let original;
 try{original=parsePatch(input);}catch{return input;}
 if(!original.length||original.length>8)throw patchFailure('一次补丁须包含 1 至 8 个文件操作。');
 const normalized=input.replaceAll('\r\n','\n');
 const restored=await restoreValue(normalized);
 if(restored.includes('\r')||restored.split('\n').length!==normalized.split('\n').length)throw patchFailure('占位符还原后改变了补丁结构。');
 let operations;
 try{operations=parsePatch(restored);}catch{throw patchFailure('占位符还原后改变了补丁结构。');}
 if(JSON.stringify(patchShape(original))!==JSON.stringify(patchShape(operations)))throw patchFailure('占位符还原后改变了补丁结构。');
 await protectedValue(restored);
 const targets=new Map();
 const labels=[];
 for(const operation of operations){
  for(const file of [operation.path,operation.moveTo].filter(Boolean)){
   const location=await projectTarget(root,path.resolve(root,file));
   const key=targetKey(location.target);
   if(targets.has(key))throw patchFailure('同一次补丁不能对同一文件执行两次操作。');
   targets.set(key,location);
  }
  const action={add:'写入',update:'更新',delete:'删除'}[operation.kind];
  labels.push(operation.moveTo?`移动 ${operation.path} → ${operation.moveTo}`:`${action} ${operation.path}`);
 }
 const existing=[...targets.values()].some(target=>target.exists);
 const description=labels.join('\n');
 if(description.length>9000)throw patchFailure('补丁文件路径总长超过审批上限。');
 await permit(exec,{target:description,inside:true,write:true,exists:existing||operations.some(operation=>operation.kind!=='add')},'应用项目文件补丁');
 for(const approved of targets.values()){
  const latest=await projectTarget(root,approved.target);
  if(!sameLocation(approved,latest))throw patchFailure('补丁目标位置已变化，请重新操作。','FS_STALE_VERSION');
 }
 exec.signal.throwIfAborted();
 current.patchTargets=targets;
 return restored;
}

function targetKey(value){return process.platform==='win32'?value.toLowerCase():value;}

export default class NativeProjectFileSystem extends LocalFileSystem {
 async resolve(value, options) {
  const current = scope.getStore();
  if (!current) return super.resolve(value, options);
  const file = await current.restoreValue(value);
  const candidate = path.resolve(current.root, file);
  // The upstream tool probes its working directory before resolving the file.
  if (candidate === path.resolve(current.root)) {
   const {root} = await workspaceTarget(current.root);
   return super.resolve(root, options);
  }
  const {target} = await projectTarget(current.root, candidate);
  const resolved = await super.resolve(candidate, options);
  if (resolved.targetKey !== target) throw new Error('项目文件位置已变化，请重新操作。');
  return resolved;
 }

 async checkReadTarget(target) {
  const current=scope.getStore();
  if (!current) return;
  const file=await projectTarget(current.root,target.displayPath);
  if (!file.exists||file.target!==target.targetKey) throw new Error('项目文件位置已变化，请重新操作。');
 }

 async readText(target,signal) {
  await this.checkReadTarget(target);
  return super.readText(target,signal);
 }

 async streamText(target,signal) {
  await this.checkReadTarget(target);
  const stream=await super.streamText(target,signal);
  if (!scope.getStore()) return stream;
  const verify=()=>this.checkReadTarget(target);
  return (async function*(){await verify();yield* stream;})();
 }

 async readBytes(target,signal,maxBytes) {
  const current=scope.getStore();
  if(current?.exec.name!=='read_image')return super.readBytes(target,signal,maxBytes);
  const {ZHIXING_OFFICE_VISION_URL:url,ZHIXING_OFFICE_VISION_TOKEN:token}=process.env;
  if(!url||!token)throw new Error('当前会话缺少本机视觉处理服务。');
  await this.checkReadTarget(target);
  const response=await fetch(url,{method:'POST',redirect:'error',signal,
   headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({operation:'read-image',input:target.targetKey})});
  const body=await response.json();
  if(!response.ok)throw new Error(body.error||'未能准备项目图片。');
  const bytes=Buffer.from(body.value.records[0].data,'base64');
  if(bytes.length>maxBytes)throw new Error('视觉副本超过当前模型的大小上限。');
  return bytes;
 }

 async writeText(target, content, intent, signal) {
  const current = scope.getStore();
  if (!current) return super.writeText(target, content, intent, signal);
  if (current.patchTargets) {
   await this.checkPatchMutation(target,signal);
   await current.protectedValue(content);
   return super.writeText(target,content,intent,signal);
  }
  const restored = await current.restoreValue(content);
  if (Buffer.byteLength(restored, 'utf8') >= MAX_WRITE_BYTES) throw new Error('原生文本写入支持小于 1 MiB 的正文。');
  await current.protectedValue(restored);
  await approveMutation(current, target, '写入项目文本文件', ()=>this.inspectMutation(current,target,signal));
  return super.writeText(target, restored, intent, signal);
 }

 async editText(target, edit, expected, signal) {
  const current = scope.getStore();
  if (!current) return super.editText(target, edit, expected, signal);
  const oldString = await current.restoreValue(edit.oldString);
  const newString = await current.restoreValue(edit.newString);
  if (Buffer.byteLength(newString, 'utf8') >= MAX_WRITE_BYTES) throw new Error('原生文本编辑支持小于 1 MiB 的替换内容。');
  await current.protectedValue({oldString,newString});
  await approveMutation(current, target, '编辑项目文本文件', async()=>{
   const before=await this.inspectMutation(current,target,signal);
   const old=oldString.replaceAll('\r\n','\n');
   const replacement=newString.replaceAll('\r\n','\n');
   if (!old) return;
   const growth=Buffer.byteLength(replacement.replaceAll('\n','\r\n'))-Buffer.byteLength(old);
   if (growth<=0) return;
   let matches=0;
   const normalized=before.replaceAll('\r\n','\n');
   for (let offset=0;;){
    const match=normalized.indexOf(old,offset);
    if (match<0) break;
    matches++;
    if (!edit.replaceAll) break;
    offset=match+old.length;
   }
   if (Buffer.byteLength(before)+matches*growth>=MAX_WRITE_BYTES) throw new Error('编辑后的文本将超过 1 MiB。');
  });
  return super.editText(target, {...edit,oldString,newString}, expected, signal);
 }

 async inspectMutation(current, target, signal) {
  const snapshot=await super.readBytes(target,signal,MAX_WRITE_BYTES-1);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(snapshot);
  await current.protectedValue(text);
  return text;
 }

 async checkPatchMutation(target,signal,hunks) {
  const current=scope.getStore();
  if(!current?.patchTargets)return;
  const approved=current.patchTargets.get(targetKey(target.targetKey));
  const validate=async()=>{
   if(!approved||!sameLocation(approved,await projectTarget(current.root,target.displayPath)))throw patchFailure('补丁目标位置已变化，请重新操作。','FS_STALE_VERSION');
  };
  await validate();
  if(approved.exists){
   try {
    const before=await this.inspectMutation(current,target,signal);
    if(hunks){
     const result=applyHunks(before.replaceAll('\r\n','\n'),hunks);
     if(result.ok){
      if(Buffer.byteLength(result.after.replaceAll('\n','\r\n'))>=MAX_WRITE_BYTES)throw patchFailure('补丁结果超过 1 MiB。','FS_TOO_LARGE');
      await current.protectedValue(result.after);
     }
    }
   } catch(error) {
    if(error instanceof FsError)throw error;
    throw patchFailure('补丁目标含受保护信息或不是 UTF-8 文本。');
   }
  }
  await validate();
  signal?.throwIfAborted();
 }

 async patchText(target,hunks,expected,signal) {
  await this.checkPatchMutation(target,signal,hunks);
  return super.patchText(target,hunks,expected,signal);
 }

 async deleteFile(target,expected,signal) {
  await this.checkPatchMutation(target,signal);
  return super.deleteFile(target,expected,signal);
 }

 async moveFile(target,destination,options,signal) {
  await this.checkPatchMutation(target,signal,options.hunks);
  await this.checkPatchMutation(destination,signal);
  return super.moveFile(target,destination,options,signal);
 }
}

export const Config = LocalFileSystem.Config;

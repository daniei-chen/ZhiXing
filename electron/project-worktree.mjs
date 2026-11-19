import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createBridgeKey,readBridge} from '../harness/privacy-bridge.mjs';
import {makeHarness} from './runtime.mjs';

const branchName=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/;
const reservedName=/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const pool=['.agents','worktrees'];

export async function runProjectWorktree(dataRoot,workspaceRoot,{name,record},signal=AbortSignal.timeout(90000)){
 if(!workspaceRoot)throw new Error('请先在项目设置中选择 Git 仓库根目录。');
 const branch=record?.branch??name;
 if(typeof branch!=='string'||!branchName.test(branch)||reservedName.test(branch))throw new Error('分支名称需以字母或数字开头，最多 60 个字符，可使用连字符和下划线。');
 const root=await fs.realpath(workspaceRoot);
 for(const parts of [['.git'],pool.slice(0,1),pool]){
  const stat=await fs.lstat(path.join(root,...parts)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(parts[0]==='.git'&&!stat?.isDirectory())throw new Error('请选择主 Git 仓库根目录，并先建立至少一个提交。');
  if(stat&&(stat.isSymbolicLink()||!stat.isDirectory()))throw new Error('Git 管理目录和工作树目录必须是项目内的本机文件夹。');
 }
 const destination=path.join(root,...pool,branch);
 if(record&&(path.relative(root,record.repositoryRoot)!==''||path.relative(destination,record.path)!==''||!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(record.baseCommit)))throw new Error('原工作树与这个 Git 仓库不匹配。');
 await fs.mkdir(dataRoot,{recursive:true});
 const directory=await fs.mkdtemp(path.join(dataRoot,'temporary-worktree-'));
 const key=createBridgeKey();
 const file=path.join(directory,'worktree.bin');
 let harness;
 try{
  harness=await makeHarness(directory,{workspaceRoot:root,permission:'ask',bridgeKey:key,allowNetwork:false,baseUrl:'http://127.0.0.1:1',projectWorktree:{file,key,request:record?{record}:{name:branch}}},'zhixing-worktree-local');
  await harness.session('local-worktree').getWorkingDirectory();
  const deadline=Date.now()+3500;
  let bridge;
  while(!bridge&&Date.now()<deadline){
   signal.throwIfAborted();
   bridge=await readBridge(file,key).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(!bridge)await delay(35,undefined,{signal});
  }
  if(!bridge||!/^http:\/\/127\.0\.0\.1:\d{1,5}\/worktree$/.test(bridge.url))throw new Error('DeepSeek Harness 的本机工作树服务未启动。');
  const response=await fetch(bridge.url,{method:'POST',headers:{authorization:`Bearer ${bridge.token}`},body:'{}',signal,redirect:'error'});
  const {value,error}=await response.json();
  if(!response.ok){
   if(/windows-acl workspace grant failed/i.test(error||''))throw new Error('Windows 拒绝为此目录设置 Harness 沙箱权限。请选择当前用户有权管理 ACL 的 Git 仓库目录。');
   throw new Error(error||'内核未能完成 Git 工作树操作。');
  }
  if(typeof value?.path!=='string'||path.relative(destination,await fs.realpath(value.path))!=='')throw new Error('内核返回的工作树目录与项目范围不符。');
  return record?{...record,branchRecreated:value.branchRecreated}:value;
 }finally{
  try{await harness?.close();}finally{
   if(path.dirname(directory)===path.resolve(dataRoot)&&path.basename(directory).startsWith('temporary-worktree-'))await fs.rm(directory,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
 }
}

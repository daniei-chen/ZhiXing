import fs from 'node:fs/promises';
import path from 'node:path';
import {within} from '../harness/file-policy.mjs';
import {parseLocalMaterial} from './office-files.mjs';
const PRIVATE_DIRECTORIES=new Set(['.ssh','.aws','.azure','node_modules','vaults','.git']);
const PRIVATE_FILES=['.env','.env.*','*.pem','*.key','*.pfx','deepseek.credential','workspace.bin','automations.bin','privacy-bridge.bin'];
const PRIVATE_FILE=/^(?:\.env(?:\..*)?|.*\.(?:pem|key|pfx)|deepseek\.credential|workspace\.bin|automations\.bin|privacy-bridge\.bin)$/i;
const PRIVATE={test:value=>value.split(/[\\/]/).some(part=>PRIVATE_DIRECTORIES.has(part.toLowerCase())||PRIVATE_FILE.test(part))};
export const privateSearchGlobs=[...PRIVATE_DIRECTORIES,...PRIVATE_FILES].flatMap(name=>[`--iglob=!**/${name}`,`--iglob=!**/${name}/**`]);
const allowedWorkspacePath = (root, target) => {
 const relative = path.relative(root, target);
 return within(root, target) && !PRIVATE.test(relative) && !relative.includes(':');
};
export async function workspaceTarget(root,input=''){
 if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('请先在项目设置中选择工作区。');
 if(typeof input!=='string'||input.length>1500||input.includes('\0'))throw new Error('路径无效。');
 const canonical=await fs.realpath(root),requested=path.resolve(canonical,input);
 if(!allowedWorkspacePath(canonical,requested))throw new Error('此路径不在可浏览的项目范围内。');
 const target=await fs.realpath(requested);
 if(!allowedWorkspacePath(canonical,target))throw new Error('此路径不在可浏览的项目范围内。');
 return {root:canonical,target,relative:path.relative(canonical,target)};
}

export async function workspaceWriteTarget(root, input) {
 if (typeof input !== 'string' || !input.trim() || input.length > 1024 || input.includes('\0')) throw new Error('保存路径无效。');
 const name = path.basename(input);
 if (process.platform === 'win32' && (/[<>:"|?*\x00-\x1f]|[. ]$/.test(name)
  || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/i.test(name))) throw new Error('保存文件名无效。');
 const {root: canonical, target: parent} = await workspaceTarget(root, path.dirname(input));
 const target = path.join(parent, name);
 if (target === parent || !allowedWorkspacePath(canonical, target)) throw new Error('保存路径不在可写入的项目范围内。');
 const identity = await fs.stat(parent);
 if (!identity.isDirectory()) throw new Error('请选择项目中已存在的保存目录。');
 return {target, inside: true, write: true, exists: false, device: identity.dev, inode: identity.ino};
}
export async function listWorkspaceFiles(root,input=''){
 const resolved=await workspaceTarget(root,input);const entries=await fs.readdir(resolved.target,{withFileTypes:true});
 const items=entries.filter(item=>!item.isSymbolicLink()&&!PRIVATE.test(item.name)).map(item=>({name:item.name,path:path.join(resolved.relative,item.name),kind:item.isDirectory()?'directory':'file'})).sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name,'zh-CN'):a.kind==='directory'?-1:1);
 return {...resolved,items:items.slice(0,600),truncated:items.length>600};
}
export async function readWorkspaceBytes(root,input){
 const resolved = await workspaceTarget(root,input);
 const handle = await fs.open(resolved.target,'r');
 try {
  const before = await handle.stat();
  if (!before.isFile() || before.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的普通文件。');
  const current = await workspaceTarget(root,input);
  const stat = await fs.stat(current.target);
  if (current.target !== resolved.target || before.dev !== stat.dev || before.ino !== stat.ino) throw new Error('文件正在变更，请重试。');
  const buffer = Buffer.alloc(before.size + 1);
  let read = 0;
  while (read < buffer.length) {
   const {bytesRead} = await handle.read(buffer,read,buffer.length-read,read);
   if (!bytesRead) break;
   read += bytesRead;
  }
  const after = await handle.stat();
  if (read !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('文件正在变更，请重试。');
  return {name:path.basename(resolved.target),path:resolved.relative,bytes:buffer.subarray(0,read)};
 } finally {
  await handle.close();
 }
}
export async function readWorkspaceFile(root,input){
 const {name,path:relative,bytes} = await readWorkspaceBytes(root,input);
 return {...await parseLocalMaterial(name,bytes),path:relative};
}

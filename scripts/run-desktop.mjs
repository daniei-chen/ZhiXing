import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const {editWindowsResources}=require('app-builder-lib/out/util/resEdit.js');
const electronDir=path.dirname(require('electron'));
const executable=path.join(electronDir,process.platform==='win32'?'知行.exe':'electron');
if(process.platform==='win32'){
 const iconPath=path.join(root,'public','brand','zhixing.ico'),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 const fingerprint=createHash('sha256').update(await fs.readFile(iconPath)).update(JSON.stringify({electron:require('electron/package.json').version,app:pkg.version})).digest('hex');
 const stamp=path.join(electronDir,'zhixing-brand.json');
 if(await fs.readFile(stamp,'utf8').catch(()=>null)!==fingerprint||!await fs.stat(executable).catch(()=>null)){
  const temporary=path.join(electronDir,'zhixing-brand.tmp.exe');
  await fs.copyFile(require('electron'),temporary);
  await editWindowsResources({file:temporary,iconPath,fileVersion:pkg.version,productVersion:pkg.version,versionStrings:{FileDescription:'知行 · AI 办公助手',ProductName:'知行',InternalName:'知行',OriginalFilename:'知行.exe'}});
  const previous=path.join(electronDir,`zhixing-previous-${Date.now()}.exe`);let moved=false;
  try{await fs.rename(executable,previous);moved=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  try{await fs.rename(temporary,executable);}catch(error){if(moved)await fs.rename(previous,executable);throw error;}
  if(moved)await fs.unlink(previous).catch(()=>{});
  await fs.writeFile(stamp,fingerprint);
 }
}
if(process.argv.includes('--prepare-only')){console.log(executable);process.exit(0);}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,[path.join(root,'electron','main.cjs'),...process.argv.slice(2)],{cwd:root,env,windowsHide:true,stdio:'inherit'});
const [code]=await once(child,'exit');process.exitCode=code??1;

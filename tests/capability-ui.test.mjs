import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createCapabilityManifest} from '../harness/capability-manifest.mjs';
const require=createRequire(import.meta.url),repository=path.resolve(import.meta.dirname,'..');

test('Windows 内核设置能力状态：真实层级文案、检查失败清空旧结果、配置变化拒绝迟到目录',{timeout:60000},async context=>{
 assert.equal(process.platform,'win32');
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'zhixing-capability-ui-'));
 let child,exited;
 try{
  const manifest=createCapabilityManifest({tools:['web_search','web_fetch'],protocol:'openai',permission:'ask',kernel:{ptcEnabled:true}});
  const report={tools:[{name:'web_search',description:'Synthetic search'}],skills:[],capabilities:[],capabilityManifest:manifest,inspection:{selectedRoute:true,projectBound:false,externalConnections:false}};
  const renderer=await build({stdin:{resolveDir:repository,loader:'jsx',contents:`import{createElement,useState}from'react';import{createRoot}from'react-dom/client';import KernelSettings from'./src/KernelSettings.jsx';function Fixture(){const[runtime,setRuntime]=useState({kernel:{},version:'Synthetic Harness'});const[scope,setScope]=useState({providerId:'synthetic-A',modelId:'same-model',reasoning:'high',workspaceId:'office-home',projectId:null,permission:'ask'});window.capabilityQA.setScope=setScope;window.capabilityQA.setRuntime=setRuntime;return createElement(KernelSettings,{runtime,setRuntime,inspectionScope:scope});}window.capabilityQA={};createRoot(document.getElementById('root')).render(createElement(Fixture));`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"test"'},logLevel:'silent'});
  await writeFile(path.join(directory,'renderer.js'),renderer.outputFiles[0].text);
  await writeFile(path.join(directory,'index.html'),'<!doctype html><html><body><div id="root"></div></body></html>');
  await writeFile(path.join(directory,'preload.cjs'),`const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('zhixing',{inspectKernel:options=>ipcRenderer.invoke('inspect',options)});`);
  await writeFile(path.join(directory,'main.cjs'),`
   const{app,BrowserWindow,ipcMain}=require('electron');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
   app.setPath('userData',path.join(__dirname,'profile'));let window,mode='success',pending;const calls=[],report=${JSON.stringify(report)};
   ipcMain.handle('inspect',async(_,options)=>{calls.push(options);if(mode==='failure')throw new Error('SYNTHETIC_CHECK_FAILED');if(mode==='pending')return new Promise(resolve=>{pending=resolve;});return report;});
   const run=source=>window.webContents.executeJavaScript(source);
   const wait=async(expression)=>{const end=Date.now()+10000;while(Date.now()<end){if(await run(expression))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Timeout '+expression+' '+await run('document.body.innerText'));};
   const check=()=>run('[...document.querySelectorAll("button")].find(node=>node.textContent==="检查工具目录").click()');
   app.whenReady().then(async()=>{window=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});try{
    await window.loadFile(path.join(__dirname,'index.html'));await run(await fs.readFile(path.join(__dirname,'renderer.js'),'utf8'));await wait('!!document.querySelector("button")');
    await check();await wait('!!document.querySelector("[aria-label=实际能力状态]")');
    assert.equal(calls[0].providerId,'synthetic-A');assert.equal(calls[0].modelId,'same-model');assert.equal(calls[0].reasoning,'high');
    assert.equal(await run('document.querySelector("[data-capability=web-search]").dataset.effective'),'false');
    assert.match(await run('document.querySelector("[data-capability=web-search]").textContent'),/当前协议未接入/);
    assert.match(await run('document.querySelector("[data-capability=ptc]").textContent'),/需要关联项目/);
    assert.match(await run('document.querySelector("[data-capability=vision-input]").textContent'),/模型视觉输入与本机遮罩副本/);
    assert.match(await run('document.body.innerText'),/可调度不代表执行验收通过/);
    mode='failure';await check();await wait('document.body.innerText.includes("SYNTHETIC_CHECK_FAILED")');assert.equal(await run('!!document.querySelector("[aria-label=实际能力状态]")'),false);
    mode='pending';await check();await wait('document.querySelector("button.primary-button").disabled');
    await run('window.capabilityQA.setScope({providerId:"synthetic-B",modelId:"same-model",reasoning:"max",workspaceId:"office-home",projectId:null,permission:"ask"})');
    await new Promise(resolve=>setImmediate(resolve));await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');pending(report);await wait('!document.querySelector("button.primary-button").disabled');assert.equal(await run('!!document.querySelector("[aria-label=实际能力状态]")'),false);
    mode='success';await check();await wait('!!document.querySelector("[aria-label=实际能力状态]")');assert.equal(calls.at(-1).providerId,'synthetic-B');assert.equal(calls.at(-1).reasoning,'max');
    await run('window.capabilityQA.setRuntime({kernel:{webEnabled:false}})');await wait('!document.querySelector("[aria-label=实际能力状态]")');
    console.log(JSON.stringify({result:'PASS capability renderer',checks:7,inspectionCalls:calls.length,layer:'Windows Electron renderer with synthetic IPC; not final installer/cloud'}));
   }finally{window.destroy();}app.quit();}).catch(error=>{console.error(error.stack);app.exit(1);});
  `);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(require('electron'),[path.join(directory,'main.cjs')],{env,signal:context.signal,windowsHide:true,stdio:['ignore','pipe','pipe']});exited=once(child,'exit');let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  const [code]=await exited;assert.equal(code,0,output);assert.match(output,/PASS capability renderer/);console.log(output.trim());
 }finally{if(child&&child.exitCode===null){child.kill();await exited;}const resolved=await realpath(directory);assert.equal(path.dirname(resolved),parent);assert(path.basename(resolved).startsWith('zhixing-capability-ui-'));await rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:150});}
});

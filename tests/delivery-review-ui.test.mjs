import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),repository=path.resolve(import.meta.dirname,'..');
test('R02 真实 Windows renderer：主机快照、四路径文件字节、失效/错误恢复与 demo 范围', {timeout:45000}, async context=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'zhixing-delivery-review-'));let child,exited;
 try {
  await mkdir(path.join(directory,'profile'));
  const built=await build({stdin:{resolveDir:repository,loader:'jsx',contents:`
   import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{ExportReview,PrivacyReview}from'./src/Review.jsx';
   const root=createRoot(document.getElementById('root')),calls=[];let props,mount=0;
   const defaults={title:'合成验收',original:'电话13800000000，普通资料。',masked:'旧masked不得代替当前正文',terms:[],policy:{secretPrefixes:['zxcorp_']},privacyMode:'raw',desktop:window.deliveryBridge,onClose(){},onExport:async binding=>{calls.push(binding);return binding.demo?{}:window.deliveryBridge.execute(binding,props.action||'export');}};
   window.deliveryQA={calls,open(value={}){props={...defaults,...value};mount++;flushSync(()=>root.render(<ExportReview key={mount} {...props}/>));},update(value){props={...props,...value};flushSync(()=>root.render(<ExportReview key={mount} {...props}/>));},recipient(){flushSync(()=>root.render(<PrivacyReview modal={{type:'privacy',output:'zxcorp_ABCDEF1234567890'}} original='普通正文' terms={[]} policy={{secretPrefixes:['zxcorp_']}} currentMode='raw' onClose={()=>{}}/>));}};
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},logLevel:'silent'});
  await writeFile(path.join(directory,'renderer.js'),built.outputFiles[0].text);
  await writeFile(path.join(directory,'preload.cjs'),`const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('deliveryBridge',{prepareDelivery:value=>ipcRenderer.invoke('delivery:prepare',value),execute:(value,action)=>ipcRenderer.invoke('delivery:execute',value,action)});`);
  const main=`
   const{app,BrowserWindow,ipcMain}=require('electron');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
   app.setPath('userData',path.join(__dirname,'profile'));
   app.whenReady().then(async()=>{
    const{DeliveryService}=await import(${JSON.stringify(pathToFileURL(path.join(repository,'electron/delivery-service.mjs')).href)});
    const{exportOfficeFile,parseOfficeFile}=await import(${JSON.stringify(pathToFileURL(path.join(repository,'electron/office-files.mjs')).href)});
    let settings={privacyMode:'raw',privacyPolicy:{secretPrefixes:['zxcorp_']},customTerms:[]},failPrepare=false,failExecute=false,hold=false;
    const requests=[],pending=[],outputs=[];const service=new DeliveryService({getSettings:()=>settings,getSecrets:()=>['synthetic-configured-key']});
    ipcMain.handle('delivery:prepare',async(_event,value)=>{requests.push(value);if(failPrepare){failPrepare=false;throw new Error('SYNTHETIC_PREPARE_FAILED');}const result=service.prepare(value);return hold?new Promise(resolve=>pending.push({resolve,result})):result;});
    ipcMain.handle('delivery:execute',async(_event,value,action)=>{if(failExecute){failExecute=false;throw new Error('SYNTHETIC_SAVE_FAILED');}return service.execute(value,action,async snapshot=>{const bytes=await exportOfficeFile(snapshot.text,snapshot.format),file=path.join(__dirname,'output-'+outputs.length+'.'+snapshot.format);await fs.writeFile(file,bytes);const disk=await fs.readFile(file),parsed=await parseOfficeFile('output.'+snapshot.format,disk);assert.deepEqual(disk,bytes);outputs.push({action,format:snapshot.format,text:parsed.text,bytes:disk.length,binding:value});return {path:file};});});
    const window=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const run=async source=>{try{return await window.webContents.executeJavaScript(source);}catch(error){throw new Error('Renderer command failed: '+source+'; '+error.message);}},click=selector=>run('document.querySelector('+JSON.stringify(selector)+').click()');
    const wait=async predicate=>{const end=Date.now()+4000;while(Date.now()<end){if(await run(predicate))return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Timed out: '+predicate);};
    const ready=()=>wait('!document.querySelector(".privacy-text").getAttribute("aria-busy") || document.querySelector(".privacy-text").getAttribute("aria-busy")==="false"');
    const text=()=>run('document.querySelector(".privacy-text pre").textContent');
    const disabled=()=>run('document.querySelector(".review-export-actions .primary-button").disabled');
    const confirm=()=>click('.checkbox-row input');
    const submit=()=>click('.review-export-actions .primary-button');
    try {
     await fs.writeFile(path.join(__dirname,'index.html'),'<!doctype html><html><body><div id="root"></div></body></html>');await window.loadFile(path.join(__dirname,'index.html'));await run(await fs.readFile(path.join(__dirname,'renderer.js'),'utf8'));
     await run('window.deliveryQA.open()');await ready();assert(!(await text()).includes('13800000000'));assert(!(await text()).includes('旧masked'));assert((await text()).includes('普通资料'));assert.equal(await disabled(),true);
     assert.deepEqual(Object.keys(requests[0]).sort(),['original','masked','title','action','recipientScope','format'].sort());
     await confirm();assert.equal(await disabled(),false);
     hold=true;settings={...settings,privacyPolicy:{...settings.privacyPolicy,actions:{PHONE:'allow'}}};await run('window.deliveryQA.update({policy:{secretPrefixes:["zxcorp_"],actions:{PHONE:"allow"}}})');
     assert.equal(await disabled(),true);assert.equal(await run('document.querySelector(".checkbox-row input").checked'),false);
     await wait('document.querySelector(".privacy-text").getAttribute("aria-busy")==="true"');
     while(!pending.length)await new Promise(resolve=>setTimeout(resolve,10));pending.shift().resolve(service.prepare(requests.at(-1)));hold=false;await ready();assert((await text()).includes('13800000000'));
     settings={...settings,privacyPolicy:{secretPrefixes:['zxcorp_']}};await run('window.deliveryQA.update({policy:{secretPrefixes:["zxcorp_"]}})');await ready();
     hold=true;await run('window.deliveryQA.update({original:"过期正文A"})');while(pending.length<1)await new Promise(resolve=>setTimeout(resolve,10));await run('window.deliveryQA.update({original:"当前正文B"})');while(pending.length<2)await new Promise(resolve=>setTimeout(resolve,10));
     const older=pending.shift(),newer=pending.shift();newer.resolve(newer.result);await ready();assert.equal(await text(),'当前正文B');older.resolve(older.result);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(await text(),'当前正文B');hold=false;
     await run('window.deliveryQA.update({original:"电话13800000000，普通资料。"})');await ready();
     for(const format of ['txt','docx','xlsx']){
      await run('(()=>{const field=document.querySelector("select");field.value='+JSON.stringify(format)+';field.dispatchEvent(new Event("change",{bubbles:true}));})()');await ready();
      await confirm();const before=outputs.length;await submit();await wait('window.deliveryQA.calls.length>='+JSON.stringify(before+1));while(outputs.length===before)await new Promise(resolve=>setTimeout(resolve,10));await ready();
      const output=outputs.at(-1);assert.equal(output.action,'export');assert.equal(output.format,format);assert(output.bytes>0);assert(!output.text.includes('13800000000'));assert(output.text.includes('普通资料'));assert.equal(Object.hasOwn(output.binding,'text'),false);assert.deepEqual(Object.keys(output.binding).sort(),['reviewId','contentHash','policyRevision','recipientScope','format','name'].sort());
     }
     await run('window.deliveryQA.update({action:"share"})');await ready();await confirm();await submit();while(outputs.length<4)await new Promise(resolve=>setTimeout(resolve,10));await ready();assert.equal(outputs[3].action,'share');assert.equal(outputs[3].format,'txt');assert(!outputs[3].text.includes('13800000000'));
     await run('document.querySelectorAll("[role=tab]")[1].click()');await ready();assert((await text()).includes('13800000000'));assert.equal(await run('document.querySelector(".checkbox-row input").checked'),false);
     await run('window.deliveryQA.update({original:"zxcorp_ABCDEF1234567890",masked:"旧安全文本"})');await ready();assert.equal(await disabled(),true);assert(!(await text()).includes('zxcorp_ABCDEF1234567890'));assert(await run('!!document.querySelector("[role=alert]")'));
     await run('window.deliveryQA.update({original:"synthetic-configured-key"})');await ready();assert.equal(await disabled(),true);assert(!(await text()).includes('synthetic-configured-key'));
     settings={...settings,privacyPolicy:{actions:{PHONE:'block'}}};await run('window.deliveryQA.update({original:"电话13800000000",policy:{actions:{PHONE:"block"}}})');await ready();assert.equal(await disabled(),true);assert(!(await text()).includes('13800000000'));
     settings={...settings,privacyPolicy:{}};failPrepare=true;await run('window.deliveryQA.update({original:"普通正文",policy:{}})');await ready();assert.match(await run('document.querySelector("[role=alert]").textContent'),/SYNTHETIC_PREPARE_FAILED/);assert.equal(await disabled(),true);await new Promise(resolve=>setTimeout(resolve,20));assert(await run('!!document.querySelector("[role=alert]")'));await run('[...document.querySelectorAll("button")].find(button=>button.textContent==="重新审阅").click()');await ready();assert.equal(await run('!!document.querySelector("[role=alert]")'),false);
     failExecute=true;await confirm();await submit();await wait('!!document.querySelector("[role=alert]")');assert.match(await run('document.querySelector("[role=alert]").textContent'),/SYNTHETIC_SAVE_FAILED/);assert.equal(await disabled(),true);await new Promise(resolve=>setTimeout(resolve,20));assert(await run('!!document.querySelector("[role=alert]")'));
     await run('[...document.querySelectorAll("button")].find(button=>button.textContent==="重新审阅").click()');await ready();assert.equal(await run('!!document.querySelector("[role=alert]")'),false);assert.equal(await run('document.querySelector(".checkbox-row input").checked'),false);
     service.ttlMs=100;await run('window.deliveryQA.update({title:"过期快照"})');await ready();await confirm();await wait('!!document.querySelector("[role=alert]")');assert.match(await run('document.querySelector("[role=alert]").textContent'),/已过期/);assert.equal(await disabled(),true);assert.equal(await run('document.querySelector(".checkbox-row input").checked'),false);service.ttlMs=600000;
     const beforeDemo=requests.length;await run('window.deliveryQA.open({desktop:false,original:"zxcorp_ABCDEF1234567890",policy:{secretPrefixes:["zxcorp_"]}})');assert.equal(await disabled(),true);assert(!(await text()).includes('zxcorp_'));assert.match(await run('document.querySelector("[role=dialog]").textContent'),/未经桌面主机审阅/);assert.equal(requests.length,beforeDemo);
     await run('window.deliveryQA.update({original:"电话13800000000",policy:{},privacyMode:"raw"})');assert(!(await text()).includes('13800000000'));await run('document.querySelectorAll("[role=tab]")[1].click()');assert((await text()).includes('13800000000'));await confirm();await submit();await wait('window.deliveryQA.calls.at(-1).demo===true');const demo=await run('window.deliveryQA.calls.at(-1)');assert.equal(demo.text,'电话13800000000');assert.equal(demo.format,'txt');assert.equal(demo.demo,true);assert.equal(Object.hasOwn(demo,'reviewId'),false);
     await run('window.deliveryQA.recipient();document.querySelectorAll("[role=tab]")[1].click()');assert(!(await text()).includes('zxcorp_'));assert.match(await run('document.querySelector("[role=dialog]").textContent'),/当前拦截规则/);
     console.log(JSON.stringify({result:'PASS delivery renderer',fileAdapters:outputs.map(({action,format,bytes})=>({action,format,bytes})),prepareRequests:requests.length,hostTextAuthorization:false,synthetic:true}));
    }finally{window.destroy();}app.quit();
   }).catch(error=>{console.error(error.stack);app.exit(1);});
  `;
  const mainPath=path.join(directory,'main.cjs');await writeFile(mainPath,main);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(require('electron'),[mainPath],{env,signal:context.signal,windowsHide:true,stdio:['ignore','pipe','pipe']});exited=once(child,'exit');let output='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
  const [code]=await exited;assert.equal(code,0,output);assert.match(output,/PASS delivery renderer/);console.log(output.trim());
 }finally{
  if(child&&child.exitCode===null){child.kill();await exited;}
  const target=await realpath(directory);assert.equal(path.dirname(target),parent);assert(path.basename(target).startsWith('zhixing-delivery-review-'));await rm(target,{recursive:true,force:true,maxRetries:6,retryDelay:100});
 }
});

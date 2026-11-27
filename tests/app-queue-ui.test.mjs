import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repository = path.resolve(import.meta.dirname, '..');

// 真实 App renderer + 合成 IPC：验证运行中的交办进入队列，并在本轮结束后
// 自动按顺序发出，不需要用户再点一次发送。
async function exerciseWindow(window) {
  const assert = require('node:assert/strict');
  const run = (source) => window.webContents.executeJavaScript(source);
  const wait = async (expression, label = expression) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await run(expression)) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    const tail = await run('document.body.innerText.slice(-1200)');
    throw new Error('Timeout: ' + label + '\n' + tail);
  };
  const field = 'textarea[aria-label="聊天输入框"]';
  const type = (value) =>
    run(
      '(()=>{const node=document.querySelector(' +
        JSON.stringify(field) +
        ');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(node,' +
        JSON.stringify(value) +
        ');node.dispatchEvent(new Event("input",{bubbles:true}));})()',
    );
  const pressEnter = () =>
    run(
      'document.querySelector(' +
        JSON.stringify(field) +
        ').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))',
    );
  const qa = () => run('window.zhixing.appQA.snapshot()');
  const value = () => run('document.querySelector(' + JSON.stringify(field) + ').value');
  const hasStop = () => run('!!document.querySelector(\'button[aria-label="停止生成"]\')');
  const queuedHeading = () =>
    run('document.querySelector(".queued-heading span")?.textContent || ""');

  await run(
    'window.addEventListener("error",event=>console.error("STACK "+(event.error&&event.error.stack||event.message)))',
  );
  const step = (name) => run('console.log(' + JSON.stringify('STEP ' + name) + ')');
  await step('bridge');
  await wait('!!window.zhixing?.appQA');
  await step('composer');
  await step('saved');
  await wait(
    '!!document.querySelector(' +
      JSON.stringify(field) +
      ') && !document.querySelector(' +
      JSON.stringify(field) +
      ').disabled',
  );
  await wait('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"');

  // 第一件交办：真实走 prepare → begin → 等待主机结果。
  await type('第一件\u001B[31m交办\u202E');
  await pressEnter();
  await wait('window.zhixing.appQA.snapshot().then(v=>v.runs.length===1)', 'first run started');
  assert.equal((await qa()).prepares.length, 1);
  assert.equal(await hasStop(), true);

  // 运行中第二件：进入队列，不启动第二个内核，也不丢弃输入。
  await type('第二件交办');
  await pressEnter();
  await wait(
    'window.zhixing.appQA.snapshot().then(v=>v.queue.length===1)',
    'second message queued',
  );
  let state = await qa();
  assert.equal(
    state.prepares.length,
    1,
    'a queued message must not start another kernel while one runs',
  );
  assert.equal(state.queue[0].text, '第二件交办');
  assert.equal(await queuedHeading(), '1 条排队消息');
  assert.equal(await value(), '');
  await wait(
    'window.zhixing.appQA.snapshot().then(v=>v.saved.queuedMessages?.length===1)',
    'queue is saved with the workspace',
  );
  assert.equal((await qa()).saved.queuedMessages[0].text, '第二件交办');
  console.log('PASS 运行中的交办进入队列、不另起内核，并随工作空间保存');

  // 本轮结束：队头自动发出，用户无需再操作。
  await run('window.zhixing.appQA.finish(0)');
  await wait(
    'window.zhixing.appQA.snapshot().then(v=>v.runs.length===2)',
    'queued message auto-dispatched',
  );
  state = await qa();
  assert.equal(
    state.queue.length,
    0,
    'the dispatched message leaves the queue once the kernel accepts it',
  );
  assert.equal(state.prepares.length, 2);
  assert.match(state.prepares[1].prompt, /第二件交办/);
  assert.equal(
    state.prepares[1].sessionId,
    state.prepares[0].sessionId,
    'a queued message continues the same chat',
  );
  await wait(
    '!document.querySelector(".queued-messages")',
    'queue clears once the kernel accepts the message',
  );
  console.log('PASS 本轮结束后队头自动发送到同一段聊天并离开队列');

  // 第二条也完成后，队列仍为空，两轮正文各自归档。
  await run('window.zhixing.appQA.finish(1)');
  await wait(
    'window.zhixing.appQA.snapshot().then(v=>v.runs.every(run=>run.settled))',
    'second run settled',
  );
  await wait(
    'window.zhixing.appQA.snapshot().then(v=>v.saved.chats.find(chat=>chat.messages.length===4))',
    'both exchanges persisted',
  );
  state = await qa();
  const conversation = state.saved.chats.find((chat) => chat.messages.length === 4);
  assert.equal(
    conversation.title,
    '第一件交办',
    'the sidebar title drops ANSI and directional controls instead of rendering a deceptive line',
  );
  assert.deepEqual(
    conversation.messages.map((message) => message.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  assert.equal(state.saved.queuedMessages.length, 0);
  await wait('!document.querySelector(\'button[aria-label="停止生成"]\')', 'no run remains active');
  console.log('PASS 两轮都完成、队列清空且消息顺序正确');
}

test('运行中排队：真实 App 在本轮结束后自动发送队头', { timeout: 60000 }, async (context) => {
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-app-queue-'));
  let child;
  let exited;
  let spawnError;
  try {
    const renderer = await build({
      stdin: {
        resolveDir: repository,
        loader: 'jsx',
        contents: `import{createElement}from'react';import{createRoot}from'react-dom/client';import{App}from'./src/App.jsx';import{flushRendererDurability}from'./src/renderer-durability.js';window.__qaFlushWorkspace=flushRendererDurability;createRoot(document.getElementById('root')).render(createElement(App));`,
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      loader: { '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"test"' },
      logLevel: 'silent',
    });
    await writeFile(path.join(directory, 'renderer.js'), renderer.outputFiles[0].text);
    await writeFile(
      path.join(directory, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>',
    );
    await writeFile(
      path.join(directory, 'preload.cjs'),
      `const {contextBridge,ipcRenderer}=require('electron');
const methods=['loadWorkspace','saveWorkspace','saveDrafts','runtimeStatus','runtimeCleanupStatus','retryRuntimeCleanup','listAutomations','retryAutomationSave','forgetSession','removeAutomation','prepareRun','runPrepared','beginRun','runHandoffs','awaitRunHandoff','acknowledgeRunHandoff','questionSnapshot','workspaceSaveStatus','retryWorkspaceSave','loadFeedback','listMcp','browserState','browserLayout','windowControl','speechStatus','pickFiles','approvalSnapshot','runStatus'];
const api=Object.fromEntries(methods.map(name=>[name,(...args)=>ipcRenderer.invoke('qa',name,args)]));
api.appQA={snapshot:()=>ipcRenderer.invoke('qa','snapshot'),finish:index=>ipcRenderer.invoke('qa','finish',index)};
for(const name of ['RuntimeEvent','WorkspaceSaveState','PrepareToQuit','AutomationChange','BrowserChange','SpeechEvent','ApprovalsChanged'])api['on'+name]=callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on(name,listener);return()=>ipcRenderer.removeListener(name,listener);};
contextBridge.exposeInMainWorld('zhixing',api);`,
    );
    await writeFile(
      path.join(directory, 'main.cjs'),
      `const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'profile'));
const workspaceFile=path.join(__dirname,'workspace.json');
const runtime={configured:true,providers:[{id:'synthetic-provider',name:'Synthetic',baseUrl:'http://127.0.0.1/synthetic'}],models:[{id:'synthetic-model',name:'Synthetic',providerId:'synthetic-provider',providerName:'Synthetic',levels:['high'],reasoningCapability:'supported'}]};
const seed={version:2,workspaceId:'office-home',workspaces:[{id:'office-home',name:'合成办公',type:'office'}],projects:[{id:'project',workspaceId:'office-home',name:'合成项目',expanded:true}],chats:[{id:'chat-a',title:'合成聊天',workspaceId:'office-home',projectId:null,messages:[]}],drafts:{},documents:[],automations:[],settings:{persist:true,modelProviderId:'synthetic-provider',model:'synthetic-model',reasoning:'high',privacyMode:'redact',permission:'ask'},appliedAutomationRuns:[]};
let stored=structuredClone(seed);
const prepares=[],runs=[];
ipcMain.handle('qa',async(_,name,args)=>{
 if(name==='loadWorkspace')return stored;
 if(name==='saveWorkspace'){stored=structuredClone(args[0]);await fs.writeFile(workspaceFile,JSON.stringify(stored));return {saved:true};}
 if(name==='saveDrafts')return {saved:true};
 if(name==='runtimeStatus')return runtime;
 if(name==='runtimeCleanupStatus')return [];
 if(name==='listAutomations')return {revision:0,tasks:[],runs:[],pendingOutcomes:[],persistenceError:null};
 if(name==='workspaceSaveStatus')return {status:'saved',requestedRevision:1,persistedRevision:1};
 if(name==='retryWorkspaceSave')return {saved:true};
 if(name==='questionSnapshot')return [];
 if(name==='browserState')return {tabs:[],activeId:null,recent:[]};
 if(name==='browserLayout')return {open:false,width:0};
 if(name==='listMcp')return [];
 if(name==='speechStatus')return {ready:false,model:'none'};
 if(name==='loadFeedback')return {entries:[]};
 if(name==='approvalSnapshot')return {hostEpoch:'qa',revision:0,pending:[]};
 if(name==='runHandoffs')return {runs:[]};
 if(name==='prepareRun'){
   assert.equal(stored.settings.demo,false);
   prepares.push({...args[0]});
   return {preparationId:'prep-'+prepares.length,text:'SAFE_INPUT',privacyMode:'redact',providerId:'synthetic-provider',baseUrl:'http://127.0.0.1/synthetic'};
 }
 if(name==='beginRun'){
   const entry={identity:{hostEpoch:'qa',runId:args[0].runId,sessionId:prepares.at(-1).sessionId,replyId:args[0].replyId,receiptId:'receipt-'+args[0].runId},settled:false};
   entry.done=new Promise(resolve=>{entry.release=resolve;});
   runs.push(entry);
   return entry.identity;
 }
 if(name==='awaitRunHandoff'){
   const entry=runs.find(run=>run.identity.runId===args[0].runId);
   await entry.done;
   return {...entry.identity,outcome:{result:{text:'合成答复 '+entry.identity.runId.slice(0,4),masked:'合成答复',finishReason:'stop',privacyMode:'redact',entities:[]}},time:Date.now(),trace:[]};
 }
 if(name==='acknowledgeRunHandoff')return {acknowledged:true};
 if(name==='runPrepared')return {text:'合成答复',masked:'合成答复',privacyMode:'redact'};
 if(name==='snapshot')return {prepares:prepares.map(item=>({sessionId:item.sessionId,prompt:item.prompt})),runs:runs.map(item=>({settled:item.settled})),queue:stored.queuedMessages||[],saved:stored};
 if(name==='finish'){const index=Array.isArray(args)?args[0]:args;const entry=runs[index];if(!entry)throw new Error('run not found');if(entry.settled)return true;entry.settled=true;entry.release();return true;}
 return {};
});
const run=source=>window.webContents.executeJavaScript(source);
const wait=async(expression,label)=>{const limit=Date.now()+15000;while(Date.now()<limit){if(await run(expression))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Timeout '+label);};
const type=value=>run('(()=>{const node=document.querySelector(\\'textarea[aria-label="聊天输入框"]\\');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(node,'+JSON.stringify(value)+');node.dispatchEvent(new Event("input",{bubbles:true}));})()');
const enter=()=>run('document.querySelector(\\'textarea[aria-label="聊天输入框"]\\').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
app.whenReady().then(async()=>{
 window=new BrowserWindow({show:false,width:1255,height:912,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'preload.cjs')}});
 try{
  window.webContents.on('console-message',event=>{if(event.level==='error')console.error('RENDERER '+event.message);});
  await window.loadFile(path.join(__dirname,'index.html'));
  await wait('!!document.querySelector(\\'textarea[aria-label="聊天输入框"]\\') && !document.querySelector(\\'textarea[aria-label="聊天输入框"]\\').disabled','composer ready');
  await wait('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"','workspace saved');
  await (${exerciseWindow.toString()})(window);
  app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});`,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const flags =
      process.platform === 'linux'
        ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu']
        : [];
    child = spawn(require('electron'), [...flags, path.join(directory, 'main.cjs')], {
      env,
      signal: context.signal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.once('error', (error) => {
      spawnError = error;
    });
    exited = new Promise((resolve) => child.once('close', (code) => resolve(code)));
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const code = await exited;
    assert.equal(spawnError, undefined, String(spawnError));
    assert.equal(code, 0, output);
    assert.equal((output.match(/PASS /g) || []).length, 3, output);
    // Saved workspace must not keep a dispatched message in the queue.
    const saved = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'));
    assert.deepEqual(saved.queuedMessages, []);
    assert.equal(saved.chats.find((chat) => chat.messages.length === 4)?.messages.length, 4);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await exited;
    }
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith('zhixing-app-queue-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});

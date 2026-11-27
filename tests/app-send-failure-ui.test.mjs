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

// 真实 App renderer + 合成 IPC：直接发送在宿主接手之前失败（提交锚点保存失败、
// begin 被拒绝）时，用户刚打的字和附件必须回到输入框，失败原因必须可见。
async function exerciseWindow(window) {
  const assert = require('node:assert/strict');
  const run = (source) => window.webContents.executeJavaScript(source);
  const wait = async (expression, label = expression) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await run(expression)) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    const tail = await run(
      'JSON.stringify({bubbles:[...document.querySelectorAll(".user-message p")].map(n=>n.textContent),composer:document.querySelector(' +
        JSON.stringify(field) +
        ')?.value,toast:document.querySelector(".toast.error span")?.textContent||"",save:document.querySelector(".workspace-save-banner")?.dataset.saveStatus})',
    );
    throw new Error('Timeout: ' + label + '\n' + tail);
  };
  const field = 'textarea[aria-label="聊天输入框"]';
  const q = (expression) => 'window.zhixing.appQA.snapshot().then(v=>' + expression + ')';
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
  const bubbles = () =>
    run('[...document.querySelectorAll(".user-message p")].map(node=>node.textContent)');
  const toast = () => run('document.querySelector(".toast.error span")?.textContent || ""');
  const chips = () =>
    run('[...document.querySelectorAll(".attachment-chip")].map(node=>node.textContent).join("|")');

  await wait('!!window.zhixing?.appQA');
  await wait(
    '!!document.querySelector(' +
      JSON.stringify(field) +
      ') && !document.querySelector(' +
      JSON.stringify(field) +
      ').disabled',
  );
  await wait('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"');
  // 预置的聊天连同它的附件草稿一起恢复，输入框里应当已经有那枚附件。
  await wait(
    '[...document.querySelectorAll(".user-message p")].some(node=>node.textContent==="上一轮交办")',
    'seeded chat opens',
  );
  await wait(
    '[...document.querySelectorAll(".attachment-chip")].some(node=>node.textContent.includes("合成附件.pdf"))',
    'seeded attachment is in the composer',
  );

  // A. 提交锚点保存失败：宿主要求的持久化被拒，本轮从未开始。
  await run('window.zhixing.appQA.failSaveOnText(' + JSON.stringify('第一段失败的保存') + ')');
  await type('第一段失败的保存');
  await pressEnter();
  await wait(q('v.prepares.length===1'), 'the host preflight ran');
  await wait(
    'document.querySelector(' +
      JSON.stringify(field) +
      ').value===' +
      JSON.stringify('第一段失败的保存'),
    'the rejected draft returns to the composer',
  );
  assert.match(await toast(), /合成工作空间保存失败/, 'the failure reason is visible');
  assert.equal(await value(), '第一段失败的保存', 'the typed text returns to the composer');
  assert.match(await chips(), /合成附件\.pdf/, 'the attachment returns with the text');
  assert.deepEqual(await bubbles(), ['上一轮交办'], 'no half-written bubble is left behind');
  let state = await qa();
  assert.equal(state.runs.length, 0, 'a rejected initial save must not start a kernel');
  console.log('PASS 提交保存失败时直发草稿的文本与附件回到输入框、失败可见、不留假气泡');

  // B. begin 被拒绝：同样的恢复，不能只在 accepted 分支里做。
  await run('window.zhixing.appQA.clearFailSave()');
  await run('window.zhixing.appQA.failNextBegin()');
  await type('第二段失败的启动');
  await pressEnter();
  await wait(q('v.prepares.length===2'), 'the second preflight ran');
  await wait(
    'document.querySelector(' +
      JSON.stringify(field) +
      ').value===' +
      JSON.stringify('第二段失败的启动'),
    'the rejected draft returns to the composer',
  );
  assert.match(await toast(), /合成主机拒绝了本次启动/, 'the rejection reason is visible');
  assert.equal(await value(), '第二段失败的启动');
  assert.match(await chips(), /合成附件\.pdf/);
  assert.deepEqual(await bubbles(), ['上一轮交办']);
  state = await qa();
  assert.equal(state.prepares.length, 2, 'both direct sends reached the host preflight');
  assert.equal(state.runs.length, 0, 'a rejected begin must not leave a run behind');
  console.log('PASS 宿主拒绝启动时直发草稿同样回到输入框，不静默丢失');

  // C. 失败之后仍然能正常发送：既没卡住输入区，也没把失败的交办写进记录。
  await type('恢复后的交办');
  await pressEnter();
  await wait(q('v.runs.length===1'), 'send works after two rejected attempts');
  await run('window.zhixing.appQA.finish(0)');
  await wait(
    q(
      'v.saved.chats.find(c=>c.id==="chat-a")?.messages.some(m=>m.text==="恢复后的交办"&&!m.pending)',
    ),
    'the retried submission is persisted',
  );
  assert.deepEqual(
    await bubbles(),
    ['上一轮交办', '恢复后的交办'],
    'only the accepted submission adds a bubble',
  );
  console.log('PASS 两次失败之后发送恢复正常，记录里只有真正被接受的那件交办');

  // D. 新聊天里的第一条交办被拒：草稿键会从 new: 换到 chat:，文字同样要回来。
  await run(
    '(()=>{if(!document.querySelector(".sidebar"))document.querySelector(\'[aria-label="展开侧栏"]\')?.click();})()',
  );
  await wait('!!document.querySelector(".new-chat")', 'the sidebar offers a new chat');
  await run('document.querySelector(".new-chat").click()');
  await wait('!document.querySelector(".user-message")', 'a fresh conversation is open');
  await run('window.zhixing.appQA.failNextBegin()');
  await type('新聊天里的失败');
  await pressEnter();
  await wait(q('v.prepares.length===3'), 'the third preflight ran');
  await wait(
    'document.querySelector(' +
      JSON.stringify(field) +
      ').value===' +
      JSON.stringify('新聊天里的失败'),
    'the rejected first message returns to the composer',
  );
  assert.match(await toast(), /合成主机拒绝了本次启动/);
  assert.deepEqual(await bubbles(), [], 'the rolled back new conversation leaves no bubble');
  console.log('PASS 新聊天的第一条交办被拒后文字回到输入框，不留下半条会话');
}

test('直发失败：草稿与附件回到输入框，失败可见', { timeout: 60000 }, async (context) => {
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-app-send-failure-'));
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
api.appQA={snapshot:()=>ipcRenderer.invoke('qa','snapshot'),finish:index=>ipcRenderer.invoke('qa','finish',index),failNextBegin:()=>ipcRenderer.invoke('qa','failNextBegin'),failSaveOnText:text=>ipcRenderer.invoke('qa','failSaveOnText',[text]),clearFailSave:()=>ipcRenderer.invoke('qa','clearFailSave')};
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
const seed={version:2,workspaceId:'office-home',workspaces:[{id:'office-home',name:'合成办公',type:'office'}],projects:[],chats:[{id:'chat-a',title:'合成聊天',workspaceId:'office-home',projectId:null,providerId:'synthetic-provider',providerUrl:'http://127.0.0.1/synthetic',messages:[{id:'u0',role:'user',text:'上一轮交办',files:[]},{id:'a0',role:'assistant',text:'上一轮答复',pending:false,status:'succeeded'}]}],drafts:{'chat:chat-a':{kind:'chat',draftId:'chat-a',chatId:'chat-a',workspaceId:'office-home',projectId:null,text:'',files:[{id:'file-1',name:'合成附件.pdf',size:1024,path:'/tmp/合成附件.pdf',status:'ready'}],revision:3,filesRevision:1,updatedAt:Date.now()}},queuedMessages:[],documents:[],automations:[],settings:{persist:true,modelProviderId:'synthetic-provider',model:'synthetic-model',reasoning:'high',privacyMode:'redact',permission:'ask'},appliedAutomationRuns:[]};
let stored=structuredClone(seed);
let failBegin=false;
let failSaveText='';
const prepares=[],runs=[];
// 合成宿主自己负责落盘：串行化写入并保证原子替换，退出前再确认一次，
// 否则并发写入与 app.exit 重叠时读到的可能是被截断的空文件。
let writeChain=Promise.resolve();
const persist=snapshot=>{
 const payload=JSON.stringify(snapshot);
 writeChain=writeChain.then(async()=>{
  const temporary=workspaceFile+'.'+Math.random().toString(36).slice(2)+'.tmp';
  await fs.writeFile(temporary,payload);
  await fs.rename(temporary,workspaceFile);
 });
 return writeChain;
};
ipcMain.handle('qa',async(_,name,args)=>{
 if(name==='loadWorkspace')return stored;
 if(name==='saveWorkspace'){
  const snapshot=args[0];
  const rejected=failSaveText&&(snapshot.chats||[]).some(chat=>(chat.messages||[]).some(message=>message.role==='user'&&message.text===failSaveText));
  if(rejected)throw new Error('合成工作空间保存失败：EPERM');
  stored=structuredClone(snapshot);await persist(stored);return {saved:true};
 }
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
 if(name==='failNextBegin'){failBegin=true;return true;}
 if(name==='failSaveOnText'){failSaveText=String(args[0]||'');return true;}
 if(name==='clearFailSave'){failSaveText='';return true;}
 if(name==='beginRun'){
   if(failBegin){failBegin=false;throw new Error('合成主机拒绝了本次启动。');}
   const entry={identity:{hostEpoch:'qa',runId:args[0].runId,sessionId:prepares.at(-1).sessionId,replyId:args[0].replyId,receiptId:'receipt-'+args[0].runId},settled:false};
   entry.done=new Promise(resolve=>{entry.release=resolve;});
   runs.push(entry);
   return entry.identity;
 }
 if(name==='awaitRunHandoff'){
   const entry=runs.find(run=>run.identity.runId===args[0].runId);
   await entry.done;
   return {...entry.identity,outcome:{result:{text:'合成答复',masked:'合成答复',finishReason:'stop',privacyMode:'redact',entities:[]}},time:Date.now(),trace:[]};
 }
 if(name==='acknowledgeRunHandoff')return {acknowledged:true};
 if(name==='runPrepared')return {text:'合成答复',masked:'合成答复',privacyMode:'redact'};
 if(name==='snapshot')return {prepares:prepares.map(item=>({sessionId:item.sessionId,prompt:item.prompt})),runs:runs.map(item=>({settled:item.settled})),saved:stored};
 if(name==='finish'){const index=Array.isArray(args)?args[0]:args;const entry=runs[index];if(!entry)throw new Error('run not found');if(entry.settled)return true;entry.settled=true;entry.release();return true;}
 return {};
});
app.whenReady().then(async()=>{
 window=new BrowserWindow({show:false,width:1255,height:912,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'preload.cjs')}});
 try{
  window.webContents.on('console-message',event=>{if(event.level==='error')console.error('RENDERER '+event.message);});
  const rawEval=window.webContents.executeJavaScript.bind(window.webContents);
  window.webContents.executeJavaScript=async source=>{try{return await rawEval(source);}catch(error){console.error('FAILED <<'+String(source).slice(0,150)+'>>');throw error;}};
  await window.loadFile(path.join(__dirname,'index.html'));
  await (${exerciseWindow.toString()})(window);
  await writeChain;
  await persist(stored);
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
    assert.equal((output.match(/PASS /g) || []).length, 4, output);
    // 失败的两段交办一次都不能落进记录，只有被接受的那件留在聊天里。
    const saved = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'));
    const chat = saved.chats.find((item) => item.id === 'chat-a');
    assert.ok(chat, 'the existing chat survives');
    assert.deepEqual(
      chat.messages.map((message) => message.text),
      ['上一轮交办', '上一轮答复', '恢复后的交办', '合成答复'],
    );
    const restored = saved.drafts['chat:chat-a'];
    assert.equal(restored?.text, '', 'the accepted submission consumes the draft');
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await exited;
    }
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith('zhixing-app-send-failure-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});

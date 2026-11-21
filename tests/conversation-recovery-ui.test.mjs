import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const repository=path.resolve(import.meta.dirname,'..');

test('Windows App renderer：删除写盘故障重试、失败原地恢复、终态归档、附件追加及自动化仅保存重试', {timeout:120000}, async context=>{
  assert.equal(process.platform,'win32','This targeted renderer journey requires Windows Electron.');
  const root=path.resolve(repository,'.preview/qa-0.12.1-audit/agent-c');
  await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'renderer-'));
  // Observation only, in this isolated test bundle: retain the real App/event
  // implementation while exposing snapshots of otherwise private memory refs.
  const observeConversationMemory={name:'observe-conversation-memory',setup(builder){builder.onLoad({filter:/[\\/]src[\\/]App\.jsx$/},async({path:filename})=>{const source=await readFile(filename,'utf8'),anchor='  latest.current = state;';assert.equal(source.split(anchor).length,2);return {loader:'jsx',resolveDir:path.dirname(filename),contents:source.replace(anchor,`  window.__qaConversationMemory = () => ({ jobs: [...runJobs.current], positions: [...transcriptPositions.current], transcriptChatId: transcriptChatId.current, draftScopes: draftScopes.current, events, liveStats, question, active: active.current?.runId || null });\n${anchor}`)};});}};
  const renderer=await build({stdin:{resolveDir:repository,loader:'jsx',contents:`import{createElement}from'react';import{createRoot}from'react-dom/client';import{App}from'./src/App.jsx';createRoot(document.getElementById('root')).render(createElement(App));`},plugins:[observeConversationMemory],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"test"'},logLevel:'silent'});
  await writeFile(path.join(directory,'renderer.js'),renderer.outputFiles[0].text);
  await writeFile(path.join(directory,'index.html'),'<!doctype html><html><body><div id="root"></div></body></html>');
  await writeFile(path.join(directory,'preload.cjs'),`
    const {contextBridge,ipcRenderer}=require('electron');
    const methods=['loadWorkspace','saveWorkspace','runtimeStatus','runtimeCleanupStatus','retryRuntimeCleanup','listAutomations','retryAutomationSave','forgetSession','removeAutomation','prepareRun','runPrepared','listMcp','browserState','browserLayout','windowControl','speechStatus','retryWorkspaceSave','workspaceSaveStatus','pickFiles'];
    const api=Object.fromEntries(methods.map(name=>[name,(...args)=>ipcRenderer.invoke('qa',name,args)]));
    for(const name of ['RuntimeEvent','WorkspaceSaveState','PrepareToQuit','AutomationChange','BrowserChange','SpeechEvent'])api['on'+name]=callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on(name,listener);return()=>ipcRenderer.removeListener(name,listener);};
    contextBridge.exposeInMainWorld('zhixing',api);
  `);
  await writeFile(path.join(directory,'main.cjs'),`
    const {app,BrowserWindow,ipcMain}=require('electron');
    const assert=require('node:assert/strict');
    const fs=require('node:fs/promises');
    const path=require('node:path');
    app.setPath('userData',path.join(__dirname,'profile'));
    let window,stored,saveFailure=false,forgetFailure=false,forgetRelease,preparedSessionId,pendingRun,runs=0,saveRetries=0,cleanupRetries=0,pickResolve,pickPending=false;
    const forgotten=[],records=[],errors=[];
    let automation={revision:0,tasks:[],runs:[],pendingOutcomes:[],persistenceError:null};
    const workspaceFile=path.join(__dirname,'synthetic-workspace.json');
    const runtime={configured:true,providers:[{id:'synthetic-provider',name:'Synthetic',baseUrl:'http://127.0.0.1/synthetic'}],models:[{id:'synthetic-model',name:'Synthetic',providerId:'synthetic-provider',providerName:'Synthetic',levels:['high'],reasoningCapability:'supported'}]};
    ipcMain.handle('qa',async(_,name,args)=>{
      if(name==='loadWorkspace')return JSON.parse(await fs.readFile(workspaceFile,'utf8'));
      if(name==='saveWorkspace'){if(saveFailure)throw new Error('SYNTHETIC_DISK_WRITE_FAILED');stored=args[0];await fs.writeFile(workspaceFile,JSON.stringify(stored));return {saved:true};}
      if(name==='workspaceSaveStatus')return {status:saveFailure?'failed':'saved',requestedRevision:1,persistedRevision:saveFailure?0:1};
      if(name==='retryWorkspaceSave'){if(saveFailure)throw new Error('SYNTHETIC_DISK_WRITE_FAILED');return {saved:true};}
      if(name==='runtimeStatus')return runtime;
      if(name==='runtimeCleanupStatus')return [];
      if(name==='retryRuntimeCleanup'){cleanupRetries++;return {runId:args[0],status:'exited',finalization:{runId:args[0],executionStatus:'failed',persistenceStatus:'saved',processStatus:'exited',eventWatermark:9}};}
      if(name==='listAutomations')return automation;
      if(name==='retryAutomationSave'){saveRetries++;automation={revision:automation.revision+1,tasks:[],runs:automation.runs.map(row=>({...row,finalization:{...row.finalization,persistenceStatus:'saved'}})),pendingOutcomes:[],persistenceError:null};window.webContents.send('AutomationChange',automation);return automation;}
      if(name==='forgetSession'){if(forgetFailure)throw new Error('SYNTHETIC_FORGET_UNCONFIRMED');await new Promise(resolve=>{forgetRelease=resolve;});forgotten.push(args[0]);return {forgotten:true};}
      if(name==='removeAutomation')return {};
      if(name==='prepareRun'){preparedSessionId=args[0].sessionId;return {preparationId:'synthetic-prepared',text:'SAFE_SYNTHETIC_INPUT',privacyMode:'redact',providerId:'synthetic-provider',baseUrl:'http://127.0.0.1/synthetic'};}
      if(name==='runPrepared'){runs++;return new Promise((resolve,reject)=>{pendingRun={...args[0],sessionId:preparedSessionId,resolve,reject};});}
      if(name==='browserState')return {tabs:[],activeId:null,recent:[]};
      if(name==='listMcp')return [];
      if(name==='pickFiles'){pickPending=true;return new Promise(resolve=>{pickResolve=resolve;});}
      return {};
    });
    const run=source=>window.webContents.executeJavaScript(source);
    const wait=async(predicate,label)=>{const limit=Date.now()+10000;while(Date.now()<limit){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Timeout '+label+' '+await run('document.body.innerText.slice(-1400)'));};
    const waitUI=expression=>wait(()=>run(expression),expression);
    const click=selector=>run('(()=>{const node=document.querySelector('+JSON.stringify(selector)+');if(!node)throw new Error("Missing selector "+'+JSON.stringify(selector)+');node.click();})()');
    const textClick=(selector,text)=>run('(()=>{const node=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(node=>node.textContent.trim()==='+JSON.stringify(text)+');if(!node)throw new Error("Missing text "+'+JSON.stringify(text)+');node.click();})()');
    const field='textarea[aria-label="聊天输入框"]';
    const input=value=>run('(()=>{const node=document.querySelector('+JSON.stringify(field)+');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(node,'+JSON.stringify(value)+');node.dispatchEvent(new Event("input",{bubbles:true}));})()');
    const record=async(name,details={})=>{records.push({name,status:'passed',details});console.log('PASS '+name);await fs.writeFile(path.join(__dirname,'journey.json'),JSON.stringify({layer:'Windows Electron renderer with synthetic IPC/fault injection; not final installer or cloud',records},null,2));};
    const file=(id,text=id)=>({id,name:id+'.txt',status:'ready',size:10,text,workspaceId:'office-home'});
    function seed(){return {version:2,workspaceId:'office-home',workspaces:[{id:'office-home',name:'合成办公',type:'office'}],projects:[{id:'project',workspaceId:'office-home',name:'合成项目',expanded:true}],chats:[{id:'chat',title:'合成聊天',workspaceId:'office-home',projectId:null,messages:[]}],drafts:{'chat:chat':{kind:'chat',draftId:'chat',chatId:'chat',workspaceId:'office-home',revision:3,text:'FAIL_BODY_MARKER',files:[file('first'),file('second')],updatedAt:5}},documents:[file('third')],automations:[],settings:{persist:true,modelProviderId:'synthetic-provider',model:'synthetic-model',reasoning:'high',privacyMode:'redact',permission:'ask'},appliedAutomationRuns:[]};}
    async function load(value){stored=value;await fs.writeFile(workspaceFile,JSON.stringify(value));await window.loadFile(path.join(__dirname,'index.html'));await run(await fs.readFile(path.join(__dirname,'renderer.js'),'utf8'));await waitUI('!!document.querySelector('+JSON.stringify(field)+')&&!document.querySelector('+JSON.stringify(field)+').disabled');await waitUI('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"');}
    async function emitFailure(status='failed',executionStatus=status){const item=pendingRun;assert(item);const finalization={runId:item.runId,executionStatus,persistenceStatus:'saved',processStatus:'cleanup_pending',eventWatermark:8,error:{code:status==='cancelled'?'RUNTIME_CANCELLED':'SYNTHETIC_NETWORK_FAILURE',stage:'query',message:'保护后的失败原因'},deliverables:[{id:'verified',path:'D:/synthetic/verified.txt'}],children:[{id:'child',status:'completed'}]};window.webContents.send('RuntimeEvent',{type:'tool/call',runId:item.runId,sessionId:'chat',label:'合成工具调用',category:'tools',time:1});window.webContents.send('RuntimeEvent',{type:'tool/result',runId:item.runId,sessionId:'chat',label:'合成工具完成',category:'tools',time:2});window.webContents.send('RuntimeEvent',{type:'draft',runId:item.runId,text:'SAFE_PARTIAL_MARKER'});window.webContents.send('RuntimeEvent',{type:'run/terminal',runId:item.runId,sessionId:'chat',status,finalization});await waitUI('!!document.querySelector(".runtime-cleanup-pending")');item.reject(new Error('protected synthetic IPC rejection'));pendingRun=null;await waitUI('!document.querySelector("button[aria-label=停止生成]")');return item.runId;}
    app.whenReady().then(async()=>{
      window=new BrowserWindow({show:false,width:1255,height:912,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'preload.cjs')}});
      window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
      try{
        await load(seed());
        await waitUI('document.querySelector('+JSON.stringify(field)+').value==="FAIL_BODY_MARKER"');
        await click('.composer button[aria-label="发送消息"]');
        await wait(()=>!!pendingRun,'first run');
        const failedId=await emitFailure();
        await waitUI('document.querySelector('+JSON.stringify(field)+').value==="FAIL_BODY_MARKER"');
        assert.equal(await run('document.querySelectorAll(".composer .attachment-chip").length'),2);
        await wait(()=>stored.chats[0].messages.at(-1)?.trace?.length===3,'archived trace');
        assert.equal(stored.chats[0].messages.at(-1).text,'SAFE_PARTIAL_MARKER');
        assert.equal(stored.chats[0].messages.at(-1).deliverables[0].id,'verified');
        assert.equal(stored.chats[0].messages.at(-1).children[0].id,'child');
        await record('失败后不导航即恢复正文和2个附件，terminal前归档轨迹/成果/子任务',{runId:failedId,executionCount:runs,traceCount:3});

        await textClick('.runtime-cleanup-pending button','重试清理');
        await waitUI('!document.querySelector(".runtime-cleanup-pending")');
        assert.equal(cleanupRetries,1);assert.equal(runs,1);
        await record('内核清理重试只调用cleanup，不重新执行',{cleanupRetries,executionCount:runs});

        await wait(()=>stored.chats[0].messages.at(-1)?.finalization?.processStatus==='exited','persisted cleanup result');
        await load(JSON.parse(await fs.readFile(workspaceFile,'utf8')));
        await waitUI('document.querySelector('+JSON.stringify(field)+').value==="FAIL_BODY_MARKER"');
        assert.equal(stored.chats[0].messages.at(-1).trace.length,3);
        assert.equal(stored.chats[0].messages.at(-1).text,'SAFE_PARTIAL_MARKER');
        assert.equal(stored.chats[0].messages.at(-1).finalization.processStatus,'exited');
        await record('从实际合成存储文件重新载入后失败正文/轨迹/清理终态仍在');

        await click('.composer button[aria-label="发送消息"]');await wait(()=>!!pendingRun,'second run');
        await input('NEWER_USER_INPUT_MARKER');
        await emitFailure();
        await waitUI('document.querySelector('+JSON.stringify(field)+').value==="NEWER_USER_INPUT_MARKER"');
        assert.equal(await run('document.querySelectorAll(".composer .attachment-chip").length'),0);
        await record('失败期间的新输入及空附件不被旧草稿覆盖',{executionCount:runs});

        await click('button[aria-label="资料空间"]');
        await textClick('.resource-row button','添加到交办');
        await waitUI('document.querySelectorAll(".composer .attachment-chip").length===1');
        // Use a saved home draft to exercise the exact materials-page return path.
        const appendSeed=seed();appendSeed.drafts={'new:office-home:home:home-draft':{kind:'new',draftId:'home-draft',workspaceId:'office-home',revision:4,text:'HOME_BODY_MARKER',files:[file('first'),file('second')],updatedAt:10}};
        await load(appendSeed);await click('button[aria-label="资料空间"]');await textClick('.resource-row button','添加到交办');
        await waitUI('document.querySelectorAll(".composer .attachment-chip").length===3');
        assert.equal(await run('document.querySelector('+JSON.stringify(field)+').value'),'HOME_BODY_MARKER');
        await click('button[aria-label="资料空间"]');await textClick('.resource-row button','添加到交办');
        assert.equal(await run('document.querySelectorAll(".composer .attachment-chip").length'),3);
        await record('资料空间加入第三份资料保留原正文和前2个附件，再次加入不重复');

        // Typing while an attachment parse is outstanding must not discard its result.
        await click('button[aria-label="添加内容"]');
        await click('.attachment-menu button[role="menuitem"]');
        await wait(()=>pickPending,'pending file picker');
        await input('TYPED_DURING_PARSE_MARKER');pickResolve([file('fourth')]);pickPending=false;
        await waitUI('document.querySelectorAll(".composer .attachment-chip").length===4');
        assert.equal(await run('document.querySelector('+JSON.stringify(field)+').value'),'TYPED_DURING_PARSE_MARKER');
        await record('附件读取期间正常打字不使附件generation过期');

        const full=seed();full.drafts={'new:office-home:home:full':{kind:'new',draftId:'full',workspaceId:'office-home',revision:1,text:'FULL_BODY',files:Array.from({length:12},(_,i)=>file('full-'+i)),updatedAt:12}};
        await load(full);await click('button[aria-label="资料空间"]');await textClick('.resource-row button','添加到交办');
        await waitUI('document.querySelector(".toast")?.textContent.includes("1 个未加入")');
        assert.equal(await run('document.querySelectorAll(".composer .attachment-chip").length'),12);
        await record('12个附件满额时明确提示未加入数量且原附件全部保留');

        const deletion=seed();deletion.chats[0].messages=[{id:'delete-user',role:'user',text:'DELETE_CHAT_MESSAGE_MARKER'}];deletion.drafts['chat:chat'].text='DELETE_DRAFT_MARKER';deletion.drafts['chat:chat'].files=[file('delete-file','DELETE_ATTACHMENT_MARKER')];
        deletion.chats.push({id:'keep-chat',title:'保留聊天',workspaceId:'office-home',projectId:null,messages:[{id:'keep-user',role:'user',text:'KEEP_CHAT_MESSAGE_MARKER'}]});
        for(const chat of deletion.chats){chat.providerId='synthetic-provider';chat.providerUrl='http://127.0.0.1/synthetic';}
        deletion.drafts['chat:keep-chat']={kind:'chat',draftId:'keep-chat',chatId:'keep-chat',workspaceId:'office-home',revision:1,text:'KEEP_DRAFT_MARKER',files:[],updatedAt:2};
        await load(deletion);
        const memory=()=>run('window.__qaConversationMemory()');
        const completed=[];
        for(const [target,marker]of [['keep-chat','KEEP_JOB_BODY_MARKER'],['chat','DELETE_JOB_BODY_MARKER']]){
          await click('.chat-row[data-chat-id="'+target+'"] .chat-link');
          await click('.composer button[aria-label="发送消息"]');await wait(()=>!!pendingRun,'cache-owning run '+target);
          const item=pendingRun;assert.equal(item.sessionId,target);
          const finalization={runId:item.runId,executionStatus:'completed',persistenceStatus:'saved',processStatus:'exited',eventWatermark:4};
          window.webContents.send('RuntimeEvent',{type:'tool/result',runId:item.runId,sessionId:target,label:marker,category:'tools'});
          window.webContents.send('RuntimeEvent',{type:'draft',runId:item.runId,sessionId:target,text:marker,final:true,source:'validated-result'});
          window.webContents.send('RuntimeEvent',{type:'live-stats',runId:item.runId,sessionId:target,context:{marker}});
          window.webContents.send('RuntimeEvent',{type:'run/terminal',runId:item.runId,sessionId:target,status:'succeeded',finalization});
          item.resolve({text:marker,finalization});pendingRun=null;
          await waitUI('!document.querySelector("button[aria-label=停止生成]")');
          await wait(()=>stored.chats.find(chat=>chat.id===target)?.messages.at(-1)?.text===marker,'completed body '+target);
          completed.push({sessionId:target,runId:item.runId});
        }
        await input('DELETE_DRAFT_MARKER');
        await click('button[aria-label="添加内容"]');await click('.attachment-menu button[role="menuitem"]');
        await wait(()=>pickPending,'delete marker attachment');pickResolve([file('delete-file','DELETE_ATTACHMENT_MARKER')]);pickPending=false;
        await waitUI('document.querySelectorAll(".composer .attachment-chip").length===1');
        await wait(()=>JSON.stringify(stored.drafts).includes('DELETE_ATTACHMENT_MARKER'),'delete marker persisted');
        await waitUI('window.__qaConversationMemory().positions.some(([id])=>id==="chat")');
        const memoryBeforeDelete=await memory();assert.equal(memoryBeforeDelete.jobs.length,2);assert.match(JSON.stringify(memoryBeforeDelete),/DELETE_JOB_BODY_MARKER/);
        saveFailure=true;
        await click('button[aria-label="合成聊天 的菜单"]');await textClick('[role="menuitem"]','删除聊天');
        assert.match(await run('document.querySelector("[role=dialog]").textContent'),/独立资料空间中的资料与磁盘原文件保留/);
        await textClick('[role="dialog"] .danger-button','删除');
        await waitUI('document.querySelector(".deletion-pending")?.textContent.includes("尚未完成")');
        assert.match(await fs.readFile(workspaceFile,'utf8'),/DELETE_ATTACHMENT_MARKER/);
        assert.equal(forgotten.length,0,'native forgetting waits for successful workspace persistence');
        assert.equal((await memory()).jobs.length,2,'workspace save failure must not claim successful cache cleanup');
        saveFailure=false;forgetFailure=true;await textClick('.deletion-pending button','重试完成删除');
        await waitUI('document.querySelector(".deletion-pending")?.textContent.includes("SYNTHETIC_FORGET_UNCONFIRMED")');
        assert.equal(forgotten.length,0);assert.equal((await memory()).jobs.length,2,'unconfirmed host forget must retain retryable job refs');
        assert((await memory()).positions.some(([id])=>id==='chat'),'unconfirmed host forget must not clear target position');
        forgetFailure=false;await textClick('.deletion-pending button','重试完成删除');
        await wait(()=>!!forgetRelease,'host forget awaiting confirmation');
        assert.equal((await memory()).jobs.length,2,'an unresolved host forget is not confirmation');
        forgetRelease();forgetRelease=null;
        await waitUI('!document.querySelector(".deletion-pending")');
        const memoryAfterDelete=await memory(),keptRun=completed[0].runId,deletedRun=completed[1].runId;
        assert.deepEqual(memoryAfterDelete.jobs.map(([id])=>id),[keptRun]);
        assert.deepEqual(memoryAfterDelete.jobs[0],memoryBeforeDelete.jobs.find(([id])=>id===keptRun),'other chat job remains intact');
        assert(!memoryAfterDelete.positions.some(([id])=>id==='chat'));assert(memoryAfterDelete.positions.some(([id])=>id==='keep-chat'));
        assert(!Object.hasOwn(memoryAfterDelete.draftScopes,'chat:chat'));assert(Object.hasOwn(memoryAfterDelete.draftScopes,'chat:keep-chat'));
        assert.doesNotMatch(JSON.stringify(memoryAfterDelete),/DELETE_JOB_BODY_MARKER/);assert.match(JSON.stringify(memoryAfterDelete),/KEEP_JOB_BODY_MARKER/);
        for(const session of ['chat',undefined])window.webContents.send('RuntimeEvent',{type:'run/terminal',runId:deletedRun,...(session?{sessionId:session}:{}),status:'succeeded',output:{text:'DELETE_JOB_BODY_MARKER'},finalization:{runId:deletedRun,executionStatus:'completed',persistenceStatus:'saved',processStatus:'exited',eventWatermark:9}});
        window.webContents.send('RuntimeEvent',{type:'draft',runId:deletedRun,sessionId:'chat',text:'DELETE_JOB_BODY_MARKER'});
        window.webContents.send('RuntimeEvent',{type:'question',runId:deletedRun,sessionId:'chat',requestId:'deleted-question',questions:[{id:'q',question:'DELETE_JOB_BODY_MARKER',options:[]}]});
        window.webContents.send('RuntimeEvent',{type:'tool/result',runId:keptRun,sessionId:'keep-chat',label:'KEEP_LATE_EVENT_MARKER'});
        await waitUI('window.__qaConversationMemory().events.some(event=>event.label==="KEEP_LATE_EVENT_MARKER")');
        const afterLate=await memory();assert.equal(afterLate.jobs.length,1);assert.equal(afterLate.question,null);assert.doesNotMatch(JSON.stringify(afterLate),/DELETE_JOB_BODY_MARKER/);assert.match(JSON.stringify(afterLate),/KEEP_LATE_EVENT_MARKER/);
        await record('forget失败或未确认不提前清缓存；成功仅清目标job/轨迹/滚动缓存；迟到事件不复活',{retainedRunId:keptRun,removedRunId:deletedRun});
        const deletedBytes=await fs.readFile(workspaceFile,'utf8');
        assert.doesNotMatch(deletedBytes,/DELETE_CHAT_MESSAGE_MARKER|DELETE_DRAFT_MARKER|DELETE_ATTACHMENT_MARKER|DELETE_JOB_BODY_MARKER/);
        assert.match(deletedBytes,/third.txt/);assert.deepEqual(forgotten,['chat']);
        await load(JSON.parse(deletedBytes));
        assert.equal(await run('document.querySelectorAll("[data-chat-id=chat]").length'),0);
        await record('删除写盘故障可见且不提前forget，重试后文件字节与重启均无目标marker',{forgotten,bytes:Buffer.byteLength(deletedBytes)});

        const orphan=seed();orphan.drafts={'chat:gone':{...orphan.drafts['chat:chat'],chatId:'gone',draftId:'gone',text:'ORPHAN_RESTORE_MARKER'}};
        await load(orphan);await textClick('.orphan-drafts button','恢复或删除');await textClick('[role="dialog"] .secondary-button','恢复到当前空间');
        await waitUI('document.querySelector('+JSON.stringify(field)+').value==="ORPHAN_RESTORE_MARKER"');
        assert.equal(await run('document.querySelectorAll(".composer .attachment-chip").length'),2);
        await record('历史孤儿不会静默删除，显式恢复后正文附件可见');

        const f={runId:'automation-run',executionStatus:'completed',persistenceStatus:'failed',processStatus:'exited',eventWatermark:1};
        const outcome={id:'automation-run',runId:'automation-run',taskId:'synthetic-task',workspaceId:'office-home',status:'completed',name:'合成自动化',startedAt:1,finishedAt:2,finalization:f,persistenceError:{code:'AUTOMATION_SAVE_FAILED',stage:'persist',message:'合成写入失败'},result:{chatId:'automation-chat',targetKind:'new',projectId:null,mode:'office',text:'PENDING_AUTOMATION_BODY_MARKER',finalization:f}};
        automation={revision:3,tasks:[],runs:[outcome],pendingOutcomes:[outcome],persistenceError:{code:'AUTOMATION_SAVE_FAILED',message:'合成写入失败',runIds:['automation-run']}};
        window.webContents.send('AutomationChange',automation);
        await waitUI('!!document.querySelector(".automation-save-pending")');
        const beforeRetry=runs;await textClick('.automation-save-pending button','重试保存结果');
        await waitUI('!document.querySelector(".automation-save-pending")');
        assert.equal(runs,beforeRetry);assert.equal(saveRetries,1);
        await wait(()=>stored.chats.some(chat=>chat.messages.some(message=>message.text==='PENDING_AUTOMATION_BODY_MARKER')),'pending result retained');
        await record('自动化待保存正文可读，重试保存不增加runPrepared次数',{saveRetries,executionCount:runs});
        assert.deepEqual(errors,[],'Unexpected renderer errors');
        await fs.writeFile(path.join(__dirname,'summary.json'),JSON.stringify({passed:true,records:records.length,runs,saveRetries,cleanupRetries,forgotten,rendererErrors:errors},null,2));
      }catch(error){console.error(error.stack);await fs.writeFile(path.join(__dirname,'failure.json'),JSON.stringify({error:error.stack,records,rendererErrors:errors},null,2));app.exitCode=1;}
      finally{window.destroy();app.exit(app.exitCode||0);}
    }).catch(error=>{console.error(error.stack);app.exit(1);});
  `);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[path.join(directory,'main.cjs')],{env,signal:context.signal,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  const [code]=await once(child,'exit');
  await writeFile(path.join(directory,'electron.log'),output);
  assert.equal(code,0,output+`\nEvidence: ${directory}`);
  const summary=JSON.parse(await readFile(path.join(directory,'summary.json'),'utf8'));
  assert.equal(summary.passed,true);assert.equal(summary.records,11);assert.equal(summary.rendererErrors.length,0);
  console.log(`Evidence: ${directory}; ${summary.records} business checkpoints passed.`);
});

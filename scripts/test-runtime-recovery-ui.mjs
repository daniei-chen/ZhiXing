import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {connectUi} from './qa-cdp.mjs';

// Lead runs this against ONE idle, synthetic, packaged Windows profile.
// No product debug API, fake terminal event, plaintext credential read, clipboard
// operation, native process replacement, or replacement automation/runtime is used.
const repository=path.resolve(import.meta.dirname,'..');
const fixtureOnly=process.argv.includes('--check-fixtures');
const rendererPort=Number(process.env.QA_PORT||process.env.ZHIXING_QA_PORT||9343);
const mainPort=Number(process.env.QA_MAIN_PORT||process.env.MAIN_PORT||9344);
const projectId=process.env.QA_PROJECT_ID||'qa-0122-project';
const evidence=path.resolve(process.env.QA_EVIDENCE||path.join(repository,'.preview/qa-0.12.2-audit/agent-c/runtime-recovery'));
const id=`recovery-${Date.now().toString(36)}-${crypto.randomUUID().slice(0,6)}`;
const mainKey=`__zhixing_${id.replaceAll('-','_')}`;
const sessionId=`${id}-manual`,taskName=`${id}-scheduled`;
const manualMarker=`${id}_R03_VALIDATED_BODY`,autoMarker=`${id}_R04_CALCULATED_42`;
const field='textarea[aria-label="聊天输入框"]';
const records=[],requests=[],toolReceipts=[],fixtureErrors=[];
const abort=new AbortController();
let ui,main,host,leaseTimer,primaryError,cleanupError,stage='setup',providerId,taskId;
let captureInstalled=false;
await fs.mkdir(evidence,{recursive:true});
const baseline={id,startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),layer:fixtureOnly?'Synthetic loopback HTTP and strict JSON restoration fixtures only; no Windows product or Harness execution':'Windows packaged UI + actual RuntimeManager/AutomationService + real Harness + loopback; no cloud'};

// JSON records: ignore object-key insertion order, but compare every key/value,
// primitive type, array length and indexed element. No restoration fields are omitted.
function sameJsonData(left,right){
  if(Object.is(left,right))return true;
  if(left===null||right===null||typeof left!=='object'||typeof right!=='object')return false;
  const array=Array.isArray(left);
  if(array!==Array.isArray(right)||(array&&left.length!==right.length))return false;
  const leftKeys=Object.keys(left).sort(),rightKeys=Object.keys(right).sort();
  return leftKeys.length===rightKeys.length&&leftKeys.every((key,index)=>key===rightKeys[index]&&sameJsonData(left[key],right[key]));
}

// Both functions are serialized together; the inspected main receives the exact
// comparator exercised by --check-fixtures, without a controller closure.
async function compareRestoredRecords(key,sameJsonData){
  const s=globalThis[key],windows=process.mainModule.require('electron').BrowserWindow.getAllWindows(),window=windows.find(window=>window.webContents.getURL().startsWith('zhixing://app/'));
  const actual=await window.webContents.executeJavaScript('window.zhixing.loadWorkspace()');
  return {workspaceRestored:sameJsonData(actual,s.originalWorkspace),automationRestored:sameJsonData(s.automation.state,s.originalAutomationState),workspaceRawEqual:JSON.stringify(actual)===JSON.stringify(s.originalWorkspace),automationRawEqual:JSON.stringify(s.automation.state)===JSON.stringify(s.originalAutomationState)};
}

function parseToolValue(content){
  if(typeof content==='string'){try{return parseToolValue(JSON.parse(content));}catch{return null;}}
  if(Array.isArray(content)){for(const item of content){const found=parseToolValue(item);if(found!==null)return found;}return null;}
  if(!content||typeof content!=='object')return null;
  if(content.operation==='sum'&&content.count===2&&typeof content.value==='number')return content.value;
  for(const value of Object.values(content)){const found=parseToolValue(value);if(found!==null)return found;}
  return null;
}

function currentAuditTask(messages){
  for(let index=messages.length-1;index>=0;index--){
    const message=messages[index];if(message.role!=='user')continue;
    const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.filter(part=>typeof part?.text==='string').map(part=>part.text).join('\n'):'';
    if(/^\s*<system-reminder(?:\s|>)/i.test(text)||/^\s*Time sampled while preparing turn \d+, step \d+:/i.test(text))continue;
    const heading=/(?:^|\r?\n)【本次交办】[ \t]*\r?\n/.exec(text);
    if(heading)return {messageIndex:index,text:text.slice(heading.index+heading[0].length).split(/\r?\n[ \t]*【资料 \d+[：:]/,1)[0].trim()};
  }
  throw new Error('QA routing could not find a current 【本次交办】 user message');
}

function completion(response,body,{text,tool}){
  const toolCall=tool&&{id:`${id}-calculate`,type:'function',function:{name:'office_calculate',arguments:JSON.stringify({numbers:[20,22],operation:'sum'})}};
  const reason=tool?'tool_calls':'stop';
  if(!body.stream){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({id:'recovery-fixture',object:'chat.completion',created:1,model:'qa-recovery',choices:[{index:0,message:{role:'assistant',content:tool?null:text,...(tool?{tool_calls:[toolCall]}:{})},finish_reason:reason}],usage:{prompt_tokens:20,completion_tokens:12,total_tokens:32}}));return;}
  response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const chunk=(delta,finish_reason=null)=>'data: '+JSON.stringify({id:'recovery-fixture',object:'chat.completion.chunk',created:1,model:'qa-recovery',choices:[{index:0,delta,finish_reason}]})+'\n\n';
  response.end(chunk(tool?{role:'assistant',tool_calls:[{index:0,...toolCall}]}:{role:'assistant',content:text})+chunk({},reason)+'data: [DONE]\n\n');
}

const server=http.createServer(async(request,response)=>{
  try{
    if(request.url==='/v1/models'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({object:'list',data:[{id:'qa-recovery',object:'model',owned_by:'local-fixture'}]}));return;}
    assert.equal(request.url,'/v1/chat/completions');
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(requests.length>=12)throw new Error('More than 12 model requests: unexpected repeat execution');
    requests.push({sequence:requests.length+1,at:new Date().toISOString(),body});
    const task=currentAuditTask(body.messages||[]),auto=task.text.includes(autoMarker);
    if(auto){
      const result=(body.messages||[]).find(message=>message.role==='tool'&&message.tool_call_id===`${id}-calculate`);
      if(result){const value=parseToolValue(result.content);assert.equal(value,42,'The real calculate tool must return 42');toolReceipts.push({request:requests.length,toolCallId:result.tool_call_id,value});completion(response,body,{text:autoMarker});}
      else {assert(body.tools?.some(tool=>tool.function?.name==='office_calculate'),'The actual model request must expose the native calculate tool');completion(response,body,{tool:true});}
    }else{
      assert(task.text.includes(manualMarker),'Unexpected non-fixture prompt');
      completion(response,body,{text:manualMarker});
    }
  }catch(error){fixtureErrors.push(error.message);if(!response.headersSent)response.writeHead(422,{'content-type':'application/json'});response.end(JSON.stringify({error:{message:error.message,type:'invalid_request_error'}}));}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
const cancelled=()=>{if(abort.signal.aborted)throw abort.signal.reason;};
async function wait(check,label,timeout=30000,allowAborted=false){const limit=Date.now()+timeout;let last;while(Date.now()<limit){if(!allowAborted)cancelled();try{if(await check())return;}catch(error){last=error;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Timed out ${label}${last?`: ${last.message}`:''}`);}
const evaluate=(fn,...args)=>main.evaluate(`(${fn.toString()})(${args.map(arg=>JSON.stringify(arg)).join(',')})`);
const workspace=()=>ui.evaluate('window.zhixing.loadWorkspace()');
const automations=()=>ui.evaluate('window.zhixing.listAutomations()');
const saveSettled=()=>ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"',20000);
async function flushEvidence(){await fs.writeFile(path.join(evidence,'outbound-requests.json'),JSON.stringify({requests,toolReceipts,fixtureErrors},null,2));await fs.writeFile(path.join(evidence,'journey.json'),JSON.stringify({...baseline,stage,records},null,2));}
async function record(name,details={}){records.push({name,status:'passed',at:new Date().toISOString(),details});await flushEvidence();console.log(`PASS ${name}`);}
async function clickSelector(selector){const label=await ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(node=>node.getClientRects().length);if(nodes.length!==1)throw Error('Expected one visible control, got '+nodes.length);return nodes[0].getAttribute('aria-label')||nodes[0].textContent.trim();})()`);await ui.click(label,selector);}
async function ready(){await ui.waitFor(`!!document.querySelector(${JSON.stringify(field)})&&!document.querySelector(${JSON.stringify(field)}).disabled`,30000);await saveSettled();if(await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")'))await ui.click('展开侧栏');}
async function reload(){await ui.send('Page.reload');await wait(async()=>{await ready();return true;},'renderer reload',45000);}
async function dismissToast(){if(await ui.evaluate('!!document.querySelector(".toast-dismiss")'))await ui.click('关闭错误提示');}
async function samplePersistent(selector,expected,durationMs=1600){const deadline=Date.now()+durationMs;let samples=0;do{cancelled();assert.equal(await ui.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});return !!node&&node.getClientRects().length>0&&node.textContent.includes(${JSON.stringify(expected)});})()`),true,`Persistent UI missing: ${selector}`);samples++;await new Promise(resolve=>setTimeout(resolve,180));}while(Date.now()<deadline);return samples;}

// The function is serialized into the inspected main process, so it has no
// controller closures. Backups stay in main memory and are never logged.
async function installCapture(key,directory,manualSession,manualText,originalWorkspace){
  const require=process.mainModule.require,electron=require('electron'),path=require('node:path'),url=require('node:url'),vm=require('node:vm');
  if(globalThis[key])throw new Error('A recovery QA session already owns this key');
  if(!vm.constants?.USE_MAIN_CONTEXT_DEFAULT_LOADER)throw new Error('Recovery QA requires the main-context default ESM loader');
  // Inspector Runtime.evaluate has no dynamic-import callback. Compile only
  // the import expression with Node's main loader, using the app's exact URLs:
  // no cache-busting query, copied source, new context, or replacement class.
  const loadPackagedModule=relative=>vm.runInThisContext(
    'import('+JSON.stringify(url.pathToFileURL(path.join(electron.app.getAppPath(),relative)).href)+')',
    {filename:'zhixing-recovery-qa-module-loader.cjs',importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}
  );
  const {RuntimeManager}=await loadPackagedModule('electron/runtime.mjs');
  const {AutomationService}=await loadPackagedModule('electron/automation-service.mjs');
  const runtimeDescriptor=Object.getOwnPropertyDescriptor(RuntimeManager.prototype,'getCleanupStatus');
  const automationDescriptor=Object.getOwnPropertyDescriptor(AutomationService.prototype,'snapshot');
  if(typeof runtimeDescriptor?.value!=='function'||typeof automationDescriptor?.value!=='function')throw new Error('The candidate does not implement the agreed recovery contract');
  const state={directory,manualSession,manualText,originalWorkspace,RuntimeManager,AutomationService,runtimeDescriptor,automationDescriptor,sessions:new Set([manualSession]),ownRunIds:new Set(),attempts:[],events:[],harnesses:[],writeFaults:0,failTerminal:false,blockClose:true,deadline:Date.now()+120000};
  globalThis[key]=state;
  Object.defineProperty(RuntimeManager.prototype,'getCleanupStatus',{...runtimeDescriptor,value:function(...args){state.runtime=this;Object.defineProperty(RuntimeManager.prototype,'getCleanupStatus',runtimeDescriptor);return runtimeDescriptor.value.apply(this,args);}});
  Object.defineProperty(AutomationService.prototype,'snapshot',{...automationDescriptor,value:function(...args){state.automation=this;Object.defineProperty(AutomationService.prototype,'snapshot',automationDescriptor);return automationDescriptor.value.apply(this,args);}});
  return {armed:true};
}

async function finishSetup(key){
  const s=globalThis[key],require=process.mainModule.require,e=require('electron'),fs=require('node:fs/promises'),path=require('node:path');
  Object.defineProperty(s.RuntimeManager.prototype,'getCleanupStatus',s.runtimeDescriptor);
  Object.defineProperty(s.AutomationService.prototype,'snapshot',s.automationDescriptor);
  if(!s.runtime||!s.automation||s.automation.runtime!==s.runtime)throw new Error('The real bridge did not capture the same host services');
  if(s.runtime.runs.size||s.runtime.busy.size||s.automation.active.size||s.automation.pendingOutcomes.size||s.automation.state.tasks.some(task=>task.enabled))throw new Error('The synthetic QA profile must be idle, with no pending outcomes or enabled tasks');
  if(!Array.isArray(s.runtime.cleanupRetryDelays))throw new Error('Candidate automatic cleanup retry contract changed');
  s.originalAutomationState=structuredClone(s.automation.state);
  s.originalPreparedIds=new Set(s.runtime.prepared.keys());
  s.providerName=s.manualSession.replace(/-manual$/,'');
  s.original={createHarness:s.runtime.createHarness,run:s.runtime.run,onEvent:s.runtime.onEvent,cleanupRetryDelays:s.runtime.cleanupRetryDelays,write:s.automation.write};
  s.runtimeDescriptors=Object.fromEntries(['createHarness','run','onEvent','cleanupRetryDelays'].map(name=>[name,Object.getOwnPropertyDescriptor(s.runtime,name)]));
  s.writeDescriptor=Object.getOwnPropertyDescriptor(s.automation,'write');
  s.restoreMethods=()=>{for(const [name,descriptor]of Object.entries(s.runtimeDescriptors)){if(descriptor)Object.defineProperty(s.runtime,name,descriptor);else delete s.runtime[name];}if(s.writeDescriptor)Object.defineProperty(s.automation,'write',s.writeDescriptor);else delete s.automation.write;};
  s.quitWarnings=[];
  s.restoreQuitAdapter=()=>{
    if(s.quitObserver){e.app.removeListener('before-quit',s.quitObserver);s.quitObserver=null;}
    if(s.dialogAdapterInstalled){if(s.dialogDescriptor)Object.defineProperty(e.dialog,'showErrorBox',s.dialogDescriptor);else delete e.dialog.showErrorBox;s.dialogAdapterInstalled=false;}
  };
  s.backups=new Map();
  for(const name of ['workspace.bin','automations.bin','providers.bin','config.json']){const target=path.join(e.app.getPath('userData'),'zhixing',name);try{s.backups.set(target,await fs.readFile(target));}catch(error){if(error.code!=='ENOENT')throw error;s.backups.set(target,null);}}
  s.runtime.run=async function(options,...rest){
    const automatic=s.taskId&&s.automation.active.get(s.taskId)?.runId===options.runId;
    const owned=options.sessionId===s.manualSession||automatic;
    if(!owned)throw new Error('Recovery QA refused an unrelated runtime invocation');
    s.ownRunIds.add(options.runId);s.sessions.add(options.sessionId);
    s.attempts.push({runId:options.runId,sessionId:options.sessionId,kind:automatic?'automation':'manual',blocked:this.busy.has(options.sessionId)||this.runs.has(options.runId)});
    return s.original.run.call(this,options,...rest);
  };
  s.runtime.onEvent=function(event){if(s.ownRunIds.has(event.runId))s.events.push({runId:event.runId,type:event.type,label:event.label,status:event.status,finalization:event.finalization&&structuredClone(event.finalization)});return s.original.onEvent?.call(this,event);};
  s.runtime.cleanupRetryDelays=[];
  s.runtime.createHarness=async function(...args){
    const harness=await s.original.createHarness.apply(this,args);
    const entry={harness,close:harness.close,retryClose:harness.retryClose,child:harness.zhixingProcess,sessionId:path.basename(args[0]),closeRejections:0,retryCloseRejections:0,descriptors:Object.fromEntries(['close','retryClose'].map(name=>[name,Object.getOwnPropertyDescriptor(harness,name)]))};
    entry.restoreMethods=()=>{for(const [name,descriptor]of Object.entries(entry.descriptors)){if(descriptor)Object.defineProperty(harness,name,descriptor);else delete harness[name];}};
    if(!entry.child||!Number.isInteger(entry.child.pid))throw new Error('The actual Harness child handle is unavailable');
    s.harnesses.push(entry);
    if(entry.sessionId===s.manualSession){
      if(typeof entry.close!=='function'||typeof entry.retryClose!=='function')throw new Error('The actual Harness must expose close and retryClose before quit-gate QA');
      harness.close=function(...parameters){if(s.blockClose){entry.closeRejections++;throw Object.assign(new Error('QA_CLOSE_UNCONFIRMED: intentionally retained actual child'),{code:'QA_CLOSE_UNCONFIRMED',stage:'close'});}return entry.close.apply(this,parameters);};
      harness.retryClose=function(...parameters){if(s.blockClose){entry.retryCloseRejections++;throw Object.assign(new Error('QA_RETRY_CLOSE_UNCONFIRMED: intentionally retained actual child'),{code:'QA_RETRY_CLOSE_UNCONFIRMED',stage:'close'});}return entry.retryClose.apply(this,parameters);};
    }
    return harness;
  };
  s.automation.write=async function(draft){const terminal=s.taskId&&draft.runs.some(run=>run.taskId===s.taskId&&run.status!=='running'&&Number.isFinite(run.finishedAt));if(s.failTerminal&&terminal){s.writeFaults++;throw Object.assign(new Error('QA_TERMINAL_ENOSPC'),{code:'ENOSPC'});}return s.original.write.call(this,draft);};
  // Restores methods immediately; then joins/cancels only exact handles owned by
  // this script, restores logical app data and encrypted fixture backups, reloads.
  s.restore=async function(reason){
    if(s.restorePromise)return s.restorePromise;
    s.restorePromise=(async()=>{
      clearInterval(s.watchdog);s.blockClose=false;s.failTerminal=false;
      s.restoreQuitAdapter();
      Object.defineProperty(s.RuntimeManager.prototype,'getCleanupStatus',s.runtimeDescriptor);Object.defineProperty(s.AutomationService.prototype,'snapshot',s.automationDescriptor);
      s.restoreMethods();
      for(const entry of s.harnesses)entry.restoreMethods();
      const problems=[],step=async(label,operation)=>{try{return await operation();}catch(error){problems.push({step:label,message:error.message});}};
      const bounded=async(operation,milliseconds=20000)=>{let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('QA restoration join timeout')),milliseconds);})]);}finally{clearTimeout(timer);}};
      if(s.taskId&&s.automation.active.has(s.taskId))await step('cancel-own-automation',()=>bounded(()=>s.automation.cancel(s.taskId)));
      for(const runId of s.ownRunIds){if(s.runtime.runs.has(runId))await step('cancel-own-run',()=>s.runtime.cancel(runId));}
      for(const entry of s.harnesses){
        const alive=entry.child.exitCode===null&&!entry.child.signalCode;
        if(alive)await step('close-own-child',()=>bounded(()=>entry.close.call(entry.harness)));
        if(entry.child.exitCode===null&&!entry.child.signalCode&&entry.retryClose)await step('reap-own-child',()=>bounded(()=>entry.retryClose.call(entry.harness)));
      }
      for(const runId of s.ownRunIds){const active=s.runtime.runs.get(runId);if(active?.status==='cleanup_pending')await step('confirm-own-cleanup',()=>bounded(()=>s.runtime.retryCleanup(runId)));else if(active)await step('join-own-run',()=>bounded(()=>active.settled));}
      for(const preparedId of s.runtime.prepared.keys())if(!s.originalPreparedIds.has(preparedId))s.runtime.prepared.delete(preparedId);
      for(const runId of s.ownRunIds)if(!s.runtime.runs.has(runId))s.runtime.runSettlements.delete(runId);
      for(const [runId,outcome]of s.automation.pendingOutcomes)if(outcome.taskId===s.taskId)await step('save-own-pending-result',()=>bounded(()=>s.automation.retrySave(runId)));
      await step('drain-automation-writes',()=>bounded(()=>s.automation.tail));
      s.automation.state=structuredClone(s.originalAutomationState);
      for(const [approvalId,approval]of s.automation.approvals)if(approval.taskId===s.taskId)s.automation.approvals.delete(approvalId);
      for(const [runId,outcome]of s.automation.pendingOutcomes)if(outcome.taskId===s.taskId)s.automation.pendingOutcomes.delete(runId);
      await step('restore-automation-records',()=>s.original.write.call(s.automation,s.automation.state));s.automation.changed();
      const window=e.BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('zhixing://app/'));
      if(!window)problems.push({step:'restore-profile',message:'The QA renderer disappeared; encrypted backups remain in this main QA session'});
      else{
        const invoke=expression=>window.webContents.executeJavaScript(expression);
        if(!s.providerId)await step('find-synthetic-provider',async()=>{const status=await invoke('window.zhixing.runtimeStatus()');s.providerId=status.providers?.find(provider=>provider.name===s.providerName)?.id;});
        if(s.providerId)await step('remove-synthetic-provider',()=>invoke('window.zhixing.removeProvider('+JSON.stringify(s.providerId)+')'));
        for(const sessionId of s.sessions)await step('forget-own-session',()=>invoke('window.zhixing.forgetSession('+JSON.stringify(sessionId)+')'));
        await new Promise(resolve=>setTimeout(resolve,150));
        await step('restore-workspace',()=>invoke('window.zhixing.saveWorkspace('+JSON.stringify(s.originalWorkspace)+')'));
        for(const [file,bytes]of s.backups)await step('restore-encrypted-backup',()=>bytes===null?fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;}):fs.writeFile(file,bytes));
        window.webContents.reload();
      }
      const liveChildren=s.harnesses.filter(entry=>entry.child.exitCode===null&&!entry.child.signalCode).map(entry=>entry.child.pid);
      if(liveChildren.length)problems.push({step:'child-exit',message:'Owned native child handles are still alive'});
      const remainingOwnedRuns=[...s.ownRunIds].filter(runId=>s.runtime.runs.has(runId));
      if(remainingOwnedRuns.length)problems.push({step:'run-settlement',message:'Owned runs still require cleanup'});
      const dialogAdapterRestored=!s.dialogAdapterInstalled&&(!s.originalShowErrorBox||e.dialog.showErrorBox===s.originalShowErrorBox),harnessMethodsRestored=s.harnesses.every(entry=>entry.harness.close===entry.close&&entry.harness.retryClose===entry.retryClose);
      const result={reason,methodsRestored:s.runtime.createHarness===s.original.createHarness&&s.runtime.run===s.original.run&&s.runtime.onEvent===s.original.onEvent&&s.automation.write===s.original.write&&s.RuntimeManager.prototype.getCleanupStatus===s.runtimeDescriptor.value&&s.AutomationService.prototype.snapshot===s.automationDescriptor.value&&dialogAdapterRestored&&!s.quitObserver&&harnessMethodsRestored,dialogAdapterRestored,harnessMethodsRestored,beforeQuitObserverRemoved:!s.quitObserver,nativeWarningDialogUx:'not tested; showErrorBox display adapter captured text only',clipboard:'untouched: no clipboard API or clipboard keyboard shortcut used',ownedChildCount:s.harnesses.length,liveChildren,remainingOwnedRuns,problems};
      s.restoration=result;await fs.writeFile(path.join(s.directory,'restoration.json'),JSON.stringify(result,null,2));return result;
    })();return s.restorePromise;
  };
  s.watchdog=setInterval(()=>{if(Date.now()>s.deadline)void s.restore('controller-lease-expired').catch(error=>{s.restoreError=error.message;});},2000);s.watchdog.unref?.();
  return {captured:true,prototypeMethodsRestored:true,automaticCleanupRetriesDisabled:s.runtime.cleanupRetryDelays.length===0};
}

function mainStatus(key){
  const s=globalThis[key];
  return {pid:process.pid,busy:[...s.runtime.busy],attempts:s.attempts,writeFaults:s.writeFaults,harnesses:s.harnesses.map(entry=>({pid:entry.child.pid,sessionId:entry.sessionId,exited:entry.child.exitCode!==null||!!entry.child.signalCode,closeRejections:entry.closeRejections,retryCloseRejections:entry.retryCloseRejections})),cleanup:s.runtime.getCleanupStatus(),autoActive:s.taskId?s.automation.active.has(s.taskId):false,events:s.events,restoreStarted:!!s.restorePromise,quitProbe:s.quitProbe?{...s.quitProbe,windowAlive:!s.quitWindow.isDestroyed()&&!s.quitWindow.webContents.isDestroyed(),windowVisible:!s.quitWindow.isDestroyed()&&s.quitWindow.isVisible(),warnings:s.quitWarnings,shutdownRecovered:!s.runtime.closing&&!s.automation.closed,dialogAdapterInstalled:!!s.dialogAdapterInstalled}:null};
}

function armQuitProbe(key,runId){
  const s=globalThis[key],e=process.mainModule.require('electron');
  if(s.restorePromise||!s.blockClose||s.harnesses.length!==1||s.automation.active.size||s.automation.pendingOutcomes.size||s.automation.state.tasks.some(task=>task.enabled))throw new Error('Quit-gate QA requires only this script\'s single quarantined child and no other active work');
  const active=s.runtime.runs.get(runId),entry=s.harnesses[0],windows=e.BrowserWindow.getAllWindows().filter(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('zhixing://app/'));
  if(s.runtime.runs.size!==1||s.runtime.busy.size!==1||!s.runtime.busy.has(s.manualSession)||active?.sessionId!==s.manualSession||active?.status!=='cleanup_pending'||entry.child.exitCode!==null||entry.child.signalCode||windows.length!==1)throw new Error('Refusing a quit probe outside the exact owned cleanup_pending session/window');
  s.quitWindow=windows[0];s.quitProbe={runId,pid:process.pid,windowId:s.quitWindow.id,beforeQuitCount:0};
  s.dialogDescriptor=Object.getOwnPropertyDescriptor(e.dialog,'showErrorBox');s.originalShowErrorBox=e.dialog.showErrorBox;
  const descriptor=s.dialogDescriptor&&'value'in s.dialogDescriptor?{...s.dialogDescriptor}:{configurable:s.dialogDescriptor?.configurable??true,enumerable:s.dialogDescriptor?.enumerable??true,writable:true};
  s.dialogAdapterInstalled=true;
  Object.defineProperty(e.dialog,'showErrorBox',{...descriptor,value:function(title,content){s.quitWarnings.push({title:String(title),content:String(content),at:Date.now()});}});
  // Observation only: do not replace quit/close or prevent any quit event here.
  s.quitObserver=()=>{s.quitProbe.beforeQuitCount++;};e.app.on('before-quit',s.quitObserver);
  return {pid:process.pid,windowId:s.quitWindow.id,runId};
}

async function fixtureSelfCheck(){
  const original={body:'SYNTHETIC_BODY',attachments:[{id:'a',text:'ATTACHMENT_A',size:12},{id:'b',text:'ATTACHMENT_B',size:24}],count:42,options:{enabled:true,value:null}};
  const reordered={options:{value:null,enabled:true},count:42,attachments:[{size:12,text:'ATTACHMENT_A',id:'a'},{size:24,text:'ATTACHMENT_B',id:'b'}],body:'SYNTHETIC_BODY'};
  assert.notEqual(JSON.stringify(original),JSON.stringify(reordered),'Fixture must reproduce the original key-order false negative');
  assert.equal(sameJsonData(original,reordered),true,'Nested key insertion order alone must not fail restoration');
  const changes=[
    ['body',value=>{value.body='CHANGED_BODY';}],
    ['attachment body',value=>{value.attachments[0].text='CHANGED_ATTACHMENT';}],
    ['attachment id',value=>{value.attachments[0].id='changed-id';}],
    ['attachment number',value=>{value.attachments[0].size++;}],
    ['number',value=>{value.count++;}],
    ['number type',value=>{value.count='42';}],
    ['array order',value=>{value.attachments.reverse();}],
    ['array length',value=>{value.attachments.pop();}],
    ['missing field',value=>{delete value.body;}],
    ['extra field',value=>{value.extra=false;}],
    ['nested boolean',value=>{value.options.enabled=false;}],
    ['null value',value=>{value.options.value='';}],
  ];
  for(const [name,change]of changes){const changed=structuredClone(original);change(changed);assert.equal(sameJsonData(original,changed),false,'Restoration must reject changed '+name);}
  await record('JSON恢复夹具：递归键重排相等；正文/附件/数字/类型/数组顺序与长度/增删字段等变化严格不等',{equalCases:1,rejectedChanges:changes.map(([name])=>name)});
  const messages=(text,old)=>[{role:'user',content:'【本次交办】\n'+old},{role:'user',content:'任务模式：办公\n\n【本次交办】\n'+text},{role:'user',content:'<system-reminder>Current session and skills context.</system-reminder>'},{role:'user',content:'Time sampled while preparing turn 1, step 1: 2026-11-21T21:06:57+08:00[Asia/Shanghai]'}];
  const body={model:'qa-recovery',messages:messages(manualMarker,autoMarker),stream:true};
  assert.equal(body.messages.filter(message=>message.role==='user').length,4);assert.equal(currentAuditTask(body.messages).text,manualMarker);
  const normal=await fetch(endpoint+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(response=>response.text());assert(normal.includes(manualMarker));assert(normal.includes('[DONE]'));
  const auto={...body,messages:messages(autoMarker,manualMarker),tools:[{type:'function',function:{name:'office_calculate'}}]};
  assert.equal(currentAuditTask(auto.messages).text,autoMarker);
  const call=await fetch(endpoint+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(auto)}).then(response=>response.text());assert(call.includes('tool_calls'));assert(call.includes('office_calculate'));
  const result=await fetch(endpoint+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...auto,messages:[...auto.messages,{role:'tool',tool_call_id:`${id}-calculate`,content:JSON.stringify({operation:'sum',count:2,value:42})}]})}).then(response=>response.text());assert(result.includes(autoMarker));assert.equal(toolReceipts.length,1);assert.deepEqual(fixtureErrors,[]);
  await record('loopback模型夹具自检：4个user含旧任务和reminder/time-tail，SSE正文、工具调用和42回执；未连接Windows产品',{requests:requests.length,toolReceipts});
}

const signalHandlers=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,()=>abort.abort(new Error(`Controller interrupted by ${signal}`))]));
for(const [signal,handler]of signalHandlers)process.once(signal,handler);
try{
  if(fixtureOnly)await fixtureSelfCheck();
  else{
    assert.equal(process.platform,'win32');
    ui=await connectUi(rendererPort);main=await connectUi(mainPort,true);
    host=await evaluate(()=>{const e=process.mainModule.require('electron');return {pid:process.pid,exe:e.app.getPath('exe'),profile:e.app.getPath('userData'),version:e.app.getVersion()};});
    assert(/win-unpacked[\\/]知行\.exe$/i.test(host.exe),'Only the final unpacked Windows candidate is allowed');
    assert(host.profile.toLowerCase().includes(`${path.sep}.preview${path.sep}qa-0.12.2${path.sep}`.toLowerCase()),'Refusing a non-QA profile');
    if(process.env.QA_PROFILE)assert.equal(path.resolve(host.profile),path.resolve(process.env.QA_PROFILE));
    assert.equal(host.version,'0.12.2');
    await ready();assert.equal(await ui.evaluate('!!document.querySelector("button[aria-label=停止生成]")'),false);
    const originalWorkspace=await workspace(),project=originalWorkspace.projects.find(project=>project.id===projectId);assert(project?.directory,'Bind the synthetic qa-0122-project first');
    captureInstalled=true;await evaluate(installCapture,mainKey,evidence,sessionId,manualMarker,originalWorkspace);
    // These REAL bridge calls trigger capture; prototypes are restored by the hooks immediately.
    assert.deepEqual(await ui.evaluate('window.zhixing.runtimeCleanupStatus()'),[]);
    const originalAutomations=await automations();assert.equal(originalAutomations.pendingOutcomes.length,0);
    const setup=await evaluate(finishSetup,mainKey);assert(setup.prototypeMethodsRestored&&setup.automaticCleanupRetriesDisabled);
    leaseTimer=setInterval(()=>void evaluate(key=>{const s=globalThis[key];if(s&&!s.restorePromise)s.deadline=Date.now()+120000;},mainKey).catch(()=>{}),10000);leaseTimer.unref();
    await record('通过真实bridge捕获同一主机实例并立即恢复原型，拒绝非空闲/非QA档案',{host,setup});

    const configuration=await ui.evaluate(`window.zhixing.saveProvider(${JSON.stringify({name:id,protocol:'openai',baseUrl:endpoint,apiKey:'synthetic-runtime-recovery-key',reasoningStyle:'standard',manualModels:'qa-recovery',discover:true})})`);
    providerId=configuration.providers.find(provider=>provider.name===id)?.id;assert(providerId);await evaluate((key,provider)=>{globalThis[key].providerId=provider;},mainKey,providerId);
    const next={...originalWorkspace,workspaceId:project.workspaceId,settings:{...originalWorkspace.settings,persist:true,demo:false,notifications:false,modelProviderId:providerId,model:'qa-recovery',reasoning:'high',privacyMode:'redact'},chats:[...originalWorkspace.chats,{id:sessionId,title:sessionId,workspaceId:project.workspaceId,projectId,messages:[],createdAt:Date.now()}],drafts:{...originalWorkspace.drafts,[`chat:${sessionId}`]:{kind:'chat',draftId:sessionId,chatId:sessionId,workspaceId:project.workspaceId,projectId,revision:1,text:`只返回合成标记 ${manualMarker}`,files:[],updatedAt:Date.now()+1000}}};
    await ui.evaluate(`window.zhixing.saveWorkspace(${JSON.stringify(next)})`);await reload();
    const projectChatSelector=`.sidebar-projects .chat-row[data-chat-id="${sessionId}"] .chat-link`;
    await clickSelector(await ui.evaluate(`!!document.querySelector(${JSON.stringify(projectChatSelector)})`)?projectChatSelector:`.sidebar-scroll .chat-row[data-chat-id="${sessionId}"] .chat-link`);

    stage='R03 cleanup_pending';
    await ui.click('发送消息','.composer button');
    await ui.waitFor('!!document.querySelector(".runtime-cleanup-pending")',60000);await saveSettled();
    const pendingStatus=await evaluate(mainStatus,mainKey);const pending=pendingStatus.cleanup.find(item=>item.sessionId===sessionId);assert(pending);assert.equal(pending.finalization.executionStatus,'completed');assert.equal(pending.finalization.processStatus,'cleanup_pending');
    assert.equal(pendingStatus.harnesses.length,1);assert.equal(pendingStatus.harnesses[0].exited,false);assert.equal(pending.attempts,0);
    assert(await ui.evaluate(`document.querySelector('.transcript')?.textContent.includes(${JSON.stringify(manualMarker)})`));
    const samples=await samplePersistent('.runtime-cleanup-pending','内核退出尚未确认');
    const stable=await evaluate(mainStatus,mainKey);assert.equal(stable.cleanup[0].attempts,0);assert.equal(stable.harnesses[0].exited,false);
    await record('R03：真实已验证正文保留，真实child未退出；cleanup_pending持续且没有自动重试',{samples,runId:pending.runId,pid:stable.harnesses[0].pid,finalization:pending.finalization});

    const beforeRepeat=requests.length;
    await ui.waitFor('document.querySelector(".transcript .assistant-message:last-of-type button[aria-label=再次执行]")?.disabled===false');
    await ui.click('再次执行','.transcript .assistant-message:last-of-type .answer-actions button');
    await ui.waitFor('!document.querySelector("button[aria-label=停止生成]")&&[...document.querySelectorAll(".run-error-detail,.toast")].some(node=>/会话正在执行|先停止当前任务|正在执行|该会话正在运行/.test(node.textContent))',30000);
    assert.equal(requests.length,beforeRepeat);const blocked=await evaluate(mainStatus,mainKey);assert.equal(blocked.harnesses.length,1);assert.equal(blocked.cleanup[0].runId,pending.runId);
    await record('R03：UI再次执行同session被拒绝，没有第二个Harness或模型出站',{requestCount:requests.length,attempts:blocked.attempts,harnesses:blocked.harnesses});

    stage='R03 actual before-quit gate';
    let quitProbe,quitAfter,quitAdapterRestored;
    const requestsBeforeQuit=requests.length;
    try{
      quitProbe=await evaluate(armQuitProbe,mainKey,pending.runId);
      assert.equal(quitProbe.pid,host.pid);
      assert.equal(await ui.evaluate('window.zhixing.windowControl("close")'),true);
      await wait(async()=>{const status=await evaluate(mainStatus,mainKey);return status.quitProbe?.warnings.length>0&&status.quitProbe.shutdownRecovered;},'actual before-quit rejected with captured warning',45000);
      quitAfter=await evaluate(mainStatus,mainKey);
    }finally{
      // Restore native dialog display and BOTH close descriptors before any
      // assertions can throw or the UI is asked to retry the real cleanup.
      quitAdapterRestored=await evaluate(key=>{const s=globalThis[key],e=process.mainModule.require('electron');s.restoreQuitAdapter();s.blockClose=false;for(const entry of s.harnesses)entry.restoreMethods();return {dialog:!s.dialogAdapterInstalled&&(!s.originalShowErrorBox||e.dialog.showErrorBox===s.originalShowErrorBox),observerRemoved:!s.quitObserver,harnessMethods:s.harnesses.every(entry=>entry.harness.close===entry.close&&entry.harness.retryClose===entry.retryClose)};},mainKey);
    }
    assert(quitAdapterRestored.dialog&&quitAdapterRestored.observerRemoved&&quitAdapterRestored.harnessMethods);
    assert.equal(quitAfter.pid,host.pid);assert.doesNotThrow(()=>process.kill(host.pid,0),'The original isolated main process must remain alive');
    assert(quitAfter.quitProbe.windowAlive&&quitAfter.quitProbe.windowVisible);assert.equal(quitAfter.quitProbe.windowId,quitProbe.windowId);assert(quitAfter.quitProbe.beforeQuitCount>=1);
    assert(quitAfter.busy.includes(sessionId));assert.equal(quitAfter.cleanup.length,1);assert.equal(quitAfter.cleanup[0].runId,pending.runId);assert.equal(quitAfter.cleanup[0].finalization.processStatus,'cleanup_pending');
    assert.equal(quitAfter.harnesses.length,1);assert.equal(quitAfter.harnesses[0].pid,blocked.harnesses[0].pid);assert.equal(quitAfter.harnesses[0].exited,false);assert(quitAfter.harnesses[0].closeRejections>0);assert(quitAfter.harnesses[0].retryCloseRejections>blocked.harnesses[0].retryCloseRejections);
    assert.equal(quitAfter.attempts.length,blocked.attempts.length);assert.equal(requests.length,requestsBeforeQuit);
    assert(quitAfter.quitProbe.warnings.some(warning=>warning.title==='知行仍在运行'&&/退出准备未完成/.test(warning.content)&&/内核退出未确认/.test(warning.content)),'Capture the actual incomplete-exit warning from the product');
    await ui.waitFor('!!document.querySelector(".runtime-cleanup-pending")');
    const quitEvidence={probe:quitProbe,after:quitAfter,restored:quitAdapterRestored,requestCount:requests.length,nativeWarningDialogUx:'not tested; only showErrorBox display adapter captured text; actual before-quit and manager.close were unchanged'};
    await fs.writeFile(path.join(evidence,'quit-gate.json'),JSON.stringify(quitEvidence,null,2));
    await record('R03：真实bridge关窗触发before-quit，退出未确认时原窗口/进程及隔离保留；无新增模型请求或Harness，捕获退出警告',{...quitEvidence,nativeWarningDialogUx:'未测原生警告弹窗UX，仅替换showErrorBox展示适配器记录文本'});

    stage='R03 UI cleanup retry after rejected quit';
    await ui.click('重试清理','.runtime-cleanup-pending button');await ui.waitFor('!document.querySelector(".runtime-cleanup-pending")',45000);
    const cleaned=await evaluate(mainStatus,mainKey);assert.deepEqual(cleaned.cleanup,[]);assert.equal(cleaned.harnesses[0].exited,true);assert.equal(requests.length,beforeRepeat);
    await evaluate(key=>{const s=globalThis[key];s.runtime.createHarness=s.original.createHarness;s.runtime.cleanupRetryDelays=s.original.cleanupRetryDelays;},mainKey);
    await dismissToast();await ui.click('再次执行','.transcript .assistant-message:last-of-type .answer-actions button');
    await ui.waitFor(`!document.querySelector('button[aria-label=停止生成]')&&document.querySelector('.transcript .assistant-message:last-of-type')?.textContent.includes(${JSON.stringify(manualMarker)})`,60000);await saveSettled();
    const resumed=(await workspace()).chats.find(chat=>chat.id===sessionId).messages.at(-1);assert.equal(resumed.finalization.executionStatus,'completed');assert.equal(resumed.finalization.processStatus,'exited');assert.equal(requests.length,beforeRepeat+1);
    await record('R03：UI重试确认原child退出且不调用模型，同session随后可真实完成新运行',{oldRunId:pending.runId,newRunId:resumed.runId,requestCount:requests.length});

    stage='R04 terminal ENOSPC';
    const created=await ui.evaluate(`window.zhixing.saveAutomation(${JSON.stringify({name:taskName,kind:'agent',description:`调用office_calculate求20与22之和，再返回 ${autoMarker}`,workspaceId:project.workspaceId,projectId,documentIds:[],rule:{kind:'every',seconds:86400},target:{kind:'new_once'}})})`);
    taskId=created.tasks.find(task=>task.name===taskName)?.id;assert(taskId);
    await evaluate((key,target)=>{const s=globalThis[key];s.taskId=target;s.failTerminal=true;},mainKey,taskId);
    await dismissToast();await ui.click('定时任务');
    await ui.click(`启用 ${taskName}`);await ui.waitFor('document.querySelector(".modal .primary-button")?.disabled===false',30000);await ui.click('确认启用','.modal .primary-button');
    assert.equal((await automations()).tasks.find(task=>task.id===taskId).enabled,true,'The task must have a real enabled future schedule before injecting the terminal failure');
    await ui.click(`立即运行 ${taskName}`);await ui.waitFor('document.querySelector(".modal .primary-button")?.disabled===false',30000);await ui.click('确认运行','.modal .primary-button');
    await ui.waitFor('!!document.querySelector(".automation-save-pending")',60000);
    const pendingSnapshot=await automations(),outcome=pendingSnapshot.pendingOutcomes.find(item=>item.taskId===taskId);assert(outcome?.result?.text.includes(autoMarker));assert.equal(outcome.finalization.executionStatus,'completed');assert(['pending','failed'].includes(outcome.finalization.persistenceStatus));assert.equal(pendingSnapshot.tasks.find(task=>task.id===taskId).enabled,false);assert.equal(pendingSnapshot.persistenceError.code,'AUTOMATION_SAVE_FAILED');
    const countsBefore=await evaluate(mainStatus,mainKey),autoAttempts=countsBefore.attempts.filter(item=>item.kind==='automation');assert.equal(autoAttempts.length,1);assert.equal(autoAttempts[0].runId,outcome.runId);assert(countsBefore.writeFaults>=1);
    const calculateCalls=countsBefore.events.filter(event=>event.runId===outcome.runId&&event.type==='tool/call'&&event.label==='调用 · 数字计算');
    const calculateResults=countsBefore.events.filter(event=>event.runId===outcome.runId&&event.type==='tool/result'&&event.label==='数字计算 · 完成');assert.equal(calculateCalls.length,1);assert.equal(calculateResults.length,1);assert.equal(toolReceipts.length,1);assert.equal(toolReceipts[0].value,42);
    const errorSamples=await samplePersistent('.automation-save-pending','结果尚未保存');
    await ui.click('查看结果','.automation-save-pending button');await ui.waitFor(`document.querySelector('.transcript')?.textContent.includes(${JSON.stringify(autoMarker)})`);
    await record('R04：仅终态ENOSPC后真实结果正文可读，持续错误/暂停/保存重试按钮存在；runtime与calculate均一次',{runId:outcome.runId,errorSamples,runtimeCalls:autoAttempts.length,toolCalls:calculateCalls.length,toolResults:calculateResults.length,toolReceipt:toolReceipts[0],writeFaults:countsBefore.writeFaults});

    const requestsBeforeSave=requests.length;
    await evaluate(key=>{const s=globalThis[key];s.failTerminal=false;s.automation.write=s.original.write;},mainKey);
    await ui.click('重试保存结果','.automation-save-pending button');await ui.waitFor('!document.querySelector(".automation-save-pending")',30000);
    const savedSnapshot=await automations(),savedRun=savedSnapshot.runs.find(run=>run.id===outcome.runId);assert(savedRun?.result?.text.includes(autoMarker));assert.equal(savedRun.status,'completed');assert.equal(savedRun.finalization.persistenceStatus,'saved');assert(!savedSnapshot.pendingOutcomes.some(item=>item.runId===outcome.runId));assert.equal(savedSnapshot.persistenceError,null);
    const afterSave=await evaluate(mainStatus,mainKey);assert.equal(afterSave.attempts.filter(item=>item.kind==='automation').length,1);assert.equal(afterSave.events.filter(event=>event.runId===outcome.runId&&event.type==='tool/call'&&event.label==='调用 · 数字计算').length,1);assert.equal(requests.length,requestsBeforeSave);assert.equal(toolReceipts.length,1);
    await saveSettled();await reload();
    const reloaded=await automations(),reloadedRun=reloaded.runs.find(run=>run.id===outcome.runId);assert.equal(reloadedRun.id,outcome.runId);assert.equal(reloadedRun.result.text,savedRun.result.text);assert.equal(reloadedRun.finalization.persistenceStatus,'saved');assert.equal(reloaded.pendingOutcomes.length,0);assert.equal(await ui.evaluate('!!document.querySelector(".automation-save-pending")'),false);
    const persistedWorkspace=await workspace();assert(persistedWorkspace.chats.some(chat=>chat.messages.some(message=>message.automationRunId===outcome.runId&&message.role==='assistant'&&message.text.includes(autoMarker))));
    const disk=await evaluate(async(key,runId,marker)=>{const require=process.mainModule.require,e=require('electron'),path=require('node:path'),fs=require('node:fs/promises'),crypto=require('node:crypto');const bytes=await fs.readFile(path.join(e.app.getPath('userData'),'zhixing','automations.bin'));const value=JSON.parse(e.safeStorage.decryptString(bytes)),run=value.runs.find(run=>run.id===runId);return {bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sameRun:run?.id===runId,textPresent:run?.result?.text.includes(marker),persistenceStatus:run?.finalization?.persistenceStatus};},mainKey,outcome.runId,autoMarker);
    assert(disk.sameRun&&disk.textPresent);assert.equal(disk.persistenceStatus,'saved');assert.equal(requests.length,requestsBeforeSave);assert.deepEqual(fixtureErrors,[]);
    await record('R04：UI重试仅保存同一runId；Page.reload及实际加密文件读回正文，模型/工具次数不增加',{runId:outcome.runId,runtimeCalls:1,toolCalls:1,requestCount:requests.length,disk});
  }
}catch(error){primaryError=error;records.push({name:stage,status:'failed',error:error.stack});await ui?.screenshot(path.join(evidence,'failure.png')).catch(()=>{});}
finally{
  clearInterval(leaseTimer);
  if(captureInstalled&&main){
    try{
      const restoreStart=await evaluate(key=>{const s=globalThis[key];if(s?.restore){void s.restore('controller-finally').catch(error=>{s.restoreError=error.message;});return {pending:true};}if(s){Object.defineProperty(s.RuntimeManager.prototype,'getCleanupStatus',s.runtimeDescriptor);Object.defineProperty(s.AutomationService.prototype,'snapshot',s.automationDescriptor);s.restoreMethods?.();}return {methodsRestored:true,setupIncomplete:true};},mainKey);
      let restored=restoreStart;
      if(restoreStart.pending){await wait(()=>evaluate(key=>{const s=globalThis[key];return !!s.restoration||!!s.restoreError;},mainKey),'main restoration completion',120000,true);restored=await evaluate(key=>{const s=globalThis[key];if(s.restoreError)throw new Error(s.restoreError);return s.restoration;},mainKey);}
      assert.equal(restored.methodsRestored,true);assert.equal(restored.liveChildren?.length||0,0);assert.equal(restored.problems?.length||0,0,JSON.stringify(restored.problems));
      if(!restored.setupIncomplete){
        await wait(async()=>{await ready();return true;},'restored QA profile',45000,true);
        const logical=await main.evaluate(`(${compareRestoredRecords.toString()})(${JSON.stringify(mainKey)},(${sameJsonData.toString()}))`);
        await fs.writeFile(path.join(evidence,'restoration-comparison.json'),JSON.stringify(logical,null,2));
        assert(logical.workspaceRestored&&logical.automationRestored,'The original synthetic profile records were not restored');
        await record('所有临时方法/自有子进程/原QA资料已恢复；未访问剪贴板',{restored,logical});
      }
      await evaluate(key=>{delete globalThis[key];},mainKey);
    }catch(error){cleanupError=error;records.push({name:'restoration',status:'failed',error:error.stack});}
  }
  ui?.close();main?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  for(const [signal,handler]of signalHandlers)process.removeListener(signal,handler);
  await flushEvidence();
  const status=primaryError||cleanupError?'failed':fixtureOnly?'fixture-only-passed':'passed';
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({...baseline,status,host,records,requestCount:requests.length,toolReceiptCount:toolReceipts.length,coverage:fixtureOnly?'HTTP fixtures and strict JSON restoration comparator only; no product or Windows gate executed':'R03/R04 actual packaged Windows UI and host failure injection; no real cloud or installer lifecycle',completedAt:new Date().toISOString()},null,2));
}
if(primaryError)throw primaryError;if(cleanupError)throw cleanupError;

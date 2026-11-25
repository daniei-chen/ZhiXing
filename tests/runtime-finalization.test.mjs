import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

const app=process.env.ZHIXING_TEST_PACKED_APP;
const load=name=>import(app?pathToFileURL(path.join(app,name)).href:new URL(`../${name}`,import.meta.url).href);
const {RuntimeManager}=await load('electron/runtime.mjs');
const {writeBridge}=await load('harness/privacy-bridge.mjs');
const key='synthetic-finalization-key';
const config={baseUrl:'https://synthetic.invalid',model:'synthetic',reasoning:'off'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<100;i++){if(await predicate())return;await pause(10);}throw new Error('Synthetic lifecycle condition did not settle');}

async function fixture({queryFails=true,hangingClose=false,realChild=false,queryError,finalResponse='Synthetic completed text',cleanupRetryDelays=[10000]}={}){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'zhixing-finalization-'));
 const vaults=new Map(),events=[];let created=0,closes=0,allowExit=false,child;
 if(realChild){child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});await once(child,'spawn');}
 const manager=new RuntimeManager({root,cleanupTimeoutMs:60,cleanupRetryDelays,
  readVault:async id=>vaults.get(id),writeVault:async(id,value)=>vaults.set(id,structuredClone(value)),onEvent:event=>events.push(event),
  createGateway:async()=>({baseUrl:'http://127.0.0.1:1',apiKey:key,close:async()=>{}}),
  createHarness:async(directory,options)=>{created++;return {
   zhixingProcess:child,
   client:{request:async()=>({}),subscribeSessionTree(){let resolve;const stopped=new Promise(yes=>{resolve=yes;});return {tryNext:()=>undefined,close:resolve,async *[Symbol.asyncIterator](){await stopped;}};}},
   async start(){await writeBridge(path.join(directory,'context.bin'),options.bridgeKey,{[path.basename(directory)]:{tools:[],skills:[]}});},
   async close(){closes++;if(hangingClose)return new Promise(()=>{});if(!allowExit)throw new Error('Synthetic exit not confirmed');},
   async retryClose(){closes++;if(!allowExit)throw new Error('Synthetic exit still not confirmed');if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit');}},
   session:()=>({run:async()=>{if(queryFails)throw queryError||Object.assign(new Error('Synthetic query failure'),{code:'SYNTHETIC_QUERY_FAILED',stage:'query'});return {finishReason:'completed',finalResponse};}}),
  };},
 });
 return {root,manager,events,vaults,child,created:()=>created,closes:()=>closes,allowExit:()=>{allowExit=true;},
  async dispose(){allowExit=true;if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit');}await Promise.race([manager.close(),pause(300)]);await fs.rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:50});}};
}
const run=(f,id='quarantine-run',sessionId='quarantine-session',prompt='Synthetic prompt')=>f.manager.run({runId:id,sessionId,prompt,privacyMode:'redact'},config,key);

test('R03 未确认退出保留 handle/会话互斥/恢复文件，重试只清理不再创建内核',async()=>{
 const f=await fixture();try{
  let failure;await assert.rejects(run(f),error=>{failure=error;return true;});
  assert.equal(f.manager.busy.has('quarantine-session'),true);
  assert.equal(f.manager.runs.has('quarantine-run'),true);
  assert.equal(f.manager.getCleanupStatus().length,1);
  assert.equal(failure.finalization.processStatus,'cleanup_pending');
  assert.equal(failure.finalization.executionStatus,'failed');
  assert.equal(f.events.at(-1).finalization.processStatus,'cleanup_pending');
  await fs.access(path.join(f.root,'quarantine-session','privacy-bridge.bin'));
  await assert.rejects(run(f,'duplicate-run'),/会话|运行|执行/);assert.equal(f.created(),1);
  await f.manager.clearSavedHistory();await fs.access(path.join(f.root,'quarantine-session','privacy-bridge.bin'));
  const closed=await f.manager.close();assert.equal(closed.cleanupPending.length,1);
  assert.equal(f.manager.busy.has('quarantine-session'),true);
  f.allowExit();const recovered=await f.manager.retryCleanup('quarantine-run');
  assert.equal(recovered.finalization.processStatus,'exited');assert.equal(f.manager.busy.has('quarantine-session'),false);
  assert.equal(f.manager.getCleanupStatus().length,0);assert.equal(f.created(),1);
 }finally{await f.dispose();}
});

test('R03 真实合成子进程 exit 证据触发释放；独立会话可运行，旧会话恢复后可新建',async()=>{
 const f=await fixture({realChild:true});try{
  await assert.rejects(run(f));assert.equal(f.manager.busy.has('quarantine-session'),true);
  await assert.rejects(run(f,'independent-run','independent-session'));assert.equal(f.created(),2);
  f.child.kill();await once(f.child,'exit');
  await until(()=>f.manager.getCleanupStatus().length===0);
  assert.equal(f.manager.busy.size,0);
  f.allowExit();await assert.rejects(run(f,'after-exit'));assert.equal(f.created(),3);
 }finally{await f.dispose();}
});

test('R03 不返回的关闭有界结束且隔离；拿到退出证据前不删除临时资料',async()=>{
 const f=await fixture({hangingClose:true});try{
  const start=Date.now();await assert.rejects(Promise.race([run(f),pause(1000).then(()=>{throw new Error('Synthetic close exceeded bound');})]),error=>error.finalization?.processStatus==='cleanup_pending');
  assert(Date.now()-start<2000);await fs.access(path.join(f.root,'quarantine-session','privacy-bridge.bin'));
  assert.equal(f.manager.busy.has('quarantine-session'),true);
 }finally{await f.dispose();}
});

test('RunFinalization 分开记录完成/保存/退出，terminal、返回值与 settlement 一致',async()=>{
 const f=await fixture({queryFails:false});f.allowExit();try{
  const result=await run(f),terminal=f.events.find(event=>event.type==='run/terminal');
  assert.equal(terminal.status,'succeeded');assert.equal(result.finalization.executionStatus,'completed');
  assert.equal(result.finalization.persistenceStatus,'saved');assert.equal(result.finalization.processStatus,'exited');
  assert(Number.isSafeInteger(result.finalization.eventWatermark));assert(result.finalization.eventWatermark>0);
  assert.deepEqual(terminal.finalization,result.finalization);
  assert.deepEqual((await f.manager.waitForRun('quarantine-run')).finalization,result.finalization);
 }finally{await f.dispose();}
});

test('R03 check 关闭失败同样保留实例并参与关窗，确认退出后删除独立检查目录',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.manager.check(config,key),error=>error.finalization.processStatus==='cleanup_pending');
  const [entry]=f.manager.getCleanupStatus();assert(entry.runId.startsWith('check-'));assert.equal(f.manager.runs.get(entry.runId).h!==undefined,true);
  await fs.access(path.join(f.root,entry.sessionId,'mcp.bin'));
  const count=f.closes(),closed=await f.manager.close();assert.equal(closed.cleanupPending.length,1);assert(f.closes()>count);
  assert.equal(f.manager.busy.has(entry.sessionId),true);f.allowExit();
  const recovered=await f.manager.retryCleanup(entry.runId);assert.equal(recovered.finalization.processStatus,'exited');
  assert.equal(f.manager.getCleanupStatus().length,0);await assert.rejects(fs.access(path.join(f.root,entry.sessionId)),{code:'ENOENT'});
 }finally{await f.dispose();}
});

test('R03 check 仍在启动时也纳入 close join，不能等到失败后才注册 handle',async()=>{
 const f=await fixture();let release,entered=false;const gate=new Promise(resolve=>{release=resolve;}),create=f.manager.createHarness;
 f.manager.createHarness=async(...args)=>{const harness=await create(...args),start=harness.start;harness.start=async()=>{await start();entered=true;await gate;};return harness;};
 try{
  const checking=assert.rejects(f.manager.check(config,key));await until(()=>entered);assert.equal(f.manager.runs.size,1);
  let closed=false;const closing=f.manager.close().then(value=>{closed=true;return value;});await pause(20);assert.equal(closed,false);
  release();const [,result]=await Promise.all([checking,closing]);assert.equal(result.cleanupPending.length,1);assert.equal(f.created(),1);
 }finally{release();await f.dispose();}
});

test('R03 后台清理有次数上限，失败不会释放互斥，手动重试和取消不新建内核',async()=>{
 const f=await fixture({cleanupRetryDelays:[10,10]});try{
  await assert.rejects(run(f));await until(()=>f.closes()===3);await pause(40);assert.equal(f.closes(),3);
  assert.equal(f.manager.getCleanupStatus()[0].attempts,2);
  const cancelled=await f.manager.cancel('quarantine-run');assert.equal(cancelled.status,'cleanup_pending');assert.equal(f.manager.runs.get('quarantine-run').status,'cleanup_pending');
  f.allowExit();await f.manager.retryCleanup('quarantine-run');assert.equal(f.created(),1);assert.equal(f.manager.busy.size,0);
 }finally{await f.dispose();}
});

test('R03 空重试计划自动清理为零次，手动重试失败仍隔离且可继续恢复',async()=>{
 const f=await fixture({cleanupRetryDelays:[]});try{
  await assert.rejects(run(f));await pause(40);
  assert.equal(f.manager.getCleanupStatus()[0].attempts,0);assert.equal(f.closes(),1);
  assert.equal(f.manager.runs.get('quarantine-run').cleanupTimer??null,null);
  assert.equal(f.manager.busy.has('quarantine-session'),true);
  const pending=await f.manager.retryCleanup('quarantine-run');assert.equal(pending.status,'cleanup_pending');
  await pause(40);assert.equal(f.manager.getCleanupStatus()[0].attempts,1);assert.equal(f.closes(),2);
  assert.equal(f.manager.runs.get('quarantine-run').cleanupTimer??null,null);
  assert.equal(f.manager.busy.has('quarantine-session'),true);
  f.allowExit();const recovered=await f.manager.retryCleanup('quarantine-run');
  assert.equal(recovered.status,'exited');assert.equal(recovered.finalization.processStatus,'exited');
  assert.equal(f.closes(),3);assert.equal(f.created(),1);assert.equal(f.manager.busy.size,0);
  assert.equal(f.manager.getCleanupStatus().length,0);assert.equal(f.manager.runs.has('quarantine-run'),false);
 }finally{await f.dispose();}
});

test('R03 对外隔离诊断可序列化且不会携带配置 Key/任意 code 或 stage',async()=>{
 const f=await fixture({queryError:Object.assign(new Error(`Synthetic query ${key}`),{code:key,stage:key})});try{
  await assert.rejects(run(f));const status=f.manager.getCleanupStatus(),serialized=JSON.stringify(status);
  assert(!serialized.includes(key),serialized);assert(!serialized.includes('synthetic-finalization'),serialized);
  assert.equal(JSON.parse(serialized)[0].finalization.error.code,'RUNTIME_EXECUTION_FAILED');
  assert.equal(JSON.parse(serialized)[0].finalization.error.stage,'query');
 }finally{await f.dispose();}
});

test('RunFinalization 取消与关闭失败可同时呈现，重试清理不改执行终态',async()=>{
 const f=await fixture();try{
  const pending=run(f);await f.manager.cancel('quarantine-run');
  await assert.rejects(pending,error=>error.finalization.executionStatus==='cancelled'&&error.finalization.processStatus==='cleanup_pending');
  f.allowExit();const saved=await f.manager.retryCleanup('quarantine-run');
  assert.equal(saved.finalization.executionStatus,'cancelled');assert.equal(saved.finalization.processStatus,'exited');
 }finally{await f.dispose();}
});

test('RunFinalization 内核已退出而映射写盘失败保留恢复文件，不能误报 saved',async()=>{
 const f=await fixture({queryFails:false});f.allowExit();let writes=0;
 f.manager.writeVault=async(id,value)=>{if(++writes>1)throw Object.assign(new Error('Synthetic ENOSPC'),{code:'ENOSPC'});f.vaults.set(id,value);};
 try{
  await assert.rejects(run(f),error=>error.finalization.persistenceStatus==='pending'&&error.finalization.processStatus==='exited'&&error.finalization.error.stage==='persist');
  await fs.access(path.join(f.root,'quarantine-session','privacy-bridge.bin'));assert.equal(f.manager.busy.size,0);
 }finally{await f.dispose();}
});

test('RunFinalization 输出凭证绝不标 completed 或附 result',async()=>{
 const f=await fixture({queryFails:false,finalResponse:`Synthetic response ${key}`});f.allowExit();try{
  await assert.rejects(run(f),error=>{assert.equal(error.finalization.executionStatus,'failed');assert.equal(error.result,undefined);return true;});
  const terminal=f.events.at(-1);assert.equal(terminal.finalization.executionStatus,'failed');assert.equal(terminal.result,undefined);assert.equal(terminal.output,undefined);
  assert(!JSON.stringify(terminal).includes(key));
 }finally{await f.dispose();}
});

// 0.17.0 起：无法归属的占位符不再让整段回答失败。它仍然不会被还原（防跨任务），
// 但正文照常交付，令牌换成中性标记，unrestored 把处数带回界面。
test('RunFinalization 无法归属的占位符保留正文、不还原、并记下处数',async()=>{
 const token='⟦ZX-foreign-PHONE-1⟧';
 const f=await fixture({queryFails:false,finalResponse:`Synthetic response ${token}`});f.allowExit();try{
  const settled=await run(f);const result=settled?.result||settled||{};
  assert.equal(result.unrestored,1,JSON.stringify(settled));
  assert.equal(result.text.includes(token),false,result.text);
  assert.ok(result.text.includes('【敏感值待核实】'),result.text);
  const terminal=f.events.at(-1);assert.notEqual(terminal.finalization.executionStatus,'failed');
 }finally{await f.dispose();}
});

test('R03 有效最终正文完成但 close 失败时，经 terminal/error.result 保留同一安全结果',async()=>{
 const f=await fixture({queryFails:false});try{
  let failure;await assert.rejects(run(f),error=>{failure=error;return true;});
  assert.equal(failure.finalization.executionStatus,'completed');assert.equal(failure.finalization.processStatus,'cleanup_pending');
  assert.equal(failure.result.text,'Synthetic completed text');assert.equal(f.events.at(-1).result.text,failure.result.text);
  assert.equal(f.events.at(-1).output.text,failure.result.text);assert.equal(f.events.at(-1).status,'failed');
  assert.equal(f.events.filter(event=>event.type==='draft').length,1);assert.equal(f.events.find(event=>event.type==='draft').source,'validated-result');
  f.allowExit();await f.manager.retryCleanup('quarantine-run');assert.equal(f.events.at(-1).result.text,'Synthetic completed text');
 }finally{await f.dispose();}
});

test('R03 终态摘要不含已还原PII，私有result和可靠validated-result保留完整正文',async()=>{
 const phone='13800000000',f=await fixture({queryFails:false,finalResponse:`Synthetic contact ${phone}`});try{
  let failure;await assert.rejects(run(f,'quarantine-run','quarantine-session',`Synthetic contact ${phone}`),error=>{failure=error;return true;});
  assert(failure.result.text.includes(phone));assert(f.events.find(event=>event.type==='draft'&&event.source==='validated-result').text.includes(phone));
  assert(!JSON.stringify(f.events.filter(event=>event.type!=='draft')).includes(phone));
  assert.equal(f.events.at(-1).result.displayRedacted,true);assert.equal(failure.finalization.executionStatus,'completed');
 }finally{await f.dispose();}
});

test('R05 忘记会话清目标volatile/原文预览/settlement，不等待或清理其他活动会话',async()=>{
 const f=await fixture({queryFails:false});f.allowExit();try{
  const local={...config,persist:false},target='forget-target',other='forget-other';
  await f.manager.run({runId:'forget-target-old-run',sessionId:target,prompt:'Synthetic contact 13800000000',privacyMode:'redact'},local,key);
  await f.manager.run({runId:'forget-other-old-run',sessionId:other,prompt:'Synthetic contact 13900000000',privacyMode:'redact'},local,key);
  const targetPreview=await f.manager.preview({sessionId:target,prompt:'SYNTHETIC_TARGET_DELETE_MARKER 13800000000',privacyMode:'redact'},local);
  const otherPreview=await f.manager.preview({sessionId:other,prompt:'SYNTHETIC_OTHER_KEEP_MARKER 13900000000',privacyMode:'redact'},local);
  let release;const live=new Promise(resolve=>{release=resolve;});f.manager.busy.add('unrelated-active');f.manager.runs.set('unrelated-active-run',{runId:'unrelated-active-run',sessionId:'unrelated-active',settled:live});f.manager.runSettlements.set('unrelated-active-run',live);f.manager.runSettlementSessions.set('unrelated-active-run','unrelated-active');
  let removed=0;const created=f.created();
  const result=await Promise.race([f.manager.forgetSessionState(target,async()=>{removed++;}),pause(200).then(()=>{throw new Error('Forget waited on an unrelated session');})]);
  assert.deepEqual(result,{forgotten:true,sessionId:target});assert.equal(removed,1);
  assert.equal(f.manager.volatileVaults.has(target),false);assert.equal(f.manager.prepared.has(targetPreview.preparationId),false);
  assert(!JSON.stringify([...f.manager.prepared.values()]).includes('SYNTHETIC_TARGET_DELETE_MARKER'));
  assert.equal(f.manager.runSettlements.has('forget-target-old-run'),false);await assert.rejects(f.manager.waitForRun('forget-target-old-run'),/不存在/);
  await assert.rejects(f.manager.runPrepared({runId:'forgotten-old-preview',preparationId:targetPreview.preparationId},local,key),/过期|不存在/);assert.equal(f.created(),created);
  assert.equal(f.manager.volatileVaults.has(other),true);assert.equal(f.manager.prepared.has(otherPreview.preparationId),true);
  assert.equal((await f.manager.waitForRun('forget-other-old-run')).status,'succeeded');
  assert.equal(f.manager.runs.has('unrelated-active-run'),true);assert.equal(f.manager.busy.has('unrelated-active'),true);
  assert.equal(f.manager.runSettlements.get('unrelated-active-run'),live);
  release();f.manager.runs.delete('unrelated-active-run');f.manager.busy.delete('unrelated-active');
 }finally{f.manager.runs.delete('unrelated-active-run');f.manager.busy.delete('unrelated-active');f.manager.runSettlements.delete('unrelated-active-run');f.manager.runSettlementSessions.delete('unrelated-active-run');await f.dispose();}
});

test('R05 忘记回调持有目标互斥，并发旧预览拒绝且内核创建数0；回调失败保留缓存',async()=>{
 const f=await fixture({queryFails:false});f.allowExit();let release;try{
  const local={...config,persist:false},sessionId='forget-atomic';
  await f.manager.run({runId:'forget-atomic-old-run',sessionId,prompt:'Synthetic contact 13800000000',privacyMode:'redact'},local,key);
  const preview=await f.manager.preview({sessionId,prompt:'SYNTHETIC_ATOMIC_DELETE_MARKER 13800000000',privacyMode:'redact'},local);
  const vault=f.manager.volatileVaults.get(sessionId),prepared=f.manager.prepared.get(preview.preparationId),created=f.created();
  const gate=new Promise(resolve=>{release=resolve;}),failure=new Error('Synthetic filesystem EACCES');let entered=false;
  const forgetting=f.manager.forgetSessionState(sessionId,async()=>{entered=true;await gate;throw failure;});const failed=assert.rejects(forgetting,error=>error===failure);
  assert.equal(entered,true);assert.equal(f.manager.busy.has(sessionId),true);
  await assert.rejects(f.manager.runPrepared({runId:'forget-atomic-race',preparationId:preview.preparationId},local,key),/会话|运行|执行/);
  await assert.rejects(f.manager.preview({sessionId,prompt:'Concurrent preview',privacyMode:'redact'},local),/会话|运行|执行/);
  assert.equal(f.created()-created,0);assert.equal(f.manager.prepared.get(preview.preparationId),prepared);assert.equal(f.manager.volatileVaults.get(sessionId),vault);
  release();await failed;assert.equal(f.manager.busy.has(sessionId),false);
  assert.equal(f.manager.prepared.get(preview.preparationId),prepared);assert.equal(f.manager.volatileVaults.get(sessionId),vault);
  assert.equal((await f.manager.waitForRun('forget-atomic-old-run')).status,'succeeded');
  let releaseSuccess;const successGate=new Promise(resolve=>{releaseSuccess=resolve;});
  const deleted=f.manager.forgetSessionState(sessionId,async()=>successGate);
  await assert.rejects(f.manager.runPrepared({runId:'forget-atomic-success-race',preparationId:preview.preparationId},local,key),/会话|运行|执行/);
  assert.equal(f.created()-created,0);releaseSuccess();await deleted;
  await assert.rejects(f.manager.runPrepared({runId:'forget-atomic-after',preparationId:preview.preparationId},local,key),/过期|不存在/);
  assert.equal(f.created()-created,0);assert.equal(f.manager.busy.has(sessionId),false);
 }finally{release?.();await f.dispose();}
});

test('R05 活跃/隔离会话不能忘记，磁盘回调不执行且恢复缓存保持完整',async()=>{
 const f=await fixture();try{
  await assert.rejects(run(f));const active=f.manager.runs.get('quarantine-run'),vault=f.vaults.get('quarantine-session');let calls=0;
  await assert.rejects(f.manager.forgetSessionState('quarantine-session',async()=>{calls++;}),/会话|停止|退出|运行/);
  assert.equal(calls,0);assert.equal(f.manager.runs.get('quarantine-run'),active);assert.equal(f.manager.busy.has('quarantine-session'),true);
  assert.equal(f.vaults.get('quarantine-session'),vault);await fs.access(path.join(f.root,'quarantine-session','privacy-bridge.bin'));
  f.manager.busy.add('synthetic-busy');await assert.rejects(f.manager.forgetSessionState('synthetic-busy',async()=>{calls++;}),/会话|停止|退出|运行/);f.manager.busy.delete('synthetic-busy');
  f.manager.runs.set('synthetic-record-only-run',{sessionId:'synthetic-record-only'});await assert.rejects(f.manager.forgetSessionState('synthetic-record-only',async()=>{calls++;}),/会话|停止|退出|运行/);f.manager.runs.delete('synthetic-record-only-run');
  assert.equal(calls,0);f.allowExit();await f.manager.retryCleanup('quarantine-run');await f.manager.forgetSessionState('quarantine-session',async()=>{});
  assert.equal(f.manager.runSettlements.has('quarantine-run'),false);
 }finally{await f.dispose();}
});

test('R05 删除前已开始的异步预览不能在成功删除后复活缓存；删除失败仍可恢复',async()=>{
 for(const deletionFails of [false,true]){
  const f=await fixture({queryFails:false});f.allowExit();let release;try{
   const local={...config,persist:false},sessionId='forget-inflight';
   await f.manager.run({runId:'forget-inflight-old',sessionId,prompt:'Synthetic contact 13800000000',privacyMode:'redact'},local,key);
   let entered;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;}),prepare=f.manager.prepare.bind(f.manager);
   f.manager.prepare=async(...args)=>{const result=await prepare(...args);entered();await gate;return result;};
   const preview=f.manager.preview({sessionId,prompt:'SYNTHETIC_INFLIGHT_DELETE_MARKER 13800000000',privacyMode:'redact'},local);await started;
   const forgetting=f.manager.forgetSessionState(sessionId,async()=>{if(deletionFails)throw new Error('Synthetic delete failed');});
   if(deletionFails)await assert.rejects(forgetting,/Synthetic delete failed/);else await forgetting;
   release();
   if(deletionFails){const recovered=await preview;assert.equal(f.manager.prepared.has(recovered.preparationId),true);assert.equal(f.manager.volatileVaults.has(sessionId),true);}
   else{await assert.rejects(preview,/删除|失效/);assert.equal(f.manager.prepared.size,0);assert.equal(f.manager.volatileVaults.has(sessionId),false);}
   assert.equal(f.created(),1);
  }finally{release?.();await f.dispose();}
 }
});

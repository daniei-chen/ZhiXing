import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const app=process.env.ZHIXING_TEST_PACKED_APP;
const {AutomationService}=await import(app?pathToFileURL(path.join(app,'electron/automation-service.mjs')).href:'../electron/automation-service.mjs');

async function fixture({kind='agent',runtimeFails=false,cleanupFails=false,resultText='Synthetic outcome marker 7b1'}={}){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'zhixing-auto-persistence-')),file=path.join(root,'synthetic-state.json');
 let fail=false,executions=0,clock=+new Date(2026,10,21,8);
 const context={settings:{persist:true,privacyMode:'redact',model:'synthetic',reasoning:'off',notifications:true},workspaces:[{id:'office',type:'office'}],projects:[],documents:[]};
 const config={baseUrl:'https://synthetic.invalid',model:'synthetic',credentialRevision:1},changes=[],notices=[];
 const runtime={async preview(){return {preparationId:'synthetic-preparation',text:'Synthetic input',entities:[]};},
  async runPrepared({runId}){executions++;if(runtimeFails)throw Object.assign(new Error('Synthetic tool failed'),{code:'SYNTHETIC_TOOL_FAILED',stage:'query'});const answer={text:resultText,masked:resultText,modelInput:'Synthetic input',privacyMode:'redact',finishReason:'completed',sessionId:'synthetic-session',finalization:{runId,executionStatus:'completed',persistenceStatus:'saved',processStatus:cleanupFails?'cleanup_pending':'exited',eventWatermark:7}};if(cleanupFails)throw Object.assign(new Error('Synthetic cleanup failed'),{code:'RUNTIME_CLOSE_FAILED',stage:'close',result:answer,finalization:answer.finalization});return answer;},
  async cancel(){},
 };
 const create=()=>new AutomationService({read:async()=>fs.readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;}),
  write:async state=>{if(fail&&state.runs.some(run=>run.status!=='running'))throw Object.assign(new Error('Synthetic ENOSPC'),{code:'ENOSPC'});await fs.writeFile(file,JSON.stringify(state));},
  getContext:()=>context,getConfiguration:()=>config,getKey:async()=>'synthetic-only-key',runtime,onChange:value=>changes.push(value),notify:value=>notices.push(value),now:()=>clock});
 const service=create();await service.initialise();await service.save({name:'Synthetic task',description:'Synthetic input',kind,workspaceId:'office',projectId:null,documentIds:[],frequency:'每天',time:'09:00',anchorDate:'2026-11-21'});
 const id=service.snapshot().tasks[0].id;
 async function launch(){fail=true;const result=kind==='agent'?await service.confirm((await service.prepare(id,'run')).approvalId):await service.runReminder(id);await Promise.all([...service.active.values()].map(run=>run.promise));await service.tail;return result.runId;}
 return {root,file,service,id,create,changes,notices,launch,executions:()=>executions,failWrites:()=>{fail=true;},restore:()=>{fail=false;},advance:()=>{clock+=86400000;},
  async dispose(){fail=false;try{await service.close();}catch{}await fs.rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:50});}};
}

test('R04 成功结果终态 ENOSPC 后可读、暂停；并发重试只落盘一次且重启保留正文',async()=>{
 const f=await fixture();try{
  const runId=await f.launch(),snapshot=f.service.snapshot();
  assert.equal(snapshot.pendingOutcomes.length,1);assert.equal(snapshot.pendingOutcomes[0].runId,runId);
  assert.equal(snapshot.runs[0].result.text,'Synthetic outcome marker 7b1');assert.equal(snapshot.runs[0].status,'completed');
  assert.equal(snapshot.runs[0].finalization.persistenceStatus,'pending');assert.equal(snapshot.tasks[0].enabled,false);
  assert.equal(f.service.active.size,0);assert.equal(snapshot.persistenceError.code,'AUTOMATION_SAVE_FAILED');
  f.advance();await f.service.tick();await assert.rejects(f.service.prepare(f.id,'run'),/保存/);assert.equal(f.executions(),1);
  await assert.rejects(f.service.retrySave(runId),/保存|ENOSPC/);assert.equal(f.executions(),1);
  f.restore();await Promise.all([f.service.retrySave(runId),f.service.retrySave(runId)]);
  assert.equal(f.executions(),1);assert.equal(f.service.snapshot().pendingOutcomes.length,0);assert.equal(f.service.snapshot().persistenceError,null);
  const bytes=await fs.readFile(f.file,'utf8'),saved=JSON.parse(bytes);assert(bytes.includes('Synthetic outcome marker 7b1'));
  assert.equal(saved.runs[0].id,runId);assert.equal(saved.runs[0].finalization.persistenceStatus,'saved');assert.equal(saved.tasks[0].enabled,false);
  const restarted=f.create();await restarted.initialise();assert.equal(restarted.snapshot().runs[0].status,'completed');assert.equal(restarted.snapshot().runs[0].result.text,'Synthetic outcome marker 7b1');await restarted.close();
 }finally{await f.dispose();}
});

test('R04 提醒失败保存同样保留 outcome；close flush 不再执行提醒或模型',async()=>{
 const f=await fixture({kind:'reminder'});try{
  const runId=await f.launch();assert.equal(f.service.snapshot().pendingOutcomes[0].runId,runId);
  await assert.rejects(f.service.close(),error=>error.code==='AUTOMATION_SAVE_FAILED');assert.equal(f.service.snapshot().pendingOutcomes.length,1);
  assert.equal(f.service.closed,false);
  f.restore();await f.service.close();assert.equal(f.service.snapshot().pendingOutcomes.length,0);assert.equal(f.executions(),0);
  const saved=JSON.parse(await fs.readFile(f.file,'utf8'));assert.equal(saved.runs[0].status,'completed');assert.equal(saved.runs.length,1);
 }finally{await f.dispose();}
});

test('R04 执行失败与状态保存失败分开，恢复写入只保存同一 runId/错误',async()=>{
 const f=await fixture({runtimeFails:true});try{
  const runId=await f.launch(),pending=f.service.snapshot().pendingOutcomes[0];
  assert.equal(pending.status,'failed');assert.equal(pending.finalization.executionStatus,'failed');assert.equal(pending.finalization.persistenceStatus,'pending');
  assert.equal(pending.finalization.error.code,'SYNTHETIC_TOOL_FAILED');assert.equal(f.service.snapshot().tasks[0].status,'执行失败，状态保存失败');
  f.restore();await f.service.retrySave(runId);assert.equal(f.executions(),1);
  const saved=JSON.parse(await fs.readFile(f.file,'utf8'));assert.equal(saved.runs[0].id,runId);assert.equal(saved.runs[0].status,'failed');assert.equal(saved.runs[0].message,'Synthetic tool failed');
 }finally{await f.dispose();}
});

test('R04 内核退出未确认的已验证正文仍可保存/重试，执行次数始终为一',async()=>{
 const f=await fixture({cleanupFails:true});try{
  const runId=await f.launch(),snapshot=f.service.snapshot();
  assert.equal(snapshot.runs[0].status,'failed');assert.equal(snapshot.runs[0].result.text,'Synthetic outcome marker 7b1');
  assert.equal(snapshot.runs[0].finalization.executionStatus,'completed');assert.equal(snapshot.runs[0].finalization.processStatus,'cleanup_pending');
  f.restore();await f.service.retrySave(runId);assert.equal(f.executions(),1);
  const saved=JSON.parse(await fs.readFile(f.file,'utf8'));assert.equal(saved.runs[0].result.text,'Synthetic outcome marker 7b1');assert.equal(saved.runs[0].finalization.processStatus,'cleanup_pending');
 }finally{await f.dispose();}
});

test('R04 后到的清理完成事件更新pending/已存终态；其写盘失败也可仅保存重试',async()=>{
 const f=await fixture({cleanupFails:true});try{
  const runId=await f.launch(),finalization={runId,executionStatus:'completed',persistenceStatus:'saved',processStatus:'exited',eventWatermark:9};
  await f.service.recordEvent({runId,type:'run/terminal',status:'failed',finalization});
  assert.equal(f.service.snapshot().pendingOutcomes[0].finalization.processStatus,'exited');assert.equal(f.service.snapshot().pendingOutcomes[0].finalization.persistenceStatus,'pending');
  f.restore();await f.service.retrySave(runId);assert.equal(f.service.snapshot().runs[0].finalization.processStatus,'exited');
  f.failWrites();await f.service.recordEvent({runId,type:'run/terminal',status:'failed',finalization:{...finalization,eventWatermark:10}});
  assert.equal(f.service.snapshot().pendingOutcomes.length,1);assert.equal(f.service.snapshot().runs[0].result.text,'Synthetic outcome marker 7b1');
  f.restore();await f.service.retrySave(runId);assert.equal(f.executions(),1);
  const saved=JSON.parse(await fs.readFile(f.file,'utf8'));assert.equal(saved.runs[0].finalization.eventWatermark,10);assert.equal(saved.runs[0].finalization.processStatus,'exited');
 }finally{await f.dispose();}
});

test('R04 首次/重试写入期间到达的 exit 证据不会被旧 outcome 覆盖',async()=>{
 for(const duringRetry of [false,true]){
  const f=await fixture({cleanupFails:true});let release;try{
   let entered;const began=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
   let runId;if(duringRetry){runId=await f.launch();f.restore();}
   const write=f.service.write;let holds=0;
   f.service.write=async draft=>{if(draft.runs.some(run=>run.status!=='running')&&holds++===0){entered();await gate;}return write(draft);};
   const saving=duringRetry?f.service.retrySave(runId):f.launch();await began;
   runId ||= f.service.snapshot().runs[0].id;
   await f.service.recordEvent({type:'run/terminal',runId,finalization:{runId,executionStatus:'completed',persistenceStatus:'saved',processStatus:'exited',eventWatermark:99}});
   release();await saving;
   if(!duringRetry){assert.equal(f.service.snapshot().pendingOutcomes[0].finalization.processStatus,'exited');f.restore();await f.service.retrySave(runId);}
   const saved=JSON.parse(await fs.readFile(f.file,'utf8'));assert.equal(saved.runs[0].finalization.processStatus,'exited');assert.equal(saved.runs[0].finalization.eventWatermark,99);
   assert.equal(f.service.snapshot().pendingOutcomes.length,0);assert.equal(f.executions(),1);
  }finally{release?.();await f.dispose();}
 }
});

test('R04 内核已完成而取消未受理时，不把完成结果改成 stopped 或清空正文',async()=>{
 const f=await fixture();let release;try{
  let entered;const began=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;}),run=f.service.runtime.runPrepared;
  f.service.runtime.runPrepared=async(...args)=>{entered();await gate;return run(...args);};
  f.service.runtime.cancel=async()=>({cancelled:false,accepted:false,status:'settling'});
  const launching=f.launch();await began;const cancelling=f.service.cancel(f.id);await new Promise(resolve=>setImmediate(resolve));release();
  await launching;assert.equal((await cancelling).cancelled,false);assert.equal(f.service.snapshot().runs[0].status,'completed');assert.equal(f.service.snapshot().runs[0].result.text,'Synthetic outcome marker 7b1');assert.equal(f.executions(),1);
 }finally{release?.();await f.dispose();}
});

test('R04 未成功写盘即强制中断的旧 running 台账重启后暂停，不自动重复工具',async()=>{
 const f=await fixture();try{
  await f.launch();f.restore();const recovered=f.create();await recovered.initialise();
  assert.equal(recovered.snapshot().tasks[0].enabled,false);assert.equal(recovered.snapshot().runs[0].status,'interrupted');
  assert.match(recovered.snapshot().runs[0].message,/可能已发生的操作/);f.advance();await recovered.tick();assert.equal(f.executions(),1);await recovered.close();
 }finally{await f.dispose();}
});

test('R04 超过120条历史与容量清理均保留 pending/running 行，retrySave仍找到原 runId',async()=>{
 const f=await fixture();try{
  const runId=await f.launch();f.restore();
  await f.service.commit(draft=>{
   draft.runs[0].status='interrupted';
   draft.runs.push({id:'synthetic-running',status:'running',text:'running-marker'});
   for(let i=0;i<140;i++)draft.runs.push({id:`synthetic-history-${i}`,status:'completed',text:'x'.repeat(72000)});
  });
  const rotated=JSON.parse(await fs.readFile(f.file,'utf8'));assert(rotated.runs.length<120);
  assert(rotated.runs.some(run=>run.id===runId));assert(rotated.runs.some(run=>run.id==='synthetic-running'));
  assert.equal(f.service.snapshot().pendingOutcomes.length,1);
  await f.service.retrySave(runId);assert.equal(f.executions(),1);assert.equal(f.service.snapshot().pendingOutcomes.length,0);
  const saved=JSON.parse(await fs.readFile(f.file,'utf8'));assert.equal(saved.runs.find(run=>run.id===runId).result.text,'Synthetic outcome marker 7b1');
 }finally{await f.dispose();}
});

test('R04 单份结果超过容量时明确失败并保留 outcome，不能删本次终态后伪报保存成功',async()=>{
 const marker='synthetic-oversize-marker',f=await fixture({resultText:marker+'x'.repeat(8*1024*1024)});try{
  const runId=await f.launch();assert.equal(f.service.snapshot().pendingOutcomes[0].runId,runId);f.restore();
  await assert.rejects(f.service.retrySave(runId),/空间|保存/);assert.equal(f.executions(),1);
  assert(f.service.snapshot().pendingOutcomes[0].result.text.startsWith(marker));
  const saved=JSON.parse(await fs.readFile(f.file,'utf8'));assert.equal(saved.runs[0].status,'running');assert.equal(saved.runs[0].id,runId);
 }finally{await f.dispose();}
});

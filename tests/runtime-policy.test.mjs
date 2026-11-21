import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createBridgeKey,readBridge,writeBridge,updateBridge} from '../harness/privacy-bridge.mjs';
import {RuntimeManager,waitForStoppedJobs} from '../electron/runtime.mjs';
import {validateMcpServers,publicMcpServers} from '../electron/mcp-config.mjs';
import {isPublicAddress} from '../harness/secure-web.mjs';
import {goalWire} from '../electron/goal-wire.mjs';
import {PrivacySession} from '../src/privacy-core.js';
test('保留原生目标工具的协议 ID，继续脱敏目标正文与普通消息',()=>{
 const id='goal-00000000-0000-4000-8000-a13800000000';
 const objective='联系 13900000000';
 const payload=JSON.stringify({goal:{id,revision:1,objective,phase:'active'},activation:'armed'});
 const vault=new PrivacySession('goal-wire');
 const protect=value=>vault.protectValue(value).value;
 assert.notEqual(protect(id),id);
 for(const messages of [
  [{role:'assistant',content:[{type:'tool_use',id:'goal-call',name:'get_goal'}]},
   {role:'user',content:[{type:'tool_result',tool_use_id:'goal-call',content:[{type:'text',text:payload}]}]}],
  [{role:'assistant',tool_calls:[{id:'goal-call',function:{name:'get_goal'}}]},
   {role:'tool',tool_call_id:'goal-call',content:payload}],
 ]){
  const wire=goalWire(messages,protect);
  assert.equal(JSON.parse(wire.result('goal-call',payload)).goal.id,id);
  assert(!wire.result('goal-call',payload).includes('13900000000'));
  assert.equal(wire.input('update_goal',{goal_id:id,objective}).goal_id,id);
  assert(!wire.input('update_goal',{goal_id:id,objective}).objective.includes('13900000000'));
  assert(!wire.result('other-tool',payload).includes(id));
  assert(!wire.result(undefined,payload).includes(id));
  assert.notEqual(wire.input('untrusted_tool',{goal_id:id}).goal_id,id);
 }
});
test('MCP 配置校验、凭据不回显及保留环境隔离',()=>{
 const values=validateMcpServers([{serverName:'office',transport:'streamable-http',url:'https://example.com/mcp',headers:{Authorization:'synthetic'}}]);
 assert.equal(publicMcpServers(values)[0].headers,undefined);assert.deepEqual(publicMcpServers(values)[0].headerKeys,['Authorization']);
 assert.throws(()=>validateMcpServers([{serverName:'office',transport:'stdio',command:'node',args:[],env:{ZHIXING_HISTORY_KEY:'bad'}}]),/保留/);
 assert.throws(()=>validateMcpServers([{serverName:'office',transport:'streamable-http',url:'http://remote.example/mcp'}]),/HTTPS/);
 assert.throws(()=>validateMcpServers([...values,...values]),/重复/);
});
test('网页地址策略拒绝内网、IPv6 映射和保留地址',()=>{
 for(const address of ['127.0.0.1','10.2.3.4','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','224.0.0.1'])assert.equal(isPublicAddress(address),false,address);
 for(const address of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])assert.equal(isPublicAddress(address),true,address);
});
test('跨进程更新脱敏映射不会覆盖或丢失',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-bridge-')),file=path.join(root,'map.bin'),key=createBridgeKey();
 try{
  await writeBridge(file,key,{count:0});const moduleUrl=new URL('../harness/privacy-bridge.mjs',import.meta.url).href;
  const children=Array.from({length:3},()=>spawn(process.execPath,['--input-type=module','-e',`import{updateBridge}from${JSON.stringify(moduleUrl)};for(let i=0;i<12;i++)await updateBridge(process.env.ZX_FILE,process.env.ZX_KEY,state=>({state:{count:state.count+1}}));`],{env:{...process.env,ZX_FILE:file,ZX_KEY:key},stdio:'ignore',windowsHide:true}));
  await Promise.all(children.map(async child=>assert.equal((await once(child,'exit'))[0],0)));
  assert.equal((await readBridge(file,key)).count,36);
  await fs.mkdir(`${file}.lock`);await assert.rejects(updateBridge(file,key,state=>({state}),{timeoutMs:25}),/繁忙/);await fs.rmdir(`${file}.lock`);
 }finally{const resolved=await fs.realpath(root);if(path.dirname(resolved)===await fs.realpath(os.tmpdir())&&path.basename(resolved).startsWith('zhixing-bridge-'))await fs.rm(resolved,{recursive:true,force:true});}
});

test('失活进程的脱敏锁可恢复，活进程锁保持独占',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-dead-lock-')),file=path.join(root,'map.bin'),key=createBridgeKey();
 const moduleUrl=new URL('../harness/privacy-bridge.mjs',import.meta.url).href;
 const source=`import{updateBridge}from${JSON.stringify(moduleUrl)};await updateBridge(process.env.ZX_FILE,process.env.ZX_KEY,async state=>{process.send('locked');await new Promise(resolve=>process.on('message',message=>message==='release'&&resolve()));return{state:{count:state.count+1}}});`;
 let child;
 try{
  await writeBridge(file,key,{count:0});
  child=spawn(process.execPath,['--input-type=module','-e',source],{env:{...process.env,ZX_FILE:file,ZX_KEY:key},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  await once(child,'message');
  const owner=JSON.parse(await fs.readFile(path.join(`${file}.lock`,'owner.json'),'utf8'));assert.equal(owner.pid,child.pid);
  await assert.rejects(updateBridge(file,key,state=>({state}),{timeoutMs:35}),/繁忙/);
  assert.equal(JSON.parse(await fs.readFile(path.join(`${file}.lock`,'owner.json'),'utf8')).token,owner.token);
  child.kill();await once(child,'exit');child=null;
  assert.equal(await updateBridge(file,key,state=>({state:{count:state.count+1}})),undefined);
  assert.equal((await readBridge(file,key)).count,1);
  await assert.rejects(fs.access(`${file}.lock`),{code:'ENOENT'});
 }finally{if(child){child.kill();await once(child,'exit').catch(()=>{});}const resolved=await fs.realpath(root);if(path.dirname(resolved)===await fs.realpath(os.tmpdir())&&path.basename(resolved).startsWith('zhixing-dead-lock-'))await fs.rm(resolved,{recursive:true,force:true});}
});

test('运行管理器关闭会等待最终保存，晚到取消不改写成功终态',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-run-settled-')),events=[];let releaseFinalSave,finalSaveStarted;
 const finalSaveGate=new Promise(resolve=>{releaseFinalSave=resolve;}),saveStarted=new Promise(resolve=>{finalSaveStarted=resolve;});let saves=0;
 const manager=new RuntimeManager({root,readVault:async()=>null,writeVault:async()=>{if(++saves===3){finalSaveStarted();await finalSaveGate;}},onEvent:event=>events.push(event),createGateway:async()=>({baseUrl:'http://127.0.0.1:1',apiKey:'synthetic-key',close:async()=>{}}),createHarness:async(directory,configuration)=>({start:async()=>writeBridge(path.join(directory,'context.bin'),configuration.bridgeKey,{'settled-success':{tools:[],skills:[]}}),close:async()=>{},client:{subscribeSessionTree:()=>{let ended=false;return{tryNext:()=>undefined,close:()=>{ended=true;},async *[Symbol.asyncIterator](){while(!ended)await new Promise(resolve=>setTimeout(resolve,2));}};},request:async()=>({})},session:()=>({run:async()=>({finishReason:'completed',finalResponse:'已完成'})})})});
 try{
  const run=manager.run({runId:'settled-success',sessionId:'settled-success',prompt:'合成任务',privacyMode:'redact'},{baseUrl:'https://fixture.invalid',model:'fixture',reasoning:'off'},'synthetic-key');
  await saveStarted;const terminal=manager.waitForRun('settled-success');
  let closed=false;const closing=manager.close().then(()=>{closed=true;});
  assert.deepEqual(await manager.cancel('settled-success'),{cancelled:false,accepted:false,settled:false,status:'settling'});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(closed,false);
  releaseFinalSave();assert.equal((await run).text,'已完成');
  const settled=await terminal,terminalEvent=events.filter(event=>event.type==='run/terminal').at(-1);
  assert.deepEqual(settled,{runId:'settled-success',sessionId:'settled-success',status:'succeeded',finishReason:'completed',finalization:settled.finalization});
  assert(Number.isSafeInteger(settled.finalization.eventWatermark));assert(settled.finalization.eventWatermark>0);
  assert.deepEqual(settled.finalization,{runId:'settled-success',executionStatus:'completed',persistenceStatus:'saved',processStatus:'exited',eventWatermark:settled.finalization.eventWatermark,deliverables:[],children:[]});
  assert.deepEqual(terminalEvent.finalization,settled.finalization);
  await closing;assert.equal(closed,true);
  assert.equal(events.filter(event=>event.type==='run/terminal').at(-1).status,'succeeded');
 }finally{releaseFinalSave();await manager.close();const resolved=await fs.realpath(root);if(path.dirname(resolved)===await fs.realpath(os.tmpdir())&&path.basename(resolved).startsWith('zhixing-run-settled-'))await fs.rm(resolved,{recursive:true,force:true});}
});

test('后台作业停止未到终态时显式发出有界等待结果',async()=>{
 const events=[],job={id:'fixture-job',stopRequested:true,settled:false,settledPromise:new Promise(()=>{})};
 const pending=await waitForStoppedJobs(new Map([[job.id,job]]),15,stopping=>events.push({type:'job/settlement-timeout',itemId:stopping.id,status:'stopping'}));
 assert.deepEqual(pending,[job]);assert.deepEqual(events,[{type:'job/settlement-timeout',itemId:'fixture-job',status:'stopping'}]);
});

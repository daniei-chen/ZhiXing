import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
const url=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {RuntimeManager,prepareRuntime}=await import(url('electron/runtime.mjs'));
const {KERNEL_DEFAULTS}=await import(url('src/kernel-config.js'));
const {projectTeamBoard,protectTeamContext}=await import(url('src/team-board.js'));
const {shellEnvironment,planningAllows}=await import(url('harness/shell-policy.mjs'));

function respond(res,content){
 if(!Array.isArray(content)){res.writeHead(content.status,{'content-type':'application/json','retry-after':'0'}).end(JSON.stringify({type:'error',error:{type:content.status===429?'rate_limit_error':'overloaded_error',message:'Synthetic transient upstream failure'}}));return;}
 const message={id:'native_fixture',type:'message',role:'assistant',model:'native-fixture',content,stop_reason:content.some(block=>block.type==='tool_use')?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:50,output_tokens:20}};
 res.writeHead(200,{'content-type':'text/event-stream'});
 const emit=(type,fields)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
 emit('message_start',{message:{...message,content:[],stop_reason:null}});
 content.forEach((block,index)=>{emit('content_block_start',{index,content_block:block.type==='text'?{type:'text',text:''}:{...block,input:{}}});emit('content_block_delta',{index,delta:block.type==='text'?{type:'text_delta',text:block.text}:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});emit('content_block_stop',{index});});
 emit('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:20}});emit('message_stop',{});res.end();
}
const call=(name,input,index)=>[{type:'tool_use',name,input,id:`native_${index}`}];
const results=body=>body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(block=>block.type==='tool_result');
function valueOf(block){for(const item of block?.content||[])if(item.type==='text'){try{return JSON.parse(item.text);}catch{}}return null;}
async function fixture(handler){
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'zhixing-native-capabilities-')),requests=[],vaults=new Map(),events=[];
 const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push(body);if(requests.length>18)throw new Error('Native fixture exceeded expected turns');respond(res,handler(body,requests.length));}catch(error){res.writeHead(422,{'content-type':'application/json'}).end(JSON.stringify({error:{message:error.message}}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const manager=new RuntimeManager({root,readVault:async id=>vaults.get(id),writeVault:async(id,value)=>vaults.set(id,value),onEvent:event=>events.push(event)});
 // Test-only diagnostics against the pinned SDK; never exposed by product IPC.
 const clients=[],createHarness=manager.createHarness;
 manager.createHarness=async(...args)=>{const harness=await createHarness(...args);clients.push(harness.client);return harness;};
 const config={baseUrl:`http://127.0.0.1:${server.address().port}/anthropic`,model:'native-fixture',reasoning:'off',kernel:{...KERNEL_DEFAULTS,taskTimeoutSeconds:60}};
 return {root,manager,config,requests,events,diagnostics:()=>clients.map(client=>(client.stderrTail||[]).slice(-12)),async close(){await manager.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const resolved=await fs.realpath(root);assert.equal(path.dirname(resolved),parent);assert(path.basename(resolved).startsWith('zhixing-native-capabilities-'));await fs.rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:150});}};
}

test('真实 Harness 非脱敏模式在工具返回和流式/最终回复中仍拦截凭证',{timeout:90000},async()=>{
 const secret='password=synthetic-raw-tool-secret';
 const f=await fixture((body,index)=>results(body).length?[{type:'text',text:'TOOL_PROTECTION_VERIFIED'}]:call('office_read_file',{file_path:'credential-fixture.txt'},index));
 try {
  const project=path.join(f.root,'synthetic-project');await fs.mkdir(project);await fs.writeFile(path.join(project,'credential-fixture.txt'),secret);
  const config={...f.config,workspaceRoot:project,permission:'full',privacyPolicy:{actions:{SECRET:'mask'}}};
  const result=await f.manager.run({runId:'raw-tool-boundary',sessionId:'raw-tool-boundary',prompt:'读取 credential-fixture.txt，报告是否可用。',privacyMode:'raw'},config,'fixture8');
  assert.equal(result.text,'TOOL_PROTECTION_VERIFIED');assert(f.requests.length>=2);
  const wire=JSON.stringify(f.requests);assert(!wire.includes('synthetic-raw-tool-secret'));assert(wire.includes('疑似凭证'));
 } finally {await f.close();}
 const output=await fixture(()=>[{type:'text',text:'password=synthetic-raw-output-secret'}]);
 try {
  await assert.rejects(output.manager.run({runId:'raw-output',sessionId:'raw-output',prompt:'写一行测试结果',privacyMode:'raw'},{...output.config,privacyPolicy:{actions:{SECRET:'mask'}}},'fixture8'),/疑似凭证/);
  assert(!JSON.stringify(output.events).includes('synthetic-raw-output-secret'));
 } finally {await output.close();}
});

test('真实 Harness 的工作计划事件不能显示当前模型凭证',{timeout:45000},async()=>{
 const key='Ab7!xyZ9';
 const f=await fixture((_body,index)=>call('todo_write',{todos:[{content:`核对 ${key} 的状态`,status:'in_progress'}]},index));
 try {
  await assert.rejects(f.manager.run({runId:'plan-key',sessionId:'plan-key',prompt:'更新合成工作计划。',privacyMode:'raw'},f.config,key),/模型未完成/);
  assert(f.events.some(event=>event.type==='plan'&&event.plan.some(item=>item.content.includes('检测到凭证'))));
  assert(!JSON.stringify(f.events).includes(key));assert.equal(f.requests.length,1);
 } finally {await f.close();}
});

test('原生 Agent Teams 创建、CAS 领取/完成、列表及加密重启恢复',async()=>{
 let phase='create';
 const f=await fixture((body,index)=>{
  const history=results(body),task=history.map(valueOf).find(value=>value?.id&&value?.revision);
  if(phase==='resume')return index===6?call('team_task_list',{},index):[{type:'text',text:'TEAM_RESUMED'}];
  switch(history.length){
   case 0:return call('team_task_create',{subject:'联系人：张三，电话13800000000',description:'核对合成资料',write_scopes:['report.txt']},index);
   case 1:assert(task);return call('team_task_update',{task_id:task.id,expected_revision:1,action:'claim'},index);
   case 2:return call('team_task_update',{task_id:task.id,expected_revision:2,action:'complete'},index);
   case 3:return call('team_task_list',{},index);
   default:return [{type:'text',text:'TEAM_COMPLETED'}];
  }
 });
 try{
  const result=await f.manager.run({sessionId:'team-native',runId:'team-first',prompt:'请在共享任务板中建立合成任务、领取并完成。'},f.config,'synthetic-native-key');
  assert.equal(result.finishReason,'completed');assert.equal(result.text,'TEAM_COMPLETED');
  const board=result.context.team;assert(board.enabled);assert.equal(board.tasks.length,1);assert.equal(board.tasks[0].status,'completed');assert.equal(board.tasks[0].revision,3);assert(!JSON.stringify(board).includes('13800000000'));assert(!JSON.stringify(board).includes('张三'));
  assert(f.events.some(event=>event.type==='team/task'));assert(f.events.some(event=>event.label==='更新共享任务 · 完成'));
  const last=results(f.requests.at(-1)).map(valueOf).findLast(value=>Array.isArray(value?.tasks));assert.equal(last.tasks[0].status,'completed');
  const encrypted=await fs.readFile(path.join(f.root,'team-native','history-redact','team-native.bin'));assert(!encrypted.includes(Buffer.from('核对合成资料')));
  phase='resume';const resumed=await f.manager.run({sessionId:'team-native',runId:'team-second',prompt:'读取原共享任务板，确认完成状态。'},f.config,'synthetic-native-key');assert.equal(resumed.text,'TEAM_RESUMED');assert.equal(resumed.context.team.tasks[0].revision,3);
  const off=await f.manager.check({...f.config,kernel:{...f.config.kernel,teamEnabled:false}},'synthetic-native-key');assert(!off.tools.some(tool=>tool.name.startsWith('team_task_')));
 }finally{await f.close();}
},{timeout:60000});

test('原生 PTC run_code 实际编排办公工具、保留受控环境并遵守规划模式',async()=>{
 let planning=false,plannedCallSent=false;
 const f=await fixture((body,index)=>{
  if(planning&&plannedCallSent||!planning&&results(body).length)return [{type:'text',text:'PTC_COMPLETED'}];
  if(planning)plannedCallSent=true;
  return call('run_code',{code:'const sum = await tools.office_calculate({numbers:[2,3,5],operation:"sum"}); console.log("CALCULATED="+sum.value); console.log("ENV_STRIPPED="+(typeof process === "undefined" || !process.env.DEEPSEEK_API_KEY));',description:'合成工具编排'},index);
 });
 try{
  const workspace=path.join(f.root,'workspace');await fs.mkdir(workspace);
  const config={...f.config,workspaceRoot:workspace,permission:'full',kernel:{...f.config.kernel,ptcEnabled:true}};
  const result=await f.manager.run({sessionId:'ptc-native',runId:'ptc-first',prompt:'使用程序化工具计算合计。'},config,'synthetic-native-key');
  assert.equal(result.finishReason,'completed');assert.equal(result.text,'PTC_COMPLETED');
  assert.deepEqual(f.requests[0].tools.map(tool=>tool.name),['run_code']);
  const actual=JSON.stringify(results(f.requests.at(-1)));assert(actual.includes('CALCULATED=10'),actual);assert(actual.includes('ENV_STRIPPED=true'),actual);assert(result.context.capabilities.find(item=>item.id==='ptc').active);
  for(const permission of ['ask','auto']){const rows=JSON.parse(await fs.readFile(await prepareRuntime(path.join(f.root,permission),{...config,permission}),'utf8'));assert(!rows.find(row=>row.insert).insert.some(row=>row.id==='tool-executor-ptc'));}
  planning=true;
  let planned;
  try{planned=await f.manager.run({sessionId:'ptc-plan',runId:'ptc-planning',prompt:'只调查，不运行程序。',startInPlanMode:true},config,'synthetic-native-key');}
  catch(error){error.message+=` Synthetic PTC diagnostic: ${JSON.stringify({details:error.details,stderr:f.diagnostics(),requests:f.requests.length,lastMessages:f.requests.at(-1)?.messages,events:f.events.filter(event=>event.runId==='ptc-planning').slice(-12)})}`;throw error;}
  assert.equal(planned.finishReason,'completed');const plannedWire=JSON.stringify(f.requests.at(-1));assert(!plannedWire.includes('CALCULATED=10'));assert(plannedWire.includes('规划模式'));
 }finally{await f.close();}
},{timeout:60000});

test('共享任务展示去除新生成的凭证和个人信息，不修改原生记录',()=>{
 const source={enabled:true,tasks:[{id:'1',revision:1,subject:'password=123456',description:'姓名：张三，电话13800000000',status:'pending',blockedBy:[],writeScopes:[],writeScopeWarnings:[]}]};
 const board=projectTeamBoard(source);assert(!JSON.stringify(board).includes('123456'));assert(!JSON.stringify(board).includes('张三'));assert(!JSON.stringify(board).includes('13800000000'));assert.equal(source.tasks[0].subject,'password=123456');assert.equal(projectTeamBoard({enabled:false,tasks:[]}),null);
});

test('命令环境按白名单清除新增秘密，规划只读检查按实际操作判断',()=>{
 assert.deepEqual(shellEnvironment({Path:'test-bin',SystemRoot:'C:\\Windows',DSH_HOME:'private',ZHIXING_CONTROL_KEY:'secret',FUTURE_SECRET:'new-secret',ELECTRON_RUN_AS_NODE:'1'}),{Path:'test-bin',SystemRoot:'C:\\Windows',DSH_HOME:'',ZHIXING_CONTROL_KEY:'',FUTURE_SECRET:'',ELECTRON_RUN_AS_NODE:''});
 for(const name of ['web_fetch','web_search','team_task_list','list_mcp_resources','read_mcp_resource'])assert(planningAllows(name));
 for(const name of ['office_execute','office_write_file','run_code','mcp__unknown','team_task_create','present'])assert(!planningAllows(name));
 assert(planningAllows('office_browser',{operation:'snapshot'}));assert(!planningAllows('office_browser',{operation:'click'}));
 assert(planningAllows('office_schedule',{operation:'view'}));assert(!planningAllows('office_schedule',{operation:'create'}));
});

test('全角当前模型凭证在最终回复、流式草稿与执行预览中均被阻断',async()=>{
 const key='synthetic-native-key',disguised=[...key].map(character=>String.fromCharCode(character.charCodeAt(0)+0xfee0)).join('');
 const f=await fixture(()=>[{type:'text',text:disguised}]);
 try{
  for(const privacyMode of ['redact','raw']){
   await assert.rejects(f.manager.run({sessionId:`credential-${privacyMode}`,runId:`credential-${privacyMode}`,prompt:'仅返回合成测试结果。',privacyMode},f.config,key),/模型输出包含疑似凭证/);
  }
  assert(!f.events.some(event=>event.type==='draft'&&event.text.includes(disguised)));
  assert.equal(f.manager.executionDisplay(disguised,{providerKey:key,customTerms:[],privacyPolicy:{}}),'【检测到凭证，已隐藏此段】');
  for(const value of [key,disguised]){
   const context={stats:{turns:1},team:{enabled:true,tasks:[{id:'1',subject:value}]}};
   const checked=protectTeamContext(context,key);assert.deepEqual(checked.stats,context.stats);assert.deepEqual(checked.team.tasks,[]);assert.match(checked.team.failure,/模型凭证/);assert.equal(context.team.tasks[0].subject,value);
  }
  const harmless={team:{enabled:true,tasks:[{subject:'合成任务'}]}};assert.equal(protectTeamContext(harmless,key),harmless);
 }finally{await f.close();}
},{timeout:30000});

test('真实多供应商适配器对 429 和 503 有界重试，保持脱敏请求',async()=>{
 const f=await fixture((_body,index)=>index<3?{status:index===1?429:503}:[{type:'text',text:'RETRY_RECOVERED'}]);
 try{
  const result=await f.manager.run({sessionId:'retry-native',runId:'retry-native',prompt:'请核对电话13800000000。'},{...f.config,protocol:'anthropic',reasoningMap:false},'synthetic-native-key');
  assert.equal(result.finishReason,'completed',result.text);assert.equal(result.text,'RETRY_RECOVERED');assert.equal(f.requests.length,3);
  for(const request of f.requests)assert(!JSON.stringify(request).includes('13800000000'));
 }finally{await f.close();}
},{timeout:45000});

test('真实 Windows 沙箱在 ask/auto 拒绝项目外写入，full 明确放行且命令无内核秘密',async()=>{
 let command;
 const f=await fixture((body,index)=>results(body).length?[{type:'text',text:'SHELL_CHECKED'}]:call('office_execute',{command,description:'验证合成目录写边界和环境',timeout_seconds:30},index));
 const workspace=path.join(f.root,'workspace');await fs.mkdir(workspace);
 let approvals=0;f.manager.onApproval=async()=>{approvals++;return {outcome:'allowed-once'};};
 const quote=value=>`'${value.replaceAll("'","''")}'`;
 try{
  for(const permission of ['ask','auto','full']){
   const outside=path.join(f.root,`outside-${permission}.txt`),inside=path.join(workspace,`${permission}.txt`);
   command=`$ErrorActionPreference='Stop'; $secrets=@(Get-ChildItem Env: | Where-Object { $_.Name -match '^(DSH_|ZHIXING_|DEEPSEEK_)' -and $_.Value }); Write-Output ('ENV_CLEAN=' + ($secrets.Count -eq 0)); [IO.File]::WriteAllText(${quote(inside)}, 'inside'); try { [IO.File]::WriteAllText(${quote(outside)}, 'escape'); Write-Output 'OUTSIDE_ALLOWED' } catch { Write-Output 'OUTSIDE_DENIED' }`;
   const result=await f.manager.run({sessionId:`shell-${permission}`,runId:`shell-${permission}`,prompt:'只验证合成测试目录中的边界。'},{...f.config,workspaceRoot:workspace,permission},'synthetic-native-key');
   assert.equal(result.finishReason,'completed',result.text);
   const tool=results(f.requests.at(-1)).map(valueOf).find(value=>value&&Object.hasOwn(value,'exitCode'));
   assert(tool,JSON.stringify(results(f.requests.at(-1))));assert.equal(tool.exitCode,0,tool.stderr);assert(tool.stdout.includes('ENV_CLEAN=True'),tool.stdout);
   assert.equal(await fs.readFile(inside,'utf8'),'inside');
   assert.equal(tool.sandbox.mode,permission==='full'?'danger-full-access':'workspace-write');
   if(permission==='full'){assert.equal(await fs.readFile(outside,'utf8'),'escape');assert(tool.stdout.includes('OUTSIDE_ALLOWED'));}
   else {await assert.rejects(fs.access(outside));assert(tool.stdout.includes('OUTSIDE_DENIED'),tool.stdout);assert(tool.sandbox.enforcement);}
  }
  assert.equal(approvals,2);
 }finally{await f.close();}
},{timeout:90000});

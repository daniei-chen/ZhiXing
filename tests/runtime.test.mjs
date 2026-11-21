import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {makePdf} from './fixtures/documents.mjs';

const packagedRoot = process.env.ZHIXING_TEST_PACKED_APP;
const { RuntimeManager } = await import(packagedRoot
  ? pathToFileURL(path.join(packagedRoot, 'electron', 'runtime.mjs')).href
  : '../electron/runtime.mjs');
const { AutomationService } = await import(packagedRoot
  ? pathToFileURL(path.join(packagedRoot, 'electron', 'automation-service.mjs')).href
  : '../electron/automation-service.mjs');

test('真实 Harness → 本地 Messages 服务 → 原生办公工具 → 本机还原',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-integration-')),vaults=new Map(),requests=[];let stall=false,stallChild=false,filePlan=null,goalRequests=0;
 const fixturePerson='张三',fixturePhone='13800000000',inputText=`请用工具计算1+2+3，电话 ${fixturePhone}，联系人：${fixturePerson}。`;
 const fixtureKey='zhixing-loopback-fixture-key';
 const server=http.createServer(async(req,res)=>{
  if(req.method!=='POST'||!req.url.endsWith('/messages')){res.writeHead(404).end();return;}
  const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
  if(body.tools?.some(tool=>tool.type==='web_search_20250305')){
   res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:'search_fixture',type:'message',role:'assistant',model:'zhixing-test',content:[{type:'web_search_tool_result',tool_use_id:'search_1',content:[{type:'web_search_result',url:'https://example.com/report',title:'联网工具验收'}]},{type:'text',text:'合成检索结果',citations:[{type:'web_search_result_location',url:'https://example.com/report',title:'联网工具验收',cited_text:'合成结果片段'}]}],stop_reason:'end_turn',usage:{input_tokens:5,output_tokens:8}}));return;
  }
  if(stall)return;
  const messages=JSON.stringify(body.messages),token=messages.match(/⟦ZX-[^⟧]+⟧/)?.[0]||'';
  const toolResult=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).find(block=>block.type==='tool_result');
  const called=!!toolResult;
  const value=JSON.stringify(toolResult?.content||'').match(/value\\?"\s*:\s*(\d+)/)?.[1]||'未收到计算结果';
  const phone=token||(messages.includes(fixturePhone)?fixturePhone:'未收到电话');
  const name=messages.includes(fixturePerson)?`联系人：${fixturePerson}。`:'';
  const child=messages.includes('CHILD_TASK_FIXTURE')&&!messages.includes('parent-subagent-fixture');
  if(child&&stallChild)return;
  let content=child?[{type:'text',text:'CHILD_COMPLETED 联系人：王五，电话 13711112222。'}]:filePlan?(called?[{type:'text',text:JSON.stringify(toolResult.content)}]:[{type:'tool_use',id:'tool_file_1',name:filePlan.name,input:filePlan.input}]):called?[{type:'text',text:`电话 ${phone}；核对合计为 ${value}。${name}`}]:[{type:'tool_use',id:'tool_test_1',name:'office_calculate',input:{numbers:[1,2,3],operation:'sum'}}];
  if(messages.includes('GOAL_FIXTURE')){
   if(++goalRequests>7){
    res.writeHead(422,{'content-type':'application/json'}).end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Goal fixture exceeded its expected tool turns'}}));
    return;
   }
   let current;for(const message of body.messages)for(const block of Array.isArray(message.content)?message.content:[])if(block.type==='tool_result')for(const part of Array.isArray(block.content)?block.content:[]){try{const parsed=JSON.parse(part.text);if(parsed.goal)current=parsed.goal;}catch{}}
   content=!current?[{type:'tool_use',id:'goal_get',name:'get_goal',input:{}}]:current.phase==='active'?[{type:'tool_use',id:`goal_complete_${current.revision}`,name:'update_goal',input:{goal_id:current.id,revision:current.revision,action:'complete'}}]:[{type:'text',text:'GOAL_FIXTURE_COMPLETED'}];
  }
  const payload={id:`msg_local_test_${requests.length}`,type:'message',role:'assistant',model:'zhixing-test',content,stop_reason:content.some(block=>block.type==='tool_use')?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:50,output_tokens:20}};
  if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(payload));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start',{type:'message_start',message:{...payload,content:[],stop_reason:null,usage:{input_tokens:50,output_tokens:0}}});
  content.forEach((block,index)=>{
   send('content_block_start',{type:'content_block_start',index,content_block:block.type==='text'?{type:'text',text:''}:{...block,input:{}}});
   send('content_block_delta',{type:'content_block_delta',index,delta:block.type==='text'?{type:'text_delta',text:block.text}:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
   send('content_block_stop',{type:'content_block_stop',index});
  });
  send('message_delta',{type:'message_delta',delta:{stop_reason:payload.stop_reason,stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{type:'message_stop'});res.end();
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 const config={baseUrl:`http://127.0.0.1:${server.address().port}/anthropic`,model:'zhixing-test',reasoning:'off'},events=[];
 const manager=new RuntimeManager({root,readVault:async id=>vaults.get(id),writeVault:async(id,value)=>vaults.set(id,value),onEvent:e=>events.push(e)});
 try{
  const report=await manager.check(config,fixtureKey);assert(report.tools.some(tool=>tool.name==='subagent'));
  const preview=await manager.preview({sessionId:'session-test',prompt:inputText,privacyMode:'redact'},config);
  assert.equal(requests.length,0);
  const result=await manager.runPrepared({runId:'run-test',preparationId:preview.preparationId},config,fixtureKey);
  assert.equal(result.finishReason,'completed');
  assert(events.some(event=>event.runId==='run-test'&&event.category==='tools'&&event.label==='数字计算 · 完成'&&event.durationMs>=0));
  assert.equal(result.text,`电话 ${fixturePhone}；核对合计为 6。`);
  assert(!result.masked.includes(fixturePhone));assert(requests.length>=2);
  const outbound=JSON.stringify(requests);assert(!outbound.includes(fixturePhone));assert(!outbound.includes(fixturePerson));
  assert(events.some(e=>e.type==='tool/call'));assert(!JSON.stringify(events.filter(event=>event.type!=='draft')).includes(fixturePhone));
  const tools=requests[0].tools.map(t=>t.name);assert.deepEqual(tools.sort(),['ask_user_question','create_goal','get_goal','interrupt_agent','job_kill','job_list','job_output','list_agents','office_calculate','office_calendar','office_table_check','present','send_message','skill','subagent','subagent_fork','team_task_create','team_task_get','team_task_list','team_task_update','todo_write','update_goal','wait_agent','web_fetch','web_search','workflow']);
  assert.equal(result.modelInput,preview.text);
  assert(requests[0].messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes(JSON.stringify(preview.text).slice(1,-1))));
  await assert.rejects(manager.runPrepared({runId:'repeat',preparationId:preview.preparationId},config,fixtureKey),/过期/);
  const changed=await manager.preview({sessionId:'preview-test',prompt:'写一份周报',privacyMode:'redact'},config);
  await assert.rejects(manager.runPrepared({runId:'changed',preparationId:changed.preparationId},{...config,baseUrl:'http://127.0.0.1:1'},fixtureKey),/连接已更新/);
  await assert.rejects(manager.preview({sessionId:'session-test',prompt:'继续'}, {...config,baseUrl:'http://127.0.0.1:1'}),/另一个模型服务地址/);
  const firstRaw=requests.length;
  const rawPreview=await manager.preview({sessionId:'raw-session',prompt:inputText,privacyMode:'raw'},config);
  assert.equal(rawPreview.text,`任务模式：办公\n\n${inputText}`);assert.deepEqual(rawPreview.entities,[]);assert.equal(requests.length,firstRaw);
  const raw=await manager.runPrepared({runId:'raw-test',preparationId:rawPreview.preparationId},config,fixtureKey);
  assert.equal(raw.finishReason,'completed');assert.equal(raw.privacyMode,'raw');
  assert.equal(raw.text,`电话 ${fixturePhone}；核对合计为 6。联系人：${fixturePerson}。`);
  assert.equal(raw.modelInput,rawPreview.text);assert(!raw.masked.includes(fixturePhone));assert(!raw.masked.includes(fixturePerson));
  assert(requests[firstRaw].messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes(JSON.stringify(rawPreview.text).slice(1,-1))));
  const context={settings:{persist:true,privacyMode:'redact',customTerms:[],model:config.model,reasoning:config.reasoning},workspaces:[{id:'office',type:'office'}],projects:[],documents:[{id:'fixture-doc',name:'fixture.txt',workspaceId:'office',status:'ready',text:inputText}]};
  const queue=new AutomationService({read:async()=>null,write:async()=>{},getContext:()=>context,getConfiguration:()=>config,getKey:async()=>fixtureKey,runtime:manager});
  await queue.initialise();
  await queue.save({name:'包内自动化工具验收',description:'请按所选资料核对合计。',kind:'agent',workspaceId:'office',documentIds:['fixture-doc'],frequency:'每天',time:'09:00',anchorDate:'2026-11-19'});
  const beforeAutomation=requests.length;
  const approval=await queue.prepare(queue.snapshot().tasks[0].id,'run');
  assert.equal(requests.length,beforeAutomation);assert(!approval.text.includes(fixturePhone));
  await queue.confirm(approval.approvalId);
  await Promise.all([...queue.active.values()].map(run=>run.promise));
  const recorded=queue.snapshot().runs[0];
  assert.equal(recorded.status,'completed');assert.equal(recorded.result.text,`电话 ${fixturePhone}；核对合计为 6。`);
  assert(!JSON.stringify(requests.slice(beforeAutomation)).includes(fixturePhone));
  assert.equal(recorded.result.documentNames[0],'fixture.txt');
  await queue.close();
  filePlan={name:'todo_write',input:{todos:[{content:'核对数字',status:'in_progress'},{content:'整理成果',status:'pending'}]}};
  const planned=await manager.run({runId:'native-plan',sessionId:'native-plan',prompt:'先展示计划再继续。',privacyMode:'redact'},config,fixtureKey);
  assert.equal(planned.plan.length,2);assert.equal(planned.plan[0].status,'in_progress');assert(events.some(event=>event.type==='plan'));
  filePlan={name:'skill',input:{name:'zhixing-office-1'}};
  const skilled=await manager.run({runId:'native-skill',sessionId:'native-skill',prompt:'加载会议纪要技能。',privacyMode:'redact'},config,fixtureKey);
  assert(skilled.text.includes('交付要求'));assert(skilled.text.includes('整理会议纪要'));
  filePlan={name:'ask_user_question',input:{questions:[{id:'format',question:'需要哪种输出格式？',options:[{label:'文稿'},{label:'表格'}]}]}};
  const unsubscribeQuestion=manager.onEvent;
  manager.onEvent=event=>{unsubscribeQuestion(event);if(event.type==='question')queueMicrotask(()=>manager.answerQuestion({requestId:event.requestId,answers:[{id:'format',selected:['文稿'],custom:`请联系 ${fixturePhone}`}]}));};
  const beforeQuestion=requests.length;
  const answered=await manager.run({runId:'native-question',sessionId:'native-question',prompt:'请询问输出格式再继续。',privacyMode:'redact'},config,fixtureKey);
  assert(answered.text.includes('文稿'));assert(answered.text.includes(fixturePhone));assert(!JSON.stringify(requests.slice(beforeQuestion)).includes(fixturePhone));assert.equal(manager.questions.size,0);
  manager.onEvent=unsubscribeQuestion;
  filePlan={name:'subagent',input:{description:'合成子任务',prompt:'CHILD_TASK_FIXTURE 仅回复验收结果。'}};
  const delegated=await manager.run({runId:'native-child',sessionId:'native-child',prompt:'parent-subagent-fixture 委派合成测试。',privacyMode:'redact'},{...config,manualControls:true},fixtureKey);
  assert(delegated.children.length>=1);assert(events.some(event=>event.type==='subagents'));assert(!JSON.stringify(requests).includes('13711112222'));
  assert(delegated.children.some(child=>child.messages.some(message=>message.text.includes('CHILD_COMPLETED'))));
  assert(!JSON.stringify(delegated.children).includes('13711112222'));
  stallChild=true;
  let control;
  manager.onEvent=event=>{
   unsubscribeQuestion(event);
   if(!control&&event.runId==='manual-interrupt'&&event.type==='subagents'&&event.status==='running'){
    const request={runId:event.runId,sessionId:event.sessionId,action:'interrupt-agent',target:event.childSessionId};
    control=(async()=>{
     await assert.rejects(manager.controlExecution({...request,sessionId:'another-chat'}),/当前交办/);
     return manager.controlExecution(request);
    })();
    control.catch(()=>{});
   }
  };
  const interrupted=await manager.run({runId:'manual-interrupt',sessionId:'manual-interrupt',prompt:'parent-subagent-fixture 委派合成测试。',privacyMode:'redact'},{...config,manualControls:true},fixtureKey);
  assert.deepEqual(await control,{requested:true});
  assert(interrupted.children.some(child=>['aborted','cancelled','interrupted'].includes(child.status)));
  manager.onEvent=unsubscribeQuestion;
  stallChild=false;
  assert(delegated.context?.measurement.totalTokens>0);
  filePlan=null;const beforeResume=requests.length;
  await manager.run({runId:'resume-native',sessionId:'session-test',prompt:'继续刚才的计算，请保留历史。',privacyMode:'redact'},config,fixtureKey);
  assert(JSON.stringify(requests[beforeResume].messages).includes('请用工具计算'));
  assert(JSON.stringify(requests[beforeResume].messages).includes('继续刚才的计算'));
  const history=await fs.readFile(path.join(root,'session-test','history-redact','session-test.bin'));assert(!history.includes(Buffer.from('请用工具计算')));
  const mcpServers=[{serverName:'fixture',enabled:true,transport:'stdio',command:process.execPath,args:[fileURLToPath(new URL('./fixtures/mcp-server.mjs',import.meta.url))],env:process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{},cwd:process.cwd(),toolCallTimeoutMs:10000,failOnStartupError:true,reconnect:{enabled:false}}];
  const checkedMcp=await manager.check({...config,mcpServers},fixtureKey);assert(checkedMcp.tools.some(tool=>tool.name==='mcp__fixture__lookup'));
  manager.onApproval=async()=>({outcome:'allowed-once'});
  filePlan={name:'mcp__fixture__lookup',input:{query:'synthetic'}};
  const beforeMcp=requests.length;
  const connected=await manager.run({runId:'native-mcp',sessionId:'native-mcp',prompt:'查询合成联系人。',privacyMode:'redact'},{...config,mcpServers},fixtureKey);
  assert(connected.text.includes('MCP_SYNTHETIC_OK'));assert(connected.text.includes('13911112222'));assert(!JSON.stringify(requests.slice(beforeMcp)).includes('13911112222'));
  filePlan={name:'read_mcp_resource',input:{server:'fixture',uri:'fixture://notes'}};
  const resource=await manager.run({runId:'native-mcp-resource',sessionId:'native-mcp-resource',prompt:'读取合成会议资源。',privacyMode:'redact'},{...config,mcpServers},fixtureKey);
  assert(resource.text.includes('MCP_RESOURCE_OK'));assert(resource.text.includes('13611112222'));assert(!JSON.stringify(requests.slice(beforeMcp)).includes('13611112222'));
  const nativeGoal=await manager.run({runId:'native-goal-create',sessionId:'goal-session',prompt:'/goal GOAL_FIXTURE',command:'/goal GOAL_FIXTURE',privacyMode:'redact'},config,fixtureKey);
  assert.equal(nativeGoal.context.goal.phase,'complete');assert(nativeGoal.text.includes('GOAL_FIXTURE_COMPLETED'));
  filePlan={name:'workflow',input:{meta:{name:'office-review',description:'合成工作流验收'},script:'phase("核对"); log("WORKFLOW_FIXTURE_OK"); return {value:6};'}};
  const workflow=await manager.run({runId:'native-workflow',sessionId:'native-workflow',prompt:'执行合成工作流。',privacyMode:'redact'},config,fixtureKey);
  assert(workflow.text.includes('value'));assert(workflow.text.includes('6'));
  filePlan={name:'workflow',input:{meta:{name:'background-stop',description:'合成后台作业验收'},script:'return await agent("CHILD_TASK_FIXTURE 等待停止");',run_in_background:true}};
  stallChild=true;
  let jobControl;
  manager.onEvent=event=>{
   unsubscribeQuestion(event);
   if(!jobControl&&event.runId==='manual-job-stop'&&event.type==='job/registered'){
    jobControl=(async()=>{
     const request={runId:event.runId,sessionId:event.sessionId,target:event.itemId};
     const output=await manager.controlExecution({...request,action:'read-job',offset:0});
     assert.equal(typeof output.text,'string');
     assert(Number.isSafeInteger(output.offset));
     return manager.controlExecution({...request,action:'stop-job'});
    })();
    jobControl.catch(()=>{});
   }
  };
  await manager.run({runId:'manual-job-stop',sessionId:'manual-job-stop',prompt:'parent-subagent-fixture 执行合成后台工作流。',privacyMode:'redact'},{...config,manualControls:true},fixtureKey);
  assert.deepEqual(await jobControl,{requested:true});
  assert(events.some(event=>event.runId==='manual-job-stop'&&event.type==='job/settled'&&event.status==='killed'));
  manager.onEvent=unsubscribeQuestion;
  stallChild=false;
  const beforePlan=requests.length;
  const planMode=await manager.run({runId:'enter-planning',sessionId:'planning-session',prompt:'/plan',command:'/plan',privacyMode:'redact'},config,fixtureKey);
  assert.equal(requests.length,beforePlan);assert.equal(planMode.context.planning,true);
  filePlan={name:'exit_plan_mode',input:{plan:'# 合成测试方案\n\n核对材料后生成成果。'}};
  const originalQuestionHandler=manager.onEvent;let sawPlan=false;
  manager.onEvent=event=>{originalQuestionHandler(event);if(event.type==='question'){sawPlan=event.questions[0].detail.includes('合成测试方案');queueMicrotask(()=>manager.answerQuestion({requestId:event.requestId,answers:[{id:event.questions[0].id,selected:[event.questions[0].options[0].label]}]}));}};
  const reviewed=await manager.run({runId:'review-plan',sessionId:'planning-session',prompt:'请提交方案审批。',privacyMode:'redact'},config,fixtureKey);
  assert(sawPlan);assert.equal(reviewed.context.planning,false);manager.onEvent=originalQuestionHandler;
  filePlan=null;
  const beforeCompact=requests.length;
  const compact=await manager.run({runId:'native-compact',sessionId:'empty-compact',prompt:'/compact',command:'/compact',privacyMode:'redact'},config,fixtureKey);
  assert.equal(requests.length,beforeCompact);assert.match(compact.text,/compactable|Compacted/i);
  const goal=await manager.run({runId:'native-goal-status',sessionId:'empty-goal',prompt:'/goal',command:'/goal',privacyMode:'redact'},config,fixtureKey);
  assert.match(goal.text,/goal/i);assert.equal(requests.length,beforeCompact);
  manager.onApproval=async()=>({outcome:'allowed-once'});
  filePlan={name:'web_search',input:{queries:['合成联网验收']}};
  const searched=await manager.run({runId:'native-search',sessionId:'native-search',prompt:'搜索合成资料。',privacyMode:'redact'},config,fixtureKey);
  assert(searched.text.includes('https://example.com/report'));assert(searched.text.includes('联网工具验收'));
  manager.browserAction=async(scope,input)=>{assert.equal(scope,'synthetic-browser-scope');assert.equal(input.operation,'list');return {tabs:[{title:'浏览器工具验收',text:'联系人：赵六，电话 13511112222。'}]};};
  filePlan={name:'office_browser',input:{operation:'list'}};const beforeBrowser=requests.length;
  const browserTool=await manager.run({runId:'browser-tool',sessionId:'browser-tool',prompt:'查看内置浏览器页面。',privacyMode:'redact'},{...config,browserScope:'synthetic-browser-scope'},fixtureKey);
  assert(browserTool.text.includes('浏览器工具验收'));assert(browserTool.text.includes('13511112222'));assert(!JSON.stringify(requests.slice(beforeBrowser)).includes('13511112222'));
  filePlan={name:'web_search',input:{queries:['合成联网验收']}};
  const beforeDeniedSearch=requests.filter(request=>request.tools?.some(tool=>tool.type==='web_search_20250305')).length;
  await manager.run({runId:'deny-search',sessionId:'deny-search',prompt:'未授权联网。',privacyMode:'redact'},{...config,allowNetwork:false},fixtureKey);
  assert.equal(requests.filter(request=>request.tools?.some(tool=>tool.type==='web_search_20250305')).length,beforeDeniedSearch);
  filePlan={name:'web_fetch',input:{url:`http://127.0.0.1:${server.address().port}/private`}};
  const privateFetch=await manager.run({runId:'private-fetch',sessionId:'private-fetch',prompt:'测试本机地址访问限制。',privacyMode:'raw'},config,fixtureKey);
  assert.match(privateFetch.text,/private|blocked|public|private_ip|loopback|forbidden|not allowed/i);
  const workspace=path.join(root,'office-files');await fs.mkdir(workspace);await fs.writeFile(path.join(workspace,'source.txt'),`联系人：${fixturePerson}，电话 ${fixturePhone}。`);
  const approvals=[];manager.onApproval=async request=>{approvals.push(request);return {outcome:'allowed-once'};};
  const filesConfig={...config,workspaceRoot:workspace,permission:'ask'};
  const beforeFiles=requests.length;
  filePlan={name:'office_read_file',input:{file_path:'source.txt'}};
  const read=await manager.run({runId:'file-read',sessionId:'file-read',prompt:'读取source.txt并保留内容。',privacyMode:'redact'},filesConfig,fixtureKey);
  assert(read.text.includes(fixturePhone));assert(read.text.includes(fixturePerson));assert.equal(approvals.length,0);
  assert(!JSON.stringify(requests.slice(beforeFiles)).includes(fixturePhone));
  await fs.writeFile(path.join(workspace,'source.pdf'),makePdf('PDF CONTACT 13800000000'));
  filePlan={name:'office_read_file',input:{file_path:'source.pdf'}};
  const beforePdf=requests.length,pdfRead=await manager.run({runId:'file-read-pdf',sessionId:'file-read-pdf',prompt:'读取PDF文字，说明读取范围。',privacyMode:'redact'},filesConfig,fixtureKey);
  assert(pdfRead.text.includes('PDF CONTACT'));assert(pdfRead.text.includes('13800000000'));assert(pdfRead.text.includes('扫描区域'));assert(!JSON.stringify(requests.slice(beforePdf)).includes('13800000000'));
  filePlan={name:'office_read_file',input:{file_path:'source.txt',start_character:0,max_characters:4}};
  const sliced=await manager.run({runId:'file-read-slice',sessionId:'file-read-slice',prompt:'按范围读取资料。',privacyMode:'redact'},filesConfig,fixtureKey);
  assert(sliced.text.includes('next_character'));assert(sliced.text.includes('total_characters'));
  filePlan={name:'office_write_file',input:{file_path:'result.txt',content:'验收成果：6。'}};
  await manager.run({runId:'file-write',sessionId:'file-write',prompt:'将成果保存到result.txt。',privacyMode:'redact'},filesConfig,fixtureKey);
  assert.equal(await fs.readFile(path.join(workspace,'result.txt'),'utf8'),'验收成果：6。');assert.equal(approvals.length,1);
  assert.equal(JSON.parse(approvals[0].reason).overwrite,false);
  filePlan={name:'office_write_file',input:{file_path:'auto.txt',content:'自动批准的新成果'}};
  await manager.run({runId:'auto-new',sessionId:'auto-new',prompt:'保存auto.txt',privacyMode:'redact'},{...filesConfig,permission:'auto'},fixtureKey);
  assert.equal(approvals.length,1);assert.equal(await fs.readFile(path.join(workspace,'auto.txt'),'utf8'),'自动批准的新成果');
  manager.onApproval=async request=>{approvals.push(request);return {outcome:'rejected'};};
  filePlan={name:'office_write_file',input:{file_path:'auto.txt',content:'这个覆盖应被拒绝'}};
  await manager.run({runId:'auto-deny',sessionId:'auto-deny',prompt:'覆盖auto.txt',privacyMode:'redact'},{...filesConfig,permission:'auto'},fixtureKey);
 assert.equal(approvals.length,1);assert.equal(await fs.readFile(path.join(workspace,'auto.txt'),'utf8'),'自动批准的新成果');assert.equal(await fs.readFile(path.join(workspace,'auto (2).txt'),'utf8'),'这个覆盖应被拒绝');
  filePlan={name:'office_write_file',input:{file_path:'auto.txt',content:'完全访问已更新成果'}};
  await manager.run({runId:'full-overwrite',sessionId:'full-overwrite',prompt:'覆盖auto.txt',privacyMode:'redact'},{...filesConfig,permission:'full'},fixtureKey);
 assert.equal(approvals.length,1);assert.equal(await fs.readFile(path.join(workspace,'auto.txt'),'utf8'),'自动批准的新成果');assert.equal(await fs.readFile(path.join(workspace,'auto (2).txt'),'utf8'),'这个覆盖应被拒绝');assert.equal(await fs.readFile(path.join(workspace,'auto (3).txt'),'utf8'),'完全访问已更新成果');
  manager.onApproval=async request=>{approvals.push(request);return {outcome:'allowed-once'};};
  filePlan={name:'office_execute',input:{command:"[Console]::WriteLine('HARNESS_PWSH_OK'); [Console]::WriteLine([string]::IsNullOrEmpty($env:ZHIXING_BRIDGE_KEY))",description:'运行本机终端合成测试'}};
  const commandResult=await manager.run({runId:'native-terminal',sessionId:'native-terminal',prompt:'运行合成终端测试并报告输出。',privacyMode:'redact'},filesConfig,fixtureKey);
  assert(commandResult.text.includes('HARNESS_PWSH_OK'));assert(commandResult.text.includes('True'));assert.equal(approvals.at(-1).toolName,'office_execute');
  const commandApprovals=approvals.length;
  manager.onApproval=async request=>{approvals.push(request);return {outcome:'rejected'};};
  filePlan={name:'office_execute',input:{command:"Set-Content -LiteralPath 'should-not-run.txt' -Value 'denied'",description:'这个命令应被拒绝'}};
  await manager.run({runId:'deny-terminal',sessionId:'deny-terminal',prompt:'终端拒绝测试。',privacyMode:'redact'},filesConfig,fixtureKey);
  assert.equal(approvals.length,commandApprovals+1);await assert.rejects(fs.access(path.join(workspace,'should-not-run.txt')),/ENOENT/);
  let approvalSignal;
  manager.onApproval=request=>new Promise(resolve=>{approvalSignal=request.signal;request.signal.addEventListener('abort',()=>resolve({outcome:'rejected'}),{once:true});});
  filePlan={name:'office_write_file',input:{file_path:'cancelled.txt',content:'此文件不应生成'}};
  const approvalPending=manager.run({runId:'cancel-approval',sessionId:'cancel-approval',prompt:'保存cancelled.txt',privacyMode:'redact'},filesConfig,fixtureKey);
  const approvalRejection=assert.rejects(approvalPending,/停止/);
  const approvalDeadline=Date.now()+15000;while(!approvalSignal&&Date.now()<approvalDeadline)await new Promise(resolve=>setTimeout(resolve,30));
  assert(approvalSignal);await manager.cancel('cancel-approval');await approvalRejection;assert.equal(approvalSignal.aborted,true);
  await assert.rejects(fs.access(path.join(workspace,'cancelled.txt')),/ENOENT/);
  await assert.rejects(fs.access(path.join(root,'cancel-approval','privacy-bridge.bin')),/ENOENT/);
  filePlan=null;
  filePlan={name:'office_calendar',input:{date:'2026-11-19',days:1}};
  await manager.run({runId:'ephemeral',sessionId:'ephemeral',prompt:'临时会话',privacyMode:'redact'},{...config,persist:false},fixtureKey);
  assert.equal(vaults.has('ephemeral'),false);await assert.rejects(fs.access(path.join(root,'ephemeral')),/ENOENT/);
  const switchedStart=requests.length;
  await manager.run({runId:'switch-to-redact',sessionId:'raw-session',prompt:'切换为脱敏后继续。',privacyMode:'redact'},config,fixtureKey);
  assert(!JSON.stringify(requests[switchedStart].messages).includes(fixturePhone));
  filePlan=null;
  const previous=requests.length;
  for(const privacyMode of ['redact','raw']){
   const options={runId:`secret-${privacyMode}`,sessionId:`secret-${privacyMode}`,prompt:'sk-abcdefghijklmnopqrstuvwxyz',privacyMode};
   const blocked=await manager.preview(options,config);
   assert.equal(blocked.blocked,true);assert.equal(blocked.preparationId,null);
   await assert.rejects(manager.run(options,config,fixtureKey),/凭证/);
   await assert.rejects(manager.run({...options,prompt:`这个内容不应外发：${fixtureKey}`},config,fixtureKey),/凭证/);
  }
  assert.equal(requests.length,previous);
  stall=true;const pending=manager.run({runId:'cancel-test',sessionId:'cancel-test',prompt:'测试停止',privacyMode:'redact'},config,fixtureKey);
  const rejection=assert.rejects(pending);
  const deadline=Date.now()+15000;while(requests.length===previous&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
  assert(requests.length>previous);assert.equal((await manager.cancel('cancel-test')).cancelled,true);await rejection;assert.equal(manager.runs.size,0);assert(vaults.get('cancel-test').historyKey);
 }finally{await manager.close();server.closeAllConnections();await new Promise(r=>server.close(r));const temp=await fs.realpath(os.tmpdir()),resolved=await fs.realpath(root);if(path.dirname(resolved)===temp&&path.basename(resolved).startsWith('zhixing-integration-'))await fs.rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:150});}
},{timeout:210000});

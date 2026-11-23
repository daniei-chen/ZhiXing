import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
const url=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {RuntimeManager,prepareRuntime}=await import(url('electron/runtime.mjs'));
const {KERNEL_DEFAULTS}=await import(url('src/kernel-config.js'));
const {projectTeamBoard,protectTeamContext}=await import(url('src/team-board.js'));
const {shellEnvironment,planningAllows}=await import(url('harness/shell-policy.mjs'));
const {exportOfficeFile}=await import(url('electron/office-files.mjs'));
const {readBridge}=await import(url('harness/privacy-bridge.mjs'));
const {PrivacySession}=await import(url('src/privacy-core.js'));
const {runOfficeLayout}=await import(url('electron/office-layout.mjs'));
const {recognizeImage}=await import(url('electron/ocr-service.mjs'));
const {visionPrivacy}=await import(url('electron/visual-attachments.mjs'));

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

test('真实 Harness 转换并重算 Office 文档，受审批的成果字节留在项目', {timeout:90000}, async () => {
 const actions = [
  ['office_convert', {input:'memo.docx', format:'pdf'}],
  ['office_recalculate', {input:'calc.xlsx', format:'xlsx'}],
  ['office_convert', {input:'memo.docx', format:'pdf', destination:'denied.pdf'}],
  ['office_convert', {input:'memo.docx', format:'pdf', destination:'../outside.pdf'}],
 ];
 let planning = false;
 const f = await fixture((body, index) => {
  const completed = results(body).length;
  const action = planning ? (completed === 0 ? ['office_convert', {input:'memo.docx',format:'pdf',destination:'plan.pdf'}] : null) : actions[completed];
  return action ? call(action[0], action[1], index) : [{type:'text', text:'OFFICE_FIXTURE_COMPLETE'}];
 });
 try {
  const project = path.join(f.root, 'project');
  await fs.mkdir(project);
  const docx = await exportOfficeFile('# 合成会议纪要\nPRIVATE_FIXTURE_CONTENT 电话 13800000000', 'docx');
  await fs.writeFile(path.join(project, 'memo.docx'), docx);
  await fs.writeFile(path.join(project, 'memo.pdf'), 'EXISTING_FILE');
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('数据').getCell('A1').value = {formula:'2+5',result:99};
  const originalSheet = Buffer.from(await workbook.xlsx.writeBuffer());
  await fs.writeFile(path.join(project, 'calc.xlsx'), originalSheet);
  const approvals = [];
  f.manager.onApproval = async request => {
   const {path: destination} = JSON.parse(request.reason);
   approvals.push(path.basename(destination));
   return {outcome:path.basename(destination)==='denied.pdf'?'rejected':'allowed-once'};
  };
  const config = {...f.config, workspaceRoot:project, permission:'ask'};
  const result = await f.manager.run({sessionId:'office-files',runId:'office-files',prompt:'请转换文档并重算工作簿。'},config,'fixture-conversion-key');
  assert.equal(result.text, 'OFFICE_FIXTURE_COMPLETE');
  assert.equal(f.requests.length, 5);
  const finalBlocks = results(f.requests.at(-1));
  assert.deepEqual(finalBlocks.map(block=>block.is_error===true),[false,false,true,true]);
  const values = finalBlocks.slice(0,2).map(valueOf);
  const paths = [path.join(project,'memo (2).pdf'), path.join(project,'calc-重算.xlsx')];
  assert.deepEqual(values.map(value=>[value.operation,value.format]),[['convert','pdf'],['recalculate','xlsx']]);
  const saved = await f.manager.readVault('office-files');
  const vault = new PrivacySession('office-files',saved);
  assert(values.every(value=>value.file.includes('⟦ZX-')));
  assert.deepEqual(values.map(value=>vault.restore(value.file).text), paths);
  assert.deepEqual(result.deliverables.map(file=>file.path), paths);
  assert.deepEqual(approvals, ['memo (2).pdf', 'calc-重算.xlsx', 'denied.pdf']);
  const [pdf,sheet] = await Promise.all(paths.map(file=>fs.readFile(file)));
  assert.equal(pdf.subarray(0,5).toString(), '%PDF-');
  assert.deepEqual(values.map(value=>value.bytes), [pdf.length,sheet.length]);
  const recalculated = new ExcelJS.Workbook();
  await recalculated.xlsx.load(sheet);
  assert.deepEqual(recalculated.getWorksheet(1).getCell('A1').value,{formula:'2+5',result:7});
  assert.deepEqual(await fs.readFile(path.join(project,'calc.xlsx')),originalSheet);
  assert.deepEqual(await fs.readFile(path.join(project,'memo.docx')),docx);
  assert.equal(await fs.readFile(path.join(project,'memo.pdf'),'utf8'),'EXISTING_FILE');
  for (const file of [path.join(project,'denied.pdf'),path.join(f.root,'outside.pdf')]) await assert.rejects(fs.stat(file), {code:'ENOENT'});
  const wire = JSON.stringify(f.requests);
  for (const privateData of [project,'PRIVATE_FIXTURE_CONTENT','13800000000',docx.toString('base64'),originalSheet.toString('base64'),sheet.toString('base64'),pdf.toString('base64')]) assert(!wire.includes(privateData));
  const continued = await f.manager.run({sessionId:'office-files',runId:'office-continued',prompt:'查看先前交办，不再转换。'},config,'fixture-conversion-key');
  assert.equal(continued.text,'OFFICE_FIXTURE_COMPLETE');
  assert.equal(f.requests.length,6);
  assert.equal(approvals.length,3);
  const history = await readBridge(path.join(f.root,'office-files','history-redact','office-files.bin'),saved.historyKey);
  assert.deepEqual(history.events.filter(event=>event.type==='deliverables/presented').flatMap(event=>event.data.files.map(file=>file.path)),paths);
  planning = true;
  const planned = await f.manager.run({sessionId:'office-plan',runId:'office-plan',prompt:'只分析合成资料。',startInPlanMode:true},config,'fixture-conversion-key');
  assert.equal(planned.context.planning, true);
  assert.equal(results(f.requests.at(-1)).at(-1).is_error, true);
  assert.equal(approvals.length,3);
  await assert.rejects(fs.stat(path.join(project,'plan.pdf')), {code:'ENOENT'});
 } finally {await f.close();}
});

test('真实 Harness 渲染办公页面，只向视觉模型发送本机遮罩副本并可重开会话', {timeout:90000}, async () => {
 const phone='13800000000';
 const f=await fixture((_body,index)=>{
  if(index===1)return call('office_render',{input:'visual.docx',pages:[1],dpi:144},index);
  if(index===4)return call('office_render',{input:'visual.docx',pages:[1]},index);
  return [{type:'text',text:'OFFICE_VISUAL_COMPLETE'}];
 });
 try {
  const project=path.join(f.root,'project');await fs.mkdir(project);
  const source=await exportOfficeFile('# Office Visual Test\nPhone: '+phone,'docx');
  await fs.writeFile(path.join(project,'visual.docx'),source);
  const reference=await runOfficeLayout(project,{action:'render',path:'visual.docx',pages:[1],dpi:144});
  assert.equal(reference.images.length,1);assert.equal(reference.images[0].page,1);
  const original=reference.images[0].png;
  assert((await recognizeImage('office-page.png',Buffer.from(original,'base64'))).text.replace(/\D/g,'').includes(phone));
  const key='synthetic-office-model-key';
  const visualPrivacy=visionPrivacy({},[key]);
  const config={...f.config,workspaceRoot:project,permission:'ask',inputModalities:['text','image'],visualPolicyKey:visualPrivacy.key,visualPrivacy};
  f.manager.onApproval=async()=>{throw new Error('项目内只读渲染无需文件写入审批');};
  const sessionId='visual-office';
  const first=await f.manager.run({sessionId,runId:'office-vision-first',prompt:'查看第一页版式。'},config,key);
  assert.equal(first.text,'OFFICE_VISUAL_COMPLETE');assert.equal(first.deliverables.length,0);
  assert.equal(f.requests.length,2);
  const capability=first.context.capabilityManifest.entries.find(item=>item.id==='agent-office-render');
  assert.equal(capability.effective,true);assert.equal(capability.approvalRequired,false);
  const result=results(f.requests[1])[0];
  assert.equal(result.is_error===true,false,JSON.stringify(result));
  const receipt=valueOf(result), image=result.content.find(block=>block.type==='image');
  assert.equal(receipt.operation,'render');assert.equal(receipt.images[0].page,1);assert(receipt.images[0].maskCount>0);
  assert(image);assert.notEqual(image.source.data,original);
  const protectedText=(await recognizeImage('office-safe.'+(image.source.media_type==='image/jpeg'?'jpg':'png'),Buffer.from(image.source.data,'base64'),{allowEmpty:true})).text;
  assert.match(protectedText,/Office\b[^\r\n]+\bTest/i);assert.match(protectedText,/Phone:/i);
  assert(!protectedText.replace(/\D/g,'').includes(phone));
  const saved=await f.manager.readVault(sessionId);
  assert.equal(saved.visualHistory.redact.imageCount,1);
  assert(!JSON.stringify(saved).includes(image.source.data));
  const replay=await f.manager.run({sessionId,runId:'office-vision-reopen',prompt:'沿用前面的版面。'},config,key);
  assert.equal(replay.text,'OFFICE_VISUAL_COMPLETE');assert.equal(f.requests.length,3);
  assert.deepEqual(results(f.requests[2])[0].content.find(block=>block.type==='image').source,image.source);
  const changed=visionPrivacy({customTerms:['Office']},[key]);
  await assert.rejects(f.manager.run({sessionId,runId:'office-vision-stale',prompt:'继续。'}, {...config,visualPolicyKey:changed.key,visualPrivacy:changed},key),{code:'VISION_HISTORY_STALE'});
  assert.equal(f.requests.length,3);
  const textOnly=await f.manager.run({sessionId:'office-text',runId:'office-text-only',prompt:'查看版式。'}, {...config,inputModalities:['text']},key);
  assert.equal(textOnly.text,'OFFICE_VISUAL_COMPLETE');assert.equal(f.requests.length,5);
  assert(!f.requests[3].tools.some(tool=>tool.name==='office_render'));
  assert.equal(results(f.requests[4]).at(-1).is_error,true);
  const wire=JSON.stringify(f.requests);
  for(const marker of [original,source.toString('base64'),phone,JSON.stringify(project).slice(1,-1)])assert(!wire.includes(marker));
 } finally {await f.close();}
});

test('官方原生文件读写和编辑遵守项目范围、版本检查及脱敏占位符', {timeout:90000}, async () => {
 const phone='13800000000', calls=['read','write','edit','edit','read','read','read','write','edit'];
 let planning=false;
 const f=await fixture((body,index)=>{
  const history=results(body), completed=history.length;
  if(planning){
   if(!completed)return call('read',{file_path:'source.txt'},index);
   if(completed===1)return call('write',{file_path:'plan.txt',content:'Unexpected'},index);
   return [{type:'text',text:'NATIVE_READ_ONLY'}];
  }
  if(completed>=calls.length)return [{type:'text',text:'NATIVE_FILE_COMPLETE'}];
  const token=JSON.stringify(history[0]||'').match(/⟦ZX-[^⟧]+-PHONE-\d+⟧/)?.[0];
  if(completed===1&&!token)throw new Error(`Protected source phone reference is missing: ${JSON.stringify(history[0])}`);
  const args=[{file_path:'source.txt'}, {file_path:'new.txt',content:`Phone: ${token}`},
   {file_path:'source.txt',old_string:`Phone: ${token}`,new_string:`Phone: ${token}\nEdited`},
   {file_path:'unseen.txt',old_string:'Original',new_string:'Unexpected'},
   {file_path:'../outside.txt'}, {file_path:'.env'}, {file_path:'outside-link/outside.txt'}, {file_path:'denied.txt',content:'Denied'},
   {file_path:'source.txt',old_string:'Edited',new_string:'Stale replacement'}];
  return call(calls[completed],args[completed],index);
 });
 try {
  const project=path.join(f.root,'project');await fs.mkdir(project);
  await fs.writeFile(path.join(project,'source.txt'),`Phone: ${phone}`);
  await fs.writeFile(path.join(project,'unseen.txt'),'Original');
  await fs.writeFile(path.join(f.root,'outside.txt'),'OUTSIDE_FILE_MARKER');
  await fs.symlink(f.root,path.join(project,'outside-link'),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(project,'.env'),'PRIVATE_CONFIG_MARKER');
  const approvals=[];
  f.manager.onApproval=async request=>{
   const detail=JSON.parse(request.reason), file=path.basename(detail.path);
   approvals.push([file,detail.overwrite]);
   if(file==='denied.txt')return {outcome:'rejected'};
   if(approvals.filter(([name])=>name==='source.txt').length===2)await fs.writeFile(detail.path,`Phone: ${phone}\nEdited externally`);
   return {outcome:'allowed-once'};
  };
  const config={...f.config,workspaceRoot:project,permission:'ask'};
  const output=await f.manager.run({sessionId:'native-files',runId:'native-files',prompt:'检查和更新合成项目文本文件。'},config,'synthetic-native-file-key');
  assert.equal(output.text,'NATIVE_FILE_COMPLETE');assert.equal(f.requests.length,calls.length+1);
  const final=results(f.requests.at(-1));
  assert.deepEqual(final.map(block=>block.is_error===true),[false,false,false,true,true,true,true,true,true]);
  assert.match(JSON.stringify(final.at(-1)),/changed since|变更|已变化/i);
  assert.deepEqual(approvals,[['new.txt',false],['source.txt',true],['denied.txt',false],['source.txt',true]]);
  assert.equal(await fs.readFile(path.join(project,'new.txt'),'utf8'),`Phone: ${phone}`);
  assert.equal(await fs.readFile(path.join(project,'source.txt'),'utf8'),`Phone: ${phone}\nEdited externally`);
  assert.equal(await fs.readFile(path.join(project,'unseen.txt'),'utf8'),'Original');
  await assert.rejects(fs.stat(path.join(project,'denied.txt')),{code:'ENOENT'});
  planning=true;
  const planned=await f.manager.run({sessionId:'native-file-plan',runId:'native-file-plan',prompt:'只调查。',startInPlanMode:true},config,'synthetic-native-file-key');
  assert.equal(planned.text,'NATIVE_READ_ONLY');assert.equal(planned.context.planning,true);
  assert.deepEqual(results(f.requests.at(-1)).map(block=>block.is_error===true),[false,true]);
  assert.equal(approvals.length,4);await assert.rejects(fs.stat(path.join(project,'plan.txt')),{code:'ENOENT'});
  const wire=JSON.stringify(f.requests);
  for(const marker of [phone,'OUTSIDE_FILE_MARKER','PRIVATE_CONFIG_MARKER',JSON.stringify(project).slice(1,-1)])assert(!wire.includes(marker));
 } finally {await f.close();}
});

test('官方多文件补丁先审批整批，真实内容变更保留结果和原始文件边界', {timeout:90000}, async()=>{
 const phone='13800000000';
 const patch=(...lines)=>['*** Begin Patch',...lines,'*** End Patch'].join('\n');
 const f=await fixture((body,index)=>{
  const history=results(body),token=JSON.stringify(history[0]||'').match(/⟦ZX-[^⟧]+-PHONE-\d+⟧/)?.[0];
  const patches=[
   patch('*** Add File: copy.txt',`+Phone: ${token}`,'*** Update File: source.txt','@@',`-Phone: ${token}`,`+Phone: ${token}`,'+Updated'),
   patch('*** Add File: denied-first.txt','+Denied','*** Delete File: source.txt'),
   patch('*** Add File: invalid-first.txt','+No file','*** Update File: source.txt','@@','-No such text','+Unexpected'),
   patch('*** Add File: outside-first.txt','+No file','*** Add File: ../outside.txt','+Unexpected'),
   patch('*** Update File: source.txt','*** Move to: moved.txt','@@','-Updated','+Moved','*** Delete File: copy.txt'),
  ];
  if(!history.length)return call('read',{file_path:'source.txt'},index);
  if(history.length<=patches.length){assert(token);return call('apply_patch',{input:patches[history.length-1]},index);}
  return [{type:'text',text:'NATIVE_PATCH_COMPLETE'}];
 });
 try{
  const project=path.join(f.root,'project');await fs.mkdir(project);
  await fs.writeFile(path.join(project,'source.txt'),`Phone: ${phone}\n`);
  const approvals=[];
  f.manager.onApproval=async request=>{
   const {path:targets,overwrite}=JSON.parse(request.reason);approvals.push({targets,overwrite});
   return {outcome:targets.includes('denied-first')?'rejected':'allowed-once'};
  };
  const output=await f.manager.run({sessionId:'native-patch',runId:'native-patch',prompt:'应用合成文本补丁。'},
   {...f.config,workspaceRoot:project,permission:'ask'},'synthetic-native-patch-key');
  assert.equal(output.text,'NATIVE_PATCH_COMPLETE');assert.equal(f.requests.length,7);
  const final=results(f.requests.at(-1));
  assert.deepEqual(final.map(block=>block.is_error===true),[false,false,true,true,true,false],JSON.stringify(final));
  assert.equal(approvals.length,4);
  assert.match(approvals[0].targets,/copy\.txt.*\n.*source\.txt/);
  assert.match(approvals[3].targets,/source\.txt.*moved\.txt.*\n.*copy\.txt/);
  assert(approvals.every(row=>row.overwrite));
  assert.match(await fs.readFile(path.join(project,'moved.txt'),'utf8'),new RegExp(`^Phone: ${phone}\\r?\\nMoved(?:\\r?\\n)?$`));
  for(const name of ['source.txt','copy.txt','denied-first.txt','invalid-first.txt','outside-first.txt','../outside.txt']){
   await assert.rejects(fs.stat(path.join(project,name)),{code:'ENOENT'});
  }
  assert(!JSON.stringify(f.requests).includes(phone));
 }finally{await f.close();}
});

test('原生补丁中途停止后，磁盘、模型回执和重新载入的执行轨迹均保留实际结果', {timeout:45000}, async()=>{
 const patch=['*** Begin Patch','*** Add File: committed.txt','+committed','*** Delete File: large.txt',
  '*** Add File: skipped.txt','+skipped','*** End Patch'].join('\n');
 const f=await fixture((_body,index)=>{
  if(index===1)return call('read',{file_path:'large.txt',limit:1},index);
  if(index===2)return call('apply_patch',{input:patch},index);
  return [{type:'text',text:'PATCH_STOPPED_FIXTURE'}];
 });
 try {
  const project=path.join(f.root,'project');await fs.mkdir(project);
  const large=Buffer.from('synthetic line\n'.repeat(80000));
  await fs.writeFile(path.join(project,'large.txt'),large);
  f.manager.onApproval=async()=>({outcome:'allowed-once'});
  const id='native-patch-stopped';
  const output=await f.manager.run({sessionId:id,runId:id,prompt:'处理合成项目文件。'},
   {...f.config,workspaceRoot:project,permission:'ask'},'synthetic-patch-stopped-key');
  assert.equal(output.text,'PATCH_STOPPED_FIXTURE');assert.equal(f.requests.length,3);
  assert.match(JSON.stringify(results(f.requests.at(-1)).at(-1)),/Patch stopped after 1 of 3 operations/);
  assert.match(await fs.readFile(path.join(project,'committed.txt'),'utf8'),/^committed\r?\n?$/);
  assert.deepEqual(await fs.readFile(path.join(project,'large.txt')),large);
  await assert.rejects(fs.stat(path.join(project,'skipped.txt')),{code:'ENOENT'});
  assert(f.events.some(row=>row.type==='tool/result'&&row.status==='interrupted'&&row.label==='应用项目文件补丁 · 未完成'));
  const saved=await f.manager.readVault(id);
  const history=await readBridge(path.join(f.root,id,'history-redact',`${id}.bin`),saved.historyKey);
  const {projectExecutionEvent}=await import(url('electron/execution-events.mjs'));
  const calls=new Map(),trace=history.events.map(row=>projectExecutionEvent(row,undefined,calls));
  assert(trace.some(row=>row?.status==='interrupted'&&row.label==='应用项目文件补丁 · 未完成'));
 } finally {await f.close();}
});

test('官方 glob 和 grep 运行随包 ripgrep，排除私密文件与项目外链接并保护匹配文本', {timeout:90000}, async()=>{
 const phone='13800000000';
 const actions=[['glob',{pattern:'*'}],['grep',{pattern:'SEARCH_FIXTURE',include:'*.txt'}],
  ['grep',{pattern:'SEARCH_FIXTURE',path:'../outside'}],['grep',{pattern:'SEARCH_FIXTURE',path:'project-link'}],
  ['grep',{pattern:'SEARCH_FIXTURE',path:'.env'}]];
 const f=await fixture((body,index)=>{
  const action=actions[results(body).length];
  return action?call(...action,index):[{type:'text',text:'NATIVE_SEARCH_COMPLETE'}];
 });
 try{
  const root=path.join(f.root,'project'),outside=path.join(f.root,'outside');
  await Promise.all([fs.mkdir(root),fs.mkdir(outside)]);
  await fs.mkdir(path.join(root,'Vaults'));
  await Promise.all([
   fs.writeFile(path.join(root,'surface.txt'),`SEARCH_FIXTURE Phone: ${phone}\n`),
   fs.writeFile(path.join(root,'Private.KEY'),'SEARCH_FIXTURE PRIVATE_KEY_MARKER'),
   fs.writeFile(path.join(root,'.env'),'SEARCH_FIXTURE PRIVATE_ENV_MARKER'),
   fs.writeFile(path.join(root,'Vaults','private-vault.txt'),'SEARCH_FIXTURE PRIVATE_VAULT_MARKER'),
   fs.writeFile(path.join(outside,'outside.txt'),'SEARCH_FIXTURE OUTSIDE_SEARCH_MARKER'),
   fs.symlink(outside,path.join(root,'project-link'),process.platform==='win32'?'junction':'dir'),
  ]);
  const output=await f.manager.run({sessionId:'native-search',runId:'native-search',prompt:'在项目中搜索合成文件。',startInPlanMode:true},
   {...f.config,workspaceRoot:root,permission:'ask'},'synthetic-native-search-key');
  assert.equal(output.text,'NATIVE_SEARCH_COMPLETE');assert.equal(f.requests.length,6);
  const final=results(f.requests.at(-1));
  assert.deepEqual(final.map(block=>block.is_error===true),[false,false,true,true,true],JSON.stringify(final));
  assert.match(JSON.stringify(final[0]),/surface\.txt/);
  const grep=JSON.stringify(final[1]);
  assert.match(grep,/surface\.txt/);assert.match(grep,/SEARCH_FIXTURE/);assert.match(grep,/⟦ZX-[^⟧]+-PHONE-\d+⟧/);
  const wire=JSON.stringify(f.requests);
  for(const marker of [phone,'PRIVATE_KEY_MARKER','PRIVATE_ENV_MARKER','PRIVATE_VAULT_MARKER','OUTSIDE_SEARCH_MARKER','private-vault.txt','Private.KEY'])assert(!wire.includes(marker));
 }finally{await f.close();}
});

test('同一原生会话降回请求批准后，下一次命令使用同步的工作区沙箱', {timeout:60000}, async()=>{
 const approvals=[];
 const f=await fixture((_body,index)=>index%2?call('office_execute',{command:"Write-Output 'PERMISSION_FIXTURE'",description:'查看当前执行权限'},index):[{type:'text',text:'PERMISSION_FIXTURE_COMPLETE'}]);
 try {
  const project=path.join(f.root,'project');await fs.mkdir(project);
  f.manager.onApproval=async request=>{approvals.push(request.toolName);return {outcome:'allowed-once'};};
  const sessionId='permission-resume',key='synthetic-permission-route-key';
  const observed=[];
  for(const [index,permission] of [[1,'full'],[2,'ask'],[3,'auto'],[4,'auto']]){
   const outcome=await f.manager.run({sessionId,runId:`permission-run-${index}`,prompt:'读取当前执行权限。'},
    {...f.config,workspaceRoot:project,permission},key);
   const result=valueOf(results(f.requests.at(-1)).at(-1));
   assert.match(result.stdout,/PERMISSION_FIXTURE/);
   const {historyKey}=await f.manager.readVault(sessionId);
   const history=await readBridge(path.join(f.root,sessionId,'history-redact',`${sessionId}.bin`),historyKey);
   observed.push({runtime:result.sandbox.mode,history:history.events.findLast(event=>event.type==='sandbox/mode')?.data.mode,
    presets:history.events.filter(event=>event.type==='permission/preset').map(event=>event.data.preset),
    policy:history.events.findLast(event=>event.type==='approval/policy')?.data.policy,projected:outcome.context?.permissionPreset});
  }
  assert.deepEqual(approvals,['office_execute','office_execute','office_execute']);assert.equal(f.requests.length,8);
  const presets=['workspace-full-with-confirmations','workspace-write','workspace-auto-new'];
  assert.deepEqual(observed,[0,1,2,2].map(index=>({runtime:index===0?'danger-full-access':'workspace-write',history:index===0?'danger-full-access':'workspace-write',
   presets:presets.slice(0,index+1),policy:'ask',projected:presets[index]})));
  const diagnostic=await f.manager.check({...f.config,permission:'full'},'qa-no-project-permission');
  assert.equal(diagnostic.permissionPreset,'read-only');assert.equal(f.requests.length,8);
 }finally{await f.close();}
});

test('官方原生 read_image 使用 Windows 遮罩的 PNG 和 JPEG 工作区副本', {timeout:90000}, async()=>{
 const phone='13800000000',key='synthetic-native-picture-key';
 const f=await fixture((body,index)=>{
  if(index===1)return call('read_image',{file_path:'photo.png'},index);
  if(index===2)return call('read_image',{file_path:'photo.jpg'},index);
  if(index===3)return call('read_image',{file_path:'photo.gif'},index);
  if(index===5)return call('read_image',{file_path:'photo.png'},index);
  return [{type:'text',text:'NATIVE_IMAGE_COMPLETE'}];
 });
 try{
  const project=path.join(f.root,'project');await fs.mkdir(project);
  const png=await fs.readFile(new URL('./fixtures/ocr-office-read.png',import.meta.url));
  const jpg=await sharp(png).jpeg().toBuffer();
  await Promise.all([fs.writeFile(path.join(project,'photo.png'),png),fs.writeFile(path.join(project,'photo.jpg'),jpg)]);
  const visualPrivacy=visionPrivacy({},[key]);
  const config={...f.config,workspaceRoot:project,permission:'ask',inputModalities:['text','image'],visualPolicyKey:visualPrivacy.key,visualPrivacy};
  const output=await f.manager.run({sessionId:'native-image',runId:'native-image',prompt:'读取合成项目图片。'},config,key);
  assert.equal(output.text,'NATIVE_IMAGE_COMPLETE');assert.equal(f.requests.length,4);
  const final=results(f.requests[3]);
  assert.deepEqual(final.map(row=>row.is_error===true),[false,false,true],JSON.stringify(final.map(row=>row.is_error?row:row.content.map(block=>block.type))));
  assert.equal(output.context.capabilityManifest.entries.find(item=>item.id==='native-project-image').effective,true);
  const images=final.slice(0,2).map(row=>row.content.find(block=>block.type==='image').source);
  assert.deepEqual(images.map(image=>image.media_type),['image/png','image/jpeg']);
  for(const [image,index] of images.map((image,index)=>[image,index])){
   const received=Buffer.from(image.data,'base64');assert.notDeepEqual(received,[png,jpg][index]);
   const text=(await recognizeImage(index?'approved.jpg':'approved.png',received,{allowEmpty:true})).text;
   assert(!text.replace(/\D/g,'').includes(phone));
  }
  const vault=await f.manager.readVault('native-image');assert.equal(vault.visualHistory.redact.imageCount,2);
  const textOnly=await f.manager.run({sessionId:'native-no-image',runId:'native-no-image',prompt:'文字会话。'}, {...config,inputModalities:['text']},key);
  assert.equal(textOnly.text,'NATIVE_IMAGE_COMPLETE');assert.equal(f.requests.length,6);
  assert(!f.requests[4].tools.some(tool=>tool.name==='read_image'));
  assert.equal(results(f.requests[5]).at(-1).is_error,true);
  const wire=JSON.stringify(f.requests);
  for(const data of [phone,png.toString('base64'),jpg.toString('base64')])assert(!wire.includes(data));
 }finally{await f.close();}
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

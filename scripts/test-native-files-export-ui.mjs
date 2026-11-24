import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {connectUi} from './qa-cdp.mjs';

const exe=path.resolve(process.argv[2]||'release/win-unpacked/知行.exe');
const app=path.join(path.dirname(exe),'resources','app');
const provenance=JSON.parse(await fs.readFile(path.join(app,'build-provenance.json'),'utf8'));
assert.match(provenance.version,/^0\.\d+\.\d+$/);
assert.equal(provenance.sourceDirty,false);
const evidenceRoot=path.resolve(process.env.ZHIXING_QA_EVIDENCE||`.preview/qa-${provenance.version}/native-files-ui`);
await fs.mkdir(evidenceRoot,{recursive:true});
const evidence=await fs.mkdtemp(path.join(evidenceRoot,'run-'));
const profile=path.join(evidence,'profile'),project=path.join(evidence,'project');
await Promise.all([fs.mkdir(profile),fs.mkdir(project)]);
const output=path.join(evidence,'chat-export.md');
const chatId='qa-native-files', projectId='qa-files-project', workspaceId='office-home', model='qa-native-files';
const input='textarea[aria-label="聊天输入框"]', markdown='.privacy-text pre', phone='13800000000';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={version:provenance.version,sourceCommit:provenance.sourceCommit,exeSha256:hash(await fs.readFile(exe)),
 status:'running',records:[],receipts:[],exits:[],dialogSelection:'synthetic approval and save selection only'};
const reportFile=path.join(evidence,'result.json');
const persist=()=>fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
async function record(name,details={}){report.records.push({name,status:'passed',details});await persist();console.log(`PASS ${name}`);}
console.log(`Evidence: ${evidence}`);
const large=Buffer.from('synthetic line\n'.repeat(80000));
const {exportOfficeFile}=await import(pathToFileURL(path.join(app,'electron','office-files.mjs')));
const original=await exportOfficeFile('# Synthetic Native Files QA', 'docx');
await Promise.all([fs.writeFile(path.join(project,'large.txt'),large),fs.writeFile(path.join(project,'memo.docx'),original)]);
const patch=['*** Begin Patch','*** Add File: committed.txt','+committed','*** Delete File: large.txt',
 '*** Add File: skipped.txt','+skipped','*** End Patch'].join('\n');
const expects=[['write',{file_path:'denied.txt',content:'denied'}],'QA_DENIED_END',
 ['read',{file_path:'large.txt',limit:1}],['apply_patch',{input:patch}],'QA_PARTIAL_END',
 ['office_convert',{input:'memo.docx',format:'pdf'}],'QA_OFFICE_END'];
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/v1/models')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({object:'list',data:[{id:model}]}));
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const wire=Buffer.concat(chunks).toString(),body=JSON.parse(wire);
  assert.equal(body.model,model);assert.equal(body.reasoning_effort,'high');assert.equal(body.stream,true);
  assert(!wire.includes(phone));
  const tools=body.tools.map(tool=>tool.function.name);
  assert(['read','write','apply_patch','office_convert'].every(name=>tools.includes(name)));
  const received=body.messages.filter(message=>message.role==='tool');
  const number=report.receipts.length+1, next=expects[number-1];
  assert(next, 'Unexpected model invocation');
  if(number===2)assert.match(JSON.stringify(received.at(-1)),/未获批准/);
  if(number===5)assert.match(JSON.stringify(received.at(-1)),/Patch stopped after 1 of 3 operations/);
  report.receipts.push({number,model:body.model,reasoning:body.reasoning_effort,toolResults:received.length});
  const tool=Array.isArray(next);
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
  const emit=(delta,finish_reason=null)=>'data: '+JSON.stringify({id:`qa-native-${number}`,object:'chat.completion.chunk',created:1,model,
   choices:[{index:0,delta,finish_reason}]})+'\n\n';
  const delta=tool?{tool_calls:[{id:`native-${number}`,index:0,type:'function',function:{name:next[0],arguments:JSON.stringify(next[1])}}]}:{content:next};
  res.end(emit({role:'assistant',content:''})+emit(delta)+emit({},tool?'tool_calls':'stop')+'data: [DONE]\n\n');
 }catch(error){report.fixtureError=error.message;if(!res.headersSent)res.writeHead(500);res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;

let ui,main,child,exit,log;
const saveSettled=()=>ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus === "saved"',30000);
const invoke=(method,value)=>ui.evaluate(`window.zhixing.${method}(${JSON.stringify(value) ?? ''})`);
async function ready(){await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})&&!document.querySelector(${JSON.stringify(input)}).disabled`,30000);await saveSettled();}
async function launch(){
 const logfile=path.join(evidence,`app-${report.exits.length}.log`);
 log=await fs.open(logfile,'a');
 const portsFile=path.join(profile,'DevToolsActivePort');await fs.rm(portsFile,{force:true});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_PATH;delete env.NODE_OPTIONS;
 child=spawn(exe,[`--user-data-dir=${profile}`,'--inspect=127.0.0.1:0','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'],
  {cwd:evidence,env,stdio:['ignore',log.fd,log.fd],windowsHide:true});
 exit=once(child,'close');
 const deadline=Date.now()+45000;
 while((!ui||!main)&&Date.now()<deadline){
  if(child.exitCode!==null)throw new Error(`Packaged app exited at launch (${child.exitCode})`);
  if(!ui){const ports=await fs.readFile(portsFile,'utf8').catch(()=>null);if(ports)ui=await connectUi(Number(ports.split('\n')[0])).catch(()=>null);}
  if(!main){const port=(await fs.readFile(logfile,'utf8')).match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];if(port)main=await connectUi(Number(port),true).catch(()=>null);}
  if(!ui||!main)await pause(100);
 }
 assert(ui&&main,'Windows renderer and local test adapter both started');
 const activeProfile=await main.evaluate("process.mainModule.require('electron').app.getPath('userData')");
 assert.equal(path.resolve(activeProfile),path.resolve(profile));
 await main.evaluate(`(()=>{
  const {dialog}=process.mainModule.require('electron');const observations=[];globalThis.__qaNativeDialogs=observations;
  const original=dialog.showMessageBox;dialog.showMessageBox=async (owner, options)=>{
   if(options?.title!=='批准本次文件操作')return original(owner,options);
   assertUnused();
   const response=options.detail.includes('denied.txt')?0:1;
   observations.push({operation:options.message,response});return {response};
  };
  function assertUnused(){if(observations.length>4)throw new Error('unexpected repeated approval');}
  dialog.showSaveDialog=async (_owner,options)=>{
   if(!options.filters?.some(filter=>filter.extensions.includes('md')))throw new Error('Unexpected export format');
   if(globalThis.__qaNativeHold)return new Promise(resolve=>{globalThis.__qaNativeResolve=resolve;});
   return {canceled:false,filePath:${JSON.stringify(output)}};
  };
  return true;
 })()`);
 await ready();
}
async function closeApp(){
 void ui.evaluate('window.zhixing.windowControl("close")').catch(()=>{}); main.close();main=null;
 const timeout=new AbortController();
 try{
  const [code,signal]=await Promise.race([exit,pause(40000,null,{signal:timeout.signal}).then(()=>{throw new Error('Packaged app did not close');})]);
  report.exits.push({code,signal});assert.equal(code,0);assert.equal(signal,null);
 }finally{timeout.abort();ui.close();ui=null;}
 child=null;await log.close();log=null;
}
async function openChat(){
 if(await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")'))await ui.click('展开侧栏');
 const selector=`.project-chats .chat-row[data-chat-id="${chatId}"] .chat-link`;
 await ui.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
 await ui.click(await ui.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`),selector);
 await ready();
}
async function send(text,marker){
 await ui.fill(input,text);await ui.click('发送消息','.composer button');
 await ui.waitFor(`document.querySelector('.transcript')?.textContent.includes(${JSON.stringify(marker)})&&!document.querySelector('button[aria-label=停止生成]')`,65000);
 await saveSettled();assert.equal(report.fixtureError,undefined);
}
const chooseMarkdown=async()=>{
 await ui.click('会话操作');await ui.click('导出聊天文件…','.session-actions-menu button');
 await ui.fill('select[aria-label="文件格式"]','md');
 await ui.waitFor(`document.querySelector(${JSON.stringify(markdown)})?.textContent.includes('QA_OFFICE_END')`);
};
const confirm=()=>ui.evaluate('document.querySelector(".review-modal .checkbox-row input").click()');

try{
 await launch();
 const provider=await invoke('saveProvider',{name:'QA Native Files',protocol:'openai',baseUrl:endpoint,apiKey:'synthetic-native-ui-key',reasoningStyle:'standard',discover:true});
 const id=provider.providers.find(row=>row.name==='QA Native Files')?.id;assert(id);
 const state=await invoke('loadWorkspace');state.workspaceId=workspaceId;
 Object.assign(state.settings,{persist:true,demo:false,modelProviderId:id,model,reasoning:'high',permission:'ask',privacyMode:'redact'});
 state.projects.push({id:projectId,workspaceId,name:'原生文件合成项目',directory:project,expanded:true});
 state.chats.push({id:chatId,workspaceId,projectId,title:'原生文件实包验收',createdAt:Date.now(),messages:[]});
 await invoke('saveWorkspace',state);await ui.send('Page.reload');await ready();await openChat();

 await send(`记录拒绝审批；电话 ${phone}`,'QA_DENIED_END');
 assert.equal(report.receipts.length,2);
 await assert.rejects(fs.stat(path.join(project,'denied.txt')), {code:'ENOENT'});
 assert.deepEqual(await main.evaluate('__qaNativeDialogs.map(item=>item.response)'),[0]);
 await record('Windows 当前执行权限触发原生 write 审批，拒绝后未写入',{receipts:2});

 await send('批准这一批演练，检查文件停下的位置。','QA_PARTIAL_END');
 assert.equal(report.receipts.length,5);
 assert.match(await fs.readFile(path.join(project,'committed.txt'),'utf8'),/^committed\r?\n?$/);
 assert.deepEqual(await fs.readFile(path.join(project,'large.txt')),large);
 await assert.rejects(fs.stat(path.join(project,'skipped.txt')), {code:'ENOENT'});
 assert.deepEqual(await main.evaluate('__qaNativeDialogs.map(item=>item.response)'),[0,1]);
 await record('实际批准的多文件补丁停在第 1/3 步，已写文件保留、后续文件不变',{receipts:5});

 await send('把项目里的合成 Word 另存为 PDF。','QA_OFFICE_END');
 const pdf=await fs.readFile(path.join(project,'memo.pdf'));
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.deepEqual(await fs.readFile(path.join(project,'memo.docx')),original);
 assert.deepEqual(await main.evaluate('__qaNativeDialogs.map(item=>item.response)'),[0,1,1]);
 await record('Office 转换的真实桌面审批可批准，源文件保持原字节',{receipts:7,pdfSha256:hash(pdf),pdfBytes:pdf.length});

 await closeApp();await launch();await openChat();
 const reopened=await invoke('loadWorkspace');
 assert(reopened.chats.find(row=>row.id===chatId).messages.some(message=>message.trace?.some(event=>event.status==='interrupted'&&event.label==='应用项目文件补丁 · 未完成')));
 await chooseMarkdown();
 const expected=await ui.evaluate(`document.querySelector(${JSON.stringify(markdown)}).textContent`);
 for(const text of ['QA_DENIED_END','Tool: `apply_patch`','Patch stopped after 1 of 3 operations','QA_OFFICE_END'])assert(expected.includes(text));
 assert(!expected.includes(phone)&&!expected.includes(project)&&!expected.includes('⟦ZX-'));
 await confirm();
 await ui.fill('select[aria-label="历史来源"]','raw');
 await ui.waitFor('document.querySelector(".review-modal [role=alert]")?.textContent.includes("没有已保存的原生会话记录")');
 assert(await ui.evaluate('document.querySelector(".review-modal button.primary-button").disabled&&!document.querySelector(".review-modal .checkbox-row input").checked'));
 await ui.fill('select[aria-label="历史来源"]','redact');
 await ui.waitFor(`document.querySelector(${JSON.stringify(markdown)})?.textContent.includes('QA_OFFICE_END')`);
 await confirm();await ui.click('保存文件','.review-modal button');
 await ui.waitFor('!document.querySelector(".review-modal")');
 const bytes=await fs.readFile(output);assert.deepEqual(bytes,Buffer.from(expected,'utf8'));
 assert.equal(report.receipts.length,7);
 await record('重启后保留补丁终态；Markdown 按所选历史和已审阅快照保存准确字节，零新增出站',{markdownBytes:bytes.length,markdownSha256:hash(bytes)});

 await chooseMarkdown();
 await main.evaluate('globalThis.__qaNativeHold=true');
 await confirm();await ui.click('保存文件','.review-modal button');
 await main.waitFor('typeof globalThis.__qaNativeResolve==="function"');
 const moved=await invoke('loadWorkspace');moved.chats.find(row=>row.id===chatId).projectId=null;await invoke('saveWorkspace',moved);
 const forbidden=path.join(evidence,'must-not-save.md');
 await main.evaluate(`globalThis.__qaNativeResolve({canceled:false,filePath:${JSON.stringify(forbidden)}})`);
 await ui.waitFor('document.querySelector(".review-modal [role=alert]")?.textContent.includes("移到其他位置")');
 await assert.rejects(fs.stat(forbidden), {code:'ENOENT'});
 assert.equal(report.receipts.length,7);
 await record('保存对话框打开期间移动会话，旧快照不再允许写盘');

 await closeApp();report.status='passed';await persist();
}catch(error){report.status='failed';report.error=error.message;await persist();throw error;}
finally{
 main?.close();ui?.close();
 if(child?.exitCode===null){child.kill();await exit;}
 await log?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}


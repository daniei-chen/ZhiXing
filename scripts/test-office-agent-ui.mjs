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
assert.equal(provenance.sourceDirty,false);
const model='qa-office-vision', workspaceId='office-home', projectId='qa-office-project', chatId='qa-office-chat';
const chatTitle='Office 本机验收', phone='13800000000', input='textarea[aria-label="聊天输入框"]';
const command='请检查第一页排版并把文档另存为 PDF。';
const root=path.resolve(process.env.ZHIXING_QA_EVIDENCE||`.preview/qa-${provenance.version}/office-ui`);
await fs.mkdir(root,{recursive:true});
const evidence=await fs.mkdtemp(path.join(root,'run-'));
const profile=path.join(evidence,'profile'), project=path.join(evidence,'project');
await Promise.all([fs.mkdir(profile),fs.mkdir(project)]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const {exportOfficeFile}=await import(pathToFileURL(path.join(app,'electron','office-files.mjs')));
const {runOfficeLayout}=await import(pathToFileURL(path.join(app,'electron','office-layout.mjs')));
const {recognizeImage}=await import(pathToFileURL(path.join(app,'electron','ocr-service.mjs')));
const original=await exportOfficeFile('# Office Visual Test\nPhone: '+phone,'docx');
await fs.writeFile(path.join(project,'memo.docx'),original);
const {images:[page]}=await runOfficeLayout(project,{action:'render',path:'memo.docx',pages:[1],dpi:144});
assert((await recognizeImage('source.png',Buffer.from(page.png,'base64'))).text.replace(/\D/g,'').includes(phone));
const report={version:provenance.version,sourceCommit:provenance.sourceCommit,exeSha256:hash(await fs.readFile(exe)),
 records:[],receipts:[],sourcePageSha256:hash(Buffer.from(page.png,'base64')),exits:[]};
const reportFile=path.join(evidence,'result.json');
const persist=()=>fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
async function record(name,details={}){report.records.push({name,status:'passed',details});await persist();console.log(`PASS ${name}`);}

let protectedImage;
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/v1/models'){
   res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({object:'list',data:[{id:model,input_modalities:['text','image']}]}));return;
  }
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const wire=Buffer.concat(chunks).toString('utf8'),body=JSON.parse(wire);
  assert(!wire.includes(original.toString('base64'))&&!wire.includes(page.png)&&!wire.includes(phone));
  const tools=body.tools.map(tool=>tool.function.name);
  assert(tools.includes('office_render')&&tools.includes('office_convert'));
  assert.equal(body.model,model);assert.equal(body.reasoning_effort,'high');assert.equal(body.stream,true);
  const images=body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(item=>item.type==='image_url').map(item=>{
   const match=/^data:(image\/(?:png|jpeg));base64,([^\s]+)$/.exec(item.image_url.url);assert(match);
   const bytes=Buffer.from(match[2],'base64');protectedImage={bytes,mime:match[1]};
   return {sha256:hash(bytes),mime:match[1],bytes:bytes.length};
  });
  const number=report.receipts.length+1;
  report.receipts.push({number,model:body.model,reasoning:body.reasoning_effort,images,toolResultCount:body.messages.filter(message=>message.role==='tool').length});
  const tool=number===1?['office_render',{input:'memo.docx',pages:[1],dpi:144}]:number===2?['office_convert',{input:'memo.docx',format:'pdf'}]:null;
  assert(number<=4,'Unexpected model invocation');
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
  const emit=(delta,finish_reason=null)=>'data: '+JSON.stringify({id:`qa-office-${number}`,object:'chat.completion.chunk',created:1,model,
   choices:[{index:0,delta,finish_reason}]})+'\n\n';
  const delta=tool?{tool_calls:[{id:`office-${number}`,index:0,type:'function',function:{name:tool[0],arguments:JSON.stringify(tool[1])}}]}:{content:'QA_OFFICE_DONE_'+number};
  res.end(emit({role:'assistant',content:''})+emit(delta)+emit({},tool?'tool_calls':'stop')+'data: [DONE]\n\n');
 }catch(error){report.fixtureError=error.message;if(!res.headersSent)res.writeHead(500);res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;

let ui,child,exit,log;
const saveSettled=()=>ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus === "saved"',25000);
const load=()=>ui.evaluate('window.zhixing.loadWorkspace()');
async function ready(){
 await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})&&!document.querySelector(${JSON.stringify(input)}).disabled`,30000);
 await saveSettled();
}
async function launch(){
 log=await fs.open(path.join(evidence,'app.log'),'a');
 const portsFile=path.join(profile,'DevToolsActivePort');await fs.rm(portsFile,{force:true});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_PATH;delete env.NODE_OPTIONS;
 child=spawn(exe,[`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'],{cwd:evidence,env,stdio:['ignore',log.fd,log.fd],windowsHide:true});
 exit=once(child,'close');
 const deadline=Date.now()+45000;
 while(!ui&&Date.now()<deadline){
  if(child.exitCode!==null)throw new Error(`Packaged app exited at launch (${child.exitCode})`);
  const ports=await fs.readFile(portsFile,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(ports)ui=await connectUi(Number(ports.split('\n')[0])).catch(()=>null);
  if(!ui)await pause(100);
 }
 assert(ui,'Windows renderer started');await ready();
}
async function closeApp(){
 void ui?.evaluate('window.zhixing.windowControl("close")').catch(()=>{});
 const timeout=new AbortController();
 try{
  const [code,signal]=await Promise.race([exit,pause(40000,null,{signal:timeout.signal}).then(()=>{throw new Error('Packaged app did not close');})]);
  report.exits.push({code,signal});assert.equal(code,0);assert.equal(signal,null);
 }finally{timeout.abort();ui?.close();ui=null;}
 child=null;await log.close();log=null;
}
async function openChat(){
 if(await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")'))await ui.click('展开侧栏');
 const selector=`.project-chats .chat-row[data-chat-id="${chatId}"] .chat-link`;
 await ui.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
 const label=await ui.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
 assert(label);await ui.click(label,selector);await ready();
}
const send=()=>ui.click('发送消息','.composer button');
const waitForReply=marker=>ui.waitFor(`document.querySelector('.transcript')?.textContent.includes(${JSON.stringify(marker)})&&!document.querySelector('button[aria-label=停止生成]')`,65000);

try{
 console.log(`Evidence: ${evidence}`);
 await launch();
 const providerInput={name:'QA Office Vision',protocol:'openai',baseUrl:endpoint,apiKey:'synthetic-office-ui-key',reasoningStyle:'standard',discover:true};
 const status=await ui.evaluate(`window.zhixing.saveProvider(${JSON.stringify(providerInput)})`);
 assert.equal(status.appVersion,provenance.version);
 const provider=status.providers.find(item=>item.name===providerInput.name);assert(provider);
 const state=await load();state.workspaceId=workspaceId;
 Object.assign(state.settings,{persist:true,demo:false,modelProviderId:provider.id,model,reasoning:'high',permission:'auto',privacyMode:'redact'});
 state.projects.push({id:projectId,workspaceId,name:'Office 合成项目',directory:project,expanded:true});
 state.chats.push({id:chatId,workspaceId,projectId,title:chatTitle,createdAt:Date.now(),messages:[]});
 await ui.evaluate(`window.zhixing.saveWorkspace(${JSON.stringify(state)})`);await ui.send('Page.reload');await ready();await openChat();

 await ui.fill(input,'/计划');await send();
 await ui.waitFor('!!document.querySelector(".context-usage button")&&document.querySelector(".transcript")?.textContent.includes("规划模式 · 只读调查")',35000);
 await saveSettled();assert.equal(report.receipts.length,0);
 await ui.fill(input,command);
 await ui.click('退出规划模式','.context-usage button');
 await ui.waitFor('!document.querySelector("button[aria-label=停止生成]")&&![...document.querySelectorAll(".context-usage button")].some(button=>button.textContent.includes("退出规划"))',35000);
 await saveSettled();assert.equal(await ui.evaluate(`document.querySelector(${JSON.stringify(input)}).value`),command);
 assert.equal(report.receipts.length,0);
 await record('中文规划命令和退出按钮通过原生 SDK 执行，保留草稿且没有模型出站');

 await send();await waitForReply('QA_OFFICE_DONE_3');await saveSettled();
 assert.equal(report.fixtureError,undefined);assert.equal(report.receipts.length,3);
 assert.deepEqual(report.receipts.map(item=>item.images.length),[0,1,1]);
 assert.deepEqual(report.receipts.map(item=>item.toolResultCount),[0,1,2]);
 assert.deepEqual(report.receipts[1].images,report.receipts[2].images);
 const {bytes,mime}=protectedImage;
 assert.notEqual(hash(bytes),report.sourcePageSha256);
 const text=(await recognizeImage('approved.'+(mime==='image/jpeg'?'jpg':'png'),bytes,{allowEmpty:true})).text;
 assert.match(text,/Office\b[^\r\n]+\bTest/i);assert(!text.replace(/\D/g,'').includes(phone));
 const pdf=await fs.readFile(path.join(project,'memo.pdf'));
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.deepEqual(await fs.readFile(path.join(project,'memo.docx')),original);
 await record('OpenAI 兼容路线收到真实遮罩像素，OfficeKit 转换保留原文件并交付 PDF',{pdfSha256:hash(pdf),pdfBytes:pdf.length});

 await closeApp();await launch();await openChat();
 const delivery='.deliverable-files button';
 const label=await ui.evaluate(`document.querySelector('${delivery}')?.textContent.trim()`);
 assert(label?.includes('memo.pdf'));
 await ui.click(label,delivery);
 await ui.waitFor('document.querySelector(".modal")?.textContent.includes("Office Visual Test")',25000);
 await ui.click('关闭对话框','.modal button');
 assert.equal(report.receipts.length,3);
 await ui.fill(input,'继续核对刚才的版式。');await send();await waitForReply('QA_OFFICE_DONE_4');await saveSettled();
 assert.equal(report.receipts.length,4);assert.deepEqual(report.receipts[3].images,report.receipts[1].images);
 await record('重启后从聊天打开原生 PDF 成果，追问重放同一视觉副本且没有重复转换');

 await closeApp();assert.deepEqual(report.exits,[{code:0,signal:null},{code:0,signal:null}]);
 await record('两个隔离的 Windows 目录包进程正常退出');
 report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;throw error;}
finally{
 if(child){try{await closeApp();}catch{ui?.close();child.kill();await exit.catch(()=>{});await log?.close();}}
 await persist();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
}

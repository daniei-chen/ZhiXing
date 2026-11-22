import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {connectUi} from './qa-cdp.mjs';

// Real packaged App + preload + encrypted workspace + Harness + loopback HTTP.
// Only fixture setup uses saveWorkspace; all sends, deletion and materials actions use the UI.
// This script closes/relaunches ONLY the verified isolated QA process and leaves it running.
const repository=path.resolve(import.meta.dirname,'..');
const fixtureOnly=process.argv.includes('--check-fixtures');
const port=Number(process.env.QA_PORT||process.env.ZHIXING_QA_PORT||9343);
const mainPort=Number(process.env.QA_MAIN_PORT||process.env.MAIN_PORT||9344);
const projectId=process.env.QA_PROJECT_ID||'qa-0122-project';
const evidence=path.resolve(process.env.QA_EVIDENCE||path.join(repository,'.preview/qa-0.12.2-audit/agent-c',fixtureOnly?'conversation-fixture-check':'packed-journey'));
const runId=`audit-c-${Date.now().toString(36)}-${crypto.randomUUID().slice(0,6)}`;
const input='textarea[aria-label="聊天输入框"]';
const records=[],requests=[],held=[];
let ui,main,host,providerId,originalSettings,ownedRun=false,restartedChild,logHandle;
await fs.mkdir(evidence,{recursive:true});
const baseline={runId,startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),layer:fixtureOnly?'Synthetic loopback HTTP routing fixtures only; no Windows product or Harness execution':'Windows packaged renderer + real Harness + loopback; no real cloud'};
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
async function record(name,details={}) {
  records.push({name,status:'passed',time:new Date().toISOString(),details});
  await fs.writeFile(path.join(evidence,'journey.json'),JSON.stringify({...baseline,records},null,2));
  await fs.writeFile(path.join(evidence,'outbound-requests.json'),JSON.stringify(requests,null,2));
  console.log(`PASS ${name}`);
}
const server=http.createServer(async(request,response)=>{
  try {
    if(request.url==='/v1/models'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({object:'list',data:[{id:'qa-audit',object:'model',owned_by:'synthetic-local'}]}));return;}
    assert.equal(request.url,'/v1/chat/completions');
    let body='';for await(const chunk of request)body+=chunk;
    const parsed=JSON.parse(body),receipt={time:new Date().toISOString(),body:parsed};requests.push(receipt);
    // Select the latest actual task first; never route by any marker in history,
    // attached material, or official time/skills/system reminder user messages.
    const task=currentAuditTask(parsed.messages||[]),text=task.text;
    const route=/^QA_AUDIT_FAIL_HOLD(?:\s|$)/.test(text)?'hold':/^QA_AUDIT_STREAM(?:\s|$)/.test(text)?'stream':'normal';
    receipt.routing={messageIndex:task.messageIndex,route};
    if(route==='hold'){held.push(response);return;}
    if(route==='stream'){
      response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});
      const emit=content=>response.write('data: '+JSON.stringify({id:'audit-stream',object:'chat.completion.chunk',created:1,model:'qa-audit',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\n');
      emit('SAFE_AUDIT_PARTIAL 本机合成长输出，只用于取消和归档验收。\n');
      const timer=setInterval(()=>emit('SAFE_AUDIT_PARTIAL 本机合成正文继续输出，所有内容均非真实资料。\n'),70);
      response.on('close',()=>clearInterval(timer));return;
    }
    if(parsed.stream){
      response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      const chunk=(delta,finish_reason=null)=>'data: '+JSON.stringify({id:'audit-normal',object:'chat.completion.chunk',created:1,model:'qa-audit',choices:[{index:0,delta,finish_reason}]})+'\n\n';
      response.end(chunk({role:'assistant',content:'SAFE_AUDIT_RESPONSE'})+chunk({},'stop')+'data: [DONE]\n\n');
    }else{
      response.writeHead(200,{'content-type':'application/json'});
      response.end(JSON.stringify({id:'audit-normal',object:'chat.completion',created:1,model:'qa-audit',choices:[{index:0,message:{role:'assistant',content:'SAFE_AUDIT_RESPONSE'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}}));
    }
  } catch(error){response.writeHead(500,{'content-type':'application/json'});response.end(JSON.stringify({error:{message:error.message}}));}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
function releaseFailure(){assert(held.length,'No real outbound request is waiting');for(const response of held.splice(0)){response.writeHead(400,{'content-type':'application/json'});response.end(JSON.stringify({error:{message:'SYNTHETIC_AUDIT_FAILURE',type:'invalid_request_error',code:'SYNTHETIC_AUDIT_FAILURE'}}));}}
const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
async function until(check,label,timeout=20000){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{if(await check())return;}catch{}await pause();}throw new Error(`Timed out: ${label}`);}
const workspace=()=>ui.evaluate('window.zhixing.loadWorkspace()');
const saveSettled=()=>ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"',20000);
const value=()=>ui.evaluate(`document.querySelector(${JSON.stringify(input)})?.value`);
async function clickSelector(selector){const label=await ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(node=>node.getClientRects().length);if(nodes.length!==1)throw Error('Expected one visible control, got '+nodes.length);return nodes[0].getAttribute('aria-label')||nodes[0].textContent.trim();})()`);await ui.click(label,selector);}
async function dismissToast(){if(await ui.evaluate('!!document.querySelector(".toast-dismiss")'))await ui.click('关闭错误提示');}
async function ready(){await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})&&!document.querySelector(${JSON.stringify(input)}).disabled`,30000);await saveSettled();await ui.evaluate(`(()=>{window.__auditEvents=[];window.__auditOff?.();window.__auditOff=window.zhixing.onRuntimeEvent(event=>window.__auditEvents.push(event));})()`);if(await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")'))await ui.click('展开侧栏');}
async function reload(){await ui.send('Page.reload');await until(async()=>{await ready();return true;},'Page.reload recovery',45000);}
async function seed(transform){await saveSettled();const current=await workspace();const next=transform(current);await ui.evaluate(`window.zhixing.saveWorkspace(${JSON.stringify(next)})`);await reload();return next;}
async function openChat(id){await dismissToast();const projectSelector=`.sidebar-projects .chat-row[data-chat-id="${id}"] .chat-link`;const target=await ui.evaluate(`!!document.querySelector(${JSON.stringify(projectSelector)})`)?projectSelector:`.sidebar-scroll .chat-row[data-chat-id="${id}"] .chat-link`;await clickSelector(target);}
async function attachFile(name,text){await ui.evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(text)}],${JSON.stringify(name)},{type:'text/plain'}));document.querySelector('.composer').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()`);await ui.waitFor(`[...document.querySelectorAll('.composer .attachment-chip:not(.invalid)')].some(node=>node.textContent.includes(${JSON.stringify(name)}))`);}
async function startFailure(prompt){await dismissToast();await ui.fill(input,prompt);await ui.click('发送消息','.composer button');ownedRun=true;await until(()=>held.length>0,'real loopback failure request',45000);assert.equal(await value(),'');}
async function settledFailure(){releaseFailure();await ui.waitFor('!document.querySelector("button[aria-label=停止生成]")&&!!document.querySelector(".transcript .assistant-message:last-of-type .answer-actions")',45000);ownedRun=false;await saveSettled();}
const file=(id,text)=>({id,name:`${id}.txt`,size:Buffer.byteLength(text),status:'ready',text,workspaceId:host.workspaceId});
const ids={failure:`${runId}-failure`,delete:`${runId}-delete`,archived:`${runId}-archived`,moved:`${runId}-moved`,project:`${runId}-project`,projectChat:`${runId}-project-chat`};
const marker={deleted:`${runId}_DELETE_BODY`,attachment:`${runId}_DELETE_ATTACHMENT`,archived:`${runId}_ARCHIVED_DELETE`,project:`${runId}_PROJECT_DELETE`,keep:`${runId}_MOVED_KEEP`,shared:`${runId}_SHARED_KEEP`};
async function diskCheck(){
  return main.evaluate(`(async()=>{const require=process.mainModule.require,e=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');const profile=e.app.getPath('userData');if(profile!==${JSON.stringify(host.profile)})throw Error('Wrong QA profile');const bytes=await fs.readFile(path.join(profile,'zhixing','workspace.bin'));const decoded=e.safeStorage.decryptString(bytes);const gone=${JSON.stringify([marker.deleted,marker.attachment,marker.archived,marker.project])},keep=${JSON.stringify([marker.keep,marker.shared])};const exists=async file=>{try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};return {ciphertextBytes:bytes.length,ciphertextSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),deletedAbsent:gone.every(marker=>!decoded.includes(marker)),keptPresent:keep.every(marker=>decoded.includes(marker)),draftKeys:Object.keys(JSON.parse(decoded).drafts||{}),deletedNativeSessionPresent:await exists(path.join(profile,'zhixing','harness',${JSON.stringify(ids.delete)})),deletedVaultPresent:await exists(path.join(profile,'zhixing','vaults',${JSON.stringify(ids.delete+'.bin')}))};})()`);
}
async function deleteChat(id){await openChat(id);const selector=`.sidebar-projects .chat-row[data-chat-id="${id}"] .row-more`;if(await ui.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`))await clickSelector(selector);else await clickSelector(`.sidebar-scroll .chat-row[data-chat-id="${id}"] .row-more`);await ui.click('删除聊天','[role=menuitem]');await ui.click('删除','.modal .danger-button');await ui.waitFor('!document.querySelector(".deletion-pending")',30000);await saveSettled();}
async function fixtureSelfCheck(){
  const task=text=>'任务模式：办公\n\n【本次交办】\n'+text;
  const reminders=[{role:'user',content:'<system-reminder>Current session context.</system-reminder>'},{role:'user',content:'<system-reminder>Available skills; quoted QA_AUDIT_STREAM is not a task.</system-reminder>'},{role:'user',content:'Time sampled while preparing turn 1, step 1: 2026-11-21T21:06:57+08:00[Asia/Shanghai]'}];
  const post=messages=>{assert.equal(messages.filter(message=>message.role==='user').length,4);return fetch(endpoint+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'qa-audit',stream:true,messages})});};
  const hold=post([{role:'user',content:task('QA_AUDIT_FAIL_HOLD current')},...reminders]);
  await until(()=>held.length===1,'fixture held request',3000);assert.equal(requests.at(-1).routing.route,'hold');releaseFailure();
  const failed=await hold;assert.equal(failed.status,400);assert((await failed.text()).includes('SYNTHETIC_AUDIT_FAILURE'));
  await record('HTTP夹具：4个user且末尾time-context时，本次FAIL_HOLD正确挂起并返回指定故障');

  const stream=await post([{role:'user',content:'【近期对话，仅作上下文】\n用户：QA_AUDIT_FAIL_HOLD old\n\n'+task('QA_AUDIT_STREAM current')},...reminders]);
  assert.equal(stream.status,200);const reader=stream.body.getReader();try{const first=await reader.read();assert(new TextDecoder().decode(first.value).includes('SAFE_AUDIT_PARTIAL'));}finally{await reader.cancel();}
  assert.equal(requests.at(-1).routing.route,'stream');assert.equal(held.length,0);
  await record('HTTP夹具：当前STREAM优先于同消息历史旧FAIL_HOLD，官方reminder/time-tail保留');

  const normalMessages=[{role:'user',content:task('QA_AUDIT_FAIL_HOLD previous')},{role:'user',content:task('QA_AUDIT_NORMAL current')},reminders[1],reminders[2]];
  const normal=await post(normalMessages);assert.equal(normal.status,200);assert((await normal.text()).includes('SAFE_AUDIT_RESPONSE'));assert.equal(requests.at(-1).routing.messageIndex,1);assert.equal(requests.at(-1).routing.route,'normal');assert.equal(held.length,0);
  await record('HTTP夹具：最近真实任务为NORMAL时，不因更早任务的旧FAIL_HOLD误路由');

  const arrayMessages=[{role:'user',content:task('QA_AUDIT_STREAM previous')},{role:'user',content:[{type:'text',text:task('QA_AUDIT_NORMAL array-content')+'\n\n【资料 1：old.txt】\nQA_AUDIT_FAIL_HOLD\n【资料 1 结束】'}]},reminders[0],reminders[2]];
  const array=await post(arrayMessages);assert.equal(array.status,200);assert((await array.text()).includes('SAFE_AUDIT_RESPONSE'));assert.equal(requests.at(-1).routing.messageIndex,1);assert.equal(requests.at(-1).routing.route,'normal');assert.equal(held.length,0);
  await record('HTTP夹具：文本块数组及附件旧marker不改变最近本次交办的NORMAL路由');
  assert.equal(requests.length,4);
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({...baseline,status:'fixture-only-passed',records,requestCount:requests.length,coverage:'HTTP task routing only; no Windows product, main inspector, Harness, process restart or cloud executed',completedAt:new Date().toISOString()},null,2));
}
try {
  if(fixtureOnly)await fixtureSelfCheck();
  else {
  ui=await connectUi(port);main=await connectUi(mainPort,true);
  host=await main.evaluate(`(()=>{const e=process.mainModule.require('electron');return {pid:process.pid,exe:e.app.getPath('exe'),profile:e.app.getPath('userData')};})()`);
  assert(path.isAbsolute(host.exe)&&/win-unpacked[\\/]知行\.exe$/i.test(host.exe),'Only the isolated packaged candidate may be restarted.');
  assert(host.profile.toLowerCase().includes(`${path.sep}.preview${path.sep}qa-0.12.2${path.sep}`.toLowerCase()),'Refusing to touch a non-QA profile.');
  if(process.env.QA_PROFILE)assert.equal(path.resolve(host.profile),path.resolve(process.env.QA_PROFILE));
  await ready();assert.equal(await ui.evaluate('!!document.querySelector("button[aria-label=停止生成]")'),false);
  assert.deepEqual(await ui.evaluate('window.zhixing.runtimeCleanupStatus()'),[],'Finish prior cleanup before this journey');
  const initial=await workspace();const project=initial.projects.find(item=>item.id===projectId);assert(project?.directory,'The synthetic project must already have a bound directory.');host.workspaceId=project.workspaceId;
  originalSettings=initial.settings;
  const runtime=await ui.evaluate(`window.zhixing.saveProvider(${JSON.stringify({name:runId,protocol:'openai',baseUrl:endpoint,apiKey:'synthetic-audit-0121-key',reasoningStyle:'standard',manualModels:'qa-audit',discover:true})})`);
  providerId=runtime.providers.find(row=>row.name===runId)?.id;assert(providerId,'Synthetic provider not saved');
  await seed(state=>({...state,workspaceId:project.workspaceId,settings:{...state.settings,persist:true,demo:false,modelProviderId:providerId,model:'qa-audit',reasoning:'high',privacyMode:'redact'},chats:[...state.chats,{id:ids.failure,workspaceId:project.workspaceId,projectId,title:ids.failure,messages:[],createdAt:Date.now()}],drafts:{...state.drafts,[`chat:${ids.failure}`]:{kind:'chat',draftId:ids.failure,chatId:ids.failure,workspaceId:project.workspaceId,projectId,revision:1,text:`QA_AUDIT_FAIL_HOLD ${runId}`,files:[],updatedAt:Date.now()}}}));
  await openChat(ids.failure);
  await attachFile(`${runId}-one.txt`,'FIRST_PARSED_SYNTHETIC_MARKER');await attachFile(`${runId}-two.txt`,'SECOND_PARSED_SYNTHETIC_MARKER');
  const failedPrompt=`QA_AUDIT_FAIL_HOLD ${runId} 联系电话 138-0000-0000`;
  await startFailure(failedPrompt);await settledFailure();
  assert.equal(await value(),failedPrompt,'Must recover immediately without navigation');
  assert.equal(await ui.evaluate('document.querySelectorAll(".composer .attachment-chip").length'),2);
  let saved=await workspace();let failure=saved.chats.find(row=>row.id===ids.failure).messages.at(-1);
  assert(failure.error&&!failure.pending&&failure.trace.length>0);assert.equal(failure.finalization.executionStatus,'failed');
  assert(requests.length>0);assert(!JSON.stringify(requests[0].body).includes('138-0000-0000'));assert(JSON.stringify(requests[0].body).includes('FIRST_PARSED_SYNTHETIC_MARKER'));
  await record('失败后不导航恢复正文与实际解析附件，HTTP接收端有真实出站且电话已保护',{requestCount:requests.length,traceCount:failure.trace.length,finalization:failure.finalization});

  const newText=`${runId}_NEW_INPUT_MUST_SURVIVE`;
  await startFailure(`QA_AUDIT_FAIL_HOLD ${runId} second`);await ui.fill(input,newText);await settledFailure();assert.equal(await value(),newText);assert.equal(await ui.evaluate('document.querySelectorAll(".composer .attachment-chip").length'),0);
  await record('失败期间输入的新正文不被旧草稿覆盖',{requestCount:requests.length});

  await dismissToast();await ui.fill(input,`QA_AUDIT_STREAM ${runId}`);await ui.click('发送消息','.composer button');ownedRun=true;
  await ui.waitFor('document.querySelector(".transcript .assistant-message:last-of-type")?.textContent.includes("SAFE_AUDIT_PARTIAL")',45000);
  await ui.click('停止生成');await ui.waitFor('!document.querySelector("button[aria-label=停止生成]")',45000);ownedRun=false;await saveSettled();
  saved=await workspace();const cancelled=saved.chats.find(row=>row.id===ids.failure).messages.at(-1);assert(cancelled.stopped);assert.equal(cancelled.finalization.executionStatus,'cancelled');assert(cancelled.text.includes('SAFE_AUDIT_PARTIAL'));assert(cancelled.trace.length>0);
  await reload();saved=await workspace();const restoredCancel=saved.chats.find(row=>row.id===ids.failure).messages.at(-1);assert.deepEqual(restoredCancel.trace,cancelled.trace);assert.equal(restoredCancel.text,cancelled.text);
  await record('真实流式取消保留部分正文和terminal轨迹，Page.reload后记录一致',{requestCount:requests.length,traceCount:cancelled.trace.length});

  const shared=file(`${runId}-shared`,marker.shared),third=file(`${runId}-third`,'THIRD_LIBRARY_MARKER');
  const homeId=`${runId}-home`,homeKey=`new:${host.workspaceId}:home:${homeId}`;
  await seed(state=>({...state,documents:[...state.documents,shared,third],drafts:{...state.drafts,[homeKey]:{kind:'new',draftId:homeId,workspaceId:host.workspaceId,revision:1,text:`${runId}_HOME_DRAFT`,files:[file(`${runId}-first`,'FIRST'),file(`${runId}-second`,'SECOND')],updatedAt:Date.now()+1000}}}));
  await ui.click('资料空间');
  // Match the name on the actual row, then click its actual add action.
  async function addLibrary(name){const selector=await ui.evaluate(`(()=>{const row=[...document.querySelectorAll('.file-list .resource-row')].find(row=>row.querySelector('strong')?.textContent===${JSON.stringify(name)});if(!row)throw Error('Synthetic library row missing');row.dataset.auditTarget='yes';return '.file-list .resource-row[data-audit-target=yes] > .secondary-button';})()`);await clickSelector(selector);await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})`);}
  if(!await ui.evaluate('!!document.querySelector(".file-list")'))await ui.click('资料空间');
  await addLibrary(third.name);assert.equal(await value(),`${runId}_HOME_DRAFT`);assert.equal(await ui.evaluate('document.querySelectorAll(".composer .attachment-chip").length'),3);
  await ui.click('资料空间');await addLibrary(third.name);assert.equal(await ui.evaluate('document.querySelectorAll(".composer .attachment-chip").length'),3);
  await record('资料空间真实添加按钮追加第三份资料，原文/前两份附件保留且重复资料只出现一次');
  for(let index=0;index<9;index++)await attachFile(`${runId}-capacity-${index}.txt`,`CAPACITY_SYNTHETIC_${index}`);
  assert.equal(await ui.evaluate('document.querySelectorAll(".composer .attachment-chip").length'),12);
  await ui.click('资料空间');await addLibrary(shared.name);
  assert.equal(await ui.evaluate('document.querySelectorAll(".composer .attachment-chip").length'),12);
  assert(await ui.evaluate('document.querySelector(".toast")?.textContent.includes("1 个未加入")'));
  assert.equal(await value(),`${runId}_HOME_DRAFT`);
  await record('实际附件列表满12项时明确报告1个未加入，保留原文和全部已有附件');

  const recoverKey=`chat:${runId}-old-recover`,discardKey=`chat:${runId}-old-discard`;
  const recoverMarker=`${runId}_ORPHAN_RECOVER`,discardMarker=`${runId}_ORPHAN_DISCARD`;
  await seed(state=>({...state,drafts:{...state.drafts,
    [recoverKey]:{kind:'chat',draftId:`${runId}-old-recover`,chatId:`${runId}-old-recover`,workspaceId:host.workspaceId,revision:1,text:recoverMarker,files:[shared],updatedAt:Date.now()},
    [discardKey]:{kind:'chat',draftId:`${runId}-old-discard`,chatId:`${runId}-old-discard`,workspaceId:host.workspaceId,revision:1,text:discardMarker,files:[third],updatedAt:Date.now()},
  }}));
  assert(JSON.stringify(await workspace()).includes(discardMarker),'Historical orphan must not be silently cleaned at load');
  await ui.click('恢复或删除','.orphan-drafts button');await clickSelector(`.modal article[data-draft-key="${recoverKey}"] .secondary-button`);
  await ui.waitFor(`document.querySelector(${JSON.stringify(input)})?.value===${JSON.stringify(recoverMarker)}`);assert.equal(await ui.evaluate('document.querySelectorAll(".composer .attachment-chip").length'),1);
  await ui.click('恢复或删除','.orphan-drafts button');await clickSelector(`.modal article[data-draft-key="${discardKey}"] .text-button`);await clickSelector(`.modal article[data-draft-key="${discardKey}"] .text-button`);await ui.click('关闭对话框');await saveSettled();
  assert(!JSON.stringify(await workspace()).includes(discardMarker));assert(JSON.stringify(await workspace()).includes(recoverMarker));
  await record('历史孤儿重载不静默删除，实际恢复与明确二次删除动作均保存到主机');

  await seed(state=>{
    const draft=(id,projectId,text)=>({kind:'chat',draftId:id,chatId:id,workspaceId:host.workspaceId,projectId,revision:1,text,files:[file(`${id}-attachment`,id===ids.delete?marker.attachment:text)],updatedAt:Date.now()});
    return {...state,projects:[...state.projects,{id:ids.project,name:ids.project,workspaceId:host.workspaceId,expanded:true}],chats:[...state.chats,
      {id:ids.delete,title:ids.delete,workspaceId:host.workspaceId,projectId,providerId,providerUrl:endpoint,messages:[{role:'user',text:marker.deleted}]},
      {id:ids.archived,title:ids.archived,workspaceId:host.workspaceId,projectId,archived:true,messages:[{role:'user',text:marker.archived}]},
      {id:ids.moved,title:ids.moved,workspaceId:host.workspaceId,projectId,messages:[{role:'user',text:marker.keep,files:[{id:shared.id,name:shared.name}]}]},
      {id:ids.projectChat,title:ids.projectChat,workspaceId:host.workspaceId,projectId:ids.project,messages:[{role:'user',text:marker.project}]},
    ],drafts:{...state.drafts,[`chat:${ids.delete}`]:draft(ids.delete,projectId,marker.deleted),[`chat:${ids.archived}`]:draft(ids.archived,projectId,marker.archived),[`chat:${ids.moved}`]:draft(ids.moved,ids.project,marker.keep),[`chat:${ids.projectChat}`]:draft(ids.projectChat,ids.project,marker.project),[`new:${host.workspaceId}:${ids.project}:project-new`]:{kind:'new',draftId:'project-new',workspaceId:host.workspaceId,projectId:ids.project,revision:1,text:marker.project,files:[file('project-new-marker',marker.project)],updatedAt:1}}};
  });
  // Create a real native history/vault for the chat being deleted, then leave a parsed unsent attachment.
  await openChat(ids.delete);await dismissToast();await ui.fill(input,`QA_AUDIT_NORMAL ${marker.deleted}`);await ui.click('发送消息','.composer button');ownedRun=true;
  await ui.waitFor('!document.querySelector("button[aria-label=停止生成]")&&document.querySelector(".transcript .assistant-message:last-of-type")?.textContent.includes("SAFE_AUDIT_RESPONSE")',45000);ownedRun=false;await saveSettled();
  const realDeleteChat=(await workspace()).chats.find(chat=>chat.id===ids.delete);assert(realDeleteChat,'The native deletion fixture chat must still exist');assert(!realDeleteChat.messages.at(-1).error);
  const nativeReply=realDeleteChat.messages.at(-1);
  assert.equal(realDeleteChat.providerId,providerId);assert.equal(realDeleteChat.providerUrl,endpoint);
  assert.equal(nativeReply.role,'assistant','An untouched seed user is not evidence of a completed native run');
  assert.equal(typeof nativeReply.runId,'string');assert(nativeReply.runId.length>0,'The assistant must identify the actual native run');
  assert.equal(nativeReply.finalization?.runId,nativeReply.runId);assert.equal(nativeReply.finalization.executionStatus,'completed');
  const selectedSessions=await ui.evaluate(`([...new Set([...document.querySelectorAll('.chat-row.selected .chat-link[aria-current="page"]')].filter(node=>node.getClientRects().length).map(node=>node.closest('.chat-row').dataset.chatId))])`);
  assert.deepEqual(selectedSessions,[ids.delete],'The UI must still be on the bound native deletion session, not a provider-isolation fork');
  const nativeTerminal=await ui.evaluate(`window.__auditEvents.filter(event=>event.type==='run/terminal'&&event.runId===${JSON.stringify(nativeReply.runId)}).map(event=>({runId:event.runId,sessionId:event.sessionId,finalization:event.finalization})).at(-1)`);
  assert(nativeTerminal,'The native run must emit a real terminal event');assert.equal(nativeTerminal.sessionId,ids.delete);assert.equal(nativeTerminal.runId,nativeReply.runId);assert.equal(nativeTerminal.finalization?.executionStatus,'completed');
  await fs.writeFile(path.join(evidence,'native-delete-precondition.json'),JSON.stringify({chatId:ids.delete,providerId,providerUrl:endpoint,selectedSessions,reply:{role:nativeReply.role,runId:nativeReply.runId,finalization:nativeReply.finalization},terminal:nativeTerminal},null,2));
  await ui.fill(input,marker.deleted);await attachFile(`${runId}-delete-unsubmitted.txt`,marker.attachment);await saveSettled();
  const nativeBeforeDelete=await diskCheck();assert(nativeBeforeDelete.deletedNativeSessionPresent);assert(nativeBeforeDelete.deletedVaultPresent);
  await deleteChat(ids.delete);
  await ui.click('已归档聊天');
  const archivedSelector=await ui.evaluate(`(()=>{const row=[...document.querySelectorAll('.modal .record-list article')].find(row=>row.querySelector('span')?.textContent===${JSON.stringify(ids.archived)});if(!row)throw Error('Synthetic archived chat missing');row.dataset.auditTarget='yes';return '.modal .record-list article[data-audit-target=yes] .text-button';})()`);
  await clickSelector(archivedSelector);await ui.click('删除','.modal .danger-button');await ui.waitFor('!document.querySelector(".deletion-pending")',30000);await saveSettled();
  await ui.click(`${ids.project} 的项目菜单`);await ui.click('删除项目','[role=menuitem]');await ui.click('删除','.modal .danger-button');await ui.waitFor('!document.querySelector(".deletion-pending")',30000);await saveSettled();
  const beforeReload=await diskCheck();assert(beforeReload.deletedAbsent);assert(beforeReload.keptPresent);assert.equal(beforeReload.deletedNativeSessionPresent,false);assert.equal(beforeReload.deletedVaultPresent,false);
  await reload();const afterReload=await diskCheck();assert(afterReload.deletedAbsent);assert(afterReload.keptPresent);assert.equal(afterReload.deletedNativeSessionPresent,false);assert.equal(afterReload.deletedVaultPresent,false);
  const postReload=await workspace();assert(postReload.chats.some(row=>row.id===ids.moved));assert(postReload.drafts[`chat:${ids.moved}`]);assert(postReload.documents.some(row=>row.id===shared.id));
  await record('单聊/归档/项目删除级联草稿和附件，磁盘加密文件解密后marker消失，已移动聊天和共享资料保留；Page.reload通过',{beforeReload,afterReload});

  await saveSettled();const originalPid=host.pid;
  await ui.evaluate('window.zhixing.windowControl("close")').catch(()=>{});ui.close();main.close();ui=null;main=null;
  await until(()=>{try{process.kill(originalPid,0);return false;}catch(error){return error.code==='ESRCH';}},'original QA process exit',45000);
  logHandle=await fs.open(path.join(evidence,'restart-host.log'),'a');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_PATH;delete env.NODE_OPTIONS;
  restartedChild=spawn(host.exe,[`--user-data-dir=${host.profile}`,`--remote-debugging-port=${port}`,`--inspect=${mainPort}`],{cwd:path.dirname(host.exe),env,stdio:['ignore',logHandle.fd,logHandle.fd],windowsHide:true});restartedChild.unref();await logHandle.close();logHandle=null;
  await until(async()=>{ui=await connectUi(port);main=await connectUi(mainPort,true);await ready();return true;},'restarted packaged app',60000);
  const newPid=await main.evaluate('process.pid');assert.notEqual(newPid,originalPid);
  const afterRestart=await diskCheck();assert(afterRestart.deletedAbsent);assert(afterRestart.keptPresent);assert.equal(afterRestart.deletedNativeSessionPresent,false);assert.equal(afterRestart.deletedVaultPresent,false);
  const restarted=await workspace();assert(restarted.drafts[`chat:${ids.moved}`]);const archivedRun=restarted.chats.find(row=>row.id===ids.failure).messages.at(-1);assert(archivedRun.stopped&&archivedRun.trace.length>0);assert.equal(archivedRun.text,cancelled.text);
  await record('同一个Windows目录包实际进程退出/重启后删除仍生效，已移动草稿/共享资料/取消正文及轨迹保留',{originalPid,newPid,exe:host.exe,profile:host.profile,afterRestart});
  await fs.writeFile(path.join(evidence,'restart.json'),JSON.stringify({originalPid,newPid,exe:host.exe,profile:host.profile,port,mainPort},null,2));
  const current=await workspace();await ui.evaluate(`window.zhixing.saveWorkspace(${JSON.stringify({...current,settings:originalSettings})})`);await ui.evaluate(`window.zhixing.removeProvider(${JSON.stringify(providerId)})`);providerId=null;await reload();
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({...baseline,status:'passed',records,requestCount:requests.length,completedAt:new Date().toISOString()},null,2));
  }
} catch(error) {
  records.push({name:'journey',status:'failed',error:error.stack});await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({...baseline,status:'failed',records},null,2));await ui?.screenshot(path.join(evidence,'failure.png')).catch(()=>{});throw error;
} finally {
  if(ownedRun&&ui)await ui.click('停止生成').catch(()=>{});
  for(const response of held.splice(0))response.destroy();
  if(providerId&&ui&&!ownedRun)await ui.evaluate(`window.zhixing.removeProvider(${JSON.stringify(providerId)})`).catch(()=>{});
  ui?.close();main?.close();await logHandle?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(evidence,'outbound-requests.json'),JSON.stringify(requests,null,2));
}

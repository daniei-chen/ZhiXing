import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

const moduleUrl=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {containsCredential,containsCredentialValue}=await import(moduleUrl('src/privacy-recognizers.js'));
const {privacyPolicyForMode,PRIVACY_ENGINE_VERSION}=await import(moduleUrl('src/privacy-policy.js'));
const {assertModelCredential}=await import(moduleUrl('src/provider-options.js'));
const {PrivacySession}=await import(moduleUrl('src/privacy-core.js'));
const {AssistantTextStream}=await import(moduleUrl('electron/assistant-stream.mjs'));
const {startPrivacyGateway}=await import(moduleUrl('electron/privacy-gateway.mjs'));
const {RuntimeManager}=await import(moduleUrl('electron/runtime.mjs'));
const {createBridgeKey,writeBridge}=await import(moduleUrl('harness/privacy-bridge.mjs'));

test('凭证检测覆盖短值、Unicode 变体和 JSON 转义；可用模型密钥至少八字符',()=>{
 for(const key of ['x','Ab7!xyZ9','fixture9x','key-eleven1','a"b\\c123']) {
  assert(containsCredential(`before ${key} after`,key));
  const disguised=[...key].map((c,i)=>String.fromCharCode(c.charCodeAt(0)+0xfee0)+(i%2?'\u200b':'')).join('');
  assert(containsCredential(disguised,key));
  assert(containsCredentialValue({items:[{value:key}]},key));
  assert(containsCredentialValue({[key]:'ordinary'},key));
 }
 for(const key of ['',null,undefined,'\u200b'])assert(!containsCredential('ordinary',key));
 for(const key of ['1234567','has space','含中文字符1234','a'.repeat(1025)])assert.throws(()=>assertModelCredential(key),/8–1024/);
 for(const key of ['Ab7!xyZ9','a"b\\c123','a'.repeat(1024)])assert.doesNotThrow(()=>assertModelCredential(key));
});

test('非脱敏模式强制凭证拦截且不改写存储策略；旧引擎审阅版本失效',()=>{
 const saved={actions:{SECRET:'mask',PHONE:'allow'},neverMask:['password=synthetic']};
 const raw=privacyPolicyForMode(saved,'raw'),redact=privacyPolicyForMode(saved,'redact');
 assert.equal(raw.actions.SECRET,'block');assert.equal(redact.actions.SECRET,'mask');assert.equal(saved.actions.SECRET,'mask');
 assert.equal(raw.actions.PHONE,'allow');assert.notEqual(PRIVACY_ENGINE_VERSION,'0.12.0-local-v2');
 assert(new PrivacySession('raw').protect('password=synthetic',[],raw).blocked);
 assert(!new PrivacySession('redact').protect('password=synthetic',[],redact).blocked);
});

test('短凭证所有分块边界、Unicode 分块和本机还原均不能进入流式预览',()=>{
 const key='Ab7!xyZ9',variants=[key,[...key].join('\u200b'),[...key].map(c=>String.fromCharCode(c.charCodeAt(0)+0xfee0)).join('')];
 for(const value of variants)for(let split=0;split<=value.length;split++) {
  const stream=new AssistantTextStream({session:new PrivacySession('short-stream'),apiKey:key});stream.beginAttempt();
  const first=stream.appendText('普通正文。'.repeat(80)+value.slice(0,split));assert(!first.text.includes(key));
  const second=stream.appendText(value.slice(split));assert(second.blocked);assert(!second.text.includes(key));
 }
 const vault=new PrivacySession('restored-key'),masked=vault.protect('电话13800000000');
 const stream=new AssistantTextStream({session:vault,apiKey:'13800000000'});stream.beginAttempt();stream.appendText(masked.text);
 assert(stream.finishAttempt().blocked);
 const raw=new AssistantTextStream({session:new PrivacySession('raw-stream'),privacyMode:'raw',policy:{actions:{SECRET:'mask'}}});
 raw.beginAttempt();raw.appendText('password=synthetic');assert(raw.finishAttempt().blocked);
});

for(const protocol of ['openai','anthropic'])for(const privacyMode of ['redact','raw'])test(`${protocol}/${privacyMode} 实际网关：已知短密钥和通用凭证在收件前检查`,async()=>{
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'zhixing-credential-wire-')),requests=[];
 const key='a"b\\c123';let gateway;
 const server=http.createServer(async(req,res)=>{const parts=[];for await(const chunk of req)parts.push(chunk);requests.push(JSON.parse(Buffer.concat(parts)));res.writeHead(200,{'content-type':'application/json'}).end('{}');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const bridgeFile=path.join(root,'vault.bin'),bridgeKey=createBridgeKey();await writeBridge(bridgeFile,bridgeKey,new PrivacySession('credential-wire').exportState());
  gateway=await startPrivacyGateway({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol,apiKey:key,privacyMode,privacyPolicy:{actions:{SECRET:'mask'}},bridgeFile,bridgeKey});
  const send=async body=>{const response=await fetch(`${gateway.baseUrl}${protocol==='openai'?'/chat/completions':'/v1/messages'}`,{method:'POST',headers:{'content-type':'application/json',...(protocol==='openai'?{authorization:`Bearer ${gateway.apiKey}`}:{'x-api-key':gateway.apiKey})},body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'普通内容'}],...body})});return {status:response.status,text:await response.text()};};
  for(const body of [
   {messages:[{role:'user',content:key}]},
   {messages:[{role:'user',content:[...key].join('\u200b')}]},
   {metadata:{[key]:'ordinary'}},
   {tools:[protocol==='openai'?{type:'function',function:{name:'safe',parameters:{type:'object',description:key}}}:{name:'safe',input_schema:{type:'object',description:key}}]},
  ]){const result=await send(body);assert.equal(result.status,400);assert(!result.text.includes(key));assert.equal(requests.length,0);}
  assert.equal((await send({messages:[{role:'user',content:'联系人：张三，电话13800000000'}]})).status,200);
  assert.equal(JSON.stringify(requests[0]).includes('13800000000'),privacyMode==='raw');
  const before=requests.length,result=await send({messages:[{role:'user',content:'password=synthetic-secret'}]});
  assert.equal(result.status,privacyMode==='raw'?400:200);assert.equal(requests.length,before+(privacyMode==='raw'?0:1));
  assert(!JSON.stringify(requests).includes('synthetic-secret'));
  if(protocol==='anthropic'){
   const count=requests.length;
   const signed=await send({messages:[{role:'assistant',content:[{type:'thinking',thinking:'password=synthetic-signed',signature:'synthetic-signature'}]}]});
   assert.equal(signed.status,400);assert.equal(requests.length,count);
  }
 } finally {
  await gateway?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const target=await fs.realpath(root);assert.equal(path.dirname(target),parent);assert(path.basename(target).startsWith('zhixing-credential-wire-'));await fs.rm(target,{recursive:true,force:true,maxRetries:6,retryDelay:100});
 }
});

test('真实预览保留发送前的凭证检查依据，脱敏不能把已知密钥隐藏成可发送占位符',async()=>{
 const manager=new RuntimeManager({root:os.tmpdir(),readVault:async()=>null,writeVault:async()=>{throw new Error('Must not persist');},createGateway:async()=>{throw new Error('Must not open gateway');}});
 const config={baseUrl:'https://fixture.invalid',privacyPolicy:{actions:{SECRET:'mask'}}},key='13800000000';
 try {
  const preview=await manager.preview({sessionId:'masked-credential',prompt:`电话${key}`,privacyMode:'redact'},config);
  assert(preview.preparationId);assert(!preview.text.includes(key));assert(!JSON.stringify(preview).includes('credentialSource'));
  await assert.rejects(manager.runPrepared({runId:'credential-rejected',preparationId:preview.preparationId},config,key),/疑似凭证/);
  const raw=await manager.preview({sessionId:'raw-rejected',prompt:'password=synthetic-secret',privacyMode:'raw'},config);
  assert(raw.blocked);assert.equal(raw.preparationId,null);
  await assert.rejects(manager.run({runId:'short',sessionId:'short',prompt:'ordinary'},config,'short'),/8–1024/);
 } finally {await manager.close();}
});

test('交互提问的正文、说明与选项在还原后再次检查当前 Key',async()=>{
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'zhixing-credential-question-')),events=[];
 const vault=new PrivacySession('question'),key='13800000000',token=vault.protect(`电话${key}`).entities[0].token;
 const bridgeFile=path.join(root,'vault.bin'),bridgeKey=createBridgeKey();await writeBridge(bridgeFile,bridgeKey,vault.exportState());
 const manager=new RuntimeManager({root,readVault:async()=>null,writeVault:async()=>{},onEvent:event=>events.push(event)});
 try {
  const answer=manager.askQuestion({requestId:'q1',sessionId:'question',questions:[{id:'q',question:`核对 ${token}`,detail:key,options:[{label:key,description:token}]}]},new AbortController().signal,{runId:'question',bridgeFile,bridgeKey,providerKey:key});
  const deadline=Date.now()+3000;while(!events.some(event=>event.type==='question')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  const question=events.find(event=>event.type==='question');assert(question);assert(!JSON.stringify(question).includes(key));
  assert(question.questions[0].question.includes('检测到凭证'));assert(question.questions[0].options[0].label.includes('检测到凭证'));
  manager.answerQuestion({requestId:'q1',cancelled:true});assert((await answer).cancelled);
 } finally {await manager.close();const target=await fs.realpath(root);assert.equal(path.dirname(target),parent);assert(path.basename(target).startsWith('zhixing-credential-question-'));await fs.rm(target,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
});

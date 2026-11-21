import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
const url=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {startPrivacyGateway}=await import(url('electron/privacy-gateway.mjs'));
const {PrivacySession}=await import(url('src/privacy-core.js'));
const {createBridgeKey,writeBridge}=await import(url('harness/privacy-bridge.mjs'));

for(const protocol of ['openai','anthropic'])test(`${protocol} 实际 HTTP 边界：Unicode 脱敏及伪造占位符凭证在外发前阻断`,async()=>{
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'zhixing-privacy-wire-')),requests=[];
 const upstream=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);requests.push(JSON.parse(Buffer.concat(chunks)));res.writeHead(200,{'content-type':'application/json'}).end('{}');});
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 let gateway;
 try{
  const bridgeFile=path.join(root,'vault.bin'),bridgeKey=createBridgeKey();
  await writeBridge(bridgeFile,bridgeKey,new PrivacySession('wire').exportState());
  gateway=await startPrivacyGateway({baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,protocol,apiKey:'synthetic-provider-key',bridgeFile,bridgeKey,privacyMode:'redact'});
  const send=content=>fetch(`${gateway.baseUrl}${protocol==='openai'?'/chat/completions':'/v1/messages'}`,{method:'POST',headers:{'content-type':'application/json',...(protocol==='openai'?{authorization:`Bearer ${gateway.apiKey}`}:{'x-api-key':gateway.apiKey})},body:JSON.stringify({model:'synthetic',max_tokens:40,messages:[{role:'user',content}]})});
  const response=await send('联系人：张三，电话：１３８００００００００；手机：139\u200b0000\u20600000');assert.equal(response.status,200);await response.text();assert.equal(requests.length,1);
  const wire=JSON.stringify(requests[0]);for(const value of ['张三','１３８','13800000000','13900000000','\u200b','\u2060'])assert(!wire.includes(value),value);assert(wire.includes('ZX-'));
  for(const secret of ['⟦ZX-password=synthetic-secret-123⟧','ｐａｓｓｗｏｒｄ＝123456','pass\u200bword=123456']){const result=await send(secret);assert.equal(result.status,400);await result.text();assert.equal(requests.length,1);}
 }finally{
  await gateway?.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));
  const resolved=await fs.realpath(root);assert.equal(path.dirname(resolved),parent);assert(path.basename(resolved).startsWith('zhixing-privacy-wire-'));await fs.rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:100});
 }
},{timeout:15000});

test('网关隔离父子流式预览、同步新映射，并区分隐私阻断、上游状态与连接故障',async()=>{
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'zhixing-privacy-wire-')),frames=[],received=[];
 let mode='stream',gateway;
 const upstream=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));received.push({body,headers:req.headers});
  if(mode==='disconnect'){req.socket.destroy();return;}
  if(mode==='rate'){res.writeHead(429,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'rate_limit_error'}}));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end(`data: ${JSON.stringify({choices:[{delta:{content:'ONLY_ATTRIBUTED_TEXT'},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 try{
  const bridgeFile=path.join(root,'vault.bin'),bridgeKey=createBridgeKey();await writeBridge(bridgeFile,bridgeKey,new PrivacySession('main').exportState());
  gateway=await startPrivacyGateway({baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,protocol:'openai',apiKey:'synthetic-provider-key',bridgeFile,bridgeKey,mainSessionId:'main',onAssistantText:frame=>frames.push(frame)});
  const send=async(session,content='普通正文',header='x-zhixing-session-id')=>{const res=await fetch(`${gateway.baseUrl}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${gateway.apiKey}`,...(session?{[header]:session}:{})},body:JSON.stringify({model:'synthetic',messages:[{role:'user',content}]})});return {status:res.status,text:await res.text()};};
  await Promise.all([send('child'),send(undefined)]);assert.equal(frames.length,0);
  assert.equal((await send('main','电话13800000000')).status,200);assert(frames.some(frame=>frame.type==='delta'));assert(frames[0].vaultState.entries.some(entry=>entry.value==='13800000000'));assert(!JSON.stringify(received.at(-1).body).includes('13800000000'));assert(!received.at(-1).headers['x-zhixing-session-id']);
  frames.length=0;await send('main','普通正文','x-deepseek-harness-session-id');assert(frames.some(frame=>frame.type==='delta'));
  mode='rate';assert.equal((await send('main')).status,429);
  mode='disconnect';const failure=await send('main');assert.equal(failure.status,502);assert.equal(JSON.parse(failure.text).error.code,'UPSTREAM_UNAVAILABLE');
  const count=received.length,blocked=await send('main','password=synthetic-secret');assert.equal(blocked.status,400);assert.equal(JSON.parse(blocked.text).error.code,'PRIVACY_BOUNDARY_REJECTED');assert.equal(received.length,count);assert(!blocked.text.includes('synthetic-secret'));
 }finally{
  await gateway?.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));
  const resolved=await fs.realpath(root);assert.equal(path.dirname(resolved),parent);assert(path.basename(resolved).startsWith('zhixing-privacy-wire-'));await fs.rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:100});
 }
},{timeout:20000});

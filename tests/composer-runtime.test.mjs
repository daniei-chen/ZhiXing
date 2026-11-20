import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {availableModels,REASONING_LEVELS} from '../src/model-options.js';
import {composePrompt} from '../src/office-workflows.js';
import {PrivacySession} from '../src/privacy-core.js';
const packed=process.env.ZHIXING_TEST_PACKED_APP;
const {builtinModels,decodeModels,fetchModels}=await import(packed?pathToFileURL(path.join(packed,'electron/model-catalog.mjs')).href:'../electron/model-catalog.mjs');
const {SpeechService,decodeSpeechRecording}=await import(packed?pathToFileURL(path.join(packed,'electron/speech-service.mjs')).href:'../electron/speech-service.mjs');
const {RuntimeManager}=await import(packed?pathToFileURL(path.join(packed,'electron/runtime.mjs')).href:'../electron/runtime.mjs');

test('模型目录使用真实内核 ID；配置模型保留；思考强度只提供内核档位',()=>{
 const rows=builtinModels();assert(rows.some(row=>row.id==='deepseek-flash'));assert(rows.some(row=>row.id==='deepseek-v4-pro'));
 assert(availableModels(rows,'custom/model').some(row=>row.id==='custom/model'));
 assert.deepEqual(REASONING_LEVELS.map(level=>level.id),['off','low','high','max']);
 assert.deepEqual(decodeModels({data:[{id:'configured-1',name:'测试模型'},{id:'configured-1'},{id:'invalid\nvalue'}]}).map(row=>row.id),['configured-1']);
 assert.throws(()=>decodeModels({data:[]}));
});

test('刷新目录只请求配置服务；拒绝重定向；不把凭据转发到其他地址',async()=>{
 let targetHits=0;
 const target=http.createServer((req,res)=>{targetHits++;res.end('{}');});target.listen(0,'127.0.0.1');await once(target,'listening');
 const requests=[];
 const server=http.createServer((req,res)=>{requests.push({url:req.url,auth:req.headers.authorization});if(req.url==='/redirect/models'){res.writeHead(302,{location:`http://127.0.0.1:${target.address().port}/models`}).end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'fixture-model'}]}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');const baseUrl=`http://127.0.0.1:${server.address().port}`;
 try { assert.equal((await fetchModels({baseUrl:`${baseUrl}/v1`},'fixture-only-key'))[0].id,'fixture-model');assert.deepEqual(requests[0],{url:'/v1/models',auth:'Bearer fixture-only-key'});await assert.rejects(fetchModels({baseUrl:`${baseUrl}/redirect`},'fixture-only-key'));assert.equal(targetHits,0); }
 finally { server.closeAllConnections();target.closeAllConnections();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>target.close(resolve))]); }
});

test('个人偏好进入正常脱敏链；本机语音校验会话、语言和音频',async()=>{
 const prompt=composePrompt('整理会议纪要',[],[],'','联系人：张三，电话13800000000');
 const protectedInput=new PrivacySession('preference-fixture').protect(prompt);
 assert(prompt.includes('【用户办公偏好】'));assert(!protectedInput.text.includes('13800000000'));assert(!protectedInput.text.includes('张三'));
 const speech=new SpeechService(()=>{},{dataRoot:path.join(os.tmpdir(),'zhixing-speech-guard-test')});
 await assert.rejects(speech.start('invalid','8f9bb3b6-7a67-4d5c-97d7-a940f4cda48f'),/不支持/);
 await assert.rejects(speech.start('zh-CN','stale'),/听写编号/);
 await assert.rejects(speech.stop('stale'),/已结束/);
 assert.equal(await speech.cancel('stale'),true);
 assert.throws(()=>decodeSpeechRecording('not-base64'),/录音格式无效/);
 await speech.close();
});

test('同一聊天切换模型和四档思考强度，规划草稿随附件自动脱敏',{timeout:90000},async()=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'zhixing-effort-test-')),bodies=[],vaults=new Map();
 const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  bodies.push(body);
  res.writeHead(200, {'content-type': 'text/event-stream'});
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({type, ...data})}\n\n`);
  send('message_start', {message: {id: 'fixture-response', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: {input_tokens: 3, output_tokens: 0}}});
  send('content_block_start', {index: 0, content_block: {type: 'text', text: ''}});
  send('content_block_delta', {index: 0, delta: {type: 'text_delta', text: '已完成合成测试。'}});
  send('content_block_stop', {index: 0});
  send('message_delta', {delta: {stop_reason: 'end_turn', stop_sequence: null}, usage: {output_tokens: 3}});
  send('message_stop', {});
  res.end();
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const manager=new RuntimeManager({root,readVault:async id=>vaults.get(id),writeVault:async(id,value)=>vaults.set(id,value)});
 try {
  for (const level of REASONING_LEVELS) {
   const config = {
    baseUrl: `http://127.0.0.1:${server.address().port}/anthropic`,
    model: level.id === 'max' ? 'fixture-second-model' : 'fixture-model',
    reasoning: level.id,
   };
   const planning = level.id === 'max';
   const before = bodies.length;
   const prompt = planning
    ? composePrompt('合成规划草稿', [{name: '合成材料.txt', text: '联系人：张三，电话13800000000'}])
    : '仅回复合成测试结果。';
   const preview = await manager.preview({sessionId: 'effort-chat', prompt, startInPlanMode: planning}, config);
   const result = await manager.runPrepared({runId: `run-${level.id}`, preparationId: preview.preparationId}, config, 'fixture-loopback-key');
   assert.equal(result.finishReason, 'completed');
   const [body] = bodies.slice(before);
   assert.equal(bodies.length - before, 1);
   assert.equal(body.model, config.model);
   assert.equal(body.thinking.type, level.id === 'off' ? 'disabled' : 'enabled');
   assert.equal(body.output_config?.effort, level.id === 'off' ? undefined : level.id);
   if (planning) {
    assert(result.context.planning);
    const input = JSON.stringify(body.messages);
    assert.match(input, /合成规划草稿/);
    assert.match(input, /合成材料\.txt/);
    assert.doesNotMatch(input, /张三|13800000000/);
    assert(!body.tools.some(tool => tool.name === 'office_execute'));
   }
  }
 }
 finally { await manager.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const resolved=await realpath(root);if(path.dirname(resolved)===parent&&path.basename(resolved).startsWith('zhixing-effort-test-'))await rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:150}); }
});

test('Windows SenseVoice Provider can inspect local model state without recording or downloading',{skip:process.platform!=='win32'},async()=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'zhixing-sensevoice-test-'));
 const speech=new SpeechService(()=>{},{dataRoot:path.join(root,'models')});
 try {
  const status=await speech.status();
  assert.equal(status.supported,true);
  assert.equal(status.providerId,'sensevoice-local');
  assert.match(status.providerName,/SenseVoice/);
  assert(status.languages.includes('zh'));
  assert(status.preparation.phase==='unprepared'||status.preparation.phase==='checking'||status.preparation.phase==='ready'||status.preparation.phase==='standby');
  await assert.rejects(speech.start('zh-CN','8f9bb3b6-7a67-4d5c-97d7-a940f4cda48f'),/先下载并准备/);
 } finally {
  await speech.close();
  const resolved=await realpath(root);if(path.dirname(resolved)===parent&&path.basename(resolved).startsWith('zhixing-sensevoice-test-'))await rm(resolved,{recursive:true,force:true});
 }
});

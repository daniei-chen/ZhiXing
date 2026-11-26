import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packed=process.env.ZHIXING_TEST_PACKED_APP;
const { selectedModel } = await import(packed ? pathToFileURL(path.join(packed, 'src/provider-options.js')).href : '../src/provider-options.js');
const load=name=>import(packed?pathToFileURL(path.join(packed,'electron',name)).href:`../electron/${name}`);
const { modelReasoning, ProviderSelectionError, publicProviders, resolveProvider, saveProvider } = await load('providers.mjs');
const { RuntimeManager } = await load('runtime.mjs');

test('模型目录不回传明文或 Unicode 凭证，旧短密钥必须重配且不发起请求',async()=>{
 const {fetchModels}=await load('model-catalog.mjs');const key='Ab7!xyZ9';let requests=0;
 const server=http.createServer((req,res)=>{requests++;res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'safe-model'},{id:'leaked-model',description:key},{id:'disguised-model',description:[...key].join('\u200b')}]}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const config={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'openai'};
  await assert.rejects(fetchModels(config,'short'),/8–1024/);assert.equal(requests,0);
  assert.deepEqual((await fetchModels(config,key)).map(row=>row.id),['safe-model']);assert.equal(requests,1);
  await assert.rejects(saveProvider({...config,name:'短密钥',apiKey:'short',manualModels:'safe-model'},[]),/8–1024/);
  const [legacy]=publicProviders([{id:'old',key:'short',models:[]}]);assert(legacy.credentialReentryRequired);assert(!JSON.stringify(legacy).includes('short'));
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('同名模型按供应商和凭据区分，换地址不能沿用原密钥',async()=>{
  const a=await saveProvider({name:'公司甲',apiKey:'fixture-a-key',baseUrl:'https://a.example/v1',protocol:'openai',reasoningStyle:'standard',manualModels:'same-model'},[]);
  const b=await saveProvider({name:'公司乙',apiKey:'fixture-b-key',baseUrl:'https://b.example/v1',protocol:'openai',reasoningStyle:'standard',manualModels:'same-model'},[a]);
  const selected=resolveProvider([a,b],{providerId:b.id,modelId:'same-model',reasoning:'max'});
  assert.equal(selected.providerId,b.id);
  assert.equal(selected.baseUrl,b.baseUrl);
  assert.equal(selected.requestedReasoning,'max');
  assert.equal(selected.effectiveReasoning,'max');
  assert.equal(selected.wireReasoning,'xhigh');
  assert(!JSON.stringify(publicProviders([a,b])).includes('fixture-'));
  await assert.rejects(saveProvider({...a,baseUrl:'https://changed.example/v1',manualModels:'same-model'},[a]),/API Key/);
  assert.deepEqual(modelReasoning({preset:'kimi',protocol:'openai'},'kimi-k2.5').levels,['off','high']);
});

test('显式失效供应商与型号、未知能力和不支持档位均阻止解析',async()=>{
  assert.equal(typeof resolveProvider,'function');
  assert.equal(typeof ProviderSelectionError,'function');
  assert.equal(typeof modelReasoning,'function');
  assert.equal(typeof publicProviders,'function');
  const { providerModels } = await load('providers.mjs');
  assert.equal(typeof providerModels,'function');
  const provider=await saveProvider({name:'严格选择',apiKey:'fixture-strict-key',baseUrl:'https://strict.example/v1',protocol:'openai',reasoningStyle:'deepseek',manualModels:'known-model'},[]);
  assert.throws(()=>resolveProvider([provider],{providerId:'removed-provider',modelId:'known-model',reasoning:'high'}),error=>Boolean(error instanceof ProviderSelectionError&&error.code==='PROVIDER_UNAVAILABLE'&&error.reason));
  assert.throws(()=>resolveProvider([provider],{providerId:provider.id,modelId:'removed-model',reasoning:'high'}),error=>error.code==='MODEL_UNAVAILABLE'&&error.requested.modelId==='removed-model');
  const unknown={...provider,id:'unknown',reasoningStyle:'unrecognised-style',models:[{id:'unclassified-model'}]};
  assert.equal(modelReasoning(unknown,'unclassified-model').capability,'unknown');
  assert.throws(()=>resolveProvider([unknown],{providerId:'unknown',modelId:'unclassified-model',reasoning:'off'}),error=>error.code==='REASONING_CAPABILITY_UNKNOWN');
  const limited={...provider,preset:'zhipu',models:[{id:'glm-4.5'}]};
  assert.throws(()=>resolveProvider([limited],{providerId:provider.id,modelId:'glm-4.5',reasoning:'low'}),error=>error.code==='REASONING_EFFORT_UNAVAILABLE');
  assert.throws(()=>resolveProvider([provider],{}),error=>error.code==='PROVIDER_UNAVAILABLE');
});

test('界面模型查找不跨供应商或静默改选',()=>{
  const runtime={models:[
    {id:'same',providerId:'provider-a',providerName:'甲'},
    {id:'same',providerId:'provider-b',providerName:'乙'},
    {id:'other',providerId:'provider-a'},
  ]};
  assert.equal(selectedModel(runtime,{modelProviderId:'provider-b',model:'same'}),runtime.models[1]);
  assert.equal(selectedModel(runtime,{modelProviderId:'removed',model:'same'}),undefined);
  assert.equal(selectedModel(runtime,{modelProviderId:'provider-a',model:'removed'}),undefined);
  assert.equal(selectedModel(runtime,{modelProviderId:null,model:'same'}),undefined);
  assert.equal(selectedModel(runtime,{modelProviderId:null,model:'other'}),runtime.models[2]);
});

test('非推理模型、硅基流动与明确不覆盖推理的自定义路由可正常发送',()=>{
 for(const provider of [{preset:'openai',protocol:'openai',model:'gpt-4o'},{preset:'anthropic',protocol:'anthropic',model:'claude-3-5-sonnet-latest'},{preset:'siliconflow',protocol:'openai',model:'Qwen/Qwen2.5-7B-Instruct'},{preset:null,reasoningStyle:'none',protocol:'openai',model:'local-text-model'}]){
  const row={...provider,id:'default-route',baseUrl:'https://fixture.example/v1',models:[{id:provider.model}]};
  const config=resolveProvider([row],{providerId:row.id,modelId:provider.model,reasoning:'off'});
  assert.equal(config.reasoningMap,false);assert.equal(config.wireReasoning,undefined);
  assert.throws(()=>resolveProvider([row],{providerId:row.id,modelId:provider.model,reasoning:'high'}),error=>error.code==='REASONING_EFFORT_UNAVAILABLE');
 }
});

test('视觉模态只继承实际供应商声明或官方 DeepSeek 目录',async()=>{
 const {decodeModels}=await load('model-catalog.mjs');
 const [discovered]=decodeModels({data:[{id:'vision-fixture',architecture:{input_modalities:['text','image','audio']}}]});
 assert.deepEqual(discovered.inputModalities,['text','image']);
 const provider={id:'deepseek',protocol:'deepseek',baseUrl:'https://api.deepseek.com/anthropic',models:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]};
 const select=(row,modelId)=>resolveProvider([row],{providerId:row.id,modelId,reasoning:'high'}).inputModalities;
 assert.deepEqual(select(provider,'deepseek-flash'),['text','image']);
 assert.deepEqual(select(provider,'deepseek-v4-pro'),['text']);
 assert.deepEqual(select({...provider,baseUrl:'https://example.invalid/anthropic'},'deepseek-flash'),['text']);
 assert.deepEqual(select({...provider,models:[{id:'deepseek-flash',inputModalities:['text']}]},'deepseek-flash'),['text']);
});

test('真实 Harness 对接自定义 Chat Completions / Messages，收件端核对模型、档位、脱敏与恢复',{timeout:130000},async()=>{
  const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'zhixing-provider-test-'));
  const requests=[],vaults=new Map(),events=[];
  const server=http.createServer(async(req,res)=>{
    if(req.method==='GET'){
      requests.push({url:req.url,auth:req.headers.authorization||req.headers['x-api-key']});
      res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({data:[{id:'fixture-default'},{id:'fixture-selected'}]}));
    }
    const chunks=[];
    for await(const part of req)chunks.push(part);
    const body=JSON.parse(Buffer.concat(chunks));
    requests.push({url:req.url,auth:req.headers.authorization||req.headers['x-api-key'],body});
    const token=JSON.stringify(body.messages).match(/⟦ZX-[^⟧]+⟧/)?.[0];
    const output=`已核验 ${token || '没有占位符'}`;
    res.writeHead(200,{'content-type':'text/event-stream'});
    if(req.url==='/chat/v1/chat/completions'){
      const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'fixture-response',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})}\n\n`);
      send({role:'assistant',content:output});send({},'stop');res.end('data: [DONE]\n\n');
    }else{
      const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
      send('message_start',{message:{id:'fixture-response',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:3,output_tokens:0}}});
      send('content_block_start',{index:0,content_block:{type:'text',text:''}});
      send('content_block_delta',{index:0,delta:{type:'text_delta',text:output}});
      send('content_block_stop',{index:0});
      send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}});
      send('message_stop',{});res.end();
    }
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const manager=new RuntimeManager({root,readVault:async id=>vaults.get(id),writeVault:async(id,value)=>vaults.set(id,value),onEvent:event=>events.push(event)});
  try{
    const chat=await saveProvider({name:'合成 Chat API',apiKey:'fixture-chat-key',baseUrl:`${base}/chat/v1`,protocol:'openai',reasoningStyle:'standard',discover:true},[]);
    const messages=await saveProvider({name:'合成 Messages API',apiKey:'fixture-messages-key',baseUrl:`${base}/messages`,protocol:'anthropic',reasoningStyle:'standard',discover:true},[chat]);
    const plain={...chat,id:'fixture-nonreasoning',reasoningStyle:'none'};
    assert.deepEqual(requests.splice(0),[{url:'/chat/v1/models',auth:'Bearer fixture-chat-key'},{url:'/messages/v1/models?limit=100',auth:'fixture-messages-key'}]);
    const configs=[
      [chat,'max','/chat/v1/chat/completions'],
      [chat,'off','/chat/v1/chat/completions'],
      [messages,'high','/messages/v1/messages'],
      [plain,'off','/chat/v1/chat/completions'],
    ];
    for(const [provider,reasoning,url] of configs){
      const config=resolveProvider([chat,messages,plain],{modelProviderId:provider.id,model:'fixture-selected',reasoning});
      const sessionId=provider===plain?'plain':provider.protocol;
      const preview=await manager.preview({sessionId,prompt:'联系电话：13800000000'},config);
      const result=await manager.runPrepared({runId:`${sessionId}-${reasoning}`,preparationId:preview.preparationId},prepared=>({config:prepared,key:provider.key}));
      assert.equal(result.finishReason,'completed');
      const request=requests.shift();
      assert.equal(request.url,url);
      assert.equal(request.auth,provider.protocol==='openai'?`Bearer ${provider.key}`:provider.key);
      const {body}=request;
      assert.equal(body.model,'fixture-selected');
      if(provider===plain){assert(!Object.hasOwn(body,'reasoning_effort'));assert(!Object.hasOwn(body,'thinking'));}
      else if(provider.protocol==='openai')assert.equal(body.reasoning_effort,reasoning==='max'?'xhigh':'none');
      else assert.equal(body.thinking.type,'enabled');
      assert.doesNotMatch(JSON.stringify(body.messages),/13800000000/);
      assert.match(result.text,/13800000000/);
      assert(events.some(event=>event.runId===`${sessionId}-${reasoning}`&&event.source==='assistant-stream'&&event.text.includes('13800000000')),'Attributed provider stream must reach the main conversation');
    }
    const original=resolveProvider([chat],{providerId:chat.id,modelId:'fixture-selected',reasoning:'low'});
    const {preparationId}=await manager.preview({sessionId:'stale',prompt:'不要发出这次请求'},original);
    await assert.rejects(manager.runPrepared({runId:'stale',preparationId},{...original,credentialRevision:'new-key-version'},chat.key),/连接已更新/);
    await assert.rejects(manager.preview({sessionId:'openai',prompt:'不要向其他服务重放聊天'},resolveProvider([messages],{providerId:messages.id,modelId:'fixture-selected',reasoning:'low'})),/另一个模型服务/);
    assert.equal(requests.length,0);
  }finally{
    await manager.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const resolved=await realpath(root);
    if(path.dirname(resolved)===parent&&path.basename(resolved).startsWith('zhixing-provider-test-'))await rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
});

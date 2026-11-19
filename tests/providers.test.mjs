import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packed=process.env.ZHIXING_TEST_PACKED_APP;
const load=name=>import(packed?pathToFileURL(path.join(packed,'electron',name)).href:`../electron/${name}`);
const { modelReasoning, publicProviders, resolveProvider, saveProvider } = await load('providers.mjs');
const { RuntimeManager } = await load('runtime.mjs');

test('同名模型按供应商和凭据区分，换地址不能沿用原密钥',async()=>{
  const a=await saveProvider({name:'公司甲',apiKey:'fixture-a-key',baseUrl:'https://a.example/v1',protocol:'openai',manualModels:'same-model'},[]);
  const b=await saveProvider({name:'公司乙',apiKey:'fixture-b-key',baseUrl:'https://b.example/v1',protocol:'openai',manualModels:'same-model'},[a]);
  assert.equal(resolveProvider([a,b],{modelProviderId:b.id,model:'same-model',reasoning:'max'}).baseUrl,b.baseUrl);
  assert.equal(resolveProvider([a,b],{modelProviderId:b.id,model:'same-model',reasoning:'max'}).reasoning,'off');
  assert(!JSON.stringify(publicProviders([a,b])).includes('fixture-'));
  await assert.rejects(saveProvider({...a,baseUrl:'https://changed.example/v1',manualModels:'same-model'},[a]),/API Key/);
  assert.deepEqual(modelReasoning({preset:'kimi',protocol:'openai'},'kimi-k2.5').levels,['off','high']);
});

test('真实 Harness 对接自定义 Chat Completions / Messages，收件端核对模型、档位、脱敏与恢复',{timeout:130000},async()=>{
  const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'zhixing-provider-test-'));
  const requests=[],vaults=new Map();
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
  const manager=new RuntimeManager({root,readVault:async id=>vaults.get(id),writeVault:async(id,value)=>vaults.set(id,value)});
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
      if(provider.protocol==='openai')assert.equal(body.reasoning_effort,provider===plain?undefined:reasoning==='max'?'xhigh':'none');
      else assert.equal(body.thinking.type,'enabled');
      assert.doesNotMatch(JSON.stringify(body.messages),/13800000000/);
      assert.match(result.text,/13800000000/);
    }
    const original=resolveProvider([chat],{modelProviderId:chat.id,model:'fixture-selected',reasoning:'low'});
    const {preparationId}=await manager.preview({sessionId:'stale',prompt:'不要发出这次请求'},original);
    await assert.rejects(manager.runPrepared({runId:'stale',preparationId},{...original,credentialRevision:'new-key-version'},chat.key),/连接已更新/);
    await assert.rejects(manager.preview({sessionId:'openai',prompt:'不要向其他服务重放聊天'},resolveProvider([messages])),/另一个模型服务/);
    assert.equal(requests.length,0);
  }finally{
    await manager.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const resolved=await realpath(root);
    if(path.dirname(resolved)===parent&&path.basename(resolved).startsWith('zhixing-provider-test-'))await rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
});

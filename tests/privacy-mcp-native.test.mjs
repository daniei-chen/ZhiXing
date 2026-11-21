import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

const url=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {RuntimeManager}=await import(url('electron/runtime.mjs'));
const {validateMcpServers}=await import(url('electron/mcp-config.mjs'));
const {KERNEL_DEFAULTS}=await import(url('src/kernel-config.js'));
const unsafe=['13800000000','audit.person@example.test','zxcorp_ABCDEF1234567890'];
const toolName='mcp__audit__dictionary';
const schema={type:'object',properties:{records:{type:'object',additionalProperties:{type:'string'}}},required:['records'],additionalProperties:false};

function stream(response,content) {
 response.writeHead(200,{'content-type':'text/event-stream'});
 const emit=(type,fields)=>response.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
 emit('message_start',{message:{id:'audit_fixture',type:'message',role:'assistant',model:'audit-fixture',content:[],stop_reason:null,usage:{input_tokens:50,output_tokens:20}}});
 content.forEach((block,index)=>{emit('content_block_start',{index,content_block:block.type==='text'?{type:'text',text:''}:{...block,input:{}}});emit('content_block_delta',{index,delta:block.type==='text'?{type:'text_delta',text:block.text}:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});emit('content_block_stop',{index});});
 emit('message_delta',{delta:{stop_reason:content.some(block=>block.type==='tool_use')?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});emit('message_stop',{});response.end();
}

test('R01 原生 Harness → 官方 MCP client → loopback：三种敏感动态键 tools/call 为零，普通调用恰好一次', {timeout:60000},async()=>{
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'zhixing-mcp-dynamic-native-')),mcp=[],models=[],vaults=new Map(),events=[];
 let phase='unsafe',manager;
 const server=http.createServer(async(request,response)=>{
  try {
   if(request.method!=='POST'){response.writeHead(405).end();return;}
   const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
   if(request.url==='/mcp'){
    mcp.push(body);
    if(body.id===undefined){response.writeHead(202).end();return;}
    let result;
    switch(body.method){
     case 'initialize':result={protocolVersion:body.params?.protocolVersion||'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'zhixing-audit-dynamic',version:'0.12.1'}};break;
     case 'ping':result={};break;
     case 'tools/list':result={tools:[{name:'dictionary',description:'本机合成动态字典验收',inputSchema:schema}]};break;
     case 'tools/call':result={content:[{type:'text',text:'MCP_ORDINARY_OK'}]};break;
     case 'resources/list':result={resources:[]};break;
     case 'resources/templates/list':result={resourceTemplates:[]};break;
     default:response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}}));return;
    }
    response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));return;
   }
   models.push({phase,body});
   const results=body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(block=>block.type==='tool_result');
   assert(body.tools.some(tool=>tool.name===toolName),'The official MCP tool must be in the actual model request');
   if(results.length){stream(response,[{type:'text',text:'MCP_ORDINARY_COMPLETED'}]);return;}
   const keys=phase==='unsafe'?unsafe:['ordinary_key'];
   stream(response,keys.map((key,index)=>({type:'tool_use',name:toolName,id:`audit_call_${index}`,input:{records:{[key]:'ordinary'}}})));
  }catch(error){if(!response.headersSent)response.writeHead(422,{'content-type':'application/json'}).end(JSON.stringify({error:{message:error.message}}));else response.destroy(error);}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=`http://127.0.0.1:${server.address().port}`;
 const workspace=path.join(root,'workspace');await fs.mkdir(workspace);
 const config={baseUrl:`${address}/anthropic`,model:'audit-fixture',reasoning:'off',workspaceRoot:workspace,permission:'full',privacyPolicy:{secretPrefixes:['zxcorp_']},mcpServers:validateMcpServers([{serverName:'audit',enabled:true,transport:'streamable-http',url:`${address}/mcp`,headers:{}}]),kernel:{...KERNEL_DEFAULTS,taskTimeoutSeconds:60}};
 manager=new RuntimeManager({root:path.join(root,'runtime'),readVault:async id=>vaults.get(id),writeVault:async(id,value)=>vaults.set(id,value),onEvent:event=>events.push(event)});
 try {
  await assert.rejects(manager.run({runId:'unsafe-dictionary',sessionId:'unsafe-dictionary',prompt:'执行本机合成字典验收。'},config,'synthetic-audit-key'),error=>error.code==='RUNTIME_TURN_FAILED');
  assert(mcp.some(row=>row.method==='initialize'),'Actual official-client initialize required');
  assert(mcp.some(row=>row.method==='tools/list'),'Actual official-client tool discovery required');
  assert.equal(mcp.filter(row=>row.method==='tools/call').length,0,'phone/email/custom secret must never reach tools/call');
  assert.equal(events.filter(row=>row.runId==='unsafe-dictionary'&&row.type==='tool/result'&&row.status==='failed').length,3);
  const unsafeModels=models.filter(row=>row.phase==='unsafe');assert.equal(unsafeModels.length,1,'Unsafe tool history must also stop at the model gateway');
  const advertised=unsafeModels[0].body.tools.find(tool=>tool.name===toolName);assert.deepEqual(advertised.input_schema,schema);
  phase='ordinary';
  const result=await manager.run({runId:'ordinary-dictionary',sessionId:'ordinary-dictionary',prompt:'执行本机普通字典验收。'},config,'synthetic-audit-key');
  assert.equal(result.finishReason,'completed');assert.equal(result.text,'MCP_ORDINARY_COMPLETED');
  const calls=mcp.filter(row=>row.method==='tools/call');assert.equal(calls.length,1);assert.equal(calls[0].params.name,'dictionary');assert.deepEqual(calls[0].params.arguments,{records:{ordinary_key:'ordinary'}});
  for(const key of unsafe)assert(!JSON.stringify(calls).includes(key));
  assert.equal(models.filter(row=>row.phase==='ordinary').length,2);
  assert(JSON.stringify(models.at(-1)).includes('MCP_ORDINARY_OK'));
  console.log(JSON.stringify({boundary:'native Harness -> official MCP client -> loopback',unsafeTypes:['phone','email','custom-secret'],unsafeToolCallReceipts:0,ordinaryToolCallReceipts:1,unsafeModelReceipts:unsafeModels.length,ordinaryModelReceipts:2,synthetic:true}));
 }finally{
  await manager?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const target=await fs.realpath(root);assert.equal(path.dirname(target),parent);assert(path.basename(target).startsWith('zhixing-mcp-dynamic-native-'));await fs.rm(target,{recursive:true,force:true,maxRetries:6,retryDelay:150});
 }
});

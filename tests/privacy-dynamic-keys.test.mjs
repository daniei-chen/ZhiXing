import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

const url=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {PrivacySession}=await import(url('src/privacy-core.js'));
const {startPrivacyGateway}=await import(url('electron/privacy-gateway.mjs'));
const {apply}=await import(url('harness/office-tools.mjs'));
const {privacyPolicyForMode}=await import(url('src/privacy-policy.js'));
const {createBridgeKey,writeBridge}=await import(url('harness/privacy-bridge.mjs'));
const policy={secretPrefixes:['zxcorp_']};
const sensitive=['13800000000','audit.person@example.test','zxcorp_ABCDEF1234567890'];

async function fixture(run) {
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'zhixing-dynamic-keys-')),requests=[];
 const server=http.createServer(async(req,res)=>{const parts=[];for await(const chunk of req)parts.push(chunk);requests.push(JSON.parse(Buffer.concat(parts)));res.writeHead(200,{'content-type':'application/json'}).end('{}');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const bridgeFile=path.join(root,'vault.bin'),bridgeKey=createBridgeKey();await writeBridge(bridgeFile,bridgeKey,new PrivacySession('dynamic').exportState());
  await run({root,requests,bridgeFile,bridgeKey,baseUrl:`http://127.0.0.1:${server.address().port}/v1`,receive:`http://127.0.0.1:${server.address().port}/mcp`});
 } finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const target=await fs.realpath(root);assert.equal(path.dirname(target),parent);assert(path.basename(target).startsWith('zhixing-dynamic-keys-'));await fs.rm(target,{recursive:true,force:true,maxRetries:6,retryDelay:100});
 }
}

test('R01 数据键拒绝而不改名；固定 schema 关键字、required 和引用保持一致',()=>{
 for(const key of sensitive) {
  const value={records:{[key]:{count:1}}},before=JSON.stringify(value);
  assert.throws(()=>new PrivacySession('keys').protectValue(value,[],policy),{code:'SENSITIVE_DYNAMIC_KEY'});
  assert.equal(JSON.stringify(value),before);
 }
 const schema={type:'object',properties:{safe_name:{type:'string',enum:['open','closed']},nested:{$ref:'#/$defs/row'},zero:{const:0}},required:['safe_name'],additionalProperties:false,$defs:{row:{type:'object',properties:{quantity:{type:'number'}},required:['quantity']}}};
 assert.deepEqual(new PrivacySession('schema').protectValue(schema,['type','properties','required'],policy,{context:'schema'}).value,schema);
 for(const key of sensitive)assert.throws(()=>new PrivacySession('schema').protectValue({type:'object',properties:{[key]:{type:'string'}},required:[key]},[],policy,{context:'schema'}),{code:'SENSITIVE_DYNAMIC_KEY'});
 for(const schema of [{required:['13800000000']},{$ref:'#/properties/audit.person@example.test'},{$defs:{'zxcorp_ABCDEF1234567890':{type:'string'}}},{dependencies:{safe:['13800000000']}},{dependentRequired:{safe:['audit.person@example.test']}}])assert.throws(()=>new PrivacySession('linked-schema').protectValue(schema,[],policy,{context:'schema'}),{code:'SENSITIVE_DYNAMIC_KEY'});
 for(const schema of [{enum:['13800000000']},{const:13800000000},{default:'zxcorp_ABCDEF1234567890'},{const:{api_key:'short'}},{default:{fullName:'Jane Example'}}])assert.throws(()=>new PrivacySession('literal-schema').protectValue(schema,[],policy,{context:'schema'}),{code:'SENSITIVE_SCHEMA_VALUE'});
 const prose={...schema,description:'电话13800000000'};const protectedSchema=new PrivacySession('schema-prose').protectValue(prose,[],policy,{context:'schema'}).value;assert(!protectedSchema.description.includes('13800000000'));delete protectedSchema.description;assert.deepEqual(protectedSchema,schema);
});

test('R01 raw 保留允许的普通键；禁止规则、SECRET=mask 的动态键以及动态自定义词不能改名放行',()=>{
 const data={['13800000000']:'ordinary'},vault=new PrivacySession('raw-keys');
 assert.doesNotThrow(()=>vault.protectValue(data,[],privacyPolicyForMode({},'raw'),{privacyMode:'raw'}));
 assert.throws(()=>vault.protectValue(data,[],{actions:{PHONE:'block'}},{privacyMode:'raw'}),{code:'SENSITIVE_DYNAMIC_KEY'});
 assert.throws(()=>new PrivacySession('masked-secret-key').protectValue({zxcorp_ABCDEF1234567890:1},[],{...policy,actions:{SECRET:'mask'}}),{code:'SENSITIVE_DYNAMIC_KEY'});
 assert.throws(()=>new PrivacySession('term-key').protectValue({ProjectZeta:1},['ProjectZeta']),{code:'SENSITIVE_DYNAMIC_KEY'});
 for(const key of ['１３８００００００００','138\u200b0000\u20600000'])assert.throws(()=>new PrivacySession('unicode-keys').protectValue({[key]:1}),{code:'SENSITIVE_DYNAMIC_KEY'});
 assert.deepEqual(vault.protectValue(data,[],{actions:{PHONE:'allow'}}).value,data);
 const rawSchema={type:'object',properties:{['audit.person@example.test']:{enum:['13800000000'],const:'audit.person@example.test'}},required:['audit.person@example.test']};
 assert.deepEqual(new PrivacySession('raw-schema').protectValue(rawSchema,[],privacyPolicyForMode({},'raw'),{context:'schema',privacyMode:'raw'}).value,rawSchema);
});

for(const protocol of ['openai','anthropic'])for(const kind of ['arguments','schema','extension'])test(`R01 ${protocol}/${kind} 两类PII及自定义秘密：拒绝时真实收件增量为零，普通键正常`,async()=>{
 await fixture(async data=>{
  const gateway=await startPrivacyGateway({...data,protocol,apiKey:'synthetic-provider-key',privacyMode:'redact',privacyPolicy:policy});
  const toolSchema=key=>({type:'object',properties:{[key]:{type:'string'}},required:[key],additionalProperties:false});
  const body=key=>kind==='arguments'?{messages:[protocol==='openai'?{role:'assistant',content:null,tool_calls:[{id:'call-fixture',type:'function',function:{name:'safe_tool',arguments:JSON.stringify({[key]:'ordinary'})}}]}:{role:'assistant',content:[{type:'tool_use',id:'call-fixture',name:'safe_tool',input:{[key]:'ordinary'}}]}]}:kind==='schema'?{tools:[protocol==='openai'?{type:'function',function:{name:'safe_tool',parameters:toolSchema(key)}}:{name:'safe_tool',input_schema:toolSchema(key)}]}:{metadata:{nested:{[key]:'ordinary'}}};
  const send=async value=>{const response=await fetch(`${gateway.baseUrl}${protocol==='openai'?'/chat/completions':'/v1/messages'}`,{method:'POST',headers:{'content-type':'application/json',...(protocol==='openai'?{authorization:`Bearer ${gateway.apiKey}`}:{'x-api-key':gateway.apiKey})},body:JSON.stringify({model:'fixture',max_tokens:40,messages:[{role:'user',content:'普通正文'}],...value})});return {status:response.status,body:await response.json()};};
  try {
   for(const key of sensitive){const count=data.requests.length,result=await send(body(key));assert.equal(result.status,400,`${kind}: ${key}`);assert.equal(result.body.error.code,'SENSITIVE_DYNAMIC_KEY');assert.equal(data.requests.length,count);assert(!JSON.stringify(result).includes(key));}
   assert.equal((await send(body('ordinary_key'))).status,200);assert.equal(data.requests.length,1);
   const received=data.requests[0];
   if(kind==='schema'){const schema=protocol==='openai'?received.tools[0].function.parameters:received.tools[0].input_schema;assert.deepEqual(schema,toolSchema('ordinary_key'));}
   if(kind==='arguments'){const args=protocol==='openai'?JSON.parse(received.messages[0].tool_calls[0].function.arguments):received.messages[0].content[0].input;assert.deepEqual(args,{ordinary_key:'ordinary'});}
   if(kind==='extension')assert.deepEqual(received.metadata,{nested:{ordinary_key:'ordinary'}});
   console.log(JSON.stringify({protocol,kind,rejected:3,rejectedReceiverDelta:0,ordinaryReceipts:data.requests.length}));
  }finally{await gateway.close();}
 });
});

test('R01 协议键不会因自定义词改名；扩展参数值继承策略并在收件前拦截',async()=>{
 for(const protocol of ['openai','anthropic'])await fixture(async data=>{
  const gateway=await startPrivacyGateway({...data,protocol,apiKey:'synthetic-provider-key',privacyMode:'redact',customTerms:['model','messages','type','properties','required'],privacyPolicy:policy});
  const send=async extra=>{const response=await fetch(`${gateway.baseUrl}${protocol==='openai'?'/chat/completions':'/v1/messages'}`,{method:'POST',headers:{'content-type':'application/json',...(protocol==='openai'?{authorization:`Bearer ${gateway.apiKey}`}:{'x-api-key':gateway.apiKey})},body:JSON.stringify({model:'fixture',max_tokens:40,messages:[{role:'user',content:'普通正文'}],...extra})});await response.text();return response.status;};
  try {
   assert.equal(await send({metadata:{note:'zxcorp_ABCDEF1234567890'}}),400);assert.equal(data.requests.length,0);
   assert.equal(await send({metadata:{note:'电话13800000000'}}),200);assert.equal(data.requests.length,1);assert(!JSON.stringify(data.requests).includes('13800000000'));assert.equal(data.requests[0].model,'fixture');assert.equal(data.requests[0].messages[0].role,'user');
   const schema={type:'object',properties:{ordinary_key:{type:'string'}},required:['ordinary_key'],additionalProperties:false};
   const tools=[protocol==='openai'?{type:'function',function:{name:'safe_tool',parameters:schema}}:{name:'safe_tool',input_schema:schema}];
   assert.equal(await send({tools,...(protocol==='openai'?{tool_choice:{type:'function',function:{name:'safe_tool'}},reasoning_effort:'high'}:{tool_choice:{type:'tool',name:'safe_tool'},thinking:{type:'enabled',budget_tokens:1024}})}),200);assert.equal(data.requests.length,2);
   const received=data.requests.at(-1);assert.deepEqual(received.tools,tools);assert.equal(protocol==='openai'?received.reasoning_effort:received.thinking.budget_tokens,protocol==='openai'?'high':1024);
  }finally{await gateway.close();}
 });
});

for(const protocol of ['openai','anthropic'])test(`R01 ${protocol} 顶层及消息扩展字段同样检查动态键；raw 仍拒绝自定义秘密`,async()=>{
 await fixture(async data=>{
  const gateway=await startPrivacyGateway({...data,protocol,apiKey:'synthetic-provider-key',privacyMode:'raw',privacyPolicy:{...policy,actions:{SECRET:'mask'}}});
  const send=async body=>{const response=await fetch(`${gateway.baseUrl}${protocol==='openai'?'/chat/completions':'/v1/messages'}`,{method:'POST',headers:{'content-type':'application/json',...(protocol==='openai'?{authorization:`Bearer ${gateway.apiKey}`}:{'x-api-key':gateway.apiKey})},body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'普通正文'}],...body})});return {status:response.status,body:await response.json()};};
  try{
   const key='zxcorp_ABCDEF1234567890';
   for(const value of [{[key]:'ordinary'},{messages:[{role:'user',content:'ordinary',[key]:'ordinary'}]},{messages:[{role:'user',content:[{type:'text',text:'ordinary',[key]:'ordinary'}]}]}]){const result=await send(value);assert.equal(result.status,400);assert.equal(result.body.error.code,'SENSITIVE_DYNAMIC_KEY');assert.equal(data.requests.length,0);}
   for(const key of sensitive.slice(0,2))assert.equal((await send({metadata:{[key]:'ordinary'}})).status,200);
   assert.equal(data.requests.length,2);assert.equal(data.requests[0].metadata['13800000000'],'ordinary');assert.equal(data.requests[1].metadata['audit.person@example.test'],'ordinary');
  }finally{await gateway.close();}
 });
});

test('R01 MCP 与扩展工具共用真实 pre-execute 边界：拒绝零收件，普通参数只执行一次',async()=>{
 await fixture(async data=>{
  const names=['ZHIXING_BRIDGE_FILE','ZHIXING_BRIDGE_KEY','ZHIXING_PRIVACY_MODE','ZHIXING_PRIVACY_POLICY','ZHIXING_CUSTOM_TERMS','ZHIXING_MCP_FILE','ZHIXING_ALLOW_EXTENSIONS','ZHIXING_PERMISSION_MODE','ZHIXING_ALLOW_NETWORK','ZHIXING_WORKSPACE_ROOT'],previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  Object.assign(process.env,{ZHIXING_BRIDGE_FILE:data.bridgeFile,ZHIXING_BRIDGE_KEY:data.bridgeKey,ZHIXING_PRIVACY_MODE:'redact',ZHIXING_PRIVACY_POLICY:JSON.stringify(policy),ZHIXING_CUSTOM_TERMS:'[]',ZHIXING_MCP_FILE:'synthetic',ZHIXING_ALLOW_EXTENSIONS:'1',ZHIXING_PERMISSION_MODE:'full',ZHIXING_ALLOW_NETWORK:'true'});delete process.env.ZHIXING_WORKSPACE_ROOT;
  try {
   const handlers=new Map();apply({tools:{register(){},guard(){}},on:(name,handler)=>handlers.set(name,handler)});
   const guard=handlers.get('tools/pre-execute');assert.equal(typeof guard,'function');
   for(const name of ['mcp__synthetic__send','extension_synthetic']){
    let executions=0;
    const execute=async args=>{const decision=await guard({name,arguments:args},async()=>({kind:'allow'}));if(decision.kind==='allow'){executions++;await fetch(data.receive,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:executions,method:'tools/call',params:{name,arguments:args}})});}return decision;};
    for(const key of sensitive){const before=data.requests.length,decision=await execute({nested:{[key]:'ordinary'}});assert.equal(decision.kind,'deny');assert.match(decision.reason,/SENSITIVE_DYNAMIC_KEY/);assert.equal(data.requests.length,before);assert.equal(executions,0);}
    assert.equal((await execute({ordinary_key:'ordinary'})).kind,'allow');assert.equal(executions,1);assert.deepEqual(data.requests.at(-1).params.arguments,{ordinary_key:'ordinary'});
    for(const key of sensitive){const pending=await guard({name,arguments:{nested:{[key]:'ordinary'}}},async()=>({kind:'ask',reason:'Synthetic execution approval'}));assert.equal(pending.kind,'deny');assert.match(pending.reason,/SENSITIVE_DYNAMIC_KEY/);assert.equal(executions,1);}
    assert.equal((await guard({name,arguments:{ordinary_key:'ordinary'}},async()=>({kind:'ask',reason:'Synthetic execution approval'}))).kind,'ask');
   }
   assert.equal(data.requests.length,2);
   console.log(JSON.stringify({boundary:'MCP + extension pre-execute -> loopback JSON-RPC',rejected:6,preApprovalRejected:6,rejectedReceiverDelta:0,ordinaryReceipts:2,ordinaryExecutions:2}));
  }finally{for(const name of names)if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
 });
});

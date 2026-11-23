import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
const url=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {RuntimeManager}=await import(url('electron/runtime.mjs'));
const entry=(report,id)=>report.capabilityManifest.entries.find(item=>item.id===id);

test('真实 Harness 能力清单按项目、协议、权限与开关变化，诊断没有模型请求',{timeout:60000},async()=>{
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'zhixing-capability-runtime-'));
 const requests=[];
 const server=http.createServer((req,res)=>{requests.push(req.url);res.writeHead(500).end('DIAGNOSTIC_MUST_NOT_CALL_MODEL');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const manager=new RuntimeManager({root,readVault:async()=>null,writeVault:async()=>{}});
 const config={baseUrl:`http://127.0.0.1:${server.address().port}`,protocol:'openai',model:'synthetic-capability-model',reasoning:'off',reasoningMap:false,kernel:{ptcEnabled:true}};
 try{
  const unscoped=await manager.check(config,'synthetic-capability-key');
  assert.equal(unscoped.capabilityManifest.scope,'diagnostic');assert.equal(unscoped.capabilityManifest.observed,true);
  assert.equal(entry(unscoped,'web-search').registered,true);assert.equal(entry(unscoped,'web-search').effective,false);assert.equal(entry(unscoped,'web-search').blockedReason,'provider_unsupported');
  assert.equal(entry(unscoped,'ptc').enabled,true);assert.equal(entry(unscoped,'ptc').registered,false);assert.equal(entry(unscoped,'ptc').blockedReason,'workspace_required');
  assert.equal(entry(unscoped,'files').registered,false);
  assert.equal(entry(unscoped,'agent-office').registered,false);
  for(const id of ['browser','schedule','mcp-tools'])assert.equal(entry(unscoped,id).effective,false,id);
  const project=path.join(root,'synthetic-project');await fs.mkdir(project);
  const scoped=await manager.check({...config,workspaceRoot:project,permission:'full'},'synthetic-capability-key');
  assert.equal(scoped.capabilityManifest.conditions.protocol,'openai');assert.equal(scoped.capabilityManifest.conditions.permission,'full');
  for(const id of ['files','agent-office','terminal','ptc','team']){assert.equal(entry(scoped,id).registered,true,id);assert.equal(entry(scoped,id).effective,true,id);}
  assert.equal(entry(scoped,'web-search').effective,false);
  const closed=await manager.check({...config,protocol:'deepseek',kernel:{webEnabled:false,workflowEnabled:false,teamEnabled:false,subagentDepth:0,ptcEnabled:false}},'synthetic-capability-key');
  for(const id of ['web-search','web-fetch','workflow','team','subagents','ptc']){assert.equal(entry(closed,id).enabled,false,id);assert.equal(entry(closed,id).effective,false,id);assert.equal(entry(closed,id).blockedReason,'disabled',id);}
  for(const item of scoped.capabilityManifest.entries.filter(item=>!item.integrated))assert.equal(item.effective,false,item.id);
  assert.deepEqual(requests,[]);assert.equal(manager.runs.size,0);assert.equal(manager.busy.size,0);
 }finally{
  await manager.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const resolved=await fs.realpath(root);assert.equal(path.dirname(resolved),parent);assert(path.basename(resolved).startsWith('zhixing-capability-runtime-'));await fs.rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:150});
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createBridgeKey,readBridge,writeBridge,updateBridge} from '../harness/privacy-bridge.mjs';
import {validateMcpServers,publicMcpServers} from '../electron/mcp-config.mjs';
import {isPublicAddress} from '../harness/secure-web.mjs';
import {goalWire} from '../electron/goal-wire.mjs';
import {PrivacySession} from '../src/privacy-core.js';
test('保留原生目标工具的协议 ID，继续脱敏目标正文与普通消息',()=>{
 const id='goal-00000000-0000-4000-8000-a13800000000';
 const objective='联系 13900000000';
 const payload=JSON.stringify({goal:{id,revision:1,objective,phase:'active'},activation:'armed'});
 const vault=new PrivacySession('goal-wire');
 const protect=value=>vault.protectValue(value).value;
 assert.notEqual(protect(id),id);
 for(const messages of [
  [{role:'assistant',content:[{type:'tool_use',id:'goal-call',name:'get_goal'}]},
   {role:'user',content:[{type:'tool_result',tool_use_id:'goal-call',content:[{type:'text',text:payload}]}]}],
  [{role:'assistant',tool_calls:[{id:'goal-call',function:{name:'get_goal'}}]},
   {role:'tool',tool_call_id:'goal-call',content:payload}],
 ]){
  const wire=goalWire(messages,protect);
  assert.equal(JSON.parse(wire.result('goal-call',payload)).goal.id,id);
  assert(!wire.result('goal-call',payload).includes('13900000000'));
  assert.equal(wire.input('update_goal',{goal_id:id,objective}).goal_id,id);
  assert(!wire.input('update_goal',{goal_id:id,objective}).objective.includes('13900000000'));
  assert(!wire.result('other-tool',payload).includes(id));
  assert(!wire.result(undefined,payload).includes(id));
  assert.notEqual(wire.input('untrusted_tool',{goal_id:id}).goal_id,id);
 }
});
test('MCP 配置校验、凭据不回显及保留环境隔离',()=>{
 const values=validateMcpServers([{serverName:'office',transport:'streamable-http',url:'https://example.com/mcp',headers:{Authorization:'synthetic'}}]);
 assert.equal(publicMcpServers(values)[0].headers,undefined);assert.deepEqual(publicMcpServers(values)[0].headerKeys,['Authorization']);
 assert.throws(()=>validateMcpServers([{serverName:'office',transport:'stdio',command:'node',args:[],env:{ZHIXING_HISTORY_KEY:'bad'}}]),/保留/);
 assert.throws(()=>validateMcpServers([{serverName:'office',transport:'streamable-http',url:'http://remote.example/mcp'}]),/HTTPS/);
 assert.throws(()=>validateMcpServers([...values,...values]),/重复/);
});
test('网页地址策略拒绝内网、IPv6 映射和保留地址',()=>{
 for(const address of ['127.0.0.1','10.2.3.4','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','224.0.0.1'])assert.equal(isPublicAddress(address),false,address);
 for(const address of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])assert.equal(isPublicAddress(address),true,address);
});
test('跨进程更新脱敏映射不会覆盖或丢失',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-bridge-')),file=path.join(root,'map.bin'),key=createBridgeKey();
 try{
  await writeBridge(file,key,{count:0});const moduleUrl=new URL('../harness/privacy-bridge.mjs',import.meta.url).href;
  const children=Array.from({length:3},()=>spawn(process.execPath,['--input-type=module','-e',`import{updateBridge}from${JSON.stringify(moduleUrl)};for(let i=0;i<12;i++)await updateBridge(process.env.ZX_FILE,process.env.ZX_KEY,state=>({state:{count:state.count+1}}));`],{env:{...process.env,ZX_FILE:file,ZX_KEY:key},stdio:'ignore',windowsHide:true}));
  await Promise.all(children.map(async child=>assert.equal((await once(child,'exit'))[0],0)));
  assert.equal((await readBridge(file,key)).count,36);
  await fs.mkdir(`${file}.lock`);await assert.rejects(updateBridge(file,key,state=>({state}),{timeoutMs:25}),/繁忙/);await fs.rmdir(`${file}.lock`);
 }finally{const resolved=await fs.realpath(root);if(path.dirname(resolved)===await fs.realpath(os.tmpdir())&&path.basename(resolved).startsWith('zhixing-bridge-'))await fs.rm(resolved,{recursive:true,force:true});}
});

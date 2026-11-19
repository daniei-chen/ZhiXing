import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {KERNEL_DEFAULTS,normaliseKernel,validateKernel} from '../src/kernel-config.js';
import {RuntimeManager,prepareRuntime} from '../electron/runtime.mjs';
test('内核设置校验及真实工具目录遵循关闭开关',async()=>{
 assert.deepEqual(normaliseKernel(),KERNEL_DEFAULTS);assert.throws(()=>validateKernel({...KERNEL_DEFAULTS,taskTimeoutSeconds:0}));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-kernel-'));
 try{
 const kernel={...KERNEL_DEFAULTS,webEnabled:false,workflowEnabled:false,subagentDepth:0,maxParallelToolCalls:2,goalRounds:4};
 const patch=JSON.parse(await fs.readFile(await prepareRuntime(root,{kernel}),'utf8'));
 assert.equal(patch.find(row=>row.id==='agent-loop').config.maxParallelToolCalls,2);
 const plugins=patch.find(row=>row.insert).insert;assert.equal(plugins.find(row=>row.id==='goal').config.defaultMaxGoalRounds,4);
 const manager=new RuntimeManager({root,readVault:async()=>null,writeVault:async()=>{}});
 const result=await manager.check({kernel},'zhixing-local-check');
 assert(result.tools.some(tool=>tool.name==='office_calculate'));
 for(const name of ['web_fetch','web_search','workflow','job_list','subagent','subagent_fork'])assert(!result.tools.some(tool=>tool.name===name),name);
 assert(result.skills.some(skill=>skill.name==='office-docx'));assert(result.skills.some(skill=>skill.name==='office-pptx'));assert(result.skills.some(skill=>skill.name==='zhixing-office-1'));
 const workspace=path.join(root,'workspace'),skillDir=path.join(workspace,'.agents','skills','fixture-skill');await fs.mkdir(skillDir,{recursive:true});
 await fs.writeFile(path.join(skillDir,'SKILL.md'),'---\nname: fixture-skill\ndescription: Local fixture skill\n---\nUse fixture data only.');
 const local=await manager.check({kernel,workspaceRoot:workspace},'zhixing-local-check');assert(local.skills.some(skill=>skill.name==='fixture-skill'));
 const scoped=JSON.parse(await fs.readFile(await prepareRuntime(root,{workspaceRoot:workspace}),'utf8'));assert.deepEqual(scoped.find(row=>row.insert).insert.find(row=>row.id==='workspace-instructions').config.projectRootMarkers,[]);
 }finally{const resolved=await fs.realpath(root);if(path.dirname(resolved)===await fs.realpath(os.tmpdir())&&path.basename(resolved).startsWith('zhixing-kernel-'))await fs.rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:150});}
},{timeout:30000});

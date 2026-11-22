import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const url=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {createCapabilityManifest,CAPABILITY_REASONS}=await import(url('harness/capability-manifest.mjs'));
const tools=['office_calculate','office_calendar','office_table_check','office_read_file','office_write_file','office_list_files','office_execute','exit_plan_mode','get_goal','create_goal','update_goal','todo_write','ask_user_question','skill','subagent','subagent_fork','list_agents','wait_agent','send_message','interrupt_agent','team_task_create','team_task_get','team_task_list','team_task_update','workflow','job_list','job_output','job_kill','run_code','web_fetch','web_search','office_browser','office_schedule','mcp__synthetic__lookup','present'];
const options={tools,modelTools:tools,hasWorkspace:true,permission:'full',protocol:'deepseek',inputModalities:['text','image'],visualBridge:true,kernel:{ptcEnabled:true},browserBridge:true,automationBridge:true,teamActive:true,scope:'run'};
const entry=(manifest,id)=>manifest.entries.find(item=>item.id===id);

test('未检查目录时不能把配置开关当作已注册或可执行',()=>{
 const manifest=createCapabilityManifest({...options,tools:undefined,modelTools:undefined});
 assert.equal(manifest.observed,false);
 for(const item of manifest.entries.filter(item=>item.integrated)){assert.equal(item.registered,null);assert.equal(item.effective,false);assert.equal(item.evidence,'configuration_only');assert(item.blockedReason);}
});

test('真实目录存在不掩盖路由、项目、执行权限和桥接门槛',()=>{
 const manifest=createCapabilityManifest({...options,hasWorkspace:false,permission:'ask',protocol:'openai',browserBridge:false,automationBridge:false});
 for(const [id,reason] of [['files','workspace_required'],['terminal','workspace_required'],['ptc','workspace_required'],['web-search','provider_unsupported'],['browser','browser_bridge_unavailable'],['schedule','automation_bridge_unavailable']]){
  assert.equal(entry(manifest,id).registered,true,id);assert.equal(entry(manifest,id).effective,false,id);assert.equal(entry(manifest,id).blockedReason,reason,id);
 }
 assert.equal(entry(createCapabilityManifest({...options,permission:'auto'}),'ptc').blockedReason,'full_access_required');
});

test('开关关闭、规划模式和禁止联网立即反映在有效能力上',()=>{
 const disabled=createCapabilityManifest({...options,kernel:{webEnabled:false,workflowEnabled:false,subagentDepth:0,teamEnabled:true,ptcEnabled:false}});
 for(const id of ['web-fetch','web-search','browser','workflow','subagents','team','ptc']){assert.equal(entry(disabled,id).enabled,false,id);assert.equal(entry(disabled,id).effective,false,id);assert.equal(entry(disabled,id).blockedReason,'disabled',id);}
 const offline=createCapabilityManifest({...options,allowNetwork:false});
 for(const id of ['web-fetch','web-search','browser','mcp-tools'])assert.equal(entry(offline,id).blockedReason,'network_disallowed',id);
 const plan=createCapabilityManifest({...options,planning:true});
 for(const id of ['terminal','workflow','ptc','subagents','todo','present','mcp-tools'])assert.equal(entry(plan,id).blockedReason,'planning_read_only',id);
 for(const id of ['files','goal','team','browser','schedule']){assert.equal(entry(plan,id).effective,true,id);assert.deepEqual(entry(plan,id).restrictions,['planning_read_only'],id);}
 assert.equal(entry(plan,'web-fetch').effective,true);
});

test('工具缺失和未接入范围不可被伪造的同名目录开启',()=>{
 const manifest=createCapabilityManifest({...options,tools:tools.filter(name=>name!=='job_kill'&&!name.startsWith('mcp__')).concat('vision','oauth')});
 assert.equal(entry(manifest,'workflow').registered,false);assert.equal(entry(manifest,'workflow').blockedReason,'not_registered');
 assert.equal(entry(manifest,'mcp-tools').registered,false);
 for(const item of manifest.entries.filter(item=>!item.integrated)){assert.equal(item.effective,false);assert.equal(item.registered,false);assert.equal(item.blockedReason,'not_integrated');}
});

test('完整目录与满足门槛仅证明可调度，保留逐次审批及证据语义',()=>{
 const manifest=createCapabilityManifest(options);
 assert.equal(manifest.scope,'run');assert.equal(manifest.observed,true);
 for(const item of manifest.entries.filter(item=>item.integrated)){assert.equal(item.effective,true,item.id);assert.equal(item.registered,true);assert.equal(item.blockedReason,null);assert.equal(item.evidence,item.id==='ptc'?'model_catalog':'runtime_catalog');}
 const ask=createCapabilityManifest({...options,permission:'ask'});
 assert.equal(entry(ask,'web-fetch').approvalRequired,true);assert.equal(entry(ask,'terminal').approvalRequired,true);assert.equal(entry(ask,'office').approvalRequired,false);
 assert.equal(entry(createCapabilityManifest({...options,teamActive:false}),'team').blockedReason,'team_inactive');
 const ptc=createCapabilityManifest({...options,tools:tools.filter(name=>name!=='run_code'),modelTools:['run_code']});assert.equal(entry(ptc,'ptc').registered,true);assert.equal(entry(ptc,'ptc').invocation,'direct');assert.equal(entry(ptc,'office').invocation,'programmatic');
 const unavailable=createCapabilityManifest({...options,modelTools:[]});assert.equal(entry(unavailable,'office').blockedReason,'not_model_exposed');
});

test('清单只输出固定元数据，不包含工具参数、目录、模型或凭据',()=>{
 const manifest=createCapabilityManifest({...options,tools:tools.map(name=>({name,description:'PRIVATE_DESCRIPTION',parameters:{secret:'PRIVATE_SCHEMA'}})),workspaceRoot:'PRIVATE_PATH',key:'PRIVATE_KEY',model:'PRIVATE_MODEL'});
 assert(!JSON.stringify(manifest).includes('PRIVATE_'));
 assert.equal(new Set(manifest.entries.map(item=>item.id)).size,manifest.entries.length);
 for(const item of manifest.entries)if(item.blockedReason)assert.equal(typeof CAPABILITY_REASONS[item.blockedReason],'string');
 const changed=createCapabilityManifest({...options,tools:[]});assert.equal(entry(changed,'office').effective,false);assert.equal(entry(manifest,'office').effective,true);
});

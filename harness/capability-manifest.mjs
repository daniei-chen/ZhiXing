import {normaliseKernel} from '../src/kernel-config.js';
import {planningAllows} from './shell-policy.mjs';

// A catalog observation proves registration, never successful execution. Keep
// configuration, registration and current routing gates as separate facts.
const definitions = [
 {id:'office',label:'计算、日期与表格检查',tools:['office_calculate','office_calendar','office_table_check']},
 {id:'files',label:'项目文件读写与目录分页',tools:['office_read_file','office_write_file','office_list_files'],workspace:true},
 {id:'native-text-read',label:'Harness 原生项目文本读取',tools:['read'],workspace:true,readOnly:true},
 {id:'native-project-image',label:'Harness 原生项目图片读取',tools:['read_image'],workspace:true,readOnly:true,imageRoute:true,bridge:'office-vision'},
 {id:'native-text-search',label:'Harness 原生项目文件搜索',tools:['glob','grep'],workspace:true,readOnly:true},
 {id:'native-text-write',label:'Harness 原生项目文本写入与编辑',tools:['write','edit'],workspace:true,write:true},
 {id:'native-text-patch',label:'Harness 原生多文件补丁',tools:['apply_patch'],workspace:true,write:true},
 {id:'agent-office',label:'办公文档转换与工作簿重算',tools:['office_convert','office_recalculate'],workspace:true,write:true,inWorkspace:true},
 {id:'agent-office-render',label:'办公页面渲染与图片输入',tools:['office_render'],workspace:true,readOnly:true,imageRoute:true,bridge:'office-vision'},
 {id:'terminal',label:'Agent PowerShell 命令',tools:['office_execute'],workspace:true,write:true},
 {id:'plan',label:'规划审批',tools:['exit_plan_mode']},
 {id:'goal',label:'持续目标',tools:['get_goal','create_goal','update_goal']},
 {id:'todo',label:'工作计划',tools:['todo_write']},
 {id:'questions',label:'交互提问',tools:['ask_user_question']},
 {id:'skills',label:'原生技能目录与调用',tools:['skill']},
 {id:'subagents',label:'子任务及控制',tools:['subagent','subagent_fork','list_agents','wait_agent','send_message','interrupt_agent'],setting:k=>k.subagentDepth>0},
 {id:'team',label:'共享任务板',tools:['team_task_create','team_task_get','team_task_list','team_task_update'],setting:k=>k.teamEnabled&&k.subagentDepth>0},
 {id:'workflow',label:'工作流与后台作业',tools:['workflow','job_list','job_output','job_kill'],setting:k=>k.workflowEnabled,write:true},
 {id:'ptc',label:'程序化工具调用（PTC）',tools:['run_code'],modelTool:true,setting:k=>k.ptcEnabled,workspace:true,full:true,write:true},
 {id:'web-fetch',label:'网页文字读取',tools:['web_fetch'],setting:k=>k.webEnabled,network:true},
 {id:'web-search',label:'DeepSeek 官方搜索',tools:['web_search'],setting:k=>k.webEnabled,network:true,deepseek:true},
 {id:'browser',label:'Agent 浏览器操作',tools:['office_browser'],setting:k=>k.webEnabled,network:true,bridge:'browser'},
 {id:'schedule',label:'Agent 定时任务管理',tools:['office_schedule'],bridge:'automation',write:true},
 {id:'mcp-tools',label:'已连接 MCP 工具',prefix:'mcp__',network:true},
 {id:'present',label:'交付文件展示',tools:['present'],workspace:true},
 {id:'vision-input',label:'模型视觉输入与本机遮罩副本',tools:[],imageModel:true},
];
const unsupported = [
 ['resident-host','常驻 Harness Host 与跨启动作业'],
 ['oauth','MCP / 供应商 OAuth 登录'],
 ['independent-search','独立搜索连接'],
 ['responses-gemini','Responses / Gemini 协议'],
 ['heterogeneous-submodels','异构子模型路由'],
 ['native-files','完整原生文件编辑工具'],
 // Vision is represented by an explicit runtime entry below. Keep the
 // unsupported list for capabilities that still have no implementation.
 ['ner','全面 NER 脱敏引擎'],
 ['incremental-storage','增量加密事件与 Blob 存储'],
];

export function createCapabilityManifest(options={}) {
 const kernel=normaliseKernel(options.kernel);
 const observed=Array.isArray(options.tools);
 const names=new Set(observed?options.tools.map(tool=>typeof tool==='string'?tool:tool?.name).filter(name=>typeof name==='string'):[]);
 const modelObserved=Array.isArray(options.modelTools);
 const modelNames=new Set(modelObserved?options.modelTools.map(tool=>typeof tool==='string'?tool:tool?.name).filter(name=>typeof name==='string'):[]);
 const programmatic=modelNames.size===1&&modelNames.has('run_code');
 const entries=definitions.map(definition=>{
  const enabled=definition.setting?definition.setting(kernel):true;
  const catalog=definition.modelTool?modelNames:names,inspected=definition.modelTool?modelObserved:observed;
  const registered=inspected?(definition.imageModel?options.attachmentRegistered===true:definition.prefix?[...catalog].some(name=>name.startsWith(definition.prefix)):definition.tools.every(name=>catalog.has(name))):null;
  let blockedReason=null;
  if(!enabled)blockedReason='disabled';
  else if(definition.workspace&&!options.hasWorkspace)blockedReason='workspace_required';
  else if(definition.imageRoute&&!options.inputModalities?.includes('image'))blockedReason='model_image_input_unavailable';
  else if(definition.bridge==='office-vision'&&!options.officeVisionBridge)blockedReason='office_vision_bridge_unavailable';
  else if(definition.full&&options.permission!=='full')blockedReason='full_access_required';
  else if(definition.network&&options.allowNetwork===false)blockedReason='network_disallowed';
  else if(definition.deepseek&&options.protocol!=='deepseek')blockedReason=options.protocol?'provider_unsupported':'provider_not_selected';
  else if(definition.bridge==='browser'&&!options.browserBridge)blockedReason='browser_bridge_unavailable';
  else if(definition.bridge==='automation'&&!options.automationBridge)blockedReason='automation_bridge_unavailable';
  else if(definition.id==='team'&&options.teamActive===false)blockedReason='team_inactive';
  else if(options.planning===true&&!definition.tools?.some(name=>planningAllows(name,{operation:'list'})))blockedReason='planning_read_only';
  else if(registered===false)blockedReason='not_registered';
  else if(!observed||!modelObserved)blockedReason='not_inspected';
  else if(!programmatic&&!(definition.prefix?[...modelNames].some(name=>name.startsWith(definition.prefix)):definition.tools.every(name=>modelNames.has(name))))blockedReason='not_model_exposed';
  if(definition.imageModel){
   if(!observed||!modelObserved)blockedReason='not_inspected';
   else {
    const imageCap=Array.isArray(options.inputModalities)&&options.inputModalities.includes('image');
    blockedReason=!imageCap?'model_image_input_unavailable':!registered?'not_registered':!options.visualBridge?'visual_bridge_unavailable':null;
   }
  }
  const effective=blockedReason===null;
  const readOnly=effective&&options.planning===true&&(definition.bridge==='browser'||definition.bridge==='automation'||definition.tools?.some(name=>!planningAllows(name)));
  return {id:definition.id,label:definition.label,integrated:true,enabled,registered,effective,blockedReason,
   restrictions:readOnly?['planning_read_only']:[],
   invocation:registered===true?(definition.imageModel?'image_input':definition.modelTool||!programmatic?'direct':'programmatic'):null,
   approvalRequired:effective&&!definition.readOnly&&options.permission!=='full'&&!(definition.inWorkspace&&options.permission==='auto')&&Boolean(definition.write||definition.network||definition.workspace),
   evidence:inspected?(definition.modelTool?'model_catalog':'runtime_catalog'):'configuration_only'};
 });
 for(const [id,label] of unsupported)entries.push({id,label,integrated:false,enabled:false,registered:false,effective:false,blockedReason:'not_integrated',restrictions:[],invocation:null,approvalRequired:false,evidence:'source_scope'});
 return {schemaVersion:1,scope:options.scope==='run'?'run':'diagnostic',observed,modelObserved,executor:!modelObserved?'unknown':programmatic?'programmatic':'native',
  conditions:{hasWorkspace:options.hasWorkspace===true,permission:['ask','auto','full'].includes(options.permission)?options.permission:'ask',protocol:['deepseek','openai','anthropic'].includes(options.protocol)?options.protocol:null,allowNetwork:options.allowNetwork!==false,planning:options.planning===true,inputModalities:Array.isArray(options.inputModalities)?options.inputModalities:[],visualBridge:options.visualBridge===true},entries};
}

export const CAPABILITY_REASONS = Object.freeze({
 disabled:'已在内核设置中关闭',workspace_required:'需要关联项目目录',full_access_required:'需要选择完全访问',
 network_disallowed:'本次任务未授权联网',provider_unsupported:'当前协议未接入此搜索服务',provider_not_selected:'尚未选择供应商',
 browser_bridge_unavailable:'本次诊断未连接浏览器面板',automation_bridge_unavailable:'本次诊断未连接定时任务主机',model_image_input_unavailable:'当前模型未声明图片输入能力',visual_bridge_unavailable:'本次任务未准备本机遮罩图片',
 office_vision_bridge_unavailable:'需从 Windows 项目内用支持图片的模型发起手动交办',
 team_inactive:'当前会话未启用共享任务板',planning_read_only:'规划模式仅允许只读调查',not_registered:'真实目录未注册此能力所需工具',
 not_inspected:'尚未读取真实内核与模型工具声明',not_model_exposed:'当前执行器未向模型开放此工具',not_integrated:'尚未接入知行',
});

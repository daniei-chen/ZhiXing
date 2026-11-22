import {defineTool} from '@deepseek-ai/dsh-tools';
import {PrivacySession} from '../src/privacy-core.js';
import {containsCredentialValue} from '../src/privacy-recognizers.js';
import {privacyPolicyForMode} from '../src/privacy-policy.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readBridge, updateBridge } from './privacy-bridge.mjs';
import { resolveOfficePath, needsApproval, writeOfficeFile, nextOfficePath } from './file-policy.mjs';
import { parseOfficeFile, exportOfficeFile } from '../electron/office-files.mjs';
import {normaliseKernel} from '../src/kernel-config.js';
import {shellEnvironment, planningAllows} from './shell-policy.mjs';

export const name='zhixing-office-tools';
export const inject=['tools','llm','approval','shell','planMode','sandboxPolicy'];
export const TOOL_NAMES=['office_calculate','office_calendar','office_table_check','office_read_file','office_write_file','office_list_files','office_execute','todo_write','ask_user_question','skill','web_search','web_fetch','subagent','subagent_fork','list_agents','send_message','interrupt_agent','wait_agent','get_goal','create_goal','update_goal','exit_plan_mode','office_browser','office_schedule','workflow','job_list','job_output','job_kill','present','team_task_create','team_task_get','team_task_list','team_task_update','run_code'];
const output={schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]};

export function calculate(numbers,operation){
 if(!Array.isArray(numbers)||!numbers.length||numbers.length>10000||numbers.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw new Error('需要 1 至 10000 个有限数字。');
 const sum=numbers.reduce((a,b)=>a+b,0);
 const value=({sum:()=>sum,average:()=>sum/numbers.length,min:()=>Math.min(...numbers),max:()=>Math.max(...numbers),count:()=>numbers.length})[operation]?.();
 if(!Number.isFinite(value))throw new Error('运算不支持或结果超出数值范围。');
 return {operation,count:numbers.length,value};
}
export function checkTable(rows){
 if(!Array.isArray(rows)||rows.length>2000||rows.some(r=>!Array.isArray(r)||r.length>100))throw new Error('表格规模或格式不支持。');
 const width=rows[0]?.length||0,seen=new Map(),duplicates=[],missing=[],uneven=[];
 rows.forEach((r,i)=>{if(r.length!==width)uneven.push(i+1);r.forEach((v,j)=>{if(v===null||v==='')missing.push({row:i+1,column:j+1});});const key=JSON.stringify(r);if(seen.has(key))duplicates.push({row:i+1,sameAs:seen.get(key)});else seen.set(key,i+1);});
 return {rowCount:rows.length,columnCount:width,duplicateRows:duplicates,missingCells:missing,unevenRows:uneven};
}
const DIRECTORY_SCAN_LIMIT=10000;
async function listOfficeDirectory(target,{offset,limit,signal,forbidden}){
 signal.throwIfAborted();
 const before=await fs.lstat(target);
 if(!before.isDirectory()||before.isSymbolicLink())throw new Error('NOT_DIRECTORY: 请选择真实目录。');
 if(await fs.realpath(target)!==target)throw new Error('DIRECTORY_CHANGED: 目录位置已变化，请重新操作并按需审批。');
 const entries=[];let scanned=0;
 // Read directory metadata only. Count excluded entries too, so a hidden-only
 // directory cannot bypass the work bound. Iteration closes the handle on errors.
 const directory=await fs.opendir(target);
 for await(const item of directory){
  signal.throwIfAborted();
  if(++scanned>DIRECTORY_SCAN_LIMIT)throw new Error('DIRECTORY_SCAN_LIMIT: 目录超过 10000 个直接条目，未返回不完整清单；请指定范围更小的子目录。');
  if(item.name.startsWith('.')||item.isSymbolicLink()||forbidden(path.join(target,item.name)))continue;
  if(item.isDirectory()||item.isFile())entries.push({name:item.name,type:item.isDirectory()?'directory':'file'});
 }
 signal.throwIfAborted();
 const after=await fs.lstat(target);
 if(!after.isDirectory()||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||await fs.realpath(target)!==target)throw new Error('DIRECTORY_CHANGED: 枚举期间目录已变化，请从第一页重新操作。');
 // Locale-independent UTF-16 order, before privacy replacement. Each call is
 // a fresh scan; pagination assumes the directory is unchanged between calls.
 entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 if(offset>entries.length)throw new Error('INVALID_DIRECTORY_PAGE: 分页起点超过可见条目数，请从第一页重新操作。');
 const end=Math.min(offset+limit,entries.length),truncated=end<entries.length;
 return {directory:target,entries:entries.slice(offset,end),offset,limit,total_entries:entries.length,next_offset:truncated?end:null,truncated};
}
export function apply(ctx){
 const kernel=normaliseKernel(JSON.parse(process.env.ZHIXING_KERNEL||'{}'));
 const root=process.env.ZHIXING_WORKSPACE_ROOT;
 const mode=process.env.ZHIXING_PERMISSION_MODE||'ask';
 const raw=process.env.ZHIXING_PRIVACY_MODE==='raw';
 const privacyPolicy=privacyPolicyForMode(JSON.parse(process.env.ZHIXING_PRIVACY_POLICY||'{}'),raw?'raw':'redact');
 const bridgeFile=process.env.ZHIXING_BRIDGE_FILE,bridgeKey=process.env.ZHIXING_BRIDGE_KEY;
 let vault,terms=[];
 async function getVault(){
  {const saved=await readBridge(bridgeFile,bridgeKey);vault=new PrivacySession(saved.id,saved);terms=JSON.parse(process.env.ZHIXING_CUSTOM_TERMS||'[]');}
  return vault;
 }
 const forbidden=target=> /(?:^|[\\/])(?:\.ssh|\.aws|\.azure|vaults)(?:[\\/]|$)|(?:^|[\\/])(?:\.env(?:\..*)?|.*\.(?:pem|key|pfx)|deepseek\.credential|workspace\.bin|automations\.bin|privacy-bridge\.bin)$/i.test(target);
 async function localPath(value,write=false){
  if(!root)throw new Error('请先关联工作空间目录。');
  const v=await getVault(),restored=v.restore(value);
  if(restored.unknown.length)throw new Error('文件路径含有无法归属的占位符。');
  const resolved=await resolveOfficePath(restored.text,root,{write});
  if(forbidden(resolved.target))throw new Error('此位置含凭证或应用私密记录，不能交给模型工具。');
  return resolved;
 }
 async function permit(exec,info,operation){
  if(!needsApproval(mode,info))return;
  const outcome=await ctx.approval.request({agent:exec.agent,callId:exec.callId,toolName:exec.name,reason:JSON.stringify({operation,path:info.target,overwrite:info.exists&&info.write}),signal:exec.signal});
  if(outcome!=='allowed-once')throw new Error('本次文件操作未获批准。');
 }
 async function protectedValue(value,context='data'){
  return updateBridge(bridgeFile,bridgeKey,saved=>{
  const v=new PrivacySession(saved.id,saved),checked=v.protectValue(value,terms,privacyPolicy,{context,privacyMode:raw?'raw':'redact'});
  if(checked.blocked||containsCredentialValue(value,process.env.DEEPSEEK_API_KEY))throw new Error('文件结果含疑似凭证，已停止向模型返回。');
  return {state:v.exportState(),value:raw?value:checked.value};
  });
 }
 if(process.env.ZHIXING_AUTOMATION_BRIDGE){
  ctx.tools.register(defineTool({name:'office_schedule',description:'管理知行当前项目的定时任务：list/view读取；create创建暂停草稿；edit修改并暂停；pause暂停；delete删除。创建后必须让用户到定时任务页面审阅并启用，不可声称已开始自动运行。日历规则使用日期与时间；高级规则用 rule_kind 和 expression 或 seconds，Cron 可显式指定 time_zone。已有聊天目标由用户在页面选择。',parameters:{operation:{type:'string',enum:['list','view','create','edit','pause','delete'],required:true},id:{type:'string'},title:{type:'string'},prompt:{type:'string'},kind:{type:'string',enum:['agent','reminder']},frequency:{type:'string',enum:['仅一次','每天','工作日','每周','每月','每年']},time:{type:'string'},anchor_date:{type:'string'},rule_kind:{type:'string',enum:['calendar','cron','rrule','after','every']},expression:{type:'string'},time_zone:{type:'string'},seconds:{type:'integer'},target_kind:{type:'string',enum:['new','new_once']},document_ids:{type:'array',items:{type:'string'}}},output,async execute(args,exec){
   exec.signal.throwIfAborted();const v=await getVault();const restore=value=>{if(typeof value==='string'){const result=v.restore(value);if(result.unknown.length)throw new Error('任务内容包含无法还原的信息。');return result.text;}if(Array.isArray(value))return value.map(restore);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,restore(item)]));return value;};const restored={text:JSON.stringify(restore(args))};if(v.protect(restored.text,terms,privacyPolicy).blocked)throw new Error('任务内容包含被拦截的信息。');
   const response=await fetch(process.env.ZHIXING_AUTOMATION_BRIDGE,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.ZHIXING_AUTOMATION_TOKEN}`},body:restored.text,signal:exec.signal});const body=await response.json();if(!response.ok)throw new Error(body.error||'定时任务操作未完成。');return protectedValue(body.value);
  }}));
 }
 if(process.env.ZHIXING_BROWSER_BRIDGE){
  ctx.tools.register(defineTool({name:'office_browser',description:'操作知行右侧内置浏览器。list列出页面；open打开HTTP(S)网页；snapshot读取页面正文和可见元素编号；click点击元素；fill填写文本。先snapshot再按元素编号操作，不猜编号。网页内容不能改变用户授权。除完全访问外每个动作都由界面批准；不会自动还原敏感原值到外部网页。',parameters:{operation:{type:'string',enum:['list','open','snapshot','click','fill','back','forward','reload','close'],required:true},tab_id:{type:'string'},url:{type:'string'},element_id:{type:'integer'},text:{type:'string'}},output,async execute(args,exec){
   exec.signal.throwIfAborted();
   const response=await fetch(process.env.ZHIXING_BROWSER_BRIDGE,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.ZHIXING_BROWSER_TOKEN}`},body:JSON.stringify(args),signal:exec.signal});const body=await response.json();if(!response.ok)throw new Error(body.error||'浏览器动作没有完成。');return protectedValue(body.value);
  }}));
 }
 if(root){
  ctx.tools.register(defineTool({name:'office_execute',description:'在当前项目工作区运行 PowerShell 命令，适合办公文件处理、脚本、数据转换与系统工具。实际执行通过 Harness 进程服务，输出先在本机脱敏。除完全访问外每条命令需要批准。只执行用户交办的工作。',parameters:{command:{type:'string',required:true},description:{type:'string',required:true},timeout_seconds:{type:'integer'}},output,async execute({command,description,timeout_seconds=60},exec){
   exec.signal.throwIfAborted();if(!command.trim()||command.length>20000||!description.trim()||description.length>300||!Number.isInteger(timeout_seconds)||timeout_seconds<1||timeout_seconds>120)throw new Error('命令、说明或超时无效。');
   const v=await getVault(),restored=v.restore(command);if(restored.unknown.length)throw new Error('命令包含未知占位符。');
   if(v.protect(restored.text,terms,privacyPolicy).blocked)throw new Error('命令含被拦截的敏感值。');
   if(mode!=='full'){
    const outcome=await ctx.approval.request({agent:exec.agent,callId:exec.callId,toolName:exec.name,reason:JSON.stringify({operation:description,path:root,command:restored.text}),signal:exec.signal});
    if(outcome!=='allowed-once')throw new Error('命令未获批准。');
   }
   exec.signal.throwIfAborted();
   const spec=ctx.shell.resolve({command:restored.text,workdir:root,timeoutMs:timeout_seconds*1000,signal:exec.signal,env:shellEnvironment(),sandboxPolicy:ctx.sandboxPolicy.resolve({session:exec.agent?.session})});
   const process=await ctx.shell.execute(spec),result=await process.result();
   return protectedValue({exitCode:result.exitCode,timedOut:result.timedOut,aborted:result.aborted,sandbox:result.sandbox,stdout:result.stdout.text,stderr:result.stderr.text,truncated:result.stdout.truncated||result.stderr.truncated});
  }}));
  ctx.tools.register(defineTool({name:'office_read_file',description:'读取工作空间或经批准的本机办公文件。支持TXT、Markdown、CSV、DOCX、XLSX、PPTX和文字PDF。仅返回本机提取文本，图片和扫描区域未识别；公式只有缓存值。返回的敏感占位符必须原样保留。大文件按 start_character 和 max_characters 分段读取，直到 next_character 为 null。',parameters:{file_path:{type:'string',required:true},start_character:{type:'integer'},max_characters:{type:'integer'}},output,async execute({file_path,start_character=0,max_characters=80000},exec){
   exec.signal.throwIfAborted();if(!Number.isInteger(start_character)||start_character<0||!Number.isInteger(max_characters)||max_characters<1||max_characters>80000)throw new Error('读取范围无效，单次最多 80000 字符。');const info=await localPath(file_path);await permit(exec,{...info,write:false},'读取文件');
   const stat=await fs.stat(info.target);if(!stat.isFile()||stat.size>10*1024*1024)throw new Error('请选择不超过10MB的普通办公文件。');
   const parsed=await parseOfficeFile(path.basename(info.target),await fs.readFile(info.target),{signal:exec.signal});exec.signal.throwIfAborted();
   if(start_character>parsed.text.length)throw new Error('读取起点超过文字长度。');const end=Math.min(parsed.text.length,start_character+max_characters);return protectedValue({path:info.target,text:parsed.text.slice(start_character,end),coverage:parsed.coverage,warnings:parsed.warnings,total_characters:parsed.text.length,start_character,next_character:end<parsed.text.length?end:null,truncated:end<parsed.text.length});
  }}));
  ctx.tools.register(defineTool({name:'office_list_files',description:'分页列出指定目录的可见普通文件和子目录，不递归、不读取内容；排除点开头、链接和禁止位置。按原始文件名 UTF-16 升序，默认每页 120 项；total_entries 仅统计可见条目，truncated 表示仍有后续页，使用 next_offset 继续直到 null。每页重新扫描，目录变化后应从第一页重查；单次最多扫描 10000 个直接条目，超限明确报错而不返回不完整清单。',parameters:{directory:{type:'string',required:true},offset:{type:'integer',description:'可见条目的零基起点，默认 0，范围 0–10000。'},limit:{type:'integer',description:'每页条目数，默认 120，范围 1–120。'}},output,async execute({directory,offset=0,limit=120},exec){
   exec.signal.throwIfAborted();
   if(!Number.isSafeInteger(offset)||offset<0||offset>DIRECTORY_SCAN_LIMIT||!Number.isSafeInteger(limit)||limit<1||limit>120)throw new Error('INVALID_DIRECTORY_PAGE: offset 须为 0–10000 的整数，limit 须为 1–120 的整数。');
   try{
    const info=await localPath(directory);await permit(exec,{...info,write:false},'列出目录');
    const result=await listOfficeDirectory(info.target,{offset,limit,signal:exec.signal,forbidden});
    exec.signal.throwIfAborted();const value=await protectedValue(result);exec.signal.throwIfAborted();return value;
   }catch(error){
    exec.signal.throwIfAborted();
    // Native filesystem errors contain unprotected absolute paths. Keep their
    // bounded error code useful without sending directory/file names in errors.
    if(/^E[A-Z0-9]+$/.test(error?.code))throw new Error(`DIRECTORY_READ_FAILED (${error.code}): 无法读取目录元数据，请检查位置和访问权限。`);
    throw error;
   }
  }}));
  ctx.tools.register(defineTool({name:'office_write_file',description:'创建或覆盖TXT、Markdown、CSV、DOCX、XLSX办公成果。仅写入用户交办的成果；敏感占位符由本机还原。覆盖或外部路径可能需要用户批准。',parameters:{file_path:{type:'string',required:true},content:{type:'string',required:true}},output,async execute({file_path,content},exec){
   if(typeof content!=='string'||content.length>200000)throw new Error('成果内容超过20万字符。');
   const info=await localPath(file_path,true),extension=path.extname(info.target).slice(1).toLowerCase();
   if(!['txt','md','csv','tsv','docx','xlsx'].includes(extension))throw new Error('此工具只生成办公文稿或表格。');
   const v=await getVault(),restored=v.restore(content);if(restored.unknown.length)throw new Error('成果包含未知占位符，已停止写入。');
   if(v.protect(restored.text,terms,privacyPolicy).blocked)throw new Error('成果包含疑似凭证，已停止写入。');
   const requestedPath=info.exists?await nextOfficePath(info.target):info.target;
   const output=await resolveOfficePath(path.relative(root,requestedPath),root,{write:true});
   if(output.inside!==info.inside||forbidden(output.target))throw new Error('新成果路径无法沿用原文件的安全范围。');
   await permit(exec,{...output,write:true,exists:false},'保存办公成果');exec.signal.throwIfAborted();
   const checked=await localPath(file_path,true);if(checked.target!==info.target||checked.exists!==info.exists)throw new Error('目标文件已变化，请重新操作。');
   const destination=await resolveOfficePath(path.relative(root,requestedPath),root,{write:true});
   if(destination.target!==output.target||destination.exists)throw new Error('FILE_CHANGED: 保存位置已变化，请重新审批。');
   const buffer=await exportOfficeFile(restored.text,['docx','xlsx'].includes(extension)?extension:'txt');
   const writtenPath=await writeOfficeFile(destination.target,buffer);
   return protectedValue({path:writtenPath,bytes:buffer.length,written:true});
  }}));
 }
 ctx.tools.register(defineTool({name:'office_calculate',description:'对用户提供的数字做确定性求和、均值、最大最小值或计数。金额单位由用户提供，不猜测。',parameters:{numbers:{type:'array',items:{type:'number'},required:true},operation:{type:'string',enum:['sum','average','min','max','count'],required:true}},output,async execute({numbers,operation},exec){exec.signal.throwIfAborted();return calculate(numbers,operation);}}));
 ctx.tools.register(defineTool({name:'office_calendar',description:'计算一个 ISO 日期加减若干天后的日期及星期；只计算，不创建日历事项。',parameters:{date:{type:'string',required:true},days:{type:'integer',required:true}},output,async execute({date,days},exec){exec.signal.throwIfAborted();if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Math.abs(days)>36600)throw new Error('日期或天数不支持。');const d=new Date(`${date}T00:00:00Z`);if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==date)throw new Error('日期无效。');d.setUTCDate(d.getUTCDate()+days);return{date:d.toISOString().slice(0,10),weekday:['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getUTCDay()]};}}));
 ctx.tools.register(defineTool({name:'office_table_check',description:'检查已提供的二维表：重复行、缺失单元格和不齐列。行号从 1 开始。',parameters:{rows:{type:'array',items:{type:'array',items:{type:'json'}},required:true}},output,async execute({rows},exec){exec.signal.throwIfAborted();return checkTable(rows);}}));
 // A model instruction cannot enlarge the host's actual capability boundary.
 const mcpEnabled=!!process.env.ZHIXING_MCP_FILE;
 const isMcp=name=>name.startsWith('mcp__')||['list_mcp_resources','list_mcp_resource_templates','read_mcp_resource'].includes(name);
 const extensionTool=name=>process.env.ZHIXING_ALLOW_EXTENSIONS==='1'&&!TOOL_NAMES.includes(name)&&!isMcp(name);
 const disabledTool=name=>(!kernel.webEnabled&&['office_browser','web_search','web_fetch'].includes(name))||(!kernel.workflowEnabled&&['workflow','job_list','job_output','job_kill'].includes(name))||(!kernel.subagentDepth&&['subagent','subagent_fork'].includes(name))||((!kernel.teamEnabled||!kernel.subagentDepth)&&name.startsWith('team_task_'))||(name==='run_code'&&(!kernel.ptcEnabled||mode!=='full'||!root));
 ctx.tools.guard(exec=>!disabledTool(exec.name)&&(TOOL_NAMES.includes(exec.name)||(mcpEnabled&&isMcp(exec.name))||extensionTool(exec.name))?undefined:'此工具已关闭或尚未接入知行的权限和隐私策略。');
 ctx.on('tools/pre-execute',async(exec,next)=>{
  if(exec.agent&&(ctx.planMode.get(exec.agent).pending??ctx.planMode.get(exec.agent).active)&&!planningAllows(exec.name,exec.arguments))return {kind:'deny',reason:'规划模式仅允许只读工具，请先提交方案或退出规划模式。'};
  if(exec.name==='present'){
   if(!Array.isArray(exec.arguments.files)||!exec.arguments.files.length||exec.arguments.files.length>8)return {kind:'deny',reason:'成果文件数量无效。'};
   for(const file of exec.arguments.files){const info=await localPath(file.path);await permit(exec,{...info,write:false},'交付成果文件');}
  }
  if(exec.name==='web_search'&&process.env.ZHIXING_WEB_SEARCH_AVAILABLE==='false')return {kind:'deny',reason:'当前模型服务未配置独立的网页搜索凭据，网页搜索暂不可用。请连接 DeepSeek 路由或配置独立搜索服务。'};
  const decision=await next();if(exec.name==='office_schedule'&&['delete','edit','pause'].includes(exec.arguments.operation)&&mode!=='full')return {kind:'ask',reason:JSON.stringify({operation:'修改定时任务',path:exec.arguments.id||'当前项目',network:{operation:exec.arguments.operation}})};if(exec.name==='workflow'&&mode!=='full')return {kind:'ask',reason:JSON.stringify({operation:'运行多 Agent 工作流',path:root||'当前任务',command:exec.arguments.script})};if(exec.name==='create_goal'&&Number(exec.arguments.max_goal_rounds)>kernel.goalRounds)return {kind:'deny',reason:`单个目标最多自动继续 ${kernel.goalRounds} 轮。`};if(decision.kind==='deny'||!['web_search','web_fetch','office_browser'].includes(exec.name)&&!isMcp(exec.name)&&!extensionTool(exec.name))return decision;
  if(process.env.ZHIXING_ALLOW_NETWORK==='false')return {kind:'deny',reason:'本次任务未授权联网。'};
  const v=await getVault();let checked;
  try{checked=v.protectValue(exec.arguments,terms,privacyPolicy,{privacyMode:raw?'raw':'redact'});}
  catch(error){if(['SENSITIVE_DYNAMIC_KEY','SENSITIVE_SCHEMA_VALUE'].includes(error.code))return {kind:'deny',reason:`${error.code}: 联网参数的字段名称或工具约束包含需保护的信息，请使用安全字段名。`};throw error;}
  if(containsCredentialValue(exec.arguments,process.env.DEEPSEEK_API_KEY))return {kind:'deny',reason:'联网参数包含配置凭据，已阻止发送。'};
  if(checked.blocked||(!raw&&checked.entities.length))return {kind:'deny',reason:'联网参数含未经替换的敏感值，请改用占位符或不含敏感值的关键词。'};
  // Execution approval never grants permission to bypass the privacy boundary.
  if(decision.kind!=='allow')return decision;
  if(mode==='full')return {kind:'allow'};
  return {kind:'ask',reason:JSON.stringify({operation:exec.name==='office_browser'?'操作内置浏览器':isMcp(exec.name)?'调用 MCP 工具或资料':exec.name==='web_search'?'搜索互联网':'读取网页',path:exec.name==='office_browser'?(exec.arguments.url||exec.arguments.tab_id||'内置浏览器'):isMcp(exec.name)?exec.name:exec.name==='web_fetch'?exec.arguments.url:'DeepSeek 搜索',network:exec.arguments})};
 });
 ctx.on('tools/post-execute',async(exec,result,next)=>{
  const decision=await next();if((!isMcp(exec.name)&&!extensionTool(exec.name))||decision.kind!=='accept')return decision;
  const content=decision.content||result.content;
  if(content?.some(block=>block.type!=='text'))return {kind:'block',feedback:[{type:'text',text:'外部工具返回非文本内容，尚未接入附件隐私处理。'}]};
  try{return {kind:'accept',content:await protectedValue(content,'block')};}
  catch{return {kind:'block',feedback:[{type:'text',text:'外部工具返回内容被隐私策略拦截。'}]};}
 });
 // Provider turns stay text-only; office-file values pass through the local privacy bridge.
 ctx.on('llm-pi-ai/request-headers',(request,headers)=>{
  if(request.sessionId!==undefined)headers.set('x-zhixing-session-id',String(request.sessionId));
  return headers;
 });
 ctx.on('llm/stream',async function*(options,next){
  if(options.messages.some(message=>message.content.some(block=>['file','image'].includes(block.type)))){yield {type:'finish',reason:{kind:'error',failure:{code:'UNKNOWN',message:'原始附件尚未接入脱敏，请先解析为文本。'}}};return;}
  yield* next();
 });
}

const toolLabels = new Map(Object.entries({
 office_calculate:'数字计算', office_calendar:'日期计算', office_table_check:'表格检查',
 office_read_file:'读取办公文件', office_write_file:'生成办公文件', office_list_files:'列出目录',
 office_convert:'转换办公文档', office_recalculate:'重算工作簿', office_render:'渲染办公页面',
 read:'读取项目文本', read_image:'读取项目图片', write:'写入项目文本', edit:'编辑项目文本', apply_patch:'应用项目文件补丁',
 glob:'查找项目文件', grep:'搜索项目文本',
 working_directory:'会话工作目录',
 office_execute:'PowerShell 命令', todo_write:'更新工作计划', ask_user_question:'等待补充',
 skill:'加载办公技能', workflow:'多 Agent 工作流', job_list:'查看后台作业', job_output:'读取后台输出',
 job_kill:'停止后台作业', present:'交付成果文件', web_search:'网页搜索', web_fetch:'读取网页',
 office_browser:'操作内置浏览器', subagent:'委派子任务', subagent_fork:'委派上下文子任务',
 list_agents:'查看子任务', send_message:'发送子任务消息', interrupt_agent:'停止子任务',
 wait_agent:'等待子任务或补充消息', exit_plan_mode:'提交工作方案',
 list_mcp_resources:'列出 MCP 资源', list_mcp_resource_templates:'列出 MCP 模板',
 read_mcp_resource:'读取 MCP 资源', office_schedule:'安排定时任务',
 team_task_create:'创建共享任务', team_task_get:'读取共享任务', team_task_list:'查看共享任务板', team_task_update:'更新共享任务', run_code:'程序化工具调用',
}));
const lifecycle = new Map(Object.entries({
 'job/registered':'后台作业已启动', 'job/settled':'后台作业已结束',
 'tool-workflow/run-start':'工作流已启动', 'tool-workflow/run-end':'工作流已结束',
 'tool-workflow/agent-start':'工作流子任务已启动', 'tool-workflow/agent-end':'工作流子任务已结束',
}));
const statuses = new Set(['running','completed','cancelled','interrupted','failed','killed','error','max-tokens','blocked','aborted','tool','stop']);
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const id = value => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value) ? value : undefined;
export const executionStatus = value => statuses.has(value) ? value : undefined;

export function projectExecutionEvent(event, childSessionId, calls) {
 const {type, data} = event;
 const base = {type, childSessionId:id(childSessionId), time:number(event.time), sequence:number(event.seq), turn:number(data?.turn), step:number(data?.step)};
 const call = raw => id(raw) && `${childSessionId || 'root'}:${raw}`;
 switch(type) {
  case 'tool/call': {
   const reference = call(data.callId);
   const tool = toolLabels.get(data.name) ?? (data.name?.startsWith('mcp__') ? 'MCP 工具' : '内核工具');
   if (reference) {
    if (calls.size >= 512) calls.delete(calls.keys().next().value);
    calls.set(reference, {name:data.name,tool,time:base.time});
   }
   return {...base, label:`调用 · ${tool}`, category:'tools', status:'running'};
  }
  case 'tool/result': {
   const reference = call(data.message?.toolCallId);
   const started = calls.get(reference);
   calls.delete(reference);
   const stoppedPatch = started?.name === 'apply_patch' && data.meta?.stopped === true;
   const status = data.message?.isError ? 'failed' : stoppedPatch ? 'interrupted' : 'completed';
   const suffix = {failed:'失败',interrupted:'未完成',completed:'完成'}[status];
   return {...base, label:started ? `${started.tool} · ${suffix}` : `工具${suffix}`,
    category:'tools', status,
    durationMs:base.time >= started?.time ? base.time - started.time : undefined};
  }
  case 'turn/end':
   return {...base, label:'本轮结束', category:'session', status:executionStatus(data.reason?.kind)};
  case 'team/task':
   return {...base,label:'共享任务状态已更新',category:'team',itemId:id(data.task?.id),status:({pending:'running',in_progress:'running',completed:'completed',deleted:'completed'})[data.task?.status]};
  default:
   if (!lifecycle.has(type)) return null;
   return {...base, label:lifecycle.get(type), category:type.startsWith('job/') ? 'jobs' : 'workflow',
    itemId:id(data.jobId ?? data.runId), member:number(data.seq),
    status:executionStatus(data.status ?? data.stopReason ?? data.outcome) ?? (type.endsWith('start') || type === 'job/registered' ? 'running' : undefined),
    durationMs:number(data.finishedAt - data.startedAt)};
 }
}

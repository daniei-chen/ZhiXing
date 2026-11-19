import {localDate} from '../src/scheduler.js';
// All model-created plans use the same persisted scheduler and UI approval flow.
// A tool cannot arm a model task or expand its reviewed documents.
function timingDraft(args, old, now) {
 const kind=args.rule_kind||old?.rule?.kind;
 if(args.rule_kind==='calendar'||!kind){
  return {rule:null,frequency:args.frequency??old?.frequency,time:args.time??old?.time,anchorDate:args.anchor_date??old?.anchorDate??localDate(new Date(now))};
 }
 const previous=old?.rule?.kind===kind?old.rule:{};
 const rule=kind==='after'||kind==='every'?{kind,seconds:args.seconds??previous.seconds}
  :{kind,expression:args.expression??previous.expression,...(kind==='cron'?{timeZone:args.time_zone??previous.timeZone}:{})};
 return {rule};
}
export async function automationTool(service,scope,args,now=Date.now()){
 const owns=task=>task.workspaceId===scope.workspaceId&&(task.projectId||null)===(scope.projectId||null);
 const view=task=>({id:task.id,title:task.name,prompt:task.description,kind:task.kind,frequency:task.frequency,time:task.time,anchor_date:task.anchorDate,rule:task.rule,target:task.target,enabled:task.enabled,status:task.status,next_run:task.nextRun,document_ids:task.documentIds});
 const tasks=service.snapshot().tasks.filter(owns);
 if(args.operation==='list')return {tasks:tasks.map(view)};
 if(args.operation==='create'){
  await service.save({name:args.title,description:args.prompt,kind:args.kind||'agent',workspaceId:scope.workspaceId,projectId:scope.projectId||null,...timingDraft(args,null,now),target:{kind:args.target_kind||'new'},documentIds:args.document_ids||[]});
  const task=service.snapshot().tasks.filter(owns).find(task=>!tasks.some(old=>old.id===task.id));
  return {task:view(task),message:'已保存为暂停草稿。请在定时任务页面审阅资料与发送范围后启用。'};
 }
 const task=tasks.find(task=>task.id===args.id);if(!task)throw new Error('定时任务不在当前项目或已删除。');
 if(args.operation==='view')return {task:view(task)};
 if(args.operation==='pause'){await service.toggle(task.id,false);return {task:view(service.task(task.id))};}
 if(args.operation==='delete'){await service.remove(task.id);return {deleted:true,id:task.id};}
 if(args.operation==='edit'){
  await service.save({...task,name:args.title??task.name,description:args.prompt??task.description,...timingDraft(args,task,now),target:args.target_kind?{kind:args.target_kind}:task.target,documentIds:args.document_ids??task.documentIds});
  return {task:view(service.task(task.id)),message:'修改已保存并暂停，需要重新审阅后启用。'};
 }
 throw new Error('不支持此定时任务动作。');
}

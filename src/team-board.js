import {PrivacySession, TYPE_LABELS} from './privacy-core.js';
import {containsCredentialValue} from './privacy-recognizers.js';

// The actual provider credential stays in the host. A Harness projection only
// knows the loopback credential and cannot perform this independent check.
export function protectTeamContext(context, credential) {
  if(!context?.team||!containsCredentialValue(context.team,credential))return context;
  return {...context,team:{enabled:context.team.enabled===true,tasks:[],failure:'共享任务内容含模型凭证，已隐藏。'}};
}

// The native Team projection remains in encrypted history. This bounded view is
// for the execution UI; credentials and model-generated raw identifiers cannot
// enter the event summary through task subjects or descriptions.
export function projectTeamBoard(board, terms=[], policy={}) {
  if (!board?.enabled) return null;
  const vault = new PrivacySession('team-display');
  const text = (value, limit) => {
    const checked=vault.protect(String(value??'').slice(0,limit), terms, policy);
    if(checked.blocked)return '内容已被隐私规则隐藏';
    return checked.text.replace(/⟦ZX-[^⟧]+-([A-Z]+)-\d+⟧/g,(_token,type)=>`【${TYPE_LABELS[type]||'敏感信息'}】`).replace(/⟦ZX-[^⟧]+⟧/g,'【敏感信息】');
  };
  return {enabled:true, failure:board.failure?'共享任务状态读取异常，请核对执行记录。':null, truncated:board.tasks?.length>100,
    tasks:(board.tasks||[]).filter(task=>['pending','in_progress','completed'].includes(task.status)).slice(0,100).map(task=>({
      id:text(task.id,80),revision:Number.isSafeInteger(task.revision)?task.revision:0,
      subject:text(task.subject,300),description:text(task.description,2000),status:task.status,
      owner:task.ownerName?text(task.ownerName,160):null,ready:task.ready===true,
      blockedBy:(task.blockedBy||[]).slice(0,30).map(id=>text(id,80)),
      writeScopes:(task.writeScopes||[]).slice(0,20).map(scope=>text(scope,300)),
      warnings:(task.writeScopeWarnings||[]).slice(0,20).map(warning=>text(warning,300)),
    }))};
}

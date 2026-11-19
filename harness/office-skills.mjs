import {workflows} from '../src/office-workflows.js';
export const name='zhixing-office-skills';
export const inject=['skills'];
export function apply(ctx){
  for(const [mode,items] of Object.entries(workflows))items.forEach(([label,instructions],index)=>ctx.skills.register({
    name:`zhixing-${mode}-${index+1}`,description:`${mode==='government'?'政务':'办公'}：${label}。根据已提供材料完成，保留来源和待确认项。`,source:'bundled',provider:'zhixing',
    content:`# ${label}\n\n${instructions}\n\n## 交付要求\n\n先检查资料是否足够；多步工作用todo_write展示计划。缺少必要信息时调用ask_user_question。数值核算使用计算工具。保存文件使用已接入的文件工具；只有工具成功才能说已保存。标明材料来源和未核实信息。敏感占位符原样传递，由本机还原。`,
  }));
}

export const workflows = {
  office: [
    ['整理会议纪要', '按结论、行动项、责任人和期限整理以下会议记录。区分明确交办给我的事项与他人事项；未明确的信息标为待确认。\n\n会议记录：\n'],
    ['起草工作周报', '根据以下材料起草工作周报，分为完成事项、进行中、待协调和下周安排。数字标注来源，缺失信息不要补造。\n\n材料：\n'],
    ['核对表格', '检查附件里的缺失值、重复记录和金额合计。先说明统计范围和口径，再列出具体差异及复核建议。'],
    ['拟写通知', '根据以下事项起草一份可直接修改的内部通知。说明对象、时间、行动和反馈方式，待确认项单列。\n\n事项：\n'],
  ],
  government: [
    ['拟办意见', '根据以下来文及办理要求起草拟办意见。分别列出事项、拟办部门、办理时限、依据和待核实项。标注为拟稿，保留人工审核。\n\n材料：\n'],
    ['汇报材料', '基于提供的材料起草汇报提纲，按总体情况、已完成、存在问题、下一步安排展开。列出数据来源与待核实情况。\n\n材料：\n'],
    ['督办清单', '从提供的会议或通知材料提取督办清单。列明原始要求、责任单位、时间节点、回执和待确认项。\n\n材料：\n'],
    ['会议纪要', '起草会议纪要，分别列出议定事项、责任单位、期限和需审定事项。引用依据时标注材料出处，不补造会议结论。\n\n材料：\n'],
  ],
};

export function composePrompt(text, files, history = [], projectInstructions = '', personalInstructions = '') {
  const parts = [];
  if (personalInstructions.trim()) parts.push(`【用户办公偏好】\n${personalInstructions.trim()}`);
  if (projectInstructions.trim()) parts.push(`【项目说明】\n${projectInstructions.trim()}`);
  if (history.length) {
    const context = history.filter(m => m.text && !m.demo && !m.error && !m.stopped).slice(-6)
      .map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.text.slice(0, 8000)}`).join('\n\n');
    if (context) parts.push(`【近期对话，仅作上下文】\n${context}`);
  }
  parts.push(`【本次交办】\n${text || '请按附件内容整理。'}`);
  files.forEach((file, i) => {const coverage=[...new Set([file.coverage?.notice,...(file.warnings||[])].filter(Boolean))].join('\n');parts.push(`【资料 ${i + 1}：${file.name}】\n${coverage?`【本机读取范围】\n${coverage}\n【提取文字】\n`:''}${file.text}\n【资料 ${i + 1} 结束】`);});
  return parts.join('\n\n');
}

export const REASONING_LEVELS = [
  { id: 'off', label: '关闭', description: '直接回答，适合润色和简单问答。' },
  { id: 'low', label: '低', description: '适合摘要、归纳和常规整理。' },
  { id: 'high', label: '高', description: '适合撰写长文稿、核表和多步任务。' },
  { id: 'max', label: '最高', description: '适合复杂分析，生成可能更慢。' },
];
export const FALLBACK_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', description: '日常办公与快速处理', source: 'builtin' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '复杂推理与高质量文稿', source: 'builtin' },
];
export function availableModels(catalog, selected) {
  const rows = (catalog?.length ? catalog : FALLBACK_MODELS).filter(model => model?.id);
  return rows.some(model => model.id === selected) ? rows : [...rows, { id: selected, name: selected === 'deepseek-v4-flash' ? 'DeepSeek V4 Flash' : selected, description: '已保存的模型 ID', source: 'configured' }];
}

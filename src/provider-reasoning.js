import { REASONING_LEVELS } from './model-options.js';

// 供应商页里也要能改思考强度：只显示当前模型真实支持的档位。
export function currentModel(providers, settings = {}) {
  const provider = (providers || []).find(row => row.id === settings.modelProviderId);
  if (!provider) return null;
  const model = (provider.models || []).find(row => row.id === settings.model);
  return model ? { provider, model } : null;
}

export function reasoningChoices(current) {
  const levels = current?.model?.levels;
  if (!Array.isArray(levels) || !levels.length) return [];
  return REASONING_LEVELS.filter(level => levels.includes(level.id));
}

export function reasoningState({ current, settings = {} } = {}) {
  const choices = reasoningChoices(current);
  const selected = choices.find(level => level.id === settings.reasoning) || null;
  if (!current) return { choices, selected, problem: '没有找到当前模型，请先在输入框里选一个模型。' };
  if (!choices.length) return { choices, selected, problem: '当前模型的思考档位尚未确认，请刷新模型目录。' };
  return { choices, selected, problem: selected ? null : '当前档位不受这个模型支持，请重新选择。' };
}

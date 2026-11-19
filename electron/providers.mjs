import { randomUUID } from 'node:crypto';
import { PROVIDER_PRESETS } from '../src/provider-options.js';
import { builtinModels, fetchModels, MODEL_ID } from './model-catalog.mjs';

const presetById = new Map(PROVIDER_PRESETS.map(preset => [preset.id, preset]));
const none = { levels: ['off'] };
const toggle = { off: null, high: 'high' };
const full = { off: null, low: 'low', high: 'high', max: 'max' };
const wire = (map, compat) => ({ levels: Object.keys(map), map, compat });

export function modelReasoning(provider, model) {
  if (provider.protocol === 'deepseek') return wire(full);
  const preset = provider.preset;
  if (preset === 'zhipu' && /^glm-(?:4\.[567]|5)/i.test(model)) {
    return wire({ ...toggle, off: 'none' }, { thinkingFormat: 'zai', supportsReasoningEffort: false });
  }
  if (preset === 'kimi' && /^kimi-k2\.[56]/i.test(model)) {
    return wire({ ...toggle, off: 'none' }, { thinkingFormat: 'deepseek', supportsReasoningEffort: false });
  }
  if (preset === 'qwen' && /^(?:qwen3\.|qwen3-|qwen-(?:max|plus|flash))/i.test(model)) {
    return wire({ ...toggle, off: 'none' }, { thinkingFormat: 'qwen', supportsReasoningEffort: false });
  }
  if (preset === 'openai' && /^gpt-5(?:$|[.\-])/.test(model) && !/audio|image|codex|chat-latest|pro(?:-|$)/i.test(model)) {
    const map = /^gpt-5(?:-|$)/.test(model) ? { off: 'minimal', low: 'low', high: 'high' } : { ...full, off: 'none', max: 'xhigh' };
    return wire(map, { supportsReasoningEffort: true });
  }
  if (preset === 'openai' && /^o[134](?:-|$)/.test(model)) return wire({ low: 'low', high: 'high' }, { supportsReasoningEffort: true });
  if (preset === 'anthropic' && /^claude-(?:opus|sonnet)-(?:4-[6-9]|[5-9])/.test(model)) {
    return wire(full, { forceAdaptiveThinking: true });
  }
  if (preset === 'anthropic' && /^claude-(?:opus|sonnet|haiku)-4/.test(model)) return wire(full);
  if (preset === 'openrouter' && /deepseek\/.*(?:r1|v[34])|openai\/(?:o[134]|gpt-5)|anthropic\/claude-4/.test(model)) {
    return wire({ ...full, off: 'none', max: 'xhigh' }, { thinkingFormat: 'openrouter' });
  }
  if (!preset && provider.reasoningStyle === 'standard') return wire({ ...full, off: 'none', max: 'xhigh' }, provider.protocol === 'openai' ? { supportsReasoningEffort: true } : undefined);
  if (!preset && provider.reasoningStyle === 'deepseek' && provider.protocol === 'openai') return wire({ ...full, off: 'none' }, { thinkingFormat: 'deepseek', supportsReasoningEffort: true });
  return none;
}

export function normalizeEndpoint(value, protocol) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 API 服务地址。'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含凭据、查询参数或片段。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('API 地址需要 HTTPS，本机服务可用 HTTP。');
  if (protocol === 'deepseek' && url.hostname === 'api.deepseek.com' && url.pathname === '/') url.pathname = '/anthropic';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(protocol === 'openai' ? /\/chat\/completions$/ : /\/v1\/messages$/, protocol === 'openai' ? '' : '/v1');
  return url.href.replace(/\/$/, '');
}

export function legacyProvider(configuration, key) {
  if (!key) return null;
  const { baseUrl, model, credentialRevision, contextWindow, maxTokens } = configuration;
  return {
    id: 'deepseek', preset: 'deepseek', name: 'DeepSeek', protocol: 'deepseek',
    baseUrl, key, credentialRevision, contextWindow, maxTokens, model,
    models: [...builtinModels(), { id: model, name: model, source: 'configured' }].filter((row, index, rows) => rows.findIndex(item => item.id === row.id) === index),
    reasoningStyle: 'none',
  };
}

export function publicProviders(providers) {
  return providers.map(({ key, ...provider }) => ({ ...provider, configured: Boolean(key) }));
}

export function providerModels(providers) {
  return providers.flatMap(provider => provider.models.map(model => ({
    ...model, providerId: provider.id, providerName: provider.name,
    levels: modelReasoning(provider, model.id).levels,
  })));
}

export function resolveProvider(providers, selection = {}) {
  const { modelProviderId, model, reasoning } = selection;
  const provider = modelProviderId ? providers.find(row => row.id === modelProviderId)
    : providers.find(row => row.id === 'deepseek') || providers[0];
  if (!provider) throw new Error('请在设置的「供应商」中配置模型，或重新选择可用模型。');
  const selected = provider.models.find(row => row.id === model) || provider.models.find(row => row.id === provider.model) || provider.models[0];
  const effort = modelReasoning(provider, selected.id);
  const compatibleChat = provider.protocol === 'openai' && provider.preset !== 'openai';
  return {
    providerId: provider.id, protocol: provider.protocol, baseUrl: provider.baseUrl,
    model: selected.id, reasoning: effort.levels.includes(reasoning) ? reasoning : effort.levels.includes('high') ? 'high' : effort.levels[0],
    reasoningMap: effort.map || false,
    compat: compatibleChat ? {
      supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false,
      maxTokensField: 'max_tokens', supportsUsageInStreaming: false, ...effort.compat,
    } : effort.compat,
    credentialRevision: provider.credentialRevision,
    contextWindow: selected.contextWindow || provider.contextWindow, maxTokens: selected.maxTokens || provider.maxTokens,
  };
}

function tokenLimit(input, previous, fallback, min, max) {
  const value = input === undefined || input === '' ? previous ?? fallback : Number(input);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`请输入 ${min}–${max} 之间的 token 上限。`);
  return value;
}

export async function saveProvider(input, providers) {
  const preset = presetById.get(input.preset);
  const previous = providers.find(row => row.id === (preset?.id || input.id));
  if (input.id && !previous) throw new Error('供应商已移除。');
  const protocol = preset?.protocol || input.protocol;
  if (!preset && !['openai', 'anthropic'].includes(protocol)) throw new Error('请选择自定义接口协议。');
  const baseUrl = normalizeEndpoint(preset ? previous?.baseUrl || preset.baseUrl : input.baseUrl, protocol);
  const sameRoute = previous?.baseUrl === baseUrl && previous?.protocol === protocol;
  const key = input.apiKey?.trim() || (sameRoute ? previous.key : '');
  if (!key || key.length > 1024 || /[^\x21-\x7e]/.test(key)) throw new Error('请输入该 API 地址的有效 API Key。');
  const name = preset?.name || input.name?.trim();
  if (!name || name.length > 60) throw new Error('请输入 1–60 字的供应商名称。');
  const contextWindow = tokenLimit(input.contextWindow, previous?.contextWindow, 128000, 8192, 2000000);
  const maxTokens = tokenLimit(input.maxTokens, previous?.maxTokens, 8192, 1024, 262144);
  if (maxTokens >= contextWindow) throw new Error('输出上限必须小于上下文窗口。');
  const provider = {
    id: preset?.id || previous?.id || randomUUID(), preset: preset?.id || null, name, protocol, baseUrl, key,
    contextWindow, maxTokens, reasoningStyle: ['standard', 'deepseek'].includes(input.reasoningStyle) ? input.reasoningStyle : 'none',
    credentialRevision: previous?.key === key && sameRoute ? previous.credentialRevision : randomUUID(),
  };
  const ids = [...new Set(String(input.manualModels || '').split(/[\s,，]+/).filter(Boolean))];
  if (ids.length > 50 || ids.some(id => !MODEL_ID.test(id))) throw new Error('最多填写 50 个模型 ID，每行一个。');
  const manualModels = ids.map(id => ({ id, name: id, source: 'configured' }));
  const discovered = input.discover ? await fetchModels(provider, key)
    : sameRoute ? previous.models.filter(row => row.source !== 'configured') : [];
  provider.models = [...discovered, ...manualModels.filter(row => !discovered.some(model => model.id === row.id))];
  if (!provider.models.length) throw new Error('请拉取模型列表，或手动填写模型 ID。');
  const preferred = previous?.model || (preset?.id === 'deepseek' ? 'deepseek-flash' : null);
  provider.model = provider.models.some(row => row.id === preferred) ? preferred : provider.models[0].id;
  return provider;
}

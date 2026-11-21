export const MODEL_CREDENTIAL_MIN_LENGTH = 8;
export function assertModelCredential(key) {
  if (typeof key !== 'string' || key.length < MODEL_CREDENTIAL_MIN_LENGTH || key.length > 1024 || /[^\x21-\x7e]/.test(key)) {
    throw new Error('API Key 需为 8–1024 个可打印 ASCII 字符，且不能含空格。请在供应商设置中重新配置。');
  }
}

export const PROVIDER_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', protocol: 'deepseek' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai' },
  { id: 'kimi', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai' },
];

export function selectedModel(runtime, settings) {
  const models = runtime.models || [];
  if (Object.hasOwn(settings, 'modelProviderId') && settings.modelProviderId != null && settings.modelProviderId !== '') {
    return models.find(row => row.providerId === settings.modelProviderId && row.id === settings.model);
  }
  const providerId = settings.modelProviderId;
  const modelId = settings.model;
  if (typeof modelId !== 'string' || !modelId) return undefined;
  const matches = models.filter(row => row.id === modelId);
  return matches.length === 1 ? matches[0] : undefined;
}

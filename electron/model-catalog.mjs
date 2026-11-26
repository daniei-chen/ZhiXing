import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import {assertModelCredential} from '../src/provider-options.js';
import {containsCredential} from '../src/privacy-recognizers.js';
export const MODEL_ID = /^[\w./:+-]{1,160}$/;

export function builtinModels() {
  return resolveAdapterOptions({}).models.map(model => ({ id: model.id, name: model.name || model.id, description: model.description || '', inputModalities: Array.isArray(model.inputModalities) ? [...model.inputModalities] : ['text'], source: 'builtin' }));
}

// 提供方目录里每个模型的上限写法五花八门（OpenAI 兼容的 context_length、Anthropic 的
// limit.context、以及各类 max_*_tokens）。桌面版按模型定价请求头，所以这些上限必须跟着模型走；
// 只认可验证的正整数，缺失或越界一律不采信，回落到供应商级设置。
const WINDOW_MIN = 8192;
const WINDOW_MAX = 2_000_000;
const OUTPUT_MIN = 1;
const OUTPUT_MAX = 262_144;

function positiveInteger(value) {
  const number = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export function modelLimits(item) {
  if (!item || typeof item !== 'object') return {};
  const contextWindow = [
    item.context_length, item.contextLength, item.context_window, item.contextWindow,
    item.max_input_tokens, item.maxInputTokens, item.limit?.context,
  ].map(positiveInteger).find(value => value !== undefined && value >= WINDOW_MIN && value <= WINDOW_MAX);
  const declaredOutput = [
    item.max_output_tokens, item.maxOutputTokens, item.max_completion_tokens,
    item.limit?.output, item.top_provider?.max_completion_tokens,
  ].map(positiveInteger).find(value => value !== undefined && value >= OUTPUT_MIN && value <= OUTPUT_MAX);
  const limits = {};
  if (contextWindow !== undefined) limits.contextWindow = contextWindow;
  // 输出上限必须严格小于窗口，否则内核的压缩策略会判定配置无效；窗口未知时也先不写输出。
  if (declaredOutput !== undefined && contextWindow !== undefined && declaredOutput < contextWindow) limits.maxTokens = declaredOutput;
  return limits;
}

export function decodeModels(body) {
  if (!Array.isArray(body?.data)) throw new Error('模型服务没有返回可用的模型列表。');
  const seen = new Set();
  const rows = [];
  for (const item of body.data.slice(0, 300)) {
    if (!item || typeof item.id !== 'string' || !MODEL_ID.test(item.id) || seen.has(item.id) || /(?:^|[\/_-])(?:embeddings?|rerank|moderation|whisper|tts|dall-e|gpt-image)(?:$|[-_0-9])/i.test(item.id)) continue;
    seen.add(item.id);
    const modalities = item.input_modalities ?? item.inputModalities ?? item.architecture?.input_modalities;
    const inputModalities = Array.isArray(modalities) ? ['text', ...(modalities.includes('image') ? ['image'] : [])] : null;
    rows.push({ id: item.id, name: String(item.name || item.display_name || item.id).slice(0, 100), description: typeof item.description === 'string' ? item.description.slice(0, 180) : '', ...(inputModalities ? { inputModalities } : {}), ...modelLimits(item), source: 'provider' });
  }
  if (!rows.length) throw new Error('服务返回的模型列表为空，已保留当前配置。');
  return rows;
}

// fetch() 把底层原因藏在 error.cause 里。丢掉它，界面就只能显示一句笼统的
// “无法读取模型列表”；保留系统错误码，统一的错误文案才能给出下一步。
export function failureCode(error) {
  if (error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError') return 'TIMEOUT';
  const code = error?.cause?.code || error?.code || '';
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(code) ? code : '';
}

export async function fetchModels(configuration, key) {
  assertModelCredential(key);
  const base = new URL(configuration.baseUrl);
  const root = base.pathname.replace(/\/$/, '');
  const native = configuration.protocol === 'anthropic';
  base.pathname = configuration.protocol === 'deepseek' || base.hostname === 'api.deepseek.com'
    ? `${root.replace(/\/anthropic(?:\/v1)?$/, '')}/models`
    : native ? `${root.endsWith('/v1') ? root : `${root}/v1`}/models` : `${root}/models`;
  base.search = native ? '?limit=100' : '';
  const auth = native ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${key}` };
  let response;
  try {
    response = await fetch(base, { headers: { ...auth, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12000) });
  } catch (error) {
    const code = failureCode(error);
    throw new Error(`无法读取模型列表${code ? `（${code}）` : ''}，请检查网络和 API 地址。`);
  }
  if (!response.ok) throw new Error(`读取模型列表失败（HTTP ${response.status}），已保留当前配置。`);
  if (Number(response.headers.get('content-length')) > 512000) throw new Error('模型列表过大。');
  const reader = response.body.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 512000) throw new Error('模型列表过大。'); text += decoder.decode(part.value, { stream: true }); } }
  finally { await reader.cancel().catch(() => {}); }
  try {
    const rows = decodeModels(JSON.parse(text + decoder.decode()));
    const clean = rows.filter(row => !Object.values(row).some(value => typeof value === 'string' && containsCredential(value,key)));
    if (!clean.length) throw new Error('模型列表没有可用记录。');
    return clean;
  } catch (error) { if (/模型/.test(error.message)) throw error; throw new Error('模型服务返回格式无效。'); }
}

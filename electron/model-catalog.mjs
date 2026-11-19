import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
export const MODEL_ID = /^[\w./:+-]{1,160}$/;

export function builtinModels() {
  return resolveAdapterOptions({}).models.map(model => ({ id: model.id, name: model.name || model.id, description: model.description || '', source: 'builtin' }));
}

export function decodeModels(body) {
  if (!Array.isArray(body?.data)) throw new Error('模型服务没有返回可用的模型列表。');
  const seen = new Set();
  const rows = [];
  for (const item of body.data.slice(0, 300)) {
    if (!item || typeof item.id !== 'string' || !MODEL_ID.test(item.id) || seen.has(item.id) || /(?:^|[\/_-])(?:embeddings?|rerank|moderation|whisper|tts|dall-e|gpt-image)(?:$|[-_0-9])/i.test(item.id)) continue;
    seen.add(item.id);
    rows.push({ id: item.id, name: String(item.name || item.display_name || item.id).slice(0, 100), description: typeof item.description === 'string' ? item.description.slice(0, 180) : '', source: 'provider' });
  }
  if (!rows.length) throw new Error('服务返回的模型列表为空，已保留当前配置。');
  return rows;
}

export async function fetchModels(configuration, key) {
  if (!key) throw new Error('请先在模型连接中配置 API Key。');
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
  } catch { throw new Error('无法读取模型列表，请检查网络和 API 地址。'); }
  if (!response.ok) throw new Error(`读取模型列表失败（HTTP ${response.status}），已保留当前配置。`);
  if (Number(response.headers.get('content-length')) > 512000) throw new Error('模型列表过大。');
  const reader = response.body.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 512000) throw new Error('模型列表过大。'); text += decoder.decode(part.value, { stream: true }); } }
  finally { await reader.cancel().catch(() => {}); }
  try {
    const rows = decodeModels(JSON.parse(text + decoder.decode()));
    const clean = key.length >= 8 ? rows.filter(row => !Object.values(row).some(value => typeof value === 'string' && value.includes(key))) : rows;
    if (!clean.length) throw new Error('模型列表没有可用记录。');
    return clean;
  } catch (error) { if (/模型/.test(error.message)) throw error; throw new Error('模型服务返回格式无效。'); }
}

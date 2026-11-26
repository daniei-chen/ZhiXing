import assert from 'node:assert/strict';
import test from 'node:test';

import { modelLimits } from '../electron/model-catalog.mjs';

test('OpenAI 兼容的 context_length 与 max_output_tokens 被采纳', () => {
  assert.deepEqual(modelLimits({ context_length: 131072, max_output_tokens: 8192 }), { contextWindow: 131072, maxTokens: 8192 });
});

test('Anthropic 的 limit.context 与 limit.output 被采纳', () => {
  assert.deepEqual(modelLimits({ limit: { context: 200000, output: 64000 } }), { contextWindow: 200000, maxTokens: 64000 });
});

test('max_input_tokens 与 top_provider.max_completion_tokens 被采纳', () => {
  assert.deepEqual(modelLimits({ max_input_tokens: 65536, top_provider: { max_completion_tokens: 4096 } }), { contextWindow: 65536, maxTokens: 4096 });
});

test('字符串数字被接受，缺失时什么都不写', () => {
  assert.deepEqual(modelLimits({ context_length: '32768' }), { contextWindow: 32768 });
  assert.deepEqual(modelLimits({ id: 'only-id' }), {});
  assert.deepEqual(modelLimits(null), {});
});

test('越界与非法值一律不采信', () => {
  assert.deepEqual(modelLimits({ context_length: 4096 }), {}, '小于 8192 的窗口不可信');
  assert.deepEqual(modelLimits({ context_length: 4_000_000 }), {}, '超过 200 万的窗口不可信');
  assert.deepEqual(modelLimits({ context_length: 131072, max_output_tokens: 0 }), { contextWindow: 131072 }, '输出上限为 0 时忽略');
  assert.deepEqual(modelLimits({ context_length: 131072, max_output_tokens: 300000 }), { contextWindow: 131072 }, '输出上限超过 262144 时忽略');
});

test('输出上限必须小于窗口，否则只保留窗口', () => {
  assert.deepEqual(modelLimits({ context_length: 32768, max_output_tokens: 32768 }), { contextWindow: 32768 }, '相等会让压缩策略判定配置无效');
  assert.deepEqual(modelLimits({ context_length: 32768, max_output_tokens: 65536 }), { contextWindow: 32768 });
  assert.deepEqual(modelLimits({ max_output_tokens: 8192 }), {}, '窗口未知时不写输出上限');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { contextUsageText, contextWindowTokens, modelContextWindow } from '../src/context-window.js';

// 输入区那两个数字是产品承诺：型号换了，窗口就得跟着换，不能等到下一次请求回来才变。
const runtime = {
  providers: [
    { id: 'p1', name: '甲服务', contextWindow: 65536 },
    { id: 'p2', name: '乙服务', contextWindow: 262144 },
  ],
  models: [
    { id: 'qa-big', providerId: 'p1', contextWindow: 131072 },
    { id: 'qa-small', providerId: 'p1', contextWindow: 32768 },
    { id: 'qa-plain', providerId: 'p2' },
    { id: 'qa-small', providerId: 'p2', contextWindow: 8192 },
  ],
};

test('窗口优先取型号自己声明的值', () => {
  assert.equal(modelContextWindow(runtime, { modelProviderId: 'p1', model: 'qa-small' }), 32768);
  assert.equal(contextWindowTokens(runtime, { modelProviderId: 'p1', model: 'qa-big' }, 131072), 131072);
});

test('同名型号按供应商区分', () => {
  assert.equal(modelContextWindow(runtime, { modelProviderId: 'p2', model: 'qa-small' }), 8192);
});

test('型号没声明窗口时退回供应商声明', () => {
  assert.equal(modelContextWindow(runtime, { modelProviderId: 'p2', model: 'qa-plain' }), 262144);
});

test('运行时目录里没有该型号时退回上一次实测值', () => {
  assert.equal(contextWindowTokens(runtime, { modelProviderId: 'p9', model: 'qa-missing' }, 128000), 128000);
  assert.equal(contextWindowTokens({}, { model: 'qa-big' }, 65536), 65536);
});

test('全都不知道时用 128,000，不编造型号', () => {
  assert.equal(contextWindowTokens(null, null, null), 128000);
  assert.equal(contextWindowTokens(runtime, { model: '' }, undefined), 128000);
  assert.equal(modelContextWindow(runtime, { modelProviderId: 'p1', model: '' }), null);
});

test('用量文案统一成同一种排版', () => {
  assert.equal(contextUsageText(12792, 32768), '上下文 12,792 / 32,768 tokens');
  assert.equal(contextUsageText(0, 0), '上下文 0 / 128,000 tokens');
});

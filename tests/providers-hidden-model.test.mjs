import test from 'node:test';
import assert from 'node:assert/strict';

const { setModelHidden, publicProviders, providerModels } = await import('../electron/providers.mjs');

const provider = {
  id: 'p1', name: 'QA 供应商', protocol: 'openai', baseUrl: 'https://example.invalid/v1', key: 'sk-qa-000000000000',
  models: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
};

test('隐藏一个模型后，公开列表与模型清单都不再包含它', () => {
  const next = setModelHidden([provider], { providerId: 'p1', modelId: 'beta' });
  const [shown] = publicProviders(next);
  assert.deepEqual(shown.models.map(model => model.id), ['alpha']);
  assert.deepEqual(shown.hiddenModels, ['beta']);
  assert.deepEqual(providerModels(next).map(model => model.id), ['alpha']);
  // 原来的对象不被修改
  assert.deepEqual(provider.models.map(model => model.id), ['alpha', 'beta']);
  assert.equal(provider.hiddenModels, undefined);
});

test('恢复后模型回到列表，隐藏清单清空', () => {
  const hidden = setModelHidden([provider], { providerId: 'p1', modelId: 'beta' });
  const restored = setModelHidden(hidden, { providerId: 'p1', modelId: 'beta', hidden: false });
  const [shown] = publicProviders(restored);
  assert.deepEqual(shown.models.map(model => model.id), ['alpha', 'beta']);
  assert.deepEqual(shown.hiddenModels, []);
});

test('重复隐藏不会产生重复项', () => {
  const once = setModelHidden([provider], { providerId: 'p1', modelId: 'beta' });
  const twice = setModelHidden(once, { providerId: 'p1', modelId: 'beta' });
  assert.deepEqual(twice[0].hiddenModels, ['beta']);
});

test('未知供应商或未知模型都拒绝', () => {
  assert.throws(() => setModelHidden([provider], { providerId: 'nope', modelId: 'alpha' }), /供应商已移除/);
  assert.throws(() => setModelHidden([provider], { providerId: 'p1', modelId: 'nope' }), /不在当前目录/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

const { currentModel, reasoningChoices, reasoningState } = await import('../src/provider-reasoning.js');

const providers = [{
  id: 'p1', name: 'QA',
  models: [{ id: 'alpha', name: 'Alpha', levels: ['low', 'high', 'max'] }, { id: 'beta', name: 'Beta' }],
}];

test('按工作区设置找到当前模型', () => {
  const found = currentModel(providers, { modelProviderId: 'p1', model: 'alpha' });
  assert.equal(found.model.id, 'alpha');
  assert.equal(found.provider.id, 'p1');
  assert.equal(currentModel(providers, { modelProviderId: 'p9', model: 'alpha' }), null);
  assert.equal(currentModel(providers, { modelProviderId: 'p1', model: 'gone' }), null);
});

test('只给当前模型支持的档位，顺序按内核四档', () => {
  const choices = reasoningChoices(currentModel(providers, { modelProviderId: 'p1', model: 'alpha' }));
  assert.deepEqual(choices.map(level => level.id), ['low', 'high', 'max']);
});

test('没有档位信息时不猜，给出刷新提示', () => {
  const state = reasoningState({ current: currentModel(providers, { modelProviderId: 'p1', model: 'beta' }), settings: { reasoning: 'high' } });
  assert.deepEqual(state.choices, []);
  assert.equal(state.selected, null);
  assert.match(state.problem, /尚未确认/);
});

test('当前档位不受支持时明确提示，而不是静默保留', () => {
  const state = reasoningState({ current: currentModel(providers, { modelProviderId: 'p1', model: 'alpha' }), settings: { reasoning: 'off' } });
  assert.equal(state.selected, null);
  assert.match(state.problem, /不受这个模型支持/);
});

test('正常情况没有提示，选中项就是设置里的档位', () => {
  const state = reasoningState({ current: currentModel(providers, { modelProviderId: 'p1', model: 'alpha' }), settings: { reasoning: 'high' } });
  assert.equal(state.problem, null);
  assert.equal(state.selected.label, '高');
});

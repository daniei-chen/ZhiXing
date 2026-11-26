import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

// Execute real component callbacks with synthetic IPC; DOM/layout is outside this layer.
const entry = fileURLToPath(new URL('../src/ProviderSettings.jsx', import.meta.url));
const source = await readFile(entry, 'utf8');
const icons = source.match(/import\s*\{([^}]+)\}\s*from\s*'@phosphor-icons\/react'/)[1].split(',').map(name => name.trim());
const compiled = await build({
  entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
  jsx: 'transform', jsxFactory: '__element', jsxFragment: '__fragment', logLevel: 'silent',
  banner: {js: 'const __element=globalThis.__element, __fragment="Fragment";'},
  plugins: [{name: 'provider-callbacks', setup(builder) {
    builder.onResolve({filter: /^(react|@phosphor-icons\/react)$/}, args => ({path: args.path, namespace: 'provider-test'}));
    builder.onLoad({filter: /.*/, namespace: 'provider-test'}, args => ({contents: args.path === 'react'
      ? 'export const useState=(...args)=>globalThis.__state(...args);'
      : icons.map(name => `export const ${name}=()=>null;`).join('\n')}));
  }}],
});

test('供应商全部模型已隐藏时仍可批量恢复，单次IPC完成且更新目录', async () => {
  const models = ['model-a', 'model-b', 'model-c'].map(id => ({id, name: '同名模型'}));
  const provider = {id: 'provider', name: '合成供应商', protocol: 'openai', baseUrl: 'https://fixture.invalid', models: [], hiddenModels: models.map(model => model.id), configured: true};
  let runtime = {providers: [provider], models: []}, release, index = 0, tree;
  const slots = [], calls = [];
  const sandbox = {
    module: {exports: {}},
    __state(initial) {
      const position = index++;
      if (!(position in slots)) slots[position] = initial;
      return [slots[position], value => { slots[position] = typeof value === 'function' ? value(slots[position]) : value; }];
    },
    __element: (type, props, ...children) => ({type, props: {...props, children}}),
  };
  vm.runInNewContext(compiled.outputFiles[0].text, sandbox);
  const props = {
    desktop: {
      restoreProviderModels(id) {
        calls.push(id);
        return new Promise(resolve => { release = resolve; });
      },
      hideProviderModel() { assert.fail('Restore must not issue per-model hide/unhide calls.'); },
    },
    settings: {}, setRuntime(next) { runtime = next; },
  };
  const render = () => { index = 0; tree = sandbox.module.exports.ProviderSettings({...props, runtime}); };
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : [];
  const text = value => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const restoreButton = () => nodes(tree).find(node => node.type === 'button' && text(node) === '恢复全部');
  render();
  nodes(tree).find(node => node.props.className === 'provider-row').props.onClick();
  render();
  assert(restoreButton(), 'All hidden models must leave the restore entry visible.');
  assert.equal(restoreButton().props.disabled, false);
  const restoring = restoreButton().props.onClick();
  render();
  assert.equal(restoreButton().props.disabled, true);
  assert.deepEqual(calls, ['provider']);
  release({providers: [{...provider, models, hiddenModels: []}], models: []});
  await restoring;
  render();
  assert.equal(restoreButton(), undefined);
  assert(text(tree).includes('已恢复全部模型'));
  for (const model of models) assert(text(tree).includes(model.id));
  assert.deepEqual(calls, ['provider']);
});

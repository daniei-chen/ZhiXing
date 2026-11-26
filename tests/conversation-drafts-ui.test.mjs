import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
import {mergeState} from '../src/store.js';

// No browser/Electron process: execute the real App render and callbacks with a
// small hook scheduler. Child components and DOM/layout are outside this layer.
const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const visualImports = new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+\.jsx|@phosphor-icons\/react)['"]/g)]
  .map(([, names, name]) => [name, names.split(',').map(value => value.trim())]));
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/App.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'transform',
  jsxFactory: '__element', jsxFragment: '__fragment', logLevel: 'silent',
  banner: {js: 'const __element=globalThis.__element, __fragment="Fragment";'},
  plugins: [{name: 'headless-app-hooks', setup(builder) {
    builder.onResolve({filter: /^(react|@phosphor-icons\/react)$|\.jsx$/}, args => {
      if (args.path === 'react' || visualImports.has(args.path)) return {path: args.path, namespace: 'draft-test'};
    });
    builder.onLoad({filter: /.*/, namespace: 'draft-test'}, args => ({contents: args.path === 'react'
      ? ['useState', 'useRef', 'useEffect', 'useLayoutEffect'].map(name => `export const ${name}=(...args)=>globalThis.__hooks.${name}(...args);`).join('\n')
      : visualImports.get(args.path).map(name => `export const ${name}=Object.assign(()=>null,{displayName:${JSON.stringify(name)}});`).join('\n')}));
  }}],
});

const file = id => ({id, name: `${id}.txt`, status: 'ready', text: `${id}_BODY`});
function fixture() {
  const state = mergeState(null);
  state.settings = {...state.settings, modelProviderId: 'test-provider', model: 'test-model'};
  return state;
}
async function mount(saved = fixture(), overrides = {}) {
  const slots = [], effects = [], listeners = new Map(), snapshots = [];
  let index = 0, dirty = true, tree, stored = structuredClone(saved), pendingRun, pendingPrepare;
  const hooks = {
    useState(initial) {
      const position = index++;
      if (!slots[position]) slots[position] = {value: typeof initial === 'function' ? initial() : initial};
      return [slots[position].value, value => {
        const next = typeof value === 'function' ? value(slots[position].value) : value;
        if (!Object.is(next, slots[position].value)) { slots[position].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const position = index++; return slots[position] ||= {current: initial}; },
    useEffect(callback, dependencies) {
      const position = index++, previous = slots[position];
      if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) {
        slots[position] = {dependencies, cleanup: previous?.cleanup};
        effects.push(() => { slots[position].cleanup?.(); slots[position].cleanup = callback(); });
      }
    },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const desktop = {
    loadWorkspace: async () => structuredClone(stored),
    saveWorkspace: async value => { stored = structuredClone(value); snapshots.push(stored); },
    runtimeStatus: async () => ({configured: true, providers: [{id: 'test-provider', baseUrl: 'https://fixture.invalid'}], models: [{id: 'test-model', providerId: 'test-provider', levels: ['high'], reasoningCapability: 'supported'}]}),
    listAutomations: async () => ({revision: 0, tasks: [], runs: []}),
    prepareRun: async () => overrides.deferPrepare ? new Promise(resolve => { pendingPrepare = resolve; }) : ({preparationId: 'prepared', privacyMode: 'redact'}),
    runPrepared: () => new Promise((resolve, reject) => { pendingRun = {resolve, reject}; }),
    forgetSession: async () => ({forgotten: true}),
    ...overrides,
  };
  for (const name of ['RuntimeEvent', 'AutomationChange', 'WorkspaceSaveState', 'PrepareToQuit']) desktop[`on${name}`] = callback => { listeners.set(name, callback); return () => listeners.delete(name); };
  const sandbox = {
    module: {exports: {}}, console, structuredClone, crypto: webcrypto, innerWidth: 1200,
    window: {zhixing: desktop, addEventListener() {}, removeEventListener() {}},
    document: {addEventListener() {}, removeEventListener() {}, querySelector: () => null},
    matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
    requestAnimationFrame: callback => callback(), setTimeout: () => 1, clearTimeout() {},
    __hooks: hooks, __element: (type, props, ...children) => ({type, props: {...props, children}}),
  };
  vm.runInNewContext(compiled.outputFiles[0].text, sandbox, {filename: 'App.headless.cjs'});
  async function flush() {
    for (let turn = 0; turn < 40; turn++) {
      if (dirty) { dirty = false; index = 0; tree = sandbox.module.exports.App(); }
      effects.splice(0).forEach(effect => effect());
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !effects.length) return;
    }
    throw new Error('App hook scheduler did not settle');
  }
  function nodes(value) {
    if (!arguments.length) value = tree;
    if (Array.isArray(value)) return value.flatMap(child => nodes(child));
    return value && typeof value === 'object' && value.props ? [value, ...nodes(value.props.children ?? [])] : [];
  }
  function component(name) { return nodes().find(node => node.type.displayName === name)?.props; }
  const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  function button(label) {
    const found = nodes().find(node => node.type === 'button' && text(node) === label);
    assert(found, `Missing button: ${label}`);
    return found;
  }
  await flush();
  return {flush, nodes, component, button, text, snapshots, get stored() { return stored; }, get pendingRun() { return pendingRun; }, get pendingPrepare() { return pendingPrepare; }};
}

async function openDraft(app, marker) {
  app.button('查看草稿').props.onClick(); await app.flush();
  const row = app.nodes().find(node => node.props['data-draft-key'] && app.text(node).includes(marker));
  assert(row, `Missing draft row: ${marker}`);
  const action = app.nodes(row).find(node => node.type === 'button');
  action.props.onClick(); await app.flush();
  return action.props.onClick;
}

test('连续新建三份未发送草稿均有可见入口，切回保留正文附件与较新编辑', async () => {
  const app = await mount();
  for (const [text, attachment] of [['FIRST_DRAFT', 'first'], ['SECOND_DRAFT', 'second'], ['THIRD_DRAFT', 'third']]) {
    app.component('Composer').setInput(text);
    app.component('Composer').setFiles([file(attachment)]);
    await app.flush();
    app.component('Sidebar').newChat();
    await app.flush();
  }
  assert.equal(Object.values(app.stored.drafts).filter(draft => draft.text).length, 3);
  app.button('查看草稿').props.onClick(); await app.flush();
  assert.equal(app.nodes().filter(node => node.props['data-draft-key']).length, 3);
  app.component('Modal').onClose(); await app.flush();
  await openDraft(app, 'FIRST_DRAFT');
  assert.equal(app.component('Composer').input, 'FIRST_DRAFT');
  assert.equal(app.component('Composer').files[0].id, 'first');
  app.component('Composer').setInput('FIRST_NEWER_EDIT'); await app.flush();
  await openDraft(app, 'SECOND_DRAFT');
  assert.equal(app.component('Composer').input, 'SECOND_DRAFT');
  await openDraft(app, 'FIRST_NEWER_EDIT');
  assert.equal(app.component('Composer').input, 'FIRST_NEWER_EDIT');
  assert.equal(Object.values(app.stored.drafts).filter(draft => draft.text).length, 3);
  const topbar = app.nodes().find(node => node.props.className === 'top-actions');
  assert.deepEqual(app.nodes(topbar).filter(node => node.type.displayName === 'IconButton').map(node => node.props.label), ['会话操作', '查看当前对话产出与来源', '打开工作面板']);
});

test('新草稿首次发送失败后归属实际聊天，原地可见，删除聊天不会留下一份新草稿', async () => {
  const app = await mount();
  app.component('Composer').setInput('FAILED_NEW_BODY');
  app.component('Composer').setFiles([file('failed')]); await app.flush();
  const sending = app.component('Composer').onSubmit(); await app.flush();
  assert(app.pendingRun);
  app.pendingRun.reject(new Error('synthetic failure')); await sending; await app.flush();
  assert.equal(app.component('Composer').input, 'FAILED_NEW_BODY');
  const chat = app.stored.chats[0];
  assert.equal(app.stored.drafts[`chat:${chat.id}`].text, 'FAILED_NEW_BODY');
  app.component('Sidebar').openModal({type: 'delete-chat', id: chat.id}); await app.flush();
  await app.component('Dialogs').removeItem({type: 'delete-chat', id: chat.id}); await app.flush();
  assert.doesNotMatch(JSON.stringify(app.stored.drafts), /FAILED_NEW_BODY|failed_BODY/);
});

test('真实JSON文件重载后每份草稿可打开，空间/项目及附件原归属不变，旧键不复制', async () => {
  const saved = fixture();
  saved.workspaces.push({id: 'legacy-office', name: '旧办公空间', type: 'office'});
  saved.projects.push({id: 'legacy-project', name: '原项目', workspaceId: 'legacy-office'});
  for (const [key, workspaceId, projectId, updatedAt] of [['legacy-first', 'legacy-office', 'legacy-project', 1], ['new:office-home:home:second', 'office-home', null, 2]]) {
    saved.drafts[key] = {kind: 'new', draftId: key === 'legacy-first' ? 'first' : 'second', workspaceId, projectId, revision: 2, filesRevision: 1, text: key, files: [file(key)], updatedAt};
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zhixing-draft-reload-'));
  try {
    const filename = path.join(directory, 'workspace.json');
    await writeFile(filename, JSON.stringify(saved));
    const app = await mount(JSON.parse(await readFile(filename, 'utf8')));
    await openDraft(app, 'legacy-first');
    assert.equal(app.component('Composer').input, 'legacy-first');
    assert.equal(app.component('Sidebar').workspace.id, 'legacy-office');
    assert.equal(app.component('Sidebar').activeProject.id, 'legacy-project');
    app.component('Composer').setInput('legacy edited'); await app.flush();
    assert.equal(app.stored.drafts['legacy-first'].text, 'legacy edited');
    assert.equal(Object.keys(app.stored.drafts).length, 2);
    app.component('Sidebar').changeWorkspace('government-home'); await app.flush();
    assert(!app.nodes().some(node => node.props.className === 'running-return unsent-drafts'));
    app.component('Sidebar').changeWorkspace('office-home'); await app.flush();
    await openDraft(app, 'legacy edited');
    assert.equal(app.component('Composer').files[0].id, 'legacy-first');
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('发送失败期间在当前聊天新输入或编辑后清空，旧草稿不能覆盖', async () => {
  for (const erase of [false, true]) {
    const app = await mount();
    app.component('Composer').setInput('SUBMITTED_BODY'); await app.flush();
    const sending = app.component('Composer').onSubmit(); await app.flush();
    app.component('Composer').setInput('NEWER_BODY'); await app.flush();
    if (erase) { app.component('Composer').setInput(''); await app.flush(); }
    app.pendingRun.reject(new Error('synthetic failure')); await sending; await app.flush();
    assert.equal(app.component('Composer').input, erase ? '' : 'NEWER_BODY');
    assert.doesNotMatch(JSON.stringify(app.stored.drafts), /SUBMITTED_BODY/);
  }
});

test('prepareRun期间的新编辑保留在原草稿，失败不能搬走或清空它', async () => {
  const app = await mount(fixture(), {deferPrepare: true});
  app.component('Composer').setInput('SUBMITTED_BODY'); await app.flush();
  const sending = app.component('Composer').onSubmit(); await app.flush();
  app.component('Composer').setInput('EDIT_DURING_PREPARE'); await app.flush();
  app.pendingPrepare({preparationId: 'prepared', privacyMode: 'redact'}); await app.flush();
  app.pendingRun.reject(new Error('synthetic failure')); await sending; await app.flush();
  await openDraft(app, 'EDIT_DURING_PREPARE');
  assert.equal(app.component('Composer').input, 'EDIT_DURING_PREPARE');
});

test('已打开列表中的旧回调在项目删除后不复活草稿，其他项目和较新编辑保留', async () => {
  const app = await mount();
  app.component('Sidebar').newChat('office-general'); await app.flush();
  app.component('Composer').setInput('DELETE_PROJECT_DRAFT'); await app.flush();
  const staleOpen = await openDraft(app, 'DELETE_PROJECT_DRAFT');
  app.component('Sidebar').newChat(); await app.flush();
  app.component('Composer').setInput('KEEP_NEWER_BODY'); await app.flush();
  app.component('Sidebar').openModal({type: 'delete-project', id: 'office-general'}); await app.flush();
  await app.component('Dialogs').removeItem({type: 'delete-project', id: 'office-general'}); await app.flush();
  staleOpen(); await app.flush();
  assert.equal(app.component('Composer').input, 'KEEP_NEWER_BODY');
  assert.doesNotMatch(JSON.stringify(app.stored), /DELETE_PROJECT_DRAFT/);
  app.button('查看草稿').props.onClick(); await app.flush();
  assert.equal(app.nodes().filter(node => node.props['data-draft-key']).length, 1);
});

test('空项目草稿尚在读取附件时删除项目，迟到解析结果不能恢复已删除草稿', async () => {
  let finishPick;
  const app = await mount(fixture(), {pickFiles: () => new Promise(resolve => { finishPick = resolve; })});
  app.component('Sidebar').newChat('office-general'); await app.flush();
  const picking = app.component('Composer').chooseFiles(); await app.flush();
  app.component('Sidebar').openModal({type: 'delete-project', id: 'office-general'}); await app.flush();
  await app.component('Dialogs').removeItem({type: 'delete-project', id: 'office-general'}); await app.flush();
  finishPick([file('DELETED_LATE_ATTACHMENT')]); await picking; await app.flush();
  assert.doesNotMatch(JSON.stringify(app.stored), /DELETED_LATE_ATTACHMENT/);
});

test('关闭持久保存时新草稿仍可在本轮切回，发送到主机的快照无草稿，重载不恢复', async () => {
  const saved = fixture(); saved.settings.persist = false;
  const app = await mount(saved);
  app.component('Composer').setInput('MEMORY_ONLY_BODY'); await app.flush();
  app.component('Sidebar').newChat(); await app.flush();
  await openDraft(app, 'MEMORY_ONLY_BODY');
  assert.equal(app.component('Composer').input, 'MEMORY_ONLY_BODY');
  assert(app.snapshots.every(snapshot => !Object.keys(snapshot.drafts).length));
  const reloaded = await mount(app.stored);
  assert.equal(reloaded.component('Composer').input, '');
  assert(!reloaded.nodes().some(node => node.props.className === 'running-return unsent-drafts'));
});

test('助手正文先于改动与交付卡片，工具摘要和操作栏各在对应一侧', async () => {
  const saved = fixture();
  saved.chats = [{
    id: 'completed-chat', workspaceId: saved.workspaceId, title: '有实际交付的会话',
    messages: [{
      id: 'completed-reply', role: 'assistant', text: '正文说明', status: 'succeeded',
      trace: [{type: 'tool/call', category: 'tools', callId: 'write-1', label: '调用 · 写入项目文本', status: 'running'}],
      changes: [{path: '交付/说明.txt', added: 1, removed: 0}],
      deliverables: [{path: '交付/说明.txt'}],
    }],
  }];
  const app = await mount(saved);
  app.component('Sidebar').openChat('completed-chat');
  await app.flush();
  const content = app.nodes().find(node => node.props.className === 'assistant-content');
  assert(content);
  const visible = app.nodes(content);
  const position = name => visible.findIndex(node => node.type.displayName === name || node.props.className === name);
  const order = ['tool-strip', 'AnswerText', 'ChangedFiles', 'DeliveryCards', 'answer-actions'].map(position);
  assert(order.every(index => index >= 0));
  assert(order.every((index, offset) => offset === 0 || index > order[offset - 1]));
  assert(app.nodes().some(node => node.type.displayName === 'BrandMark' && node.props.className === 'assistant-icon'));
});

test('反馈超过备注上限后仍能清除，只禁止保存超限内容', async () => {
  const saved = fixture();
  saved.chats = [{
    id: 'feedback-chat', workspaceId: saved.workspaceId, title: '反馈会话',
    messages: [{id: 'feedback-reply', role: 'assistant', text: '可以反馈的回复', status: 'succeeded'}],
  }];
  const cleared = [];
  const app = await mount(saved, {clearFeedback: async value => { cleared.push(value); }});
  app.component('Sidebar').openChat('feedback-chat');
  await app.flush();
  const open = app.nodes().find(node => node.type.displayName === 'IconButton' && node.props.label === '赞这条回复');
  open.props.onClick();
  await app.flush();
  const note = app.nodes().find(node => node.type === 'textarea' && node.props['aria-label'] === '反馈备注');
  note.props.onChange({target: {value: '中'.repeat(2800)}});
  await app.flush();
  assert.equal(app.button('保存反馈').props.disabled, true);
  assert.notEqual(app.button('清除').props.disabled, true);
  app.button('清除').props.onClick();
  await app.flush();
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].conversationId, 'feedback-chat');
  assert.equal(cleared[0].messageId, 'feedback-reply');
  assert(!app.nodes().some(node => node.props.className === 'feedback-panel'));
});

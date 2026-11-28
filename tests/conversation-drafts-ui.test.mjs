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
import {WorkspacePersistence} from '../electron/workspace-persistence.mjs';
import {RuntimeHandoffs} from '../electron/runtime-handoffs.mjs';

// No browser/Electron process: execute the real App render and callbacks with a
// small hook scheduler. Child components and DOM/layout are outside this layer.
const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const visualImports = new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+\.jsx|@phosphor-icons\/react)['"]/g)]
  .map(([, names, name]) => [name, names.split(',').map(value => value.trim())]));
const compiled = await build({
  stdin: {
    contents: "export { App } from './src/App.jsx'; export { flushRendererDurability } from './src/renderer-durability.js'; export { bindRuntimeApprovals } from './src/runtime-approvals.js';",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), sourcefile: 'draft-test-entry.mjs', loader: 'js',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'transform',
  jsxFactory: '__element', jsxFragment: '__fragment', logLevel: 'silent',
  banner: {js: 'const __element=globalThis.__element, __fragment="Fragment";'},
  plugins: [{name: 'headless-app-hooks', setup(builder) {
    builder.onResolve({filter: /^(react|@phosphor-icons\/react)$|\.jsx$/}, args => {
      if (args.path === 'react' || visualImports.has(args.path)) return {path: args.path, namespace: 'draft-test'};
    });
    builder.onLoad({filter: /.*/, namespace: 'draft-test'}, args => ({contents: args.path === 'react'
      ? ['useState', 'useRef', 'useEffect', 'useLayoutEffect', 'useSyncExternalStore'].map(name => `export const ${name}=(...args)=>globalThis.__hooks.${name}(...args);`).join('\n')
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
  const slots = [], effects = [], listeners = new Map(), snapshots = [], draftSnapshots = [];
  const animationFrames = [];
  const timers = new Map();
  let now = 0, timerId = 0, renders = 0, mounted = true;
  let index = 0, dirty = true, tree, stored = structuredClone(saved), pendingRun, pendingPrepare;
  const hooks = {
    useState(initial) {
      const position = index++;
      if (!slots[position]) slots[position] = {value: typeof initial === 'function' ? initial() : initial};
      return [slots[position].value, value => {
        // React ignores updates from an already unmounted component. Keep
        // asynchronous host calls observable rather than accidentally remounting it.
        if (!mounted) return;
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
  hooks.useSyncExternalStore = (subscribe, getSnapshot) => {
    const [, setSnapshot] = hooks.useState(getSnapshot);
    hooks.useEffect(() => {
      const check = () => setSnapshot(getSnapshot());
      const unsubscribe = subscribe(check);
      check();
      return unsubscribe;
    }, [subscribe, getSnapshot]);
    return getSnapshot();
  };
  const desktop = {
    loadWorkspace: async () => structuredClone(stored),
    saveWorkspace: async value => { stored = structuredClone(value); snapshots.push(stored); },
    saveDrafts: async drafts => { stored = { ...stored, drafts: structuredClone(drafts) }; draftSnapshots.push(stored.drafts); },
    runtimeStatus: async () => ({configured: true, providers: [{id: 'test-provider', baseUrl: 'https://fixture.invalid'}], models: [{id: 'test-model', providerId: 'test-provider', levels: ['high'], reasoningCapability: 'supported'}]}),
    listAutomations: async () => ({revision: 0, tasks: [], runs: []}),
    prepareRun: async () => overrides.deferPrepare ? new Promise(resolve => { pendingPrepare = resolve; }) : ({preparationId: 'prepared', privacyMode: 'redact'}),
    runPrepared: () => new Promise((resolve, reject) => { pendingRun = {resolve, reject}; }),
    approvalSnapshot: async () => ({hostEpoch: 'fixture-host', revision: 0, pending: []}),
    answerApproval: async () => { throw new Error('No approval is pending in this fixture.'); },
    forgetSession: async () => ({forgotten: true}),
    ...overrides,
  };
  for (const name of ['RuntimeEvent', 'AutomationChange', 'WorkspaceSaveState', 'PrepareToQuit', 'ApprovalsChanged']) desktop[`on${name}`] = callback => { listeners.set(name, callback); return () => listeners.delete(name); };
  const sandbox = {
    module: {exports: {}}, console, structuredClone, crypto: webcrypto, innerWidth: 1200,
    window: {zhixing: desktop, addEventListener() {}, removeEventListener() {}},
    document: {addEventListener() {}, removeEventListener() {}, querySelector: () => null},
    matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
    requestAnimationFrame: callback => { animationFrames.push(callback); },
    setTimeout: (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    __hooks: hooks, __element: (type, props, ...children) => ({type, props: {...props, children}}),
  };
  vm.runInNewContext(compiled.outputFiles[0].text, sandbox, {filename: 'App.headless.cjs'});
  // The real entry point binds this outside App. Keep the live bridge when an
  // App subtree unmounts so the fixture exercises the real external-store hook.
  sandbox.module.exports.bindRuntimeApprovals(desktop);
  async function flush({ advance = 400 } = {}) {
    const deadline = now + advance;
    for (let turn = 0; turn < 80; turn++) {
      if (mounted && dirty) { dirty = false; index = 0; renders++; tree = sandbox.module.exports.App(); }
      effects.splice(0).forEach(effect => effect());
      await new Promise(resolve => setImmediate(resolve));
      if (animationFrames.length) {
        // One frame at a time lets React's scheduled render commit between the
        // real receiveHandoff function's two requestAnimationFrame barriers.
        const callbacks = animationFrames.splice(0);
        callbacks.forEach(callback => callback(now));
        continue;
      }
      if (!dirty && !effects.length) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= deadline).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) { now = deadline; return; }
        timers.delete(next[0]); now = next[1].at; next[1].callback();
      }
    }
    throw new Error('App hook scheduler did not settle');
  }
  function nodes(value) {
    if (!arguments.length) value = tree;
    if (Array.isArray(value)) return value.flatMap(child => nodes(child));
    return value && typeof value === 'object' && value.props ? [value, ...nodes(value.props.children ?? [])] : [];
  }
  function component(name) {
    const props = nodes().find(node => node.type.displayName === name)?.props;
    // This source-only harness stubs children. Expose the same keyed snapshot
    // passed to the real Composer; Electron renderer tests cover subscription.
    if (name === 'Composer' && props?.draftStore) {
      const draft = props.draftStore.get(props.draftKey);
      return { ...props, input: draft?.text ?? props.input, files: draft?.files ?? props.files };
    }
    return props;
  }
  const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  function button(label) {
    const found = nodes().find(node => node.type === 'button' && text(node) === label);
    assert(found, `Missing button: ${label}`);
    return found;
  }
  function unmount() {
    if (!mounted) return;
    mounted = false;
    dirty = false;
    tree = null;
    effects.length = 0;
    for (const slot of slots) {
      slot.cleanup?.();
      slot.cleanup = undefined;
    }
  }
  await flush();
  return {flush, unmount, flushDurability: options => sandbox.module.exports.flushRendererDurability(options), nodes, component, button, text, snapshots, draftSnapshots, listeners, get renders() { return renders; }, get stored() { return stored; }, get pendingRun() { return pendingRun; }, get pendingPrepare() { return pendingPrepare; }};
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

test('连续编辑同一草稿不重新渲染 App 或保存整库，空闲后只提交草稿', async () => {
  const app = await mount();
  app.component('Composer').setInput('开始');
  await app.flush();
  const before = { renders: app.renders, workspace: app.snapshots.length, drafts: app.draftSnapshots.length };
  for (let index = 0; index < 100; index++) {
    app.component('Composer').setInput(`开始${'字'.repeat(index + 1)}`);
    await app.flush({ advance: 0 });
  }
  assert.equal(app.renders, before.renders);
  assert.equal(app.snapshots.length, before.workspace);
  assert.equal(app.draftSnapshots.length, before.drafts);
  await app.flush();
  assert.equal(app.snapshots.length, before.workspace);
  assert.equal(app.draftSnapshots.length, before.drafts + 1);
  assert.equal(app.component('Composer').input, `开始${'字'.repeat(100)}`);
});

test('流式正文不重新渲染 App 或写入工作空间，结束后保存最终正文', async () => {
  const app = await mount();
  app.component('Composer').setInput('请输出多段正文');
  await app.flush();
  const sending = app.component('Composer').onSubmit();
  await app.flush();
  const reply = app.stored.chats[0].messages.at(-1);
  const before = { renders: app.renders, workspace: app.snapshots.length };
  for (let index = 0; index < 80; index++) {
    app.listeners.get('RuntimeEvent')({ type: 'draft', runId: reply.runId, text: `正在输出${'段'.repeat(index + 1)}` });
    await app.flush({ advance: 0 });
  }
  assert.equal(app.renders, before.renders);
  assert.equal(app.snapshots.length, before.workspace);
  const streaming = app.component('StreamingAnswer');
  assert.equal(streaming.store.get(reply.runId), `正在输出${'段'.repeat(80)}`);
  app.pendingRun.resolve({ text: '完整最终正文', masked: '完整最终正文' });
  await sending; await app.flush();
  assert.equal(app.stored.chats[0].messages.at(-1).text, '完整最终正文');
  assert.equal(app.stored.chats[0].messages.at(-1).pending, false);
});

function sharedPersistence(saved = fixture()) {
  let value = structuredClone(saved);
  const writes = [];
  return {
    get value() { return value; }, writes,
    desktop: {
      loadWorkspace: async () => structuredClone(value),
      saveWorkspace: async state => { value = structuredClone(state); writes.push('workspace'); },
      saveDrafts: async drafts => { value = { ...value, drafts: structuredClone(drafts) }; writes.push('drafts'); },
    },
  };
}

for (const status of ['completed', 'failed', 'cancelled']) {
  test(`全局恢复等待旧任务${status}完整交接，正文和交付物保存后才可重挂`, async () => {
    const host = sharedPersistence();
    const old = await mount(host.value, host.desktop);
    old.component('Composer').setInput('HANDOFF_TASK');
    await old.flush();
    const sending = old.component('Composer').onSubmit();
    await old.flush();
    assert(old.pendingRun);
    const chat = host.value.chats[0], reply = chat.messages.at(-1);
    const partial = `LOCAL_STREAM_${status}`;
    old.listeners.get('RuntimeEvent')({ type: 'draft', runId: reply.runId, text: partial });
    await old.flush({ advance: 0 });

    if (status === 'cancelled') {
      // This event releases active.current before the private run promise.
      // Its protected summary is not the complete local result to preserve.
      old.listeners.get('RuntimeEvent')({ type: 'run/terminal', runId: reply.runId, sessionId: chat.id, status: 'cancelled',
        finalization: { executionStatus: status, persistenceStatus: 'saved', processStatus: 'exited' },
        result: { text: 'PROTECTED_EVENT_SUMMARY', displayRedacted: true },
      });
      await old.flush({ advance: 0 });
    }

    old.unmount();
    await old.flush({ advance: 0 });
    const renders = old.renders, writes = host.writes.length;
    let restored = false;
    const restoring = old.flushDurability().then(() => { restored = true; });
    await old.flush({ advance: 10000 });
    assert.equal(restored, false, 'recovery must wait even after a terminal event clears active');
    assert.equal(host.writes.length, writes, 'the barrier must not commit a stale interrupted snapshot');

    const delivered = [{ id: `delivered-${status}`, name: '实际交付.txt', reference: 'LOCAL_DELIVERY_REFERENCE' }];
    const finalization = { executionStatus: status, persistenceStatus: 'saved', processStatus: 'exited', eventWatermark: 11 };
    const result = { ...(status === 'completed' ? { text: 'FULL_PRIVATE_RESULT', masked: 'PROTECTED_RESULT' } : {}), deliverables: delivered, finalization };
    if (status === 'completed') old.pendingRun.resolve(result);
    else old.pendingRun.reject(Object.assign(new Error(`synthetic ${status}`), { result, finalization }));
    await sending;
    await restoring;
    assert.equal(restored, true);
    assert.equal(old.renders, renders, 'handoff does not remount the disposed App');
    const expected = status === 'completed' ? 'FULL_PRIVATE_RESULT' : partial;
    const storedReply = host.value.chats[0].messages.at(-1);
    assert.equal(storedReply.text, expected);
    assert.equal(storedReply.pending, false);
    assert.equal(storedReply.status, status === 'completed' ? 'succeeded' : status);
    assert.deepEqual(structuredClone(storedReply.deliverables), delivered);
    assert.equal(storedReply.finalization.executionStatus, status);

    const current = await mount(host.value, host.desktop);
    const reloaded = current.stored.chats[0].messages.at(-1);
    assert.equal(reloaded.text, expected);
    assert.equal(reloaded.status, storedReply.status);
    assert.deepEqual(structuredClone(reloaded.deliverables), delivered);
    current.unmount();
  });
}

test('App卸载后的旧运行失败不能将恢复草稿写回新App的较新输入', async () => {
  const host = sharedPersistence();
  const old = await mount(host.value, host.desktop);
  old.component('Composer').setInput('OLD_FAILED_SUBMISSION');
  await old.flush();
  const sending = old.component('Composer').onSubmit();
  await old.flush();
  assert(old.pendingRun);
  const chatId = host.value.chats[0].id;
  old.unmount();
  await old.flush({ advance: 0 });
  const rendersAtUnmount = old.renders;

  const current = await mount(host.value, host.desktop);
  current.component('Sidebar').openChat(chatId);
  await current.flush();
  current.component('Composer').setInput('NEW_APP_DRAFT');
  current.component('Composer').setFiles([file('new-app-material')]);
  await current.flush();
  const durable = JSON.stringify(host.value), writes = host.writes.length;

  old.pendingRun.reject(new Error('synthetic late failure'));
  await sending;
  await old.flush({ advance: 10000 });
  assert.equal(old.renders, rendersAtUnmount);
  assert.equal(host.writes.length, writes, 'an unmounted producer must not issue another host save');
  assert.equal(JSON.stringify(host.value), durable);
  assert.equal(current.component('Composer').input, 'NEW_APP_DRAFT');
  assert.equal(host.value.drafts[`chat:${chatId}`].text, 'NEW_APP_DRAFT');
});

test('App卸载后的迟到附件不能覆盖新App的草稿和附件', async () => {
  const host = sharedPersistence();
  let finishPick;
  const old = await mount(host.value, { ...host.desktop, pickFiles: () => new Promise(resolve => { finishPick = resolve; }) });
  old.component('Composer').setInput('BEFORE_UNMOUNT');
  await old.flush();
  const picking = old.component('Composer').chooseFiles();
  await old.flush({ advance: 0 });
  assert.equal(typeof finishPick, 'function');
  old.unmount();
  await old.flush({ advance: 0 });

  const current = await mount(host.value, host.desktop);
  current.component('Composer').setInput('AFTER_REMOUNT');
  current.component('Composer').setFiles([file('current-attachment')]);
  await current.flush();
  const durable = JSON.stringify(host.value), writes = host.writes.length;
  finishPick([file('LATE_OLD_ATTACHMENT')]);
  await picking;
  await old.flush({ advance: 10000 });
  assert.equal(host.writes.length, writes);
  assert.equal(JSON.stringify(host.value), durable);
  assert.equal(current.component('Composer').input, 'AFTER_REMOUNT');
  assert.deepEqual(current.component('Composer').files.map(item => item.id), ['current-attachment']);
  assert.doesNotMatch(JSON.stringify(host.value), /LATE_OLD_ATTACHMENT/);
});

test('App卸载后迟到的prepare结果不得启动旧交办', async () => {
  const host = sharedPersistence();
  let starts = 0;
  const old = await mount(host.value, { ...host.desktop, deferPrepare: true, runPrepared: async () => { starts++; return {text: 'must not run'}; } });
  old.component('Composer').setInput('OLD_PREPARED_SUBMISSION');
  await old.flush();
  const sending = old.component('Composer').onSubmit();
  await old.flush({ advance: 0 });
  assert.equal(typeof old.pendingPrepare, 'function');
  old.unmount();
  await old.flush({ advance: 0 });
  const current = await mount(host.value, host.desktop);
  current.component('Composer').setInput('CURRENT_UNSENT_DRAFT');
  await current.flush();
  const durable = JSON.stringify(host.value), writes = host.writes.length;
  old.pendingPrepare({preparationId: 'prepared', privacyMode: 'redact'});
  await sending;
  await old.flush({ advance: 10000 });
  assert.equal(starts, 0);
  assert.equal(host.writes.length, writes);
  assert.equal(JSON.stringify(host.value), durable);
});

for (const recoverWhileSaving of [false, true]) {
  test(`首轮绑定保存尚未完成时${recoverWhileSaving ? '全局恢复先撤销待启动run' : '卸载App撤销生产者'}，保存完成也不能启动内核`, async () => {
    const host = sharedPersistence();
    let releaseWrite, blockedReply, starts = 0;
    const heldWrite = new Promise(resolve => { releaseWrite = resolve; });
    const cancellations = [];
    const old = await mount(host.value, {
      ...host.desktop,
      saveWorkspace: async value => {
        const pending = value.chats.flatMap(chat => chat.messages).find(message => message.pending);
        if (pending) { blockedReply ||= pending; await heldWrite; }
        await host.desktop.saveWorkspace(value);
      },
      beginRun: async () => { starts++; throw new Error('An unmounted App must not begin a new run.'); },
      cancelRun: async runId => { cancellations.push(runId); return {accepted: true}; },
    });
    old.component('Composer').setInput('SAVED_BEFORE_ENGINE_START');
    await old.flush();
    const sending = old.component('Composer').onSubmit();
    await old.flush({ advance: 0 });
    assert(blockedReply?.runId, 'the real startReply must be waiting for its persisted reply binding');
    assert.equal(starts, 0);
    old.unmount();
    await old.flush({ advance: 0 });
    const renders = old.renders;
    let restored = false, restoring;
    try {
      if (recoverWhileSaving) {
        restoring = old.flushDurability({reason: 'recovery'}).then(() => { restored = true; });
        await old.flush({ advance: 10000 });
        assert.deepEqual(cancellations, [blockedReply.runId]);
        assert.equal(restored, false, 'recovery still waits for the pending write and cancellation outcome');
      }
    } finally {
      releaseWrite();
      await sending;
      if (restoring) await restoring;
      else await old.flushDurability();
    }
    assert.equal(starts, 0, 'a delayed save must not launch a model while its UI is gone');
    assert.equal(old.renders, renders);
    const reply = host.value.chats[0].messages.at(-1);
    assert.equal(reply.runId, blockedReply.runId);
    assert.equal(reply.pending, false);
    assert.equal(reply.status, 'cancelled');
    assert.equal(host.value.chats[0].messages[0].text, 'SAVED_BEFORE_ENGINE_START');
    if (!recoverWhileSaving) assert.deepEqual(cancellations, []);
  });
}

function handoffPersistence(saved = fixture()) {
  let value = structuredClone(saved),
    failResultWrites = false,
    rejectAcknowledgement = false;
  const handoffs = new RuntimeHandoffs();
  const result = Promise.withResolvers();
  const calls = { begin: 0, wait: 0, retry: 0, acknowledgements: [], cancellations: [] };
  const persistence = new WorkspacePersistence({
    initialState: value,
    write: async ({ state }) => {
      if (
        failResultWrites &&
        state.chats.some((chat) => chat.messages.some((message) => message.resultReceiptId))
      ) {
        throw Object.assign(new Error('Synthetic result persistence failure'), { code: 'ENOSPC' });
      }
      value = structuredClone(state);
    },
  });
  return {
    get value() {
      return value;
    },
    handoffs,
    result,
    calls,
    failResultWrites(value) {
      failResultWrites = value;
    },
    rejectAcknowledgement(value) {
      rejectAcknowledgement = value;
    },
    desktop: {
      loadWorkspace: async () => {
        await persistence.flush();
        return structuredClone(value);
      },
      // An actual IPC transfer clones objects into the host realm before its
      // format checks. Keep the real persistence and receipt implementations.
      saveWorkspace: (state) => persistence.saveWorkspace(structuredClone(state)),
      saveDrafts: (drafts) => persistence.saveDrafts(structuredClone(drafts)),
      retryWorkspaceSave: async () => {
        calls.retry++;
        await persistence.retry();
      },
      runHandoffs: async () => handoffs.snapshot(),
      beginRun: async ({ runId, replyId }) => {
        calls.begin++;
        const chat = value.chats.find((chat) =>
          chat.messages.some((message) => message.id === replyId && message.runId === runId),
        );
        assert(chat, 'the host must receive a persisted reply binding before execution');
        return handoffs.start(
          { runId, replyId, sessionId: chat.id, workspaceId: chat.workspaceId, persist: true },
          () => result.promise,
        );
      },
      awaitRunHandoff: (identity) => {
        calls.wait++;
        return handoffs.wait(identity);
      },
      acknowledgeRunHandoff: async (identity) => {
        calls.acknowledgements.push(structuredClone(identity));
        if (rejectAcknowledgement) throw new Error('Synthetic acknowledgement failure');
        return handoffs.acknowledge(identity, (entry) =>
          value.chats.some(
            (chat) =>
              chat.id === entry.binding.sessionId &&
              chat.messages.some(
                (message) =>
                  message.id === entry.binding.replyId &&
                  message.runId === entry.binding.runId &&
                  message.resultReceiptId === entry.receiptId &&
                  !message.pending,
              ),
          ),
        );
      },
      cancelRun: async (runId) => {
        calls.cancellations.push(runId);
        return { accepted: true };
      },
    },
  };
}

for (const hasHostRetry of [true, false]) {
  test(`完整结果保存失败后${hasHostRetry ? '主机重试' : '直接保存兼容路径'}成功必须确认原receipt，ACK失败仍可重试`, async () => {
    const host = handoffPersistence();
    const app = await mount(host.value, {
      ...host.desktop,
      ...(hasHostRetry ? {} : { retryWorkspaceSave: undefined }),
    });
    app.component('Composer').setInput('RETRY_RESULT_RECEIPT');
    await app.flush();
    const sending = app.component('Composer').onSubmit();
    await app.flush();
    assert.equal(host.calls.begin, 1);
    const identity = host.handoffs.snapshot().runs[0];
    host.failResultWrites(true);
    host.result.resolve({
      text: 'COMPLETE_LOCAL_RESULT',
      masked: 'PROTECTED_RESULT',
      finalization: {
        executionStatus: 'completed',
        processStatus: 'exited',
        persistenceStatus: 'saved',
      },
    });
    await app.flush();
    await sending;
    assert.equal(host.handoffs.snapshot().runs.length, 1);
    assert.equal(host.calls.acknowledgements.length, 0, 'a failed save cannot release its receipt');
    app.button('重试保存');

    host.failResultWrites(false);
    host.rejectAcknowledgement(true);
    app.button('重试保存').props.onClick();
    await app.flush();
    const reply = host.value.chats[0].messages.at(-1);
    assert.equal(reply.text, 'COMPLETE_LOCAL_RESULT');
    assert.equal(reply.pending, false);
    assert.equal(reply.status, 'succeeded');
    assert.equal(typeof reply.resultReceiptId, 'string');
    assert.equal(
      host.calls.acknowledgements.length,
      1,
      'successful retry must attempt the original receipt acknowledgement',
    );
    assert.equal(host.calls.acknowledgements[0].runId, identity.runId);
    assert.equal(host.calls.acknowledgements[0].receiptId, reply.resultReceiptId);
    assert.equal(host.handoffs.snapshot().runs.length, 1);
    app.button('重试保存');

    host.rejectAcknowledgement(false);
    app.button('重试保存').props.onClick();
    await app.flush();
    assert.equal(host.calls.acknowledgements.length, 2);
    assert.deepEqual(host.calls.acknowledgements[1], host.calls.acknowledgements[0]);
    assert.equal(host.handoffs.snapshot().runs.length, 0);
    assert.equal(host.calls.begin, 1, 'save/ACK retry must not execute the run again');
    assert.equal(host.calls.wait, 1);
    assert.equal(host.calls.retry, hasHostRetry ? 2 : 0);
    app.unmount();
  });
}

test('正常退出屏障撤销仍被首次保存阻塞的run，保存最后草稿且不晚启动内核', async () => {
  const host = sharedPersistence();
  const heldWrite = Promise.withResolvers();
  let blockedReply,
    starts = 0;
  const cancellations = [];
  const app = await mount(host.value, {
    ...host.desktop,
    saveWorkspace: async (value) => {
      const reply = value.chats.flatMap((chat) => chat.messages).find((message) => message.pending);
      if (reply) {
        blockedReply ||= reply;
        await heldWrite.promise;
      }
      await host.desktop.saveWorkspace(value);
    },
    beginRun: async () => {
      starts++;
      throw new Error('The quit barrier must prevent a late begin.');
    },
    cancelRun: async (runId) => {
      cancellations.push(runId);
      return { accepted: true };
    },
  });
  app.component('Composer').setInput('QUIT_BEFORE_BEGIN');
  await app.flush();
  const sending = app.component('Composer').onSubmit();
  await app.flush({ advance: 0 });
  assert(blockedReply?.runId);
  app.component('Composer').setInput('LAST_UNSENT_DRAFT');
  await app.flush({ advance: 0 });
  let savedForQuit = false;
  const closing = app.flushDurability({ reason: 'quit' }).then(() => {
    savedForQuit = true;
  });
  try {
    await app.flush({ advance: 10000 });
    assert.deepEqual(cancellations, [blockedReply.runId]);
    assert.equal(savedForQuit, false, 'quit must still wait for the delayed binding save');
  } finally {
    heldWrite.resolve();
    await app.flush();
    await sending;
    await closing;
  }
  assert.equal(starts, 0);
  const chat = host.value.chats[0],
    reply = chat.messages.at(-1);
  assert.equal(reply.runId, blockedReply.runId);
  assert.equal(reply.status, 'cancelled');
  assert.equal(reply.pending, false);
  assert.equal(chat.messages[0].text, 'QUIT_BEFORE_BEGIN');
  assert.equal(host.value.drafts[`chat:${chat.id}`].text, 'LAST_UNSENT_DRAFT');
  app.unmount();
});

test('正常退出屏障等待已交给主机的完整结果，不重复取消或用摘要覆盖正文', async () => {
  const host = handoffPersistence();
  const app = await mount(host.value, host.desktop);
  app.component('Composer').setInput('QUIT_AFTER_BEGIN');
  await app.flush();
  const sending = app.component('Composer').onSubmit();
  await app.flush();
  assert.equal(host.calls.begin, 1);
  let savedForQuit = false;
  const closing = app.flushDurability({ reason: 'quit' }).then(() => {
    savedForQuit = true;
  });
  await app.flush();
  assert.equal(savedForQuit, false);
  assert.deepEqual(host.calls.cancellations, []);
  host.result.resolve({
    text: 'FINAL_PRIVATE_RESULT_AT_QUIT',
    masked: 'PROTECTED_SUMMARY',
    finalization: {
      executionStatus: 'completed',
      processStatus: 'exited',
      persistenceStatus: 'saved',
    },
  });
  await app.flush();
  await sending;
  await closing;
  assert.equal(savedForQuit, true);
  assert.equal(host.value.chats[0].messages.at(-1).text, 'FINAL_PRIVATE_RESULT_AT_QUIT');
  assert.equal(host.value.chats[0].messages.at(-1).status, 'succeeded');
  assert.equal(host.handoffs.snapshot().runs.length, 0);
  assert.equal(host.calls.begin, 1);
  assert.deepEqual(host.calls.cancellations, []);
  app.unmount();
});

test('同宿主重载首次读取失败后重试保留活跃回复，接回完整结果且不重跑', async () => {
  const saved = fixture();
  saved.chats = [
    {
      id: 'live-chat',
      workspaceId: saved.workspaceId,
      projectId: null,
      title: '仍在交办',
      messages: [
        { id: 'user-live', role: 'user', text: 'READ_RETRY_TASK' },
        { id: 'reply-live', runId: 'run-live', role: 'assistant', text: '', pending: true },
      ],
    },
  ];
  saved.drafts = {
    'chat:live-chat': {
      kind: 'chat',
      chatId: 'live-chat',
      workspaceId: saved.workspaceId,
      text: 'PRESERVED_RELOAD_DRAFT',
      files: [file('read-retry-material')],
      revision: 1,
    },
  };
  const host = handoffPersistence(saved);
  const identity = host.handoffs.start(
    {
      runId: 'run-live',
      sessionId: 'live-chat',
      replyId: 'reply-live',
      workspaceId: saved.workspaceId,
      persist: true,
    },
    () => host.result.promise,
  );
  let reads = 0;
  const app = await mount(saved, {
    ...host.desktop,
    loadWorkspace: async () => {
      reads++;
      if (reads === 1) throw new Error('Synthetic transient read failure');
      return host.desktop.loadWorkspace();
    },
  });
  app.button('重试读取').props.onClick();
  await app.flush();
  const liveReply = host.value.chats[0].messages.at(-1);
  assert.equal(
    liveReply.pending,
    true,
    'a still-registered handoff must not be persisted as interrupted',
  );
  assert.notEqual(liveReply.status, 'interrupted');
  assert.equal(host.calls.wait, 1, 'read retry must reconnect the original host execution');
  assert.equal(app.component('Composer').input, 'PRESERVED_RELOAD_DRAFT');
  assert.equal(app.component('Composer').files[0].id, 'read-retry-material');
  host.result.resolve({
    text: 'READ_RETRY_FULL_RESULT',
    masked: 'PROTECTED',
    finalization: {
      executionStatus: 'completed',
      processStatus: 'exited',
      persistenceStatus: 'saved',
    },
  });
  await app.flush();
  const finalReply = host.value.chats[0].messages.at(-1);
  assert.equal(finalReply.text, 'READ_RETRY_FULL_RESULT');
  assert.equal(finalReply.status, 'succeeded');
  assert.equal(finalReply.runId, identity.runId);
  assert.equal(finalReply.pending, false);
  assert.equal(host.handoffs.snapshot().runs.length, 0);
  assert.equal(host.calls.begin, 0, 'reconnecting a running task must not begin another execution');
  assert.equal(host.calls.acknowledgements.length, 1);
  assert.equal(host.value.drafts['chat:live-chat'].text, 'PRESERVED_RELOAD_DRAFT');
  app.unmount();
});

test('读取重试期间App已卸载，迟到快照不再接回旧App或覆盖新草稿', async () => {
  const saved = fixture();
  saved.chats = [
    {
      id: 'late-read-chat',
      workspaceId: saved.workspaceId,
      projectId: null,
      title: '读取仍在交办',
      messages: [
        { id: 'late-read-user', role: 'user', text: 'LATE_READ_TASK' },
        {
          id: 'late-read-reply',
          runId: 'late-read-run',
          role: 'assistant',
          text: '',
          pending: true,
        },
      ],
    },
  ];
  const host = handoffPersistence(saved);
  host.handoffs.start(
    {
      runId: 'late-read-run',
      sessionId: 'late-read-chat',
      replyId: 'late-read-reply',
      workspaceId: saved.workspaceId,
      persist: true,
    },
    () => host.result.promise,
  );
  const delayedRead = Promise.withResolvers();
  let reads = 0;
  const old = await mount(saved, {
    ...host.desktop,
    loadWorkspace: async () => {
      if (++reads === 1) throw new Error('Synthetic transient read failure');
      const snapshot = structuredClone(host.value);
      await delayedRead.promise;
      return snapshot;
    },
  });
  old.button('重试读取').props.onClick();
  await old.flush({ advance: 0 });
  assert.equal(reads, 2);
  old.unmount();
  await old.flushDurability({ reason: 'recovery' });
  const current = await mount(host.value, host.desktop);
  current.component('Composer').setInput('CURRENT_APP_NEW_DRAFT');
  await current.flush();
  assert.equal(host.calls.wait, 1);
  try {
    delayedRead.resolve();
    await old.flush();
    assert.equal(host.calls.wait, 1, 'a disposed reader must not attach another receipt observer');
  } finally {
    delayedRead.resolve();
    host.result.resolve({
      text: 'CURRENT_APP_FULL_RESULT',
      masked: 'PROTECTED',
      finalization: {
        executionStatus: 'completed',
        processStatus: 'exited',
        persistenceStatus: 'saved',
      },
    });
    await old.flush();
    await current.flush();
  }
  assert.equal(host.calls.begin, 0);
  assert.equal(host.handoffs.snapshot().runs.length, 0);
  assert.equal(host.value.chats[0].messages.at(-1).text, 'CURRENT_APP_FULL_RESULT');
  assert.equal(host.value.drafts['chat:late-read-chat'].text, 'CURRENT_APP_NEW_DRAFT');
  assert.equal(current.component('Composer').input, 'CURRENT_APP_NEW_DRAFT');
  current.unmount();
});

test('内核收尾连续失败后可放弃并释放，聊天里留下未交接的可读记录', async () => {
  const finalization = extra => ({runId: 'run-1', executionStatus: 'failed', persistenceStatus: 'saved', processStatus: 'cleanup_pending', eventWatermark: 3, error: {code: 'RUNTIME_CLOSE_FAILED', stage: 'close', message: '内核退出仍待确认。'}, ...extra});
  const saved = fixture();
  saved.chats = [{id: 'chat-a', title: '隔离会话', workspaceId: saved.workspaceId, projectId: null, messages: [
    {id: 'u1', role: 'user', text: '上一轮交办', files: []},
    {id: 'a1', role: 'assistant', text: '部分答复', status: 'failed', runId: 'run-1', finalization: finalization()},
  ]}];
  let abandonedCalls = 0, retries = 0;
  const app = await mount(saved, {
    runtimeCleanupStatus: async () => [{runId: 'run-1', sessionId: 'chat-a', attempts: 2, retryLimit: 3, canAbandon: false, finalization: finalization()}],
    retryRuntimeCleanup: async runId => { retries++; return {runId, sessionId: 'chat-a', status: 'cleanup_pending', attempts: 3, retryLimit: 3, canAbandon: true, finalization: finalization()}; },
    abandonRuntimeRun: async runId => { abandonedCalls++; return {runId, sessionId: 'chat-a', status: 'abandoned', finalization: finalization({executionStatus: 'abandoned', processStatus: 'abandoned', abandoned: {attempts: 3, at: 1, previousExecutionStatus: 'failed', resultDelivered: false}})}; },
  });
  const buttons = () => app.nodes().filter(node => node.type === 'button').map(node => app.text(node));
  const banner = () => app.nodes().find(node => node.props?.className === 'running-return runtime-cleanup-pending');
  app.component('Sidebar').openChat('chat-a'); await app.flush();
  assert(banner(), 'the quarantine banner must be visible');
  assert(app.text(banner()).includes('已重试 2/3 次'));
  assert(!buttons().includes('放弃并释放'), 'no escape before the retry budget is burned');
  app.button('重试清理').props.onClick(); await app.flush();
  assert.equal(retries, 1);
  assert(buttons().includes('放弃并释放'), 'the escape appears once every retry failed');
  assert(app.text(banner()).includes('放弃并释放会结束隔离，但这一轮的结果不会交接'));
  app.button('放弃并释放').props.onClick(); await app.flush();
  assert.equal(abandonedCalls, 1);
  assert.equal(banner(), undefined, 'the quarantine row is gone');
  const record = app.nodes().find(node => node.props?.['data-outcome'] === 'abandoned');
  assert(record, 'the chat keeps a readable record of the abandoned round');
  const note = app.text(record);
  assert(note.includes('结果没有交接，也不算完成'));
  assert(note.includes('3 次重试后仍未确认'));
  assert(note.includes('内核进程可能仍在后台运行并改写工作区文件'));
  assert(!note.includes('执行完成'), 'an abandoned round is never described as finished');
  await app.flush({advance: 5000});
  assert.equal(app.stored.chats[0].messages[1].finalization.processStatus, 'abandoned');
  assert.equal(app.stored.chats[0].messages[1].finalization.abandoned.resultDelivered, false);
  app.unmount();
});

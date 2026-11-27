import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {build} from 'file:///workspace/scratch/7464bebaff38/ZhiXing/node_modules/esbuild/lib/main.js';
import {mergeState} from 'file:///workspace/scratch/7464bebaff38/ZhiXing/src/store.js';
import {WorkspacePersistence} from 'file:///workspace/scratch/7464bebaff38/ZhiXing/electron/workspace-persistence.mjs';
import {RuntimeHandoffs} from 'file:///workspace/scratch/7464bebaff38/ZhiXing/electron/runtime-handoffs.mjs';

// No browser/Electron process: execute the real App render and callbacks with a
// small hook scheduler. Child components and DOM/layout are outside this layer.
let source = await readFile("/workspace/scratch/7464bebaff38/ZhiXing/src/App.jsx", 'utf8');
const observationAnchor = '  latest.current = state;';
assert.equal(source.split(observationAnchor).length, 2);
source = source.replace(observationAnchor, '  window.__qaConversationMemory = () => ({ question: question ?? null, questions });\n' + observationAnchor);
if (process.env.ZX_QUEUE_PROBE_MUTATION === 'omit-question-cleanup') {
 const target = '        setQuestions(previous => previous.filter(item => (item.rootSessionId || item.sessionId) !== id && !removedRuns.has(item.runId)));';
 assert.equal(source.split(target).length, 2);
 source = source.replace(target, '        // Intentional isolated probe mutation: leave question queue unchanged.');
}
const visualImports = new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+\.jsx|@phosphor-icons\/react)['"]/g)]
  .map(([, names, name]) => [name, names.split(',').map(value => value.trim())]));
const compiled = await build({
  stdin: {
    contents: "export { App } from './src/App.jsx'; export { flushRendererDurability } from './src/renderer-durability.js'; export { bindRuntimeApprovals } from './src/runtime-approvals.js';",
    resolveDir: "/workspace/scratch/7464bebaff38/ZhiXing", sourcefile: 'draft-test-entry.mjs', loader: 'js',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'transform',
  jsxFactory: '__element', jsxFragment: '__fragment', logLevel: 'silent',
  banner: {js: 'const __element=globalThis.__element, __fragment="Fragment";'},
  plugins: [{name: 'headless-app-hooks', setup(builder) {
    builder.onLoad({filter: /[\\/]src[\\/]App\.jsx$/}, () => ({contents: source, loader: 'jsx', resolveDir: "/workspace/scratch/7464bebaff38/ZhiXing/src"}));
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
  return {memory: () => sandbox.window.__qaConversationMemory(), flush, unmount, flushDurability: options => sandbox.module.exports.flushRendererDurability(options), nodes, component, button, text, snapshots, draftSnapshots, listeners, get renders() { return renders; }, get stored() { return stored; }, get pendingRun() { return pendingRun; }, get pendingPrepare() { return pendingPrepare; }};
}

async function openDraft(app, marker) {
  app.button('查看草稿').props.onClick(); await app.flush();
  const row = app.nodes().find(node => node.props['data-draft-key'] && app.text(node).includes(marker));
  assert(row, `Missing draft row: ${marker}`);
  const action = app.nodes(row).find(node => node.type === 'button');
  action.props.onClick(); await app.flush();
  return action.props.onClick;
}


const saved = fixture();
saved.chats = ['chat', 'keep-chat'].map(id => ({id, title: id, workspaceId: saved.workspaceId, projectId: null, messages: []}));
let durable = structuredClone(saved), saveFailure = false, forgetFailure = false, releaseForget;
const forgotten = [];
const app = await mount(saved, {
  loadWorkspace: async () => structuredClone(durable),
  saveWorkspace: async state => { if (saveFailure) throw new Error('SYNTHETIC_DISK_WRITE_FAILED'); durable = structuredClone(state); },
  saveDrafts: async drafts => { if (saveFailure) throw new Error('SYNTHETIC_DISK_WRITE_FAILED'); durable = {...durable, drafts: structuredClone(drafts)}; },
  forgetSession: async id => { if (forgetFailure) throw new Error('SYNTHETIC_FORGET_UNCONFIRMED'); await new Promise(resolve => {releaseForget = resolve;}); forgotten.push(id); },
});
app.component('Sidebar').openChat('chat');
await app.flush();
const keptQuestion = {type: 'question', runId: 'kept-run', sessionId: 'keep-chat', rootSessionId: 'keep-chat', requestId: 'kept-question', questions: [{id:'keep-q',question:'KEEP_QUESTION_MARKER',options:[]}]};
const targetQuestion = {type: 'question', runId: 'removed-run', sessionId: 'chat', rootSessionId: 'chat', requestId: 'target-question', questions: [{id:'target-q',question:'DELETE_QUESTION_MARKER',options:[]}]};
for (const question of [keptQuestion, targetQuestion]) app.listeners.get('RuntimeEvent')(question);
await app.flush();
assert.deepEqual(structuredClone(app.memory().questions), [keptQuestion,targetQuestion]);
assert.equal(app.memory().question.requestId, 'target-question');
app.component('Sidebar').openModal({type:'delete-chat',id:'chat',name:'chat'});
await app.flush();
saveFailure = true;
const deleting = app.component('Dialogs').removeItem({type:'delete-chat',id:'chat'});
const rejected = assert.rejects(deleting, /SYNTHETIC_DISK_WRITE_FAILED/);
await app.flush(); await rejected;
assert.deepEqual(structuredClone(app.memory().questions), [keptQuestion,targetQuestion]);
assert.equal(forgotten.length,0);
saveFailure = false; forgetFailure = true;
app.button('重试完成删除').props.onClick(); await app.flush();
assert.deepEqual(structuredClone(app.memory().questions), [keptQuestion,targetQuestion]);
assert.equal(forgotten.length,0);
forgetFailure = false;
app.button('重试完成删除').props.onClick(); await app.flush();
assert.equal(typeof releaseForget,'function');
assert.deepEqual(structuredClone(app.memory().questions), [keptQuestion,targetQuestion]);
releaseForget(); await app.flush();
assert.deepEqual(forgotten,['chat']);
assert.deepEqual(structuredClone(app.memory().questions), [keptQuestion]);
app.listeners.get('RuntimeEvent')({...targetQuestion,requestId:'deleted-question'});
await app.flush();
assert.deepEqual(structuredClone(app.memory().questions), [keptQuestion]);
assert.equal(app.memory().question,null);
app.component('Sidebar').openChat('keep-chat'); await app.flush();
assert.deepEqual(structuredClone(app.component('Composer').takeover.props.request),keptQuestion);
assert.deepEqual(structuredClone(app.memory().question),keptQuestion);
app.unmount();
console.log(JSON.stringify({status:'passed',layer:'source App hook fixture; not Windows renderer',queueBefore:2,queueAfter:1,deletedLateRequestRevived:false,retainedRootSelectable:true,mutation:process.env.ZX_QUEUE_PROBE_MUTATION||null}));

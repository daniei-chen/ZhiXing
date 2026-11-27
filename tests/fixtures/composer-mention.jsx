import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Composer } from '../../src/Composer.jsx';
import { createKeyedStore } from '../../src/keyed-store.js';
import '../../src/styles.css';

const settings = {
  theme: 'light',
  privacyMode: 'redact',
  permission: 'ask',
  reasoning: 'high',
  model: 'qa-model',
  demo: true,
  voiceLanguage: 'zh-CN',
};
const runtime = { configured: true, providers: [], models: [] };
const draftStore = createKeyedStore();
const calls = [];

const workspaceEntries = [
  { path: 'src', kind: 'directory' },
  { path: 'src/App.jsx', kind: 'file' },
  { path: 'src/app.css', kind: 'file' },
  { path: 'docs', kind: 'directory' },
  { path: 'docs/说明.md', kind: 'file' },
  { path: 'docs/带 空格 的名字.md', kind: 'file' },
];

let hostResponse = { workspace: true, entries: workspaceEntries, truncated: false };
let deferHost = false;
const pendingHost = [];
window.zhixing = {
  listWorkspaceReferences: (scope) => {
    calls.push({ name: 'list', scope });
    if (!deferHost) return Promise.resolve(hostResponse);
    // 手动放行：用来验证索引还在路上时不会为每个按键重新列一次工作区。
    return new Promise((resolve) => pendingHost.push(() => resolve(hostResponse)));
  },
  // VoiceInput 挂载时就要订阅语音事件；这个夹具只验证输入区，不需要真实语音。
  onSpeechEvent: () => () => {},
};

let rerender;
const state = { input: '', scopeKey: 'chat-a' };
const callbacks = {
  onSubmit: () => calls.push({ name: 'submit', text: state.input }),
};

function Harness() {
  const [, force] = useState(0);
  rerender = () => force((value) => value + 1);
  return (
    <Composer
      settings={settings}
      files={[]}
      input={state.input}
      draftStore={draftStore}
      draftKey="draft"
      setInput={(value) => {
        state.input = typeof value === 'function' ? value(state.input) : value;
        rerender();
      }}
      setFiles={() => {}}
      setSetting={() => {}}
      onSubmit={callbacks.onSubmit}
      onStop={() => calls.push({ name: 'stop' })}
      running={false}
      disabled={false}
      busy={false}
      chooseFiles={() => {}}
      addFiles={() => {}}
      openModal={() => {}}
      menu={null}
      toggleMenu={() => {}}
      closeMenu={() => {}}
      composer={{ current: null }}
      runtime={runtime}
      setRuntime={() => {}}
      openWorkbench={() => {}}
      scopeKey={state.scopeKey}
      onLocalCommand={() => {}}
      suspended={false}
      takeover={null}
      queue={[]}
      onRemoveQueued={() => {}}
      onRetryQueued={() => {}}
      onEditQueued={() => {}}
      referenceScope={{ workspaceId: 'office', projectId: 'qa-project', sessionId: state.scopeKey }}
    />
  );
}

createRoot(document.getElementById('root')).render(<Harness />);

const field = () => document.querySelector('textarea[aria-label="聊天输入框"]');
const setNativeValue = (value) => {
  const element = field();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(element, value);
  element.setSelectionRange(value.length, value.length);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

window.mentionQA = {
  calls,
  settle() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  },
  type(value) {
    setNativeValue(value);
  },
  typeChars(value) {
    // 逐字输入：模拟真实按键，每次一个 input 事件。
    let built = '';
    for (const character of value) {
      built += character;
      setNativeValue(built);
    }
  },
  deferHost(value) {
    deferHost = value;
  },
  releaseHost() {
    for (const resolve of pendingHost.splice(0)) resolve();
  },
  press(key, init = {}) {
    field().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  },
  value() {
    return field().value;
  },
  caret() {
    return field().selectionStart;
  },
  setCaret(index) {
    // 真实用户是点一下或按方向键移动光标，这里派发同一条 keyup 路径。
    const element = field();
    element.focus();
    element.setSelectionRange(index, index);
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
  },
  rows() {
    return [...document.querySelectorAll('.mention-palette [role="option"]')].map(
      (node) => node.textContent,
    );
  },
  selected() {
    const active = document.querySelector('.mention-palette [aria-selected="true"]');
    return active?.textContent ?? '';
  },
  palette() {
    return Boolean(document.querySelector('.mention-palette'));
  },
  text(selector) {
    return document.querySelector(selector)?.textContent ?? '';
  },
  setInput(text) {
    state.input = text;
    rerender();
  },
  clear() {
    state.input = '';
    rerender();
  },
  setScope(scopeKey) {
    state.scopeKey = scopeKey;
    rerender();
  },
  setHostResponse(response) {
    hostResponse = response;
  },
  reset(response = { workspace: true, entries: workspaceEntries, truncated: false }) {
    hostResponse = response;
    deferHost = false;
    pendingHost.length = 0;
    // 换一个聊天作用域同时清掉候选缓存，下一次 @ 会重新向主机要索引。
    state.scopeKey = `chat-${Date.now()}`;
    state.input = '';
    rerender();
  },
};

// 截图夹具：`?seed` 把光标停在 `@docs/` 后打开候选，用于人工核对界面。
if (location.search.includes('seed')) {
  const seed = '把 @src/App.jsx 里的重试逻辑改成指数退避，并补一条回归。再看一下 @docs/';
  const open = () => {
    const element = field();
    if (!element) {
      requestAnimationFrame(open);
      return;
    }
    // 先清空再由输入事件写回，React 才会把这次改动当成新输入并展开候选。
    state.input = '';
    rerender();
    requestAnimationFrame(() => setNativeValue(seed));
  };
  requestAnimationFrame(open);
}
window.mentionReady = true;

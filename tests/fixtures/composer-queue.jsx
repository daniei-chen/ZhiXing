import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Composer } from '../../src/Composer.jsx';
import { createKeyedStore } from '../../src/keyed-store.js';
import { enqueueMessage, patchQueued, removeQueued } from '../../src/message-queue.js';
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
// 不预置草稿键：Composer 回退到 initialInput，fixture 才能用普通 state 驱动输入框。
const draftStore = createKeyedStore();
const calls = [];

let rerender;
const state = { queue: [], running: true, input: '' };
const callbacks = {
  onSubmit: () => calls.push({ name: 'submit' }),
  onRemoveQueued: (id) => {
    calls.push({ name: 'remove', id });
    state.queue = removeQueued(state.queue, id);
    rerender();
  },
  onRetryQueued: (id) => {
    calls.push({ name: 'retry', id });
    state.queue = patchQueued(state.queue, id, { error: '' });
    rerender();
  },
  onEditQueued: (item) => {
    calls.push({ name: 'edit', id: item });
    state.queue = removeQueued(state.queue, item.id);
    rerender();
  },
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
      running={state.running}
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
      scopeKey="qa"
      onLocalCommand={() => {}}
      suspended={false}
      takeover={null}
      queue={state.queue}
      onRemoveQueued={callbacks.onRemoveQueued}
      onRetryQueued={callbacks.onRetryQueued}
      onEditQueued={callbacks.onEditQueued}
    />
  );
}

createRoot(document.getElementById('root')).render(<Harness />);

function add(item) {
  const result = enqueueMessage(state.queue, item);
  if (result.error) throw new Error(result.error);
  state.queue = result.queue;
  rerender();
}

window.queueQA = {
  calls,
  add,
  fail(id, message) {
    state.queue = patchQueued(state.queue, id, { error: message });
    rerender();
  },
  setRunning(value) {
    state.running = value;
    rerender();
  },
  setInput(text) {
    state.input = text;
    rerender();
  },
  type(value) {
    const field = document.querySelector('textarea[aria-label="聊天输入框"]');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    ).set;
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  },
  pressEnter() {
    document
      .querySelector('textarea[aria-label="聊天输入框"]')
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
  },
  click(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    element.click();
  },
  text(selector) {
    return document.querySelector(selector)?.textContent ?? '';
  },
  settle() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  },
};
// 截图夹具：`?seed` 预置三条排队消息（含一条失败），用来人工核对界面。
if (location.search.includes('seed')) {
  add({
    id: 'seed-1',
    chatId: 'chat-a',
    workspaceId: 'office-home',
    text: '再核对一遍预算表里的合计，和财务给的数字对不上。',
    files: [],
    mode: 'office',
  });
  add({
    id: 'seed-2',
    chatId: 'chat-a',
    workspaceId: 'office-home',
    text: '把结果导出成 Word，放进项目文件夹。',
    files: [{ id: 'f1', name: '三季度预算.xlsx' }],
    mode: 'office',
  });
  add({
    id: 'seed-3',
    chatId: 'chat-a',
    workspaceId: 'office-home',
    text: '这条用来展示失败状态。',
    files: [],
    mode: 'office',
  });
  state.queue = patchQueued(state.queue, 'seed-3', {
    error: '尚未连接模型，请先在设置中配置供应商。',
  });
  rerender();
}
// 输入框预置一段待发文字，便于截图核对运行中的占位文案。
if (location.search.includes('seed')) {
  state.input = '请把上周的会议录音整理成纪要，并标出每个行动项的负责人。';
  rerender();
}
window.queueReady = true;

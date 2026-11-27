import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repository = path.resolve(import.meta.dirname, '..');

// 真实 App renderer + 真实 WorkspacePersistence + 真实文件，进程在关键窗口被 SIGKILL
// （Linux 上等价于任务管理器结束进程）。验三件事：已经交给内核的交办不重发、没发出的
// 不永久停在「发送中」、草稿与附件在加密与不加密两种落盘方式下都完整。
// 覆盖不到的：Windows 实包与 safeStorage（这里用可逆变换代替）、真实 Harness 内核、
// 断电与磁盘写坏。
const renderer = await build({
  stdin: {
    resolveDir: repository,
    loader: 'jsx',
    contents: `import{createElement}from'react';import{createRoot}from'react-dom/client';import{App} from './src/App.jsx';import{flushRendererDurability}from'./src/renderer-durability.js';window.__qaFlushWorkspace=flushRendererDurability;createRoot(document.getElementById('root')).render(createElement(App));`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"test"' },
  logLevel: 'silent',
});

// 用可逆变换代替 Windows safeStorage：要验证的是「磁盘上是密文、恢复时按同一层解密」
// 这条链路，而不是 safeStorage 本身。Linux 上没有钥匙串，真加密在这个环境起不来。
const codecSource = `
const MAGIC = Buffer.from('ZX1:', 'latin1');
const scramble = value => Buffer.from(value.map(byte => byte ^ 0x5a));
module.exports = {
  encode: (text, encrypted) => encrypted ? Buffer.concat([MAGIC, scramble(Buffer.from(text, 'utf8'))]) : Buffer.from(text, 'utf8'),
  decode: value => value.length >= 4 && value.subarray(0, 4).equals(MAGIC) ? scramble(value.subarray(4)).toString('utf8') : value.toString('utf8'),
};
`;

const preloadSource = `const {contextBridge,ipcRenderer}=require('electron');
const methods=['loadWorkspace','saveWorkspace','saveDrafts','runtimeStatus','runtimeCleanupStatus','retryRuntimeCleanup','listAutomations','retryAutomationSave','forgetSession','removeAutomation','prepareRun','runPrepared','beginRun','runHandoffs','awaitRunHandoff','acknowledgeRunHandoff','questionSnapshot','workspaceSaveStatus','retryWorkspaceSave','loadFeedback','listMcp','browserState','browserLayout','windowControl','speechStatus','pickFiles','approvalSnapshot','runStatus'];
const api=Object.fromEntries(methods.map(name=>[name,(...args)=>ipcRenderer.invoke('qa',name,args)]));
api.appQA={snapshot:()=>ipcRenderer.invoke('qa','snapshot'),finish:index=>ipcRenderer.invoke('qa','finish',index)};
for(const name of ['RuntimeEvent','WorkspaceSaveState','PrepareToQuit','AutomationChange','BrowserChange','SpeechEvent','ApprovalsChanged'])api['on'+name]=callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on(name,listener);return()=>ipcRenderer.removeListener(name,listener);};
contextBridge.exposeInMainWorld('zhixing',api);
`;

const exerciseSource = `
// 在真实 renderer 里驱动 App：只点真实控件、按真实键盘事件，不注入 App 内部状态。
module.exports = async function exercise(window, options) {
  const assert = require('node:assert/strict');
  const run = source => window.webContents.executeJavaScript(source);
  const pause = (ms) => new Promise(done => setTimeout(done, ms));
  const wait = async (expression, label) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await run(expression)) return;
      await pause(20);
    }
    throw new Error('Timeout: ' + label + '\\n' + (await run('document.body.innerText.slice(-1600)')));
  };
  const field = 'textarea[aria-label="聊天输入框"]';
  const type = value => run('(()=>{const node=document.querySelector(' + JSON.stringify(field) + ');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(node,' + JSON.stringify(value) + ');node.dispatchEvent(new Event("input",{bubbles:true}));})()');
  const enter = () => run('document.querySelector(' + JSON.stringify(field) + ').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
  const snapshot = () => run('window.zhixing.appQA.snapshot()');
  const count = selector => run('document.querySelectorAll(' + JSON.stringify(selector) + ').length');
  const text = selector => run('document.querySelector(' + JSON.stringify(selector) + ')?.textContent || ""');
  const clickText = label => run('(()=>{const node=[...document.querySelectorAll("button")].find(item=>item.textContent.trim()===' + JSON.stringify(label) + ');if(!node)throw new Error("missing button");node.click();})()');
  // 按 id 打开：发送第一条交办时 App 会用正文重命名空聊天，标题不能当定位条件。
  const openChat = async chatId => {
    const row = '.chat-row[data-chat-id="' + chatId + '"]';
    await run('(()=>{if(document.querySelector(".sidebar"))return;const node=document.querySelector(\\'[aria-label="展开侧栏"]\\');if(node)node.click();})()');
    await wait('!!document.querySelector(".sidebar")', 'sidebar opens');
    await run('(()=>{const node=[...document.querySelectorAll(".sidebar-section-toggle")].find(item=>item.textContent.includes("最近聊天"));if(node&&node.getAttribute("aria-expanded")!=="true")node.click();})()');
    await wait('!!document.querySelector(' + JSON.stringify(row) + ')', 'chat listed');
    await run('document.querySelector(' + JSON.stringify(row + ' .chat-link') + ').click()');
    await wait('!!document.querySelector(".transcript")', 'chat opens');
  };
  const ready = async () => {
    await wait('!!window.zhixing?.appQA', 'bridge');
    await wait('!!document.querySelector(' + JSON.stringify(field) + ') && !document.querySelector(' + JSON.stringify(field) + ').disabled', 'composer');
    await wait('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"', 'workspace saved');
  };

  if (options.exercise === 'draft') {
    await ready();
    if (options.verify) {
      const restoredText = 'document.querySelector(' + JSON.stringify(field) + ').value === ' + JSON.stringify(options.draftText);
      await wait(restoredText, 'draft text restored into the composer');
      await wait('document.querySelector(".composer .attachment-name")?.title === ' + JSON.stringify(options.attachmentName), 'attachment chip restored');
      await wait('!!document.querySelector(".transcript")', 'chat restored');
      assert.equal(await count('.transcript article'), 0, '重开后不能有半条交办');
      assert.equal(await run('!!document.querySelector(".queued-messages")'), false, '草稿不是排队消息');
      const state = await snapshot();
      assert.equal(state.merged.chats.find(item => item.id === 'chat-a').messages.length, 0, '聊天记录里没有空壳消息');
      assert.equal(state.prepares.length, 0);
      assert.equal(state.runs.length, 0);
      console.log('PASS 强杀后草稿与附件原样回来，没有半条交办');
      return;
    }
    await openChat('chat-a');
    await type(options.draftText);
    await run('document.querySelector(\\'[aria-label="添加内容"]\\').click()');
    await wait('!!document.querySelector(".attachment-menu")', 'attach menu');
    await run('document.querySelector(\\'.attachment-menu button[role="menuitem"]\\').click()');
    await wait('document.querySelector(".composer .attachment-name")?.title === ' + JSON.stringify(options.attachmentName), 'attachment chip');
    console.log('PASS 草稿与附件写进输入框，等宿主机落盘');
    await pause(60000);
    return;
  }

  if (options.exercise === 'drive') {
    await ready();
    await openChat('chat-a');
    await type(options.firstText);
    await enter();
    await wait('window.zhixing.appQA.snapshot().then(value=>value.runs.length===1)', 'first run starts');
    await type(options.queuedText);
    await enter();
    const queued = 'window.zhixing.appQA.snapshot().then(value=>value.stored.queuedMessages.some(item=>item.text===' + JSON.stringify(options.queuedText) + '))';
    await wait(queued, 'queued message reaches the disk');
    console.log('PASS 运行中的第二件交办进入队列并写进磁盘');
    // 本轮结束：队头自动派发；派发窗口里宿主机按 options.crashAt 强杀自己。
    await run('window.zhixing.appQA.finish(0)');
    await pause(60000);
    return;
  }

  await ready();
  await openChat('chat-a');
  const state = await snapshot();
  assert.equal(state.prepares.length, 0, '重启后不能自动重新准备任何请求');
  assert.equal(state.runs.length, 0, '重启后不能自动重放队列');

  if (options.expect === 'sent') {
    assert.equal(await run('!!document.querySelector(".queued-messages")'), false, '已经交给内核的交办不能再出现在队列里');
    assert.equal(await count('.transcript article.user-message'), 2, '两条交办都在聊天记录里，各自只一次');
    assert.equal(await count('.transcript article.assistant-message'), 2);
    const body = await text('.transcript');
    assert.match(body, /第二件交办/);
    assert.match(body, /上次运行已中断/);
    const lastByline = await run('[...document.querySelectorAll(".transcript article.assistant-message .assistant-byline small")].at(-1)?.textContent || ""');
    assert.match(lastByline, /已停止/);
    assert.equal(state.merged.queuedMessages.length, 0, '恢复视图里也不能留下这条');
    console.log('PASS 强杀后已交给内核的排队交办不重发、不重复出现');
    return;
  }

  assert.equal(state.merged.queuedMessages.length, 1, '没发出去的条目必须回到队列');
  assert.equal(state.merged.queuedMessages[0].sending, undefined, '重启后不能停在「发送中」');
  assert.match(state.merged.queuedMessages[0].error, /上次退出时未发送/);
  assert.equal(await run('!!document.querySelector(".queued-messages li.failed")'), true, '待确认的条目要能重试');
  assert.doesNotMatch(await text('.queued-state'), /发送中/);
  console.log('PASS 强杀后没发出去的条目回到可重试状态，不自动重放也不停在发送中');

  await clickText('重试');
  await wait('window.zhixing.appQA.snapshot().then(value=>value.runs.length===1)', 'retry starts one run');
  const answered = await snapshot();
  assert.equal(answered.prepares.length, 1, '确认后只发一次');
  assert.match(answered.prepares[0].prompt, /第二件交办/);
  await wait('window.zhixing.appQA.snapshot().then(value=>value.merged.queuedMessages.length===0)', 'accepted item leaves the queue');
  await run('window.zhixing.appQA.finish(0)');
  await wait('window.zhixing.appQA.snapshot().then(value=>{const chat=value.stored.chats.find(item=>item.id==="chat-a");return !!chat && chat.messages.some(message=>message.role==="assistant" && !message.pending && !!message.text);})', 'answer saved');
  assert.equal(await count('.transcript article.user-message'), 2, '重试后仍然只有两条交办');
  assert.equal(await count('.transcript article.assistant-message'), 2);
  console.log('PASS 用户确认后只发一次，队列清空');
};
`;

function mainSource() {
  return `
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const codec = require('./codec.cjs');
const exercise = require('./exercise.cjs');

const options = JSON.parse(process.env.ZHIXING_CRASH_OPTIONS);
const REPOSITORY = ${JSON.stringify(repository)};
const directory = __dirname;
const profile = path.join(directory, 'profile');
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.setPath('crashDumps', path.join(profile, 'crashes'));
app.setAppLogsPath(path.join(profile, 'logs'));

const WORKSPACE_FILE = path.join(directory, 'workspace.bin');
const DRAFTS_FILE = path.join(directory, 'drafts.bin');

const TRANSIENT = new Set(['ENOENT', 'EPERM', 'EACCES', 'EBUSY']);
const readStore = async file => {
  try { return codec.decode(await fs.readFile(file)); } catch (error) { if (TRANSIENT.has(error.code)) return null; throw error; }
};
// 与真实主进程同一条提交路径：Windows 上 rename 覆盖一个正在被读取的目标会
// 返回 EPERM（本仓库 0.42.0 发布时在 drafts.bin 上真遇到过），所以复用产品里的
// 有界重试，而不是让测试夹具自己发明一个更弱的写盘方式。
const writeStore = async (file, text) => {
  const temporary = file + '.' + Math.random().toString(36).slice(2) + '.tmp';
  try {
    await fs.writeFile(temporary, codec.encode(text, options.encrypted));
    await renameEncryptedTemp(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
};

// 真实强杀：没有退出钩子、没有 flush，等价于任务管理器结束进程。
const hardKill = reason => {
  process.stderr.write('SIGKILL ' + reason + '\\n');
  process.kill(process.pid, 'SIGKILL');
};

const runtime = {
  configured: true,
  providers: [{ id: 'synthetic-provider', name: 'Synthetic', baseUrl: 'http://127.0.0.1/synthetic' }],
  models: [{ id: 'synthetic-model', name: 'Synthetic', providerId: 'synthetic-provider', providerName: 'Synthetic', levels: ['high'], reasoningCapability: 'supported' }],
};
const prepares = [], runs = [];
let window = null, persistence = null, persistenceApi = null, mergeState = null, renameEncryptedTemp = null;

const readWorkspaceState = () => persistenceApi.loadWorkspacePersistence({
  readWorkspace: () => readStore(WORKSPACE_FILE),
  readDrafts: () => readStore(DRAFTS_FILE),
});

async function boot() {
  const store = await import(pathToFileURL(path.join(REPOSITORY, 'src/store.js')).href);
  mergeState = store.mergeState;
  persistenceApi = await import(pathToFileURL(path.join(REPOSITORY, 'electron/workspace-persistence.mjs')).href);
  ({ renameEncryptedTemp } = await import(pathToFileURL(path.join(REPOSITORY, 'harness/privacy-bridge.mjs')).href));
  const persisted = await readWorkspaceState();
  persistence = new persistenceApi.WorkspacePersistence({
    initialState: mergeState(persisted.state),
    initialEpoch: persisted.epoch,
    write: async ({ kind, body }) => {
      await writeStore(kind === 'workspace' ? WORKSPACE_FILE : DRAFTS_FILE, body);
    },
  });
  if (persisted.state === null) {
    const seed = mergeState(null);
    seed.chats = [{ id: 'chat-a', projectId: null, workspaceId: 'office-home', title: '合成聊天', mode: 'office', createdAt: 1, updatedAt: 1, messages: [] }];
    seed.settings = { ...seed.settings, modelProviderId: 'synthetic-provider', model: 'synthetic-model' };
    await persistence.saveWorkspace(seed);
    await persistence.flush();
  }
}

ipcMain.handle('qa', async (_event, name, args) => {
  if (name === 'loadWorkspace') { await persistence.flush(); return (await readWorkspaceState()).state; }
  if (name === 'saveWorkspace') { await persistence.saveWorkspace(args[0]); return { saved: true }; }
  if (name === 'saveDrafts') { await persistence.saveDrafts(args[0]); return { saved: true }; }
  if (name === 'runtimeStatus') return runtime;
  if (name === 'workspaceSaveStatus') return persistence.state();
  if (name === 'retryWorkspaceSave') return persistence.retry();
  if (name === 'runtimeCleanupStatus') return [];
  if (name === 'listAutomations') return { revision: 0, tasks: [], runs: [], pendingOutcomes: [], persistenceError: null };
  if (name === 'questionSnapshot') return [];
  if (name === 'browserState') return { tabs: [], activeId: null, recent: [] };
  if (name === 'browserLayout') return { open: false, width: 0 };
  if (name === 'listMcp') return [];
  if (name === 'speechStatus') return { ready: false, model: 'none' };
  if (name === 'loadFeedback') return { entries: [] };
  if (name === 'approvalSnapshot') return { hostEpoch: 'qa', revision: 0, pending: [] };
  if (name === 'runHandoffs') return { runs: [] };
  if (name === 'forgetSession') return { forgotten: true };
  if (name === 'pickFiles') return [{ id: 'attach-1', name: options.attachmentName, status: 'ready', size: 12, text: '附件正文' }];
  if (name === 'prepareRun') {
    prepares.push({ ...args[0] });
    if (options.crashAt === 'prepare' && prepares.length === options.crashOn) {
      // 让渲染层刚打的「发送中」先落盘，再在「内核还没接手」这一刻强杀：
      // 这是最容易把条目永久卡在发送中的窗口。
      await persistence.flush();
      hardKill('prepareRun');
    }
    return { preparationId: 'prep-' + prepares.length, text: 'SAFE_INPUT', privacyMode: 'redact', providerId: 'synthetic-provider', baseUrl: 'http://127.0.0.1/synthetic' };
  }
  if (name === 'beginRun') {
    const entry = { settled: false, identity: { hostEpoch: 'qa', runId: args[0].runId, sessionId: prepares[prepares.length - 1].sessionId, replyId: args[0].replyId, receiptId: 'receipt-' + args[0].runId } };
    entry.done = new Promise(resolve => { entry.release = resolve; });
    runs.push(entry);
    if (options.crashAt === 'beginRun' && runs.length === options.crashOn) hardKill('beginRun');
    return entry.identity;
  }
  if (name === 'awaitRunHandoff') {
    const entry = runs.find(item => item.identity.runId === args[0].runId);
    await entry.done;
    return { ...entry.identity, outcome: { result: { text: '合成答复 ' + entry.identity.runId.slice(0, 4), masked: '合成答复', finishReason: 'stop', privacyMode: 'redact', entities: [] } }, time: Date.now(), trace: [] };
  }
  if (name === 'acknowledgeRunHandoff') return { acknowledged: true };
  if (name === 'runPrepared') return { text: '合成答复', masked: '合成答复', privacyMode: 'redact' };
  if (name === 'finish') {
    const index = Array.isArray(args) ? args[0] : args;
    const entry = runs[index];
    if (!entry) throw new Error('run not found');
    if (!entry.settled) { entry.settled = true; entry.release(); }
    return true;
  }
  if (name === 'snapshot') {
    await persistence.flush();
    const stored = (await readWorkspaceState()).state;
    return {
      prepares: prepares.map(item => ({ sessionId: item.sessionId, prompt: item.prompt })),
      runs: runs.map(item => ({ settled: item.settled })),
      stored,
      merged: mergeState(stored),
    };
  }
  throw new Error('unknown fixture method ' + name);
});

app.whenReady().then(async () => {
  try {
    await boot();
    window = new BrowserWindow({ show: false, width: 1255, height: 912, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(directory, 'preload.cjs') } });
    window.webContents.on('console-message', event => { if (event.level === 'error') console.error('RENDERER ' + event.message); });
    await window.loadFile(path.join(directory, 'index.html'));
    await exercise(window, options);
    console.log('EXERCISE COMPLETE');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
`;
}

async function scenarioDirectory({ encrypted }) {
  // Electron 主进程的语法错误会弹一个阻塞对话框，测试只能干等超时；
  // 先把生成的两份子进程源码解析一遍，报错留在测试里。
  new Function(exerciseSource);
  new Function(mainSource());
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-crash-'));
  await writeFile(path.join(directory, 'codec.cjs'), codecSource);
  await writeFile(path.join(directory, 'preload.cjs'), preloadSource);
  await writeFile(path.join(directory, 'exercise.cjs'), exerciseSource);
  await writeFile(path.join(directory, 'main.cjs'), mainSource());
  await writeFile(path.join(directory, 'renderer.js'), renderer.outputFiles[0].text);
  await writeFile(
    path.join(directory, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>',
  );
  return { directory, encrypted, temporaryRoot };
}

function launch(directory, options) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const flags =
    process.platform === 'linux'
      ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu']
      : [];
  const child = spawn(require('electron'), [...flags, path.join(directory, 'main.cjs')], {
    env: { ...env, ZHIXING_CRASH_OPTIONS: JSON.stringify(options) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const exited = new Promise((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );
  return { child, exited, output: () => output };
}

async function until(probe, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timeout: ' + label);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function readStore(directory, file) {
  const codec = require(path.join(directory, 'codec.cjs'));
  try {
    return JSON.parse(codec.decode(await readFile(path.join(directory, file))));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function cleanup(directory, temporaryRoot) {
  const resolved = await realpath(directory);
  assert.equal(path.dirname(resolved), temporaryRoot);
  assert.ok(path.basename(resolved).startsWith('zhixing-crash-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
}

test(
  '强杀在「内核已受理、队列移除还没落盘」之间：重启后同一条交办不重发',
  { timeout: 180000 },
  async () => {
    const { directory, temporaryRoot } = await scenarioDirectory({ encrypted: true });
    let first, second;
    try {
      first = launch(directory, {
        encrypted: true,
        exercise: 'drive',
        crashAt: 'beginRun',
        crashOn: 2,
        firstText: '第一件交办',
        queuedText: '第二件交办',
        attachmentName: '附件.txt',
      });
      const crashed = await first.exited;
      assert.match(first.output(), /PASS 运行中的第二件交办进入队列并写进磁盘/);
      // Windows 上被结束的进程用退出码报告，不报 signal；Linux 上必须是 SIGKILL。
      assert.doesNotMatch(
        first.output(),
        /EXERCISE COMPLETE/,
        '这一步必须死在强杀里，不能走到正常退出',
      );
      if (process.platform !== 'win32') assert.equal(crashed.signal, 'SIGKILL', first.output());

      const saved = await readStore(directory, 'workspace.bin');
      assert.deepEqual(
        saved.queuedMessages.map((item) => item.text),
        ['第二件交办'],
        '磁盘上这一刻排队项还在',
      );
      assert.equal(saved.queuedMessages[0].sending, true, '它正是被受理、还没从队列移除的那一条');
      const chat = saved.chats.find((item) => item.id === 'chat-a');
      assert.deepEqual(
        chat.messages.filter((message) => message.role === 'user').map((message) => message.text),
        ['第一件交办', '第二件交办'],
        '用户消息已经落盘，说明这条交办确实交给了内核',
      );

      second = launch(directory, {
        encrypted: true,
        exercise: 'verifyQueue',
        expect: 'sent',
        queuedText: '第二件交办',
      });
      const verified = await second.exited;
      assert.equal(verified.code, 0, second.output());
      assert.equal((second.output().match(/PASS /g) || []).length, 1, second.output());
    } finally {
      if (first?.child.exitCode === null && first.child.signalCode === null)
        first.child.kill('SIGKILL');
      if (second?.child.exitCode === null && second.child.signalCode === null)
        second.child.kill('SIGKILL');
      await cleanup(directory, temporaryRoot);
    }
  },
);

test(
  '强杀在「已经点出发送、还没交给内核」之间：重启后条目可重试、不自动重放、不停在发送中',
  { timeout: 180000 },
  async () => {
    const { directory, temporaryRoot } = await scenarioDirectory({ encrypted: true });
    let first, second;
    try {
      first = launch(directory, {
        encrypted: true,
        exercise: 'drive',
        crashAt: 'prepare',
        crashOn: 2,
        firstText: '第一件交办',
        queuedText: '第二件交办',
        attachmentName: '附件.txt',
      });
      const crashed = await first.exited;
      assert.match(first.output(), /PASS 运行中的第二件交办进入队列并写进磁盘/);
      assert.doesNotMatch(
        first.output(),
        /EXERCISE COMPLETE/,
        '这一步必须死在强杀里，不能走到正常退出',
      );
      if (process.platform !== 'win32') assert.equal(crashed.signal, 'SIGKILL', first.output());

      const saved = await readStore(directory, 'workspace.bin');
      assert.deepEqual(
        saved.queuedMessages.map((item) => item.text),
        ['第二件交办'],
      );
      assert.equal(saved.queuedMessages[0].sending, true, '强杀时它正卡在「发送中」');
      assert.deepEqual(
        saved.chats
          .find((item) => item.id === 'chat-a')
          .messages.filter((message) => message.role === 'user')
          .map((message) => message.text),
        ['第一件交办'],
        '没交给内核就不会在聊天记录里留下半条交办',
      );

      second = launch(directory, {
        encrypted: true,
        exercise: 'verifyQueue',
        expect: 'unsent',
        queuedText: '第二件交办',
      });
      const verified = await second.exited;
      assert.equal(verified.code, 0, second.output());
      assert.equal((second.output().match(/PASS /g) || []).length, 2, second.output());
    } finally {
      if (first?.child.exitCode === null && first.child.signalCode === null)
        first.child.kill('SIGKILL');
      if (second?.child.exitCode === null && second.child.signalCode === null)
        second.child.kill('SIGKILL');
      await cleanup(directory, temporaryRoot);
    }
  },
);

for (const [label, encrypted] of [
  ['加密', true],
  ['不加密', false],
]) {
  test(`强杀后重开：${label}落盘的草稿与附件完整、没有半条交办`, { timeout: 180000 }, async () => {
    const { directory, temporaryRoot } = await scenarioDirectory({ encrypted });
    let first, second;
    try {
      first = launch(directory, {
        encrypted,
        exercise: 'draft',
        draftText: '草稿正文：还没发出的交办',
        attachmentName: '附件.txt',
      });
      await until(async () => {
        const overlay = await readStore(directory, 'drafts.bin');
        const draft = overlay && overlay.drafts && overlay.drafts['chat:chat-a'];
        return draft && draft.text === '草稿正文：还没发出的交办' && draft.files.length === 1;
      }, 'draft reaches the disk');
      const bytes = await readFile(path.join(directory, 'drafts.bin'));
      if (encrypted) {
        assert.equal(bytes.subarray(0, 4).toString('latin1'), 'ZX1:', '加密落盘的文件是密文');
        assert.equal(bytes.includes(Buffer.from('草稿正文', 'utf8')), false, '磁盘上没有草稿明文');
      } else {
        assert.equal(bytes.includes(Buffer.from('草稿正文', 'utf8')), true, '不加密时就是明文文件');
      }
      assert.match(first.output(), /PASS 草稿与附件写进输入框/);

      // 任务管理器式强杀：没有退出钩子，没有 flush。
      first.child.kill('SIGKILL');
      const killed = await first.exited;
      assert.doesNotMatch(
        first.output(),
        /EXERCISE COMPLETE/,
        '这一步必须死在强杀里，不能走到正常退出',
      );
      if (process.platform !== 'win32') assert.equal(killed.signal, 'SIGKILL');

      second = launch(directory, {
        encrypted,
        exercise: 'draft',
        draftText: '草稿正文：还没发出的交办',
        attachmentName: '附件.txt',
        verify: true,
      });
      const verified = await second.exited;
      assert.equal(verified.code, 0, second.output());
      assert.equal((second.output().match(/PASS /g) || []).length, 1, second.output());
    } finally {
      if (first?.child.exitCode === null && first.child.signalCode === null)
        first.child.kill('SIGKILL');
      if (second?.child.exitCode === null && second.child.signalCode === null)
        second.child.kill('SIGKILL');
      await cleanup(directory, temporaryRoot);
    }
  });
}

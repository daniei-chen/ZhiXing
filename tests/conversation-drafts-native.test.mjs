import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const require = createRequire(import.meta.url);
const repository = path.resolve(import.meta.dirname, '..');
const frozenSources = ['src/App.jsx', 'src/store.js', 'src/conversation-state.js'];
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(frozenSources.map(async filename => [filename,
    createHash('sha256').update(await readFile(path.join(repository, filename))).digest('hex')])));
}

// Written verbatim into an isolated test main process. No App instrumentation,
// hook replacement, production main/preload import, or user profile is used.
async function nativeJourney() {
  const {app, BrowserWindow, ipcMain, session} = require('electron');
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const fsSync = require('node:fs');
  const path = require('node:path');
  const profile = path.join(__dirname, 'isolated-profile');
  for (const name of ['session', 'logs', 'crashes']) fsSync.mkdirSync(path.join(profile, name), {recursive: true});
  app.setPath('userData', profile);
  app.setPath('sessionData', path.join(profile, 'session'));
  app.setPath('crashDumps', path.join(profile, 'crashes'));
  app.setAppLogsPath(path.join(profile, 'logs'));

  const workspaceFile = path.join(__dirname, 'synthetic-workspace.json');
  const layer = 'Windows Electron real App/React/Chromium DOM + synthetic IPC and JSON file; not production main, encrypted vault, installer, Harness or cloud';
  const records = [], rendererErrors = [], blockedNetwork = [], prepared = [];
  let window, stored, saveTail = Promise.resolve(), requestedRevision = 0, persistedRevision = 0;
  let pageLoads = 0, draftOpens = 0, runPreparedCalls = 0, filePickCalls = 0, pendingRun;
  let nextPicked = [], deferPick = false, finishPick;
  const runtime = {
    configured: true,
    providers: [{id: 'draft-fixture-provider', name: 'Synthetic', baseUrl: 'https://draft-fixture.invalid'}],
    models: [{id: 'draft-fixture-model', name: 'Synthetic', providerId: 'draft-fixture-provider', providerName: 'Synthetic', levels: ['high'], reasoningCapability: 'supported'}],
  };
  const file = id => ({id, name: `${id}.txt`, status: 'ready', size: 24, text: `${id}_ATTACHMENT_BODY`, workspaceId: 'office-home'});
  const saveStatus = () => ({status: persistedRevision === requestedRevision ? 'saved' : 'saving', requestedRevision, persistedRevision});
  const emitSaveStatus = () => { if (window && !window.isDestroyed()) window.webContents.send('WorkspaceSaveState', saveStatus()); };
  ipcMain.handle('draft-fixture', async (_event, name, args) => {
    if (name === 'loadWorkspace') { await saveTail; return JSON.parse(await fs.readFile(workspaceFile, 'utf8')); }
    if (name === 'saveWorkspace') {
      const revision = ++requestedRevision, snapshot = JSON.stringify(args[0]);
      const saving = saveTail.then(async () => {
        await fs.writeFile(workspaceFile, snapshot);
        stored = JSON.parse(snapshot); persistedRevision = revision; emitSaveStatus();
        return {saved: true};
      });
      saveTail = saving;
      return saving;
    }
    if (name === 'workspaceSaveStatus') return saveStatus();
    if (name === 'runtimeStatus') return runtime;
    if (name === 'runtimeCleanupStatus' || name === 'listMcp') return [];
    if (name === 'listAutomations') return {revision: 0, tasks: [], runs: [], pendingOutcomes: []};
    if (name === 'browserState') return {tabs: [], activeId: null, recent: []};
    if (name === 'browserLayout' || name === 'windowControl') return {};
    if (name === 'speechStatus') return {available: false, status: 'not-prepared'};
    if (name === 'prepareRun') {
      prepared.push(args[0]);
      return {preparationId: 'draft-fixture-prepared', text: 'SAFE_SYNTHETIC_INPUT', privacyMode: 'redact', providerId: runtime.providers[0].id, baseUrl: runtime.providers[0].baseUrl};
    }
    if (name === 'runPrepared') {
      runPreparedCalls++;
      return new Promise((resolve, reject) => { pendingRun = {...args[0], sessionId: prepared.at(-1).sessionId, resolve, reject}; });
    }
    if (name === 'pickFiles') {
      filePickCalls++;
      if (deferPick) return new Promise(resolve => { finishPick = resolve; });
      const files = nextPicked; nextPicked = []; return files;
    }
    throw new Error(`Unexpected synthetic IPC: ${name}`);
  });

  const run = source => window.webContents.executeJavaScript(source);
  async function wait(predicate, label) {
    const limit = Date.now() + 15000;
    while (Date.now() < limit) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timeout ${label}; DOM: ${await run('document.body.innerText.slice(-2200)')}`);
  }
  const waitUI = expression => wait(() => run(expression), expression);
  const field = 'textarea[aria-label="聊天输入框"]';
  const inputValue = () => run(`document.querySelector(${JSON.stringify(field)}).value`);
  const attachmentNames = () => run('[...document.querySelectorAll(".composer .attachment-name")].map(node=>node.title)');
  const visible = selector => run(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.closest('[hidden],[inert]')) return false;
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && style.visibility !== 'hidden' && style.display !== 'none';
  })()`);
  async function click(selector) {
    await run(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node || node.disabled || node.closest('[inert]')) throw new Error('Missing or disabled control: ' + ${JSON.stringify(selector)});
      node.click();
    })()`);
  }
  async function textClick(selector, text) {
    await run(`(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.trim() === ${JSON.stringify(text)});
      if (!node || node.disabled || node.closest('[inert]')) throw new Error('Missing or disabled text control: ' + ${JSON.stringify(text)});
      node.click();
    })()`);
  }
  async function input(value) {
    await run(`(() => {
      const node = document.querySelector(${JSON.stringify(field)});
      if (!node || node.disabled) throw new Error('Composer is unavailable');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
    await waitUI(`document.querySelector(${JSON.stringify(field)}).value === ${JSON.stringify(value)}`);
  }
  async function durable() {
    await waitUI('document.querySelector(".workspace-save-banner")?.dataset.saveStatus === "saved"');
    await saveTail;
    assert.equal(persistedRevision, requestedRevision);
    assert.deepEqual(JSON.parse(await fs.readFile(workspaceFile, 'utf8')), stored);
  }
  async function load() {
    await saveTail;
    await window.loadFile(path.join(__dirname, 'index.html'));
    pageLoads++;
    await waitUI(`!!document.querySelector(${JSON.stringify(field)}) && !document.querySelector(${JSON.stringify(field)}).disabled`);
    await durable();
  }
  async function showDrafts(expected) {
    await textClick('.unsent-drafts button', '查看草稿');
    await waitUI('!!document.querySelector("[role=dialog][aria-label=未发送的新草稿]")');
    assert.equal(await run('document.querySelectorAll("[role=dialog] [data-draft-key]").length'), expected);
    assert(await visible('[role=dialog][aria-label=未发送的新草稿]'));
  }
  async function openDraft(text, attachment, expectedCount) {
    await showDrafts(expectedCount);
    const key = await run(`(() => {
      const row = [...document.querySelectorAll('[role=dialog] [data-draft-key]')].find(node => node.querySelector('strong').textContent === ${JSON.stringify(text)});
      if (!row) throw new Error('Missing draft row: ' + ${JSON.stringify(text)});
      const key = row.dataset.draftKey;
      row.querySelector('button').click();
      return key;
    })()`);
    await waitUI(`!document.querySelector('[role=dialog]') && document.querySelector(${JSON.stringify(field)}).value === ${JSON.stringify(text)}`);
    assert.deepEqual(await attachmentNames(), [`${attachment}.txt`]);
    assert(await visible(field));
    assert.equal(stored.drafts[key]?.workspaceId, 'office-home');
    assert.equal(stored.drafts[key]?.projectId, null);
    draftOpens++;
    return key;
  }
  async function record(name, details) {
    records.push({name, status: 'passed', details});
    console.log(`PASS ${name}`);
    await fs.writeFile(path.join(__dirname, 'journey.json'), JSON.stringify({layer, records}, null, 2));
  }

  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (details, callback) => {
    blockedNetwork.push(details.url); callback({cancel: true});
  });
  window = new BrowserWindow({show: false, width: 1255, height: 912, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs'),
  }});
  window.webContents.on('console-message', event => { if (event.level === 'error') rendererErrors.push(event.message); });
  window.webContents.on('render-process-gone', (_event, details) => rendererErrors.push(`render-process-gone: ${details.reason}`));
  let exitCode = 0;
  try {
    assert.equal(app.getPath('userData'), profile);
    assert.equal(window.isVisible(), false);
    await fs.writeFile(workspaceFile, JSON.stringify({
      version: 2, workspaceId: 'office-home', workspaces: [{id: 'office-home', name: '合成办公', type: 'office'}],
      projects: [{id: 'delete-project', name: '合成待删项目', workspaceId: 'office-home', expanded: true}], chats: [], drafts: {}, documents: [], automations: [], appliedAutomationRuns: [],
      settings: {persist: true, modelProviderId: 'draft-fixture-provider', model: 'draft-fixture-model', reasoning: 'high', privacyMode: 'redact', permission: 'ask'},
    }));
    await load();
    const drafts = [['NATIVE_DRAFT_ONE', 'native-one'], ['NATIVE_DRAFT_TWO', 'native-two'], ['NATIVE_DRAFT_THREE', 'native-three']];
    for (const [text, attachment] of drafts) {
      await input(text);
      nextPicked = [file(attachment)];
      await click('button[aria-label="添加内容"]');
      await click('.attachment-menu button[role="menuitem"]');
      await waitUI(`document.querySelector('.composer .attachment-name')?.title === ${JSON.stringify(`${attachment}.txt`)}`);
      await durable();
      await click('.new-chat');
      await waitUI(`document.querySelector(${JSON.stringify(field)}).value === '' && !document.querySelector('.composer .attachment-chip')`);
    }
    assert.equal(Object.values(stored.drafts).filter(draft => draft.kind === 'new' && draft.text).length, 3);
    const keys = [];
    for (const [text, attachment] of drafts) keys.push(await openDraft(text, attachment, 3));
    assert.equal(new Set(keys).size, 3);
    assert.deepEqual(await run('[...document.querySelectorAll(".top-actions > .menu-anchor > button, .top-actions > button")].map(node=>node.getAttribute("aria-label"))'), ['会话操作', '查看当前对话产出与来源', '打开工作面板']);
    await showDrafts(3);
    await click('[role=dialog] button[aria-label="关闭对话框"]');
    await record('三份新草稿经真实DOM逐份回切，正文/独立附件/原归属和三个顶栏入口正确', {draftKeys: keys, draftOpens});

    await durable();
    const persisted = JSON.parse(await fs.readFile(workspaceFile, 'utf8'));
    assert.equal(Object.keys(persisted.drafts).length, 3);
    await load();
    for (const [index, [text, attachment]] of drafts.entries()) assert.equal(await openDraft(text, attachment, 3), keys[index]);
    await showDrafts(3);
    await click('[role=dialog] button[aria-label="关闭对话框"]');
    await record('重新载入持久JSON文件后，三份草稿仍可逐份打开且使用原键', {pageLoads, draftOpens, persistedDraftCount: 3});

    await openDraft(drafts[0][0], drafts[0][1], 3);
    const locationBeforeSend = await run('location.href');
    await click('.composer button[aria-label="发送消息"]');
    await wait(() => !!pendingRun, 'synthetic runPrepared pending');
    assert.equal(await run('!!document.querySelector("[role=dialog]")'), false, 'ordinary submission has no repeated privacy confirmation');
    const item = pendingRun, chatId = item.sessionId;
    const finalization = {runId: item.runId, executionStatus: 'failed', persistenceStatus: 'saved', processStatus: 'exited', eventWatermark: 1, error: {code: 'SYNTHETIC_DRAFT_FAILURE', stage: 'query', message: '合成网络失败'}};
    window.webContents.send('RuntimeEvent', {type: 'run/terminal', runId: item.runId, sessionId: chatId, status: 'failed', finalization});
    await wait(() => stored.chats.some(chat => chat.id === chatId && chat.messages.some(message => message.finalization?.error?.code === 'SYNTHETIC_DRAFT_FAILURE')), 'terminal persisted before IPC rejection');
    item.reject(new Error('SYNTHETIC_DRAFT_FAILURE')); pendingRun = null;
    await waitUI(`document.querySelector(${JSON.stringify(field)}).value === ${JSON.stringify(drafts[0][0])} && !document.querySelector('button[aria-label="停止生成"]')`);
    await durable();
    assert.equal(await run('location.href'), locationBeforeSend);
    assert.equal(await run('document.querySelector(".chat-row.selected")?.dataset.chatId'), chatId);
    assert.deepEqual(await attachmentNames(), ['native-one.txt']);
    assert(!Object.hasOwn(stored.drafts, keys[0]));
    assert.equal(stored.drafts[`chat:${chatId}`].kind, 'chat');
    assert.equal(stored.drafts[`chat:${chatId}`].chatId, chatId);
    assert.equal(stored.drafts[`chat:${chatId}`].workspaceId, 'office-home');
    assert.equal(stored.drafts[`chat:${chatId}`].projectId, null);
    assert.equal(stored.drafts[`chat:${chatId}`].text, drafts[0][0]);
    assert.equal(stored.drafts[`chat:${chatId}`].files[0].id, 'native-one');
    assert.equal(Object.values(stored.drafts).filter(draft => draft.kind === 'new' && draft.text).length, 2);
    await record('首次发送失败无需导航，同页恢复正文附件并绑定实际chat，原new键已消费', {chatId, sourceKey: keys[0], targetKey: `chat:${chatId}`, prepareRunCalls: prepared.length, runPreparedCalls});

    await click('button[aria-label="合成待删项目 的项目菜单"]');
    await textClick('[role=menuitem]', '在项目中聊天');
    await waitUI(`document.querySelector(${JSON.stringify(field)}).value === '' && !!document.querySelector('.project-row.selected')`);
    assert(!Object.values(stored.drafts).some(draft => draft.projectId === 'delete-project'));
    deferPick = true;
    await click('button[aria-label="添加内容"]');
    await click('.attachment-menu button[role="menuitem"]');
    await wait(() => !!finishPick, 'attachment reading still outstanding');
    await click('button[aria-label="合成待删项目 的项目菜单"]');
    await textClick('[role=menuitem]', '删除项目');
    await click('[role=dialog] .danger-button');
    await waitUI(`!document.querySelector('[role=dialog]') && !document.querySelector('.deletion-pending') && !document.querySelector('button[aria-label="合成待删项目 的项目菜单"]')`);
    await durable();
    const contentAfterDelete = await inputValue(), attachmentsAfterDelete = await attachmentNames();
    finishPick([file('DELETED_NATIVE_LATE_ATTACHMENT')]); finishPick = null;
    await waitUI(`!document.querySelector('.composer button[aria-label="添加内容"]').disabled`);
    await durable();
    assert.equal(await inputValue(), contentAfterDelete);
    assert.deepEqual(await attachmentNames(), attachmentsAfterDelete);
    assert.doesNotMatch(await fs.readFile(workspaceFile, 'utf8'), /DELETED_NATIVE_LATE_ATTACHMENT|delete-project/);
    assert.equal(await run('!!document.querySelector(".orphan-drafts")'), false);
    await load();
    await showDrafts(2);
    assert.equal(await run('!!document.querySelector(".orphan-drafts")'), false);
    assert.doesNotMatch(await fs.readFile(workspaceFile, 'utf8'), /DELETED_NATIVE_LATE_ATTACHMENT|delete-project/);
    await record('空项目草稿解析附件期间删除项目，迟到附件不复活，重载后仍无孤儿/删除marker', {pageLoads, filePickCalls, survivingNewDrafts: 2});

    assert.equal(prepared.length, 1); assert.equal(runPreparedCalls, 1); assert.equal(filePickCalls, 4); assert.equal(draftOpens, 7); assert.equal(pageLoads, 3);
    const fixtureChat = stored.chats.find(chat => chat.id === chatId);
    fixtureChat.messages.push(
      {id: 'old-context', role: 'assistant', text: '历史规划', context: {planning: true, goal: {phase: 'active', activation: 'armed', roundsStarted: 1, maxGoalRounds: 4}}},
      {id: 'current-context', role: 'assistant', text: '当前目标', context: {planning: false, goal: {phase: 'paused', roundsStarted: 2, maxGoalRounds: 4}}},
    );
    const preservedDraft = structuredClone(stored.drafts[`chat:${chatId}`]);
    await fs.writeFile(workspaceFile, JSON.stringify(stored));
    await load();
    await click(`.chat-row[data-chat-id="${chatId}"] .chat-link`);
    await waitUI(`document.querySelector(${JSON.stringify(field)}).value === ${JSON.stringify(preservedDraft.text)}`);
    assert.equal(await run('document.querySelectorAll(".context-usage button").length'), 1, 'historical state has no actionable controls');
    await textClick('.context-usage button', '继续目标');
    await wait(() => !!pendingRun, 'native command received by host interface');
    assert.equal(prepared.at(-1).command, '/goal resume');
    assert.equal(prepared.at(-1).sessionId, chatId);
    assert.deepEqual(prepared.at(-1).visualIds, []);
    pendingRun.resolve({text: '目标已完成', context: {planning: false, goal: null}}); pendingRun = null;
    await waitUI('document.querySelector(".transcript").innerText.includes("目标已完成") && !document.querySelector(".context-usage button")');
    await durable();
    assert.equal(await inputValue(), preservedDraft.text);
    assert.deepEqual(await attachmentNames(), ['native-one.txt']);
    assert.deepEqual(stored.drafts[`chat:${chatId}`], preservedDraft);
    await record('当前目标直接调用原生指令，历史按钮已收起，原草稿和附件保留', {chatId});

    assert.deepEqual(rendererErrors, []); assert.deepEqual(blockedNetwork, []); assert.equal(window.isVisible(), false);
    await fs.writeFile(path.join(__dirname, 'summary.json'), JSON.stringify({
      passed: true, layer, records: records.length, draftOpens, pageLoads, prepareRunCalls: prepared.length, runPreparedCalls, filePickCalls,
      requestedRevision, persistedRevision, rendererErrors, blockedNetwork, profile, show: window.isVisible(), versions: process.versions,
    }, null, 2));
  } catch (error) {
    exitCode = 1;
    console.error(error.stack);
    await fs.writeFile(path.join(__dirname, 'failure.json'), JSON.stringify({error: error.stack, records, rendererErrors, blockedNetwork}, null, 2));
  } finally {
    await saveTail.catch(() => {});
    window.destroy();
    app.exit(exitCode);
  }
}

test('Windows Electron真实App/DOM：三份新草稿回切及文件重载、首次失败chat归属、删除项目迟到附件', {timeout: 120000}, async context => {
  assert.equal(process.platform, 'win32', 'This isolated renderer contract requires Windows Electron.');
  const hashes = await sourceHashes();
  const root = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(root, 'zhixing-drafts-native-'));
  let child, closed, launchError, output = '';
  context.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    if (closed) await closed;
    try {
      // Opt-in evidence contains bounded text reports only, never profiles or bundles.
      if (process.env.ZHIXING_TEST_EVIDENCE_DIR) {
        const evidence = path.join(path.resolve(process.env.ZHIXING_TEST_EVIDENCE_DIR), path.basename(directory));
        await mkdir(evidence, {recursive: true});
        for (const name of ['journey.json', 'summary.json', 'failure.json', 'source-hashes.json']) {
          const body = await readFile(path.join(directory, name)).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
          if (body && body.length <= 64 * 1024) await writeFile(path.join(evidence, name), body);
        }
        await writeFile(path.join(evidence, 'electron.log'), Buffer.from(output).subarray(-64 * 1024));
        console.log(`Text evidence: ${evidence}`);
      }
    } finally {
      const resolved = await realpath(directory);
      assert.equal(path.dirname(resolved), root);
      assert(path.basename(resolved).startsWith('zhixing-drafts-native-'));
      await rm(resolved, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
    }
  });
  const renderer = await build({
    stdin: {resolveDir: repository, loader: 'jsx', contents: `import {createElement} from 'react'; import {createRoot} from 'react-dom/client'; import {App} from './src/App.jsx'; createRoot(document.getElementById('root')).render(createElement(App));`},
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: {'.css': 'empty'}, define: {'process.env.NODE_ENV': '"test"'}, logLevel: 'silent',
  });
  await writeFile(path.join(directory, 'renderer.js'), renderer.outputFiles[0].text);
  await writeFile(path.join(directory, 'styles.css'), await readFile(path.join(repository, 'src/styles.css')));
  await mkdir(path.join(directory, 'brand'));
  await writeFile(path.join(directory, 'brand/zhixing-bamboo.png'), await readFile(path.join(repository, 'public/brand/zhixing-bamboo.png')));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script defer src="renderer.js"></script></body></html>');
  await writeFile(path.join(directory, 'preload.cjs'), `
    const {contextBridge, ipcRenderer} = require('electron');
    const methods = ['loadWorkspace','saveWorkspace','workspaceSaveStatus','runtimeStatus','runtimeCleanupStatus','listAutomations','listMcp','browserState','browserLayout','windowControl','speechStatus','prepareRun','runPrepared','pickFiles'];
    const api = Object.fromEntries(methods.map(name => [name, (...args) => ipcRenderer.invoke('draft-fixture', name, args)]));
    for (const name of ['RuntimeEvent','AutomationChange','WorkspaceSaveState','PrepareToQuit','BrowserChange','SpeechEvent']) api['on' + name] = callback => {
      const listener = (_event, value) => callback(value); ipcRenderer.on(name, listener); return () => ipcRenderer.removeListener(name, listener);
    };
    contextBridge.exposeInMainWorld('zhixing', api);
  `);
  await writeFile(path.join(directory, 'main.cjs'), `(${nativeJourney.toString()})().catch(error => { console.error(error.stack); require('electron').app.exit(1); });`);
  await writeFile(path.join(directory, 'source-hashes.json'), JSON.stringify(hashes, null, 2));
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(require('electron'), [path.join(directory, 'main.cjs')], {env, signal: context.signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  closed = new Promise(resolve => child.once('close', (code, signal) => resolve([code, signal])));
  child.on('error', error => { launchError = error; });
  const collect = data => { output = (output + data).slice(-256 * 1024); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const [code] = await closed;
  if (launchError) throw launchError;
  assert.equal(code, 0, output);
  const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
  assert.equal(summary.passed, true); assert.equal(summary.records, 5); assert.equal(summary.show, false);
  assert.equal(summary.draftOpens, 7); assert.equal(summary.pageLoads, 4); assert.equal(summary.prepareRunCalls, 2); assert.equal(summary.runPreparedCalls, 2); assert.equal(summary.filePickCalls, 4);
  assert.deepEqual(summary.rendererErrors, []); assert.deepEqual(summary.blockedNetwork, []);
  assert.deepEqual(await sourceHashes(), hashes, 'App/store/conversation-state remain frozen throughout this verification');
  console.log(`${output.trim()}\nLayer: ${summary.layer}\nCheckpoints: ${summary.records}; draft opens: ${summary.draftOpens}; page loads: ${summary.pageLoads}; model executions: 0; synthetic runPrepared: ${summary.runPreparedCalls}\nIsolated temporary files are removed after verification.`);
});

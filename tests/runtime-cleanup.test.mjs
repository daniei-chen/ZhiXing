import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';

const app = process.env.ZHIXING_TEST_PACKED_APP;
const moduleUrl = name => app
 ? pathToFileURL(path.join(app, name)).href
 : new URL(`../${name}`, import.meta.url).href;
const {RuntimeManager} = await import(moduleUrl('electron/runtime.mjs'));
const {writeBridge, readBridge} = await import(moduleUrl('harness/privacy-bridge.mjs'));

async function createFixture({startError, runError, missingContext = false, contextId = 'cleanup-session', closeFails = true} = {}) {
 const parent = await fs.realpath(os.tmpdir());
 const root = await fs.mkdtemp(path.join(parent, 'zhixing-runtime-cleanup-'));
 const vaults = new Map();
 const closeError = new Error('runtime process did not exit within 6000ms after SIGKILL was refused');
 const child = Object.assign(new EventEmitter(), {exitCode: null, signalCode: null});
 const closeEntryCodes = [];
 let closes = 0;
 const manager = new RuntimeManager({
  root,
  readVault: async id => vaults.get(id),
  writeVault: async (id, state) => vaults.set(id, state),
  createGateway: async () => ({baseUrl: 'http://127.0.0.1:1', apiKey: 'synthetic-test-key', close: async () => {}}),
  createHarness: async (directory, configuration) => ({
   zhixingProcess: child,
   async start() {
    if (startError) throw startError;
    if (missingContext) return;
    await writeBridge(path.join(directory, 'context.bin'), configuration.bridgeKey, {
     [contextId]: {tools: [], skills: []},
    });
   },
   async close() {
    closes++;
    closeEntryCodes.push(child.exitCode);
    if (closeFails) throw closeError;
    child.exitCode = configuration.exitCode ?? 0;
    child.emit('exit', child.exitCode, child.signalCode);
   },
   client: {
    request: async () => ({}),
    subscribeSessionTree() {
     let release;
     const closed = new Promise(resolve => { release = resolve; });
     // This synthetic subscription emits no events; closing ends the empty sequence.
     return {tryNext: () => undefined, close: release, async *[Symbol.asyncIterator]() { await closed; yield* []; }};
    },
   },
   session: () => ({run: async () => {
    if (runError) throw runError;
    return {finishReason: 'completed', finalResponse: 'Synthetic result'};
   }}),
  }),
 });
 return {
  root, manager, vaults, closeError, child, closeEntryCodes, closeCount: () => closes,
  config: {baseUrl: 'https://synthetic.invalid', model: 'synthetic-model', reasoning: 'off'},
  async close() {
   await manager.close();
   const target = await fs.realpath(root);
   assert.equal(path.dirname(target), parent);
   assert(path.basename(target).startsWith('zhixing-runtime-cleanup-'));
   await fs.rm(target, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
  },
 };
}

test('运行失败与 SDK 关闭失败保留各自原因，关闭未确认时保留恢复文件', async () => {
 const operationError = new Error('Synthetic session query failed');
 const fixture = await createFixture({runError: operationError});
 try {
  await assert.rejects(fixture.manager.run({
   runId: 'cleanup-run', sessionId: 'cleanup-session', prompt: 'Synthetic prompt', privacyMode: 'redact',
  }, fixture.config, 'synthetic-test-key'), error => {
   assert(error instanceof AggregateError);
   assert.equal(error.cause, operationError);
   assert.equal(error.errors[0], operationError);
   assert.equal(error.errors[1].code, 'RUNTIME_CLOSE_FAILED');
   assert.equal(error.errors[1].stage, 'close');
   assert.equal(error.errors[1].cause, fixture.closeError);
   return true;
  });
  assert.equal(fixture.closeCount(), 1);
  const saved = fixture.vaults.get('cleanup-session');
  const state = await readBridge(path.join(fixture.root, 'cleanup-session', 'privacy-bridge.bin'), saved.historyKey);
  assert.equal(state.id, 'cleanup-session');
  await fs.access(path.join(fixture.root, 'cleanup-session', 'context.bin'));
  assert.equal((await fixture.manager.waitForRun('cleanup-run')).status, 'failed');
 } finally {
  await fixture.close();
 }
});

test('目录等待超时后 SDK 关闭也失败时保留 context 和 close 两层诊断', {timeout: 15000}, async () => {
 const fixture = await createFixture({missingContext: true});
 try {
  await assert.rejects(fixture.manager.run({
   runId: 'cleanup-context', sessionId: 'cleanup-session', prompt: 'Synthetic prompt', privacyMode: 'redact',
  }, fixture.config, 'synthetic-test-key'), error => {
   assert(error instanceof AggregateError);
   assert.equal(error.errors[0].code, 'RUNTIME_CONTEXT_TIMEOUT');
   assert.equal(error.errors[0].stage, 'context');
   assert.equal(error.errors[0].details.sessionId, 'cleanup-session');
   assert.equal(error.errors[0].details.sessionPresent, false);
   assert.equal(error.errors[0].details.readErrorCode, 'ENOENT');
   assert.equal(error.errors[1].code, 'RUNTIME_CLOSE_FAILED');
   assert.equal(error.errors[1].cause, fixture.closeError);
   assert.equal(error.cause, error.errors[0]);
   return true;
  });
  assert.equal(fixture.closeCount(), 1);
  await fs.access(path.join(fixture.root, 'cleanup-session', 'privacy-bridge.bin'));
 } finally {
  await fixture.close();
 }
});

test('只有 SDK 关闭失败时返回单一分层原因，不误报交办成功或删除临时恢复文件', async () => {
 const fixture = await createFixture();
 try {
  await assert.rejects(fixture.manager.run({
   runId: 'cleanup-run', sessionId: 'cleanup-session', prompt: 'Synthetic prompt', privacyMode: 'redact',
  }, {...fixture.config, persist: false}, 'synthetic-test-key'), error => {
   assert.equal(error.code, 'RUNTIME_CLOSE_FAILED');
   assert.equal(error.cause, fixture.closeError);
   assert.equal(error instanceof AggregateError, false);
   return true;
  });
  assert.equal(fixture.closeCount(), 1);
  await fs.access(path.join(fixture.root, 'cleanup-session', 'privacy-bridge.bin'));
  await fs.access(path.join(fixture.root, 'cleanup-session', 'context.bin'));
  assert.equal((await fixture.manager.waitForRun('cleanup-run')).status, 'failed');
 } finally {
  await fixture.close();
 }
});

test('目录检查启动失败与关闭失败均可诊断，未确认退出时保留独立检查目录', async () => {
 const startError = new Error('Synthetic initialize failed');
 const fixture = await createFixture({startError});
 try {
  await assert.rejects(fixture.manager.check(fixture.config, 'synthetic-test-key'), error => {
   assert(error instanceof AggregateError);
   assert.equal(error.errors[0], startError);
   assert.equal(error.errors[1].code, 'RUNTIME_CLOSE_FAILED');
   assert.equal(error.errors[1].cause, fixture.closeError);
   return true;
  });
  assert.equal(fixture.closeCount(), 1);
  const directories = await fs.readdir(fixture.root);
  assert.equal(directories.length, 1);
  assert(directories[0].startsWith('check-'));
  await fs.access(path.join(fixture.root, directories[0], 'mcp.bin'));
 } finally {
  await fixture.close();
 }
});

test('SDK close resolution records process termination even when the exit status is nonzero', async () => {
 const fixture = await createFixture({contextId: 'kernel-check', closeFails: false});
 const exitCode = 3221226505;
 const exits = [];
 fixture.child.on('exit', (code, signal) => exits.push({code, signal}));
 try {
  assert.equal(fixture.child.exitCode, null);
  const report = await fixture.manager.check({...fixture.config, exitCode}, 'synthetic-test-key');
  assert.deepEqual(report, {tools: [], skills: []});
  assert.deepEqual(fixture.closeEntryCodes, [null]);
  assert.equal(fixture.child.exitCode, exitCode);
  assert.deepEqual(exits, [{code: exitCode, signal: null}]);
  assert.equal(fixture.closeCount(), 1);
  assert.deepEqual(await fs.readdir(fixture.root), []);
 } finally {
  await fixture.close();
 }
});

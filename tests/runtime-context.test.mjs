import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const app = process.env.ZHIXING_TEST_PACKED_APP;
const moduleUrl = name => app
 ? pathToFileURL(path.join(app, name)).href
 : new URL(`../${name}`, import.meta.url).href;
const {apply} = await import(moduleUrl('harness/office-context.mjs'));
const {createBridgeKey, readBridge, writeBridge, updateBridge} = await import(moduleUrl('harness/privacy-bridge.mjs'));

async function createFixture({listSkills} = {}) {
 const parent = await fs.realpath(os.tmpdir());
 const root = await fs.mkdtemp(path.join(parent, 'zhixing-context-regression-'));
 const file = path.join(root, 'context.bin');
 const key = createBridgeKey();
 const previous = {file: process.env.ZHIXING_CONTEXT_FILE, key: process.env.ZHIXING_BRIDGE_KEY};
 const handlers = new Map();
 const errors = [];
 process.env.ZHIXING_CONTEXT_FILE = file;
 process.env.ZHIXING_BRIDGE_KEY = key;
 apply({
  on: (event, handler) => handlers.set(event, handler),
  agents: {get: () => undefined},
  tokenMeter: {measure: () => ({totalTokens: 12}), contextPressure: () => ({ratio: 0.1})},
  sessionProjections: {snapshot: () => ({values: {sessionStats: {turns: 1}}})},
  tools: {definitions: () => [{name: 'office_calculate', description: 'Synthetic calculation'}]},
  skills: {list: listSkills || (async () => [{name: 'synthetic-office', description: 'Synthetic skill'}])},
  logger: {error: (...args) => errors.push(args)},
 });
 return {
  file, errors,
  emit: id => handlers.get('session/event')({id}, {type: 'turn/end'}),
  flush: () => handlers.get('session/flush')(),
  read: () => readBridge(file, key),
  async close() {
   try { await handlers.get('dispose')(); }
   finally {
    for (const [name, value] of [['ZHIXING_CONTEXT_FILE', previous.file], ['ZHIXING_BRIDGE_KEY', previous.key]]) {
     if (value === undefined) delete process.env[name];
     else process.env[name] = value;
    }
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert(path.basename(resolved).startsWith('zhixing-context-regression-'));
    await fs.rm(resolved, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
   }
  },
 };
}

test('子会话的后续快照保留父会话完整的工具与技能目录', async () => {
 const fixture = await createFixture();
 try {
  fixture.emit('parent-session');
  await fixture.flush();
  assert(Array.isArray((await fixture.read())['parent-session'].skills));
  fixture.emit('child-session');
  await fixture.flush();
  const reports = await fixture.read();
  assert.deepEqual(fixture.errors, []);
  assert.deepEqual(reports['child-session'].skills.map(skill => skill.name), ['synthetic-office']);
  assert.deepEqual(reports['parent-session'].skills?.map(skill => skill.name), ['synthetic-office']);
  assert.equal(reports['parent-session'].measurement.totalTokens, 12);
  assert.equal(reports['parent-session'].tools[0].name, 'office_calculate');
 } finally { await fixture.close(); }
});

test('技能目录延迟时 session flush 等待全部已排队的父子快照', async () => {
 let releaseSkills, lists = 0;
 const skillGate = new Promise(resolve => { releaseSkills = resolve; });
 const fixture = await createFixture({listSkills: async () => { lists++; return skillGate; }});
 try {
  fixture.emit('parent-session');
  fixture.emit('child-session');
  fixture.emit('grandchild-session');
  let flushed = false;
  const flushing = fixture.flush().then(() => { flushed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(flushed, false);
  releaseSkills([{name: 'delayed-synthetic-skill'}]);
  await flushing;
  const reports = await fixture.read();
  assert.equal(lists, 1);
  assert.deepEqual(Object.keys(reports).sort(), ['child-session', 'grandchild-session', 'parent-session']);
  for (const report of Object.values(reports)) assert.deepEqual(report.skills.map(skill => skill.name), ['delayed-synthetic-skill']);
 } finally {
  releaseSkills([]);
  await fixture.close();
 }
});

test('一次快照写入失败不会永久阻断后续目录保存', async () => {
 const fixture = await createFixture();
 try {
  await fs.mkdir(fixture.file);
  fixture.emit('parent-session');
  await assert.rejects(fixture.flush());
  assert.equal(fixture.errors.length, 1);
  await fs.rmdir(fixture.file);
  fixture.emit('child-session');
  await fixture.flush();
  const reports = await fixture.read();
  assert.deepEqual(reports['parent-session'].skills.map(skill => skill.name), ['synthetic-office']);
  assert.deepEqual(reports['child-session'].skills.map(skill => skill.name), ['synthetic-office']);
 } finally { await fixture.close(); }
});

async function createCommitFixture() {
 const parent = await fs.realpath(os.tmpdir());
 const root = await fs.mkdtemp(path.join(parent, 'zhixing-bridge-commit-'));
 const file = path.join(root, 'context.bin'), key = createBridgeKey(), original = {count: 0};
 await writeBridge(file, key, original);
 const originalBytes = await fs.readFile(file);
 return {root, file, key, original, originalBytes, async close() {
  const resolved = await fs.realpath(root);
  assert.equal(path.dirname(resolved), parent);
  assert(path.basename(resolved).startsWith('zhixing-bridge-commit-'));
  await fs.rm(resolved, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
 }};
}

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
 test(`加密桥 Windows ${code} 短暂占用只重试同一密文 temp，旧目标保持可读`, async t => {
  const f = await createCommitFixture(), rename = fs.rename.bind(fs), writeFile = fs.writeFile.bind(fs);
  const fault = Object.assign(new Error(`Synthetic rename ${code}`), {code});
  const next = {count: 1, marker: 'SYNTHETIC_BRIDGE_COMMIT_PAYLOAD'};
  const attempts = [];let writes = 0, serializations = 0, encrypted;
  try {
   t.mock.method(fs, 'writeFile', async (...args) => {writes++;return writeFile(...args);});
   t.mock.method(fs, 'rename', async (temp, target) => {
    attempts.push([temp, target]);assert.equal(target, f.file);
    assert.deepEqual(await fs.readFile(f.file), f.originalBytes);
    assert.deepEqual(await readBridge(f.file, f.key), f.original);
    const bytes = await fs.readFile(temp);encrypted ??= bytes;
    assert.deepEqual(bytes, encrypted);assert(!bytes.includes(Buffer.from(next.marker)));
    if (attempts.length === 1) throw fault;
    return rename(temp, target);
   });
   const writing = writeBridge(f.file, f.key, {toJSON() {serializations++;return next;}});
   if (process.platform === 'win32') {
    await writing;assert.equal(attempts.length, 2);assert.deepEqual(attempts[1], attempts[0]);
    assert.deepEqual(await readBridge(f.file, f.key), next);
    assert.deepEqual(await fs.readFile(f.file), encrypted);
   } else {
    await assert.rejects(writing, error => error === fault);assert.equal(attempts.length, 1);
    assert.deepEqual(await fs.readFile(f.file), f.originalBytes);
   }
   assert.equal(writes, 1);assert.equal(serializations, 1);
   assert.deepEqual(await fs.readdir(f.root), ['context.bin']);
  } finally {t.mock.restoreAll();await f.close();}
 });
}

test('加密桥 Windows 持续占用有界失败，保留原错误与旧文件且仅清理 temp', async t => {
 const f = await createCommitFixture(), writeFile = fs.writeFile.bind(fs), unlink = fs.unlink.bind(fs);
 const fault = Object.assign(new Error('Synthetic persistent rename EPERM'), {code: 'EPERM'});
 const attempts = [], unlinks = [];let writes = 0, encrypted;
 try {
  t.mock.method(fs, 'writeFile', async (...args) => {writes++;return writeFile(...args);});
  t.mock.method(fs, 'unlink', async file => {unlinks.push(file);assert.notEqual(file, f.file);return unlink(file);});
  t.mock.method(fs, 'rename', async (temp, target) => {
   attempts.push([temp, target]);assert.equal(target, f.file);
   const bytes = await fs.readFile(temp);encrypted ??= bytes;assert.deepEqual(bytes, encrypted);
   assert.deepEqual(await fs.readFile(f.file), f.originalBytes);throw fault;
  });
  await assert.rejects(writeBridge(f.file, f.key, {count: 1}), error => error === fault);
  assert.equal(attempts.length, process.platform === 'win32' ? 9 : 1);
  for (const attempt of attempts) assert.deepEqual(attempt, attempts[0]);
  assert.equal(writes, 1);assert.deepEqual(unlinks, [attempts[0][0]]);
  assert.deepEqual(await readBridge(f.file, f.key), f.original);
  assert.deepEqual(await fs.readdir(f.root), ['context.bin']);
 } finally {t.mock.restoreAll();await f.close();}
});

test('加密桥 Windows 第八次重试仍可提交，不重新序列化或写密文', async t => {
 const f = await createCommitFixture(), rename = fs.rename.bind(fs), writeFile = fs.writeFile.bind(fs);
 const fault = Object.assign(new Error('Synthetic rename EPERM through retry seven'), {code: 'EPERM'});
 let attempts = 0, writes = 0, serializations = 0, source, encrypted;
 try {
  t.mock.method(fs, 'writeFile', async (...args) => {writes++;return writeFile(...args);});
  t.mock.method(fs, 'rename', async (temp, target) => {
   attempts++;source ??= temp;assert.equal(temp, source);assert.equal(target, f.file);
   const bytes = await fs.readFile(temp);encrypted ??= bytes;assert.deepEqual(bytes, encrypted);
   if (attempts <= 8) {assert.deepEqual(await fs.readFile(f.file), f.originalBytes);throw fault;}
   return rename(temp, target);
  });
  const writing = writeBridge(f.file, f.key, {toJSON() {serializations++;return {count: 1};}});
  if (process.platform === 'win32') {
   await writing;assert.equal(attempts, 9);assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
  } else {
   await assert.rejects(writing, error => error === fault);assert.equal(attempts, 1);
  }
  assert.equal(writes, 1);assert.equal(serializations, 1);assert.deepEqual(await fs.readdir(f.root), ['context.bin']);
 } finally {t.mock.restoreAll();await f.close();}
});

test('加密桥非暂时 rename 错误立即失败，不删除或覆盖旧目标', async t => {
 const f = await createCommitFixture();let attempts = 0;
 const fault = Object.assign(new Error('Synthetic rename ENOENT'), {code: 'ENOENT'});
 try {
  t.mock.method(fs, 'rename', async () => {attempts++;throw fault;});
  await assert.rejects(writeBridge(f.file, f.key, {count: 1}), error => error === fault);
  assert.equal(attempts, 1);assert.deepEqual(await fs.readFile(f.file), f.originalBytes);
  assert.deepEqual(await fs.readdir(f.root), ['context.bin']);
 } finally {t.mock.restoreAll();await f.close();}
});

test('加密桥写 temp 失败不重试写入或 rename，清理半成品并保留旧目标', async t => {
 const f = await createCommitFixture(), writeFile = fs.writeFile.bind(fs);let writes = 0, renames = 0;
 const fault = Object.assign(new Error('Synthetic write ENOSPC'), {code: 'ENOSPC'});
 try {
  t.mock.method(fs, 'writeFile', async (file, bytes, options) => {writes++;await writeFile(file, bytes.subarray(0, 12), options);throw fault;});
  t.mock.method(fs, 'rename', async () => {renames++;});
  await assert.rejects(writeBridge(f.file, f.key, {count: 1}), error => error === fault);
  assert.equal(writes, 1);assert.equal(renames, 0);assert.deepEqual(await fs.readFile(f.file), f.originalBytes);
  assert.deepEqual(await fs.readdir(f.root), ['context.bin']);
 } finally {t.mock.restoreAll();await f.close();}
});

test('加密桥 rename 重试期间保持跨调用锁独占，更新回调仅执行一次', async t => {
 const f = await createCommitFixture(), rename = fs.rename.bind(fs), writeFile = fs.writeFile.bind(fs);
 const fault = Object.assign(new Error('Synthetic locked commit EPERM'), {code: 'EPERM'});
 let release, entered, pending, attempts = 0, writes = 0, updates = 0, competingUpdates = 0, owner;
 const gate = new Promise(resolve => {release = resolve;}), started = new Promise(resolve => {entered = resolve;});
 try {
  t.mock.method(fs, 'writeFile', async (...args) => {if (String(args[0]).startsWith(`${f.file}.`) && String(args[0]).endsWith('.tmp')) writes++;return writeFile(...args);});
  t.mock.method(fs, 'rename', async (temp, target) => {
   attempts++;assert.equal(target, f.file);
   const current = JSON.parse(await fs.readFile(path.join(`${f.file}.lock`, 'owner.json'), 'utf8'));
   owner ??= current;assert.deepEqual(current, owner);
   if (attempts === 1) {entered();await gate;throw fault;}
   return rename(temp, target);
  });
  pending = updateBridge(f.file, f.key, state => {updates++;return {state: {count: state.count + 1}, value: 'committed'};});
  const outcome = pending.then(value => ({value}), error => ({error}));
  await started;
  await assert.rejects(updateBridge(f.file, f.key, state => {competingUpdates++;return {state};}, {timeoutMs: 25}), /繁忙/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(`${f.file}.lock`, 'owner.json'), 'utf8')), owner);
  assert.deepEqual(await readBridge(f.file, f.key), f.original);
  release();const settled = await outcome;
  if (process.platform === 'win32') {
   if (settled.error) throw settled.error;
   assert.equal(settled.value, 'committed');assert.equal(attempts, 2);
   assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
  } else {assert.equal(settled.error, fault);assert.equal(attempts, 1);}
  assert.equal(updates, 1);assert.equal(competingUpdates, 0);assert.equal(writes, 1);
  assert.deepEqual(await fs.readdir(f.root), ['context.bin']);
 } finally {release();await pending?.catch(()=>{});t.mock.restoreAll();await f.close();}
});

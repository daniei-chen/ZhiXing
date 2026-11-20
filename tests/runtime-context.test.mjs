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
const {createBridgeKey, readBridge} = await import(moduleUrl('harness/privacy-bridge.mjs'));

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

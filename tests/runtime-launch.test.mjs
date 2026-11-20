import test from 'node:test';
import assert from 'node:assert/strict';
import diagnostics from 'node:diagnostics_channel';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const app = process.env.ZHIXING_TEST_PACKED_APP;
const {RuntimeManager} = await import(app
 ? pathToFileURL(path.join(app, 'electron/runtime.mjs')).href
 : '../electron/runtime.mjs');

test('SDK 内核使用指定独立 Node，连续目录检查均确认 exit 和 close', {timeout: 90000}, async () => {
 const parent = await fs.realpath(os.tmpdir());
 const root = await fs.mkdtemp(path.join(parent, 'zhixing-runtime-launch-'));
 const executable = path.resolve(process.env.ZHIXING_TEST_NODE_EXECUTABLE || (app ? path.join(app, 'runtime', 'node.exe') : process.execPath));
 const children = [];
 const channel = diagnostics.channel('child_process');
 const observe = ({process: child}) => {
  child.once('spawn', () => {
   if (!child.spawnargs.some(arg => arg.replaceAll('\\', '/').endsWith('/dsh/lib/bin.js'))) return;
   const events = [];
   const closed = new Promise(resolve => child.once('close', (code, signal) => {
    events.push('close');
    resolve({code, signal});
   }));
   child.once('exit', () => events.push('exit'));
   children.push({child, closed, events});
  });
 };
 const manager = new RuntimeManager({root, readVault: async () => null, writeVault: async () => {}});
 channel.subscribe(observe);
 try {
  for (let i = 0; i < 4; i++) {
   const before = children.length;
   const report = await manager.check({
    model: 'synthetic-launch-check', reasoning: 'off', nodeExecutable: executable,
    kernel: {webEnabled: false, workflowEnabled: false, subagentDepth: 0},
   }, 'synthetic-no-model-request');
   assert(report.tools.length > 0);
   assert(report.skills.length > 0);
   assert.equal(children.length, before + 1);
   const record = children.at(-1);
   assert.equal(path.resolve(record.child.spawnfile), executable);
   assert.equal(record.child.exitCode, 0);
   assert.deepEqual(await record.closed, {code: 0, signal: null});
   assert.deepEqual(record.events, ['exit', 'close']);
  }
 } finally {
  channel.unsubscribe(observe);
  await manager.close();
  const target = await fs.realpath(root);
  assert.equal(path.dirname(target), parent);
  assert(path.basename(target).startsWith('zhixing-runtime-launch-'));
  await fs.rm(target, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
 }
});

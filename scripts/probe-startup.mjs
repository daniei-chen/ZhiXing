// Measure packaged launch stages on this machine.
//
//   node scripts/probe-startup.mjs "release/win-unpacked/知行.exe" 5
//
// Each run starts the packaged app with a throwaway profile, waits for the
// composer to become editable, and reports both the renderer timeline and the
// main-process stage marks printed when ZHIXING_STARTUP_TRACE=1. Launch noise on
// Windows is a few hundred milliseconds, so compare medians over at least five
// runs instead of single samples.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {connectUi} from './qa-cdp.mjs';

const exe = path.resolve(process.argv[2] || 'release/win-unpacked/知行.exe');
const runs = Number(process.argv[3] || 3);
const results = [];
for (let index = 1; index <= runs; index++) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-startup-'));
  const marks = {spawn: Date.now()};
  const env = {...process.env, ZHIXING_STARTUP_TRACE: '1'};
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  let trace = '';
  const child = spawn(exe, [`--user-data-dir=${profile}`, '--inspect=127.0.0.1:0', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    {cwd: profile, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
  child.stderr.on('data', chunk => { trace += chunk; });
  const closed = once(child, 'close');
  const portsFile = path.join(profile, 'DevToolsActivePort');
  let ui = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`app exited early with ${child.exitCode}`);
    if (!ui) {
      const ports = await fs.readFile(portsFile, 'utf8').catch(() => null);
      if (ports) {
        marks.debugPort = Date.now();
        ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
        if (ui) marks.cdp = Date.now();
      }
    }
    if (ui) {
      const ready = await ui.evaluate(`!!document.querySelector('textarea[aria-label="聊天输入框"]') && !document.querySelector('textarea[aria-label="聊天输入框"]').disabled`).catch(() => false);
      if (ready) { marks.interactive = Date.now(); break; }
    }
    await pause(50);
  }
  if (!marks.interactive) throw new Error('interface did not become interactive');
  const painted = await ui.evaluate(`(()=>{const e=performance.getEntriesByType('paint').find(r=>r.name==='first-contentful-paint');return e?Math.round(e.startTime):null})()`).catch(() => null);
  const navigation = await ui.evaluate(`(()=>{const n=performance.getEntriesByType('navigation')[0];return n?{domContentLoaded:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd),responseEnd:Math.round(n.responseEnd)}:null})()`).catch(() => null);
  ui.close();
  child.kill();
  await closed;
  await fs.rm(profile, {recursive: true, force: true}).catch(() => {});
  const row = {run: index,
    stages: Object.fromEntries([...trace.matchAll(/\[startup\] (\S+) \+(\d+)ms/g)].map(match => [match[1], Number(match[2])])),
    spawnToDebugPortMs: marks.debugPort - marks.spawn, spawnToCdpMs: marks.cdp - marks.spawn,
    spawnToInteractiveMs: marks.interactive - marks.spawn,
    rendererFirstContentfulPaintMs: painted, rendererNavigation: navigation};
  results.push(row);
  console.log(JSON.stringify(row));
}
const median = key => {
  const values = results.map(row => row[key]).filter(value => typeof value === 'number').sort((left, right) => left - right);
  return values.length ? values[Math.floor(values.length / 2)] : null;
};
const stageNames = [...new Set(results.flatMap(row => Object.keys(row.stages)))];
const stageMedians = Object.fromEntries(stageNames.map(name => {
  const values = results.map(row => row.stages[name]).filter(value => typeof value === 'number').sort((left, right) => left - right);
  return [name, values.length ? values[Math.floor(values.length / 2)] : null];
}));
console.log(JSON.stringify({summary: {runs, spawnToDebugPortMs: median('spawnToDebugPortMs'), spawnToCdpMs: median('spawnToCdpMs'),
  spawnToInteractiveMs: median('spawnToInteractiveMs'), rendererFirstContentfulPaintMs: median('rendererFirstContentfulPaintMs'), stageMedians}}));

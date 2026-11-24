// 自动更新下载完的安装包会一直留在 %LOCALAPPDATA%\<updaterCacheDirName>\pending。
// 这个脚本在 Windows 实包上验证启动时的清理：把 LOCALAPPDATA 指到临时目录，预先
// 放一个「已经装过的旧版本」和一个「正在等待的新版本」，启动真实应用，读
// app.log 的 updater.cache-pruned，再核对磁盘上到底剩下什么。
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { connectUi } from './qa-cdp.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = process.cwd();
const exe = path.resolve(process.argv[2] || path.join(root, 'release/win-unpacked/知行.exe'));
const appRoot = path.dirname(exe);
const provenance = JSON.parse(await fs.readFile(path.join(appRoot, 'resources/app/build-provenance.json'), 'utf8'));
const evidence = path.join(root, `.preview/qa-${provenance.version}/updater-cache`, `run-${Date.now().toString(36)}`);
const report = { layer: 'windows-packaged-app', version: provenance.version, sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty, exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'), status: 'running', cases: [] };
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const cacheName = 'zhixing-updater';
const seed = async (localAppData, files) => {
  const pending = path.join(localAppData, cacheName, 'pending');
  await fs.mkdir(pending, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(pending, name), Buffer.alloc(bytes, 7));
  return pending;
};

let log = null, child = null, ui = null;
async function launch({ localAppData, label }) {
  const profile = path.join(evidence, `profile-${label}`);
  await fs.mkdir(profile, { recursive: true });
  const logfile = path.join(evidence, `app-${label}.log`);
  log = await fs.open(logfile, 'a');
  const portsFile = path.join(profile, 'DevToolsActivePort'); await fs.rm(portsFile, { force: true });
  const env = { ...process.env, LOCALAPPDATA: localAppData }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  child = spawn(exe, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
  const exit = once(child, 'close');
  const deadline = Date.now() + 45000;
  while (!ui && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited at launch (${child.exitCode})`);
    const ports = await fs.readFile(portsFile, 'utf8').catch(() => null);
    if (ports) ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
    if (!ui) await pause(120);
  }
  assert.ok(ui, `${label}: renderer test connection started`);
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 45000);
  return { profile, logfile, exit };
}

async function shutdown({ exit }) {
  if (!ui) return;
  await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {});
  const closed = await Promise.race([exit, pause(30000, null).then(() => null)]);
  if (!closed) { child.kill(); await exit; }
  ui.close(); ui = null;
  await log.close();
}

const waitForLog = async (file, pattern, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    const match = text.split(/\r?\n/).map(line => line.match(pattern)).filter(Boolean).at(-1);
    if (match) return match;
    await pause(250);
  }
  return null;
};

// 场景一：一个过期版本 + 一个正在等待的新版本。旧的要清掉，新的必须留着。
const caseA = path.join(evidence, 'localappdata-a');
const pendingA = await seed(caseA, { 'ZhiXing-0.0.9-x64.exe': 4096, 'ZhiXing-99.0.0-x64.exe': 2048, 'current.blockmap': 100, 'update-info.json': 120 });
const sessionA = await launch({ localAppData: caseA, label: 'a' });
const prunedA = await waitForLog(sessionA.logfile, /updater\.cache-pruned (\{.*\})/);
assert.ok(prunedA, '场景一：app.log 里出现了 updater.cache-pruned');
const detailA = JSON.parse(prunedA[1]);
const remainingA = (await fs.readdir(pendingA)).sort();
assert.deepEqual(remainingA, ['ZhiXing-99.0.0-x64.exe', 'current.blockmap', 'update-info.json'],
  `过期安装包应被删除、待装的新版本应保留，实际剩余 ${remainingA.join(',')}`);
assert.equal(detailA.files, 1, `只该删一个文件，实际 ${detailA.files}`);
assert.equal(detailA.bytes, 4096, `删除字节数应为 4096，实际 ${detailA.bytes}`);
await record('已装过的旧安装包被删除，正在等待的新版本原样保留（含它的元数据）', { remaining: remainingA, pruned: detailA });
await shutdown(sessionA);

// 场景二：只剩一个过期版本。安装包、blockmap、update-info 全部该消失，pending 目录也要收走。
const caseB = path.join(evidence, 'localappdata-b');
const pendingB = await seed(caseB, { 'ZhiXing-0.0.8-x64.exe': 2048, 'current.blockmap': 100, 'update-info.json': 120 });
const sessionB = await launch({ localAppData: caseB, label: 'b' });
const prunedB = await waitForLog(sessionB.logfile, /updater\.cache-pruned (\{.*\})/);
assert.ok(prunedB, '场景二：app.log 里出现了 updater.cache-pruned');
const detailB = JSON.parse(prunedB[1]);
assert.equal(detailB.files, 3, `没有待装安装包时元数据一并清理，实际删了 ${detailB.files} 个`);
assert.equal(await fs.readdir(pendingB).then(items => items.length, () => 0), 0, 'pending 目录应被收走');
await record('没有待装安装包时，连同 blockmap 与 update-info.json 一起清空并收走 pending 目录', { pruned: detailB });
await shutdown(sessionB);

// 场景三：缓存目录不存在时不能报错，也不能影响启动。
const caseC = path.join(evidence, 'localappdata-c');
await fs.mkdir(caseC, { recursive: true });
const sessionC = await launch({ localAppData: caseC, label: 'c' });
await pause(1500);
const logC = await fs.readFile(sessionC.logfile, 'utf8');
assert.ok(!/updater\.cache-prune-failed/.test(logC), '没有缓存目录时不该出现清理失败日志');
const startedC = await fs.readFile(path.join(sessionC.profile, 'zhixing/logs/app.log'), 'utf8');
assert.match(startedC, /app\.start/);
await record('缓存目录不存在时启动照常，不记录清理失败', { prunedLogged: false });
await shutdown(sessionC);

report.status = 'passed';
await persist();
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, evidence }, null, 2));

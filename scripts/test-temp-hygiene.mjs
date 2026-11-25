// 安装/卸载器会在 %TEMP% 留下 NSIS 临时目录。本机实测：0.14.5 卸载后
// `~nsu.tmp` 连同 200 KB 的 Un_A.exe 一直留着。这个脚本在 Windows 实包上验证
// 启动时的清理：把子进程的 TEMP/TMP 指到临时目录，预放「带产品名的旧副本」和
// 「别家应用的同名副本」，启动真实应用，核对删了哪一个、日志怎么记的。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/temp-hygiene`, `run-${Date.now().toString(36)}`);
const report = { layer: 'windows-packaged-app', version: provenance.version, sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty, exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'), status: 'running', cases: [] };
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const ours = '~nsu.tmp';
const foreign = 'nsHOST.tmp';
const mkOld = async (dir, file, bytes) => {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, file);
  await fs.writeFile(target, bytes);
  const when = new Date(Date.now() - 45 * 60 * 1000);
  await fs.utimes(target, when, when);
  await fs.utimes(dir, when, when);
  return target;
};

let ui = null, child = null, log = null;
async function launch({ tempDir, profile }) {
  await fs.mkdir(profile, { recursive: true });
  const logfile = path.join(evidence, 'app.log');
  log = await fs.open(logfile, 'a');
  const portsFile = path.join(profile, 'DevToolsActivePort');
  await fs.rm(portsFile, { force: true });
  const env = { ...process.env, TEMP: tempDir, TMP: tempDir };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
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
  assert.ok(ui, 'renderer test connection started');
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 45000);
  return { logfile, appLog: path.join(profile, 'zhixing/logs/app.log'), exit };
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

// 场景一：我们的旧副本 + 别家应用的同名目录。只删自己的。
const tempA = path.join(evidence, 'temp-a');
await fs.mkdir(tempA, { recursive: true });
const oursDir = path.join(tempA, ours);
await mkOld(oursDir, 'Un_A.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(256, 3), Buffer.from('知行', 'utf16le')]));
const foreignDir = path.join(tempA, foreign);
await mkOld(foreignDir, 'payload.exe', Buffer.from('MZ another vendor installer'));
const sessionA = await launch({ tempDir: tempA, profile: path.join(evidence, 'profile-a') });
const pruned = await waitForLog(sessionA.appLog, /temp\.hygiene (\{.*\})/);
assert.ok(pruned, 'app.log 里出现了 temp.hygiene');
const detail = JSON.parse(pruned[1]);
assert.equal(await fs.access(oursDir).then(() => true, () => false), false, '带产品名的 ~nsu.tmp 应被删除');
assert.equal(await fs.access(path.join(foreignDir, 'payload.exe')).then(() => true, () => false), true, '别家应用的同名目录必须保留');
assert.ok(detail.bytes >= 256, `日志应记录删除字节数，实际 ${detail.bytes}`);
await record('删除带产品名的卡住卸载器副本，别家应用的同名目录原样保留', { removed: ours, kept: foreign, logged: detail });
await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {});
await Promise.race([sessionA.exit, pause(30000)]).catch(() => {});
ui?.close(); ui = null;
child.kill(); await sessionA.exit.catch(() => {});
await log.close();

// 场景二：只有别家的同名目录。不该删，也不该记清理日志。
const tempB = path.join(evidence, 'temp-b');
const foreignOnly = path.join(tempB, foreign);
await mkOld(foreignOnly, 'payload.exe', Buffer.from('MZ another vendor installer'));
const sessionB = await launch({ tempDir: tempB, profile: path.join(evidence, 'profile-b') });
await pause(2000);
const logB = await fs.readFile(sessionB.appLog, 'utf8');
assert.ok(!/temp\.hygiene \{/.test(logB), '没有自己的副本时不该记录清理');
assert.equal(await fs.access(path.join(foreignOnly, 'payload.exe')).then(() => true, () => false), true);
const appLogB = await fs.readFile(path.join(evidence, 'profile-b', 'zhixing/logs/app.log'), 'utf8');
assert.match(appLogB, /app\.start/);
await record('没有自己的副本时不动别家目录、不记清理事件，启动照常', { kept: foreign });
await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {});
await Promise.race([sessionB.exit, pause(30000)]).catch(() => {});
ui?.close(); ui = null;
child.kill(); await sessionB.exit.catch(() => {});
await log.close();

// 场景三：安装过程留下的 nsXXXX.tmp 也是我们的（每次安装/升级留一个），要一起清。
const tempC = path.join(evidence, 'temp-c');
const installLeftover = path.join(tempC, 'nsaB12.tmp');
await mkOld(installLeftover, 'old-uninstaller.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(128, 7), Buffer.from('知行', 'utf16le')]));
const foreignC = path.join(tempC, foreign);
await mkOld(foreignC, 'payload.exe', Buffer.from('MZ another vendor installer'));
const sessionC = await launch({ tempDir: tempC, profile: path.join(evidence, 'profile-c') });
const prunedC = await waitForLog(sessionC.appLog, /temp\.hygiene (\{.*\})/);
assert.ok(prunedC, '安装残留场景里出现了 temp.hygiene');
const detailC = JSON.parse(prunedC[1]);
assert.equal(await fs.access(installLeftover).then(() => true, () => false), false, '带产品名的 nsaB12.tmp 应被删除');
assert.equal(await fs.access(path.join(foreignC, 'payload.exe')).then(() => true, () => false), true, '别家应用的同名目录必须保留');
assert.ok(detailC.targets.includes('nsaB12.tmp'), `日志应记录被删目录名，实际 ${JSON.stringify(detailC.targets)}`);
await record('安装过程留下的 nsXXXX.tmp 一并清理，别家目录保留', { removed: 'nsaB12.tmp', kept: foreign, logged: detailC });
await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {});
await Promise.race([sessionC.exit, pause(30000)]).catch(() => {});
ui?.close(); ui = null;
child.kill(); await sessionC.exit.catch(() => {});
await log.close();

report.status = 'passed';
await persist();
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, evidence }, null, 2));

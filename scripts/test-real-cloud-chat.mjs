// 真实云端问答：用真实供应商（地址与 Key 只从环境变量读，不落盘、不进证据）
// 在 Windows 实包上走完整发送链路，确认助手真的收到模型回答，而不是本机假服务。
// 证据只记录请求耗时、回复长度与首行，不记录 Key，也不记录完整对话内容。
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
const baseUrl = process.env.ZHIXING_CLOUD_BASE_URL;
const apiKey = process.env.ZHIXING_CLOUD_API_KEY;
const model = process.env.ZHIXING_CLOUD_MODEL || 'deepseek-v4.1-flash';
if (!baseUrl || !apiKey) throw new Error('需要 ZHIXING_CLOUD_BASE_URL 与 ZHIXING_CLOUD_API_KEY 环境变量');
const evidence = path.join(root, `.preview/qa-${provenance.version}/real-cloud`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  layer: 'windows-packaged-app + real-cloud', version: provenance.version, sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty, exeSha256: hash(await fs.readFile(exe)),
  endpointHost: new URL(baseUrl).host, model, status: 'running', cases: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const input = 'textarea[aria-label="聊天输入框"]';
const send = 'button.send-button[aria-label="发送消息"]';
let ui = null, child = null, exit = null, log = null;
const logPath = path.join(evidence, 'app.log');

async function launch() {
  log = await fs.open(logPath, 'a');
  const portsFile = path.join(profile, 'DevToolsActivePort'); await fs.rm(portsFile, { force: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  child = spawn(exe, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
  exit = once(child, 'close');
  const deadline = Date.now() + 45000;
  while (!ui && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited at launch (${child.exitCode})`);
    const ports = await fs.readFile(portsFile, 'utf8').catch(() => null);
    if (ports) ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
    if (!ui) await pause(120);
  }
  assert.ok(ui, 'Windows renderer test connection started');
  await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})`, 45000);
}

// 直接走 preload 的真实保存路径：存供应商（含拉取模型目录）→ 写工作区设置 → 重载。
async function configure() {
  const saved = await ui.evaluate(`(async()=>{
    const provider=await window.zhixing.saveProvider(${JSON.stringify({ name: '云端实测', protocol: 'openai', baseUrl, apiKey, reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(item=>item.name==='云端实测')||status.providers.at(-1);
    return {providerId: mine?.id, providers: status.providers.map(item=>({id:item.id,name:item.name,models:(item.models||[]).length}))};
  })()`);
  assert.ok(saved.providerId, `供应商没有保存成功：${JSON.stringify(saved)}`);
  const state = await ui.evaluate(`(async()=>{
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings, modelProviderId:${JSON.stringify(saved.providerId)}, model:${JSON.stringify(model)}, reasoning:'low', permission:'full', privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {models:(await window.zhixing.runtimeStatus()).providers.find(p=>p.id===${JSON.stringify(saved.providerId)})?.models?.map(m=>m.id)||[]};
  })()`);
  report.cloudModels = state.models; await persist();
  try { await ui.evaluate('location.reload(); true'); } catch {}
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const ready = await ui.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(input)});return Boolean(node&&!node.disabled)})()`).catch(() => false);
    if (ready) return saved;
    await pause(300);
  }
  throw new Error('重载后输入框不可用');
}

async function ask(text) {
  const before = await ui.evaluate('document.querySelectorAll(".assistant-message").length');
  await ui.fill(input, text);
  await ui.click('发送消息', send);
  const started = Date.now();
  const deadline = started + 120000;
  while (Date.now() < deadline) {
    const snapshot = await ui.evaluate(`(()=>{
      const nodes=[...document.querySelectorAll('.assistant-message')];
      const last=nodes.at(-1);
      const error=document.querySelector('.run-error-detail');
      const pending=Boolean(document.querySelector('.thinking-label'));
      const byline=last?.querySelector('.assistant-byline')?.innerText||'';
      const full=last?last.innerText.trim():'';
      const answer=byline?full.replace(byline.trim(),'').replace(/\s+/g,' ').trim():full;
      return {count:nodes.length, pending, error:error?error.textContent.trim():'', text:full, answer};
    })()`);
    if (snapshot.count > before && !snapshot.pending) return { ...snapshot, milliseconds: Date.now() - started };
    await pause(400);
  }
  throw new Error('等待真实模型回复超时');
}

let failure;
try {
  await launch();
  const runtimeVersion = await ui.evaluate('(async()=>((await window.zhixing.runtimeStatus()).appVersion))()');
  assert.equal(runtimeVersion, provenance.version);
  await record(`实包运行时报告 ${runtimeVersion}`);

  const saved = await configure();
  await record('真实供应商保存并拉取到模型目录', { providerId: saved.providerId, models: report.cloudModels });

  const reply = await ask('只回答两个字：收到');
  await ui.screenshot(path.join(evidence, 'reply.png'));
  report.reply = { milliseconds: reply.milliseconds, answerCharacters: reply.answer.length, answerExcerpt: reply.answer.slice(0, 80), byline: '知行 · 脱敏模式', error: reply.error };
  await persist();
  assert.equal(reply.error, '', `界面上出现了错误句子：${reply.error}`);
  assert.ok(reply.answer.length > 0, '助手回复为空（去掉署名后）');
  assert.ok(!/运行错误|无法连接|API Key 无效/.test(reply.text), `回复里出现了错误提示：${reply.text.slice(0, 120)}`);
  await record('真实云端模型回答了本轮消息', report.reply);

  const logText = await fs.readFile(logPath, 'utf8');
  assert.ok(!logText.includes(apiKey), '日志里出现了 API Key');
  assert.ok(!logText.includes(baseUrl), '日志里出现了完整服务地址');
  await record('日志不含 Key 与完整地址');

  report.status = 'passed'; await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, evidence }, null, 2));
} catch (error) {
  failure = error; report.status = 'failed'; report.error = String(error?.message || error); await persist();
} finally {
  try {
    if (ui) { await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {}); }
  } catch {}
  try { if (ui) ui.close(); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); if (exit) await Promise.race([exit, pause(10000)]); } } catch {}
  try { if (log) await log.close(); } catch {}
  try { await fs.rm(profile, { recursive: true, force: true }); } catch {}
}
if (failure) { console.error(`FAIL ${failure.message}`); process.exit(1); }

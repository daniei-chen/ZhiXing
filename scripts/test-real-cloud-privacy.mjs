// 真实云端 + 脱敏还原：用真实供应商跑多轮，确认三件事
//   1. 多轮上下文在真实服务上成立（第三轮能引用第一轮给的信息）；
//   2. 模型看到的是占位符而不是原始手机号／邮箱（让模型自述它收到的字符）；
//   3. 界面最终把占位符还原成原文，用户看到的是自己的号码。
// 地址与 Key 只从环境变量读；证据只记判定结果与模型自述的摘录，不记录 Key。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/real-cloud-privacy`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const PHONE = '13800138000';
const MAIL = 'qa-redaction@example.com';
const report = {
  layer: 'windows-packaged-app + real-cloud', version: provenance.version, sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty, exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'),
  endpointHost: new URL(baseUrl).host, model, privacyModeExpected: 'redact', status: 'running', turns: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases ??= []; report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
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

async function configure() {
  const saved = await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: '云端实测', protocol: 'openai', baseUrl, apiKey, reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(item=>item.name==='云端实测')||status.providers.at(-1);
    return {providerId: mine?.id, models:(mine?.models||[]).map(m=>m.id)};
  })()`);
  assert.ok(saved.providerId, '供应商没有保存成功');
  const state = await ui.evaluate(`(async()=>{
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings, modelProviderId:${JSON.stringify(saved.providerId)}, model:${JSON.stringify(model)}, reasoning:'low', permission:'full', privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {privacyMode:s.settings.privacyMode};
  })()`);
  report.models = saved.models; report.privacyMode = state.privacyMode; await persist();
  assert.equal(state.privacyMode, 'redact');
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
  const deadline = started + 180000;
  while (Date.now() < deadline) {
    const snapshot = await ui.evaluate(`(()=>{
      const nodes=[...document.querySelectorAll('.assistant-message')];
      const last=nodes.at(-1);
      const byline=last?.querySelector('.assistant-byline')?.innerText||'';
      const full=last?last.innerText.trim():'';
      const answer=byline?full.replace(byline.trim(),'').replace(/\\s+/g,' ').trim():full;
      const error=document.querySelector('.run-error-detail');
      return {count:nodes.length, pending:Boolean(document.querySelector('.thinking-label')), error:error?error.textContent.trim():'', answer};
    })()`);
    if (snapshot.count > before && !snapshot.pending) return { ...snapshot, milliseconds: Date.now() - started };
    await pause(400);
  }
  throw new Error('等待真实模型回复超时');
}

let failure;
try {
  await launch();
  await configure();
  await record('真实供应商已保存，工作区为脱敏模式', { models: report.models });

  const first = await ask(`请记住这条信息，稍后我会问：手机号 ${PHONE}，邮箱 ${MAIL}。只回复「记住」。`);
  report.turns.push({ n: 1, milliseconds: first.milliseconds, answer: first.answer.slice(0, 60), error: first.error }); await persist();
  assert.equal(first.error, '', `第一轮出现错误：${first.error}`);
  await record('第一轮：真实模型确认收到', { answer: first.answer.slice(0, 40) });

  // 让模型把它实际看到的字符贴出来：如果网关脱敏生效，它贴的是占位符，
  // 界面再把占位符还原成原始手机号，所以最终可见文本里仍有 13800138000。
  const second = await ask('把你上一条消息里看到的手机号和邮箱按原样（逐字符）贴出来，不要改写。');
  await ui.screenshot(path.join(evidence, 'restored.png'));
  report.turns.push({ n: 2, milliseconds: second.milliseconds, answer: second.answer.slice(0, 200), error: second.error }); await persist();
  assert.equal(second.error, '', `第二轮出现错误：${second.error}`);
  assert.ok(second.answer.includes(PHONE), `界面没有还原手机号，实际：${second.answer.slice(0, 160)}`);
  assert.ok(second.answer.includes(MAIL), `界面没有还原邮箱，实际：${second.answer.slice(0, 160)}`);
  await record('第二轮：占位符被还原成原文，界面看到原始手机号与邮箱');

  const third = await ask('只看你实际收到的字符：我给的手机号是原始数字，还是被替换成了占位符或掩码？用一句话照实回答。');
  report.turns.push({ n: 3, milliseconds: third.milliseconds, answer: third.answer.slice(0, 200), error: third.error }); await persist();
  const saysMasked = /占位|掩码|替换|不是原始|无法看到|看不到|脱敏|masked|placeholder/i.test(third.answer);
  report.modelSaysMasked = saysMasked; await persist();
  assert.ok(saysMasked, `模型自述未体现脱敏，实际：${third.answer.slice(0, 160)}`);
  await record('第三轮：模型自述它看到的是占位符，不是原始号码', { answer: third.answer.slice(0, 80) });

  const logText = await fs.readFile(logPath, 'utf8');
  assert.ok(!logText.includes(apiKey), '日志里出现了 API Key');
  assert.ok(!logText.includes(PHONE), '日志里出现了原始手机号');
  await record('日志不含 Key 与原始手机号');

  report.status = 'passed'; await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, evidence }, null, 2));
} catch (error) {
  failure = error; report.status = 'failed'; report.error = String(error?.message || error); await persist();
} finally {
  try { if (ui) await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {}); } catch {}
  try { if (ui) ui.close(); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); if (exit) await Promise.race([exit, pause(10000)]); } } catch {}
  try { if (log) await log.close(); } catch {}
  try { await fs.rm(profile, { recursive: true, force: true }); } catch {}
}
if (failure) { console.error(`FAIL ${failure.message}`); process.exit(1); }

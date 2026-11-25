// 两条用户直接提出的界面要求，在 Windows 实包上验证：
//   1. 发送后显示「思考中」（有工具在跑时显示工具动作），不再显示内核阶段名；
//   2. 供应商里拉取到的模型能直接「设为当前」，当前那条有标记。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/run-status-ui`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const report = {
  layer: 'windows-packaged-app + real-cloud', version: provenance.version, sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty, exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'),
  endpointHost: new URL(baseUrl).host, model, status: 'running', cases: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const input = 'textarea[aria-label="聊天输入框"]';
const send = 'button.send-button[aria-label="发送消息"]';
let ui = null, child = null, exit = null, log = null;

async function launch() {
  log = await fs.open(path.join(evidence, 'app.log'), 'a');
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

async function clickPredicate(selector, predicate) {
  const point = await ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length);const e=nodes.find(el=>(${predicate}));if(!e)throw Error('no visible match: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:(Math.max(r.left,0)+Math.min(r.right,innerWidth))/2,y:(Math.max(r.top,0)+Math.min(r.bottom,innerHeight))/2};})()`);
  await ui.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await pause(180);
}

async function configure() {
  const saved = await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: '云端实测', protocol: 'openai', baseUrl, apiKey, reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(item=>item.name==='云端实测')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings, modelProviderId: mine.id, model: ${JSON.stringify(model)}, reasoning:'low', permission:'full', privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {providerId: mine.id, models: (mine.models||[]).length};
  })()`);
  assert.ok(saved.providerId, '供应商没有保存成功');
  report.provider = saved; await persist();
  try { await ui.evaluate('location.reload(); true'); } catch {}
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const ready = await ui.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(input)});return Boolean(node&&!node.disabled)})()`).catch(() => false);
    if (ready) return saved;
    await pause(300);
  }
  throw new Error('重载后输入框不可用');
}

let failure;
try {
  await launch();
  const saved = await configure();
  await record('真实供应商已保存', { models: saved.models });

  // —— 模型选择：设置 → 供应商 → 展开模型列表 → 设为当前
  if (await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")')) await ui.click('展开侧栏');
  if (!await ui.evaluate('!!document.querySelector(".settings-page")')) await ui.click('打开设置');
  await ui.click('供应商', '.settings-nav button');
  if (await ui.evaluate('!!document.querySelector(".provider-back")')) await ui.click('所有供应商', '.provider-back');
  await clickPredicate('.provider-row', "el.textContent.includes('云端实测')");
  await ui.waitFor('!!document.querySelector(".provider-catalog")', 15000);
  const catalog = await ui.evaluate('(()=>{const d=document.querySelector(".provider-catalog");return {open:d.open,rows:d.querySelectorAll("li").length,picks:d.querySelectorAll("button.model-pick").length,current:d.querySelectorAll(".model-current").length};})()');
  await ui.screenshot(path.join(evidence, 'provider-models.png'));
  report.catalog = catalog; await persist();
  assert.equal(catalog.open, true, '模型列表应默认展开');
  assert.ok(catalog.rows >= 10, `模型数量异常：${catalog.rows}`);
  assert.ok(catalog.picks >= 10, `「设为当前」按钮数量异常：${catalog.picks}`);
  assert.equal(catalog.current, 1, '当前模型应恰好有一条标记');
  await record('拉取后的模型列表可展开、可逐个「设为当前」，当前模型有标记', catalog);

  const target = await ui.evaluate('(()=>{const rows=[...document.querySelectorAll(".provider-catalog li")];const row=rows.find(r=>r.querySelector("button.model-pick"));if(!row)return null;const name=row.querySelector("span")?.textContent.trim();row.querySelector("button.model-pick").click();return name;})()');
  assert.ok(target, '找不到可点击的模型');
  await pause(600);
  const after = await ui.evaluate('(async()=>({notice:document.querySelector(".setting-notice")?.textContent.trim()||"",settings:(await window.zhixing.loadWorkspace()).settings}))()');
  report.selection = { target, notice: after.notice, model: after.settings.model, providerId: after.settings.modelProviderId }; await persist();
  assert.equal(String(after.settings.model).toLowerCase(), String(target).toLowerCase(), `当前模型没有切换：${after.settings.model}`);
  await record('点击「设为当前」后工作区模型真的切换了', report.selection);

  // —— 状态文案：设置回原模型，回到工作台发消息，抓运行中的状态行
  await ui.evaluate(`(async()=>{const s=await window.zhixing.loadWorkspace();s.settings={...s.settings,model:${JSON.stringify(model)}};await window.zhixing.saveWorkspace(s);})()`);
  await ui.click('返回工作台', 'button[aria-label="返回工作台"]');
  await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})`, 15000);
  await ui.fill(input, '只回答两个字：收到');
  await ui.click('发送消息', send);
  const labels = new Set();
  const deadline = Date.now() + 120000;
  let answered = false;
  while (Date.now() < deadline) {
    const snapshot = await ui.evaluate(`(()=>{const label=document.querySelector('.thinking-label');const nodes=[...document.querySelectorAll('.assistant-message')];return {label:label?label.textContent.trim():'', last:nodes.at(-1)?nodes.at(-1).innerText.trim():''};})()`);
    if (snapshot.label) labels.add(snapshot.label);
    if (snapshot.last && !snapshot.label) { answered = true; break; }
    await pause(120);
  }
  report.statusLabels = [...labels]; await persist();
  assert.ok(labels.size > 0, '没有观察到运行中的状态行');
  for (const label of labels) {
    assert.ok(!/内核|初始化|启动/u.test(label), `状态行仍显示内核阶段文案：${label}`);
    assert.ok(/思考中|^正在/u.test(label), `状态行文案不符合预期：${label}`);
  }
  await record('运行中显示「思考中」或工具动作，没有内核阶段文案', { labels: report.statusLabels });
  assert.ok(answered, '消息没有在本轮完成');

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

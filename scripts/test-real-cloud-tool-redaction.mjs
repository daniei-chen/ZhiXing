// 工具结果路径的脱敏：工作区文件里放假手机号与假邮箱，让模型用文件工具读出来。
// 要证明三件事：
//   1. 文件工具真的被调用（工具时间线可见）；
//   2. 界面把占位符还原成原文；
//   3. 模型自己贴出的字符是占位符，不是原文。
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
const provenance = JSON.parse(await fs.readFile(path.join(path.dirname(exe), 'resources/app/build-provenance.json'), 'utf8'));
const baseUrl = process.env.ZHIXING_CLOUD_BASE_URL;
const apiKey = process.env.ZHIXING_CLOUD_API_KEY;
const model = process.env.ZHIXING_CLOUD_MODEL || 'deepseek-v4.1-flash';
if (!baseUrl || !apiKey) throw new Error('需要 ZHIXING_CLOUD_BASE_URL 与 ZHIXING_CLOUD_API_KEY 环境变量');
const PHONE = '13800138000';
const MAIL = 'qa-tool-redaction@example.com';
const evidence = path.join(root, `.preview/qa-${provenance.version}/tool-redaction`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const workspaceDir = path.join(evidence, 'workspace');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(workspaceDir, { recursive: true });
await fs.writeFile(path.join(workspaceDir, 'contact.md'), `# 联系人\n\n手机：${PHONE}\n邮箱：${MAIL}\n`);

const report = {
  layer: 'windows-packaged-app + real-cloud + project workspace', version: provenance.version,
  sourceCommit: provenance.sourceCommit, sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'),
  endpointHost: new URL(baseUrl).host, model, status: 'running', cases: [], turns: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const input = 'textarea[aria-label="聊天输入框"]';
const send = 'button.send-button[aria-label="发送消息"]';
async function clickPredicate(selector, predicate) {
  const point = await ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length);const e=nodes.find(el=>(${predicate}));if(!e)throw Error('no visible match: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:(Math.max(r.left,0)+Math.min(r.right,innerWidth))/2,y:(Math.max(r.top,0)+Math.min(r.bottom,innerHeight))/2};})()`);
  await ui.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await pause(200);
}

let ui = null, child = null, exit = null, log = null;

async function turn(prompt, seconds) {
  await ui.fill(input, prompt);
  await ui.click('发送消息', send);
  const started = Date.now();
  const deadline = started + seconds;
  let answer = '';
  while (Date.now() < deadline) {
    const snapshot = await ui.evaluate(`(()=>({answer:[...document.querySelectorAll('.assistant-message')].at(-1)?.innerText.trim()||'',busy:Boolean(document.querySelector('.thinking-label')),error:document.querySelector('.run-error-detail')?.textContent.trim()||'',rows:[...document.querySelectorAll('.tool-strip li')].map(li=>li.textContent.trim())}))()`);
    answer = snapshot.answer;
    if (snapshot.error) throw new Error(`界面报错：${snapshot.error}`);
    if (answer && !snapshot.busy) return { answer, milliseconds: Date.now() - started, rows: snapshot.rows };
    await pause(400);
  }
  throw new Error('本轮没有在时限内完成');
}

try {
  log = await fs.open(path.join(evidence, 'app.log'), 'a');
  const portsFile = path.join(profile, 'DevToolsActivePort');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  child = spawn(exe, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
  exit = once(child, 'close');
  for (let i = 0; i < 400 && !ui; i += 1) {
    const ports = await fs.readFile(portsFile, 'utf8').catch(() => null);
    if (ports) ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
    if (!ui) await pause(120);
  }
  assert.ok(ui, 'renderer test connection started');
  await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})`, 45000);

  await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: '工具脱敏实测', protocol: 'openai', baseUrl, apiKey, reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='工具脱敏实测')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    const projectId='qa-tool-redact-project', workspaceId='qa-tool-redact-workspace';
    s.projects=[...(s.projects||[]).filter(item=>item.id!==projectId),{id:projectId,name:'QA 脱敏项目',instructions:'',directory:${JSON.stringify(workspaceDir)},workspaceId,expanded:true}];
    s.workspaces=[...(s.workspaces||[]).filter(item=>item.id!==workspaceId),{id:workspaceId,name:'QA 脱敏工作区',type:'office',directory:${JSON.stringify(workspaceDir)},projectId}];
    s.workspaceId=workspaceId;
    s.settings={...s.settings,modelProviderId:mine.id,model:${JSON.stringify(model)},reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return mine.id;
  })()`);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})&&!document.querySelector(${JSON.stringify(input)}).disabled`, 60000);
  await clickPredicate('.sidebar button, .sidebar [role="button"], .project-row, button', "el.textContent.trim().includes('QA 脱敏项目')");
  await pause(1200);
  if (!(await ui.evaluate(`!!document.querySelector(${JSON.stringify(input)})`))) {
    await clickPredicate('button', "/新建|新对话|开始/u.test(el.textContent)");
    await pause(1200);
  }
  await record('真实供应商与带敏感信息的工作区已就绪');

  const first = await turn('请调用文件读取工具打开 contact.md，把里面的手机号和邮箱原样贴出来，不要改写。', 180000);
  report.turns.push({ prompt: 'read contact.md', ...first });
  await ui.screenshot(path.join(evidence, 'turn1.png'));
  await persist();
  assert.ok(first.rows.length > 0, '没有看到工具调用');
  assert.ok(first.answer.includes(PHONE), `界面没有还原手机号：${first.answer.replace(/\s+/g, ' ').slice(0, 200)}`);
  assert.ok(first.answer.includes(MAIL), `界面没有还原邮箱：${first.answer.replace(/\s+/g, ' ').slice(0, 200)}`);
  await record('工具读到的手机号与邮箱在界面上还原成原文', { rows: first.rows, milliseconds: first.milliseconds });

  const second = await turn('只回答一句话：你刚才读到的手机号是完整的 11 位数字原文，还是被替换成了别的记号？不要复制或引用任何记号，也不要写数字。', 180000);
  report.turns.push({ prompt: 'describe what you saw', ...second });
  await ui.screenshot(path.join(evidence, 'turn2.png'));
  const masked = /占位|掩码|替换|不是原始|并非原始|placeholder/i.test(second.answer);
  const echoedRaw = second.answer.includes(PHONE);
  report.answerExcerpt = second.answer.replace(/\s+/g, ' ').slice(0, 200);
  report.modelSaysMasked = masked;
  report.modelEchoedRawPhone = echoedRaw;
  await persist();
  assert.ok(masked, `模型没有说它看到的是占位符：${second.answer.replace(/\s+/g, ' ').slice(0, 220)}`);
  assert.equal(echoedRaw, false, '模型居然贴出了原始手机号，说明工具结果没有经过脱敏');
  await record('模型自述它看到的是占位符，没有拿到原始手机号', { excerpt: second.answer.replace(/\s+/g, ' ').slice(0, 160) });

  const logText = await fs.readFile(path.join(evidence, 'app.log'), 'utf8');
  report.logLeaks = { phone: logText.includes(PHONE), mail: logText.includes(MAIL), apiKey: logText.includes(apiKey) };
  await persist();
  assert.equal(report.logLeaks.phone, false, '应用日志里出现了原始手机号');
  assert.equal(report.logLeaks.apiKey, false, '应用日志里出现了 API Key');
  await record('应用日志不含原始手机号与 Key', report.logLeaks);

  report.status = 'passed'; await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, modelSaysMasked: masked, evidence }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = String(error?.message || error); await persist();
  console.error(`FAIL ${report.error}`);
  process.exitCode = 1;
} finally {
  try { if (ui) await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {}); } catch {}
  try { if (ui) ui.close(); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); if (exit) await Promise.race([exit, pause(8000)]); } } catch {}
  try { if (log) await log.close(); } catch {}
  try { await fs.rm(profile, { recursive: true, force: true }); } catch {}
}

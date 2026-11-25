// 真实云端 + 项目工作区：文件类工具按工作区挂载，没有工作区时模型会明说
// 「没有 glob 工具」（0.15.1 已记录）。这个脚本建一个临时工作区，放入两份 md，
// 用真实供应商让模型调用 glob，确认：工具真的执行、结果回到回答里、时间线显示。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/real-cloud-workspace`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const workspaceDir = path.join(evidence, 'workspace');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(workspaceDir, { recursive: true });
await fs.writeFile(path.join(workspaceDir, '会议纪要.md'), '# 会议纪要\n\n- 华东增长 12%\n');
await fs.writeFile(path.join(workspaceDir, '预算说明.md'), '# 预算说明\n\n- 差旅 8 万\n');
await fs.writeFile(path.join(workspaceDir, 'notes.txt'), '这一份不是 markdown\n');

const report = {
  layer: 'windows-packaged-app + real-cloud + project workspace', version: provenance.version,
  sourceCommit: provenance.sourceCommit, sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'),
  endpointHost: new URL(baseUrl).host, model, workspaceFiles: ['会议纪要.md', '预算说明.md', 'notes.txt'],
  status: 'running', cases: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

async function clickPredicate(selector, predicate) {
  const point = await ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length);const e=nodes.find(el=>(${predicate}));if(!e)throw Error('no visible match: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:(Math.max(r.left,0)+Math.min(r.right,innerWidth))/2,y:(Math.max(r.top,0)+Math.min(r.bottom,innerHeight))/2};})()`);
  await ui.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await pause(200);
}

const input = 'textarea[aria-label="聊天输入框"]';
const send = 'button.send-button[aria-label="发送消息"]';
let ui = null, child = null, exit = null, log = null;

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

  const prepared = await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: '云端工作区', protocol: 'openai', baseUrl, apiKey, reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='云端工作区')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    const projectId='qa-project-workspace';
    const workspaceId='qa-workspace';
    const workspace={id:workspaceId,name:'QA 工作区',type:'office',directory:${JSON.stringify(workspaceDir)},projectId};
    s.projects=[...(s.projects||[]).filter(item=>item.id!==projectId),{id:projectId,name:'QA 工作区项目',instructions:'',directory:${JSON.stringify(workspaceDir)},workspaceId,expanded:true}];
    s.workspaces=[...(s.workspaces||[]).filter(item=>item.id!==workspaceId),workspace];
    s.workspaceId=workspaceId;
    s.settings={...s.settings,modelProviderId:mine.id,model:${JSON.stringify(model)},reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {providerId:mine.id,workspaceId,projectId};
  })()`);
  report.workspace = prepared; await persist();
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})&&!document.querySelector(${JSON.stringify(input)}).disabled`, 60000);
  await record('真实供应商与临时工作区已就绪', { workspace: prepared.workspaceId });

  // 进入项目：只有项目会话才带工作区，首页会话没有文件工具。
  await clickPredicate('.sidebar button, .sidebar [role="button"], .project-row, button', "el.textContent.trim().includes('QA 工作区项目')");
  await pause(1200);
  if (!(await ui.evaluate(`!!document.querySelector(${JSON.stringify(input)})`))) {
    await clickPredicate('button', "/新建|新对话|开始/u.test(el.textContent)");
    await pause(1200);
  }
  const scope = await ui.evaluate(`(()=>({hasComposer:!!document.querySelector(${JSON.stringify(input)}),heading:[...document.querySelectorAll('h1,h2,.page-title')].map(n=>n.textContent.trim()).slice(0,4)}))()`);
  report.scope = scope; await persist();
  assert.ok(scope.hasComposer, '进入项目后没有输入框');
  await ui.screenshot(path.join(evidence, 'project-scope.png'));
  await record('已进入项目会话', scope);
  await ui.fill(input, '请调用 glob 工具，列出当前工作区根目录下所有 .md 文件，并告诉我文件名和数量。');
  await ui.click('发送消息', send);

  const deadline = Date.now() + 180000;
  let rows = [];
  let answer = '';
  while (Date.now() < deadline) {
    const snapshot = await ui.evaluate(`(()=>{const strips=[...document.querySelectorAll('.tool-strip')];const last=strips.at(-1);return {rows:last?[...last.querySelectorAll('li')].map(li=>li.textContent.trim()):[],answer:[...document.querySelectorAll('.assistant-message')].at(-1)?.innerText.trim()||'',busy:Boolean(document.querySelector('.thinking-label')),error:document.querySelector('.run-error-detail')?.textContent.trim()||''};})()`);
    rows = snapshot.rows; answer = snapshot.answer;
    if (answer && !snapshot.busy) { report.error = snapshot.error; break; }
    await pause(400);
  }
  await ui.screenshot(path.join(evidence, 'workspace-tools.png'));
  report.toolRows = rows; report.answer = answer.slice(0, 300); await persist();
  assert.equal(report.error, '', `界面出现错误：${report.error}`);
  assert.ok(rows.length > 0, '消息下方没有工具调用记录');
  assert.ok(rows.some(label => label.includes('查找项目文件') || label.includes('调用')), `工具记录不符合预期：${rows.join(' | ')}`);
  await record('真实云端下文件工具真的执行并显示在消息下方', { rows });

  const fileToolRan = rows.some(label => /查找项目文件|读取文件|浏览目录|内核工具|调用/u.test(label));
  report.fileToolRan = fileToolRan; await persist();
  assert.ok(fileToolRan, `没有看到文件类工具的调用：${rows.join(' | ')}`);
  assert.ok(/2|两/u.test(answer), `回答里没有出现数量 2：${answer.replace(/\s+/g, ' ').slice(0, 160)}`);
  await record('回答带回了工作区里两份 md 的数量', { answerExcerpt: answer.replace(/\s+/g, ' ').slice(0, 120) });

  report.status = 'passed'; await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, rows, evidence }, null, 2));
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

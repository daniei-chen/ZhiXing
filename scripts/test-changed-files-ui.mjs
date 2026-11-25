// 改动文件卡片实包验收（对标 dsh-client-ui-deliverables 的改动文件卡片）：
// 假服务让模型在项目工作区里连写三次文件（同一路径两次、另一个路径一次），
// 内核的 write 工具结果带 meta.diffs，主进程按行级差异累计，界面在收尾正文后给出
// 「本轮改动 N 个文件」与每个文件的 +新增 / -删除，点击打开工作面板的文件页。
import assert from 'node:assert/strict';
import http from 'node:http';
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/changed-files`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const workspaceDir = path.join(evidence, '工作区');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(workspaceDir, { recursive: true });
const firstFile = '变更记录.md';
const secondFile = '第二轮.md';
const first = '第一行\n第二行\n第三行\n第四行\n第五行\n第六行';
const firstUpdated = `${first}\n第七行\n第八行`;
const second = '甲\n乙\n丙';
const report = {
  layer: 'windows-packaged-app + real-kernel + local fake provider + project workspace', version: provenance.version,
  sourceCommit: provenance.sourceCommit, sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'), status: 'running', cases: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

// 第 1 次请求：写第一个文件；第 2 次：覆盖同一文件；第 3 次：写第二个文件；第 4 次：正文。
const writes = [
  { id: 'call-qa-write-1', name: 'write', arguments: JSON.stringify({ file_path: firstFile, content: first }) },
  { id: 'call-qa-write-2', name: 'write', arguments: JSON.stringify({ file_path: firstFile, content: firstUpdated }) },
  { id: 'call-qa-write-3', name: 'write', arguments: JSON.stringify({ file_path: secondFile, content: second }) },
];
const server = http.createServer((request, response) => {
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qa-changes-model', name: 'QA 改动模型', input_modalities: ['text'] }] }));
    return;
  }
  if (!request.url.includes('/chat/completions')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{}');
    return;
  }
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const toolResults = (payload.messages || []).filter(message => message.role === 'tool').length;
    const base = { id: 'chatcmpl-qa-changes', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-changes-model' };
    const chunk = delta => ({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write(chunk({ role: 'assistant' }));
    if (toolResults < writes.length) {
      const call = writes[toolResults];
      write(chunk({ tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      write(chunk({ content: '两个文件都写好了。' }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

const snapshot = () => ui.evaluate(`(()=>{const box=[...document.querySelectorAll('.assistant-message .change-files')].at(-1);if(!box)return {count:0};const rows=[...box.querySelectorAll('li button')];return {count:Number(box.getAttribute('data-count')),header:box.querySelector('header')?.innerText.trim()||'',rows:rows.map(node=>({name:node.querySelector('span')?.textContent.trim()||'',counts:node.querySelector('small')?.textContent.trim()||'',title:node.getAttribute('title')||''})),order:[...box.parentElement.querySelectorAll('.change-files,.deliverable-files')].map(node=>node.className)};})()`);
let ui = null, child = null, exit = null, log = null;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  report.provider = base; await persist();

  log = await fs.open(path.join(evidence, 'app.log'), 'a');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  child = spawn(exe, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
  exit = once(child, 'close');
  const portsFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 400 && !ui; i += 1) {
    const ports = await fs.readFile(portsFile, 'utf8').catch(() => null);
    if (ports) ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
    if (!ui) await pause(120);
  }
  assert.ok(ui, 'renderer test connection started');
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 45000);

  const prepared = await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 改动服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-changes-0000000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 改动服务')||status.providers.at(-1);
    const projectId='qa-project-changes';
    const workspaceId='qa-workspace-changes';
    const workspace={id:workspaceId,name:'QA 改动工作区',type:'office',directory:${JSON.stringify(workspaceDir)},projectId};
    const s=await window.zhixing.loadWorkspace();
    s.projects=[...(s.projects||[]).filter(item=>item.id!==projectId),{id:projectId,name:'QA 改动项目',instructions:'',directory:${JSON.stringify(workspaceDir)},workspaceId,expanded:true}];
    s.workspaces=[...(s.workspaces||[]).filter(item=>item.id!==workspaceId),workspace];
    s.workspaceId=workspaceId;
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-changes-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {providerId:mine.id,workspaceId,projectId};
  })()`);
  report.workspace = prepared; await persist();
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);

  await ui.evaluate('(()=>{const node=[...document.querySelectorAll(".sidebar button, .sidebar [role=\\"button\\"], button")].find(el=>el.textContent.trim().includes("QA 改动项目"));if(!node)throw new Error("Missing project row");node.click();return true})()');
  await pause(1500);
  if (!(await ui.evaluate('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')'))) {
    await ui.evaluate('(()=>{const node=[...document.querySelectorAll("button")].find(el=>/新建|新对话|开始/u.test(el.textContent));if(node)node.click();return true})()');
    await pause(1500);
  }
  await record('临时工作区与假服务就绪', { workspace: prepared.workspaceId });

  await ui.fill('textarea[aria-label="聊天输入框"]', '把这两份记录写到工作区里。');
  await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');
  const deadline = Date.now() + 180000;
  let state = await snapshot();
  while (Date.now() < deadline) {
    state = await snapshot();
    const busy = await ui.evaluate('Boolean(document.querySelector(".thinking-label"))');
    if (state.count && !busy) break;
    await pause(300);
  }
  await ui.screenshot(path.join(evidence, 'changed-files.png'));
  report.card = state; await persist();

  assert.equal(state.count, 2, `卡片文件数不对：${state.count}`);
  assert.equal(state.header.includes('本轮改动 2 个文件'), true, `标题不符：${state.header}`);
  assert.equal(state.header.includes('+11 −0'), true, `合计行数不符：${state.header}`);
  await record('本轮改动两个文件并给出合计行数', { header: state.header });

  assert.deepEqual(state.rows.map(row => row.name), [firstFile, secondFile], `文件行不符：${state.rows.map(row => row.name).join(' | ')}`);
  assert.equal(state.rows[0].counts, '+8 −0', `同一文件两次写入应累计为 +8：${state.rows[0].counts}`);
  assert.equal(state.rows[1].counts, '+3 −0', `第二个文件行数不符：${state.rows[1].counts}`);
  await record('同一路径累计、不同文件分行', { rows: state.rows });

  const written = await fs.readFile(path.join(workspaceDir, firstFile), 'utf8').catch(() => '');
  assert.equal(written, firstUpdated, '工作区里的文件内容与模型最后一次写入不一致');
  await record('工具确实写入了工作区文件');

  await ui.evaluate('(()=>{const node=document.querySelector(".change-files li button");if(!node)throw new Error("Missing change row");node.click();return true})()');
  await pause(1200);
  const panel = await ui.evaluate('(()=>{const select=document.querySelector(\'select[aria-label="工作面板视图"]\');return {view:select?.value||\'\',visible:!!document.querySelector(".workbench")};})()');
  report.panel = panel; await persist();
  assert.equal(panel.view, 'review', `点击改动文件没有打开对比视图：${JSON.stringify(panel)}`);
  await record('点击改动文件打开改动对比视图', panel);

  report.status = 'passed'; await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, evidence }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = String(error?.message || error); await persist();
  console.error(`FAIL ${report.error}`);
  process.exitCode = 1;
} finally {
  try { server.closeAllConnections(); server.close(); } catch {}
  try { if (ui) await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {}); } catch {}
  try { if (ui) ui.close(); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); if (exit) await Promise.race([exit, pause(8000)]); } } catch {}
  try { if (log) await log.close(); } catch {}
  try { await fs.rm(profile, { recursive: true, force: true }); } catch {}
}

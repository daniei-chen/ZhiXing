// 交付卡片实包验收（对标 dsh-client-ui-deliverables 的轮次末尾交付卡片）：
// 本地假服务让模型调用 present 声明五个文件，内核记下交付记录，界面应在回答末尾给出卡片：
// 文件名 + 说明（没有说明用文件类型），超过四个默认收起，可展开／收起。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/deliverable-cards`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const workspaceDir = path.join(evidence, '工作区');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(workspaceDir, { recursive: true });
const files = [
  { path: '季度汇总.docx', description: '第三季度经营汇总' },
  { path: '明细.xlsx' },
  { path: '说明.pdf' },
  { path: '纪要.md' },
  { path: '封面.png' },
];
for (const file of files) await fs.writeFile(path.join(workspaceDir, file.path), `QA deliverable ${file.path}\n`);
const report = {
  layer: 'windows-packaged-app + real-kernel + local fake provider + project workspace', version: provenance.version,
  sourceCommit: provenance.sourceCommit, sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'), status: 'running', cases: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const server = http.createServer((request, response) => {
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qa-deliver-model', name: 'QA 交付模型', input_modalities: ['text'] }] }));
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
    const hasToolResult = (payload.messages || []).some(message => message.role === 'tool');
    const base = { id: 'chatcmpl-qa-deliver', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-deliver-model' };
    const chunk = delta => ({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write(chunk({ role: 'assistant' }));
    if (!hasToolResult) {
      write(chunk({ tool_calls: [{ index: 0, id: 'call-qa-present', type: 'function', function: { name: 'present', arguments: JSON.stringify({ files }) } }] }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      write(chunk({ content: '五份材料都已交付。' }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

const cards = () => ui.evaluate(`(()=>{const box=document.querySelector('.deliverable-files')||[...document.querySelectorAll('.deliverable-files')].at(-1);if(!box)return {count:0,names:[],captions:[],titles:[],more:'',dataCount:null};const list=[...box.querySelectorAll('.deliverable-card')];return {count:list.length,names:list.map(node=>node.querySelector('strong')?.textContent.trim()||''),captions:list.map(node=>node.querySelector('small')?.textContent.trim()||''),titles:list.map(node=>node.getAttribute('title')||''),more:box.querySelector('.deliverable-more')?.textContent.trim()||'',dataCount:box.getAttribute('data-count')};})()`);
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
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 交付服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-deliver-00000000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 交付服务')||status.providers.at(-1);
    const projectId='qa-project-deliver';
    const workspaceId='qa-workspace-deliver';
    const workspace={id:workspaceId,name:'QA 交付工作区',type:'office',directory:${JSON.stringify(workspaceDir)},projectId};
    const s=await window.zhixing.loadWorkspace();
    s.projects=[...(s.projects||[]).filter(item=>item.id!==projectId),{id:projectId,name:'QA 交付项目',instructions:'',directory:${JSON.stringify(workspaceDir)},workspaceId,expanded:true}];
    s.workspaces=[...(s.workspaces||[]).filter(item=>item.id!==workspaceId),workspace];
    s.workspaceId=workspaceId;
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-deliver-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {providerId:mine.id,workspaceId,projectId};
  })()`);
  report.workspace = prepared; await persist();
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);

  await ui.evaluate('(()=>{const node=[...document.querySelectorAll(".sidebar button, .sidebar [role=\\"button\\"], button")].find(el=>el.textContent.trim().includes("QA 交付项目"));if(!node)throw new Error("Missing project row");node.click();return true})()');
  await pause(1500);
  if (!(await ui.evaluate('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')'))) {
    await ui.evaluate('(()=>{const node=[...document.querySelectorAll("button")].find(el=>/新建|新对话|开始/u.test(el.textContent));if(node)node.click();return true})()');
    await pause(1500);
  }
  await record('临时工作区与假服务就绪', { workspace: prepared.workspaceId });

  await ui.fill('textarea[aria-label="聊天输入框"]', '把工作区里这五份材料交付给我。');
  await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');
  const deadline = Date.now() + 150000;
  let snapshot = await cards();
  while (Date.now() < deadline) {
    snapshot = await cards();
    const busy = await ui.evaluate('Boolean(document.querySelector(".thinking-label"))');
    if (snapshot.count && !busy) break;
    await pause(300);
  }
  await ui.screenshot(path.join(evidence, 'deliverable-cards.png'));
  report.cards = snapshot; await persist();

  assert.equal(snapshot.dataCount, '5', `交付记录数不是 5：${snapshot.dataCount}`);
  assert.equal(snapshot.count, 4, `默认应只显示四个卡片，实际 ${snapshot.count}`);
  assert.deepEqual(snapshot.names, files.slice(0, 4).map(file => file.path), `卡片文件名不符：${snapshot.names.join(' | ')}`);
  await record('五个交付只先显示四张卡片', { names: snapshot.names });

  assert.equal(snapshot.captions[0], '第三季度经营汇总', `有说明的文件没有显示说明：${snapshot.captions[0]}`);
  assert.equal(snapshot.captions[1], '表格', `没有说明的 xlsx 应显示「表格」：${snapshot.captions[1]}`);
  assert.equal(snapshot.captions[2], 'PDF 文档', `没有说明的 pdf 应显示「PDF 文档」：${snapshot.captions[2]}`);
  assert.equal(snapshot.captions[3], '纯文本', `没有说明的 md 应显示「纯文本」：${snapshot.captions[3]}`);
  assert.ok(snapshot.titles[0].endsWith('季度汇总.docx'), `卡片缺少完整路径提示：${snapshot.titles[0]}`);
  await record('卡片显示文件名与说明／文件类型', { captions: snapshot.captions });

  assert.equal(snapshot.more, '展开全部 5 个交付', `折叠提示不符：${snapshot.more}`);
  await ui.evaluate('(()=>{const node=document.querySelector(".deliverable-more");if(!node)throw new Error("Missing 展开全部");node.click();return true})()');
  await pause(250);
  const expanded = await cards();
  assert.equal(expanded.count, 5, `展开后应显示五张卡片，实际 ${expanded.count}`);
  assert.equal(expanded.more, '收起', `展开后按钮应变为「收起」：${expanded.more}`);
  assert.equal(expanded.names[4], '封面.png');
  await record('展开后显示全部五张卡片', { names: expanded.names });

  await ui.evaluate('(()=>{const node=document.querySelector(".deliverable-more");if(!node)throw new Error("Missing 收起");node.click();return true})()');
  await pause(250);
  assert.equal((await cards()).count, 4, '收起后应回到四张卡片');
  await record('收起恢复四张卡片');

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

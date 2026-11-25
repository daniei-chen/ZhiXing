// 行内文件引用实包验收（对标 dsh-client-ui-deliverables 的「行内代码链接」）：
// 假服务让模型 present 四个文件（其中两个同名），收尾正文用行内代码点名它们：
// 唯一 basename 与精确路径应变成可点击引用，重名 basename 和未交付的路径保持普通代码。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/inline-references`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const workspaceDir = path.join(evidence, '工作区');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(path.join(workspaceDir, '成果'), { recursive: true });
await fs.mkdir(path.join(workspaceDir, '归档'), { recursive: true });
const files = [
  { path: '成果/季度汇总.docx', description: '第三季度经营汇总' },
  { path: '成果/明细.xlsx' },
  { path: '归档/明细.xlsx' },
  { path: '说明.pdf' },
];
for (const file of files) await fs.writeFile(path.join(workspaceDir, file.path), `QA inline reference ${file.path}\n`);
const TICK = '\u0060';
const FENCE = TICK.repeat(3);
const answer = () => '已完成。主文件是 ' + TICK + '季度汇总.docx' + TICK + '，另见 ' + TICK + '说明.pdf' + TICK +
  '；同名文件 ' + TICK + '明细.xlsx' + TICK + ' 与未交付的 ' + TICK + '不存在.docx' + TICK + ' 保持普通代码，下面代码块里的同名内容也不该变成链接。' +
  '\n\n' + FENCE + '\n季度汇总.docx\n' + FENCE + '\n';
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
    response.end(JSON.stringify({ data: [{ id: 'qa-inline-model', name: 'QA 行内引用模型', input_modalities: ['text'] }] }));
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
    const base = { id: 'chatcmpl-qa-inline', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-inline-model' };
    const chunk = delta => ({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write(chunk({ role: 'assistant' }));
    if (!hasToolResult) {
      write(chunk({ tool_calls: [{ index: 0, id: 'call-qa-inline', type: 'function', function: { name: 'present', arguments: JSON.stringify({ files }) } }] }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      write(chunk({ content: answer() }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

const snapshot = () => ui.evaluate(`(()=>{const box=[...document.querySelectorAll('.assistant-message .answer-text')].at(-1);if(!box)return {refs:[],codes:[],blockRefs:0,text:''};const refs=[...box.querySelectorAll('code.inline-file-ref')];return {refs:refs.map(node=>({text:node.textContent.trim(),title:node.getAttribute('title')||'',role:node.getAttribute('role')||''})),codes:[...box.querySelectorAll('code')].map(node=>node.textContent.trim()),html:box.innerHTML.slice(0,2600),structure:[...box.querySelectorAll('code')].map(node=>({text:node.textContent.trim(),parent:node.parentElement?.tagName||'',grand:node.parentElement?.parentElement?.className||'',cls:node.className||'',ref:node.classList.contains('inline-file-ref')})),blockRefs:box.querySelectorAll('pre code.inline-file-ref').length,preCodes:box.querySelectorAll('.answer-code code').length,inlineCodes:box.querySelectorAll('p code').length,text:box.innerText};})()`);
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
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 行内服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-inline-000000000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 行内服务')||status.providers.at(-1);
    const projectId='qa-project-inline';
    const workspaceId='qa-workspace-inline';
    const workspace={id:workspaceId,name:'QA 行内工作区',type:'office',directory:${JSON.stringify(workspaceDir)},projectId};
    const s=await window.zhixing.loadWorkspace();
    s.projects=[...(s.projects||[]).filter(item=>item.id!==projectId),{id:projectId,name:'QA 行内项目',instructions:'',directory:${JSON.stringify(workspaceDir)},workspaceId,expanded:true}];
    s.workspaces=[...(s.workspaces||[]).filter(item=>item.id!==workspaceId),workspace];
    s.workspaceId=workspaceId;
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-inline-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {providerId:mine.id,workspaceId,projectId};
  })()`);
  report.workspace = prepared; await persist();
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);

  await ui.evaluate('(()=>{const node=[...document.querySelectorAll(".sidebar button, .sidebar [role=\\"button\\"], button")].find(el=>el.textContent.trim().includes("QA 行内项目"));if(!node)throw new Error("Missing project row");node.click();return true})()');
  await pause(1500);
  if (!(await ui.evaluate('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')'))) {
    await ui.evaluate('(()=>{const node=[...document.querySelectorAll("button")].find(el=>/新建|新对话|开始/u.test(el.textContent));if(node)node.click();return true})()');
    await pause(1500);
  }
  await record('临时工作区与假服务就绪', { workspace: prepared.workspaceId });

  await ui.fill('textarea[aria-label="聊天输入框"]', '把这四份文件交付，并在结尾点名它们。');
  await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');
  const deadline = Date.now() + 150000;
  let state = await snapshot();
  while (Date.now() < deadline) {
    state = await snapshot();
    const busy = await ui.evaluate('Boolean(document.querySelector(".thinking-label"))');
    if (state.refs.length && !busy) break;
    await pause(300);
  }
  await ui.screenshot(path.join(evidence, 'inline-references.png'));
  report.answer = state; await persist();

  assert.ok(state.text.includes('已完成'), `回答正文没有出现：${state.text.slice(0, 120)}`);
  assert.equal(state.refs.length, 2, `可点击引用数量不对：${state.refs.map(item => item.text).join(' | ')}`);
  assert.deepEqual(state.refs.map(item => item.text), ['季度汇总.docx', '说明.pdf'], `可点击的 token 不符：${state.refs.map(item => item.text).join(' | ')}`);
  await record('唯一 basename 变成可点击引用', { refs: state.refs });

  assert.equal(state.refs[0].title, path.join(workspaceDir, '成果', '季度汇总.docx'), `引用 title 不是完整路径：${state.refs[0].title}`);
  assert.equal(state.refs[1].title, path.join(workspaceDir, '说明.pdf'), `引用 title 不是完整路径：${state.refs[1].title}`);
  assert.equal(state.refs[0].role, 'link', `引用缺少 link 角色：${state.refs[0].role}`);
  await record('引用保留代码标签并把完整路径放进 title');

  const plain = state.codes.filter(text => !state.refs.some(ref => ref.text === text));
  assert.ok(plain.includes('明细.xlsx'), `重名 basename 不应变成链接：${state.codes.join(' | ')}`);
  assert.ok(plain.includes('不存在.docx'), `未交付路径不应变成链接：${state.codes.join(' | ')}`);
  await record('重名 basename 与未交付路径保持普通代码', { plain });

  assert.equal(state.blockRefs, 0, '代码块里的内容被错误地变成引用');
  await record('代码块内容不受影响');

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

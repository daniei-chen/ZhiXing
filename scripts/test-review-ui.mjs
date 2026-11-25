// 改动对比视图实包验收（对标 dsh-client-ui-deliverables 的 changes-review tab）：
// 真实内核在项目工作区里写四次文件（同一路径三次、另一文件一次），轮次结束后
// 点改动文件卡片的一行，工作面板应切到「改动」视图：左边文件列表两个、右边选中文件的逐行对比，
// 新增行带 +、删除行带 −、远处相同的行折叠成 gap；切换文件后对比内容随之变化。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/review`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const workspaceDir = path.join(evidence, '工作区');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(workspaceDir, { recursive: true });
const firstFile = '纪要.md';
const secondFile = '清单.md';
const first = '第一行\n第二行\n第三行\n第四行\n第五行\n第六行';
const firstUpdated = `${first}\n第七行\n第八行`;
const firstTrimmed = '第一行\n第二行\n改过的第三行';
const second = '甲\n乙\n丙';
const writes = [
  { id: 'call-qa-review-1', name: 'write', arguments: JSON.stringify({ file_path: firstFile, content: first }) },
  { id: 'call-qa-review-2', name: 'write', arguments: JSON.stringify({ file_path: firstFile, content: firstUpdated }) },
  { id: 'call-qa-review-3', name: 'write', arguments: JSON.stringify({ file_path: secondFile, content: second }) },
  { id: 'call-qa-review-4', name: 'write', arguments: JSON.stringify({ file_path: firstFile, content: firstTrimmed }) },
];
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
    response.end(JSON.stringify({ data: [{ id: 'qa-review-model', name: 'QA 对比模型', input_modalities: ['text'] }] }));
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
    const base = { id: 'chatcmpl-qa-review', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-review-model' };
    const chunk = delta => ({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write(chunk({ role: 'assistant' }));
    if (toolResults < writes.length) {
      const call = writes[toolResults];
      write(chunk({ tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      write(chunk({ content: '两个文件都改好了，可以逐文件看对比。' }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

const cards = () => ui.evaluate(`(()=>{const box=[...document.querySelectorAll('.assistant-message .change-files')].at(-1);if(!box)return {count:0};return {count:Number(box.dataset.count||0),header:(box.querySelector('header')?.textContent||'').trim(),rows:[...box.querySelectorAll('li button')].map(node=>({name:node.querySelector('span')?.textContent||'',counts:node.querySelector('small')?.textContent||''}))};})()`);
const clickRow = index => ui.evaluate(`(()=>{const box=[...document.querySelectorAll('.assistant-message .change-files')].at(-1);const button=[...box.querySelectorAll('li button')][${index}];if(!button)throw new Error('missing row');button.click();return true})()`);
const review = () => ui.evaluate(`(()=>{const panel=[...document.querySelectorAll('.review-panel')].at(-1);if(!panel)return {open:false};const select=document.querySelector('select[aria-label="工作面板视图"]');return {open:true,view:select?.value||'',header:(panel.querySelector('.review-head strong')?.textContent||'').trim(),summary:(panel.querySelector('.review-head small')?.textContent||'').trim(),files:[...panel.querySelectorAll('.review-files button')].map(node=>({name:node.querySelector('span')?.textContent||'',counts:node.querySelector('small')?.textContent||'',active:node.getAttribute('aria-pressed')==='true'})),diffLabel:panel.querySelector('.review-diff')?.getAttribute('aria-label')||'',rows:[...panel.querySelectorAll('.review-diff .review-line')].map(node=>({type:node.dataset.type||'gap',text:(node.querySelector('code')?.textContent||'').trim()})),notes:[...panel.querySelectorAll('.review-note')].map(node=>node.textContent.trim())};})()`);

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
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 对比服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-review-0000000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 对比服务')||status.providers.at(-1);
    const projectId='qa-project-review';
    const workspaceId='qa-workspace-review';
    const workspace={id:workspaceId,name:'QA 对比工作区',type:'office',directory:${JSON.stringify(workspaceDir)},projectId};
    const s=await window.zhixing.loadWorkspace();
    s.projects=[...(s.projects||[]).filter(item=>item.id!==projectId),{id:projectId,name:'QA 对比项目',instructions:'',directory:${JSON.stringify(workspaceDir)},workspaceId,expanded:true}];
    s.workspaces=[...(s.workspaces||[]).filter(item=>item.id!==workspaceId),workspace];
    s.workspaceId=workspaceId;
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-review-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {providerId:mine.id,workspaceId,projectId};
  })()`);
  report.workspace = prepared; await persist();
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);

  await ui.evaluate('(()=>{const node=[...document.querySelectorAll(".sidebar button, .sidebar [role=\\"button\\"], button")].find(el=>el.textContent.trim().includes("QA 对比项目"));if(!node)throw new Error("Missing project row");node.click();return true})()');
  await pause(1500);
  if (!(await ui.evaluate('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')'))) {
    await ui.evaluate('(()=>{const node=[...document.querySelectorAll("button")].find(el=>/新建|新对话|开始/u.test(el.textContent));if(node)node.click();return true})()');
    await pause(1500);
  }
  await record('临时工作区与假服务就绪', { workspace: prepared.workspaceId });

  await ui.fill('textarea[aria-label="聊天输入框"]', '把纪要改好，另外写一份清单。');
  await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');
  const deadline = Date.now() + 180000;
  let cardState = await cards();
  while (Date.now() < deadline) {
    cardState = await cards();
    const busy = await ui.evaluate('Boolean(document.querySelector(".thinking-label"))');
    if (cardState.count >= 2 && !busy) break;
    await pause(300);
  }
  report.cards = cardState; await persist();
  assert.equal(cardState.count, 2, `改动文件数不对：${cardState.count}`);
  assert.equal(cardState.header.includes('本轮改动 2 个文件'), true, `卡片标题不符：${cardState.header}`);
  await record('改动文件卡片给出两个文件', { header: cardState.header, rows: cardState.rows.map(row => row.name) });

  await clickRow(0);
  await pause(1200);
  let view = await review();
  await ui.screenshot(path.join(evidence, 'review.png'));
  report.review = view; await persist();
  assert.equal(view.open, true, '没有打开对比视图');
  assert.equal(view.view, 'review', `工作面板视图不是改动页：${view.view}`);
  assert.equal(view.header.includes('本轮改动 2 个文件'), true, `对比视图标题不符：${view.header}`);
  assert.deepEqual(view.files.map(file => file.name).sort(), [firstFile, secondFile].sort(), `文件列表不符：${view.files.map(file => file.name).join(' | ')}`);
  assert.equal(view.files.filter(file => file.active).length, 1, '应只有一个文件处于选中态');
  await record('点击卡片行进入改动对比视图', { files: view.files.map(file => file.name) });

  const added = view.rows.filter(row => row.type === 'add').map(row => row.text);
  const removed = view.rows.filter(row => row.type === 'remove').map(row => row.text);
  const gaps = view.rows.filter(row => row.type === 'gap').length;
  report.rows = { added, removed, gaps, total: view.rows.length }; await persist();
  assert.equal(added.includes('第七行'), true, `新增行里没有第七行：${added.join(' | ')}`);
  assert.equal(added.includes('改过的第三行'), true, `新增行里没有改过的第三行：${added.join(' | ')}`);
  assert.equal(removed.includes('第八行'), true, `删除行里没有第八行：${removed.join(' | ')}`);
  assert.equal(removed.includes('第一行'), false, `保留下来的一行不该被标成删除：${removed.join(' | ')}`);
  assert.equal(removed.includes('第二行'), false, `保留下来的一行不该被标成删除：${removed.join(' | ')}`);
  assert.ok(gaps >= 1, `不同批次的改动之间应有折叠行，实际 ${gaps}`);
  assert.equal(view.diffLabel.includes(firstFile), true, `对比区标题没带文件名：${view.diffLabel}`);
  await record('对比行区分新增、删除与折叠', { added: added.length, removed: removed.length, gaps });

  const switched = view.files.find(file => file.name === secondFile);
  await ui.evaluate(`(()=>{const panel=[...document.querySelectorAll('.review-panel')].at(-1);const button=[...panel.querySelectorAll('.review-files button')].find(node=>(node.querySelector('span')?.textContent||'')===${JSON.stringify(secondFile)});if(!button)throw new Error('missing second file');button.click();return true})()`);
  await pause(900);
  view = await review();
  report.switched = view; await persist();
  assert.equal(view.diffLabel.includes(secondFile), true, `切换文件后对比区标题不对：${view.diffLabel}`);
  assert.deepEqual(view.rows.filter(row => row.type === 'add').map(row => row.text), ['甲', '乙', '丙'], `第二个文件的对比行不符：${view.rows.map(row => row.text).join(' | ')}`);
  await record('切换文件后对比内容随之变化', { file: secondFile });

  const workspaceFirst = await fs.readFile(path.join(workspaceDir, firstFile), 'utf8');
  assert.equal(workspaceFirst, firstTrimmed, '工作区里的文件不是最后一次写入的内容');
  await record('对比的是真实写盘结果');

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

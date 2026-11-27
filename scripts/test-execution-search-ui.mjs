// 执行轨迹检索的实包验收（对标桌面版 Trajectory 工具栏的「搜索轨迹」与「展开／收起所有调用」）。
// 本地假服务一次返回两个工具调用（todo_write + office_calculate），内核真的执行，
// 执行面板应能按关键词过滤、显示匹配数量、并整体展开／收起事件行。
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { connectUi } from './qa-cdp.mjs';
import { selectWorkbenchTab } from './qa-workbench.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = process.cwd();
const exe = path.resolve(process.argv[2] || path.join(root, 'release/win-unpacked/知行.exe'));
const provenance = JSON.parse(await fs.readFile(path.join(path.dirname(exe), 'resources/app/build-provenance.json'), 'utf8'));
const evidence = path.join(root, `.preview/qa-${provenance.version}/execution-search`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const report = {
  layer: 'windows-packaged-app + real-kernel + local fake provider', version: provenance.version,
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
    response.end(JSON.stringify({ data: [{ id: 'qa-trace-model', name: 'QA 轨迹模型', input_modalities: ['text'] }] }));
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
    const base = { id: 'chatcmpl-qa-trace', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-trace-model' };
    const chunk = delta => ({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write(chunk({ role: 'assistant' }));
    if (!toolResults) {
      write(chunk({ tool_calls: [
        { index: 0, id: 'call-qa-todo', type: 'function', function: { name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: '核对执行轨迹检索', status: 'completed' }] }) } },
        { index: 1, id: 'call-qa-calc', type: 'function', function: { name: 'office_calculate', arguments: JSON.stringify({ expression: '2+3' }) } },
      ] }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      write(chunk({ content: '两个工具都跑完了。' }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

let ui = null, child = null, exit = null, log = null;
const labels = () => ui.evaluate('[...document.querySelectorAll(".execution-entry summary span")].map(node=>node.textContent.trim())');
const summaryText = () => ui.evaluate('(()=>{const node=document.querySelector(".execution-search small");return node?node.textContent.trim():""})()');
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

  const saved = await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 轨迹服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-trace-000000000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 轨迹服务')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-trace-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {providerId:mine.id};
  })()`);
  assert.ok(saved.providerId);
  try { await ui.evaluate('location.reload(); true'); } catch { /* The renderer may reload before the CDP reply. */ }
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);

  await ui.fill('textarea[aria-label="聊天输入框"]', '请先核对工作计划，再算一下 2+3。');
  await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const busy = await ui.evaluate('Boolean(document.querySelector(".thinking-label"))');
    const answered = await ui.evaluate('[...document.querySelectorAll(".assistant-message")].at(-1)?.innerText.includes("两个工具都跑完了")||false');
    if (answered && !busy) break;
    await pause(300);
  }

  if (!await ui.evaluate('!!document.querySelector(".workbench:not([hidden])")')) await ui.click('打开工作面板', 'button[aria-label="打开工作面板"]');
  await selectWorkbenchTab(ui, 'activity');
  await ui.waitFor('!!document.querySelector(\'input[aria-label="搜索轨迹"]\')', 20000);
  await ui.waitFor('document.querySelectorAll(".execution-entry").length>=2', 30000);

  const placeholder = await ui.evaluate('document.querySelector(\'input[aria-label="搜索轨迹"]\').getAttribute("placeholder")');
  assert.equal(placeholder, '搜索', `搜索框占位文案不是「搜索」：${placeholder}`);
  const initial = await labels();
  assert.ok(initial.some(label => label.includes('更新工作计划')), `初始列表缺少工作计划事件：${initial.join(' | ')}`);
  assert.ok(initial.some(label => label.includes('数字计算')), `初始列表缺少数字计算事件：${initial.join(' | ')}`);
  await record('执行面板出现搜索框，事件列表包含两次工具调用', { initial });

  await ui.fill('input[aria-label="搜索轨迹"]', '数字计算');
  await pause(200);
  const filtered = await labels();
  assert.ok(filtered.length > 0, '按「数字计算」过滤后没有事件');
  assert.ok(filtered.every(label => label.includes('数字计算')), `过滤结果混入其他事件：${filtered.join(' | ')}`);
  const matched = await summaryText();
  assert.match(matched, /^匹配 \d+ \/ \d+ 条$/u, `匹配摘要不符合预期：${matched}`);
  await record('按关键词过滤只保留匹配事件，并给出匹配数量', { filtered, matched });

  await ui.fill('input[aria-label="搜索轨迹"]', '不存在的工具名');
  await pause(200);
  const empty = await labels();
  const emptyText = await summaryText();
  assert.equal(empty.length, 0, `不存在关键词仍有事件：${empty.join(' | ')}`);
  assert.equal(emptyText, '没有匹配「不存在的工具名」的记录', `空结果提示不符合预期：${emptyText}`);
  await record('无匹配时给出明确提示', { emptyText });

  await ui.fill('input[aria-label="搜索轨迹"]', '');
  await pause(200);
  assert.equal((await labels()).length, initial.length, '清空搜索后事件数量没有恢复');
  await record('清空搜索恢复全部事件');

  // 面板底部按钮会被 content-visibility 跳过，getClientRects 为空，按可见性找不到，直接派发 DOM click。
  await ui.evaluate('(()=>{const node=[...document.querySelectorAll(".execution-search button")].find(button=>button.textContent.trim()==="收起所有事件");if(!node)throw new Error("Missing 收起所有事件");node.click();return true})()');
  await pause(250);
  const allClosed = await ui.evaluate('[...document.querySelectorAll(".execution-entry")].every(node=>!node.open)');
  assert.equal(allClosed, true, '「收起所有事件」后仍有展开的行');
  await ui.evaluate('(()=>{const node=[...document.querySelectorAll(".execution-search button")].find(button=>button.textContent.trim()==="展开所有事件");if(!node)throw new Error("Missing 展开所有事件");node.click();return true})()');
  await pause(250);
  const allOpen = await ui.evaluate('[...document.querySelectorAll(".execution-entry")].every(node=>node.open)');
  assert.equal(allOpen, true, '「展开所有事件」后仍有收起的行');
  await ui.screenshot(path.join(evidence, 'execution-search.png'));
  await record('收起／展开所有事件按预期生效');

  report.status = 'passed'; await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, evidence }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = String(error?.message || error); await persist();
  console.error(`FAIL ${report.error}`);
  process.exitCode = 1;
} finally {
  try { server.closeAllConnections(); server.close(); } catch { /* Legacy teardown tolerates an already-closed fixture server. */ }
  try { if (ui) await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {}); } catch { /* The window may close before the CDP reply. */ }
  try { if (ui) ui.close(); } catch { /* Legacy teardown tolerates an already-closed CDP connection. */ }
  try { if (child && child.exitCode === null) { child.kill(); if (exit) await Promise.race([exit, pause(8000)]); } } catch { /* Legacy teardown continues if the child already exited. */ }
  try { if (log) await log.close(); } catch { /* Legacy teardown tolerates an already-closed log handle. */ }
  try { await fs.rm(profile, { recursive: true, force: true }); } catch { /* Legacy cleanup remains best effort; this selector migration does not change its verdict. */ }
}

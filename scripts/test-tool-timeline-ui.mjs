// 工具时间线的实包验收：用本地假服务让模型返回一次 tool_call（todo_write），
// 内核真的执行这个工具，界面应在消息下方自动列出「调用 · 更新工作计划」。
// 不依赖真实云端，也不依赖工作区（todo_write 不需要文件系统）。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/tool-timeline`, `run-${Date.now().toString(36)}`);
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

const hits = [];
const server = http.createServer((request, response) => {
  hits.push(`${request.method} ${request.url}`);
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qa-tool-model', name: 'QA 工具模型', input_modalities: ['text'] }] }));
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
    report.lastRequestKeys = Object.keys(payload);
    const hasToolResult = (payload.messages || []).some(message => message.role === 'tool');
    const base = { id: 'chatcmpl-qa', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-tool-model' };
    const chunk = delta => ({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write(chunk({ role: 'assistant' }));
    if (!hasToolResult) {
      write(chunk({ tool_calls: [{ index: 0, id: 'call-qa-1', type: 'function', function: { name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: '检查工具时间线', status: 'completed' }] }) } }] }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      write(chunk({ content: '工具已经跑完了。' }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

let ui = null, child = null, exit = null, log = null;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  report.provider = base; await persist();

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
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 45000);

  const saved = await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 工具服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-tool-0000000000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 工具服务')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-tool-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {providerId:mine.id};
  })()`);
  assert.ok(saved.providerId);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);
  await record('假服务已保存，工作区指向它');

  await ui.fill('textarea[aria-label="聊天输入框"]', '请把「检查工具时间线」记成一条已完成的工作计划。');
  await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');

  const deadline = Date.now() + 120000;
  let rows = [];
  let answer = '';
  while (Date.now() < deadline) {
    const snapshot = await ui.evaluate('(()=>{const strips=[...document.querySelectorAll(".tool-strip")];const last=strips.at(-1);return {rows:last?[...last.querySelectorAll("li")].map(li=>li.textContent.trim()):[],answer:[...document.querySelectorAll(".assistant-message")].at(-1)?.innerText.trim()||"",busy:Boolean(document.querySelector(".thinking-label"))};})()');
    rows = snapshot.rows; answer = snapshot.answer;
    if (rows.length && !snapshot.busy) break;
    await pause(300);
  }
  await ui.screenshot(path.join(evidence, 'tool-timeline.png'));
  report.rows = rows; report.answer = answer.slice(0, 200); report.providerCalls = hits.slice(-6); await persist();
  assert.ok(rows.length > 0, '消息下方没有工具调用记录');
  assert.ok(rows.some(label => label.includes('调用 · 更新工作计划')), `没有看到调用行：${rows.join(' | ')}`);
  assert.ok(rows.some(label => /更新工作计划 · 完成/u.test(label)), `没有看到完成行：${rows.join(' | ')}`);
  await record('工具调用与结果自动列在消息下方', { rows });

  report.status = 'passed'; await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, rows, evidence }, null, 2));
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

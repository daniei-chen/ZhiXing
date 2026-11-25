// Windows 实包验收：真实跑一次原生子任务，再把它归档。
// 本地假模型服务让主会话调用 subagent 工具，子会话自己发一次请求拿到回答，
// 因此归档里的子会话对话来自真实内核运行，而不是脚本注入的记录。
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { connectUi } from './qa-cdp.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = process.cwd();
const exe = path.resolve(process.argv[2] || path.join(root, 'release/win-unpacked/知行.exe'));
const appRoot = path.dirname(exe);
const provenance = JSON.parse(await fs.readFile(path.join(appRoot, 'resources/app/build-provenance.json'), 'utf8'));
const evidence = path.join(root, `.preview/qa-${provenance.version}/real-subagent-archive`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const archive = path.join(evidence, '子会话-1.md');
const model = 'qa-real-subagent-model';
const childAnswer = '华东增长 12%，华南持平，北方下滑 3%。';
const finalAnswer = '汇总完成：华东增长 12%。';
const report = {
  layer: 'windows-packaged-app',
  version: provenance.version,
  sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'),
  status: 'running',
  requests: [],
  records: [],
};
const persist = () => fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.records.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);
await fs.mkdir(profile, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/v1/models') {
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: model }] }));
    }
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const tools = (body.tools || []).map(tool => tool.function?.name).filter(Boolean);
    const toolMessages = body.messages.filter(message => message.role === 'tool');
    const lastUser = body.messages.filter(message => message.role === 'user').at(-1);
    const number = report.requests.length + 1;
    const lastMessage = body.messages.at(-1);
    const lastContent = String(lastMessage?.content ?? '');
    const childRequest = lastMessage?.role === 'user' && lastContent.includes('只回答数字') && !lastContent.startsWith('Background subagent');
    report.requests.push({ number, model: body.model, systemHead: String(body.messages.find(m => m.role === 'system')?.content ?? '').replace(/\s+/g, ' ').slice(0, 220), headerKeys: Object.keys(req.headers).filter(k => /session|agent|parent|trace|run/i.test(k)), headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => /session|agent|parent|trace|run/i.test(k))), messageCount: body.messages.length, tools: tools.slice(0, 40), toolMessages: toolMessages.length, childRequest, prompt: String(lastUser?.content ?? '').slice(0, 120), lastRole: body.messages.at(-1)?.role, lastText: String(body.messages.at(-1)?.content ?? '').slice(0, 160), systemCount: body.messages.filter(m => m.role === 'system').length, toolResult: toolMessages.length ? JSON.stringify(toolMessages.at(-1)).slice(0, 400) : null });
    void persist();
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const emit = (delta, finish = null) => `data: ${JSON.stringify({ id: `qa-real-${number}`, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    if (number === 1) {
      const args = { prompt: '把上周的销售表汇总成一段结论，只回答数字。', description: '汇总上周销售表', name: 'qa-sales' };
      res.end(emit({ role: 'assistant', content: '' }) + emit({ tool_calls: [{ id: 'qa-subagent-1', index: 0, type: 'function', function: { name: 'subagent', arguments: JSON.stringify(args) } }] }) + emit({}, 'tool_calls') + 'data: [DONE]\n\n');
      return;
    }
    if (childRequest) {
      res.end(emit({ role: 'assistant', content: '' }) + emit({ content: childAnswer }) + emit({}, 'stop') + 'data: [DONE]\n\n');
      return;
    }
    res.end(emit({ role: 'assistant', content: '' }) + emit({ content: finalAnswer }) + emit({}, 'stop') + 'data: [DONE]\n\n');
  } catch (error) {
    report.fixtureError = error.message;
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;

const ui = { current: null };
const invoke = (method, value) => ui.current.evaluate(`window.zhixing.${method}(${JSON.stringify(value) ?? ''})`);
let proc = null, main = null, log = null;
const logfile = path.join(evidence, 'app.log');
log = await fs.open(logfile, 'a');
const portsFile = path.join(profile, 'DevToolsActivePort');
await fs.rm(portsFile, { force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
proc = spawn(exe, [`--user-data-dir=${profile}`, '--inspect=127.0.0.1:0', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
const exit = once(proc, 'close');
const deadline = Date.now() + 60000;
let port = null;
while (!port && Date.now() < deadline) {
  if (proc.exitCode !== null) throw new Error(`packaged app exited at launch (${proc.exitCode})`);
  const text = await fs.readFile(portsFile, 'utf8').catch(() => null);
  if (text) port = Number(text.split(/\r?\n/)[0]);
  if (!port) await pause(200);
}
assert.ok(port, 'DevTools port published');
while (!ui.current && Date.now() < deadline) {
  ui.current = await connectUi(port).catch(() => null);
  if (!ui.current) await pause(200);
}
assert.ok(ui.current, 'renderer connected');
const uiRef = ui.current;
const mainDeadline = Date.now() + 60000;
while (!main && Date.now() < mainDeadline) {
  const match = (await fs.readFile(logfile, 'utf8')).match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)/);
  if (match) main = await connectUi(Number(match[1]), true).catch(() => null);
  if (!main) await pause(200);
}
assert.ok(main, 'main-process test connection started');
await main.evaluate(`(()=>{
 const {dialog}=process.mainModule.require('electron');
 globalThis.__qaArchiveDialogs=[];
 dialog.showSaveDialog=async (_owner,options)=>{globalThis.__qaArchiveDialogs.push({title:options.title,defaultPath:options.defaultPath});return {canceled:false,filePath:${JSON.stringify(archive)}};};
 return true;})()`);

try {
await uiRef.waitFor('!!(window.zhixing&&document.readyState==="complete")', 60000);
await uiRef.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 60000);
let state = null;
const stateDeadline = Date.now() + 30000;
while (!state && Date.now() < stateDeadline) {
  state = await uiRef.evaluate('(async()=>{const value=await window.zhixing.loadWorkspace();return value||null})()');
  if (!state) await pause(250);
}
assert.ok(state, 'workspace state is available');

const provider = await invoke('saveProvider', { name: 'QA Real Subagent', protocol: 'openai', baseUrl: endpoint, apiKey: 'synthetic-real-subagent-key', reasoningStyle: 'standard', discover: true });
const providerId = provider.providers.find(row => row.name === 'QA Real Subagent')?.id;
assert.ok(providerId, 'provider saved');
const fresh = await invoke('loadWorkspace');
Object.assign(fresh.settings, { persist: true, demo: false, modelProviderId: providerId, model, reasoning: 'high', permission: 'full', privacyMode: 'redact' });
fresh.chats = fresh.chats || [];
fresh.chats.push({ id: 'qa-real-chat', workspaceId: fresh.workspaceId, projectId: null, title: '真实子任务归档验收', createdAt: Date.now(), messages: [] });
await invoke('saveWorkspace', fresh);
await uiRef.send('Page.reload');
await uiRef.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 60000);
await uiRef.waitFor('Array.from(document.querySelectorAll(".chat-row")).some(row=>row.textContent.includes("真实子任务归档验收"))', 30000);
const rowRect = await uiRef.evaluate('(()=>{const row=[...document.querySelectorAll(".chat-row")].find(r=>r.textContent.includes("真实子任务归档验收"));const r=row.getBoundingClientRect();return {x:r.x+40,y:r.y+r.height/2};})()');
await uiRef.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: rowRect.x, y: rowRect.y });
await uiRef.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: rowRect.x, y: rowRect.y });
await pause(800);

await uiRef.fill('textarea[aria-label="聊天输入框"]', '把上周的销售表汇总成一段结论。');
await uiRef.click('发送消息', '.composer button');
await uiRef.waitFor(`document.querySelector('.transcript')?.textContent.includes(${JSON.stringify(finalAnswer)})&&!document.querySelector('button[aria-label=停止生成]')`, 120000);
await pause(1200);
assert.equal(report.fixtureError, undefined);
const parentRequest = report.requests.find(item => !item.childRequest);
let childRequest = report.requests.find(item => item.childRequest);
const childDeadline = Date.now() + 30000;
while (!childRequest && Date.now() < childDeadline) { await pause(500); childRequest = report.requests.find(item => item.childRequest); }
assert.ok(parentRequest, 'parent model request recorded');
assert.ok(parentRequest.tools.includes('subagent'), 'subagent tool was offered to the parent');
assert.ok(childRequest, 'child session issued its own model request');
await record('真实跑通一次原生子任务：主会话调用 subagent，子会话另有模型请求', {
  parentTools: parentRequest.tools.length,
  childPrompt: childRequest.prompt,
  requests: report.requests.length,
});

const transcript = await uiRef.evaluate('document.querySelector(".transcript")?.textContent || ""');
assert.match(transcript, /协作子任务|子任务/);
assert.match(transcript, new RegExp(finalAnswer.slice(0, 6)));
await uiRef.click('打开工作面板').catch(async () => {
  if (await uiRef.evaluate('!![...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="打开工作面板")')) await uiRef.click('打开工作面板');
});
await uiRef.waitFor('!!document.querySelector(\'select[aria-label="工作面板视图"]\')', 30000);
await uiRef.evaluate('(()=>{const s=document.querySelector(\'select[aria-label="工作面板视图"]\');s.value="activity";s.dispatchEvent(new Event("change",{bubbles:true}));return s.value;})()');
await uiRef.waitFor('!!document.querySelector(".execution-children")', 30000);
await record('执行面板列出这次真实运行的协作子任务');

await uiRef.click('归档');
await uiRef.waitFor('!!document.querySelector(".execution-note")', 60000);
const note = await uiRef.evaluate('document.querySelector(".execution-note").textContent');
assert.match(note, /已归档到/);
const written = await fs.readFile(archive, 'utf8');
assert.match(written, /^# 子会话归档 · 子任务 1/m);
assert.match(written, /- 所属会话：真实子任务归档验收/);
assert.ok(written.includes(childAnswer), '归档里要有子会话真实回答');
assert.match(written, /- 状态：finished|- 状态：completed/);
await record('归档文件包含真实子会话回答与所属会话名', { bytes: Buffer.byteLength(written), note });

report.status = 'passed';
await persist();
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.message || error);
  await persist();
  throw error;
}
uiRef.close();
void uiRef.evaluate('window.zhixing.windowControl("close")').catch(() => {});
await Promise.race([exit, pause(30000)]).catch(() => {});
main?.close();
proc.kill();
await exit.catch(() => {});
await log.close();
server.close();
console.log(JSON.stringify({ status: report.status, records: report.records.length, evidence }, null, 2));

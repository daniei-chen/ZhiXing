// Windows 实包验收：执行面板里把子会话归档成 Markdown。
// 真实点击「归档」→ 主进程弹原生保存对话框（被脚本接管）→ 落盘 → 读回核对内容。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/subagent-archive`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const archive = path.join(evidence, '子会话-1.md');
const report = {
  layer: 'windows-packaged-app',
  version: provenance.version,
  sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'),
  status: 'running',
  records: [],
};
const persist = () => fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.records.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);
await fs.mkdir(profile, { recursive: true });

const child = {
  id: 'qa-child-1',
  parentId: null,
  status: 'finished',
  startedAt: Date.parse('2026-11-25T09:00:00Z'),
  finishedAt: Date.parse('2026-11-25T09:03:00Z'),
  messages: [
    { role: 'user', text: '把上周的销售表汇总成一段结论。' },
    { role: 'assistant', text: '华东增长 12%，华南持平，北方下滑 3%。' },
  ],
};
const message = {
  id: 'qa-message-1',
  role: 'assistant',
  text: '汇总完成：华东增长 12%。',
  createdAt: Date.parse('2026-11-25T09:03:10Z'),
  children: [child],
  trace: [{ type: 'subagents', category: 'agents', label: '子任务已结束', status: 'finished', childSessionId: child.id, children: [child] }],
};

const ui = { current: null };
const invoke = (method, value) => ui.current.evaluate(`window.zhixing.${method}(${JSON.stringify(value) ?? ''})`);
let child_ = null, main = null, log = null;
const logfile = path.join(evidence, 'app.log');
log = await fs.open(logfile, 'a');
const portsFile = path.join(profile, 'DevToolsActivePort');
await fs.rm(portsFile, { force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
child_ = spawn(exe, [`--user-data-dir=${profile}`, '--inspect=127.0.0.1:0', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
const exit = once(child_, 'close');
const deadline = Date.now() + 60000;
let port = null;
while (!port && Date.now() < deadline) {
  if (child_.exitCode !== null) throw new Error(`packaged app exited at launch (${child_.exitCode})`);
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

await uiRef.waitFor('!!(window.zhixing&&document.readyState==="complete")', 60000);
await uiRef.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 60000);
let state = null;
const stateDeadline = Date.now() + 30000;
while (!state && Date.now() < stateDeadline) {
  state = await uiRef.evaluate('(async()=>{const value=await window.zhixing.loadWorkspace();return value||null})()');
  if (!state) await pause(250);
}
assert.ok(state, 'workspace state is available');
state.chats = state.chats || [];
state.chats.push({ id: 'qa-archive-chat', workspaceId: state.workspaceId, projectId: null, title: '子会话归档验收', createdAt: Date.parse('2026-11-25T09:04:00Z'), messages: [message] });
await invoke('saveWorkspace', state);
await uiRef.send('Page.reload');
await uiRef.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 60000);
await uiRef.waitFor('Array.from(document.querySelectorAll(".chat-row")).some(row=>row.textContent.includes("子会话归档验收"))', 30000);
const rowRect = await uiRef.evaluate('(()=>{const e=[...document.querySelectorAll(".chat-row")].find(r=>r.textContent.includes("子会话归档验收"));const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
await uiRef.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: rowRect.x, y: rowRect.y });
await uiRef.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: rowRect.x, y: rowRect.y });
await pause(600);

await uiRef.click('打开工作面板');
await uiRef.waitFor('!!document.querySelector(\'select[aria-label="工作面板视图"]\')', 30000);
await uiRef.evaluate('(()=>{const s=document.querySelector(\'select[aria-label="工作面板视图"]\');s.value="activity";s.dispatchEvent(new Event("change",{bubbles:true}));return s.value;})()');
await uiRef.waitFor('!!document.querySelector(".execution-children")', 30000);
const hasButton = await uiRef.evaluate('!!document.querySelector(".execution-children button.text-button")');
assert.equal(hasButton, true, '子任务行出现归档按钮');
await record('执行面板的子任务行出现「归档」入口');

await uiRef.click('归档');
await uiRef.waitFor('!!document.querySelector(".execution-note")', 60000);
const note = await uiRef.evaluate('document.querySelector(".execution-note").textContent');
assert.match(note, /已归档到/);
const dialogs = await main.evaluate('__qaArchiveDialogs');
assert.equal(dialogs.length, 1);
assert.equal(dialogs[0].title, '归档子会话');
await record('点击后经原生保存对话框写入 Markdown，界面提示路径', { note, defaultPath: dialogs[0].defaultPath });

const written = await fs.readFile(archive, 'utf8');
assert.match(written, /^# 子会话归档 · 子任务 1/m);
assert.match(written, /- 所属会话：子会话归档验收/);
assert.match(written, /- 消息：2 条/);
assert.match(written, /## 交办输入\n\n把上周的销售表汇总成一段结论。/);
assert.match(written, /## 子任务\n\n华东增长 12%，华南持平，北方下滑 3%。/);
await record('归档内容包含会话名、状态、两条消息原文', { bytes: Buffer.byteLength(written) });

await main.evaluate(`(()=>{const {dialog}=process.mainModule.require('electron');dialog.showSaveDialog=async()=>({canceled:true});return true;})()`);
await fs.rm(archive, { force: true });
await uiRef.click('归档');
await pause(1500);
assert.equal(await fs.access(archive).then(() => true, () => false), false);
assert.equal(await uiRef.evaluate('!!document.querySelector(".execution-note")'), false);
await record('取消保存时不写文件、不显示成功提示');

report.status = 'passed';
await persist();
uiRef.close();
void uiRef.evaluate('window.zhixing.windowControl("close")').catch(() => {});
await Promise.race([exit, pause(30000)]).catch(() => {});
main?.close();
child_.kill();
await exit.catch(() => {});
await log.close();
console.log(JSON.stringify({ status: report.status, records: report.records.length, evidence }, null, 2));

// Windows 实包验收：工作面板「文件」页的「打包为 ZIP」。
// 真实点击按钮 → 主进程遍历项目目录 → 原生保存对话框（被验收脚本接管）→ 落盘 zip。
// 用与导入同一套 yauzl 解析回来核对：文件都在、中文名正确、私密文件被排除。
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { connectUi } from './qa-cdp.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = process.cwd();
const exe = path.resolve(process.argv[2] || path.join(root, 'release/win-unpacked/知行.exe'));
const appRoot = path.dirname(exe);
const provenance = JSON.parse(await fs.readFile(path.join(appRoot, 'resources/app/build-provenance.json'), 'utf8'));
const evidence = path.join(root, `.preview/qa-${provenance.version}/zip-export`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const project = path.join(evidence, 'synthetic-project');
const archive = path.join(evidence, '项目打包.zip');
const report = {
  layer: 'windows-packaged-app',
  version: provenance.version,
  sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'),
  status: 'running',
  records: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.records.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

await fs.mkdir(profile, { recursive: true });
await fs.mkdir(path.join(project, 'src'), { recursive: true });
await fs.writeFile(path.join(project, '说明.md'), '# 项目说明\n\n打包验收用。\n');
await fs.writeFile(path.join(project, 'src', 'data.txt'), 'alpha\nbeta\n');
await fs.writeFile(path.join(project, '.env'), 'SECRET=should-not-leak\n');
await fs.writeFile(path.join(project, 'id_rsa.pem'), 'PRIVATE KEY\n');

const ui = { current: null };
const invoke = (method, value) => ui.current.evaluate(`window.zhixing.${method}(${JSON.stringify(value) ?? ''})`);
let child = null, main = null, log = null;
const logfile = path.join(evidence, 'app.log');
log = await fs.open(logfile, 'a');
const portsFile = path.join(profile, 'DevToolsActivePort');
await fs.rm(portsFile, { force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
child = spawn(exe, [`--user-data-dir=${profile}`, '--inspect=127.0.0.1:0', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
const exit = once(child, 'close');
const deadline = Date.now() + 60000;
let port = null;
while (!port && Date.now() < deadline) {
  if (child.exitCode !== null) throw new Error(`packaged app exited at launch (${child.exitCode})`);
  const text = await fs.readFile(portsFile, 'utf8').catch(() => null);
  if (text) port = Number(text.split(/\r?\n/)[0]);
  if (!port) await pause(200);
}
assert.ok(port, 'DevTools port published');
const connectDeadline = Date.now() + 60000;
while (!ui.current && Date.now() < connectDeadline) {
  ui.current = await connectUi(port).catch(() => null);
  if (!ui.current) await pause(200);
}
assert.ok(ui.current, 'renderer connected');
const uiRef = ui.current;

// 主进程侧接管原生保存对话框：真实调用发生，返回值由脚本决定。
const mainDeadline = Date.now() + 60000;
while (!main && Date.now() < mainDeadline) {
  const match = (await fs.readFile(logfile, 'utf8')).match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)/);
  if (match) main = await connectUi(Number(match[1]), true).catch(() => null);
  if (!main) await pause(200);
}
assert.ok(main, 'main-process test connection started');
await main.evaluate(`(()=>{
 const {dialog}=process.mainModule.require('electron');
 globalThis.__qaZipDialogs=[];
 dialog.showSaveDialog=async (_owner,options)=>{globalThis.__qaZipDialogs.push({defaultPath:options.defaultPath,title:options.title});return {canceled:false,filePath:${JSON.stringify(archive)}};};
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
state.projects = state.projects || [];
state.projects.push({ id: 'qa-zip-project', workspaceId: state.workspaceId, name: '打包验收项目', directory: project, expanded: true });
state.chats = state.chats || [];
state.chats.push({ id: 'qa-zip-chat', workspaceId: state.workspaceId, projectId: 'qa-zip-project', title: '打包验收会话', createdAt: Date.now(), messages: [] });
await invoke('saveWorkspace', state);
await uiRef.send('Page.reload');
await uiRef.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 60000);
await uiRef.waitFor('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("打包验收会话"))', 30000);
const rowRect = await uiRef.evaluate(`(()=>{const e=document.querySelector('.chat-row[data-chat-id="qa-zip-chat"]');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
await uiRef.send('Input.dispatchMouseEvent', {type: 'mousePressed', button: 'left', clickCount: 1, x: rowRect.x, y: rowRect.y});
await uiRef.send('Input.dispatchMouseEvent', {type: 'mouseReleased', button: 'left', clickCount: 1, x: rowRect.x, y: rowRect.y});
await pause(500);
await pause(800);
await uiRef.click('打开工作面板');
await uiRef.waitFor('!!document.querySelector(\'select[aria-label="工作面板视图"]\')', 30000);
await uiRef.evaluate(`(()=>{const s=document.querySelector('select[aria-label="工作面板视图"]');s.value='files';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value;})()`);
await uiRef.waitFor('!!document.querySelector(\'.workspace-file-toolbar\')', 30000);
const enabled = await uiRef.evaluate('!document.querySelector(\'button[aria-label="打包为 ZIP"]\').disabled');
assert.equal(enabled, true, '打包按钮可用');
await record('文件页出现「打包为 ZIP」入口且可用（真实点击）', { button: 'button[aria-label="打包为 ZIP"]' });

await uiRef.click('打包为 ZIP');
await uiRef.waitFor('!!document.querySelector(".workbench-note")', 60000);
const note = await uiRef.evaluate('document.querySelector(".workbench-note").textContent');
assert.match(note, /已打包 2 个文件/);
const dialogs = await main.evaluate('__qaZipDialogs');
assert.equal(dialogs.length, 1);
assert.equal(dialogs[0].title, '打包为 ZIP');
await record('点击后经原生保存对话框写入 ZIP，界面提示文件数', { note, defaultPath: dialogs[0].defaultPath });

const files = new Map();
await new Promise((resolve, reject) => {
  yauzl.open(archive, { lazyEntries: true, autoClose: true }, (error, zip) => {
    if (error) return reject(error);
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', entry => {
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError) return reject(streamError);
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry(); });
      });
    });
    zip.readEntry();
  });
});
assert.deepEqual([...files.keys()].sort(), ['src/data.txt', '说明.md'].sort());
assert.equal(files.get('说明.md'), '# 项目说明\n\n打包验收用。\n');
assert.equal(files.get('src/data.txt'), 'alpha\nbeta\n');
assert.ok(![...files.keys()].some(name => /\.env|\.pem$/.test(name)), '私密文件不能进压缩包');
await record('归档内容正确：中文文件名、子目录、私密文件被排除', { entries: [...files.keys()] });

// 取消路径：对话框返回取消时不写文件、不提示成功。
await main.evaluate(`(()=>{const {dialog}=process.mainModule.require('electron');dialog.showSaveDialog=async()=>({canceled:true});return true;})()`);
await fs.rm(archive, { force: true });
await uiRef.click('打包为 ZIP');
await pause(1500);
assert.equal(await fs.access(archive).then(() => true, () => false), false);
assert.equal(await uiRef.evaluate('!!document.querySelector(".workbench-note")'), false);
await record('取消保存时不写文件、不显示成功提示');

report.status = 'passed';
await persist();
uiRef.close();
void uiRef.evaluate('window.zhixing.windowControl("close")').catch(() => {});
await Promise.race([exit, pause(30000)]).catch(() => {});
main?.close();
child.kill();
await exit.catch(() => {});
await log.close();
console.log(JSON.stringify({ status: report.status, records: report.records.length, evidence }, null, 2));

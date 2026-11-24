// 聊天发送失败时，用户看到的必须是「下一步做什么」，而不是内核的笼统结论。
// 这个脚本用本地假服务（模型目录正常、对话请求分别返回 401 和直接断连）在
// Windows 实包上跑真实发送路径，读界面上那一句，再和主进程留下的技术原文配对。
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
const appRoot = path.dirname(exe);
const provenance = JSON.parse(await fs.readFile(path.join(appRoot, 'resources/app/build-provenance.json'), 'utf8'));
const evidence = path.join(root, `.preview/qa-${provenance.version}/chat-send-errors`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { layer: 'windows-packaged-app', version: provenance.version, sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty, exeSha256: hash(await fs.readFile(exe)), status: 'running', cases: [], exits: [] };
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

// 与 src/error-copy.js 平行再写一遍：界面句子一变，这里立刻失败，而不是把
// 新句子当成既有行为接受下来。
const COPY = {
  unauthorized: 'API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。',
  transport: '无法连接到模型服务，请检查网络、代理或服务地址后重试。',
};
const fakeKey = 'sk-qa-chat-send-0000000000000000';

// 模型目录必须成功，否则供应商根本存不下来，也就走不到发送路径。
function mockProvider(mode) {
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    if (request.url.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'deepseek-flash', name: 'QA 假模型', input_modalities: ['text'] }] }));
      return;
    }
    if (request.url.includes('/chat/completions')) {
      if (mode === 'unauthorized') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } }));
        return;
      }
      // 收下请求再断连接：内核把它记成传输失败，而不是 HTTP 失败。
      request.socket.destroy();
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{}');
  });
  return { server, hits };
}

let ui = null, child = null, exit = null, log = null, logPath = '';
const input = 'textarea[aria-label="聊天输入框"]';
const send = 'button.send-button[aria-label="发送消息"]';
const errorLine = '.run-error-detail';

async function launch() {
  const logfile = path.join(evidence, `app-${report.exits.length}.log`); logPath = logfile;
  log = await fs.open(logfile, 'a');
  const portsFile = path.join(profile, 'DevToolsActivePort'); await fs.rm(portsFile, { force: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  child = spawn(exe, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
  exit = once(child, 'close');
  const deadline = Date.now() + 45000;
  while (!ui && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited at launch (${child.exitCode})`);
    const ports = await fs.readFile(portsFile, 'utf8').catch(() => null);
    if (ports) ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
    if (!ui) await pause(120);
  }
  assert.ok(ui, 'Windows renderer test connection started');
  await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})&&!document.querySelector(${JSON.stringify(input)}).disabled`, 45000);
}

async function openProviders() {
  if (await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")')) await ui.click('展开侧栏');
  if (!await ui.evaluate('!!document.querySelector(".settings-page")')) await ui.click('打开设置');
  await ui.click('供应商', '.settings-nav button');
  if (await ui.evaluate('!!document.querySelector(".provider-back")')) await ui.click('所有供应商', '.provider-back');
}

async function clickPredicate(selector, predicate) {
  const point = await ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length);const e=nodes.find(el=>(${predicate}));if(!e)throw Error('no visible match for '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:(Math.max(r.left,0)+Math.min(r.right,innerWidth))/2,y:(Math.max(r.top,0)+Math.min(r.bottom,innerHeight))/2};})()`);
  await ui.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await pause(150);
}

async function configure(baseUrl, { edit = false } = {}) {
  await openProviders();
  if (edit) await clickPredicate('.provider-row', "el.textContent.includes('QA 假服务')");
  else {
    await ui.click('自定义', '.provider-preset');
    await ui.waitFor('!!document.querySelector(".connection-form input[type=url]")');
    await ui.fill('input[placeholder="例如，公司模型网关"]', 'QA 假服务');
    // 自定义供应商默认「使用服务端默认值」，那样只有「关闭」一档；选标准思考
    // 参数才会出现四档，默认的「高」才发得出去。
    await ui.click('高级设置', 'button.provider-back');
    await ui.waitFor('!!document.querySelector("select[aria-label=思考参数]")');
    await ui.fill('select[aria-label=思考参数]', 'standard');
  }
  await ui.waitFor('!!document.querySelector(".connection-form input[type=url]")', 10000);
  await ui.fill('.connection-form input[type=url]', baseUrl);
  await ui.fill('.connection-form input[type=password]', fakeKey);
  await ui.click('拉取模型并保存', '.primary-button');
  // 保存成功后表单收起，已连接列表里出现「QA 假服务」。
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const warning = await ui.evaluate('(()=>{const n=document.querySelector(".setting-notice[role=alert]");return n?n.textContent.trim():""})()');
    if (warning) throw new Error(`供应商保存失败：${warning}`);
    if (!await ui.evaluate('!!document.querySelector(".connection-form")')) return;
    await pause(250);
  }
  throw new Error('供应商没有保存成功');
}

async function sendMessage(text) {
  if (await ui.evaluate('!!document.querySelector(".settings-page")')) await ui.click('返回工作台', 'button[aria-label="返回工作台"]');
  await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})`, 15000);
  // 清掉上一轮的错误气泡，避免读到旧句子。
  await ui.evaluate('(()=>{document.querySelectorAll(".run-error-detail").forEach(node=>node.dataset.stale="1")})()');
  await ui.fill(input, text);
  const sendState = await ui.evaluate('(()=>{const b=document.querySelector("button.send-button");return b?{label:b.getAttribute("aria-label"),disabled:b.disabled}:null})()');
  if (!sendState || sendState.disabled) throw new Error(`发送按钮不可用：${JSON.stringify(sendState)}；界面提示：${await ui.evaluate('(()=>document.body.innerText.match(/所选[^\\n]*|当前模型[^\\n]*/g)||[]).join(" | ")')}`);
  await ui.click('发送消息', send);
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const text = await ui.evaluate('(()=>{const node=[...document.querySelectorAll(".run-error-detail")].find(item=>item.dataset.stale!=="1");return node?node.textContent.trim():""})()');
    if (text) return text;
    await pause(250);
  }
  throw new Error('发送失败后界面没有出现错误句子');
}

let failure;
try {
  const unauthorized = mockProvider('unauthorized');
  const reset = mockProvider('transport');
  unauthorized.server.listen(0, '127.0.0.1'); await once(unauthorized.server, 'listening');
  reset.server.listen(0, '127.0.0.1'); await once(reset.server, 'listening');
  report.mock = { unauthorized: unauthorized.server.address().port, transport: reset.server.address().port };
  await persist();

  await launch();
  const runtimeVersion = await ui.evaluate('(async()=>((await window.zhixing.runtimeStatus()).appVersion))()');
  assert.equal(runtimeVersion, provenance.version);
  await record(`实包运行时报告 ${runtimeVersion}`);

  await configure(`http://127.0.0.1:${unauthorized.server.address().port}/v1`);
  const unauthorizedText = await sendMessage('帮我把这段话改得更正式：明天开会。');
  await ui.screenshot(path.join(evidence, 'unauthorized.png'));
  report.cases.push({ name: '真实 401：界面文案', status: 'observed', shown: unauthorizedText }); await persist();
  assert.equal(unauthorizedText, COPY.unauthorized, `401 后界面显示「${unauthorizedText}」`);

  await configure(`http://127.0.0.1:${reset.server.address().port}/v1`, { edit: true });
  const transportText = await sendMessage('再帮我列三条会议要点。');
  await ui.screenshot(path.join(evidence, 'transport.png'));
  report.cases.push({ name: '连接被断开：界面文案', status: 'observed', shown: transportText }); await persist();
  assert.equal(transportText, COPY.transport, `断连后界面显示「${transportText}」`);

  await pause(400);
  const logText = await fs.readFile(logPath, 'utf8');
  const raw = [...logText.matchAll(/Error occurred in handler for 'agent:run-prepared': Error: (.+)/g)].map(match => match[1].trim());
  assert.ok(raw.length >= 2, `主进程应记录两次发送失败，实际 ${raw.length}`);
  assert.match(raw[0], /（HTTP 401）/, `主进程第一条缺少 HTTP 401：${raw[0]}`);
  assert.match(raw[1], /（TRANSPORT）/, `主进程第二条缺少 TRANSPORT：${raw[1]}`);
  assert.notEqual(unauthorizedText, raw[0], '界面不能原样搬出内核技术句');
  report.mainProcessErrors = raw; await persist();
  await record('主进程保留内核状态码，两条界面文案与技术原文不同', { raw });

  report.status = 'passed'; await persist();
  unauthorized.server.closeAllConnections(); unauthorized.server.close();
  reset.server.closeAllConnections(); reset.server.close();
} catch (error) {
  failure = error; report.status = 'failed'; report.error = String(error?.message || error);
  await persist();
  await ui?.screenshot(path.join(evidence, 'failure.png')).catch(() => {});
} finally {
  try {
    if (ui && child?.exitCode === null) {
      void ui.evaluate('window.zhixing.windowControl("close")').catch(() => {});
      const closed = await Promise.race([exit, pause(40000, null).then(() => null)]);
      if (!closed) { child.kill(); await exit; report.closeError = 'Packaged app did not close'; failure ??= new Error('Packaged app did not close'); }
    }
    if (exit) { const [code, signal] = await exit; report.exits.push({ code, signal }); await persist(); if (code !== 0) failure ??= new Error(`Packaged app exited with ${code}`); }
  } catch (error) { report.closeError = String(error?.message || error); await persist(); failure ??= error; }
  finally { ui?.close(); if (child?.exitCode === null) { child.kill(); await exit; } await log?.close(); }
}
if (failure) throw failure;
console.log(`Evidence: ${evidence}`);

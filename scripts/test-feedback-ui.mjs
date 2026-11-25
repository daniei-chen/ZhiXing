// 消息反馈（对标 dsh-message-feedback）：赞/踩 + 固定分类 + 可选备注，只写本机，不进模型历史。
// 这个脚本在 Windows 实包上点真实按钮，并在刷新后确认反馈还在；同时确认落盘文件是加密的。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/message-feedback`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  layer: 'windows-packaged-app + local fake provider', version: provenance.version, sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty, exeSha256: hash(await fs.readFile(exe)), status: 'running', cases: [], providerRequests: 0,
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const noteText = '摘要压缩后仍然准确，界面也没丢上下文。';
const server = http.createServer(async (request, response) => {
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qa-feedback-model', name: 'QA 反馈模型', input_modalities: ['text'] }] }));
    return;
  }
  if (!request.url.includes('/chat/completions')) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return; }
  for await (const _ of request) { /* 读完请求体 */ }
  report.providerRequests += 1;
  const base = { id: 'chatcmpl-qa-feedback', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-feedback-model' };
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
  write({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
  write({ ...base, choices: [{ index: 0, delta: { content: '收到，这是一条用于反馈验收的回复。' }, finish_reason: null }] });
  write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  response.write('data: [DONE]\n\n');
  response.end();
});

let ui = null, child = null, exit = null, log = null;
const input = 'textarea[aria-label="聊天输入框"]';
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/v1`;
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
  await ui.waitFor(`!!document.querySelector('${input}')`, 45000);

  await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 反馈服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-feedback-000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 反馈服务')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-feedback-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return mine.id;
  })()`);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor(`!!document.querySelector('${input}')&&!document.querySelector('${input}').disabled`, 60000);

  await ui.fill(input, '你好，回一句就好。');
  await ui.click('发送消息', 'button.send-button');
  await ui.waitFor('document.querySelectorAll("article.assistant-message").length>0&&!!document.querySelector(\'button[aria-label="赞这条回复"]\')', 60000);
  await record('助手消息下方有赞与踩两个按钮', { thumbs: await ui.evaluate('document.querySelectorAll(\'button[aria-label="赞这条回复"],button[aria-label="踩这条回复"]\').length') });

  await ui.click('赞这条回复', 'button');
  await ui.waitFor('!!document.querySelector(\'.feedback-panel\')', 15000);
  const panel = await ui.evaluate(`(()=>({
    hint: document.querySelector('.feedback-hint')?.textContent ?? '',
    chips: document.querySelectorAll('.feedback-chip').length,
    chipLabels: [...document.querySelectorAll('.feedback-chip')].map(node=>node.textContent.trim()),
    counter: document.querySelector('.feedback-count')?.textContent ?? '',
  }))()`);
  assert.equal(panel.chips, 7, `分类应为 7 个，实际 ${panel.chips}`);
  assert.deepEqual(panel.chipLabels, ['任务结果', '指令理解与遵循', '产品功能与交互', '稳定性和速度', '资源使用与费用', '安全隐私与权限', '其他']);
  assert.match(panel.hint, /不会发给模型/);
  await record('弹窗给出 7 个固定分类，并说明只记本机', panel);

  await ui.click('任务结果', '.feedback-chip');
  await ui.fill('textarea[aria-label="反馈备注"]', noteText);
  const counter = await ui.evaluate('document.querySelector(\'.feedback-count\')?.textContent ?? ""');
  assert.match(counter, /8192/);
  await ui.click('保存反馈', 'button.primary-button');
  await pause(1500);
  const diag = await ui.evaluate(`(()=>({
    panel: !!document.querySelector('.feedback-panel'),
    recorded: document.querySelector('.feedback-recorded')?.textContent ?? null,
    toast: [...document.querySelectorAll('.toast,[role=status],[role=alert]')].map(n=>n.textContent.trim()).filter(Boolean).slice(0,4),
    count: document.querySelector('.feedback-count')?.textContent ?? '',
    error: document.querySelector('.feedback-panel .feedback-error')?.textContent ?? null,
  }))()`);
  report.afterSave = diag;
  console.log('after save: ' + JSON.stringify(diag));
  await ui.waitFor('!!document.querySelector(\'.feedback-recorded\')', 15000);
  const recorded = await ui.evaluate('document.querySelector(\'.feedback-recorded\').textContent.trim()');
  assert.equal(recorded, '本机反馈：赞 · 任务结果');
  await record('保存后消息下方显示本机反馈', { recorded });

  // 落盘：文件存在、且是加密的（明文备注不应该出现在文件字节里）
  const bytes = await ui.evaluate('window.zhixing.loadFeedback().then(r=>r.entries.length)');
  assert.equal(bytes, 1);
  const feedbackPath = path.join(profile, 'feedback.bin');
  const raw = await fs.readFile(feedbackPath);
  assert.ok(raw.length > 0, 'feedback.bin 已写入');
  assert.equal(raw.includes(Buffer.from(noteText, 'utf8')), false, '备注不应以明文形式落盘');
  assert.equal(raw.includes(Buffer.from('task-result', 'utf8')), false, '分类 id 不应以明文形式落盘');
  await record('反馈写在加密文件里，明文备注与分类都不在字节中', { bytes: raw.length });

  // 刷新后仍在
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'.feedback-recorded\')', 60000);
  const afterReload = await ui.evaluate('document.querySelector(\'.feedback-recorded\').textContent.trim()');
  assert.equal(afterReload, '本机反馈：赞 · 任务结果');
  await record('刷新后反馈仍在', { afterReload });

  // 改成踩并清除
  const before = report.providerRequests;
  await ui.click('踩这条回复', 'button');
  await ui.waitFor('!!document.querySelector(\'.feedback-panel\')', 15000);
  await ui.click('清除', 'button.secondary-button:not(:disabled)');
  await ui.waitFor('!document.querySelector(\'.feedback-recorded\')', 15000);
  const remaining = await ui.evaluate('window.zhixing.loadFeedback().then(r=>r.entries.length)');
  assert.equal(remaining, 0);
  assert.equal(report.providerRequests, before, '反馈操作不应触发任何模型请求');
  await record('清除后本机记录消失，且反馈操作没有发出模型请求', { remaining, providerRequests: report.providerRequests });

  report.status = 'passed';
  await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, providerRequests: report.providerRequests }));
} catch (error) {
  report.status = 'failed';
  report.error = String(error && error.stack || error).split('\n').slice(0, 6).join('\n');
  await persist();
  console.error(report.error);
  process.exitCode = 1;
} finally {
  try { ui?.close?.(); } catch {}
  try { child?.kill(); } catch {}
  try { await exit; } catch {}
  server.close();
  try { await log?.close(); } catch {}
}

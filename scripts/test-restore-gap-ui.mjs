// 无法归属的占位符：本地假服务故意复述一个不属于本次任务的记号。
// 期望：正文保留、记号换成中性命名的标记、气泡里出现处数提示，而不是整段失败。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/restore-gap`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const STRAY = '⟦ZX-qa-unknown⟧';
const report = {
  layer: 'windows-packaged-app + real-kernel + local fake provider', version: provenance.version,
  sourceCommit: provenance.sourceCommit, sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'), status: 'running', cases: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

let replyBody = `这是复述：${STRAY} 结束。`;
const hits = [];
const server = http.createServer((request, response) => {
  hits.push(`${request.method} ${request.url}`);
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qa-gap-model', name: 'QA 占位符模型', input_modalities: ['text'] }] }));
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
    const base = { id: 'chatcmpl-qa-gap', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-gap-model' };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    write({ ...base, choices: [{ index: 0, delta: { content: replyBody }, finish_reason: null }] });
    write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

let ui = null, child = null, exit = null, log = null;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
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
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 45000);

  await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 占位符服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-gap-00000000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 占位符服务')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-gap-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return mine.id;
  })()`);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);

  await ui.fill('textarea[aria-label="聊天输入框"]', '把刚才那串记号原样复述一次。');
  await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');

  const deadline = Date.now() + 90000;
  let snapshot = { body: '', note: '', error: '' };
  while (Date.now() < deadline) {
    snapshot = await ui.evaluate(`(()=>{const node=[...document.querySelectorAll('.assistant-message')].at(-1);return {body:node?.innerText.trim()||'',note:document.querySelector('.restore-note')?.textContent.trim()||'',error:document.querySelector('.run-error-detail')?.textContent.trim()||'',busy:Boolean(document.querySelector('.thinking-label'))};})()`);
    if (snapshot.body && !snapshot.busy) break;
    await pause(300);
  }
  await ui.screenshot(path.join(evidence, 'restore-gap.png'));
  report.body = snapshot.body.slice(0, 300); report.note = snapshot.note; report.error = snapshot.error;
  report.providerCalls = hits.slice(-4); await persist();

  assert.equal(report.error, '', `界面仍然整段报错：${report.error}`);
  assert.ok(report.body.includes('这是复述'), `正文没有保留：${report.body}`);
  assert.ok(report.body.includes('【敏感值待核实】'), `记号没有换成中性标记：${report.body}`);
  assert.equal(report.body.includes(STRAY), false, '界面仍然显示原始记号');
  assert.ok(report.note.includes('1 处'), `没有出现处数提示：${report.note}`);
  await record('无法归属的占位符保留正文并提示处数，不再整段失败', { note: report.note });

  const logText = await fs.readFile(path.join(evidence, 'app.log'), 'utf8');
  report.logged = logText.includes('privacy.restore-unknown');
  await persist();
  assert.equal(report.logged, true, '日志里没有 privacy.restore-unknown');
  await record('诊断日志记下了无法归属的处数', { logged: report.logged });

  // 详情里也要能看见这一轮的状态与还原情况，而不是只有气泡一句灰字。
  const detail = await ui.evaluate(`(async()=>{
    const node=document.querySelector('article.assistant-message .run-summary');
    if(!node)return {missing:true};
    node.open=true;
    await new Promise(r=>setTimeout(r,300));
    const rows={};
    node.querySelectorAll('.run-summary-row').forEach(row=>{rows[row.querySelector('dt').textContent.trim()]=row.querySelector('dd').textContent.trim();});
    return {summary:node.querySelector('summary').textContent.trim(),rows};
  })()`);
  report.detail = detail; await persist();
  assert.ok(!detail.missing, '回答下方没有「详情」');
  assert.equal(detail.summary, '详情');
  assert.equal(detail.rows['状态'], '已完成');
  assert.ok(/\d+ 秒|不到 1 秒/.test(detail.rows['耗时'] || ''), `耗时行不对：${JSON.stringify(detail.rows)}`);
  assert.ok((detail.rows['原文还原'] || '').includes('1 处'), `详情里没有还原处数：${JSON.stringify(detail.rows)}`);
  await record('详情里写明状态、耗时与无法归属的占位符处数', detail);

  // 导出与分享的正文是纯文本，气泡里的灰字带不过去——两边都要带同一句说明。
  const openReview = async (open) => {
    await open();
    await ui.waitFor('!!document.querySelector(".privacy-text pre")', 30000);
    let value = '';
    for (let i = 0; i < 80; i += 1) {
      value = (await ui.evaluate('document.querySelector(".privacy-text pre")?.textContent?.trim()||""')).trim();
      if (value && !value.startsWith('正在准备主机审阅') && value !== '审阅未完成。') break;
      await pause(300);
    }
    return value;
  };
  const exported = await openReview(() => ui.click('导出成果', 'button[aria-label="导出成果"]'));
  report.exported = exported.slice(-160); await persist();
  assert.ok(exported.includes('本段有 1 处占位符无法归属对应任务'), `导出正文没有「待核实」说明：${exported.slice(-200)}`);
  assert.ok(exported.includes('【敏感值待核实】'), '导出正文里没有中性标记');
  await record('导出这条回答时正文带上「待核实」说明', { tail: exported.slice(-80) });
  await ui.evaluate(`(()=>{const target=document.activeElement||document.body;target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()`).catch(() => {});
  for (let i = 0; i < 40; i += 1) {
    if (!(await ui.evaluate('Boolean(document.querySelector(".privacy-modal"))'))) break;
    await pause(200);
  }

  const shared = await openReview(async () => {
    await ui.click('会话操作', 'button[aria-label="会话操作"]');
    await pause(300);
    await ui.evaluate(`(()=>{const item=[...document.querySelectorAll('.menu-item,button')].find(node=>node.textContent.trim().startsWith('分享或转发'));if(item)item.click();return Boolean(item);})()`);
  });
  report.shared = shared.slice(-160); await persist();
  assert.ok(shared.includes('本会话有 1 处占位符无法归属对应任务'), `分享正文没有「待核实」说明：${shared.slice(-200)}`);
  await record('分享整个会话时正文带上「待核实」说明', { tail: shared.slice(-80) });

  report.status = 'passed'; await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, note: report.note, evidence }, null, 2));
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

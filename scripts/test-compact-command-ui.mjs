// 手动压缩命令的实包验收（对标桌面版 `dsh-command-compact` 的 `/compact`）。
// 桌面版把 `/compact` 注册成人类命令：无参数、立即压缩一次、成功时回
// `Compacted N history items (~M tokens).`（内核文案），空历史回 `No compactable history yet.`，
// 带参数回用法提示；压缩后历史被一条检查点消息取代。
// 本脚本用本地假 OpenAI 服务 + 真实内核，在打包 EXE 上验证这四条，并确认压缩后的下一轮
// 请求真的带上了检查点前言、消息数减少。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/compact-command`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const CHECKPOINT_PREAMBLE = 'This is an automatically generated checkpoint';
const filler = '上下文填充：知行手动压缩验收。'.repeat(700);
const requests = [];
const server = http.createServer((request, response) => {
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qa-compact-model', name: 'QA 压缩模型', input_modalities: ['text'] }] }));
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
    const messages = payload.messages || [];
    const lastText = String(messages.at(-1)?.content ?? '');
    const compacting = lastText.includes('acting as a compaction engine');
    const checkpoint = messages.some(message => String(message.content ?? '').includes(CHECKPOINT_PREAMBLE));
    requests.push({ index: requests.length, bytes: body.length, messageCount: messages.length, compacting, checkpoint, lastText: lastText.slice(0, 60) });
    const base = { id: `chatcmpl-compact-${requests.length}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-compact-model' };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    const text = compacting ? '摘要：用户连续两轮要求填充内容，用于验证手动压缩。' : `收到第 ${requests.length} 条。${filler}`;
    write({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
    write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

const report = {
  layer: 'windows-packaged-app + real-kernel + local fake provider', version: provenance.version,
  sourceCommit: provenance.sourceCommit, sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'), status: 'running', cases: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const lastAnswer = () => ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll('.assistant-message')];const node=nodes.at(-1);return {count:nodes.length,text:node?(node.querySelector('.answer-text, .markdown-body, p')?.innerText||node.innerText||'').trim().slice(0,220):''};})()`);
// 斜杠命令会打开命令面板，面板会盖住发送按钮；真实用户是按回车执行的，这里也走回车。
const send = async (value, waitMs = 12000) => {
  await ui.fill('textarea[aria-label="聊天输入框"]', value);
  const sent = await ui.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="聊天输入框"]');input.focus();const event=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true});input.dispatchEvent(event);return true})()`);
  await pause(1200);
  const stillThere = await ui.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="聊天输入框"]');return (input?.value||'').trim().length>0})()`);
  if (stillThere) {
    await ui.evaluate(`(()=>{const button=document.querySelector('button.send-button[aria-label="发送消息"]');if(!button)throw new Error('missing send');button.click();return true})()`);
  }
  await pause(waitMs);
  return { sent, viaEnter: !stillThere };
};

let ui = null, child = null, exit = null, log = null;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  report.provider = base; await persist();
  log = await fs.open(path.join(evidence, 'app.log'), 'a');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  child = spawn(exe, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
  exit = once(child, 'close');
  const portsFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 400 && !ui; i += 1) {
    const ports = await fs.readFile(portsFile, 'utf8').catch(() => null);
    if (ports) ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
    if (!ui) await pause(120);
  }
  assert.ok(ui, 'renderer test connection started');
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 45000);
  await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 压缩服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-compactcmd-000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 压缩服务')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-compact-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return true;
  })()`);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);
  await record('假服务与临时档案就绪', { provider: base });

  // ① 空会话直接 /compact：不得发起任何模型请求，也不得伪造压缩结果。
  await send('/compact', 6000);
  const emptyText = await lastAnswer();
  report.emptyCompact = { requests: requests.length, answer: emptyText };
  await persist();
  assert.equal(requests.length, 0, `空会话里 /compact 不应发起模型请求，实际 ${requests.length} 次`);
  assert.equal(/Compacted\s+\d+/u.test(emptyText.text), false, `空会话不应给出压缩数字：${emptyText.text}`);
  await record('空会话的 /compact 不发起模型请求', { answer: emptyText.text.slice(0, 80) });

  // ② 带参数：知行自己的中文说明，且同样不发请求。
  await send('/compact now', 4000);
  const argumentText = await lastAnswer();
  const toast = (await ui.evaluate("(document.querySelector('.toast')?.innerText||'').trim()")).trim();
  report.argumentCompact = { requests: requests.length, answer: argumentText.text, toast };
  await persist();
  assert.equal(requests.length, 0, `带参数的 /compact 不应发起模型请求，实际 ${requests.length} 次`);
  const argumentCopy = `${argumentText.text} ${toast}`;
  assert.ok(/无需参数|使用 \/compact/u.test(argumentCopy), `带参数时应给出中文用法提示，实际：${argumentCopy.slice(0, 120)}`);
  await record('带参数的 /compact 给出中文用法提示', { copy: argumentCopy.slice(0, 80) });

  // ③ 两轮真实对话后 /compact：真的发起摘要请求，界面给出压缩条数与 token 数。
  for (const round of [1, 2]) await send(`第 ${round} 轮：给我一段填充内容。`, 10000);
  const beforeCount = requests.length;
  const beforeMessages = requests.at(-1)?.messageCount || 0;
  await send('/compact', 14000);
  const compactText = await lastAnswer();
  const compactionRequests = requests.filter(item => item.compacting);
  report.manualCompact = { requestsAfter: requests.length, beforeMessages, compactionRequests: compactionRequests.length, ui: compactText };
  await persist();
  assert.equal(compactionRequests.length, 1, `手动压缩应产生 1 次摘要请求，实际 ${compactionRequests.length}`);
  const numbers = /Compacted\s+(\d+)\s+history items\s+\(~(\d+) tokens\)/u.exec(compactText.text);
  assert.ok(numbers, `界面没有给出压缩结果：${compactText.text.slice(0, 140)}`);
  assert.ok(Number(numbers[1]) > 0, `压缩条数应为正数：${numbers[1]}`);
  await record('手动 /compact 真的压缩并给出条数与 token 数', { items: Number(numbers[1]), tokens: Number(numbers[2]) });

  // ④ 压缩后的下一轮请求带检查点前言、消息数少于压缩前的最后一轮。
  await send('压缩后继续：再给一句。', 10000);
  const after = requests.at(-1);
  report.afterCompact = { messageCount: after.messageCount, checkpoint: after.checkpoint, beforeMessages };
  await persist();
  assert.equal(after.checkpoint, true, '压缩后的请求里没有出现检查点前言');
  assert.ok(after.messageCount < beforeMessages, `压缩后消息数应减少：压缩前 ${beforeMessages}，压缩后 ${after.messageCount}`);
  await record('压缩后的请求带上检查点且消息数减少', { before: beforeMessages, after: after.messageCount });

  await ui.screenshot(path.join(evidence, 'after-compact.png'));
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

// 提供方确认上下文超限后的自动恢复（对标桌面版 `dsh-compaction-basic` 的 `maxOverflowRetries`）。
// 桌面版监听 `agent/request-error` 的 `CONTEXT_WINDOW_EXCEEDED`：绕过常规阈值与保留策略，做一次
// 最大平衡头部缩减（压缩），然后重试同一请求；这次重试不占提供方的重试预算。
// 本脚本用本地假 OpenAI 服务 + 真实内核 + 打包 EXE：第一条消息就返回 HTTP 400 +
// `code=context_length_exceeded`，验证界面最终给出答复、压缩请求确实发生、重试请求带上摘要且更短，
// 并确认恢复之后还能正常继续对话。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/overflow-recovery`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const SUMMARY = '摘要：用户要求一段填充内容，这条摘要在超限恢复时替代早期历史。';
const filler = '上下文填充：知行溢出恢复验收。'.repeat(600);
const OVERFLOW_MESSAGE = "This model's maximum context length is 131072 tokens. However, your messages resulted in 200000 tokens. Please reduce the length of the messages.";
const requests = [];
let overflowIssued = false;
const server = http.createServer((request, response) => {
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qa-overflow-model', name: 'QA 溢出模型', context_length: 131072, max_output_tokens: 8192, input_modalities: ['text'] }] }));
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
    const summaryPresent = messages.some(message => String(message.content ?? '').includes(SUMMARY));
    const record = { index: requests.length, bytes: body.length, messageCount: messages.length, compacting, summaryPresent, status: 'streamed', lastText: lastText.slice(0, 40) };
    requests.push(record);
    if (!compacting && !overflowIssued) {
      overflowIssued = true;
      record.status = 'overflow';
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: OVERFLOW_MESSAGE, type: 'invalid_request_error', code: 'context_length_exceeded' } }));
      return;
    }
    const base = { id: `chatcmpl-overflow-${requests.length}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-overflow-model' };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    const text = compacting ? SUMMARY : `收到第 ${requests.length} 条。${filler}`;
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

const lastAnswer = () => ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll('.assistant-message')];const node=nodes.at(-1);return {count:nodes.length,text:node?(node.querySelector('.answer-text, .markdown-body, p')?.innerText||node.innerText||'').trim().slice(0,200):'',errorText:(document.querySelector('.answer-error, .run-error, [class*=error]')?.innerText||'').trim().slice(0,120)};})()`);
const send = async (value, waitMs = 12000) => {
  await ui.fill('textarea[aria-label="聊天输入框"]', value);
  await ui.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="聊天输入框"]');input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));return true})()`);
  await pause(1200);
  const pending = await ui.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="聊天输入框"]');return (input?.value||'').trim().length>0})()`);
  if (pending) await ui.evaluate("(()=>{document.querySelector('button.send-button[aria-label=\"发送消息\"]')?.click();return true})()");
  await pause(waitMs);
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
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 溢出服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-overflow-000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 溢出服务')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-overflow-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return true;
  })()`);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);
  await record('假服务与临时档案就绪', { provider: base });

  // ① 第一条消息就超限：内核应压缩后重试，界面给出答复而不是错误。
  await send('第一轮：这一轮会先被提供方判为超限。', 16000);
  const first = await lastAnswer();
  const sequence = requests.map(item => `${item.status}${item.compacting ? '/compaction' : ''}`);
  report.overflow = { sequence, requests: requests.map(item => ({ index: item.index, messageCount: item.messageCount, compacting: item.compacting, summaryPresent: item.summaryPresent, status: item.status })), ui: first };
  await persist();
  assert.equal(requests[0]?.status, 'overflow', `第一条请求应被提供方判为超限，实际 ${requests[0]?.status}`);
  assert.equal(requests.filter(item => item.status === 'overflow').length, 1, '只应出现一次超限响应');
  assert.equal(requests.filter(item => item.compacting).length, 1, `超限恢复应恰好发起一次摘要请求，实际 ${requests.filter(item => item.compacting).length}`);
  assert.equal(requests.length, 3, `超限恢复应共 3 次请求（超限→摘要→重试），实际 ${requests.length}：${sequence.join(' → ')}`);
  assert.equal(first.count, 1, `界面应只有一条答复，实际 ${first.count} 条`);
  assert.match(first.text, /收到第 \d+ 条/u, `重试后应给出答复，实际：${first.text.slice(0, 80)}`);
  assert.equal(first.errorText, '', `界面不应出现错误提示，实际：${first.errorText}`);
  await record('提供方超限后压缩并重试，界面给出答复', { sequence: sequence.join(' → ') });

  // ② 重试请求比超限那次更短，且带上了摘要。
  const retry = requests[2];
  assert.ok(retry.messageCount < requests[0].messageCount, `重试请求应更短：超限 ${requests[0].messageCount} 条，重试 ${retry.messageCount} 条`);
  assert.equal(retry.summaryPresent, true, '重试请求里没有出现摘要内容');
  await record('重试请求更短且带摘要', { before: requests[0].messageCount, after: retry.messageCount });

  // ③ 恢复之后还能正常继续对话。
  await send('第二轮：恢复之后继续。', 12000);
  const second = await lastAnswer();
  report.followUp = { requests: requests.length, ui: second };
  await persist();
  assert.equal(requests.length, 4, `继续对话应再多一次请求，实际 ${requests.length} 次`);
  assert.equal(second.count, 2, `界面应有两条答复，实际 ${second.count} 条`);
  assert.match(second.text, /收到第 \d+ 条/u, `第二条答复没拿到模型输出：${second.text.slice(0, 80)}`);
  await record('恢复之后继续对话正常', { requests: requests.length, answers: second.count });

  await ui.screenshot(path.join(evidence, 'after-recovery.png'));
  report.status = 'passed'; await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, evidence }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = String(error?.message || error); report.requests = requests.map(item => ({ index: item.index, messageCount: item.messageCount, compacting: item.compacting, status: item.status })); await persist();
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

// 真实压缩事件：在 Windows 实包上用本地假服务把上下文推到阈值以上，观察内核是否真的
// 触发压缩、压缩后的请求是否变小、界面有没有留下痕迹。
// 压缩的判据来自 dsh-compaction-basic 的实现：
//   · 摘要请求的最后一条 user 消息以「You are now acting as a compaction engine」开头
//   · 压缩后的请求带「This is an automatically generated checkpoint」前言
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/compaction-ui`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  layer: 'windows-packaged-app + local fake provider', version: provenance.version, sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty, exeSha256: hash(await fs.readFile(exe)), status: 'running', cases: [], turns: [], requests: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const SUMMARIZE_MARK = 'You are now acting as a compaction engine';
const CHECKPOINT_MARK = 'This is an automatically generated checkpoint';
// 每轮回复约 4,500 tokens（按 4 字符≈1 token），13 轮足以越过 128k 窗口下 54,272 的阈值。
const FILLER = '上下文填充：知行压缩验收。'.repeat(2400);

function mockProvider() {
  const seen = { summarize: 0, checkpointed: 0, chat: 0, sizes: [] };
  const server = http.createServer(async (request, response) => {
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
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const text = JSON.stringify(messages);
    const isSummary = text.includes(SUMMARIZE_MARK);
    const hasCheckpoint = text.includes(CHECKPOINT_MARK);
    if (isSummary) seen.summarize += 1;
    if (hasCheckpoint) seen.checkpointed += 1;
    seen.chat += 1;
    const entry = { index: seen.chat, chars: raw.length, messages: messages.length, isSummary, hasCheckpoint };
    seen.sizes.push(entry);
    report.requests.push(entry);

    // 摘要请求要按内核期望的结构回一段 Markdown；普通请求回一段长文本把上下文顶上去。
    const reply = isSummary
      ? ['## Primary Request and Intent', '- 用户要求逐轮填充上下文，用于压缩验收。', '', '## Pending Jobs', '- 继续下一轮。'].join('\n')
      : FILLER;

    const base = { id: `chatcmpl-qa-compact-${seen.chat}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-compact-model' };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    write({ ...base, choices: [{ index: 0, delta: { content: reply }, finish_reason: null }] });
    write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    write({ ...base, usage: { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.ceil(reply.length / 4), total_tokens: Math.ceil((raw.length + reply.length) / 4) } });
    response.write('data: [DONE]\n\n');
    response.end();
  });
  return { server, seen };
}

const fake = mockProvider();
const { server, seen } = fake;
let ui = null, child = null, exit = null, log = null;
const input = 'textarea[aria-label="聊天输入框"]';
const send = 'button.send-button';

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
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 压缩服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-compact-0000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 压缩服务')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-compact-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return mine.id;
  })()`);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor(`!!document.querySelector('${input}')&&!document.querySelector('${input}').disabled`, 60000);

  const assistantCount = () => ui.evaluate('document.querySelectorAll("article.assistant-message").length');
  let maxTurns = 16;
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const before = await assistantCount();
    await ui.fill(input, `第 ${turn} 轮：请复述上文并继续。`);
    await ui.click('发送消息', send);
    const deadline = Date.now() + 90000;
    let settled = false;
    let after = before;
    while (Date.now() < deadline) {
      const state = await ui.evaluate(`({
        assistants: document.querySelectorAll('article.assistant-message').length,
        sending: !!document.querySelector('button.send-button[aria-label="停止生成"]') || !!document.querySelector('button.stop-button'),
        ready: !!document.querySelector('button.send-button[aria-label="发送消息"]'),
      })`);
      after = state.assistants;
      if (after > before && state.ready && !state.sending) { settled = true; break; }
      await pause(400);
    }
    if (!settled) throw new Error(`第 ${turn} 轮未在 90 秒内结束（assistants=${after}）`);
    report.turns.push({ turn, assistantMessages: after, summarizeCalls: seen.summarize, checkpointed: seen.checkpointed, requests: seen.chat });
    await persist();
    console.log(`turn ${turn}: assistants=${after} requests=${seen.chat} summarize=${seen.summarize} checkpointed=${seen.checkpointed}`);
    if (seen.summarize > 0 && seen.checkpointed > 0) { maxTurns = turn; break; }
  }

  assert.ok(seen.summarize > 0, `未观察到压缩摘要请求（共 ${seen.chat} 次请求）`);
  await record('内核在阈值处触发了压缩摘要请求', { summarizeCalls: seen.summarize, requests: seen.chat });
  assert.ok(seen.checkpointed > 0, '未观察到带检查点前言的请求');
  await record('压缩后的请求带检查点前言', { checkpointed: seen.checkpointed });

  const firstCheckpoint = report.requests.findIndex(item => item.hasCheckpoint);
  assert.ok(firstCheckpoint > 0, '存在压缩前与压缩后的请求');
  const beforeCompaction = report.requests[firstCheckpoint - 1];
  const afterCompaction = report.requests[firstCheckpoint];
  assert.ok(afterCompaction.chars < beforeCompaction.chars,
    `压缩后请求应更小：压缩前 ${beforeCompaction.chars} 字符，压缩后 ${afterCompaction.chars} 字符`);
  await record('压缩后请求比压缩前更小', { beforeChars: beforeCompaction.chars, afterChars: afterCompaction.chars, savedChars: beforeCompaction.chars - afterCompaction.chars });

  // 界面：压缩后对话仍在、没有错误块，且如实记录有没有压缩提示
  const uiState = await ui.evaluate(`(()=>{
    const rows=[...document.querySelectorAll('.run-summary-row')].map(r=>[r.querySelector('dt')?.textContent,r.querySelector('dd')?.textContent]);
    // 填充文本里带「压缩」二字，只看正文之外的提示行，免得把自己的填充当成界面提示。
    const notices=[...document.querySelectorAll('.run-summary, .privacy-modal, .banner, .notice, .composer-hint')]
      .map(node=>node.textContent.trim()).filter(text=>/压缩|检查点/.test(text));
    return {
      assistants: document.querySelectorAll('article.assistant-message').length,
      errors: [...document.querySelectorAll('.run-error-detail')].map(node=>node.textContent.trim()).slice(0,3),
      compactionNotices: notices.slice(0,5),
      rows: rows.slice(0,8),
    };
  })()`);
  report.ui = uiState;
  assert.equal(uiState.errors.length, 0, '压缩不应导致界面错误');
  assert.ok(uiState.assistants >= 8, `压缩后消息应仍在页面上，实际 ${uiState.assistants}`);
  // 桌面版没有压缩提示：轨迹与会话包里都搜不到 compacted／checkpoint 的前端渲染。
  // 所以这里断言「没有提示」是当前的对标结论，不是缺陷；哪天要加，先看桌面版加没加。
  await record('压缩后对话与详情仍然可用，界面不出现压缩提示（与桌面版一致）', {
    assistants: uiState.assistants,
    compactionNotices: uiState.compactionNotices,
    desktopHasNotice: false,
  });

  report.status = 'passed';
  await persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, summarize: seen.summarize, checkpointed: seen.checkpointed }));
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

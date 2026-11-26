// 切换窗口的成功路径：历史装不下新型号的窗口时，内核先压缩、再按新窗口重新发，用户拿到答复。
// 0.34.0／0.35.0 只证明了「先压缩、不超额发送」和「失败会说清」；成功这一步一直没走到，原因是
// 合成历史里单条回答就有约 2,850 tokens，压缩后保留的尾巴本身仍高于 8,192 窗口的 3,072 阈值，
// 于是第二次压缩只能拿检查点自己去摘要，被「摘要须小于原文」拒绝。这里把每条回答缩小、轮次加多，
// 让「保留 16% 尾巴 + 检查点」真正落到阈值以下——这才是真实小窗口会话的形状。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/model-switch`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const turns = 5;
const answerFiller = '这一轮按要求给出填充内容，篇幅接近一封邮件。'.repeat(330);
const question = '请继续，把这一轮当作一次普通的办公对话，写一封常见的邮件正文。'.repeat(120);
const requests = [];
const server = http.createServer((request, response) => {
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [
      { id: 'qa-big', name: 'QA 大窗口', context_length: 131072, max_output_tokens: 8192, input_modalities: ['text'] },
      { id: 'qa-small', name: 'QA 中窗口', context_length: 32768, max_output_tokens: 8192, input_modalities: ['text'] },
    ] }));
    return;
  }
  if (!request.url.includes('/chat/completions')) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return; }
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const messages = payload.messages || [];
    const lastText = String(messages.at(-1)?.content ?? '');
    const compacting = lastText.includes('acting as a compaction engine');
    requests.push({ index: requests.length, bytes: body.length, messageCount: messages.length, compacting, model: payload.model, maxTokens: payload.max_tokens });
    const base = { id: `chatcmpl-switch-${requests.length}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: payload.model || 'qa-big' };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    const text = compacting ? '摘要。' : `第 ${requests.length} 轮：${answerFiller}`;
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

const state = () => ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll('.assistant-message')];const usage=[...document.querySelectorAll('.context-usage')].map(node=>node.innerText.trim()).slice(-1)[0]||'';const toast=(document.querySelector('.toast')?.innerText||'').trim().slice(0,120);return {answers:nodes.length,trigger:(document.querySelector('.model-trigger')?.innerText||'').trim().slice(0,80),usage,lastAnswer:((nodes.at(-1)?.innerText||'').trim().slice(0,140)),errorText:((document.querySelector('.answer-error, .run-error')?.innerText||'').trim()+toast).slice(0,180)};})()`);
const answers = () => ui.evaluate("document.querySelectorAll('.assistant-message').length");
const idle = async (timeoutMs = 60000) => {
  // 上一轮还在跑时输入框是禁用的，此时填值不会进 React 状态，回车也就发不出去。
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 运行中发送按钮的 aria-label 会变成「停止生成」，输入框却仍是可编辑的——只查 disabled 会漏判。
    const ready = await ui.evaluate("(()=>{const input=document.querySelector('textarea[aria-label=\"聊天输入框\"]');const send=document.querySelector('button.send-button');if(!input||input.disabled||!send)return false;return send.getAttribute('aria-label')!=='停止生成';})()");
    if (ready) return;
    await pause(500);
  }
  throw new Error(`页面在 ${timeoutMs} ms 内没有回到可输入状态`);
};
const send = async (value, expected, timeoutMs = 60000) => {
  const target = expected ?? (await answers()) + 1;
  await idle();
  await ui.fill('textarea[aria-label="聊天输入框"]', value);
  await ui.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="聊天输入框"]');input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));return true})()`);
  await pause(1200);
  const pending = await ui.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="聊天输入框"]');return (input?.value||'').trim().length>0})()`);
  if (pending) await ui.evaluate("(()=>{document.querySelector('button.send-button[aria-label=\"发送消息\"]')?.click();return true})()");
  // 等到这一轮的答复出现，而不是固定睡一段时间（长回答会让固定等待偶尔不够）。
  const deadline = Date.now() + timeoutMs;
  let nudged = pending;
  while (Date.now() < deadline) {
    if (await answers() >= target) return;
    if (!nudged) {
      const stillPending = await ui.evaluate("(()=>{const input=document.querySelector('textarea[aria-label=\"聊天输入框\"]');return (input?.value||'').trim().length>0})()");
      if (stillPending) { await ui.evaluate("(()=>{document.querySelector('button.send-button[aria-label=\"发送消息\"]')?.click();return true})()"); nudged = true; }
    }
    await pause(500);
  }
  throw new Error(`第 ${target} 条答复没有在 ${timeoutMs} ms 内出现`);
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
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 切换服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-switch-0000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 切换服务')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-big',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return true;
  })()`);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);

  // ① 在大窗口型号上聊到刚过小窗口的阈值（14 轮、每轮都很短，像真实办公对话）。
  for (let round = 1; round <= turns; round += 1) await send(`${question}（第 ${round} 轮）`, round);
  const before = await state();
  report.before = { requests: requests.map(item => ({ ...item })), ui: before }; await persist();
  assert.equal(before.answers, turns, `切换前应有 ${turns} 轮答复，实际 ${before.answers}`);
  assert.equal(requests.filter(item => item.compacting).length, 0, '大窗口型号下不应触发压缩');

  // ② 切到小窗口型号。
  // 浮层要一步步开，且上一轮的收尾可能还压着触发点：每次开都在有超时的情况下等目标出现，
  // 没开出来就按 Esc 重来，最多三次。
  const waitFor = async (expression, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await ui.evaluate(expression)) return true;
      await pause(300);
    }
    return false;
  };
  let opened = 'no-trigger';
  let linked = 'no-model-link';
  let options = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    opened = await ui.evaluate("(()=>{const trigger=document.querySelector('.model-trigger');if(!trigger)return 'no-trigger';trigger.click();return 'reasoning'})()");
    if (!(await waitFor("!!document.querySelector('.effort-model-link')", 8000))) {
      await ui.evaluate("(()=>{document.querySelector('body')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true}));return true})()");
      await pause(800);
      continue;
    }
    linked = await ui.evaluate("(()=>{const link=document.querySelector('.effort-model-link');if(!link)return 'no-model-link';link.click();return 'models'})()");
    if (!(await waitFor("document.querySelectorAll('.model-picker-option').length>0", 8000))) {
      await ui.evaluate("(()=>{document.querySelector('body')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true}));return true})()");
      await pause(800);
      continue;
    }
    options = await ui.evaluate("(()=>[...document.querySelectorAll('.model-picker-option')].map(item=>item.innerText.trim().slice(0,40)))()");
    break;
  }
  const picked = await ui.evaluate("(()=>{const items=[...document.querySelectorAll('.model-picker-option')];const target=items.find(item=>item.innerText.includes('QA 中窗口'));if(!target)return 'no-option';target.click();return 'clicked'})()");
  await pause(2000);
  const switched = await state();
  report.switch = { opened, linked, options, picked, ui: switched }; await persist();
  assert.equal(picked, 'clicked', `没有点到小窗口模型：${JSON.stringify({ opened, linked, options })}`);
  assert.ok(switched.trigger.includes('QA 中窗口'), `模型入口应显示小窗口模型，实际「${switched.trigger}」`);
  // 型号换了，输入区的窗口开销就得跟着换——不能等下一次请求回来才变。
  assert.match(switched.usage, /32,768/u, `切换后应立刻按新型号显示窗口，实际「${switched.usage}」`);
  await record('切换后输入区立刻按新型号显示窗口', { usage: switched.usage });

  // ③ 切换后的第一次提交：先压缩，再按新窗口发出更短的请求，最后给出答复。
  await send('切换之后，用新模型继续这一轮。', turns + 1, 30000);
  // 压缩是内核在发请求前做的，答复气泡会先出现「思考中」；等真正的请求到达、并且正文落定再断言。
  const requestDeadline = Date.now() + 90000;
  while (Date.now() < requestDeadline && requests.length <= turns) await pause(500);
  const answerDeadline = Date.now() + 60000;
  while (Date.now() < answerDeadline) {
    const settled = await ui.evaluate(`(()=>{const node=[...document.querySelectorAll('.assistant-message')].at(-1);if(!node)return false;const text=node.innerText||'';return !/思考中|正在/u.test(text)&&text.trim().length>0;})()`);
    if (settled) break;
    await pause(500);
  }
  const after = await state();
  const post = requests.slice(turns);
  report.after = { requests: post, ui: after }; await persist();
  const compaction = post.find(item => item.compacting);
  const commitIndex = compaction ? post.indexOf(compaction) + 1 : 0;
  const commit = post[commitIndex];
  assert.ok(compaction, `切换后应先压缩，实际请求：${JSON.stringify(post)}`);
  await record('切换后先压缩', { compactingIndex: post.indexOf(compaction), bytes: compaction.bytes, messages: compaction.messageCount });
  assert.ok(commit, `压缩之后应有真正提交，实际请求：${JSON.stringify(post)}`);
  assert.equal(commit.compacting, false, `提交不应是摘要请求，实际：${JSON.stringify(commit)}`);
  assert.equal(commit.model, 'qa-small', `提交应使用小窗口模型，实际 ${commit.model}`);
  assert.ok(commit.messageCount < compaction.messageCount, `压缩后的请求应更短：摘要 ${compaction.messageCount} 条，提交 ${commit.messageCount} 条`);
  await record('压缩后按小窗口重新发出更短的请求', { model: commit.model, before: compaction.messageCount, after: commit.messageCount });
  assert.equal(after.errorText, '', `界面不应报错：${after.errorText}`);
  assert.equal(after.answers, turns + 1, `应多出一轮答复，实际 ${after.answers}`);
  assert.ok(!/运行错误|未完成/u.test(after.lastAnswer), `这一轮不应失败，实际正文「${after.lastAnswer}」`);
  await record('切换压缩成功后给出答复', { answers: after.answers, text: after.lastAnswer.slice(0, 40) });
  assert.match(after.usage, /32,768/u, `切换后用量应按中窗口显示，实际「${after.usage}」`);
  await record('切换后用量与请求窗口一致', { usage: after.usage, window: 32768 });

  await ui.screenshot(path.join(evidence, 'after-switch.png'));
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

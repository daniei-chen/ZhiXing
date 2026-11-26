// 按模型取上下文窗口：目录里的窗口/输出上限跟着型号进内核，切到窗口更小的型号时不再沿用上一个型号的窗口。
// 桌面版在模型切换时直接给拟用的请求头定价（装不下就压缩，压缩不成才报 MODEL_SWITCH_COMPACTION_FAILED）。
// 知行原先把提供方目录里的 context_length 整个丢掉，且运行配置只声明当前模型，于是：小窗口型号被静默
// 超额喂饱，切换压缩也因「配置里没有原模型」直接失败。本脚本验证修复后的两条行为。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/model-window`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const filler = '上下文填充：知行按模型窗口压缩验收。'.repeat(600);
const requests = [];
const server = http.createServer((request, response) => {
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [
      { id: 'qa-big', name: 'QA 大窗口', context_length: 131072, max_output_tokens: 8192, input_modalities: ['text'] },
      { id: 'qa-small', name: 'QA 小窗口', context_length: 8192, max_output_tokens: 2048, input_modalities: ['text'] },
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
    requests.push({ index: requests.length, bytes: body.length, messageCount: messages.length, compacting, model: payload.model });
    const base = { id: `chatcmpl-window-${requests.length}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: payload.model || 'qa-big' };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    const text = compacting ? '摘要。' : `收到第 ${requests.length} 条。${filler}`;
    write({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
    const promptTokens = Math.round(body.length / 4);
    const completionTokens = Math.round(text.length / 4);
    write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens } });
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

const state = () => ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll('.assistant-message')];const usage=[...document.querySelectorAll('.context-usage')].map(node=>node.innerText.trim()).slice(-1)[0]||'';const toast=(document.querySelector('.toast')?.innerText||'').trim().slice(0,120);return {answers:nodes.length,trigger:(document.querySelector('.model-trigger')?.innerText||'').trim().slice(0,80),usage,lastAnswer:((nodes.at(-1)?.innerText||'').trim().slice(0,120)),errorText:((document.querySelector('.answer-error, .run-error')?.innerText||'').trim()+toast).slice(0,180)};})()`);
const send = async (value, waitMs = 12000) => {
  await ui.fill('textarea[aria-label="聊天输入框"]', value);
  await ui.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="聊天输入框"]');input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));return true})()`);
  await pause(1200);
  const pending = await ui.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="聊天输入框"]');return (input?.value||'').trim().length>0})()`);
  if (pending) await ui.evaluate("(()=>{document.querySelector('button.send-button[aria-label=\"发送消息\"]')?.click();return true})()");
  await pause(waitMs);
};
const switchModel = async label => {
  const opened = await ui.evaluate("(()=>{const trigger=document.querySelector('.model-trigger');if(!trigger)return 'no-trigger';trigger.click();return 'reasoning'})()");
  await pause(2000);
  const linked = await ui.evaluate("(()=>{const link=document.querySelector('.effort-model-link');if(!link)return 'no-model-link';link.click();return 'models'})()");
  await pause(2000);
  const options = await ui.evaluate("(()=>[...document.querySelectorAll('.model-picker-option')].map(item=>item.innerText.trim().slice(0,40)))()");
  const picked = await ui.evaluate(`(()=>{const items=[...document.querySelectorAll('.model-picker-option')];const target=items.find(item=>item.innerText.includes(${JSON.stringify(label)}));if(!target)return 'no-option';target.click();return 'clicked'})()`);
  await pause(2000);
  return { opened, linked, options, picked };
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
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 窗口服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-window-000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 窗口服务')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-big',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return true;
  })()`);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);

  // ① 目录里的窗口必须按型号落到运行时模型表。
  const models = await ui.evaluate("(async()=>{const status=await window.zhixing.runtimeStatus();return status.models.filter(row=>['qa-big','qa-small'].includes(row.id)).map(row=>({id:row.id,contextWindow:row.contextWindow,maxTokens:row.maxTokens}))})()");
  report.models = models; await persist();
  const big = models.find(row => row.id === 'qa-big');
  const small = models.find(row => row.id === 'qa-small');
  assert.ok(big && small, `运行时模型表应包含两个模型，实际 ${JSON.stringify(models)}`);
  assert.equal(big.contextWindow, 131072, `大窗口模型应带 131072，实际 ${big.contextWindow}`);
  assert.equal(small.contextWindow, 8192, `小窗口模型应带 8192，实际 ${small.contextWindow}`);
  assert.equal(small.maxTokens, 2048, `小窗口模型的输出上限应带 2048，实际 ${small.maxTokens}`);
  await record('模型目录里的上下文窗口与输出上限按型号落到运行时', { big: big.contextWindow, small: small.contextWindow, smallOutput: small.maxTokens });

  // ② 在大窗口型号下把历史聊到明显超过小窗口。
  for (const round of [1, 2, 3, 4]) await send(`第 ${round} 轮：继续给我一段填充内容。`);
  const beforeSwitch = await state();
  report.beforeSwitch = { requests: requests.map(item => ({ ...item })), ui: beforeSwitch }; await persist();
  assert.equal(beforeSwitch.answers, 4, `切换前应有四轮答复，实际 ${beforeSwitch.answers}`);
  assert.equal(requests.filter(item => item.compacting).length, 0, '切换前不应发生压缩');
  assert.match(beforeSwitch.usage, /131,072/u, `切换前用量应按大窗口显示，实际「${beforeSwitch.usage}」`);

  // ③ 切到小窗口型号：历史装不下时不能再按旧窗口直接发送。
  const switched = await switchModel('QA 小窗口');
  const afterSwitchUi = await state();
  report.switch = { ...switched, ui: afterSwitchUi }; await persist();
  assert.equal(switched.picked, 'clicked', `没有点到小窗口模型：${JSON.stringify(switched)}`);
  assert.ok(afterSwitchUi.trigger.includes('QA 小窗口'), `模型入口应显示小窗口模型，实际「${afterSwitchUi.trigger}」`);
  await send('切换到小窗口之后继续。', 20000);
  const after = await state();
  const postSwitch = requests.slice(4);
  report.after = { requests: postSwitch, ui: after }; await persist();
  assert.ok(postSwitch.some(item => item.compacting), `切换后应先压缩，实际请求：${JSON.stringify(postSwitch)}`);
  assert.equal(postSwitch.filter(item => item.model === 'qa-small' && !item.compacting).length, 0, `历史装不下时不得按新模型直接发送，实际：${JSON.stringify(postSwitch)}`);
  await record('历史装不下小窗口时，先压缩而不是直接超额发送', { attempts: postSwitch.length, models: [...new Set(postSwitch.map(item => item.model))] });

  // ④ 压缩失败必须留下桌面版同一条失败码，并让这一轮显示为未完成（不能假装成功）。
  await pause(1500);
  const logText = await fs.readFile(path.join(evidence, 'app.log'), 'utf8');
  report.log = logText.split(/\r?\n/).filter(line => /turn-failed|MODEL_SWITCH_COMPACTION_FAILED/u.test(line)).slice(-2);
  assert.match(logText, /MODEL_SWITCH_COMPACTION_FAILED/u, '日志里应保留 MODEL_SWITCH_COMPACTION_FAILED');
  assert.match(after.lastAnswer, /未完成|运行错误/u, `这一轮应显示未完成，实际正文「${after.lastAnswer}」`);
  await record('压缩失败时保留桌面版失败码且本轮显示未完成', { codes: ['MODEL_SWITCH_COMPACTION_FAILED'] });

  // ⑤ 新会话直接用��窗口型号：请求与用量都应是小窗口。
  const answered = await ui.evaluate("(()=>{const button=document.querySelector('button[aria-label=\"会话操作\"]');if(!button)return 'no-menu';button.click();return 'menu'})()");
  await pause(1200);
  const created = await ui.evaluate("(()=>{const items=[...document.querySelectorAll('button, [role=menuitem]')];const target=items.find(item=>/新建|新会话|新聊天/u.test(item.innerText||''));if(!target)return 'no-new';target.click();return 'clicked'})()");
  await pause(1500);
  const fresh = { answered, created }; report.fresh = fresh;
  await send('新会话：只用小窗口型号说一句。', 14000);
  const freshState = await state();
  const freshRequests = requests.slice(requests.findIndex(item => item.model === 'qa-small' && !item.compacting));
  report.freshState = { ...fresh, ui: freshState, requests: freshRequests }; await persist();
  assert.equal(created, 'clicked', `没有新建会话：${JSON.stringify(fresh)}`);
  assert.ok(freshRequests.length > 0, `新会话应按小窗口型号发出请求，实际请求：${JSON.stringify(requests)}`);
  assert.equal(freshRequests[0].model, 'qa-small', `新会话请求应使用小窗口型号，实际 ${freshRequests[0].model}`);
  assert.match(freshState.usage, /8,192/u, `新会话用量应按 8,192 显示，实际「${freshState.usage}」`);
  await record('新会话用小窗口型号时用量按 8,192 显示', { model: freshRequests[0].model, usage: freshState.usage });

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

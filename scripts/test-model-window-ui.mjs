// 按模型取上下文窗口：切到窗口更小的模型后，提交前必须按新窗口压缩，而不是继续用上一个模型的窗口。
// 桌面版在模型切换时直接给拟用的请求头定价（装不下就压缩，压缩不成才报 MODEL_SWITCH_COMPACTION_FAILED）；
// 知行原先把提供方目录里的 context_length 丢掉，只按供应商级窗口算阈值，小窗口模型会被超额喂饱。
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
    const text = compacting ? '摘要：用户连续两轮要求填充内容，随后切换到更小窗口的模型。' : `收到第 ${requests.length} 条。${filler}`;
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

const state = () => ui.evaluate(`(()=>{const nodes=[...document.querySelectorAll('.assistant-message')];const usage=[...document.querySelectorAll('.context-usage')].map(node=>node.innerText.trim()).slice(-1)[0]||'';return {answers:nodes.length,trigger:(document.querySelector('.model-trigger')?.innerText||'').trim().slice(0,80),usage,lastAnswer:((nodes.at(-1)?.innerText||'').trim().slice(0,80)),errorText:(document.querySelector('.answer-error, .run-error, [class*=error]')?.innerText||'').trim().slice(0,120)};})()`);
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

  // ① 目录里的窗口必须按模型落到运行时模型表。
  const models = await ui.evaluate("(async()=>{const status=await window.zhixing.runtimeStatus();return status.models.filter(row=>['qa-big','qa-small'].includes(row.id)).map(row=>({id:row.id,contextWindow:row.contextWindow,maxTokens:row.maxTokens}))})()");
  report.models = models; await persist();
  const big = models.find(row => row.id === 'qa-big');
  const small = models.find(row => row.id === 'qa-small');
  assert.ok(big && small, `运行时模型表应包含两个模型，实际 ${JSON.stringify(models)}`);
  assert.equal(big.contextWindow, 131072, `大窗口模型应带 131072，实际 ${big.contextWindow}`);
  assert.equal(small.contextWindow, 8192, `小窗口模型应带 8192，实际 ${small.contextWindow}`);
  await record('模型目录里的上下文窗口按型号落到运行时', { big: big.contextWindow, small: small.contextWindow });

  // ② 大窗口模型下先聊两轮，历史越过小窗口的阈值。
  await send('第一轮：先在大窗口模型上说一句话。');
  await send('第二轮：再来一段填充内容。');
  const beforeSwitch = await state();
  report.beforeSwitch = { requests: requests.map(item => ({ ...item })), ui: beforeSwitch };
  await persist();
  assert.equal(beforeSwitch.answers, 2, `切换前应有两轮答复，实际 ${beforeSwitch.answers}`);
  assert.equal(requests.filter(item => item.compacting).length, 0, '切换前不应发生压缩');

  // ③ 切到小窗口模型（思考强度浮层 → 模型名 → 列表项，三次点击各自等一拍）。
  const opened = await ui.evaluate("(()=>{const trigger=document.querySelector('.model-trigger');if(!trigger)return 'no-trigger';trigger.click();return 'reasoning'})()");
  await pause(2000);
  const linked = await ui.evaluate("(()=>{const link=document.querySelector('.effort-model-link');if(!link)return 'no-model-link';link.click();return 'models'})()");
  await pause(2000);
  const options = await ui.evaluate("(()=>[...document.querySelectorAll('.model-picker-option')].map(item=>item.innerText.trim().slice(0,40)))()");
  const picked = await ui.evaluate("(()=>{const items=[...document.querySelectorAll('.model-picker-option')];const target=items.find(item=>item.innerText.includes('QA 小窗口'));if(!target)return 'no-option';target.click();return 'clicked'})()");
  await pause(2000);
  const afterSwitch = await state();
  report.switch = { opened, linked, options, picked, ui: afterSwitch }; await persist();
  assert.equal(picked, 'clicked', `没有点到小窗口模型：${JSON.stringify({ opened, linked, options })}`);
  assert.ok(afterSwitch.trigger.includes('QA 小窗口'), `模型入口应显示小窗口模型，实际「${afterSwitch.trigger}」`);
  await record('在小窗口模型上继续同一会话', { trigger: afterSwitch.trigger });

  // ④ 切换后的第一次提交：必须按新窗口压缩，再发更短的请求。
  await send('第三轮：切到小窗口模型之后继续。', 16000);
  const after = await state();
  const afterSwitchRequests = requests.slice(2);
  report.after = { requests: afterSwitchRequests, ui: after }; await persist();
  assert.equal(after.errorText, '', `界面不应出现错误提示：${after.errorText}`);
  assert.equal(after.answers, 3, `应有三轮答复，实际 ${after.answers}`);
  assert.equal(afterSwitchRequests.length, 2, `切换后应发生「压缩 + 重发」两次请求，实际 ${afterSwitchRequests.length} 次`);
  assert.equal(afterSwitchRequests[0].compacting, true, '切换后的第一次请求应是摘要请求');
  assert.equal(afterSwitchRequests[1].compacting, false, '第二次请求才是真正的提交');
  assert.equal(afterSwitchRequests[1].model, 'qa-small', `提交应使用小窗口模型，实际 ${afterSwitchRequests[1].model}`);
  assert.ok(afterSwitchRequests[1].messageCount < afterSwitchRequests[0].messageCount, `压缩后的请求应更短：摘要 ${afterSwitchRequests[0].messageCount} 条，提交 ${afterSwitchRequests[1].messageCount} 条`);
  await record('切到小窗口模型后提交前压缩并重发', {
    before: afterSwitchRequests[0].messageCount, after: afterSwitchRequests[1].messageCount, model: afterSwitchRequests[1].model,
  });

  // ⑤ 界面上的上下文用量应按新窗口显示。
  report.usage = after.usage; await persist();
  assert.match(after.usage, /\/\s*8,?192\s+tokens/iu, `上下文用量应按小窗口显示，实际「${after.usage}」`);
  await record('上下文用量按新窗口显示', { usage: after.usage });

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

// 探针：实包里输入 /compact 到底发生什么（不是门禁，只用来取事实）。
// 记下：模型请求条数与每条的用途、界面消息文本、toast、截图。
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connectUi } from './qa-cdp.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = process.cwd();
const exe = path.resolve(process.argv[2] || path.join(root, 'release/win-unpacked/知行.exe'));
const provenance = JSON.parse(await fs.readFile(path.join(path.dirname(exe), 'resources/app/build-provenance.json'), 'utf8'));
const evidence = path.join(root, `.preview/qa-${provenance.version}/compact-probe`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile, { recursive: true });
const filler = '上下文填充：知行压缩命令探针。'.repeat(900);
const requests = [];
const server = http.createServer((request, response) => {
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qa-compact-model', name: 'QA 压缩模型', input_modalities: ['text'] }] }));
    return;
  }
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const messages = payload.messages || [];
    const last = messages.at(-1);
    const compacting = String(last?.content || '').includes('acting as a compaction engine');
    requests.push({ index: requests.length, bytes: body.length, messageCount: messages.length, compacting, head: String(messages[0]?.content || '').slice(0, 60) });
    const base = { id: `chatcmpl-probe-${requests.length}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-compact-model' };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    const text = compacting ? '摘要：用户在做压缩命令探针，前后共三轮填充对话。' : `收到第 ${requests.length} 条。${filler}`;
    write({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
    write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

const snapshot = () => ui.evaluate(`(()=>{
  const messages=[...document.querySelectorAll('.assistant-message')].map(node=>({cls:node.className,text:(node.innerText||'').slice(0,160)}));
  const systemNotes=[...document.querySelectorAll('[class*=notice],[class*=toast],[class*=banner]')].map(node=>({cls:node.className,text:(node.innerText||'').slice(0,160)}));
  return {assistantCount:messages.length,messages:messages.slice(-3),notes:systemNotes.slice(-3),toast:(document.querySelector('.toast')?.innerText||'').trim(),composer:(document.querySelector('textarea[aria-label="聊天输入框"]')?.value||'')};
})()`);

let ui = null, child = null, exit = null, log = null;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/v1`;
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
  if (!ui) throw new Error('no renderer');
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 45000);
  await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 压缩探针', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-compact-0000000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 压缩探针')||status.providers.at(-1);
    const s=await window.zhixing.loadWorkspace();
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-compact-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return true;
  })()`);
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);
  const phases = [];
  for (const round of [1, 2]) {
    await ui.fill('textarea[aria-label="聊天输入框"]', `第 ${round} 轮：给我一段填充内容。`);
    await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');
    await pause(9000);
    phases.push({ round, requests: requests.length, ui: await snapshot() });
  }
  await ui.fill('textarea[aria-label="聊天输入框"]', '/compact');
  await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');
  await pause(12000);
  phases.push({ round: 'compact', requests: requests.length, ui: await snapshot() });
  await ui.screenshot(path.join(evidence, 'after-compact.png'));
  await fs.writeFile(path.join(evidence, 'probe.json'), JSON.stringify({ requests, phases }, null, 2) + '\n');
  console.log(JSON.stringify({ evidence, requests: requests.map(item => ({ index: item.index, messageCount: item.messageCount, compacting: item.compacting, bytes: item.bytes })), last: phases.at(-1) }, null, 1));
} catch (error) {
  console.error(`FAIL ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  try { server.closeAllConnections(); server.close(); } catch {}
  try { if (ui) await ui.evaluate('window.zhixing.windowControl("close")').catch(() => {}); } catch {}
  try { if (ui) ui.close(); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); if (exit) await Promise.race([exit, pause(8000)]); } } catch {}
  try { if (log) await log.close(); } catch {}
}

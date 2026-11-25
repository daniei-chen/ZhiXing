// 交付文件动作实包验收（对标 dsh-client-ui-deliverables 的 PresentedAction：'open' | 'reveal'）：
// 假服务让模型用 present 声明两个真实存在的文件；卡片右侧的「文件操作」菜单给出
// 预览／在默认应用中打开／在文件管理器中显示三项。实测点击「在文件管理器中显示」后主进程核验
// 交付引用并调用系统文件管理器；删除文件后同一动作给出失败文案；伪造引用被拒绝。
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
const evidence = path.join(root, `.preview/qa-${provenance.version}/deliverable-actions`, `run-${Date.now().toString(36)}`);
const profile = path.join(evidence, 'profile');
const workspaceDir = path.join(evidence, '工作区');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(workspaceDir, { recursive: true });
const first = { path: '周报.md', description: '本周进展' };
const second = { path: '清单.md', description: '' };
const files = [first, second];
for (const file of files) await fs.writeFile(path.join(workspaceDir, file.path), `QA 交付动作 ${file.path}\n第二行\n`);
const report = {
  layer: 'windows-packaged-app + real-kernel + local fake provider + project workspace', version: provenance.version,
  sourceCommit: provenance.sourceCommit, sourceDirty: provenance.sourceDirty,
  exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'), status: 'running', cases: [],
};
const reportFile = path.join(evidence, 'result.json');
const persist = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) { report.cases.push({ name, status: 'passed', ...details }); await persist(); console.log(`PASS ${name}`); }
console.log(`Evidence: ${evidence}`);

const server = http.createServer((request, response) => {
  if (request.url.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qa-action-model', name: 'QA 动作模型', input_modalities: ['text'] }] }));
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
    const hasToolResult = (payload.messages || []).some(message => message.role === 'tool');
    const base = { id: 'chatcmpl-qa-action', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'qa-action-model' };
    const chunk = delta => ({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = object => response.write(`data: ${JSON.stringify(object)}\n\n`);
    write(chunk({ role: 'assistant' }));
    if (!hasToolResult) {
      write(chunk({ tool_calls: [{ index: 0, id: 'call-qa-actions', type: 'function', function: { name: 'present', arguments: JSON.stringify({ files }) } }] }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      write(chunk({ content: '两份材料已交付，可以直接打开或定位。' }));
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

const cardState = () => ui.evaluate(`(()=>{
  const box=[...document.querySelectorAll('.deliverable-files')].at(-1);
  if(!box)return {count:0};
  return {count:box.querySelectorAll('.deliverable-card').length,
    actionButtons:box.querySelectorAll('.deliverable-actions').length,
    menuOpen:Boolean(box.querySelector('.file-action-menu')),
    menu:[...box.querySelectorAll('.file-action-menu button')].map(node=>({label:node.textContent.trim(),disabled:node.disabled})),
    expanded:[...box.querySelectorAll('.deliverable-actions')].map(node=>node.getAttribute('aria-expanded')),
    pending:[...box.querySelectorAll('.deliverable-card small')].map(node=>node.textContent.trim()),
    toast:(document.querySelector('.toast')?.textContent||'').trim()};
})()`);

// 打开第 index 张卡片的文件操作菜单。
const openMenu = index => ui.evaluate(`(()=>{
  const box=[...document.querySelectorAll('.deliverable-files')].at(-1);
  const button=[...box.querySelectorAll('.deliverable-actions')][${index}];
  if(!button)throw new Error('missing actions button');
  button.click();return true;
})()`);
const clickMenu = label => ui.evaluate(`(()=>{
  const item=[...document.querySelectorAll('.file-action-menu button')].find(node=>node.textContent.trim()===${JSON.stringify(label)});
  if(!item)throw new Error('missing menu item: '+${JSON.stringify(label)});
  item.click();return true;
})()`);

let ui = null, child = null, exit = null, log = null;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  report.provider = base; await persist();

  log = await fs.open(path.join(evidence, 'app.log'), 'a');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  child = spawn(exe, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    { cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
  exit = once(child, 'close');
  const portsFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 400 && !ui; i += 1) {
    const ports = await fs.readFile(portsFile, 'utf8').catch(() => null);
    if (ports) ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
    if (!ui) await pause(120);
  }
  assert.ok(ui, 'renderer test connection started');
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')', 45000);

  const prepared = await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA 动作服务', protocol: 'openai', baseUrl: base, apiKey: 'sk-qa-action-00000000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const mine=status.providers.find(p=>p.name==='QA 动作服务')||status.providers.at(-1);
    const projectId='qa-project-actions';
    const workspaceId='qa-workspace-actions';
    const workspace={id:workspaceId,name:'QA 动作工作区',type:'office',directory:${JSON.stringify(workspaceDir)},projectId};
    const s=await window.zhixing.loadWorkspace();
    s.projects=[...(s.projects||[]).filter(item=>item.id!==projectId),{id:projectId,name:'QA 动作项目',instructions:'',directory:${JSON.stringify(workspaceDir)},workspaceId,expanded:true}];
    s.workspaces=[...(s.workspaces||[]).filter(item=>item.id!==workspaceId),workspace];
    s.workspaceId=workspaceId;
    s.settings={...s.settings,modelProviderId:mine.id,model:'qa-action-model',reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(s);
    return {providerId:mine.id,workspaceId,projectId};
  })()`);
  report.workspace = prepared; await persist();
  try { await ui.evaluate('location.reload(); true'); } catch {}
  await ui.waitFor('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')&&!document.querySelector(\'textarea[aria-label="聊天输入框"]\').disabled', 60000);

  await ui.evaluate('(()=>{const node=[...document.querySelectorAll(".sidebar button, .sidebar [role=\\"button\\"], button")].find(el=>el.textContent.trim().includes("QA 动作项目"));if(!node)throw new Error("Missing project row");node.click();return true})()');
  await pause(1500);
  if (!(await ui.evaluate('!!document.querySelector(\'textarea[aria-label="聊天输入框"]\')'))) {
    await ui.evaluate('(()=>{const node=[...document.querySelectorAll("button")].find(el=>/新建|新对话|开始/u.test(el.textContent));if(node)node.click();return true})()');
    await pause(1500);
  }
  await record('临时工作区与假服务就绪', { workspace: prepared.workspaceId });

  await ui.fill('textarea[aria-label="聊天输入框"]', '把这两份材料交付给我。');
  await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');
  const deadline = Date.now() + 150000;
  let state = await cardState();
  while (Date.now() < deadline) {
    state = await cardState();
    const busy = await ui.evaluate('Boolean(document.querySelector(".thinking-label"))');
    if (state.count >= 2 && !busy) break;
    await pause(300);
  }
  assert.equal(state.count, 2, `交付卡片数量不对：${state.count}`);
  assert.equal(state.actionButtons, 2, `每张卡片都应有一个文件操作按钮：${state.actionButtons}`);
  await record('每张交付卡片都有文件操作入口', { cards: state.count, buttons: state.actionButtons });

  await openMenu(0);
  await pause(400);
  state = await cardState();
  await ui.screenshot(path.join(evidence, 'file-actions.png'));
  report.menu = state; await persist();
  assert.deepEqual(state.menu.map(item => item.label), ['预览', '在默认应用中打开', '在文件管理器中显示'], `菜单项不符：${state.menu.map(item => item.label).join(' | ')}`);
  assert.equal(state.menu.some(item => item.disabled), false, '空闲时菜单项都应可点');
  assert.equal(state.expanded[0], 'true', '菜单打开时按钮应标出展开状态');
  // 「在默认应用中打开」只核对存在与可点：真点它会拉起系统默认应用，属于用户态操作，不在自动验收里执行。
  await record('文件操作菜单三项与桌面版一致', { menu: state.menu.map(item => item.label) });

  await ui.evaluate('(()=>{document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));return true})()');
  await pause(300);
  state = await cardState();
  assert.equal(state.menuOpen, false, 'Escape 应关闭文件操作菜单');
  await record('Escape 关闭菜单');

  await openMenu(0);
  await pause(300);
  await clickMenu('在文件管理器中显示');
  const toastDeadline = Date.now() + 30000;
  let revealed = '';
  while (Date.now() < toastDeadline) {
    revealed = (await cardState()).toast;
    if (revealed) break;
    await pause(250);
  }
  report.reveal = revealed; await persist();
  assert.equal(revealed.includes('已在文件管理器中显示'), true, `定位成功提示不符：${revealed}`);
  await record('在文件管理器中显示由主进程核验后执行', { toast: revealed });

  // 删除文件后再定位：交付记录还在，但文件已不存在，必须给失败文案而不是成功。
  await fs.rm(path.join(workspaceDir, second.path), { force: true });
  await openMenu(1);
  await pause(300);
  await clickMenu('在文件管理器中显示');
  const failDeadline = Date.now() + 30000;
  let failed = '';
  while (Date.now() < failDeadline) {
    failed = (await cardState()).toast;
    if (failed && failed !== revealed) break;
    await pause(250);
  }
  report.failed = failed; await persist();
  assert.equal(failed.includes('找不到这个文件的位置'), true, `文件消失后的失败文案不符：${failed}`);
  await record('文件被删除后动作给出失败文案', { toast: failed });

  const forged = await ui.evaluate(`(async()=>{try{await window.zhixing.deliverableAction({workspaceId:'x',projectId:'y',sessionId:'z',id:'zx-delivery-v1.redact.notasession.1.0.${'0'.repeat(64)}',action:'reveal'});return {ok:true};}catch(error){return {ok:false,message:String(error?.message||error)};}})()`);
  report.forged = forged; await persist();
  assert.equal(forged.ok, false, '伪造的交付引用不应被接受');
  assert.equal(forged.message.includes('交付引用无效'), true, `伪造引用的拒绝文案不符：${forged.message}`);
  await record('伪造的交付引用被拒绝', { message: forged.message });

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

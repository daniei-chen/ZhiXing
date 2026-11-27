import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connectUi } from './qa-cdp.mjs';
import { selectWorkbenchTab } from './qa-workbench.mjs';
import { QA_DEFAULTS, startQaLocalServices } from './qa-local-services.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const input = 'textarea[aria-label="聊天输入框"]';
const sideInput = 'textarea[aria-label="侧边聊天输入框"]';
const resources = '.conversation-resources[role="dialog"]';
const panel = '.workbench:not([hidden])';

function usage() {
  console.log(`node scripts/test-conversation-ui.mjs [--phase all|resources|sharing|side-chat|screenshots]
node scripts/test-conversation-ui.mjs --check-fixtures

QA_PORT or ZHIXING_QA_PORT must identify the isolated App renderer assigned to this run.
QA_PROJECT_ID must identify a synthetic project with an existing bound directory for resources/all.
QA_MAIN_PORT optionally identifies the same App's Node inspector for clipboard hash checks.
QA_EVIDENCE optionally selects the evidence directory.
QA_CAPTURE_WIDTH and QA_CAPTURE_HEIGHT select screenshot viewport dimensions, defaulting to 1255 and 912.
The script starts its own loopback services on ephemeral ports, adds two synthetic providers through settings,
and retains its synthetic chats, drafts and generated file for inspection. It does not start or stop the App.
--check-fixtures exercises the real Harness and new service fixtures without connecting to any UI.`);
}

async function prepareEvidence() {
  const runId = `conversation-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const evidence = path.resolve(process.env.QA_EVIDENCE || process.env.ZHIXING_QA_EVIDENCE
    || path.join(repository, '.preview/qa-0.11.0', runId));
  await mkdir(evidence, { recursive: true });
  const baseline = {
    runId, startedAt: new Date().toISOString(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    changedFiles: execFileSync('git', ['diff', '--name-only'], { cwd: repository, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean),
    node: process.version, platform: process.platform,
  };
  await writeFile(path.join(evidence, 'baseline.json'), JSON.stringify(baseline, null, 2));
  return { runId, evidence, baseline };
}

async function checkFixtures() {
  const { runId, evidence, baseline } = await prepareEvidence();
  const services = await startQaLocalServices({
    aPort: 0, bPort: 0, modelPort: 0, normalIntervalMs: 5,
    logDirectory: path.join(evidence, 'receipts'),
  });
  const { RuntimeManager } = await import('../electron/runtime.mjs');
  const { resolveProvider, saveProvider } = await import('../electron/providers.mjs');
  const workspaceRoot = path.join(evidence, 'synthetic-workspace');
  await mkdir(workspaceRoot);
  const vaults = new Map();
  const events = [];
  const manager = new RuntimeManager({
    root: path.join(evidence, 'runtime'), readVault: async id => vaults.get(id),
    writeVault: async (id, value) => vaults.set(id, value), onEvent: event => events.push(event),
  });
  const record = { ...baseline, layer: 'local-services-and-real-harness', status: 'running', results: [] };
  try {
    const provider = await saveProvider({ ...services.configuration.model, discover: true }, []);
    const config = { ...resolveProvider([provider], { providerId: provider.id, modelId: 'zhixing-qa', reasoning: 'high' }), workspaceRoot, permission: 'auto' };
    const filename = `qa-${runId}.txt`;
    const delivered = await manager.run({ runId: 'fixture-present', sessionId: 'fixture-present',
      prompt: `QA_CONVERSATION_PRESENT QA_OUTPUT=${filename}`, privacyMode: 'redact' }, config, QA_DEFAULTS.modelKey);
    assert.match(delivered.text, /QA_CONVERSATION_PRESENT_RESPONSE/);
    assert.equal(delivered.deliverables.length, 1);
    assert.equal(path.basename(delivered.deliverables[0].path), filename);
    assert.match(await readFile(path.join(workspaceRoot, filename), 'utf8'), /QA_CONVERSATION_FILE_CONTENT/);
    record.results.push({ name: 'real office_write_file and present', status: 'passed', deliverables: delivered.deliverables });
    const unmapped = await manager.run({ runId: 'fixture-link-unmapped', sessionId: 'fixture-link-unmapped',
      prompt: 'QA_CONVERSATION_LINK_UNMAPPED 诊断模型自带地址的还原边界。', privacyMode: 'redact' }, config, QA_DEFAULTS.modelKey);
    assert(!unmapped.text.includes(services.configuration.conversation.sourceUrl));
    assert.match(unmapped.text, /敏感值待核实/);
    assert.match(unmapped.masked, /⟦ZX-[^-]+-IP-\d+⟧/);
    record.results.push({ name: 'unmapped model IP stays protected', status: 'passed', output: unmapped });
    const linked = await manager.run({ runId: 'fixture-link', sessionId: 'fixture-link',
      prompt: services.configuration.conversation.linkPrompt, privacyMode: 'redact' }, config, QA_DEFAULTS.modelKey);
    assert(linked.text.includes(services.configuration.conversation.sourceUrl));
    const page = await fetch(services.configuration.conversation.sourceUrl).then(response => response.text());
    assert.match(page, /QA_CONVERSATION_WEB_SOURCE/);
    record.results.push({ name: 'real source page and model link', status: 'passed', output: linked });
    const searched = await manager.run({ runId: 'fixture-search', sessionId: 'fixture-search',
      prompt: 'QA_CONVERSATION_SEARCH 实际搜索调用，未配置提供方时保留失败记录。', privacyMode: 'redact' }, config, QA_DEFAULTS.modelKey);
    assert.match(searched.text, /QA_CONVERSATION_SEARCH_UNAVAILABLE_RESPONSE/);
    const searchEvents = events.filter(event => event.runId === 'fixture-search' && /网页搜索/.test(event.label));
    assert(searchEvents.some(event => event.status === 'running') && searchEvents.some(event => event.status === 'failed'), 'Harness must report the unavailable non-DeepSeek search route without falling back to an external provider');
    record.results.push({ name: 'non-DeepSeek search is explicitly unavailable', status: 'passed', events: searchEvents, response: searched.text });
    const providerB = await saveProvider({ ...services.configuration.model,
      baseUrl: services.configuration.conversation.providerBBaseUrl, discover: true }, []);
    const configB = resolveProvider([providerB], { providerId: providerB.id, modelId: 'zhixing-qa', reasoning: 'high' });
    const second = await manager.run({ runId: 'fixture-provider-b', sessionId: 'fixture-provider-b',
      prompt: 'QA_NORMAL QA_PROVIDER_B_ROUTE', privacyMode: 'redact' }, configB, QA_DEFAULTS.modelKey);
    assert.match(second.text, /QA_PROVIDER_B_ROUTE/);
    assert(services.snapshot().records.some(row => row.path === '/conversation-b/v1/chat/completions'));
    record.results.push({ name: 'second provider endpoint', status: 'passed' });
    record.status = 'passed';
  } catch (error) {
    record.status = 'failed';
    record.error = error.stack;
    throw error;
  } finally {
    await manager.close();
    await services.close();
    await writeFile(path.join(evidence, 'fixtures.json'), JSON.stringify(record, null, 2));
    await writeFile(path.join(evidence, 'model-requests.json'), JSON.stringify(services.snapshot(), null, 2));
    console.log(`${record.status.toUpperCase()} fixture checks ${evidence}`);
  }
}

async function runJourney(phase) {
  const port = Number(process.env.QA_PORT || process.env.ZHIXING_QA_PORT);
  assert(Number.isInteger(port) && port > 0 && port < 65536, 'Set QA_PORT to the assigned isolated App renderer port.');
  assert(['all', 'resources', 'sharing', 'side-chat', 'screenshots'].includes(phase), `Unknown phase ${phase}`);
  const captureWidth = Number(process.env.QA_CAPTURE_WIDTH || 1255);
  const captureHeight = Number(process.env.QA_CAPTURE_HEIGHT || 912);
  assert(Number.isInteger(captureWidth) && captureWidth >= 1000 && captureWidth <= 1920);
  assert(Number.isInteger(captureHeight) && captureHeight >= 700 && captureHeight <= 1080);
  const capturePrefix = `${captureWidth}x${captureHeight}-100`;
  const { runId, evidence, baseline } = await prepareEvidence();
  const records = [];
  const runtimeEvents = [];
  const findings = [];
  const services = await startQaLocalServices({
    aPort: 0, bPort: 0, modelPort: 0, logDirectory: path.join(evidence, 'receipts'),
    normalIntervalMs: 20, longIntervalMs: 300, longChunks: 400,
  });
  const configuration = services.configuration;
  const providerNames = { a: `${runId} A`, b: `${runId} B` };
  let ui;
  let main;
  let mainChatId;
  let project;
  let ownsRun = false;
  let completed = false;
  let currentStep = 'connect';
  let clipboardPermissionSetup;
  const requestRows = after => services.snapshot().records.filter(row => row.sequence > after && row.service === 'model' && row.event === 'request');
  const wireText = row => JSON.stringify(row.body.messages);

  async function record(name, details = {}) {
    records.push({ name, status: 'passed', time: new Date().toISOString(), details });
    await writeFile(path.join(evidence, 'journey.json'), JSON.stringify({ ...baseline, phase, records }, null, 2));
    await writeFile(path.join(evidence, 'model-requests.json'), JSON.stringify(services.snapshot(), null, 2));
    console.log(`PASS ${name}`);
  }
  async function recordFinding(name, details = {}) {
    const finding = { name, status: 'failed', time: new Date().toISOString(), details };
    findings.push(finding);
    records.push(finding);
    await writeFile(path.join(evidence, 'journey.json'), JSON.stringify({ ...baseline, phase, records }, null, 2));
    await writeFile(path.join(evidence, 'model-requests.json'), JSON.stringify(services.snapshot(), null, 2));
    console.log(`FAIL ${name}`);
  }
  async function captureLayout(name) {
    const metrics = await ui.evaluate(`(() => {
      const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      const visible=node=>!!node.getClientRects().length&&!node.closest('[hidden]');
      return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,body:rect(document.body),
        document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
        controls:[...document.querySelectorAll('.top-actions button,.workbench button,.workbench input,.workbench select,.conversation-resources button,.composer textarea')]
          .filter(visible).map(node=>({tag:node.tagName,label:node.getAttribute('aria-label')||node.textContent.trim(),rect:rect(node),disabled:node.disabled})),
        resources:document.querySelector('.conversation-resources')?rect(document.querySelector('.conversation-resources')):null,
        browserStart:document.querySelector('.browser-start')?rect(document.querySelector('.browser-start')):null};
    })()`);
    const zoom = main ? await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()") : null;
    assert.equal(metrics.width, captureWidth, 'Capture viewport width must match the declared dimensions');
    assert.equal(metrics.height, captureHeight, 'Capture viewport height must match the declared dimensions');
    if (zoom !== null) assert.equal(zoom, 1, 'Capture zoom must be 100%');
    await ui.screenshot(path.join(evidence, `${name}.png`));
    await writeFile(path.join(evidence, `${name}-rects.json`), JSON.stringify({ ...metrics, zoom }, null, 2));
  }
  const value = selector => ui.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value`);
  const workspace = () => ui.evaluate('window.zhixing.loadWorkspace()');
  const saveSettled = () => ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"', 20000);
  async function key(keyName, code = keyName, virtualKey = 27) {
    await ui.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: virtualKey });
    await ui.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: virtualKey });
  }
  async function clickSelector(selector) {
    const label = await ui.evaluate(`(() => { const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(node=>node.getClientRects().length);if(nodes.length!==1)throw Error('Expected one visible control '+${JSON.stringify(selector)}+', got '+nodes.length);return nodes[0].getAttribute('aria-label')||nodes[0].textContent.trim();})()`);
    await ui.click(label, selector);
  }
  async function clickContaining(selector, text) {
    const label = await ui.evaluate(`(() => {const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(node=>node.getClientRects().length&&node.textContent.includes(${JSON.stringify(text)}));if(nodes.length!==1)throw Error('Expected one matching control '+${JSON.stringify(text)}+', got '+nodes.length);return nodes[0].getAttribute('aria-label')||nodes[0].textContent.trim();})()`);
    await ui.click(label, selector);
  }
  async function openSettings(tab) {
    if (!await ui.evaluate('!!document.querySelector(".settings-page")')) {
      if (await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")')) await ui.click('展开侧栏');
      await ui.click('打开设置');
    }
    await ui.click(tab, '.settings-nav button');
  }
  async function closePanel() {
    if (await ui.evaluate(`!!document.querySelector(${JSON.stringify(panel)})`)) await clickSelector('.top-actions > button[aria-expanded="true"]');
    await ui.waitFor(`!document.querySelector(${JSON.stringify(panel)})`);
  }
  async function openPanel(page) {
    if (!await ui.evaluate(`!!document.querySelector(${JSON.stringify(panel)})`)) await ui.click('打开工作面板', '.top-actions button');
    await selectWorkbenchTab(ui, page);
    await ui.waitFor(`document.querySelector('[role="tabpanel"][data-workbench-panel=${JSON.stringify(page)}]')?.hidden === false`);
  }
  async function openChat(id) {
    await saveSettled();
    const saved = await workspace();
    const chat = saved.chats.find(item => item.id === id);
    assert(chat, `Missing synthetic chat ${id}`);
    const selector = await ui.evaluate(`(() => {
      const row = ${JSON.stringify(id)};
      const project = document.querySelector('.project-chats .chat-row[data-chat-id="' + row + '"] .chat-link');
      if (project) return '.project-chats .chat-row[data-chat-id="' + row + '"] .chat-link';
      const pinned = document.querySelector('.pinned-chats .chat-row[data-chat-id="' + row + '"] .chat-link');
      if (pinned) return '.pinned-chats .chat-row[data-chat-id="' + row + '"] .chat-link';
      const recentId = document.querySelector('.sidebar-section-toggle')?.getAttribute('aria-controls');
      return recentId ? '#' + CSS.escape(recentId) + ' .chat-row[data-chat-id="' + row + '"] .chat-link' : '';
    })()`);
    assert(selector, `No visible sidebar group contains chat ${id}`);
    await clickSelector(selector);
    await ui.waitFor(`document.querySelector('.top-path strong')?.textContent===${JSON.stringify(chat.title)}`);
    return chat;
  }
  async function chooseProvider(name) {
    await clickSelector('.model-trigger');
    await clickSelector('.effort-model-link');
    await clickContaining('.model-picker-option[title="zhixing-qa"]', name);
    await clickSelector('.model-trigger');
    await ui.fill('.effort-popover input[type="range"]', '2');
    await key('Escape');
    assert((await ui.evaluate('document.querySelector(".model-trigger")?.title')).includes(name));
    await saveSettled();
    const saved = await workspace();
    assert.equal(saved.settings.reasoning, 'high');
    return saved.settings.modelProviderId;
  }
  async function addProvider(name, baseUrl) {
    await openSettings('供应商');
    await ui.click('自定义', '.provider-presets button');
    await ui.fill('input[placeholder="例如，公司模型网关"]', name);
    await ui.fill('input[placeholder="https://api.example.com/v1"]', baseUrl);
    await ui.fill('.connection-form input[type="password"]', QA_DEFAULTS.modelKey);
    await ui.click('高级设置');
    await ui.fill('select[aria-label="思考参数"]', 'standard');
    await ui.click('拉取模型并保存');
    await ui.waitFor('document.querySelector(".setting-notice")?.textContent.includes("模型已更新")');
    await ui.click('返回工作台');
  }
  async function attachFile(name, contents) {
    await ui.evaluate(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(contents)}],${JSON.stringify(name)},{type:'text/plain'}));document.querySelector('.composer').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()`);
    await ui.waitFor(`[...document.querySelectorAll('.attachment-chip:not(.invalid)')].some(node=>node.textContent.includes(${JSON.stringify(name)}))`);
    assert(!await ui.evaluate(`[...document.querySelectorAll('.attachment-chip.invalid')].some(node=>node.textContent.includes(${JSON.stringify(name)}))`));
  }
  async function sendMain(prompt) {
    await ui.fill(input, prompt);
    await ui.waitFor('!document.querySelector(".toast")', 10000);
    const cursor = services.snapshot().sequence;
    await ui.click('发送消息', '.composer button');
    ownsRun = true;
    await ui.waitFor(`!document.querySelector('button[aria-label=停止生成]') && [...document.querySelectorAll('.transcript .user-message')].at(-1)?.textContent.includes(${JSON.stringify(prompt)}) && !!document.querySelector('.transcript .assistant-message:last-of-type .answer-actions')`, 90000);
    ownsRun = false;
    await saveSettled();
    const saved = await workspace();
    const chat = saved.chats.find(item => item.messages.some(message => message.role === 'user' && message.text === prompt));
    assert(chat, 'Submitted prompt must belong to a persisted UI chat');
    const answer = chat.messages.at(-1);
    assert(!answer.error && !answer.pending, `Harness run failed ${answer.errorMessage || answer.text}`);
    assert(requestRows(cursor).length > 0, 'A real local model request must be received');
    return { chat, answer, cursor, requests: requestRows(cursor) };
  }
  async function openResources() {
    await ui.click('查看当前对话产出与来源');
    await ui.waitFor(`!!document.querySelector(${JSON.stringify(resources)})`);
  }
  async function runSearchJourney() {
    const prompt = 'QA_CONVERSATION_SEARCH 只按实际搜索工具事件呈现来源。';
    await ui.fill(input, prompt);
    await ui.waitFor('!document.querySelector(".toast")', 10000);
    const cursor = services.snapshot().sequence;
    const eventCursor=await ui.evaluate('(window.__conversationQaEvents||[]).length');
    const startedAt = Date.now();
    await ui.click('发送消息', '.composer button');
    ownsRun = true;
    let state;
    let runId;
    const deadline = startedAt + 30000;
    while (Date.now() < deadline) {
      state = await ui.evaluate(`(() => {
        const events=(window.__conversationQaEvents||[]).slice(${eventCursor});
        const users=[...document.querySelectorAll('.transcript .user-message')];
        const answers=[...document.querySelectorAll('.transcript .assistant-message')];
        const last=answers.at(-1);
        const runId=events.findLast(event=>event.type==='status'&&event.label==='内核运行中')?.runId;
        const terminal=events.findLast(event=>event.runId===runId&&event.type==='run/terminal');
        return {running:!!document.querySelector('button[aria-label="停止生成"]'),
          userText:users.at(-1)?.textContent||'',answerText:last?.textContent||'',
          hasAnswerActions:!!last?.querySelector('.answer-actions'),
          hasError:!!last?.querySelector('.error-message,[role="alert"]'),
          modal:document.querySelector('.modal')?.getAttribute('aria-label')||null,
          runId,terminal,events:events.map(event=>({runId:event.runId,type:event.type,label:event.label,status:event.status}))};
      })()`);
      runId ||= state.runId;
      if (state.userText.includes(prompt) && (state.hasAnswerActions || state.hasError || (state.terminal&&state.terminal.runId===runId))) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const snapshot=services.snapshot();
    const requests=requestRows(cursor);
    const toolCalls=snapshot.records.filter(row=>row.sequence>cursor&&row.service==='model'&&row.event==='tool-call');
    const toolResults=state?.events.filter(event=>event.runId===runId&&event.type==='tool/result')||[];
    const terminal=state?.events.findLast(event=>event.runId===runId&&event.type==='run/terminal');
    const finished=!!terminal;
    const explicitError=state?.hasError||terminal?.status==='failed';
    const diagnostics={prompt,eventCursor,elapsedMs:Date.now()-startedAt,modelRequests:requests.map(row=>({path:row.path,model:row.body.model,stream:row.body.stream,reasoning_effort:row.body.reasoning_effort})),toolCalls,toolResults,runId,
      ui:{running:state?.running,userText:state?.userText,answerText:state?.answerText,hasAnswerActions:state?.hasAnswerActions,hasError:state?.hasError,modal:state?.modal,terminal},
      events:state?.events.filter(event=>event.runId===runId)};
    await writeFile(path.join(evidence,'search-diagnostic.json'),JSON.stringify(diagnostics,null,2));
    if(!requests.length||!toolCalls.some(row=>row.calls?.some(call=>call.name==='web_search'))){
      await ui.screenshot(path.join(evidence,'search-request-or-tool-call-missing.png'));
      await recordFinding('合成模型未产生预期的 web_search 工具请求',{...diagnostics,requestReceived:requests.length>0,toolCallReceived:toolCalls.some(row=>row.calls?.some(call=>call.name==='web_search'))});
      if(state?.running&&await ui.evaluate('!!document.querySelector("button[aria-label=停止生成]")')){
        await ui.click('停止生成');
        await ui.waitFor('!document.querySelector("button[aria-label=停止生成]")',30000);
      }
      ownsRun=false;
      await saveSettled();
      return {finished:false,failed:true,runId};
    }
    if (finished&&explicitError) {
      ownsRun=false;
      await saveSettled();
      const saved=await workspace();
      const chat=saved.chats.find(item=>item.messages.some(message=>message.runId===runId));
      const answer=chat?.messages.findLast(message=>message.runId===runId);
      assert(answer?.error||answer?.errorMessage||state.hasError,'Search failure must be visible in the chat UI');
      await record('web_search 无提供方时在 UI 显示终态错误并保留工具事件',{...diagnostics,answer});
      return {finished:true,failed:true,runId};
    }
    if(finished&&state?.running){
      await ui.screenshot(path.join(evidence,'search-terminal-but-ui-still-running.png'));
      await recordFinding('Harness 已发 run/terminal=succeeded，但交办界面仍显示生成中且没有工具结果或错误',diagnostics);
      if(await ui.evaluate('!!document.querySelector("button[aria-label=停止生成]")')){
        await ui.click('停止生成');
        await ui.waitFor('!document.querySelector("button[aria-label=停止生成]")',30000);
      }
      ownsRun=false;
      await saveSettled();
      return {finished:true,failed:true,runId};
    }
    if (!finished) {
      await ui.screenshot(path.join(evidence,'search-no-terminal.png'));
      await recordFinding('web_search 工具调用未在 75 秒内进入 UI 终态或错误',diagnostics);
      const stopVisible=await ui.evaluate('!!document.querySelector("button[aria-label=停止生成]")');
      if(stopVisible)await ui.click('停止生成');
      await ui.waitFor('!document.querySelector("button[aria-label=停止生成]")',30000);
      ownsRun=false;
      await saveSettled();
      return {finished:false,failed:true,runId};
    }
    ownsRun=false;
    await saveSettled();
    const saved=await workspace();
    const chat=saved.chats.find(item=>item.messages.some(message=>message.runId===runId));
    const answer=chat?.messages.findLast(message=>message.runId===runId);
    const failedSearch=answer?.trace?.findLast(event=>/网页搜索/.test(event.label||''));
    if(failedSearch?.status==='failed'&&answer.text.includes('QA_CONVERSATION_SEARCH_UNAVAILABLE_RESPONSE')){
      await openPanel('activity');
      assert(await ui.evaluate('document.querySelector("[role=tabpanel][data-workbench-panel=activity]")?.innerText.includes("网页搜索 · 失败")'));
      await closePanel();
      await record('非 DeepSeek 路由明确显示搜索不可用，不借用模型凭据，执行轨迹保留失败结果',{...diagnostics,answer,searchTrace:failedSearch});
      return {finished:true,failed:false,runId};
    }
    if(answer?.error||state?.hasError) {
      await record('web_search 失败以明确终态错误显示在 UI',{...diagnostics,answer});
      return {finished:true,failed:true,runId};
    }
    if(!answer||answer.pending||!answer.trace?.some(event=>/网页搜索/.test(event.label))){
      await recordFinding('web_search 已停止但 UI 缺少完成回复或搜索轨迹',{...diagnostics,answer});
      return {finished:true,failed:true,runId};
    }
    await openResources();
    await clickContaining('.resource-sources button','网页搜索记录');
    await ui.waitFor('!!document.querySelector(".workbench:not([hidden]) .execution-panel") && !document.querySelector("[role=tabpanel][data-workbench-panel=activity]").hidden');
    await closePanel();
    await record('无 URL 的实际搜索摘要跳执行轨迹',{trace:answer.trace,toolCalls});
    return {finished:true,failed:false,runId};
  }

  try {
    ui = await connectUi(port);
    if (process.env.QA_MAIN_PORT || process.env.ZHIXING_QA_MAIN_PORT) {
      main = await connectUi(Number(process.env.QA_MAIN_PORT || process.env.ZHIXING_QA_MAIN_PORT), true);
      const windowState = await main.evaluate(`(()=>{const electron=process.mainModule.require('electron');const window=electron.BrowserWindow.getAllWindows()[0];const before={visible:window.isVisible(),minimized:window.isMinimized(),bounds:window.getBounds()};if(window.isMinimized())window.restore();window.webContents.setZoomFactor(1);window.setContentSize(${captureWidth},${captureHeight});window.showInactive();return {profile:electron.app.getPath('userData'),appPath:electron.app.getAppPath(),execPath:process.execPath,pid:process.pid,version:electron.app.getVersion(),rendererUrl:window.webContents.getURL(),before,bounds:window.getBounds(),zoom:window.webContents.getZoomFactor()};})()`);
      await writeFile(path.join(evidence, 'qa-window.json'), JSON.stringify(windowState, null, 2));
    }
    if(phase==='all'||phase==='sharing'){
      const beforePermissionState=await ui.evaluate(`(async()=>({write:(await navigator.permissions.query({name:'clipboard-write'})).state,read:(await navigator.permissions.query({name:'clipboard-read'})).state}))()`)
        .catch(error=>({queryError:error.message}));
      const result=await ui.send('Browser.grantPermissions',{origin:'zhixing://app',permissions:['clipboardSanitizedWrite','clipboardReadWrite']});
      const permissionState=await ui.evaluate(`(async()=>({write:(await navigator.permissions.query({name:'clipboard-write'})).state,read:(await navigator.permissions.query({name:'clipboard-read'})).state}))()`)
        .catch(error=>({queryError:error.message}));
      clipboardPermissionSetup={origin:'zhixing://app',permissions:['clipboardSanitizedWrite','clipboardReadWrite'],beforePermissionState,grantResult:result,permissionState};
      await writeFile(path.join(evidence,'clipboard-permission-setup.json'),JSON.stringify(clipboardPermissionSetup,null,2));
    }
    await saveSettled();
    assert(!await ui.evaluate('!!document.querySelector("button[aria-label=停止生成],button[aria-label=停止侧边聊天]")'), 'The assigned UI must be idle before this journey');
    await ui.evaluate(`window.__conversationQaEvents=[];window.__conversationQaUnsubscribe=window.zhixing.onRuntimeEvent(event=>window.__conversationQaEvents.push(event));`);
    const initial = await workspace();
    await writeFile(path.join(evidence, 'initial-settings.json'), JSON.stringify(initial.settings, null, 2));
    if (await ui.evaluate('!!document.querySelector(".settings-page")')) await ui.click('返回工作台');
    if (await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")')) await ui.click('展开侧栏');
    await ui.click('首页', '.app-rail button');
    await ui.click('新聊天', '.new-chat');
    await closePanel();
    if (phase === 'screenshots') {
      const expandedProjects = await ui.evaluate('[...document.querySelectorAll(".project-expand[aria-expanded=true]")].map(node=>node.getAttribute("aria-label"))');
      for (const label of expandedProjects) await ui.click(label, '.project-expand');
      if (await ui.evaluate('!!document.querySelector(".sidebar-section-toggle[aria-expanded=true]")')) {
        await clickSelector('.sidebar-section-toggle[aria-expanded="true"]');
      }
      if (await ui.evaluate('!!document.querySelector(".toast-dismiss")')) await ui.click('关闭错误提示');
      await ui.waitFor('!document.querySelector(".toast")', 10000);
    }

    currentStep = 'header entries';
    const entries = await ui.evaluate('[...document.querySelectorAll(".top-actions > .menu-anchor > button,.top-actions > button")].map(node=>node.getAttribute("aria-label"))');
    assert.deepEqual(entries, ['会话操作', '查看当前对话产出与来源', '打开工作面板']);
    await openResources();
    assert.equal(await ui.evaluate(`!!document.querySelector(${JSON.stringify(panel)})`), false);
    assert.equal(await ui.evaluate('document.querySelectorAll(".conversation-resources .resource-empty").length'), 2);
    assert.equal(await ui.evaluate(`!!document.querySelector(${JSON.stringify(resources)}+' h2')`), false);
    await key('Escape');
    await ui.waitFor(`!document.querySelector(${JSON.stringify(resources)})`);
    assert.equal(await ui.evaluate('document.activeElement?.getAttribute("aria-label")'), '查看当前对话产出与来源');
    await record('顶栏三入口、小浮层空态与 Escape 焦点恢复');
    await openPanel('browser');
    const previousTabs = await ui.evaluate('[...document.querySelectorAll(".browser-tabs>div>button:first-child")].map(node=>({title:node.title,text:node.textContent}))');
    await writeFile(path.join(evidence, 'browser-fixture-initialization.json'), JSON.stringify({ previousTabs, action: 'Close previous isolated QA tabs through their real controls before creating a fresh tab' }, null, 2));
    while (await ui.evaluate('!!document.querySelector(".browser-tabs>div>button[aria-label^=关闭网页]")')) {
      await clickSelector('.browser-tabs>div:first-child>button[aria-label^="关闭网页"]');
    }
    await ui.click('新建浏览器标签');
    await ui.waitFor('!!document.querySelector(".workbench-view:not([hidden]) input[aria-label=新标签页网址]")');
    assert.equal(await value('input[aria-label="新标签页网址"]'), '');
    if (phase === 'screenshots') {
      await ui.evaluate('document.activeElement?.blur()');
      assert.equal(await ui.evaluate('document.querySelectorAll(".browser-start-actions button").length'), 4);
      assert.equal(await value(input), '');
      assert.equal(await ui.evaluate('document.querySelectorAll(".transcript .user-message,.transcript .assistant-message").length'), 0);
      assert.equal(await ui.evaluate('!!document.querySelector(".toast,.conversation-resources,.modal")'), false);
    }
    await captureLayout(`${capturePrefix}-browser-fresh-start`);
    if (phase === 'screenshots') {
      await record('README 空白新聊天与浏览器四卡首页，真实 source App 截图及位置记录', {
        screenshot: path.join(evidence, `${capturePrefix}-browser-fresh-start.png`), width: captureWidth, height: captureHeight, zoom: 1,
      });
      completed = true;
      return;
    }
    await openResources();
    await captureLayout('1255x912-100-floating-resources');
    assert(await ui.evaluate('document.querySelector(".conversation-resources").getBoundingClientRect().width<360'));
    await key('Escape');
    await closePanel();
    await record('同分辨率与缩放的全新浏览器空页和资源浮层截图及控件矩形');

    currentStep = 'synthetic provider settings';
    await addProvider(providerNames.a, configuration.model.baseUrl);
    await addProvider(providerNames.b, configuration.conversation.providerBBaseUrl);
    const providerA = await chooseProvider(providerNames.a);
    await openSettings('隐私与数据');
    if (!await ui.evaluate('document.querySelector("input[name=privacy-mode][value=redact]")?.checked')) {
      await clickSelector('input[name="privacy-mode"][value="redact"]');
    }
    await ui.click('返回工作台');
    await saveSettled();
    assert.equal((await workspace()).settings.privacyMode, 'redact', 'This journey requires the actual UI privacy mode to be redact');
    await record('两家合成供应商通过 UI 发现同名型号，明确选择 high', { providerA, names: providerNames, modelBase: configuration.model.baseUrl });

    if (phase === 'resources' || phase === 'all') {
      currentStep = 'real deliverable';
      assert(process.env.QA_PROJECT_ID, 'Set QA_PROJECT_ID to a synthetic project already bound to its QA directory.');
      project = (await workspace()).projects.find(item => item.id === process.env.QA_PROJECT_ID);
      assert(project?.directory, 'QA_PROJECT_ID must have an existing directory');
      await ui.click(project.name, '.project-name');
      await closePanel();
      await ui.click('更改权限');
      await clickContaining('.permission-option', '帮我批准');
      const filename = `qa-${runId}.txt`;
      const produced = await sendMain(`QA_CONVERSATION_PRESENT QA_OUTPUT=${filename}`);
      mainChatId = produced.chat.id;
      assert.match(produced.answer.text, /QA_CONVERSATION_PRESENT_RESPONSE/);
      assert.equal(produced.answer.deliverables.length, 1);
      assert.equal(path.basename(produced.answer.deliverables[0].path), filename);
      const filePath = path.join(project.directory, filename);
      assert.match(await readFile(filePath, 'utf8'), /QA_CONVERSATION_FILE_CONTENT/);
      await openResources();
      assert.equal(await ui.evaluate(`!!document.querySelector(${JSON.stringify(panel)})`), false);
      await captureLayout('1255x912-100-resources-real-output');
      await clickContaining('.resource-outputs button', filename);
      await ui.waitFor('document.querySelector(".delivery-preview pre")?.textContent.includes("QA_CONVERSATION_FILE_CONTENT")');
      assert.equal(await ui.evaluate('document.querySelector("[role=tab][data-workbench-page=deliverables]")?.getAttribute("aria-selected")'), 'true');
      assert.equal(await ui.evaluate('!!document.querySelector(".modal")'), false);
      await ui.click('返回产出列表', '.delivery-preview button[aria-label="返回产出列表"]');
      await record('实际 Harness 写文件与 present，浮层打开原生交付引用', { chatId: mainChatId, filePath, modelRequests: produced.requests });

      currentStep = 'real source and attachment';
      await openPanel('browser');
      if (await ui.evaluate('!!document.querySelector("input[aria-label=新标签页网址]")')) {
        await ui.fill('input[aria-label="新标签页网址"]', configuration.conversation.sourceUrl);
        await ui.click('前往网址');
      } else {
        await ui.fill('input[aria-label="网页地址"]', configuration.conversation.sourceUrl);
        await ui.click('打开网页', '.browser-toolbar button');
      }
      await ui.waitFor('document.querySelector(".browser-document-actions button")?.disabled===false', 20000);
      await ui.click('加入交办', '.browser-document-actions button');
      await closePanel();
      const attachmentName = `${runId}-资料.txt`;
      await attachFile(attachmentName, 'QA_MAIN_ATTACHMENT 合成资料，编号 00123。');
      const sourced = await sendMain(`QA_NORMAL ${runId} 来源记录，联系人：测试员，电话 138-0000-0000。`);
      mainChatId = sourced.chat.id;
      assert(!wireText(sourced.requests.at(-1)).includes('138-0000-0000'));
      assert(wireText(sourced.requests.at(-1)).includes('QA_MAIN_ATTACHMENT'));
      assert(wireText(sourced.requests.at(-1)).includes('QA_CONVERSATION_WEB_SOURCE'));
      await openResources();
      assert((await ui.evaluate('document.querySelector(".resource-sources").textContent')).includes(attachmentName));
      await captureLayout('1255x912-100-resources-output-and-sources');
      await clickContaining('.resource-sources button', attachmentName);
      await ui.waitFor('document.querySelector(".modal")?.textContent.includes("仅保留附件记录")');
      await ui.click('关闭对话框');
      await openResources();
      await clickContaining('.resource-sources button', '知行合成来源页面');
      await ui.waitFor('!!document.querySelector(".workbench:not([hidden]) input[aria-label=网页地址]")');
      assert.equal(await value('input[aria-label="网页地址"]'), configuration.conversation.sourceUrl);
      await closePanel();
      await record('实际网页加入交办、附件来源记录与浏览器打开', { chatId: mainChatId, modelRequests: sourced.requests });

      currentStep = 'actual search trace';
      await runSearchJourney();
    }

    if (!mainChatId) {
      currentStep = 'baseline main conversation';
      const mainReply = await sendMain(`QA_NORMAL ${runId} MAIN_HISTORY_ONLY，联系人：测试员，电话 138-0000-0000。`);
      mainChatId = mainReply.chat.id;
    }
    if (phase === 'sharing' || phase === 'all') {
      currentStep = 'share confirmation';
      await closePanel();
      await ui.click('会话操作');
      await ui.click('保存会话', '.session-actions-menu button');
      await saveSettled();
      for (const label of ['复制为文件…', '导出聊天文件…']) {
        await ui.click('会话操作');
        await ui.click(label, '.session-actions-menu button');
        await ui.waitFor('document.querySelector(".modal")?.getAttribute("aria-label")==="交付审阅"');
        assert.equal(await ui.evaluate('document.querySelector(".modal .primary-button").disabled'), true);
        assert.equal(await value('select[aria-label="文件格式"]'), 'txt');
        await ui.click('关闭对话框');
      }
      await ui.click('会话操作');
      await ui.click('分享或转发…', '.session-actions-menu button');
      await ui.waitFor('document.querySelector(".modal")?.getAttribute("aria-label")==="分享审阅"');
      const preview = await ui.evaluate('document.querySelector(".modal .privacy-text").textContent');
      assert.equal(await ui.evaluate('document.querySelector(".modal [role=tab][aria-selected=true]").textContent'), '接收方版');
      assert(!preview.includes('138-0000-0000'));
      assert(!preview.includes('⟦ZX-'));
      assert.equal(await ui.evaluate('document.querySelector(".modal .primary-button").disabled'), true);
      const clipboardBeforeHash = main ? await main.evaluate("(async()=>{const text=await process.mainModule.require('electron').clipboard.readText();return process.mainModule.require('node:crypto').createHash('sha256').update(text).digest('hex');})()") : null;
      await ui.evaluate('document.querySelector(".modal .primary-button").click()');
      assert.equal(await ui.evaluate('document.querySelector(".modal")?.getAttribute("aria-label")'), '分享审阅');
      if (main) assert.equal(await main.evaluate("(async()=>{const text=await process.mainModule.require('electron').clipboard.readText();return process.mainModule.require('node:crypto').createHash('sha256').update(text).digest('hex');})()"), clipboardBeforeHash);
      await clickSelector('.modal input[type="checkbox"]');
      assert.equal(await ui.evaluate('document.querySelector(".modal .primary-button").disabled'), false);
      await ui.click('本人版', '.modal [role="tab"]');
      assert((await ui.evaluate('document.querySelector(".modal .privacy-text").textContent')).includes('138-0000-0000'));
      assert.equal(await ui.evaluate('document.querySelector(".modal input[type=checkbox]").checked'), false);
      assert.equal(await ui.evaluate('document.querySelector(".modal .primary-button").disabled'), true);
      await ui.click('接收方版', '.modal [role="tab"]');
      assert.equal(await ui.evaluate('document.querySelector(".modal input[type=checkbox]").checked'), false);
      await ui.screenshot(path.join(evidence, 'share-recipient-unconfirmed.png'));
      assert(main, 'QA_MAIN_PORT is required to verify the real system clipboard after confirmed sharing');
      assert.equal(await ui.evaluate('typeof navigator.share'), 'undefined', 'This clipboard journey requires the actual desktop clipboard fallback');
      await clickSelector('.modal input[type="checkbox"]');
      await ui.click('分享或复制', '.modal .primary-button');
      await ui.waitFor('!document.querySelector(".modal")');
      const clipboardResult = await main.evaluate(`(async() => {
        const electron=process.mainModule.require('electron');
        const text=await electron.clipboard.readText();
        const expected=${JSON.stringify(preview)};
        return {matchesPreview:text===expected,matchesAfterLineEndingNormalization:text.replace(/\\r\\n/g,'\\n')===expected.replace(/\\r\\n/g,'\\n'),matchesAfterTrailingWhitespaceTrim:text.trimEnd()===expected.trimEnd(),length:text.length,previewLength:expected.length,containsSyntheticPhone:text.includes('138-0000-0000'),
          containsToken:text.includes('⟦ZX-'),hash:process.mainModule.require('node:crypto').createHash('sha256').update(text).digest('hex'),
          previewHash:process.mainModule.require('node:crypto').createHash('sha256').update(${JSON.stringify(preview)}).digest('hex')};
      })()`);
      if(clipboardResult.matchesAfterLineEndingNormalization&&clipboardResult.containsSyntheticPhone===false&&clipboardResult.containsToken===false&&clipboardResult.hash!==clipboardBeforeHash){
        await record('会话保存、复制与导出审阅，授权后 UI 确认且 Electron 主进程读取与脱敏预览一致', { clipboardPermissionSetup, unconfirmedClipboardHash: clipboardBeforeHash, confirmedClipboard: clipboardResult });
      }else{
        await recordFinding('确认分享后 Electron 剪贴板与接收方预览不一致',{clipboardPermissionSetup,unconfirmedClipboardHash:clipboardBeforeHash,confirmedClipboard:clipboardResult});
      }
    }

    if (phase === 'side-chat' || phase === 'all') {
      currentStep = 'side chat independent draft';
      await closePanel();
      await ui.fill(input, `${runId} MAIN_UNSENT_DRAFT`);
      await openPanel('chat');
      const before = new Set((await workspace()).chats.map(chat => chat.id));
      await ui.click('新建侧边聊天', '.side-chat-toolbar button');
      await ui.waitFor(`!!document.querySelector(${JSON.stringify(sideInput)})`);
      const sideId = await value('select[aria-label="选择侧边聊天"]');
      assert(sideId && !before.has(sideId));
      await ui.fill(sideInput, `QA_NORMAL ${runId} SIDE_HISTORY_ONLY`);
      await openPanel('files');
      await openPanel('chat');
      await ui.waitFor('!document.querySelector(".toast")',10000);
      assert.equal(await value(sideInput), `QA_NORMAL ${runId} SIDE_HISTORY_ONLY`);
      assert.equal(await value(input), `${runId} MAIN_UNSENT_DRAFT`);
      const cursor = services.snapshot().sequence;
      await ui.click('发送侧边聊天');
      ownsRun = true;
      await ui.waitFor('document.querySelector(".side-chat-assistant")?.textContent.includes("QA_NORMAL_RESPONSE") && !document.querySelector("button[aria-label=停止侧边聊天]")', 90000);
      ownsRun = false;
      await saveSettled();
      let saved = await workspace();
      const sideChat = saved.chats.find(chat => chat.id === sideId);
      assert.equal(sideChat.providerId, providerA);
      assert.equal(sideChat.messages.filter(message => message.role === 'user').length, 1);
      assert(requestRows(cursor).every(row => row.path === '/v1/chat/completions' && row.body.model === 'zhixing-qa' && row.body.reasoning_effort === 'high'));
      assert(requestRows(cursor).every(row => !wireText(row).includes('MAIN_HISTORY_ONLY')));
      assert.equal(await value(input), `${runId} MAIN_UNSENT_DRAFT`);
      await record('侧边聊天真实供应商与独立历史，主会话草稿保持', { sideId, mainChatId, requests: requestRows(cursor) });

      currentStep = 'side draft attachment reuse';
      await openChat(sideId);
      await closePanel();
      const sideAttachment = `${runId}-侧边附件.txt`;
      await attachFile(sideAttachment, 'QA_SIDE_ATTACHMENT_CONTENT 合成附件数值 456.78。');
      const sideLinkPrompt = `${configuration.conversation.linkPrompt} ${runId} SIDE_ATTACHMENT_REQUEST`;
      await ui.fill(input, sideLinkPrompt);
      await saveSettled();
      await openChat(mainChatId);
      await openPanel('chat');
      await ui.fill('select[aria-label="选择侧边聊天"]', sideId);
      assert.equal(await value(sideInput), sideLinkPrompt);
      assert((await ui.evaluate('document.querySelector(".side-chat-attachments").textContent')).includes(sideAttachment));
      const attachmentCursor = services.snapshot().sequence;
      await ui.click('发送侧边聊天');
      ownsRun = true;
      await ui.waitFor('document.querySelectorAll(".side-chat-assistant").length===2 && !document.querySelector("button[aria-label=停止侧边聊天]")', 90000);
      ownsRun = false;
      assert(requestRows(attachmentCursor).some(row => wireText(row).includes('QA_SIDE_ATTACHMENT_CONTENT')));
      assert(requestRows(attachmentCursor).some(row => row.body.messages.some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('QA_NORMAL_RESPONSE'))));
      await clickContaining('.side-chat-assistant a', '本机合成来源页面');
      await ui.waitFor('!!document.querySelector(".workbench:not([hidden]) input[aria-label=网页地址]")');
      assert.equal(await value('input[aria-label="网页地址"]'), configuration.conversation.sourceUrl);
      await openPanel('chat');
      assert.equal(await value('select[aria-label="选择侧边聊天"]'), sideId);
      await record('同一侧边会话恢复附件草稿，实际请求含附件及历史，链接进入浏览器', { sideId, requests: requestRows(attachmentCursor) });

      currentStep = 'side streaming stop';
      const longCursor = services.snapshot().sequence;
      const longStartedAt=Date.now();
      await ui.fill(sideInput, `QA_LONG ${runId} SIDE_STOP_REQUEST`);
      await ui.waitFor('!document.querySelector(".toast")',10000);
      await ui.click('发送侧边聊天');
      ownsRun = true;
      const prefixDeadline = Date.now() + 45000;
      let firstChunk;
      while (!firstChunk && Date.now() < prefixDeadline) {
        firstChunk = services.snapshot().records.find(row => row.sequence > longCursor && row.event === 'first-chunk');
        if (!firstChunk) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(firstChunk, 'The real provider must produce a prefix before the stop request');
      const firstChunkReceivedAt=Date.now();
      let visibleAt;
      let liveState;
      const visibilityDeadline=firstChunkReceivedAt+5000;
      while(Date.now()<visibilityDeadline&&!visibleAt){
        liveState=await ui.evaluate(`(()=>{const events=window.__conversationQaEvents||[];const runId=events.findLast(event=>event.type==='status'&&event.label==='内核运行中')?.runId;const rows=[...document.querySelectorAll('.side-chat-assistant')];const last=rows.at(-1);return {runId,lastText:last?.textContent||'',running:!!document.querySelector('button[aria-label="停止侧边聊天"]'),draftEvents:events.filter(event=>event.runId===runId&&event.type==='draft').map(event=>({sequence:event.sequence,time:event.time,textLength:event.text?.length||0})),events:events.filter(event=>event.runId===runId).map(event=>({type:event.type,label:event.label,status:event.status,sequence:event.sequence,time:event.time}))};})()`);
        if(liveState.lastText.includes('QA_LONG_CHUNK'))visibleAt=Date.now();
        else await new Promise(resolve=>setTimeout(resolve,50));
      }
      const streamingTiming={firstChunkAt:firstChunk.time,firstChunkReceivedAt:new Date(firstChunkReceivedAt).toISOString(),firstChunkLatencyMs:firstChunkReceivedAt-longStartedAt,
        visibleAt:visibleAt?new Date(visibleAt).toISOString():null,firstVisibleLatencyMs:visibleAt?visibleAt-firstChunkReceivedAt:null,liveState};
      await writeFile(path.join(evidence,'side-stream-timing.json'),JSON.stringify(streamingTiming,null,2));
      if(!visibleAt||!liveState?.running){
        await ui.screenshot(path.join(evidence,'side-stream-prefix-not-visible.png'));
        await recordFinding(visibleAt?'侧边聊天首个正文块仅在运行状态结束后出现':'侧边聊天首个流式正文块抵达后 5 秒内仍未显示',streamingTiming);
      }else{
        await record('侧边聊天首个流式正文块在任务仍运行时及时显示',streamingTiming);
      }
      await ui.click('停止侧边聊天');
      await ui.waitFor('!document.querySelector("button[aria-label=停止侧边聊天]")', 30000);
      ownsRun = false;
      await saveSettled();
      saved = await workspace();
      const stopped = saved.chats.find(chat => chat.id === sideId).messages.at(-1);
      assert.equal(stopped.stopped, true);
      assert.match(stopped.text, /QA_LONG_CHUNK/);
      const longRequest = requestRows(longCursor)[0];
      assert(longRequest);
      assert(services.snapshot().records.some(row => row.event === 'aborted' && row.requestNumber === longRequest.requestNumber));
      await record('侧边聊天停止等待真实流关闭并保留部分正文', { sideId, answer: stopped, request: longRequest });

      currentStep = 'side provider change isolation';
      const providerB = await chooseProvider(providerNames.b);
      await openPanel('chat');
      await ui.fill('select[aria-label="选择侧边聊天"]', sideId);
      const providerCursor = services.snapshot().sequence;
      await ui.fill(sideInput, `QA_NORMAL ${runId} SIDE_PROVIDER_B_REQUEST`);
      await ui.waitFor('!document.querySelector(".toast")',10000);
      await ui.waitFor('!document.querySelector(".toast")',10000);
      await ui.click('发送侧边聊天');
      ownsRun = true;
      await ui.waitFor('!document.querySelector("button[aria-label=停止侧边聊天]") && document.querySelector(".side-chat-assistant")?.textContent.includes("SIDE_PROVIDER_B_REQUEST")', 90000);
      ownsRun = false;
      const newSideId = await value('select[aria-label="选择侧边聊天"]');
      assert.notEqual(newSideId, sideId);
      await saveSettled();
      saved = await workspace();
      assert.equal(saved.chats.find(chat => chat.id === newSideId).providerId, providerB);
      assert.equal(saved.chats.find(chat => chat.id === sideId).providerId, providerA);
      const secondProviderRequests = requestRows(providerCursor);
      assert(secondProviderRequests.length > 0);
      assert(secondProviderRequests.every(row => row.path === '/conversation-b/v1/chat/completions'));
      assert(secondProviderRequests.every(row => !/SIDE_HISTORY_ONLY|QA_SIDE_ATTACHMENT_CONTENT|MAIN_HISTORY_ONLY/.test(wireText(row))));
      await ui.screenshot(path.join(evidence, 'side-provider-isolated.png'));
      await record('侧边聊天切换同名模型供应商后新建会话，原历史不发给新目的地', { oldSideId: sideId, newSideId, providerA, providerB, requests: secondProviderRequests });
    }
    currentStep = 'journey findings';
    assert.equal(findings.length, 0, findings.map(finding => finding.name).join('；'));
    completed = true;
  } catch (error) {
    records.push({ name: currentStep, status: 'failed', time: new Date().toISOString(), error: error.stack });
    if (ui) await ui.screenshot(path.join(evidence, 'failure.png')).catch(() => {});
    throw error;
  } finally {
    if (ui) {
      if (ownsRun) {
        const sideStop = await ui.evaluate('!!document.querySelector("button[aria-label=停止侧边聊天]")').catch(() => false);
        await ui.click(sideStop ? '停止侧边聊天' : '停止生成').catch(() => {});
        await ui.waitFor('!document.querySelector("button[aria-label=停止生成],button[aria-label=停止侧边聊天]")', 30000).catch(() => {});
      }
      const captured = await ui.evaluate('(()=>{window.__conversationQaUnsubscribe?.();return window.__conversationQaEvents||[];})()').catch(() => []);
      runtimeEvents.push(...captured);
      if (await ui.evaluate('!!document.querySelector(".modal")').catch(() => false)) await ui.click('关闭对话框').catch(() => {});
      const saved = await workspace().catch(() => null);
      if (saved) await writeFile(path.join(evidence, 'synthetic-chats-and-drafts.json'), JSON.stringify({
        chats: saved.chats.filter(chat => chat.messages.some(message => message.text?.includes(runId)) || chat.id === mainChatId),
        drafts: Object.fromEntries(Object.entries(saved.drafts || {}).filter(([, draft]) => draft.text?.includes(runId) || draft.files?.some(file => file.name?.includes(runId)))),
      }, null, 2));
      if(clipboardPermissionSetup){
        try{
          clipboardPermissionSetup.resetResult=await ui.send('Browser.resetPermissions');
          clipboardPermissionSetup.afterReset=await ui.evaluate(`(async()=>({write:(await navigator.permissions.query({name:'clipboard-write'})).state,read:(await navigator.permissions.query({name:'clipboard-read'})).state}))()`)
            .catch(error=>({queryError:error.message}));
        }catch(error){clipboardPermissionSetup.resetError=error.message;}
        await writeFile(path.join(evidence,'clipboard-permission-setup.json'),JSON.stringify(clipboardPermissionSetup,null,2));
      }
      ui.close();
    }
    main?.close();
    await services.close();
    await writeFile(path.join(evidence, 'journey.json'), JSON.stringify({ ...baseline, phase, status: completed ? 'passed' : 'failed', rendererPort: port, records }, null, 2));
    await writeFile(path.join(evidence, 'model-requests.json'), JSON.stringify(services.snapshot(), null, 2));
    await writeFile(path.join(evidence, 'runtime-events.json'), JSON.stringify(runtimeEvents, null, 2));
    console.log(`${completed ? 'PASS' : 'FAIL'} App conversation journey ${evidence}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') return usage();
  if (args.length === 1 && args[0] === '--check-fixtures') return checkFixtures();
  assert(args.length === 0 || args.length === 2 && args[0] === '--phase', 'Use --help for supported arguments.');
  return runJourney(args[1] || 'all');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}

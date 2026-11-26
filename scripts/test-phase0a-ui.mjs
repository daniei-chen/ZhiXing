// Windows directory-package regression: real Electron UI + real Harness tools,
// with a loopback-only, deterministic model fixture. No assistant message,
// trace, changed-file record or deliverable is injected into the workspace.
// Screenshots are evidence for subsequent human review, not pixel acceptance.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { connectUi } from './qa-cdp.mjs';

assert.equal(
  process.platform,
  'win32',
  'This gate requires a Windows packaged EXE; it cannot pass on another platform.',
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exe = path.resolve(process.argv[2] || 'release/win-unpacked/知行.exe');
const provenance = JSON.parse(
  await fs.readFile(path.join(path.dirname(exe), 'resources/app/build-provenance.json'), 'utf8'),
);
const evidenceRoot = path.resolve(
  process.env.ZHIXING_QA_EVIDENCE || `.preview/qa-${provenance.version}/phase0a-ui`,
);
await fs.mkdir(evidenceRoot, { recursive: true });
const evidence = await fs.mkdtemp(path.join(evidenceRoot, 'phase0a-ui-'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-phase0a-ui-'));
const profile = path.join(temporary, 'profile');
const projectDirectory = path.join(temporary, 'project');
const appLog = path.join(temporary, 'app.log');
const input = 'textarea[aria-label="聊天输入框"]';
const projectId = 'qa-phase0a-project';
const workspaceId = 'qa-phase0a-workspace';
const conversationId = 'qa-phase0a-chat';
const model = 'qa-phase0a-model';
const finalText = '两份工作记录已写入项目目录。\n\n请查看下方的改动摘要和交付文件。';
const files = [
  {
    path: '工作记录甲.md',
    content: '# 工作记录甲\n\n第一项已完成。\n第二项待复核。',
    description: '第一份工作记录',
  },
  {
    path: '工作记录乙.md',
    content: '# 工作记录乙\n\n本轮验收记录。',
    description: '第二份工作记录',
  },
];
const calls = [
  ...files.map((file, index) => ({
    id: `call-qa-phase0a-write-${index + 1}`,
    name: 'write',
    arguments: { file_path: file.path, content: file.content },
  })),
  {
    id: 'call-qa-phase0a-present',
    name: 'present',
    arguments: {
      files: files.map(({ path: filePath, description }) => ({ path: filePath, description })),
    },
  },
];
const chats = [
  { id: conversationId, title: 'QA 项目聊天', projectId },
  { id: 'qa-phase0a-pinned', title: 'QA 置顶项目聊天', projectId, pinned: true },
  { id: 'qa-phase0a-independent', title: 'QA 独立聊天', projectId: null },
  { id: 'qa-phase0a-orphan', title: 'QA 旧项目聊天', projectId: 'qa-missing-project' },
].map((chat, index) => ({
  ...chat,
  workspaceId,
  archived: false,
  messages: [],
  createdAt: Date.now() + index,
  updatedAt: Date.now() + index,
}));
const report = {
  layer: 'windows-packaged-app + real-harness + loopback model fixture',
  version: provenance.version,
  sourceCommit: provenance.sourceCommit,
  sourceDirty: provenance.sourceDirty,
  startedAt: new Date().toISOString(),
  runner: {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    node: process.version,
  },
  status: 'running',
  cases: [],
  screenshots: [],
  providerRequests: [],
  visualReview: 'pending-human-review',
  boundaries: [
    'Model responses are deterministic fixtures, not a real cloud/model-quality evaluation.',
    'Project and empty-chat metadata are seeded through the real desktop IPC in an isolated profile.',
    'Files, tool events, assistant text, change summaries and delivery references come from the real Harness run.',
    'Full workspace permission is selected; native approval dialogs are not exercised or replaced.',
    'DOM order, geometry, computed styles and controls are asserted; screenshots still require human visual review.',
    'No installer, upgrade, user installation, Windows shortcut or cross-account migration is exercised.',
    'No legacy trace, >400-event truncation, long conversation or production provider coverage is claimed.',
  ],
};
const persist = () =>
  fs.writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
let currentCase = 'initialization';
async function check(name, action) {
  currentCase = name;
  const details = await action();
  report.cases.push({ name, status: 'passed', ...(details || {}) });
  await persist();
  console.log(`PASS ${name}`);
}

let fixtureError;
const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          data: [{ id: model, name: 'QA 界面验收模型', input_modalities: ['text'] }],
        }),
      );
      return;
    }
    assert.equal(request.url, '/v1/chat/completions', 'Unexpected fixture endpoint');
    assert.equal(request.method, 'POST');
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert.ok(body.length <= 2 * 1024 * 1024, 'Fixture request exceeds its bounded test scope');
    }
    const payload = JSON.parse(body);
    assert.equal(payload.model, model);
    assert.equal(payload.stream, true);
    const results = payload.messages.filter((message) => message.role === 'tool');
    assert.deepEqual(
      results.map((message) => message.tool_call_id),
      calls.slice(0, results.length).map((call) => call.id),
    );
    assert.ok(results.length <= calls.length, 'Unexpected extra tool result');
    for (const name of ['write', 'present'])
      assert.ok(
        payload.tools?.some((tool) => tool.function?.name === name),
        `${name} is not advertised by the real kernel`,
      );
    report.providerRequests.push({
      step: results.length,
      toolResults: results.length,
      nextTool: calls[results.length]?.name || null,
    });
    const base = {
      id: 'chatcmpl-qa-phase0a',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
    };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const write = (delta, finishReason = null) =>
      response.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`,
      );
    write({ role: 'assistant' });
    const call = calls[results.length];
    if (call) {
      write({
        tool_calls: [
          {
            index: 0,
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          },
        ],
      });
      write({}, 'tool_calls');
    } else {
      write({ content: finalText });
      write({}, 'stop');
    }
    response.end('data: [DONE]\n\n');
  } catch (error) {
    fixtureError ||= String(error?.message || error);
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'QA fixture contract failed' } }));
  }
});

let ui,
  main,
  child,
  log,
  closed,
  childClosed = false,
  childError;
async function capture(name) {
  const file = path.join(evidence, `${name}.png`);
  const result = await ui.screenshot(file);
  assert.equal(result.status, 'captured', `Screenshot ${name} must be captured, not skipped`);
  const bytes = await fs.readFile(file);
  assert.equal(
    bytes.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    'Screenshot must be a PNG',
  );
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  assert.ok(
    width >= 800 && height >= 600,
    'Screenshot must retain a readable application viewport',
  );
  report.screenshots.push({
    file: path.basename(file),
    bytes: bytes.length,
    sha256: hash(bytes),
    width,
    height,
    visualReview: 'pending-human-review',
  });
  await persist();
}
async function ready() {
  await ui.waitFor(
    `document.querySelector(${JSON.stringify(input)}) && !document.querySelector(${JSON.stringify(input)}).disabled`,
    60000,
  );
  await ui.waitFor(
    `document.querySelector('.workspace-save-banner')?.dataset.saveStatus === 'saved'`,
    15000,
  );
}
async function reload() {
  await ui.send('Page.reload');
  await ready();
}
async function windowSize(width, height) {
  const observed = await main.evaluate(`(()=>{
    const electron=process.mainModule.require('electron');
    const window=electron.BrowserWindow.getAllWindows()[0];
    if(window.isMinimized())window.restore();
    window.webContents.setZoomFactor(1);window.setContentSize(${width},${height});window.showInactive();
    return {size:window.getContentSize(),zoom:window.webContents.getZoomFactor()};
  })()`);
  await pause(200);
  return observed;
}
async function selectChat(id) {
  const selector = `.chat-row[data-chat-id="${id}"] .chat-link`;
  const title = await ui.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.textContent.trim()`,
  );
  assert.ok(title, `Chat ${id} has no visible entry`);
  await ui.click(title, selector);
  await ui.waitFor(
    `document.querySelector('.chat-row[data-chat-id="${id}"] .chat-link')?.getAttribute('aria-current') === 'page'`,
  );
  await ready();
}
async function savedMessage() {
  return ui.evaluate(`(async()=>{
    const workspace=await window.zhixing.loadWorkspace();
    const chat=workspace.chats.find(item=>item.id===${JSON.stringify(conversationId)});
    const message=chat?.messages.findLast(item=>item.role==='assistant');
    return message ? {id:message.id,text:message.text,pending:message.pending,error:message.error,
      trace:message.trace,traceTruncated:message.traceTruncated,changes:message.changes,
      deliverableCount:message.deliverables?.length,finalization:message.finalization} : null;
  })()`);
}
async function messageLayout() {
  return ui.evaluate(`(()=>{
    const article=document.querySelector('.assistant-message');
    if(!article)throw Error('No real assistant message');
    article.scrollIntoView({block:'start'});
    const selectors=['.tool-strip','.answer-text','.change-files','.deliverable-files','.run-summary','.answer-actions'];
    const elements=selectors.map(selector=>article.querySelector(selector));
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const rows=selectors.map((selector,index)=>({selector,rect:elements[index]?rect(elements[index]):null}));
    const ordered=elements.every((node,index)=>node && (!index || !!(elements[index-1].compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING)));
    const icon=article.querySelector('.assistant-icon img');
    return {ordered,rows,summary:article.querySelector('.tool-strip summary')?.textContent.trim(),
      toolRows:[...article.querySelectorAll('.tool-strip li')].map(node=>({label:node.querySelector('span')?.textContent,status:node.dataset.status})),
      changes:Number(article.querySelector('.change-files')?.dataset.count),deliverables:Number(article.querySelector('.deliverable-files')?.dataset.count),
      body:article.querySelector('.answer-text')?.innerText,icon:{src:icon?.getAttribute('src'),loaded:!!icon?.complete&&icon.naturalWidth>0}};
  })()`);
}
function assertLayout(layout) {
  assert.equal(
    layout.ordered,
    true,
    'Tool summary, body, changes, deliveries and actions must retain reading order',
  );
  for (const row of layout.rows)
    assert.ok(row.rect?.width > 0 && row.rect.height > 0, `${row.selector} must render`);
  const baseline = layout.rows[0].rect.left;
  for (const row of layout.rows)
    assert.ok(
      Math.abs(row.rect.left - baseline) <= 1.5,
      `${row.selector} diverged from the shared left baseline`,
    );
  for (let index = 1; index < layout.rows.length; index += 1)
    assert.ok(
      layout.rows[index].rect.top >= layout.rows[index - 1].rect.bottom - 1,
      'Message sections must not overlap or reverse visually',
    );
  assert.equal(layout.summary, '3 次工具调用');
  assert.equal(layout.toolRows.length, 3, 'call and result must not render as six calls');
  assert.deepEqual(
    layout.toolRows.map((row) => row.status),
    ['completed', 'completed', 'completed'],
  );
  assert.equal(layout.changes, 2);
  assert.equal(layout.deliverables, 2);
  assert.equal(layout.body, finalText);
  assert.equal(layout.icon.loaded, true);
  assert.ok(layout.icon.src.endsWith('/brand/zhixing-bamboo.png'));
}

console.log(`Evidence: ${evidence}`);
try {
  await fs.mkdir(profile);
  await fs.mkdir(projectDirectory);
  report.exeSha256 = hash(await fs.readFile(exe));
  assert.equal(
    provenance.sourceDirty,
    false,
    'Package provenance must refer to a clean source snapshot',
  );
  await persist();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  log = await fs.open(appLog, 'a');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  child = spawn(
    exe,
    [
      `--user-data-dir=${profile}`,
      '--inspect=127.0.0.1:0',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
    ],
    { cwd: temporary, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true },
  );
  child.on('error', (error) => {
    childError = error;
  });
  closed = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      childClosed = true;
      report.processExit = { code, signal };
      resolve();
    }),
  );
  const startDeadline = Date.now() + 60000;
  while ((!ui || !main) && Date.now() < startDeadline) {
    if (childError) throw childError;
    assert.equal(childClosed, false, 'Packaged application exited before attaching');
    if (!ui) {
      const ports = await fs
        .readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
        .catch(() => '');
      if (ports) ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
    }
    if (!main) {
      const output = await fs.readFile(appLog, 'utf8').catch(() => '');
      const port = output.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
      if (port) main = await connectUi(Number(port), true).catch(() => null);
    }
    if (!ui || !main) await pause(100);
  }
  assert.ok(ui && main, 'Both real packaged renderer and main process must be reachable');
  await ready();
  await check('packaged EXE uses only the isolated QA profile', async () => {
    const identity = await main.evaluate(
      `(()=>{const {app}=process.mainModule.require('electron');return {packaged:app.isPackaged,version:app.getVersion(),profile:app.getPath('userData'),exe:process.execPath,versions:{electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node}};})()`,
    );
    assert.equal(identity.packaged, true);
    assert.equal(identity.version, provenance.version);
    assert.equal(path.resolve(identity.profile), path.resolve(profile));
    assert.equal(path.resolve(identity.exe), exe);
    return {
      version: identity.version,
      packaged: identity.packaged,
      isolatedProfile: true,
      versions: identity.versions,
      viewport: await windowSize(1255, 912),
    };
  });
  await ui.evaluate(`(async()=>{
    await window.zhixing.saveProvider(${JSON.stringify({ name: 'QA Phase0A 服务', protocol: 'openai', baseUrl, apiKey: 'sk-qa-phase0a-00000000000', reasoningStyle: 'standard', discover: true })});
    const status=await window.zhixing.runtimeStatus();
    const provider=status.providers.find(item=>item.name==='QA Phase0A 服务');
    if(!provider)throw Error('Fixture provider was not saved');
    const state=await window.zhixing.loadWorkspace();
    state.workspaces.push({id:${JSON.stringify(workspaceId)},name:'QA 界面工作区',type:'office',directory:${JSON.stringify(projectDirectory)},projectId:${JSON.stringify(projectId)}});
    state.projects.push({id:${JSON.stringify(projectId)},workspaceId:${JSON.stringify(workspaceId)},name:'QA 界面项目',directory:${JSON.stringify(projectDirectory)},instructions:'',expanded:true});
    state.chats.push(...${JSON.stringify(chats)});state.workspaceId=${JSON.stringify(workspaceId)};
    state.settings={...state.settings,theme:'light',demo:false,modelProviderId:provider.id,model:${JSON.stringify(model)},reasoning:'low',permission:'full',privacyMode:'redact'};
    await window.zhixing.saveWorkspace(state);return true;
  })()`);
  await reload();
  await check(
    'project, pinned, independent and orphan chats each have one selectable entry',
    async () => {
      const rows = await ui.evaluate(`(()=>{
      const recent=document.getElementById(document.querySelector('.sidebar-section-toggle')?.getAttribute('aria-controls'));
      return ${JSON.stringify(chats.map((chat) => chat.id))}.map(id=>{
        const matches=[...document.querySelectorAll('.chat-row')].filter(node=>node.dataset.chatId===id);
        return {id,count:matches.length,group:matches[0]?.closest('.pinned-chats')?'pinned':matches[0]?.closest('.project-chats')?'project':recent?.contains(matches[0])?'recent':'missing'};
      });
    })()`);
      assert.deepEqual(
        rows.map((row) => row.count),
        [1, 1, 1, 1],
      );
      assert.deepEqual(
        rows.map((row) => row.group),
        ['project', 'pinned', 'recent', 'recent'],
      );
      for (const chat of chats) {
        await selectChat(chat.id);
        const selected = await ui.evaluate(
          `[...document.querySelectorAll('.chat-row.selected')].map(node=>node.dataset.chatId)`,
        );
        assert.deepEqual(selected, [chat.id], 'Active chat must be highlighted only once');
      }
      const orphan = await ui.evaluate(
        `(async()=>{const state=await window.zhixing.loadWorkspace();return state.chats.find(item=>item.id==='qa-phase0a-orphan')?.projectId;})()`,
      );
      assert.equal(orphan, 'qa-missing-project', 'Rendering must not rewrite orphan ownership');
      await selectChat(conversationId);
      return { rows };
    },
  );
  await ui.fill(input, '请写入两份工作记录，并把文件交付给我。');
  await ui.click('发送消息', 'button.send-button');
  await ui.waitFor(
    `document.querySelector('.assistant-message .deliverable-files')?.dataset.count === '2' && !document.querySelector('.thinking-label') && document.querySelector('button.send-button')?.getAttribute('aria-label') === '发送消息'`,
    180000,
  );
  await ready();
  await check(
    'real Harness writes and presents both files and retains three linked calls',
    async () => {
      assert.equal(fixtureError, undefined, fixtureError);
      assert.deepEqual(
        report.providerRequests.map((request) => request.step),
        [0, 1, 2, 3],
      );
      for (const file of files)
        assert.equal(
          await fs.readFile(path.join(projectDirectory, file.path), 'utf8'),
          file.content,
        );
      const message = await savedMessage();
      assert.ok(
        message && !message.pending && !message.error,
        'The saved real assistant message must finish successfully',
      );
      assert.equal(message.text, finalText);
      const starts = message.trace.filter((event) => event.type === 'tool/call');
      const results = message.trace.filter((event) => event.type === 'tool/result');
      assert.equal(starts.length, 3);
      assert.equal(results.length, 3);
      assert.equal(new Set(starts.map((event) => event.callId)).size, 3);
      assert.ok(
        starts.every(
          (event) =>
            event.callId &&
            results.some(
              (result) => result.callId === event.callId && result.status === 'completed',
            ),
        ),
      );
      assert.equal(message.deliverableCount, 2);
      assert.equal(message.changes.length, 2);
      assert.notEqual(
        message.finalization?.processStatus,
        'cleanup_pending',
        'Kernel cleanup must not remain pending',
      );
      return {
        files: files.map((file) => ({ name: file.path, sha256: hash(file.content) })),
        calls: starts.length,
        results: results.length,
        linkedCalls: 3,
      };
    },
  );
  await check(
    'body precedes changes and deliverables; all assistant sections share a baseline',
    async () => {
      const layout = await messageLayout();
      assertLayout(layout);
      await capture('01-message-light');
      return { layout };
    },
  );
  await check('tool steps expand as three completed styled rows', async () => {
    await ui.click('3 次工具调用', '.tool-strip summary');
    const styles = await ui.evaluate(
      `(()=>({open:document.querySelector('.tool-strip')?.open,rows:[...document.querySelectorAll('.tool-strip li')].map(node=>{const style=getComputedStyle(node);return {borderStyle:style.borderTopStyle,borderWidth:style.borderTopWidth,background:style.backgroundColor,height:node.getBoundingClientRect().height};})}))()`,
    );
    assert.equal(styles.open, true);
    assert.equal(styles.rows.length, 3);
    for (const row of styles.rows) {
      assert.ok(row.height > 0 && parseFloat(row.borderWidth) > 0);
      assert.notEqual(row.borderStyle, 'none');
      assert.notEqual(row.background, 'rgba(0, 0, 0, 0)');
      assert.notEqual(row.background, 'transparent');
    }
    await capture('02-tools-expanded');
    await ui.click('3 次工具调用', '.tool-strip summary');
    return styles;
  });
  await check(
    'reload preserves real message order, linked tool count and sidebar ownership',
    async () => {
      await reload();
      await selectChat(conversationId);
      const layout = await messageLayout();
      assertLayout(layout);
      assert.equal(
        await ui.evaluate(
          `document.querySelectorAll('.chat-row[data-chat-id="${conversationId}"]').length`,
        ),
        1,
      );
      return { summary: layout.summary, toolRows: layout.toolRows.length };
    },
  );
  await check('feedback over 8192 bytes disables save while Clear remains usable', async () => {
    const requestsBefore = report.providerRequests.length;
    await ui.click('赞这条回复', '.answer-actions button');
    await ui.fill('textarea[aria-label="反馈备注"]', '工作记录验收备注');
    await ui.click('保存反馈', '.feedback-actions button');
    await ui.waitFor(
      `!!document.querySelector('.feedback-recorded') && !document.querySelector('.feedback-panel')`,
    );
    assert.equal((await ui.evaluate('window.zhixing.loadFeedback()')).entries.length, 1);
    await ui.click('赞这条回复', '.answer-actions button');
    await ui.fill('textarea[aria-label="反馈备注"]', '审'.repeat(3000));
    const state = await ui.evaluate(
      `(()=>{const buttons=[...document.querySelectorAll('.feedback-actions button')];return {counter:document.querySelector('.feedback-count')?.textContent,over:document.querySelector('.feedback-count')?.classList.contains('over'),saveDisabled:buttons.find(node=>node.textContent==='保存反馈')?.disabled,clearDisabled:buttons.find(node=>node.textContent==='清除')?.disabled};})()`,
    );
    assert.equal(state.over, true);
    assert.match(state.counter, /9,?000\s*\/\s*8192/);
    assert.equal(state.saveDisabled, true);
    assert.equal(state.clearDisabled, false);
    await ui.evaluate(
      `document.querySelector('.feedback-actions').scrollIntoView({block:'nearest'}); true`,
    );
    await capture('03-feedback-over-limit');
    await ui.click('清除', '.feedback-actions button');
    await ui.waitFor(
      `!document.querySelector('.feedback-panel') && !document.querySelector('.feedback-recorded')`,
    );
    assert.equal((await ui.evaluate('window.zhixing.loadFeedback()')).entries.length, 0);
    assert.equal(
      report.providerRequests.length,
      requestsBefore,
      'Feedback must not run another model request',
    );
    return state;
  });
  await check(
    'failed file action shows a persistent top toast without covering long input controls',
    async () => {
      await fs.rm(path.join(projectDirectory, files[1].path));
      await ui.click(`${files[1].path}的文件操作`, '.deliverable-actions');
      await ui.click('在文件管理器中显示', '.file-action-menu button');
      await ui.waitFor(
        `document.querySelector('.toast.error')?.textContent.includes('找不到这个文件的位置')`,
      );
      await ui.fill(
        input,
        Array.from(
          { length: 14 },
          (_, index) => `第 ${index + 1} 行：这是尚未发送的输入区验收内容。`,
        ).join('\n'),
      );
      const geometry = await ui.evaluate(`(()=>{
      const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const toast=document.querySelector('.toast.error');
      const controls=['.composer',${JSON.stringify(input)},'.model-trigger','button.send-button'].map(selector=>{const node=document.querySelector(selector);if(!node)throw Error('Missing '+selector);return {selector,rect:rect(node)};});
      const button=document.querySelector('button.send-button'),r=button.getBoundingClientRect();
      return {toast:rect(toast),toastPosition:getComputedStyle(toast).position,controls,sendReachable:button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),inputLines:document.querySelector(${JSON.stringify(input)}).value.split('\n').length};
    })()`);
      assert.equal(geometry.toastPosition, 'fixed');
      assert.equal(geometry.inputLines, 14);
      for (const { selector, rect } of geometry.controls) {
        assert.ok(rect.width > 0 && rect.height > 0, `${selector} must be visible`);
        const overlap =
          Math.min(rect.right, geometry.toast.right) > Math.max(rect.left, geometry.toast.left) &&
          Math.min(rect.bottom, geometry.toast.bottom) > Math.max(rect.top, geometry.toast.top);
        assert.equal(overlap, false, `Error toast overlaps ${selector}`);
      }
      assert.equal(geometry.sendReachable, true, 'Send control must remain hit-testable');
      await capture('04-error-toast-long-input');
      await ui.fill(input, '短输入仍可编辑。');
      await capture('05-error-toast-short-input');
      await ui.click('关闭错误提示', '.toast-dismiss');
      await ui.waitFor(`!document.querySelector('.toast.error')`);
      await ui.fill(input, '');
      return { geometry };
    },
  );
  await check(
    'actual dark appearance keeps the assistant baseline at a narrower window',
    async () => {
      await ui.click('打开设置');
      await ui.click('外观', '.settings-nav button');
      await ui.click('深色', '.theme-choices button');
      await ui.click('返回工作台');
      await ui.waitFor(`!!document.querySelector('.app-shell.dark')`);
      const viewport = await windowSize(950, 912);
      const layout = await messageLayout();
      assertLayout(layout);
      await capture('06-message-dark-narrow');
      return {
        viewport,
        baseline: layout.rows.map((row) => ({ selector: row.selector, left: row.rect.left })),
      };
    },
  );
  assert.equal(fixtureError, undefined, fixtureError);
  assert.equal(report.providerRequests.length, 4, 'UI actions must not make extra model requests');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.stack || error).slice(0, 12000);
  report.cases.push({
    name: currentCase,
    status: 'failed',
    error: String(error?.message || error).slice(0, 4000),
  });
  if (ui) {
    try {
      await capture('failure');
    } catch (captureError) {
      report.failureScreenshotError = String(captureError?.message || captureError);
    }
  }
  console.error(`FAIL ${currentCase}: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  // Disconnect the main inspector before closing Electron, otherwise Node may
  // wait for the debugger and prevent an otherwise graceful process exit.
  main?.close();
  if (ui && !childClosed) {
    try {
      await ui.evaluate(`window.zhixing.windowControl('close'); true`);
    } catch {
      /* target may close before replying */
    }
  }
  ui?.close();
  if (child && !childClosed) await Promise.race([closed, pause(8000)]);
  if (child && !childClosed) {
    report.forcedProcessCleanup = true;
    try {
      await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 10000,
      });
    } catch (error) {
      report.processCleanupError = String(error?.message || error).slice(0, 1000);
    }
    await Promise.race([closed, pause(5000)]);
  }
  await log?.close();
  try {
    const output = await fs.readFile(appLog);
    await fs.writeFile(
      path.join(evidence, 'app-log-tail.txt'),
      output.subarray(Math.max(0, output.length - 128 * 1024)),
    );
  } catch {
    /* The launcher may fail before opening its log. */
  }
  report.cleanup = { processExited: !child || childClosed, temporaryRemoved: false };
  if (!child || childClosed) {
    try {
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      report.cleanup.temporaryRemoved = true;
    } catch (error) {
      report.cleanup.error = String(error?.message || error).slice(0, 1000);
    }
  }
  const abnormalExit =
    child && (report.processExit?.code !== 0 || report.processExit?.signal !== null);
  if (
    !report.cleanup.processExited ||
    !report.cleanup.temporaryRemoved ||
    report.forcedProcessCleanup ||
    abnormalExit
  ) {
    report.status = 'failed';
    process.exitCode = 1;
    report.cases.push({
      name: 'isolated application and temporary data cleanup',
      status: 'failed',
      ...report.cleanup,
      forcedProcessCleanup: Boolean(report.forcedProcessCleanup),
      processExit: report.processExit,
    });
  }
  report.fixtureError = fixtureError || null;
  report.finishedAt = new Date().toISOString();
  await persist();
  console.log(
    JSON.stringify({
      status: report.status,
      passed: report.cases.filter((item) => item.status === 'passed').length,
      failed: report.cases.filter((item) => item.status === 'failed').length,
      screenshots: report.screenshots.length,
      visualReview: report.visualReview,
      evidence,
    }),
  );
}

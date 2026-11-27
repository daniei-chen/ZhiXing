// Windows packaged EXE + real Harness write/present + a loopback model fixture.
// Only empty project/chat metadata and provider configuration are seeded. The
// signed delivery references, file reads and UI state all come from production.
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
import { selectWorkbenchTab, workbenchTablist } from './qa-workbench.mjs';

assert.equal(process.platform, 'win32', 'This gate requires a Windows packaged EXE.');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expression = (fn, ...args) =>
  `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`;
const exe = path.resolve(process.argv[2] || 'release/win-unpacked/知行.exe');
const provenance = JSON.parse(
  await fs.readFile(path.join(path.dirname(exe), 'resources/app/build-provenance.json'), 'utf8'),
);
const evidenceRoot = path.resolve(
  process.env.ZHIXING_QA_EVIDENCE || `.preview/qa-${provenance.version}/workbench-preview`,
);
await fs.mkdir(evidenceRoot, { recursive: true });
const evidence = await fs.mkdtemp(path.join(evidenceRoot, 'workbench-preview-ui-'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-workbench-preview-ui-'));
const profile = path.join(temporary, 'profile');
const projectDirectory = path.join(temporary, 'project');
const appLog = path.join(temporary, 'app.log');
const input = 'textarea[aria-label="聊天输入框"]';
const preview = '.delivery-preview[aria-label="交付文件预览"]';
const workspaceId = 'qa-workbench-workspace';
const projectId = 'qa-workbench-project';
const chatId = 'qa-workbench-chat';
const otherChatId = 'qa-workbench-other';
const model = 'qa-workbench-model';
const files = [
  {
    path: '季度纪要.md',
    content: '# 季度纪要\n\n办公材料已经归档。请核对责任分工，再安排后续复核。',
    description: '本轮会议纪要',
  },
  {
    path: '年度资料.md',
    content: `# 年度资料\n\n${'年度资料需按项目逐项核对，保留原始记录并整理归档。\n'.repeat(650)}资料末尾验收标记。`,
    description: '超过预览上限的年度资料',
  },
];
const finalText = '两份材料已完成。请查看 `季度纪要.md` 和 `年度资料.md`。';
const draftText = '预览文件时继续补充交办草稿，不立即发送。';
const pages = [
  ['browser', '浏览器'],
  ['files', '文件'],
  ['terminal', '终端'],
  ['chat', '侧边聊天'],
  ['activity', '执行'],
  ['review', '改动'],
  ['deliverables', '产出'],
  ['stats', '统计'],
  ['details', '详情'],
];
const calls = [
  ...files.map((file, index) => ({
    id: `qa-workbench-write-${index + 1}`,
    name: 'write',
    arguments: { file_path: file.path, content: file.content },
  })),
  {
    id: 'qa-workbench-present',
    name: 'present',
    arguments: {
      files: files.map((file) => ({ path: file.path, description: file.description })),
    },
  },
];
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
    'Empty project/chat metadata and provider configuration are seeded through real desktop IPC in an isolated temporary profile.',
    'A loopback provider drives actual Harness write/present tools; no assistant message, delivery reference or preview response is injected.',
    'Full workspace permission is selected; native approval dialogs are not exercised or replaced.',
    'Preview covers the existing safe extracted-text path and its 12,000-character display limit, not Office page layout or image preview.',
    'A temporary fixture file is moved away and restored to exercise a real file-unavailable error and retry; no production IPC is replaced.',
    'Browser and terminal tabs retain their real existing panels. This gate does not navigate a website or execute a terminal command.',
    'Keyboard, selected tabs, visible panels, draft input and geometry are asserted; screenshots require separate visual review.',
    'Chat switching checks scope isolation without injecting a delayed response. Delayed-response races are covered separately by component tests.',
    'No installer, upgrade, real cloud model quality, user installation, signing or cross-account migration is exercised.',
  ],
};
const persist = () =>
  fs.writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
let ui;
let main;
let child;
let log;
let closed;
let childClosed = false;
let childError;
let fixtureError;
let currentCase = 'initialization';
const evaluate = (fn, ...args) => ui.evaluate(expression(fn, ...args));
async function until(action, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fixtureError) throw new Error(fixtureError);
    if (childError) throw childError;
    const value = await action();
    if (value) return value;
    await pause(80);
  }
  throw new Error(`Timeout: ${label}`);
}
async function check(name, action) {
  currentCase = name;
  const startedAt = new Date().toISOString();
  const details = await action();
  report.cases.push({
    name,
    status: 'passed',
    startedAt,
    finishedAt: new Date().toISOString(),
    ...details,
  });
  await persist();
  console.log(`PASS ${name}`);
}
async function ready() {
  await until(
    () =>
      evaluate((selector) => {
        const field = document.querySelector(selector);
        return (
          field &&
          !field.disabled &&
          document.querySelector('.workspace-save-banner')?.dataset.saveStatus === 'saved'
        );
      }, input),
    'interactive composer and saved workspace',
    60000,
  );
}
async function reloadReady() {
  const before = await evaluate(() => performance.timeOrigin);
  await ui.send('Page.reload');
  await until(
    async () => {
      try {
        return await evaluate(
          (origin) => performance.timeOrigin !== origin && document.readyState === 'complete',
          before,
        );
      } catch (error) {
        if (
          /Execution context was destroyed|Cannot find context with specified id/.test(
            error.message,
          )
        )
          return false;
        throw error;
      }
    },
    'new renderer document',
    60000,
  );
  await ready();
}
async function selectChat(id) {
  const selector = `.chat-row[data-chat-id="${id}"] .chat-link`;
  const label = await until(
    () =>
      evaluate((value) => {
        const node = document.querySelector(value);
        return node?.getClientRects().length ? node.textContent.trim() : false;
      }, selector),
    'visible saved chat',
  );
  await ui.click(label, selector);
  await until(
    () =>
      evaluate(
        (value) => document.querySelector(value)?.getAttribute('aria-current') === 'page',
        selector,
      ),
    'selected chat',
  );
  await ready();
}
async function clickControl(selector) {
  const label = await evaluate((value) => {
    const node = document.querySelector(value);
    if (!node) throw Error(`Missing control: ${value}`);
    return node.getAttribute('aria-label') || node.textContent.trim();
  }, selector);
  await ui.click(label, selector);
}
const cardSelector = (index) =>
  `.assistant-message .deliverable-slot:nth-child(${index + 1}) .deliverable-card`;
async function inlineReference(index, keyboard = false) {
  const selector = '.assistant-message .answer-text code.inline-file-ref';
  const label = files[index].path;
  const count = await evaluate(
    (value, text) =>
      [...document.querySelectorAll(value)].filter((node) => node.textContent.trim() === text)
        .length,
    selector,
    label,
  );
  assert.equal(count, 1);
  if (!keyboard) return ui.click(label, selector);
  await evaluate(
    (value, text) => {
      const node = [...document.querySelectorAll(value)].find(
        (item) => item.textContent.trim() === text,
      );
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      node.focus();
    },
    selector,
    label,
  );
  await key('Enter', 'Enter', 13);
}
async function key(value, code, windowsVirtualKeyCode) {
  await ui.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: value,
    code,
    windowsVirtualKeyCode,
  });
  await ui.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: value,
    code,
    windowsVirtualKeyCode,
  });
}
async function tabState() {
  return evaluate((selector) => {
    const list = document.querySelector(selector);
    if (!list) return null;
    const bounds = list.getBoundingClientRect();
    return {
      role: list.getAttribute('role'),
      orientation: list.getAttribute('aria-orientation'),
      bounds: { left: bounds.left, right: bounds.right, width: bounds.width },
      tabs: [...list.querySelectorAll('[role="tab"]')].map((tab) => {
        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        const rect = tab.getBoundingClientRect();
        return {
          page: tab.dataset.workbenchPage,
          label: tab.textContent.trim(),
          selected: tab.getAttribute('aria-selected') === 'true',
          tabIndex: tab.tabIndex,
          focused: document.activeElement === tab,
          panel: panel?.dataset.workbenchPanel,
          panelRole: panel?.getAttribute('role'),
          labelledByTab: panel?.getAttribute('aria-labelledby') === tab.id,
          hidden: panel?.hidden,
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      }),
      visiblePanels: [...document.querySelectorAll('.workbench [role="tabpanel"]')]
        .filter((panel) => !panel.hidden)
        .map((panel) => panel.dataset.workbenchPanel),
    };
  }, workbenchTablist);
}
function assertTabs(state, selected) {
  assert.ok(state);
  assert.equal(state.role, 'tablist');
  assert.equal(state.orientation, 'horizontal');
  assert.deepEqual(
    state.tabs.map((tab) => [tab.page, tab.label]),
    pages,
  );
  assert.deepEqual(
    state.tabs.filter((tab) => tab.selected).map((tab) => tab.page),
    [selected],
  );
  assert.deepEqual(
    state.tabs.filter((tab) => tab.tabIndex === 0).map((tab) => tab.page),
    [selected],
  );
  assert.deepEqual(state.visiblePanels, [selected]);
  for (const tab of state.tabs) {
    assert.equal(tab.panel, tab.page);
    assert.equal(tab.panelRole, 'tabpanel');
    assert.equal(tab.labelledByTab, true);
    assert.equal(tab.hidden, tab.page !== selected);
    assert.equal(tab.tabIndex, tab.page === selected ? 0 : -1);
    assert.ok(tab.width > 0, 'Every tab must remain laid out in the scrollable strip');
  }
}
async function previewState() {
  return evaluate((selector) => {
    const node = document.querySelector(selector);
    return {
      exists: !!node,
      visible: !!node?.getClientRects().length,
      text: node?.querySelector('pre')?.textContent || '',
      coverage: node?.querySelector('.file-coverage')?.textContent || '',
      caption: node?.textContent || '',
      alert: node?.querySelector('[role="alert"]')?.textContent || '',
      modal: !!document.querySelector('.modal'),
    };
  }, preview);
}
async function expectPreview(index) {
  await until(async () => {
    const state = await previewState();
    return state.visible && state.text === files[index].content.slice(0, 12000);
  }, `safe text preview for ${files[index].path}`);
  const state = await previewState();
  assert.equal(state.modal, false, 'Opening a delivery must keep the composer outside a modal');
  assert.equal(state.alert, '');
  assert.match(state.coverage, /UTF-8/);
  assertTabs(await tabState(), 'deliverables');
  return { characters: state.text.length, coverage: state.coverage };
}
async function composerState() {
  return evaluate((selector) => {
    const field = document.querySelector(selector);
    const rect = field.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    return {
      value: field.value,
      disabled: field.disabled,
      width: rect.width,
      height: rect.height,
      hit: document.elementFromPoint(x, y) === field,
    };
  }, input);
}
async function capture(name) {
  const file = path.join(evidence, `${name}.png`);
  assert.equal((await ui.screenshot(file)).status, 'captured');
  const bytes = await fs.readFile(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  assert.ok(width >= 800 && height >= 600);
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
async function resize(width, height) {
  await main.evaluate(
    expression(
      (w, h) => {
        const window = process.mainModule.require('electron').BrowserWindow.getAllWindows()[0];
        window.webContents.setZoomFactor(1);
        window.setContentSize(w, h);
        return true;
      },
      width,
      height,
    ),
  );
  await until(
    () => evaluate((w, h) => innerWidth === w && innerHeight === h, width, height),
    'requested window viewport',
  );
  return evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          data: [{ id: model, name: 'QA 工作面板模型', input_modalities: ['text'] }],
        }),
      );
      return;
    }
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert.ok(body.length <= 2 * 1024 * 1024, 'Fixture request exceeded its bound');
    }
    const payload = JSON.parse(body);
    assert.equal(payload.model, model);
    assert.equal(payload.stream, true);
    const results = payload.messages.filter((message) => message.role === 'tool');
    assert.deepEqual(
      results.map((message) => message.tool_call_id),
      calls.slice(0, results.length).map((call) => call.id),
    );
    assert.ok(results.length <= calls.length);
    for (const name of ['write', 'present'])
      assert.ok(
        payload.tools?.some((tool) => tool.function?.name === name),
        `${name} must be advertised by the real kernel`,
      );
    report.providerRequests.push({
      step: results.length,
      nextTool: calls[results.length]?.name || null,
    });
    const base = {
      id: 'chatcmpl-qa-workbench',
      object: 'chat.completion.chunk',
      created: 1,
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
    response.end(JSON.stringify({ error: { message: 'Workbench fixture contract failed' } }));
  }
});

console.log(`Evidence: ${evidence}`);
try {
  assert.equal(provenance.sourceDirty, false, 'Package must use a clean source snapshot');
  report.exeSha256 = hash(await fs.readFile(exe));
  await fs.mkdir(projectDirectory, { recursive: true });
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
  child.once('error', (error) => {
    childError = error;
  });
  closed = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      childClosed = true;
      report.processExit = { code, signal };
      resolve();
    }),
  );
  await until(
    async () => {
      assert.equal(childClosed, false, 'Application exited before CDP attachment');
      const output = await fs.readFile(appLog, 'utf8');
      if (!ui) {
        const port = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
        if (port) ui = await connectUi(Number(port)).catch(() => null);
      }
      if (!main) {
        const port = output.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
        if (port) main = await connectUi(Number(port), true).catch(() => null);
      }
      return ui && main;
    },
    'fresh renderer and main inspector endpoints',
    60000,
  );
  await ready();
  await check('packaged EXE uses only the isolated QA profile', async () => {
    const identity = await main.evaluate(
      expression(() => {
        const { app, BrowserWindow } = process.mainModule.require('electron');
        return {
          packaged: app.isPackaged,
          version: app.getVersion(),
          profile: app.getPath('userData'),
          exe: process.execPath,
          pid: process.pid,
          url: BrowserWindow.getAllWindows()[0].webContents.getURL(),
          versions: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
          },
        };
      }),
    );
    assert.equal(identity.packaged, true);
    assert.equal(identity.version, provenance.version);
    assert.equal(identity.pid, child.pid);
    assert.equal(path.resolve(identity.profile), profile);
    assert.equal(path.resolve(identity.exe), exe);
    assert.equal(identity.url, 'zhixing://app/index.html');
    assert.equal(await evaluate(() => location.href), identity.url);
    return {
      version: identity.version,
      versions: identity.versions,
      isolatedProfile: true,
      viewport: await resize(1255, 912),
    };
  });
  currentCase = 'seed isolated project and empty chats';
  await evaluate(
    async (fixture) => {
      await window.zhixing.saveProvider({
        name: 'QA 工作面板服务',
        protocol: 'openai',
        baseUrl: fixture.baseUrl,
        apiKey: 'sk-qa-workbench-00000000000',
        reasoningStyle: 'standard',
        discover: true,
      });
      const status = await window.zhixing.runtimeStatus();
      const provider = status.providers.find((row) => row.name === 'QA 工作面板服务');
      if (!provider) throw Error('Fixture provider missing');
      const state = await window.zhixing.loadWorkspace();
      state.workspaces.push({
        id: fixture.workspaceId,
        name: 'QA 预览工作区',
        type: 'office',
        directory: fixture.directory,
        projectId: fixture.projectId,
      });
      state.projects.push({
        id: fixture.projectId,
        workspaceId: fixture.workspaceId,
        name: 'QA 预览项目',
        directory: fixture.directory,
        expanded: true,
        instructions: '',
      });
      for (const [id, title] of [
        [fixture.chatId, 'QA 交付预览'],
        [fixture.otherChatId, 'QA 隔离聊天'],
      ])
        state.chats.push({
          id,
          title,
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      state.workspaceId = fixture.workspaceId;
      state.settings = {
        ...state.settings,
        persist: true,
        theme: 'light',
        demo: false,
        modelProviderId: provider.id,
        model: fixture.model,
        reasoning: 'low',
        permission: 'full',
        privacyMode: 'redact',
      };
      await window.zhixing.saveWorkspace(state);
      return true;
    },
    { baseUrl, workspaceId, projectId, chatId, otherChatId, directory: projectDirectory, model },
  );
  await reloadReady();
  await selectChat(chatId);
  await check(
    'real Harness writes and presents both files and creates inline references',
    async () => {
      await ui.fill(input, '请写入两份工作材料并交付文件，在结尾分别引用文件名。');
      await ui.click('发送消息', 'button.send-button[aria-label="发送消息"]');
      await until(
        () =>
          evaluate(
            () =>
              document.querySelector('.assistant-message .deliverable-files')?.dataset.count ===
                '2' &&
              !document.querySelector('.thinking-label') &&
              document.querySelector('button.send-button')?.getAttribute('aria-label') ===
                '发送消息',
          ),
        'completed real Harness deliverables',
        180000,
      );
      await ready();
      for (const file of files)
        assert.equal(
          await fs.readFile(path.join(projectDirectory, file.path), 'utf8'),
          file.content,
        );
      const saved = await evaluate(async (id) => {
        const state = await window.zhixing.loadWorkspace();
        const message = state.chats
          .find((chat) => chat.id === id)
          ?.messages.findLast((row) => row.role === 'assistant');
        return {
          text: message?.text,
          files: message?.deliverables?.length,
          pending: message?.pending === true,
        };
      }, chatId);
      assert.deepEqual(saved, { text: finalText, files: 2, pending: false });
      assert.deepEqual(
        await evaluate(() =>
          [...document.querySelectorAll('.assistant-message .inline-file-ref')].map(
            (node) => node.textContent,
          ),
        ),
        files.map((file) => file.path),
      );
      assert.equal(report.providerRequests.length, 4);
      return {
        files: files.map((file) => ({ name: file.path, characters: file.content.length })),
        modelRequests: 4,
      };
    },
  );
  await check(
    'delivery card opens safe text in the output tab while the chat draft remains editable',
    async () => {
      await clickControl(cardSelector(0));
      const details = await expectPreview(0);
      const before = await composerState();
      assert.equal(before.disabled, false);
      assert.equal(before.hit, true);
      await evaluate((selector) => document.querySelector(selector).focus(), input);
      await ui.send('Input.insertText', { text: draftText });
      assert.equal((await composerState()).value, draftText);
      assert.equal((await previewState()).modal, false);
      await capture('01-delivery-preview-light');
      return { ...details, draftCharacters: draftText.length, modalOpened: false };
    },
  );
  await check(
    'returning to outputs and activating an inline reference by keyboard preserves the text limit',
    async () => {
      await ui.click('返回产出列表', `${preview} button[aria-label="返回产出列表"]`);
      await until(
        () =>
          evaluate(
            (selector) =>
              !document.querySelector(selector) &&
              document.querySelector('.deliverables-list')?.getClientRects().length > 0,
            preview,
          ),
        'output list after closing preview',
      );
      await inlineReference(1, true);
      const details = await expectPreview(1);
      const state = await previewState();
      assert.equal(details.characters, 12000);
      assert.match(state.caption, /仅预览前 12,000 字符/);
      assert.equal(state.text.includes('资料末尾验收标记'), false);
      assert.equal((await composerState()).value, draftText);
      return { ...details, activation: 'Enter on inline file reference', limitLabelVisible: true };
    },
  );
  await check(
    'explicit enlargement uses the existing document modal and returns to the same side preview',
    async () => {
      await ui.click('放大预览', `${preview} button`);
      await until(
        () => evaluate(() => !!document.querySelector('.modal[role="dialog"]')),
        'explicit document modal',
      );
      const enlarged = await evaluate(() => {
        const modal = document.querySelector('.modal');
        return {
          title: modal.getAttribute('aria-label'),
          text: modal.querySelector('.privacy-text pre')?.textContent,
          coverage: modal.querySelector('.file-coverage')?.textContent,
        };
      });
      assert.equal(enlarged.title, files[1].path);
      assert.equal(enlarged.text, files[1].content.slice(0, 12000));
      assert.match(enlarged.coverage, /UTF-8/);
      await ui.click('关闭对话框', '.modal button[aria-label="关闭对话框"]');
      await until(() => evaluate(() => !document.querySelector('.modal')), 'modal closed');
      await expectPreview(1);
      assert.equal((await composerState()).value, draftText);
      return { explicitlyOpened: true, sameTextLimit: true, draftPreserved: true };
    },
  );
  await check(
    'missing real delivery stays as an inline error and retries after the same file is restored',
    async () => {
      const original = path.join(projectDirectory, files[0].path);
      const withheld = path.join(projectDirectory, 'withheld-qa-file.md');
      await fs.rename(original, withheld);
      await clickControl(cardSelector(0));
      await until(async () => (await previewState()).alert, 'real missing-file preview error');
      const failed = await previewState();
      assert.equal(failed.modal, false);
      assert.equal(failed.text, '');
      assert.equal((await composerState()).value, draftText);
      assert.equal(
        await evaluate(
          (selector) =>
            [...document.querySelectorAll(`${selector} button`)].filter(
              (node) => node.textContent.trim() === '重试预览' && !node.disabled,
            ).length,
          preview,
        ),
        1,
      );
      await capture('02-preview-file-unavailable');
      await fs.rename(withheld, original);
      await ui.click('重试预览', `${preview} button`);
      await expectPreview(0);
      return { realMissingFile: true, retryRestoredSameFile: true, modalOpened: false };
    },
  );
  await check(
    'all nine visible tabs select their real panels including browser and terminal',
    async () => {
      const observations = [];
      for (const [id] of pages) {
        await selectWorkbenchTab(ui, id);
        const state = await tabState();
        assertTabs(state, id);
        observations.push({ page: id, selected: true, panel: state.visiblePanels[0] });
        if (id === 'browser')
          assert.equal(
            await evaluate(
              () =>
                !!document
                  .querySelector('[data-workbench-panel="browser"] .browser-start')
                  ?.getClientRects().length,
            ),
            true,
          );
        if (id === 'terminal')
          assert.equal(
            await evaluate(
              () =>
                !!document
                  .querySelector(
                    '[data-workbench-panel="terminal"] select[aria-label="选择终端 Shell"]',
                  )
                  ?.getClientRects().length,
            ),
            true,
          );
      }
      assert.equal((await composerState()).value, draftText);
      return {
        tabs: observations,
        browserNavigation: 'not exercised',
        terminalExecution: 'not exercised',
      };
    },
  );
  await check(
    'arrow keys wrap and Home and End activate tabs with one focused selected control',
    async () => {
      await selectWorkbenchTab(ui, 'browser');
      const sequence = [
        ['ArrowLeft', 37, 'details'],
        ['ArrowRight', 39, 'browser'],
        ['End', 35, 'details'],
        ['Home', 36, 'browser'],
        ['ArrowRight', 39, 'files'],
        ['End', 35, 'details'],
      ];
      for (const [value, code, selected] of sequence) {
        await key(value, value, code);
        await until(
          async () =>
            (await tabState()).tabs.some(
              (tab) => tab.page === selected && tab.selected && tab.focused,
            ),
          `keyboard activation of ${selected}`,
        );
        const state = await tabState();
        assertTabs(state, selected);
        assert.deepEqual(
          state.tabs.filter((tab) => tab.focused).map((tab) => tab.page),
          [selected],
        );
        const active = state.tabs.find((tab) => tab.selected);
        assert.ok(
          active.left >= state.bounds.left - 2 && active.right <= state.bounds.right + 2,
          'Keyboard-selected tab must scroll into the visible strip',
        );
      }
      await capture('03-keyboard-tab-navigation');
      return {
        keys: sequence.map(([value, , selected]) => ({ key: value, selected })),
        oneTabStop: true,
      };
    },
  );
  await check(
    'switching chats clears the old file preview without losing the original chat draft',
    async () => {
      await inlineReference(0);
      await expectPreview(0);
      await selectChat(otherChatId);
      await until(
        () => evaluate((selector) => !document.querySelector(selector), preview),
        'old preview removed on scope change',
      );
      assert.equal((await composerState()).value, '');
      assert.equal(
        await evaluate(
          () => document.querySelectorAll('.deliverables-list .deliverables-card').length,
        ),
        0,
      );
      await selectChat(chatId);
      assert.equal((await composerState()).value, draftText);
      assert.equal((await previewState()).exists, false);
      await inlineReference(0);
      await expectPreview(0);
      return {
        otherChatHasNoDelivery: true,
        originalDraftRestored: true,
        delayedResponseInjection: false,
      };
    },
  );
  await check(
    'dark narrow layout keeps preview, keyboard tabs and the ordinary composer usable',
    async () => {
      await ui.click('打开设置', 'button[aria-label="打开设置"]');
      await ui.click('外观', '.settings-nav button');
      await ui.click('深色', '.theme-choices button');
      await ui.click('返回工作台');
      await until(
        () => evaluate(() => !!document.querySelector('.app-shell.dark')),
        'actual dark appearance setting',
      );
      const viewport = await resize(950, 912);
      await selectChat(chatId);
      await inlineReference(0);
      await expectPreview(0);
      const state = await composerState();
      assert.equal(state.disabled, false);
      assert.equal(state.hit, true);
      assert.ok(state.width > 100 && state.height > 0);
      assert.equal(state.value, draftText);
      await selectWorkbenchTab(ui, 'deliverables');
      await key('End', 'End', 35);
      await until(
        async () =>
          (await tabState()).tabs.some(
            (tab) => tab.page === 'details' && tab.selected && tab.focused,
          ),
        'narrow End activation',
      );
      const tabs = await tabState();
      assertTabs(tabs, 'details');
      const active = tabs.tabs.find((tab) => tab.selected);
      assert.ok(active.left >= tabs.bounds.left - 2 && active.right <= tabs.bounds.right + 2);
      await selectWorkbenchTab(ui, 'deliverables');
      await expectPreview(0);
      await capture('04-delivery-preview-dark-narrow');
      await ui.click('收起工作面板', 'button[aria-label="收起工作面板"]');
      await until(
        () => evaluate(() => document.querySelector('.workbench')?.hidden === true),
        'workbench closed',
      );
      assert.equal((await composerState()).value, draftText);
      assert.equal((await composerState()).hit, true);
      return {
        viewport,
        composerWidth: state.width,
        selectedTabVisible: true,
        closingPanelPreservesDraft: true,
      };
    },
  );
  assert.equal(fixtureError, undefined, fixtureError);
  assert.equal(
    report.providerRequests.length,
    4,
    'Preview and navigation must not issue extra model requests',
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  process.exitCode = 1;
  report.error = String(error?.stack || error).slice(0, 12000);
  report.cases.push({
    name: currentCase,
    status: 'failed',
    error: String(error?.message || error).slice(0, 4000),
  });
  if (ui) {
    try {
      await capture('failure');
    } catch (cause) {
      report.failureScreenshotError = String(cause?.message || cause);
    }
  }
  console.error(`FAIL ${currentCase}: ${error?.message || error}`);
} finally {
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  main?.close();
  if (ui && !childClosed) {
    try {
      await evaluate(() => {
        void window.zhixing.windowControl('close');
        return true;
      });
    } catch (error) {
      report.closeReply = String(error?.message || error).slice(0, 300);
    }
  }
  ui?.close();
  if (child && !childClosed) await Promise.race([closed, pause(20000)]);
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
  } catch (error) {
    report.logCollectionError = String(error?.message || error).slice(0, 1000);
  }
  report.cleanup = { processExited: !child || childClosed, temporaryRemoved: false };
  if (report.cleanup.processExited) {
    try {
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      report.cleanup.temporaryRemoved = true;
    } catch (error) {
      report.cleanup.error = String(error?.message || error).slice(0, 1000);
    }
  }
  if (
    !report.cleanup.processExited ||
    !report.cleanup.temporaryRemoved ||
    report.forcedProcessCleanup ||
    (child && (report.processExit?.code !== 0 || report.processExit?.signal !== null))
  ) {
    report.status = 'failed';
    process.exitCode = 1;
    report.cases.push({
      name: 'normal application exit and isolated temporary data cleanup',
      status: 'failed',
      ...report.cleanup,
      forcedProcessCleanup: !!report.forcedProcessCleanup,
      processExit: report.processExit,
    });
  }
  report.fixtureError = fixtureError || null;
  report.finishedAt = new Date().toISOString();
  await persist();
  console.log(
    JSON.stringify({
      status: report.status,
      passed: report.cases.filter((row) => row.status === 'passed').length,
      failed: report.cases.filter((row) => row.status === 'failed').length,
      screenshots: report.screenshots.length,
      evidence,
    }),
  );
}

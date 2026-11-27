// Default: Windows packaged EXE, real Harness and real file side effects.
// --source: the same journey on the local source app; never Windows-package evidence.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { connectUi } from './qa-cdp.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const sourceMode = process.argv[2] === '--source';
if (!sourceMode)
  assert.equal(process.platform, 'win32', 'This gate requires a Windows packaged EXE.');
const require = createRequire(import.meta.url);
const execute = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expression = (fn, ...args) =>
  `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`;
const exe = sourceMode
  ? require('electron')
  : path.resolve(process.argv[2] || 'release/win-unpacked/知行.exe');
const provenance = sourceMode
  ? {
      version: JSON.parse(await fs.readFile(path.join(repository, 'package.json'), 'utf8')).version,
      sourceCommit: (
        await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })
      ).stdout.trim(),
      sourceDirty: true,
    }
  : JSON.parse(
      await fs.readFile(
        path.join(path.dirname(exe), 'resources/app/build-provenance.json'),
        'utf8',
      ),
    );
const evidenceRoot = path.resolve(
  process.env.ZHIXING_QA_EVIDENCE || `.preview/qa-${provenance.version}/approval-recovery`,
);
await fs.mkdir(evidenceRoot, { recursive: true });
const evidence = await fs.mkdtemp(path.join(evidenceRoot, 'approval-recovery-ui-'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-approval-recovery-ui-'));
const profile = path.join(temporary, 'profile');
const directory = path.join(temporary, 'project');
const outside = path.join(temporary, 'outside');
const workspaceId = 'qa-approval-workspace';
const projectId = 'qa-approval-project';
const otherChatId = 'qa-approval-other';
const model = 'qa-approval-model';
const input = 'textarea[aria-label="聊天输入框"]';
const cases = Object.fromEntries(
  ['allow', 'reject', 'switch', 'present', 'stop', 'reload', 'boundary', 'quit', 'volatile'].map(
    (name) => [
      name,
      {
        name,
        chatId: name === 'volatile' ? null : `qa-approval-${name}`,
        prompt: `[审批验收:${name}] 请按本次审批决定处理办公成果。`,
        file: `${name}-result.txt`,
        content: `审批验收成果：${name}。只创建一次。`,
        final:
          name === 'reject'
            ? '已遵照拒绝决定，本次没有生成文件。'
            : `审批验收 ${name} 已完成，成果与执行结果已经保存。`,
      },
    ],
  ),
);
const outsideFiles = ['第一份待交付.txt', '第二份待交付.txt'].map((name) => ({
  path: path.join(outside, name),
  description: '临时项目外成果，需要分别批准读取和交付',
}));
for (const item of Object.values(cases)) {
  item.calls =
    item.name === 'present'
      ? [
          {
            id: 'qa-approval-present-one-call',
            name: 'present',
            arguments: { files: outsideFiles },
          },
        ]
      : [
          {
            id: `qa-approval-${item.name}-write`,
            name: 'office_write_file',
            arguments: { file_path: item.file, content: item.content },
          },
        ];
  if (item.name === 'reload')
    item.calls.push({
      id: 'qa-approval-reload-present',
      name: 'present',
      arguments: { files: [{ path: item.file, description: '刷新后接续交付成果' }] },
    });
}
const report = {
  layer: sourceMode
    ? 'source-app + local-electron + real-harness + loopback model fixture'
    : 'windows-packaged-app + real-harness + loopback model fixture',
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
  processExits: [],
  providerRequests: [],
  visualReview: 'pending-human-review',
  boundaries: [
    'Only provider configuration and empty project/chat metadata are seeded through desktop IPC in an isolated temporary profile.',
    'Each tool call and result uses the real Harness, native approval bridge and production file policy. The loopback model provides deterministic SSE responses.',
    'Only one-time allow/reject choices are exercised; no session grant, persistent grant, real cloud, installer or user installation is covered.',
    'Approval and handoff snapshots are observed through production IPC. The expired-response negative case calls the real answer IPC; normal decisions use trusted CDP pointer events.',
    'The global fallback case injects failed state into the real application ErrorBoundary through CDP to exercise actual App unmount/recovery; it does not establish that a spontaneous exception was caught.',
    'Recovery is within the same live host with local persistence enabled. Normal host restart must retain saved terminal messages but must not revive pending approvals.',
    'A separate case disables persistence through the real settings UI and starts a new project chat. Reload must cancel that volatile run instead of restoring its conversation or approval.',
    'Screenshots are captured separately from assertions and require visual review.',
    ...(sourceMode
      ? [
          'Source mode uses the current checkout and Linux headless flags where necessary; it is not packaged or Windows DPAPI evidence.',
        ]
      : []),
  ],
};
const persist = () =>
  fs.writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
let current,
  currentCase = 'initialization',
  fixtureError;
const launches = [];
const evaluate = (fn, ...args) => current.ui.evaluate(expression(fn, ...args));
const mainEvaluate = (fn, ...args) => current.main.evaluate(expression(fn, ...args));
async function until(action, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fixtureError) throw new Error(fixtureError);
    if (current?.error) throw current.error;
    const result = await action();
    if (result) return result;
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
      evaluate(
        () =>
          document.readyState === 'complete' &&
          !!document.querySelector('.app-shell') &&
          document.querySelector('.workspace-save-banner')?.dataset.saveStatus === 'saved',
      ),
    'loaded app and saved workspace',
    60000,
  );
}
async function selectChat(id) {
  const selector = `.chat-row[data-chat-id="${id}"] .chat-link`;
  const text = await until(
    () =>
      evaluate((value) => {
        const node = document.querySelector(value);
        return node?.getClientRects().length ? node.textContent.trim() : false;
      }, selector),
    'visible chat entry',
  );
  await current.ui.click(text, selector);
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
async function reloadReady() {
  const before = await evaluate(() => performance.timeOrigin);
  await current.ui.send('Page.reload');
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
const snapshot = () => evaluate(() => window.zhixing.approvalSnapshot());
const handoffs = () => evaluate(() => window.zhixing.runHandoffs());
const saved = () => evaluate(() => window.zhixing.loadWorkspace());
const requestsFor = (name) =>
  report.providerRequests.filter((request) => request.scenario === name);
async function noFile(item) {
  await assert.rejects(fs.access(path.join(directory, item.file)), { code: 'ENOENT' });
  assert.equal(
    (await fs.readdir(directory)).some((name) => name.startsWith(item.name + '-result')),
    false,
  );
}
async function oneFile(item) {
  assert.equal(await fs.readFile(path.join(directory, item.file), 'utf8'), item.content);
  assert.deepEqual(
    (await fs.readdir(directory)).filter((name) => name.startsWith(item.name + '-result')),
    [item.file],
  );
}
async function pending(item) {
  const state = await until(
    async () => {
      const value = await snapshot();
      return value.pending.some((request) => request.rootSessionId === item.chatId) ? value : false;
    },
    `native approval for ${item.name}`,
    60000,
  );
  const request = state.pending.find((row) => row.rootSessionId === item.chatId);
  await until(
    () =>
      evaluate(
        (id) =>
          !!document.querySelector(
            `.approval-request[data-approval-request="${id}"] .approval-allow`,
          ),
        request.requestId,
      ),
    'matching approval card',
  );
  const details = await evaluate((id) => {
    const card = document.querySelector(`.approval-request[data-approval-request="${id}"]`);
    return {
      path: card.querySelector('[data-approval-field="path"]').textContent,
      decisions: [...card.querySelectorAll('.approval-decisions button')].map((button) => ({
        label: button.textContent,
        disabled: button.disabled,
      })),
      modal: !!document.querySelector('.modal'),
    };
  }, request.requestId);
  assert.equal(details.path, request.presentation.path);
  assert.deepEqual(details.decisions, [
    { label: '拒绝', disabled: false },
    { label: '仅允许本次', disabled: false },
  ]);
  assert.equal(details.modal, false);
  return { state, request };
}
async function send(item) {
  await selectChat(item.chatId);
  await until(
    () =>
      evaluate(
        (selector) =>
          !!document.querySelector(selector) &&
          !document.querySelector(selector).disabled &&
          !document.querySelector('.approval-panel'),
        input,
      ),
    'available composer',
  );
  await current.ui.fill(input, item.prompt);
  await current.ui.click('发送消息', 'button[aria-label="发送消息"]');
  return pending(item);
}
async function decide(request, outcome) {
  const selector = `.approval-request[data-approval-request="${request.requestId}"] .approval-decisions button`;
  await current.ui.click(outcome === 'allowed-once' ? '仅允许本次' : '拒绝', selector);
}
function staleAnswer(state, request) {
  return {
    hostEpoch: state.hostEpoch,
    requestId: request.requestId,
    runId: request.runId,
    rootSessionId: request.rootSessionId,
    outcome: 'allowed-once',
  };
}
async function finished(item, runId, expectedStatus = 'completed') {
  const expectedMessageStatus = expectedStatus === 'completed' ? 'succeeded' : expectedStatus;
  const message = await until(
    async () => {
      const workspace = await saved();
      const matches =
        workspace.chats
          .find((chat) => chat.id === item.chatId)
          ?.messages.filter((row) => row.role === 'assistant' && row.runId === runId) || [];
      if (matches.length > 1) throw Error('The same run produced duplicate saved replies');
      const value = matches[0];
      return value &&
        !value.pending &&
        value.status === expectedMessageStatus &&
        value.resultReceiptId
        ? value
        : false;
    },
    `saved ${expectedStatus} reply for original run`,
    60000,
  );
  assert.equal(message.status, expectedMessageStatus);
  assert.equal(message.finalization?.executionStatus, expectedStatus);
  if (expectedStatus === 'completed') {
    assert.equal(message.text, item.final);
    await until(
      () =>
        evaluate(
          (text) =>
            [...document.querySelectorAll('.assistant-message .answer-text')].some((node) =>
              node.textContent.includes(text),
            ),
          item.final,
        ),
      'visible final reply',
    );
  }
  assert.equal(
    (await snapshot()).pending.some((row) => row.runId === runId),
    false,
  );
  await until(
    async () => !(await handoffs()).runs.some((row) => row.runId === runId),
    'durable result receipt acknowledged',
  );
  return message;
}
async function capture(name) {
  const file = path.join(evidence, `${name}.png`);
  assert.equal((await current.ui.screenshot(file)).status, 'captured');
  const bytes = await fs.readFile(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  assert(width >= 800 && height >= 600);
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

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          data: [{ id: model, name: 'QA 审批恢复模型', input_modalities: ['text'] }],
        }),
      );
      return;
    }
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert(body.length <= 2 * 1024 * 1024);
    }
    const payload = JSON.parse(body);
    assert.equal(payload.model, model);
    assert.equal(payload.stream, true);
    const prompt = JSON.stringify(
      payload.messages.findLast((message) => message.role === 'user')?.content,
    );
    const item = Object.values(cases).find((candidate) => prompt.includes(candidate.prompt));
    assert(item, 'Fixture needs the genuine typed scenario prompt');
    const results = payload.messages.filter((message) => message.role === 'tool');
    assert.deepEqual(
      results.map((result) => result.tool_call_id),
      item.calls.slice(0, results.length).map((call) => call.id),
    );
    assert(results.length <= item.calls.length);
    assert.equal(
      requestsFor(item.name).length,
      results.length,
      'A model request or tool step must not replay after recovery',
    );
    for (const call of item.calls)
      assert(
        payload.tools?.some((tool) => tool.function?.name === call.name),
        'Real kernel must advertise the required tool',
      );
    if (results.length) {
      const result = String(results.at(-1).content);
      if (item.name === 'reject') assert.match(result, /未获批准|rejected|APPROVAL_REJECTED/);
      else assert.doesNotMatch(result, /未获批准|APPROVAL_REJECTED|APPROVAL_UNAVAILABLE/);
    }
    const call = item.calls[results.length];
    report.providerRequests.push({
      scenario: item.name,
      step: results.length,
      nextTool: call?.name || null,
      matchedToolResults: results.length,
    });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const write = (delta, finishReason = null) =>
      response.write(
        `data: ${JSON.stringify({ id: `approval-${item.name}`, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`,
      );
    write({ role: 'assistant' });
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
      write({ content: item.final });
      write({}, 'stop');
    }
    response.end('data: [DONE]\n\n');
  } catch (error) {
    fixtureError ||= String(error?.message || error);
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ error: { message: 'Approval recovery fixture contract failed' } }),
    );
  }
});

async function launch() {
  const index = launches.length + 1;
  const appLog = path.join(temporary, `app-${index}.log`);
  const log = await fs.open(appLog, 'a');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const args = [
    ...(sourceMode && process.platform === 'linux'
      ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu', '--password-store=basic']
      : []),
    ...(sourceMode ? [path.join(repository, 'electron/main.cjs')] : []),
    `--user-data-dir=${profile}`,
    '--inspect=127.0.0.1:0',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
  ];
  const child = spawn(exe, args, {
    cwd: temporary,
    env,
    stdio: ['ignore', log.fd, log.fd],
    windowsHide: true,
  });
  const instance = { index, child, appLog, log, closed: false, ui: null, main: null };
  launches.push(instance);
  current = instance;
  child.once('error', (error) => {
    instance.error = error;
  });
  instance.exited = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      instance.closed = true;
      instance.exit = { launch: index, code, signal };
      report.processExits.push(instance.exit);
      resolve();
    }),
  );
  await until(
    async () => {
      assert.equal(instance.closed, false, 'App exited before inspector attachment');
      const output = await fs.readFile(appLog, 'utf8');
      if (!instance.ui) {
        const port = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
        if (port) instance.ui = await connectUi(Number(port)).catch(() => null);
      }
      if (!instance.main) {
        const port = output.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
        if (port) instance.main = await connectUi(Number(port), true).catch(() => null);
      }
      return instance.ui && instance.main;
    },
    'fresh renderer and main inspector endpoints',
    60000,
  );
  const identity = await mainEvaluate(() => {
    const { app, BrowserWindow } = process.mainModule.require('electron');
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setZoomFactor(1);
    window.setContentSize(1255, 912);
    return {
      packaged: app.isPackaged,
      version: app.getVersion(),
      pid: process.pid,
      profile: app.getPath('userData'),
      exe: process.execPath,
      url: window.webContents.getURL(),
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
    };
  });
  assert.equal(identity.packaged, !sourceMode);
  assert.equal(identity.version, provenance.version);
  assert.equal(identity.pid, child.pid);
  assert.equal(path.resolve(identity.profile), profile);
  assert.equal(path.resolve(identity.exe), path.resolve(exe));
  assert.equal(identity.url, 'zhixing://app/index.html');
  await until(
    () => evaluate(() => innerWidth === 1255 && innerHeight === 912),
    'requested real viewport',
  );
  await ready();
  return identity;
}
async function closeNormally() {
  const instance = current;
  instance.main?.close();
  instance.main = null;
  try {
    await evaluate(() => {
      void window.zhixing.windowControl('close');
      return true;
    });
  } catch (error) {
    instance.closeReply = String(error?.message || error).slice(0, 300);
  }
  instance.ui?.close();
  instance.ui = null;
  await Promise.race([instance.exited, pause(25000)]);
  assert.equal(instance.closed, true, 'Normal close must settle the runtime and saved handoff');
  assert.equal(instance.exit.code, 0);
  assert.equal(instance.exit.signal, null);
}

console.log(`Evidence: ${evidence}`);
let firstPending, refreshedPending;
try {
  if (!sourceMode)
    assert.equal(provenance.sourceDirty, false, 'Package must be built from a clean snapshot');
  report.exeSha256 = hash(await fs.readFile(exe));
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  for (const file of outsideFiles) await fs.writeFile(file.path, '临时审批交付材料，只读核验。');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await check('application identity and temporary profile are verified', async () => {
    const identity = await launch();
    return {
      packaged: identity.packaged,
      version: identity.version,
      versions: identity.versions,
      isolatedProfile: true,
    };
  });
  currentCase = 'seed empty isolated chats and an ask-mode provider';
  await evaluate(
    async (fixture) => {
      await window.zhixing.saveProvider({
        name: 'QA 审批服务',
        protocol: 'openai',
        baseUrl: fixture.baseUrl,
        apiKey: 'sk-qa-approval-00000000000',
        reasoningStyle: 'standard',
        discover: true,
      });
      const status = await window.zhixing.runtimeStatus();
      const provider = status.providers.find((row) => row.name === 'QA 审批服务');
      if (!provider) throw Error('Missing fixture provider');
      const state = await window.zhixing.loadWorkspace();
      state.workspaces.push({
        id: fixture.workspaceId,
        name: 'QA 审批工作区',
        type: 'office',
        directory: fixture.directory,
        projectId: fixture.projectId,
      });
      state.projects.push({
        id: fixture.projectId,
        workspaceId: fixture.workspaceId,
        name: 'QA 审批项目',
        directory: fixture.directory,
        expanded: true,
        instructions: '',
      });
      for (const id of fixture.chatIds)
        state.chats.push({
          id,
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          title: id,
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
        permission: 'ask',
        privacyMode: 'redact',
      };
      await window.zhixing.saveWorkspace(state);
      return true;
    },
    {
      baseUrl,
      workspaceId,
      projectId,
      directory,
      model,
      chatIds: [
        ...Object.values(cases)
          .map((item) => item.chatId)
          .filter(Boolean),
        otherChatId,
      ],
    },
  );
  await reloadReady();

  await check('ask-mode write waits in the card without any file side effect', async () => {
    firstPending = await send(cases.allow);
    await noFile(cases.allow);
    await pause(350);
    await noFile(cases.allow);
    assert.equal(requestsFor('allow').length, 1);
    await capture('approval-pending');
    return {
      runId: firstPending.request.runId,
      requestId: firstPending.request.requestId,
      fileAbsentBeforeDecision: true,
    };
  });
  await check('allow once creates one file and preserves the complete final reply', async () => {
    await decide(firstPending.request, 'allowed-once');
    const result = await finished(cases.allow, firstPending.request.runId);
    await oneFile(cases.allow);
    assert.equal(requestsFor('allow').length, 2);
    assert.equal(
      (
        await evaluate(
          (reply) => window.zhixing.answerApproval(reply),
          staleAnswer(firstPending.state, firstPending.request),
        )
      ).accepted,
      false,
    );
    return { runId: result.runId, receiptSaved: true, fileCount: 1, providerRequests: 2 };
  });
  await check('reject returns to the actual tool without creating the requested file', async () => {
    const waiting = await send(cases.reject);
    await noFile(cases.reject);
    await decide(waiting.request, 'rejected');
    await finished(cases.reject, waiting.request.runId);
    await noFile(cases.reject);
    assert.equal(requestsFor('reject').length, 2);
    return { fileAbsentAfterRejection: true, actualToolResultObserved: true };
  });
  await check(
    'chat switching keeps the pending request owned by its original conversation',
    async () => {
      const waiting = await send(cases.switch);
      await selectChat(otherChatId);
      assert.equal(await evaluate(() => !!document.querySelector('.approval-panel')), false);
      assert.equal((await snapshot()).pending[0].requestId, waiting.request.requestId);
      await noFile(cases.switch);
      await selectChat(cases.switch.chatId);
      assert.equal((await pending(cases.switch)).request.requestId, waiting.request.requestId);
      await decide(waiting.request, 'allowed-once');
      await finished(cases.switch, waiting.request.runId);
      await oneFile(cases.switch);
      const workspace = await saved();
      assert.equal(workspace.chats.find((chat) => chat.id === otherChatId).messages.length, 0);
      return { requestPreserved: true, otherConversationUnchanged: true };
    },
  );
  await check(
    'one present call creates two distinct one-shot approvals for external files',
    async () => {
      const first = await send(cases.present);
      assert.equal(first.request.callId, cases.present.calls[0].id);
      assert.equal(
        path.resolve(first.request.presentation.path),
        path.resolve(outsideFiles[0].path),
      );
      await decide(first.request, 'allowed-once');
      const second = await until(async () => {
        const state = await snapshot();
        const request = state.pending.find(
          (row) =>
            row.rootSessionId === cases.present.chatId && row.requestId !== first.request.requestId,
        );
        return request ? { state, request } : false;
      }, 'second independent approval within the same present call');
      await pending(cases.present);
      assert.equal(second.request.callId, first.request.callId);
      assert.equal(second.request.runId, first.request.runId);
      assert.notEqual(second.request.requestId, first.request.requestId);
      assert.equal(
        path.resolve(second.request.presentation.path),
        path.resolve(outsideFiles[1].path),
      );
      assert.equal(
        (
          await evaluate(
            (reply) => window.zhixing.answerApproval(reply),
            staleAnswer(first.state, first.request),
          )
        ).accepted,
        false,
      );
      assert.equal((await snapshot()).pending[0].requestId, second.request.requestId);
      await capture('approval-second-file');
      await decide(second.request, 'allowed-once');
      const result = await finished(cases.present, first.request.runId);
      assert.equal(result.deliverables.length, 2);
      for (const file of outsideFiles)
        assert.equal(await fs.readFile(file.path, 'utf8'), '临时审批交付材料，只读核验。');
      assert.equal(requestsFor('present').length, 2);
      return {
        sameCallId: true,
        distinctRequestIds: true,
        deliveries: 2,
        duplicateFirstAnswerRejected: true,
      };
    },
  );
  await check('stop withdraws native approval and a late allow cannot write the file', async () => {
    const waiting = await send(cases.stop);
    await current.ui.click('停止本次任务', '.approval-stop button');
    await finished(cases.stop, waiting.request.runId, 'cancelled');
    const late = await evaluate(
      (reply) => window.zhixing.answerApproval(reply),
      staleAnswer(waiting.state, waiting.request),
    );
    assert.equal(late.accepted, false);
    await noFile(cases.stop);
    assert.equal(requestsFor('stop').length, 1);
    return { cancelled: true, lateAllowed: false, fileAbsent: true, providerRequests: 1 };
  });
  await check(
    'renderer reload restores the exact live host approval without another model call',
    async () => {
      const waiting = await send(cases.reload);
      await noFile(cases.reload);
      await reloadReady();
      await selectChat(cases.reload.chatId);
      refreshedPending = await pending(cases.reload);
      assert.equal(refreshedPending.state.hostEpoch, waiting.state.hostEpoch);
      assert.equal(refreshedPending.request.requestId, waiting.request.requestId);
      assert.equal(refreshedPending.request.runId, waiting.request.runId);
      assert.equal(requestsFor('reload').length, 1);
      await noFile(cases.reload);
      await capture('approval-after-reload');
      return { sameHost: true, sameRequest: true, sameRun: true, providerRequests: 1 };
    },
  );
  await check(
    'approval after reload saves the full response and delivery under the original run id',
    async () => {
      await decide(refreshedPending.request, 'allowed-once');
      const result = await finished(cases.reload, refreshedPending.request.runId);
      await oneFile(cases.reload);
      assert.equal(result.deliverables.length, 1);
      assert.equal(typeof result.resultReceiptId, 'string');
      assert.equal(requestsFor('reload').length, 3);
      await capture('approval-restored-result');
      return {
        runId: result.runId,
        completeText: true,
        deliveries: 1,
        receiptSavedAndAcknowledged: true,
        providerRequests: 3,
      };
    },
  );
  await check(
    'a second reload restores the saved result without re-running the model or tools',
    async () => {
      const before = report.providerRequests.length;
      await reloadReady();
      await selectChat(cases.reload.chatId);
      const result = await finished(cases.reload, refreshedPending.request.runId);
      assert.equal(result.text, cases.reload.final);
      assert.equal(result.deliverables.length, 1);
      await oneFile(cases.reload);
      assert.equal((await snapshot()).pending.length, 0);
      assert.equal(report.providerRequests.length, before);
      return { savedOriginalRun: true, noModelReplay: true, noExtraFile: true };
    },
  );
  await check(
    'global fallback stops a waiting run before restoring the real application',
    async () => {
      const waiting = await send(cases.boundary);
      const injected = await evaluate(() => {
        const root = document.getElementById('root');
        const key = Object.keys(root).find((name) => name.startsWith('__reactContainer$'));
        if (!key) throw Error('Real React container is unavailable');
        const container = root[key];
        const first = container.stateNode?.current || container;
        const stack = [first];
        while (stack.length) {
          const fiber = stack.pop();
          const instance = fiber.stateNode;
          if (
            instance?.props?.scope === 'application' &&
            typeof instance.restore === 'function' &&
            typeof instance.setState === 'function'
          ) {
            instance.setState({ failed: true });
            return 'real-boundary-state-injection';
          }
          if (fiber.child) stack.push(fiber.child);
          if (fiber.sibling) stack.push(fiber.sibling);
        }
        throw Error('Real application ErrorBoundary was not found');
      });
      assert.equal(injected, 'real-boundary-state-injection');
      await until(
        () => evaluate(() => !!document.querySelector('.render-error-application')),
        'actual global fallback',
      );
      assert.equal(await evaluate(() => !!document.querySelector('.approval-panel')), false);
      await noFile(cases.boundary);
      await current.ui.click('停止交办并恢复界面', '.render-error-application .render-error-retry');
      await ready();
      await selectChat(cases.boundary.chatId);
      await finished(cases.boundary, waiting.request.runId, 'cancelled');
      await noFile(cases.boundary);
      assert.equal(
        (
          await evaluate(
            (reply) => window.zhixing.answerApproval(reply),
            staleAnswer(waiting.state, waiting.request),
          )
        ).accepted,
        false,
      );
      assert.equal(requestsFor('boundary').length, 1);
      return {
        injection: injected,
        stoppedBeforeRestore: true,
        cancelledResultSaved: true,
        noFile: true,
      };
    },
  );
  await check(
    'normal close cancels a pending request and restart cannot revive its approval',
    async () => {
      const waiting = await send(cases.quit);
      await noFile(cases.quit);
      await closeNormally();
      await launch();
      await selectChat(cases.quit.chatId);
      assert.notEqual((await snapshot()).hostEpoch, waiting.state.hostEpoch);
      assert.equal((await snapshot()).pending.length, 0);
      assert.equal((await handoffs()).runs.length, 0);
      const workspace = await saved();
      const result = workspace.chats
        .find((chat) => chat.id === cases.quit.chatId)
        .messages.find((row) => row.runId === waiting.request.runId && row.role === 'assistant');
      assert(result);
      assert.equal(result.pending, false);
      assert.equal(result.status, 'cancelled');
      assert.equal(typeof result.resultReceiptId, 'string');
      assert.equal(
        (
          await evaluate(
            (reply) => window.zhixing.answerApproval(reply),
            staleAnswer(waiting.state, waiting.request),
          )
        ).accepted,
        false,
      );
      await noFile(cases.quit);
      assert.equal(requestsFor('quit').length, 1);
      await closeNormally();
      return {
        normalExit: true,
        cancelledResultSaved: true,
        pendingAfterRestart: 0,
        lateAllowed: false,
        fileAbsent: true,
      };
    },
  );
  await check(
    'reload cancels a nonpersistent pending run without keeping its chat or approval',
    async () => {
      await launch();
      assert.equal((await handoffs()).runs.length, 0);
      assert.equal((await snapshot()).pending.length, 0);
      await current.ui.click('打开设置');
      await current.ui.click('隐私与数据', '.settings-nav button');
      const persistenceToggle = 'button[role="switch"][aria-label="保存聊天与资料"]';
      assert.equal(
        await evaluate(
          (selector) => document.querySelector(selector)?.getAttribute('aria-checked'),
          persistenceToggle,
        ),
        'true',
      );
      await current.ui.click('保存聊天与资料', persistenceToggle);
      await current.ui.click('关闭保存', '.modal .danger-button');
      await until(
        async () => (await saved()).settings.persist === false,
        'disabled local persistence',
      );
      let state = await saved();
      assert.deepEqual(state.chats, []);
      assert.deepEqual(state.documents, []);
      assert.deepEqual(state.automations, []);
      assert.deepEqual(state.drafts, {});
      await current.ui.click('返回工作台');
      // Reload while idle first. The old persisted chats must disappear, and
      // the new task below is created by the real UI, never seeded into storage.
      await reloadReady();
      assert.equal(await evaluate(() => document.querySelectorAll('.chat-row').length), 0);
      await current.ui.click('QA 审批项目 的项目菜单');
      await current.ui.click('在项目中聊天', '.project-group .dropdown button');
      await until(
        () =>
          evaluate((selector) => {
            const composer = document.querySelector(selector);
            return composer && !composer.disabled && !composer.value;
          }, input),
        'new nonpersistent project chat composer',
      );
      await current.ui.fill(input, cases.volatile.prompt);
      await current.ui.click('发送消息', 'button[aria-label="发送消息"]');
      const currentRequest = await until(
        async () =>
          (await snapshot()).pending.find(
            (request) => request.callId === cases.volatile.calls[0].id,
          ),
        'native approval for a UI-created nonpersistent chat',
        60000,
      );
      cases.volatile.chatId = currentRequest.rootSessionId;
      assert.equal(typeof cases.volatile.chatId, 'string');
      assert.notEqual(cases.volatile.chatId, 'qa-approval-volatile');
      const waiting = await pending(cases.volatile);
      assert.equal(waiting.request.requestId, currentRequest.requestId);
      const live = (await handoffs()).runs.find((run) => run.runId === waiting.request.runId);
      assert(live);
      assert.equal(live.sessionId, cases.volatile.chatId);
      assert.equal(live.status, 'running');
      state = await saved();
      assert.equal(state.settings.persist, false);
      assert.deepEqual(state.chats, []);
      assert.deepEqual(state.drafts, {});
      await noFile(cases.volatile);
      assert.equal(requestsFor('volatile').length, 1);
      await capture('approval-nonpersistent-pending');
      await reloadReady();
      await until(
        async () => {
          const approvals = await snapshot();
          const runs = await handoffs();
          return (
            approvals.pending.length === 0 &&
            !runs.runs.some((run) => run.runId === waiting.request.runId)
          );
        },
        'cancelled nonpersistent handoff is settled and forgotten',
        60000,
      );
      assert.equal((await snapshot()).hostEpoch, waiting.state.hostEpoch);
      assert.equal((await handoffs()).runs.length, 0);
      assert.equal(await evaluate(() => !!document.querySelector('.approval-panel')), false);
      assert.equal(await evaluate(() => document.querySelectorAll('.chat-row').length), 0);
      assert.equal(
        await evaluate((text) => document.body.textContent.includes(text), cases.volatile.prompt),
        false,
      );
      assert.equal(
        await evaluate((text) => document.body.textContent.includes(text), cases.volatile.final),
        false,
      );
      assert.equal(
        (
          await evaluate(
            (reply) => window.zhixing.answerApproval(reply),
            staleAnswer(waiting.state, waiting.request),
          )
        ).accepted,
        false,
      );
      state = await saved();
      assert.equal(state.settings.persist, false);
      assert.deepEqual(state.chats, []);
      assert.deepEqual(state.documents, []);
      assert.deepEqual(state.drafts, {});
      await noFile(cases.volatile);
      assert.equal(requestsFor('volatile').length, 1);
      await capture('approval-nonpersistent-after-reload');
      await closeNormally();
      return {
        newChatCreatedThroughUi: true,
        persistenceDisabled: true,
        sameHostReload: true,
        originalHandoffForgotten: true,
        noSavedChatOrDraft: true,
        noApprovalAfterReload: true,
        lateAllowed: false,
        fileAbsent: true,
        providerRequests: 1,
      };
    },
  );
  assert.equal(fixtureError, undefined);
  assert.equal(report.cases.length, 13);
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
  if (current?.ui && !current.closed) {
    try {
      await capture('failure');
    } catch (failure) {
      report.failureScreenshotError = String(failure?.message || failure).slice(0, 1000);
    }
  }
  console.error(`FAIL ${currentCase}: ${error?.message || error}`);
} finally {
  if (current?.ui && !current.closed) {
    try {
      await closeNormally();
    } catch (error) {
      report.closeError = String(error?.message || error).slice(0, 1000);
    }
  }
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const instance of launches) {
    instance.main?.close();
    instance.ui?.close();
    if (!instance.closed) {
      report.forcedProcessCleanup = true;
      try {
        if (process.platform === 'win32')
          await execute('taskkill.exe', ['/PID', String(instance.child.pid), '/T', '/F'], {
            windowsHide: true,
            timeout: 10000,
          });
        else instance.child.kill('SIGKILL');
      } catch (error) {
        report.processCleanupError = String(error?.message || error).slice(0, 1000);
      }
      await Promise.race([instance.exited, pause(5000)]);
    }
    await instance.log.close();
  }
  const combined = Buffer.concat(
    await Promise.all(
      launches.map((instance) => fs.readFile(instance.appLog).catch(() => Buffer.alloc(0))),
    ),
  );
  await fs.writeFile(
    path.join(evidence, 'app-log-tail.txt'),
    combined.subarray(Math.max(0, combined.length - 128 * 1024)),
  );
  report.cleanup = {
    processesExited: launches.every((instance) => instance.closed),
    temporaryRemoved: false,
  };
  if (report.cleanup.processesExited) {
    try {
      const resolved = await fs.realpath(temporary);
      assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
      assert(path.basename(resolved).startsWith('zhixing-approval-recovery-ui-'));
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      report.cleanup.temporaryRemoved = true;
    } catch (error) {
      report.cleanup.error = String(error?.message || error).slice(0, 1000);
    }
  }
  if (
    !report.cleanup.processesExited ||
    !report.cleanup.temporaryRemoved ||
    report.forcedProcessCleanup ||
    report.closeError ||
    report.processExits.some((row) => row.code !== 0 || row.signal !== null)
  ) {
    report.status = 'failed';
    process.exitCode = 1;
    report.cases.push({
      name: 'normal process exit and isolated fixture cleanup',
      status: 'failed',
      ...report.cleanup,
      forcedProcessCleanup: !!report.forcedProcessCleanup,
    });
  }
  report.fixtureError = fixtureError || null;
  report.finishedAt = new Date().toISOString();
  await persist();
}

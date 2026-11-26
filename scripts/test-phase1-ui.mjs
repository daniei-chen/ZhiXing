// Windows packaged EXE + real Harness. Only the provider response is synthetic.
// Input, file parsing, encrypted persistence, streaming and quit preparation use
// the shipped application. No assistant message or draft body is seeded by IPC.
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

assert.equal(process.platform, 'win32', 'This gate requires a Windows packaged EXE.');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => createHash('sha256').update(value).digest('hex');
// Function sources avoid a second layer of template-string escape processing.
const expression = (fn, ...args) =>
  `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`;
const exe = path.resolve(process.argv[2] || 'release/win-unpacked/知行.exe');
const provenance = JSON.parse(
  await fs.readFile(path.join(path.dirname(exe), 'resources/app/build-provenance.json'), 'utf8'),
);
const evidenceRoot = path.resolve(
  process.env.ZHIXING_QA_EVIDENCE || `.preview/qa-${provenance.version}/phase1-ui`,
);
await fs.mkdir(evidenceRoot, { recursive: true });
const evidence = await fs.mkdtemp(path.join(evidenceRoot, 'phase1-ui-'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-phase1-ui-'));
const profile = path.join(temporary, 'profile');
const projectDirectory = path.join(temporary, 'project');
const workspaceFile = path.join(profile, 'zhixing', 'workspace.bin');
const draftsFile = path.join(profile, 'zhixing', 'drafts.bin');
const input = 'textarea[aria-label="聊天输入框"]';
const workspaceId = 'qa-phase1-workspace';
const projectId = 'qa-phase1-project';
const chatId = 'qa-phase1-chat';
const draftKey = `chat:${chatId}`;
const model = 'qa-phase1-model';
const attachmentName = '会议资料.txt';
const attachmentText = '会议资料：讨论办公材料归档、责任分工与复核安排。';
const attachmentPath = path.join(projectDirectory, attachmentName);
const typedText = '请整理这份会议资料，保留项目归属和附件，并持续保存当前草稿。'
  .repeat(4)
  .slice(0, 100);
const streamChunks = [
  '材料整理进度：'.repeat(70),
  ...Array.from({ length: 12 }, (_, index) =>
    `第${index + 1}段：逐项核对会议材料、整理责任分工并检查归档安排。`.repeat(4),
  ),
];
const finalText = streamChunks.join('');
const report = {
  layer: 'windows-packaged-app + real-harness + loopback SSE model fixture',
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
  timing: {
    productDebounceMs: 400,
    productMaxWaitMs: 2000,
    requestedInterKeyMs: 70,
    firstWriteToleranceMs: [1500, 2500],
    purpose: 'CI observation tolerances, not a product latency guarantee.',
  },
  boundaries: [
    'Empty project/chat metadata and provider configuration are seeded through real desktop IPC; text is entered one character at a time through CDP Input.insertText.',
    'A real temporary text file is dropped through CDP and parsed by the production attachment path.',
    'All assistant text comes from slow loopback SSE through the real Harness and privacy gateway; no assistant or progress state is injected.',
    'Read-only observers record prepare-to-quit and its saved acknowledgement; they do not acknowledge or flush on behalf of the application.',
    'File fingerprints establish observed writes in this bounded fixture, not a benchmark for large databases or all concurrent workloads.',
    'No installer, upgrade, real cloud model quality, user installation, cross-account migration or complete visual audit is covered.',
  ],
};
const persist = () =>
  fs.writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
let currentCase = 'initialization';
let current;
const launches = [];
let fixtureError;
let providerStream;
const evaluate = (fn, ...args) => current.ui.evaluate(expression(fn, ...args));
const mainEvaluate = (fn, ...args) => current.main.evaluate(expression(fn, ...args));
async function check(name, action) {
  currentCase = name;
  const startedAt = new Date().toISOString();
  const details = await action();
  report.cases.push({
    name,
    status: 'passed',
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(details || {}),
  });
  await persist();
  console.log(`PASS ${name}`);
}
async function until(action, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fixtureError) throw new Error(fixtureError);
    const result = await action();
    if (result) return result;
    await pause(80);
  }
  throw new Error(`Timeout: ${label}`);
}
async function fingerprint(file) {
  try {
    const bytes = await fs.readFile(file);
    const stat = await fs.stat(file, { bigint: true });
    return { bytes: bytes.length, sha256: hash(bytes), mtimeNs: String(stat.mtimeNs) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
const sameFile = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const savedWorkspace = () => evaluate(() => window.zhixing.loadWorkspace());
async function ready(timeoutMs = 60000) {
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
    timeoutMs,
  );
}
async function reloadReady() {
  const started = Date.now();
  const previousTimeOrigin = await evaluate(() => performance.timeOrigin);
  await current.ui.send('Page.reload');
  // Page.reload acknowledges the command before the new document is ready.
  // The previous document can still expose a saved banner and enabled input.
  await until(
    async () => {
      try {
        return await evaluate(
          (previous) => performance.timeOrigin !== previous && document.readyState === 'complete',
          previousTimeOrigin,
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
    'new document after reload',
    Math.max(1, 60000 - (Date.now() - started)),
  );
  await ready(Math.max(1, 60000 - (Date.now() - started)));
}
async function settledWorkspace() {
  await ready();
  let previous = await fingerprint(workspaceFile);
  assert.ok(previous, 'workspace.bin must exist');
  let stableSince = Date.now();
  return until(async () => {
    const next = await fingerprint(workspaceFile);
    if (!sameFile(previous, next)) {
      previous = next;
      stableSince = Date.now();
    }
    return Date.now() - stableSince >= 600 ? next : false;
  }, 'workspace baseline settles');
}
async function selectChat() {
  const selector = `.chat-row[data-chat-id="${chatId}"] .chat-link`;
  const title = await until(
    () =>
      evaluate((value) => {
        const link = document.querySelector(value);
        return link?.getClientRects().length ? link.textContent.trim() : false;
      }, selector),
    'persisted project chat has a visible entry',
  );
  await current.ui.click(title, selector);
  await until(
    () =>
      evaluate(
        (value) => document.querySelector(value)?.getAttribute('aria-current') === 'page',
        selector,
      ),
    'selected project chat scope',
  );
  await ready();
}
async function capture(name) {
  const file = path.join(evidence, `${name}.png`);
  const result = await current.ui.screenshot(file);
  assert.equal(result.status, 'captured');
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

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          data: [{ id: model, name: 'QA 状态隔离模型', input_modalities: ['text'] }],
        }),
      );
      return;
    }
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(
      report.providerRequests.length,
      0,
      'This fixture expects exactly one model request',
    );
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert.ok(body.length <= 2 * 1024 * 1024);
    }
    const payload = JSON.parse(body);
    assert.equal(payload.model, model);
    assert.equal(payload.stream, true);
    const messages = JSON.stringify(payload.messages);
    assert.ok(messages.includes(typedText), 'Real typed text must reach the model fixture');
    assert.ok(
      messages.includes(attachmentText),
      'Real parsed attachment text must reach the model fixture',
    );
    report.providerRequests.push({
      model: payload.model,
      stream: true,
      typedTextIncluded: true,
      parsedAttachmentIncluded: true,
    });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const write = (delta, reason = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'phase1-stream', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
      );
    write({ role: 'assistant' });
    providerStream = {
      response,
      chunks: 0,
      append(text) {
        assert.equal(response.destroyed, false);
        write({ content: text });
        this.chunks++;
      },
      finish() {
        write({}, 'stop');
        response.end('data: [DONE]\n\n');
      },
    };
  } catch (error) {
    fixtureError = String(error?.message || error);
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Phase1 fixture rejected the request' } }));
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
  const child = spawn(
    exe,
    [
      `--user-data-dir=${profile}`,
      '--inspect=127.0.0.1:0',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
    ],
    { cwd: temporary, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true },
  );
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
      if (instance.error) throw instance.error;
      assert.equal(instance.closed, false, 'Application exited before CDP attachment');
      if (!instance.ui) {
        const ports = await fs
          .readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
          .catch(() => '');
        if (ports) instance.ui = await connectUi(Number(ports.split('\n')[0])).catch(() => null);
      }
      if (!instance.main) {
        const output = await fs.readFile(appLog, 'utf8');
        const port = output.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
        if (port) instance.main = await connectUi(Number(port), true).catch(() => null);
      }
      return instance.ui && instance.main;
    },
    'packaged renderer and main inspector',
    60000,
  );
  await ready();
  const identity = await mainEvaluate(() => {
    const { app, BrowserWindow, ipcMain } = process.mainModule.require('electron');
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setZoomFactor(1);
    window.setContentSize(1255, 912);
    window.webContents.on('console-message', (event) => {
      if (event.message === 'ZX_PHASE1_PREPARE_OBSERVED')
        process.stdout.write('ZX_PHASE1_PREPARE_OBSERVED\n');
    });
    ipcMain.on('app:quit-prepared', (_event, value) => {
      process.stdout.write(
        `ZX_PHASE1_QUIT_ACK ${JSON.stringify({ saved: value?.saved === true })}\n`,
      );
    });
    return {
      version: app.getVersion(),
      packaged: app.isPackaged,
      profile: app.getPath('userData'),
      exe: process.execPath,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
    };
  });
  assert.equal(identity.packaged, true);
  assert.equal(identity.version, provenance.version);
  assert.equal(path.resolve(identity.profile), profile);
  assert.equal(path.resolve(identity.exe), exe);
  return identity;
}
async function observeQuit() {
  await evaluate(() => {
    window.zhixing.onPrepareToQuit(() => console.log('ZX_PHASE1_PREPARE_OBSERVED'));
    return true;
  });
}
async function closeNormally() {
  const instance = current;
  instance.main?.close();
  instance.main = null;
  const requestedAt = performance.now();
  try {
    await instance.ui.evaluate(
      expression(() => {
        void window.zhixing.windowControl('close');
        return true;
      }),
    );
  } catch (error) {
    instance.closeReply = String(error?.message || error).slice(0, 300);
  }
  instance.ui.close();
  instance.ui = null;
  // The application gives renderer quit preparation 15 seconds; allow only
  // process-exit overhead beyond that, without replacing the host deadline.
  await Promise.race([instance.exited, pause(20000)]);
  assert.equal(instance.closed, true, 'Normal application close did not complete');
  assert.equal(instance.exit.code, 0, 'Application must exit normally');
  assert.equal(instance.exit.signal, null);
  return requestedAt;
}

console.log(`Evidence: ${evidence}`);
try {
  assert.equal(provenance.sourceDirty, false, 'Package must be built from a clean source snapshot');
  report.exeSha256 = hash(await fs.readFile(exe));
  await fs.mkdir(projectDirectory, { recursive: true });
  await fs.writeFile(attachmentPath, attachmentText);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await check('packaged EXE opens the isolated profile', async () => {
    const identity = await launch();
    return {
      version: identity.version,
      packaged: true,
      isolatedProfile: true,
      versions: identity.versions,
    };
  });
  currentCase = 'seeded project metadata is loaded in a new document';
  await evaluate(
    async (fixture) => {
      await window.zhixing.saveProvider({
        name: 'QA Phase1 服务',
        protocol: 'openai',
        baseUrl: fixture.baseUrl,
        apiKey: 'sk-qa-phase1-00000000000',
        reasoningStyle: 'standard',
        discover: true,
      });
      const status = await window.zhixing.runtimeStatus();
      const provider = status.providers.find((row) => row.name === 'QA Phase1 服务');
      if (!provider) throw Error('Fixture provider missing');
      const state = await window.zhixing.loadWorkspace();
      state.workspaces.push({
        id: fixture.workspaceId,
        name: 'QA 状态工作区',
        type: 'office',
        directory: fixture.directory,
        projectId: fixture.projectId,
      });
      state.projects.push({
        id: fixture.projectId,
        workspaceId: fixture.workspaceId,
        name: 'QA 状态项目',
        directory: fixture.directory,
        expanded: true,
        instructions: '',
      });
      state.chats.push({
        id: fixture.chatId,
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        title: 'QA 草稿与流式',
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
    { baseUrl, workspaceId, projectId, chatId, directory: projectDirectory, model },
  );
  await reloadReady();
  await selectChat();
  await check('real dropped attachment is parsed into the project chat draft', async () => {
    const point = await evaluate(() => {
      const r = document.querySelector('.composer').getBoundingClientRect();
      return { x: r.left + 30, y: r.top + 30 };
    });
    const data = { items: [], files: [attachmentPath], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop'])
      await current.ui.send('Input.dispatchDragEvent', { type, ...point, data });
    await until(
      () =>
        evaluate(
          (name) =>
            [...document.querySelectorAll('.composer .attachment-name')].some(
              (node) => node.title === name,
            ) && !document.querySelector('.composer .attachment-chip.invalid'),
          attachmentName,
        ),
      'real attachment chip',
    );
    const draft = await until(async () => {
      const value = (await savedWorkspace()).drafts?.[draftKey];
      return value?.files?.[0]?.text === attachmentText && value;
    }, 'parsed attachment is persisted');
    assert.equal(draft.workspaceId, workspaceId);
    assert.equal(draft.projectId, projectId);
    assert.equal(draft.files[0].status, 'ready');
    await settledWorkspace();
    return { attachmentName, parsedTextSha256: hash(draft.files[0].text), projectId, workspaceId };
  });
  await check(
    '100 continuous characters write bounded drafts without rewriting workspace.bin',
    async () => {
      const baseline = await settledWorkspace();
      let lastDraft = await fingerprint(draftsFile);
      assert.ok(lastDraft, 'Attachment draft must have an independent encrypted sidecar');
      await evaluate((selector) => document.querySelector(selector).focus(), input);
      const started = performance.now();
      let previousKeyAt = started;
      const rows = [],
        writes = [];
      for (const [index, character] of [...typedText].entries()) {
        const keyAt = performance.now();
        await current.ui.send('Input.insertText', { text: character });
        const workspace = await fingerprint(workspaceFile),
          drafts = await fingerprint(draftsFile);
        assert.deepEqual(workspace, baseline, `Keystroke ${index + 1} rewrote workspace.bin`);
        const elapsedMs = performance.now() - started;
        if (!sameFile(drafts, lastDraft)) {
          writes.push({ afterCharacter: index + 1, elapsedMs, file: drafts });
          lastDraft = drafts;
        }
        rows.push({
          character: index + 1,
          elapsedMs,
          gapMs: keyAt - previousKeyAt,
          workspaceUnchanged: true,
        });
        previousKeyAt = keyAt;
        await pause(70);
      }
      assert.equal([...typedText].length, 100);
      const maximumGapMs = Math.max(...rows.slice(1).map((row) => row.gapMs));
      assert.ok(
        maximumGapMs < 400,
        `Input paused long enough to trigger debounce: ${maximumGapMs} ms`,
      );
      assert.ok(writes.length > 0, 'Continuous input must be saved before editing stops');
      assert.ok(
        writes[0].elapsedMs >= 1500 && writes[0].elapsedMs <= 2500,
        `Observed first write ${writes[0].elapsedMs} ms is outside the stated CI tolerance`,
      );
      assert.ok(writes.length < 25, 'Drafts must not be persisted on every character');
      const draft = await until(async () => {
        const value = (await savedWorkspace()).drafts?.[draftKey];
        return value?.text === typedText && value;
      }, 'final typed draft reaches disk');
      assert.equal(draft.files[0].text, attachmentText);
      assert.deepEqual(await fingerprint(workspaceFile), baseline);
      assert.ok(await fingerprint(draftsFile));
      return {
        characters: rows.length,
        maximumGapMs,
        firstDraftWriteMs: writes[0].elapsedMs,
        observedDraftWritesDuringTyping: writes,
        workspaceBaseline: baseline,
        workspaceWritesDuringTyping: 0,
        samples: rows,
      };
    },
  );
  await check(
    'reload and explicit chat selection restore draft text, attachment and ownership',
    async () => {
      await reloadReady();
      await selectChat();
      assert.equal(
        await evaluate((selector) => document.querySelector(selector).value, input),
        typedText,
      );
      const state = await savedWorkspace(),
        draft = state.drafts[draftKey];
      assert.equal(draft.text, typedText);
      assert.equal(draft.files[0].text, attachmentText);
      assert.equal(draft.projectId, projectId);
      assert.equal(draft.workspaceId, workspaceId);
      assert.equal(state.chats.find((chat) => chat.id === chatId).projectId, projectId);
      assert.deepEqual(
        await evaluate(() =>
          [...document.querySelectorAll('.composer .attachment-name')].map((node) => node.title),
        ),
        [attachmentName],
      );
      await capture('01-draft-restored');
      return { draftKey, textLength: draft.text.length, attachments: 1, projectId, workspaceId };
    },
  );
  await check('real slow SSE grows visible text without per-chunk workspace writes', async () => {
    await current.ui.click('发送消息', 'button.send-button');
    await until(() => providerStream, 'real Harness reaches the loopback SSE provider', 60000);
    await settledWorkspace();
    providerStream.append(streamChunks[0]);
    const visibleLength = () =>
      evaluate(
        () => document.querySelector('.assistant-message .answer-text')?.textContent.length || 0,
      );
    let previousLength = await until(async () => {
      const value = await visibleLength();
      return value > 0 && value;
    }, 'first actual streaming preview');
    const baseline = await settledWorkspace();
    const samples = [];
    for (let index = 1; index < streamChunks.length; index += 1) {
      await pause(180);
      providerStream.append(streamChunks[index]);
      const length = await until(async () => {
        const value = await visibleLength();
        return value > previousLength && value;
      }, `visible SSE chunk ${index}`);
      const file = await fingerprint(workspaceFile);
      assert.deepEqual(file, baseline, `Streaming chunk ${index} rewrote workspace.bin`);
      assert.equal(
        await evaluate(() => !!document.querySelector('.assistant-message .thinking-label')),
        true,
      );
      samples.push({ chunk: index, visibleCharacters: length, workspaceUnchanged: true });
      previousLength = length;
      if (index === 6) await capture('02-live-stream');
    }
    const durable = (await savedWorkspace()).chats
      .find((chat) => chat.id === chatId)
      .messages.findLast((message) => message.role === 'assistant');
    assert.equal(durable.pending, true);
    assert.ok(
      !durable.progressText,
      'Transient preview text must not enter persisted workspace snapshots',
    );
    providerStream.finish();
    return {
      sseChunks: providerStream.chunks,
      visibleGrowthSamples: samples,
      workspaceBaseline: baseline,
      workspaceWritesDuringObservedStreaming: 0,
    };
  });
  await check(
    'the final reply is persisted once complete and remains readable after reload',
    async () => {
      const message = await until(
        async () => {
          const value = (await savedWorkspace()).chats
            .find((chat) => chat.id === chatId)
            ?.messages.findLast((row) => row.role === 'assistant');
          return value && !value.pending && !value.error && value.text === finalText && value;
        },
        'durable final reply',
        60000,
      );
      assert.notEqual(message.finalization?.processStatus, 'cleanup_pending');
      await ready();
      await reloadReady();
      await selectChat();
      assert.equal(
        await evaluate(
          () => document.querySelector('.assistant-message .answer-text')?.textContent,
        ),
        finalText,
      );
      assert.equal(
        await evaluate(() => !!document.querySelector('.assistant-message .thinking-label')),
        false,
      );
      assert.equal(report.providerRequests.length, 1);
      await capture('03-final-reply');
      return {
        replyCharacters: finalText.length,
        replySha256: hash(finalText),
        modelRequests: 1,
        processStatus: message.finalization?.processStatus,
      };
    },
  );
  await check(
    'closing before debounce flushes the last draft and normal restart restores it',
    async () => {
      await settledWorkspace();
      await observeQuit();
      await evaluate((selector) => document.querySelector(selector).focus(), input);
      assert.equal(await evaluate((selector) => document.querySelector(selector).value, input), '');
      const before = await fingerprint(draftsFile);
      const finalDraft = '关窗前最后一笔草稿，应由退出准备保存。';
      const typedAt = performance.now();
      await current.ui.send('Input.insertText', { text: finalDraft });
      assert.equal(
        await evaluate((selector) => document.querySelector(selector).value, input),
        finalDraft,
      );
      assert.deepEqual(
        await fingerprint(draftsFile),
        before,
        'Last draft unexpectedly crossed the debounce delay before close',
      );
      const closing = current;
      const requestedAt = await closeNormally();
      const keyToCloseMs = requestedAt - typedAt;
      assert.ok(keyToCloseMs < 400, `Close was requested after ${keyToCloseMs} ms`);
      const output = await fs.readFile(closing.appLog, 'utf8');
      assert.match(output, /ZX_PHASE1_PREPARE_OBSERVED/);
      assert.match(output, /ZX_PHASE1_QUIT_ACK \{"saved":true\}/);
      assert.doesNotMatch(output, /ZX_PHASE1_QUIT_ACK \{"saved":false\}/);
      await launch();
      await selectChat();
      assert.equal(
        await evaluate((selector) => document.querySelector(selector).value, input),
        finalDraft,
      );
      const state = await savedWorkspace();
      assert.equal(state.drafts[draftKey].text, finalDraft);
      assert.equal(state.drafts[draftKey].projectId, projectId);
      assert.equal(
        state.chats
          .find((chat) => chat.id === chatId)
          .messages.findLast((row) => row.role === 'assistant').text,
        finalText,
      );
      return {
        keyToCloseMs,
        debounceMs: 400,
        prepareToQuitObserved: true,
        savedAcknowledgementObserved: true,
        firstExit: closing.exit,
        restoredDraftLength: finalDraft.length,
        projectId,
      };
    },
  );
  assert.equal(fixtureError, undefined, fixtureError);
  assert.equal(report.providerRequests.length, 1);
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
  if (current?.ui) {
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
  if (current?.ui && !current.closed) {
    try {
      await closeNormally();
    } catch (error) {
      report.closeError = String(error?.message || error).slice(0, 1000);
    }
  }
  for (const instance of launches) {
    instance.main?.close();
    instance.ui?.close();
    if (!instance.closed) {
      report.forcedProcessCleanup = true;
      try {
        await promisify(execFile)(
          'taskkill.exe',
          ['/PID', String(instance.child.pid), '/T', '/F'],
          { windowsHide: true, timeout: 10000 },
        );
      } catch (error) {
        report.processCleanupError = String(error?.message || error).slice(0, 1000);
      }
      await Promise.race([instance.exited, pause(5000)]);
    }
    await instance.log.close();
  }
  const logs = await Promise.all(
    launches.map((instance) => fs.readFile(instance.appLog).catch(() => Buffer.alloc(0))),
  );
  const tail = Buffer.concat(logs);
  await fs.writeFile(
    path.join(evidence, 'app-log-tail.txt'),
    tail.subarray(Math.max(0, tail.length - 128 * 1024)),
  );
  const hostLog = await fs
    .readFile(path.join(profile, 'zhixing', 'logs', 'app.log'), 'utf8')
    .catch(() => '');
  report.persistenceEvents = hostLog
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^(\S+) info workspace\.persisted (\{.*\})$/);
      if (!match) return [];
      try {
        const value = JSON.parse(match[2]);
        return [
          {
            time: match[1],
            kind: value.kind,
            bytes: value.bytes,
            revision: value.revision ?? null,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(-400);
  report.cleanup = {
    processesExited: launches.every((instance) => instance.closed),
    temporaryRemoved: false,
  };
  if (report.cleanup.processesExited) {
    try {
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
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
      name: 'normal process exit and isolated temporary data cleanup',
      status: 'failed',
      ...report.cleanup,
      forcedProcessCleanup: !!report.forcedProcessCleanup,
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
      visualReview: report.visualReview,
      evidence,
    }),
  );
}

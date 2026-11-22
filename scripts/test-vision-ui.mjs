import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { connectUi } from './qa-cdp.mjs';

// Run against an unpacked Windows build. Provider setup is synthetic. Image
// import, submission, encrypted persistence, and restart use the shipped app.
const exe = path.resolve(process.argv[2] || 'release/win-unpacked/知行.exe');
const app = path.join(path.dirname(exe), 'resources', 'app');
const provenance = JSON.parse(await fs.readFile(path.join(app, 'build-provenance.json'), 'utf8'));
const version = JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8')).version;
const fixture = await fs.readFile('tests/fixtures/ocr-office-read.png');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const input = 'textarea[aria-label="聊天输入框"]';
const filename = 'zhixing-vision-qa.png';
const model = 'qa-visual-model';
const firstPrompt = '请解释合成图片测试的第一轮。';
const nextPrompt = '请根据上轮合成图片继续。';
const finalPrompt = '改变规则后不得重放上一轮图片。';
const originalBase64 = fixture.toString('base64');
const evidenceRoot = path.resolve(process.env.ZHIXING_QA_EVIDENCE || `.preview/qa-${version}/vision-ui`);
await fs.mkdir(evidenceRoot, { recursive: true });
const evidence = await fs.mkdtemp(path.join(evidenceRoot, 'run-'));
const profile = path.join(evidence, 'profile');
await fs.mkdir(profile);
assert.equal(provenance.sourceDirty, false, 'build must have a clean provenance');
const report = { version, provenance, exeSha256: hash(await fs.readFile(exe)), records: [], receipts: [], exits: [] };
const writeReport = () => fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
async function record(name, details = {}) {
  report.records.push({ name, status: 'passed', details });
  await writeReport();
  console.log(`PASS ${name}`);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: model, input_modalities: ['text', 'image'] }] }));
      return;
    }
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    const parts = [];
    for await (const chunk of request) parts.push(chunk);
    const wire = Buffer.concat(parts).toString('utf8');
    const body = JSON.parse(wire);
    const blocks = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
    const images = blocks.filter(block => block.type === 'image_url').map(block => {
      const match = /^data:(image\/(?:png|jpeg));base64,([^\s]+)$/.exec(block.image_url?.url);
      assert(match, 'expected inline image data');
      const bytes = Buffer.from(match[2], 'base64');
      return { sha256: hash(bytes), mime: match[1], bytes: bytes.length };
    });
    const number = report.receipts.length + 1;
    report.receipts.push({ model: body.model, reasoning: body.reasoning_effort, images, originalIncluded: wire.includes(originalBase64), phoneIncluded: wire.includes('13800000000') });
    assert(body.stream);
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: `qa-vision-${number}`, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    response.end(chunk({ role: 'assistant', content: `SAFE_VISUAL_WIN_${number}` }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  } catch (error) {
    report.fixtureError = error.message;
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end('{"error":{"message":"SYNTHETIC_FIXTURE_FAILURE"}}');
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;

let ui, child, childExit, log;
async function until(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const workspace = () => ui.evaluate('window.zhixing.loadWorkspace()');
const saveSettled = () => ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus === "saved"', 20000);
async function ready() {
  await ui.waitFor(`document.querySelector(${JSON.stringify(input)}) && !document.querySelector(${JSON.stringify(input)}).disabled`, 30000);
  await saveSettled();
}
async function launch() {
  log = await fs.open(path.join(evidence, 'app.log'), 'a');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const portsFile = path.join(profile, 'DevToolsActivePort');
  await fs.rm(portsFile, { force: true });
  child = spawn(exe, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
    cwd: evidence, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true,
  });
  childExit = once(child, 'close');
  ui = await until(async () => {
    if (child.exitCode !== null) throw new Error(`App exited at startup (${child.exitCode})`);
    const ports = await fs.readFile(portsFile, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
    if (!ports) return false;
    return connectUi(Number(ports.split('\n')[0])).catch(() => false);
  }, 'isolated packaged renderer', 45000);
  await ready();
}
async function closeApp() {
  void ui?.evaluate('window.zhixing.windowControl("close")').catch(() => {});
  const timeout = new AbortController();
  try {
    const exit = await Promise.race([
      childExit,
      pause(45000, null, { signal: timeout.signal }).then(() => { throw new Error('Isolated packaged app did not close'); }),
    ]);
    report.exits.push({ code: exit[0], signal: exit[1] });
    assert.deepEqual(exit, [0, null]);
  } finally {
    timeout.abort();
    ui?.close();
    ui = null;
  }
  await log?.close();
  log = null;
  child = null;
}
async function openChat(id) {
  const selector = `.chat-row[data-chat-id="${id}"] .chat-link`;
  const label = await ui.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim()`);
  assert(label, 'saved chat is available to reopen');
  await ui.click(label, selector);
  await ready();
}
async function sendAndAssert(number, image) {
  await ui.click('发送消息', '.composer button');
  await ui.waitFor(`document.querySelector('.transcript')?.textContent.includes('SAFE_VISUAL_WIN_${number}') && !document.querySelector('button[aria-label=停止生成]')`, 45000);
  await saveSettled();
  assert.equal(report.fixtureError, undefined);
  assert.equal(report.receipts.length, number);
  const receipt = report.receipts.at(-1);
  assert.equal(receipt.model, model);
  assert.equal(receipt.reasoning, 'high');
  assert.equal(receipt.originalIncluded, false);
  assert.equal(receipt.phoneIncluded, false);
  assert.deepEqual(receipt.images.map(({ sha256, mime }) => ({ sha256, mime })), [{ sha256: image.sha256, mime: image.mediaType }]);
}

try {
  console.log(`Evidence: ${evidence}`);
  await launch();
  const fixtureProvider = { name: 'QA Windows Visual', protocol: 'openai', baseUrl: endpoint, apiKey: 'synthetic-visual-0124-key', reasoningStyle: 'standard', discover: true };
  const status = await ui.evaluate(`window.zhixing.saveProvider(${JSON.stringify(fixtureProvider)})`);
  const provider = status.providers.find(item => item.name === fixtureProvider.name);
  assert(provider, 'the loopback provider must be discovered');
  const state = await workspace();
  Object.assign(state.settings, { persist: true, demo: false, modelProviderId: provider.id, model, reasoning: 'high', privacyMode: 'redact' });
  await ui.evaluate(`window.zhixing.saveWorkspace(${JSON.stringify(state)})`);
  await ui.send('Page.reload');
  await ready();
  await ui.fill(input, firstPrompt);
  await ui.evaluate(`(() => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(${JSON.stringify(originalBase64)}), ch => ch.charCodeAt(0));
    transfer.items.add(new File([bytes], ${JSON.stringify(filename)}, { type: 'image/png' }));
    document.querySelector('.composer').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  })()`);
  await ui.waitFor(`[...document.querySelectorAll('.composer .attachment-chip:not(.invalid)')].some(node => node.textContent.includes(${JSON.stringify(filename)}))`, 30000);
  const draft = await until(async () => Object.values((await workspace()).drafts || {}).find(item => item.files.some(file => file.name === filename)), 'image draft persisted');
  const photo = draft.files.find(file => file.name === filename);
  const image = photo.visual;
  assert(image?.maskCount > 0, 'synthetic visible phone must be masked');
  assert.notEqual(image.sha256, hash(fixture));
  assert(!JSON.stringify(photo).includes(originalBase64));
  assert(!Object.hasOwn(image, 'data'));
  const envelope = await fs.readFile(path.join(profile, 'zhixing', 'visual', image.visualId + '.bin'));
  assert(!envelope.includes(Buffer.from(image.sha256)) && !envelope.includes(fixture) && !envelope.includes(Buffer.from(originalBase64)));
  assert.equal(report.receipts.length, 0);
  await record('drag/drop prepared a masked image and persisted an opaque local copy', { maskCount: image.maskCount, protectedSha256: image.sha256, sourceSha256: hash(fixture), encryptedBytes: envelope.length });

  await closeApp();
  await launch();
  await ui.waitFor(`[...document.querySelectorAll('.composer .attachment-chip')].some(node => node.textContent.includes(${JSON.stringify(filename)}))`);
  assert.equal(await ui.evaluate(`document.querySelector(${JSON.stringify(input)}).value`), firstPrompt);
  await sendAndAssert(1, image);
  const sent = (await workspace()).chats.find(chat => chat.messages.some(message => message.text === firstPrompt));
  assert.deepEqual(sent.messages.find(message => message.text === firstPrompt).files[0].visual, image);
  await record('first full restart restored the draft and sent exactly one approved copy');

  await closeApp();
  await launch();
  await openChat(sent.id);
  await ui.fill(input, nextPrompt);
  await sendAndAssert(2, image);
  await record('second full restart replayed the approved hash in one follow-up request');

  const changed = await workspace();
  changed.settings.customTerms = [...changed.settings.customTerms, 'QA_POLICY_CHANGE'];
  await ui.evaluate(`window.zhixing.saveWorkspace(${JSON.stringify(changed)})`);
  await ui.send('Page.reload');
  await ready();
  await openChat(sent.id);
  await ui.fill(input, finalPrompt);
  await ui.click('发送消息', '.composer button');
  await ui.waitFor('document.body.innerText.includes("当前隐私规则或凭证与图片准备时不同")', 25000);
  assert.equal(await ui.evaluate(`document.querySelector(${JSON.stringify(input)}).value`), finalPrompt);
  assert.equal(report.receipts.length, 2);
  await record('changed privacy policy rejected historical pixels before a third request');
  await closeApp();
  await record('all three isolated packaged processes closed normally');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack;
  throw error;
} finally {
  if (child && ui) await closeApp().catch(error => { report.closeError = error.message; });
  if (child && child.exitCode === null && child.signalCode === null) {
    // A failed QA launch may have no reachable renderer. This child owns a
    // newly created synthetic profile, so it can be ended without touching the user's app.
    child.kill();
    await childExit.catch(error => { report.closeError ||= error.message; });
  }
  await log?.close();
  server.closeAllConnections();
  server.close();
  await writeReport();
}

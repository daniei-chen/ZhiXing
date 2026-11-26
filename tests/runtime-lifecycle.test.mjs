import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const packedRoot = process.env.ZHIXING_TEST_PACKED_APP;
const {composePrompt} = await import(packedRoot ? pathToFileURL(path.join(packedRoot, 'src/office-workflows.js')).href : '../src/office-workflows.js');
const {RuntimeManager} = await import(packedRoot
 ? pathToFileURL(path.join(packedRoot, 'electron', 'runtime.mjs')).href
 : '../electron/runtime.mjs');
const {readBridge} = await import(packedRoot
 ? pathToFileURL(path.join(packedRoot, 'harness', 'privacy-bridge.mjs')).href
 : '../harness/privacy-bridge.mjs');

const fixtureKey = 'zhixing-lifecycle-loopback-key';
const partialText = '合成任务已生成部分正文，等待用户确认。';

function deferred() {
 let resolve;
 const promise = new Promise(yes => { resolve = yes; });
 return {promise, resolve};
}

async function within(promise, timeoutMs = 15000) {
 let timer;
 try {
  return await Promise.race([
   promise,
   new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Runtime lifecycle did not settle within the test deadline.')), timeoutMs);
   }),
  ]);
 } finally {
  clearTimeout(timer);
 }
}

function textOf(message) {
 if (typeof message.content === 'string') return message.content;
 return message.content.filter(block => block.type === 'text').map(block => block.text).join('');
}

function questionResponse() {
 return [
  {type: 'text', text: partialText},
  {type: 'tool_use', id: 'lifecycle-question', name: 'ask_user_question', input: {
   questions: [{id: 'proceed', question: '是否继续合成任务？', options: [{label: '继续'}, {label: '停止'}]}],
  }},
 ];
}

async function createFixture({respond, onEvent, writeVault} = {}) {
 const parent = await fs.realpath(os.tmpdir());
 const root = await fs.mkdtemp(path.join(parent, 'zhixing-lifecycle-test-'));
 const requests = [];
 const events = [];
 const vaults = new Map();
 const serverErrors = [];
 const server = http.createServer(async (request, response) => {
  try {
   if (request.method !== 'POST' || !request.url.endsWith('/messages')) {
    response.writeHead(404).end();
    return;
   }
   const chunks = [];
   for await (const chunk of request) chunks.push(chunk);
   const body = JSON.parse(Buffer.concat(chunks).toString());
   requests.push(body);
   const content = respond(body, requests.length);
   const message = {
    id: `lifecycle-response-${requests.length}`, type: 'message', role: 'assistant', model: body.model, content,
    stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
    stop_sequence: null, usage: {input_tokens: 10, output_tokens: 10},
   };
   if (!body.stream) {
    response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(message));
    return;
   }
   response.writeHead(200, {'content-type': 'text/event-stream'});
   const send = (type, fields) => response.write(`event: ${type}\ndata: ${JSON.stringify({type, ...fields})}\n\n`);
   send('message_start', {message: {...message, content: [], stop_reason: null, usage: {input_tokens: 10, output_tokens: 0}}});
   for (const [index, block] of content.entries()) {
    send('content_block_start', {index, content_block: block.type === 'text' ? {type: 'text', text: ''} : {...block, input: {}}});
    send('content_block_delta', {index, delta: block.type === 'text'
     ? {type: 'text_delta', text: block.text}
     : {type: 'input_json_delta', partial_json: JSON.stringify(block.input)}});
    send('content_block_stop', {index});
   }
   send('message_delta', {delta: {stop_reason: message.stop_reason, stop_sequence: null}, usage: {output_tokens: 10}});
   send('message_stop', {});
   response.end();
  } catch (error) {
   serverErrors.push(error.message);
   response.writeHead(500).end();
  }
 });
 server.listen(0, '127.0.0.1');
 await once(server, 'listening');
 const config = {
  baseUrl: `http://127.0.0.1:${server.address().port}/anthropic`, model: 'lifecycle-fixture', reasoning: 'off',
  kernel: {webEnabled: false, workflowEnabled: false, subagentDepth: 0},
 };
 const manager = new RuntimeManager({
  root,
  readVault: async id => vaults.get(id),
  writeVault: async (id, value) => {
   await writeVault?.(id, value);
   vaults.set(id, value);
  },
  onEvent: event => {
   events.push(event);
   onEvent?.(event);
  },
 });
 return {
  root, config, manager, requests, events, vaults,
  async close() {
   try {
    await within(manager.close());
   } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    const resolved = await fs.realpath(root);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('zhixing-lifecycle-test-')) {
     // eslint-disable-next-line no-unsafe-finally -- Cleanup scope protection intentionally aborts deletion outside this fixture.
     throw new Error('Refusing to remove a directory outside this synthetic runtime fixture.');
    }
    await fs.rm(resolved, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
   }
   assert.deepEqual(serverErrors, []);
  },
 };
}

test('停止保留已生成正文，重复取消与关闭等待最终保存后仅发出一次终态', {timeout: 45000}, async () => {
 const draftReady = deferred();
 const questionReady = deferred();
 const saveStarted = deferred();
 const releaseSave = deferred();
 let holdFinalSave = false;
 let finalSaved = false;
 const fixture = await createFixture({
  respond: questionResponse,
  onEvent: event => {
   if (event.type === 'draft' && event.text === partialText) draftReady.resolve(event);
   if (event.type === 'question') questionReady.resolve(event);
  },
  writeVault: async () => {
   if (holdFinalSave) {
    saveStarted.resolve();
    await releaseSave.promise;
    finalSaved = true;
   }
  },
 });
 const {manager, config, events, requests} = fixture;
 const runId = 'cancel-after-output';
 const sessionId = 'cancel-output-chat';
 try {
  const run = manager.run({runId, sessionId, prompt: '先输出合成正文，再询问是否继续。', privacyMode: 'redact'}, config, fixtureKey);
  const stopped = assert.rejects(run, /停止/);
  await within(Promise.all([draftReady.promise, questionReady.promise]));
  const terminal = manager.waitForRun(runId);
  holdFinalSave = true;

  assert.deepEqual(await manager.cancel(runId), {cancelled: true, accepted: true});
  assert.deepEqual(await manager.cancel(runId), {cancelled: true, accepted: true});
  await within(saveStarted.promise);
  let closed = false;
  const closing = manager.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(closed, false);
  assert.equal(finalSaved, false);
  assert.equal(manager.runs.get(runId).status, 'cancelling');
  assert.equal(manager.runs.get(runId).partialText, partialText);
  assert.equal(manager.busy.has(sessionId), true);
  assert.equal(events.filter(event => event.type === 'run/terminal').length, 0);
  assert.equal(events.filter(event => event.type === 'draft').at(-1).text, partialText);

  releaseSave.resolve();
  const [, settled] = await within(Promise.all([stopped, terminal, closing]));
  assert.deepEqual(settled, {runId, sessionId, status: 'cancelled', finishReason: undefined, finalization: settled.finalization});
  assert.equal(settled.finalization.executionStatus, 'cancelled');
  assert.equal(settled.finalization.persistenceStatus, 'saved');
  assert.equal(settled.finalization.processStatus, 'exited');
  assert(Number.isSafeInteger(settled.finalization.eventWatermark) && settled.finalization.eventWatermark > 0);
  assert.equal(finalSaved, true);
  assert.equal(closed, true);
  assert.equal(manager.runs.size, 0);
  assert.equal(manager.busy.size, 0);
  assert.equal(manager.questions.size, 0);
  assert.equal(requests.length, 1);
  assert.deepEqual(events.filter(event => event.type === 'run/terminal'), [{runId, sessionId, type: 'run/terminal', status: 'cancelled', finalization: settled.finalization}]);
  assert.equal(events.filter(event => event.type === 'draft').at(-1).text, partialText);
  assert.deepEqual(await manager.cancel(runId), {cancelled: false, accepted: false, settled: true});
  const history = await readBridge(path.join(fixture.root, sessionId, 'history-redact', `${sessionId}.bin`), fixture.vaults.get(sessionId).historyKey);
  assert(history.events.some(event => event.type === 'assistant/message' && textOf(event.data.message) === partialText));
  await assert.rejects(fs.access(path.join(fixture.root, sessionId, 'privacy-bridge.bin')), {code: 'ENOENT'});
 } finally {
  releaseSave.resolve();
  await fixture.close();
 }
});

test('再次执行在真实模型请求与加密历史中追加相同交办和附件并保留原回答', {timeout: 45000}, async () => {
 const replies = ['合成首次回答，保留原有记录。', '合成再次执行回答，追加新记录。'];
 const fixture = await createFixture({respond: (body, count) => [{type: 'text', text: replies[count - 1]}]});
 const {manager, config, requests, events, vaults} = fixture;
 const sessionId = 'repeat-history-chat';
 const prompt = composePrompt('核对合成资料后给出结果。', [{name: '合成核对材料.txt', text: '仅供测试的材料，合计六项。'}]);
 const results = [];
 let firstMessages;
 const historyFile = path.join(fixture.root, sessionId, 'history-redact', `${sessionId}.bin`);
 try {
  for (const runId of ['initial-execution', 'repeat-execution']) {
   const preview = await manager.preview({sessionId, prompt, bootstrapPrompt: prompt, privacyMode: 'redact'}, config);
   results.push(await within(manager.runPrepared({runId, preparationId: preview.preparationId}, config, fixtureKey)));
   assert.deepEqual(await within(manager.waitForRun(runId)), {runId, sessionId, status: 'succeeded', finishReason: 'completed', finalization: results.at(-1).finalization});
   assert.equal(results.at(-1).finalization.executionStatus, 'completed');
   assert.equal(results.at(-1).finalization.persistenceStatus, 'saved');
   assert.equal(results.at(-1).finalization.processStatus, 'exited');
   if (runId === 'initial-execution') {
    const history = await readBridge(historyFile, vaults.get(sessionId).historyKey);
    firstMessages = history.events.filter(event => ['user/message', 'assistant/message'].includes(event.type));
    assert.equal(textOf(firstMessages[0].data), results[0].modelInput);
    assert.equal(textOf(firstMessages.at(-1).data.message), replies[0]);
   }
  }

  assert.deepEqual(results.map(result => result.text), replies);
  assert.equal(requests.length, 2);
  const firstInput = textOf(requests[0].messages[0]);
  const submittedInput = results[0].modelInput;
  assert.match(firstInput, /合成核对材料\.txt/);
  assert.match(firstInput, /仅供测试的材料，合计六项/);
  assert(firstInput.startsWith(submittedInput));
  assert.equal(results[1].modelInput, submittedInput);
  assert.deepEqual(requests[1].messages.map(message => ({role: message.role, text: textOf(message)})), [
   {role: 'user', text: firstInput},
   {role: 'assistant', text: replies[0]},
   {role: 'user', text: submittedInput},
  ]);

  const history = await readBridge(historyFile, vaults.get(sessionId).historyKey);
  const messages = history.events.filter(event => ['user/message', 'assistant/message'].includes(event.type));
  assert.deepEqual(messages.slice(0, firstMessages.length), firstMessages);
  assert.deepEqual(messages.slice(firstMessages.length).map(event => ({type: event.type, text: textOf(event.type === 'user/message' ? event.data : event.data.message)})), [
   {type: 'user/message', text: submittedInput},
   {type: 'assistant/message', text: replies[1]},
  ]);
  assert.equal((await fs.readFile(historyFile)).includes(Buffer.from(replies[0])), false);
  assert.deepEqual(events.filter(event => event.type === 'run/terminal').map(event => ({runId: event.runId, status: event.status})), [
   {runId: 'initial-execution', status: 'succeeded'},
   {runId: 'repeat-execution', status: 'succeeded'},
  ]);
  assert.equal(manager.runs.size, 0);
  assert.equal(manager.busy.size, 0);
 } finally {
  await fixture.close();
 }
});

test('原生取消通道失效时强制收尾标记 interrupted 并释放运行', {timeout: 45000}, async () => {
 const questionReady = deferred();
 const fixture = await createFixture({
  respond: questionResponse,
  onEvent: event => {
   if (event.type === 'question') questionReady.resolve();
  },
 });
 const {manager, config, events} = fixture;
 const runId = 'cancel-channel-failure';
 const sessionId = 'cancel-channel-chat';
 try {
  const run = manager.run({runId, sessionId, prompt: '输出合成正文后询问是否继续。', privacyMode: 'redact'}, config, fixtureKey);
  const stopped = assert.rejects(run, /停止/);
  await within(questionReady.promise);
  await fs.unlink(manager.runs.get(runId).cancellation.file);
  const terminal = manager.waitForRun(runId);
  assert.deepEqual(await manager.cancel(runId), {cancelled: true, accepted: true});
  const [, settled] = await within(Promise.all([stopped, terminal]));

  assert.equal(settled.status, 'interrupted');
  assert.deepEqual(events.filter(event => event.type === 'run/terminal'), [{runId, sessionId, type: 'run/terminal', status: 'interrupted', finalization: settled.finalization}]);
  assert.equal(settled.finalization.executionStatus, 'cancelled');
  assert.equal(settled.finalization.persistenceStatus, 'saved');
  assert.equal(settled.finalization.processStatus, 'exited');
  assert.equal(manager.runs.size, 0);
  assert.equal(manager.busy.size, 0);
  assert.equal(manager.questions.size, 0);
  assert.deepEqual(await manager.cancel(runId), {cancelled: false, accepted: false, settled: true});
 } finally {
  await fixture.close();
 }
});

for (const protocol of ['openai', 'deepseek']) {
 test(`${protocol} 首个流式 chunk 后取消保留原生前缀并等待保存、连接及运行收尾`, {timeout: 45000}, async () => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-stream-cancel-'));
  const firstChunk = deferred();
  const disconnected = deferred();
  const finalSaveStarted = deferred();
  const releaseFinalSave = deferred();
  const vaults = new Map();
  const events = [];
  const emitted = [];
  const timers = new Set();
  let holdFinalSave = false;
  let requests = 0;
  const server = http.createServer(async (request, response) => {
   const chunks = [];
   for await (const chunk of request) chunks.push(chunk);
   const body = JSON.parse(Buffer.concat(chunks).toString());
   requests++;
   assert.equal(body.stream, true);
   response.writeHead(200, {'content-type': 'text/event-stream'});
   const sendMessages = (type, fields) => response.write(`event: ${type}\ndata: ${JSON.stringify({type, ...fields})}\n\n`);
   const sendChat = delta => response.write(`data: ${JSON.stringify({
    id: 'stream-cancel-response', object: 'chat.completion.chunk', created: 1,
    model: body.model, choices: [{index: 0, delta, finish_reason: null}],
   })}\n\n`);
   if (protocol === 'openai') sendChat({role: 'assistant', content: ''});
   else {
    sendMessages('message_start', {message: {
     id: 'stream-cancel-response', type: 'message', role: 'assistant', model: body.model,
     content: [], stop_reason: null, usage: {input_tokens: 10, output_tokens: 0},
    }});
    sendMessages('content_block_start', {index: 0, content_block: {type: 'text', text: ''}});
   }
   // This response never sends a finish marker. Only native cancellation can
   // turn its delivered prefix into the durable interrupted assistant message.
   const timer = setInterval(() => {
    const text = `QA_LONG_CHUNK_${String(emitted.length + 1).padStart(3, '0')} 合成流式正文。\n`;
    emitted.push(text);
    if (protocol === 'openai') sendChat({content: text});
    else sendMessages('content_block_delta', {index: 0, delta: {type: 'text_delta', text}});
    firstChunk.resolve();
   }, 500);
   timers.add(timer);
   response.once('close', () => {
    clearInterval(timer);
    timers.delete(timer);
    disconnected.resolve();
   });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const runId = `stream-cancel-${protocol}`;
  const sessionId = `stream-chat-${protocol}`;
  const config = {
   baseUrl: `http://127.0.0.1:${server.address().port}${protocol === 'openai' ? '/v1' : '/anthropic'}`,
   model: 'stream-fixture', protocol, reasoning: 'off', reasoningMap: false,
   kernel: {webEnabled: false, workflowEnabled: false, subagentDepth: 0},
  };
  const manager = new RuntimeManager({
   root,
   readVault: async id => vaults.get(id),
   writeVault: async (id, value) => {
    if (holdFinalSave) {
     finalSaveStarted.resolve();
     await releaseFinalSave.promise;
    }
    vaults.set(id, value);
   },
   onEvent: event => events.push(event),
  });
  try {
   const run = manager.run({runId, sessionId, prompt: 'QA_LONG 请持续输出合成正文。', privacyMode: 'redact'}, config, 'synthetic-stream-key');
   const stopped = assert.rejects(run, /停止/);
   await within(firstChunk.promise);
   // Match the UI journey after the service reports first-chunk, allowing the
   // loopback reader to consume the bytes while the provider is still streaming.
   await new Promise(resolve => setTimeout(resolve, 150));
   holdFinalSave = true;
   const terminal = manager.waitForRun(runId);
   assert.deepEqual(await manager.cancel(runId), {cancelled: true, accepted: true});
   let closed = false;
   const closing = manager.close().then(() => { closed = true; });
   await within(finalSaveStarted.promise);
   const draft = events.filter(event => event.type === 'draft').at(-1);
   assert(draft?.text.includes('QA_LONG_CHUNK_001'), 'Native interrupted assistant prefix must reach draft before terminal');
   assert.equal(events.some(event => event.type === 'run/terminal'), false);
   assert.equal(closed, false);
   assert.equal(manager.busy.has(sessionId), true);

   releaseFinalSave.resolve();
   const [, settled] = await within(Promise.all([stopped, terminal, closing, disconnected.promise]));
   assert.equal(settled.status, 'cancelled');
   assert.equal(manager.runs.size, 0);
   assert.equal(manager.busy.size, 0);
   assert.equal(timers.size, 0);
   assert.equal(requests, 1);
   assert.equal(events.filter(event => event.type === 'run/terminal').length, 1);
   assert(events.indexOf(draft) < events.findIndex(event => event.type === 'run/terminal'));

   const history = await readBridge(path.join(root, sessionId, 'history-redact', `${sessionId}.bin`), vaults.get(sessionId).historyKey);
   const assistant = history.events.findLast(event => event.type === 'assistant/message');
   assert.equal(assistant?.data.interrupted, true);
   const preserved = assistant.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('');
   assert.equal(preserved, draft.text);
   assert(preserved.startsWith(emitted[0]));
   assert(emitted.join('').startsWith(preserved));
  } finally {
   releaseFinalSave.resolve();
   await within(manager.close());
   for (const timer of timers) clearInterval(timer);
   server.closeAllConnections();
   await new Promise(resolve => server.close(resolve));
   const resolved = await fs.realpath(root);
   if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('zhixing-stream-cancel-')) {
    // eslint-disable-next-line no-unsafe-finally -- Cleanup scope protection intentionally aborts deletion outside this fixture.
    throw new Error('Refusing to remove a directory outside the synthetic streaming fixture.');
   }
   await fs.rm(resolved, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
  }
 });
}

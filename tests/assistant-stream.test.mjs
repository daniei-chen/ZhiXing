import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
const moduleUrl = name => process.env.ZHIXING_TEST_PACKED_APP ? pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP, name)).href : new URL(`../${name}`, import.meta.url).href;
const {AssistantTextStream, createAssistantStreamDecoder}=await import(moduleUrl('electron/assistant-stream.mjs'));
const {startPrivacyGateway}=await import(moduleUrl('electron/privacy-gateway.mjs'));
const {createBridgeKey, writeBridge}=await import(moduleUrl('harness/privacy-bridge.mjs'));
const {PrivacySession}=await import(moduleUrl('src/privacy-core.js'));

function frame(type, attemptId, index, text = '') {
  return type === 'chunk'
    ? {type, attemptId, index, chunk: {type: 'text-delta', index: 0, text}}
    : {type, attemptId, revision: index, index: type === 'end' ? 0 : undefined, outcome: {kind: 'committed', eventType: 'assistant/message', seq: 1}};
}

test('live assistant previews retain ordered cumulative text and publish the final held suffix', () => {
  const stream = new AssistantTextStream({session: new PrivacySession('stream-live')});
  stream.push(frame('start', 'attempt-1', 1));
  for (let index = 0; index < 18; index++) stream.push(frame('chunk', 'attempt-1', index, `QA_LONG_CHUNK_${index.toString().padStart(3, '0')} 正在本机生成正文。\n`));

  const duringRun = stream.push(frame('chunk', 'attempt-1', 18, '更多正文正在继续输出。'));
  assert.equal(duringRun.changed, true);
  assert(duringRun.text.includes('QA_LONG_CHUNK_000'));
  const completed = stream.push(frame('end', 'attempt-1', 19));
  assert.equal(completed.changed, true);
  assert(completed.text.includes('更多正文正在继续输出。'));
  assert(completed.text.startsWith(duringRun.text));
});

test('live assistant previews restore values authorized by the earlier user prompt', () => {
  const session = new PrivacySession('stream-sensitive');
  const original = session.protect('联系人：张三，电话：138-0000-0000。');
  const person = session.entries().find(entry => entry.type === 'PERSON').token;
  const phone = session.entries().find(entry => entry.type === 'PHONE').token;
  const stream = new AssistantTextStream({session});
  stream.push(frame('start', 'attempt-1', 1));
  stream.push(frame('chunk', 'attempt-1', 0, `${'会议纪要内容需要足够长以便验证本地流式预览保护。'.repeat(14)}联系人：${person}，电话：${phone}。`));
  const result = stream.push(frame('end', 'attempt-1', 2));
  assert(result.text.includes('张三'));
  assert(result.text.includes('138-0000-0000'));
  assert(!original.blocked);
});

test('newly detected sensitive output stays masked in streaming and cancelled previews', () => {
  const session = new PrivacySession('stream-new-sensitive');
  const stream = new AssistantTextStream({session});
  stream.beginAttempt();
  stream.appendText(`${'本地生成的普通内容足够长，可验证逐段正文可以正常展示。'.repeat(14)}联系人：张三，电话：138-0000-0000。`);
  const partial = stream.text;
  const result = stream.finishAttempt();
  assert(!result.text.includes('张三'));
  assert(!result.text.includes('138-0000-0000'));
  assert(result.text.includes('已隐藏'));
  assert(partial === '' || !partial.includes('张三') && !partial.includes('138-0000-0000'));
});

test('arbitrary long API keys remain buffered until they can be blocked', () => {
  const credential = `custom-${'x'.repeat(400)}`;
  const stream = new AssistantTextStream({session: new PrivacySession('stream-long-key'), apiKey: credential});
  stream.beginAttempt();
  const prefix = stream.appendText(`普通正文 ${credential.slice(0, 350)}`);
  assert.equal(prefix.text, '普通正文 ');
  assert(!prefix.text.includes(credential.slice(0, 40)));
  const blocked = stream.appendText(credential.slice(350));
  assert.equal(blocked.blocked, true);
});

test('live assistant previews block credentials and discard delayed or out-of-order frames', () => {
  const credential = 'sk-test-sensitive-value-123456';
  const stream = new AssistantTextStream({session: new PrivacySession('stream-key'), apiKey: credential});
  stream.push(frame('start', 'attempt-1', 1));
  assert.equal(stream.push(frame('chunk', 'attempt-1', 1, '晚到的片段应该丢弃。')), false);
  const partial = stream.push(frame('chunk', 'attempt-1', 0, `${'服务正在生成足够长的状态说明。'.repeat(14)} ${credential}`));
  const blocked = stream.push(frame('end', 'attempt-1', 2));
  assert.equal(partial.blocked, true);
  assert.equal(blocked.blocked, true);
  assert.equal(stream.beginAttempt().blocked, true);
  assert.equal(stream.appendText('后续尝试也不能恢复凭证片段。').blocked, true);
});

test('live assistant preview decodes fragmented OpenAI and Anthropic text events only', () => {
  const pieces = [];
  const decoder = createAssistantStreamDecoder(text => pieces.push(text));
  const source = [
    `data: ${JSON.stringify({choices: [{delta: {content: '第一段'}}]})}\r\n\r\n`,
    `data: ${JSON.stringify({choices: [{delta: {tool_calls: [{index: 0, function: {arguments: '{"x":1}'}}]}}]})}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({type: 'content_block_delta', delta: {type: 'text_delta', text: '第二段'}})}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  const bytes = Buffer.from(source);
  decoder.push(bytes.subarray(0, 31));
  decoder.push(bytes.subarray(31, 107));
  decoder.push(bytes.subarray(107));
  assert.equal(decoder.finish(), 'commit');
  assert.deepEqual(pieces, ['第一段', '第二段']);
});

test('live assistant decoder handles standalone CR and refuses to commit truncated transport output', () => {
  const pieces = [];
  const decoder = createAssistantStreamDecoder(text => pieces.push(text));
  const first = `data: ${JSON.stringify({choices: [{delta: {content: '临时前缀'}}]})}\r`;
  decoder.push(Buffer.from(first));
  decoder.push(Buffer.from('\r'));
  decoder.push(Buffer.from('x'));
  assert.deepEqual(pieces, ['临时前缀']);
  assert.equal(decoder.finish(), 'abort');
});

test('live assistant preview assembles attempts without exposing held text or losing the final suffix', () => {
  const stream = new AssistantTextStream({session: new PrivacySession('stream-attempts')});
  stream.beginAttempt();
  const duringRun = stream.appendText('X'.repeat(360));
  assert.equal(duringRun.changed, true);
  assert.equal(duringRun.text.length, 40);
  stream.finishAttempt();
  stream.beginAttempt();
  stream.appendText('第二次请求生成的尾段。');
  const completed = stream.finishAttempt();
  assert(completed.text.startsWith('X'.repeat(360)));
  assert(completed.text.endsWith('第二次请求生成的尾段。'));
});

test('failed model retries roll back abandoned partial output before the final attempt', () => {
  const stream = new AssistantTextStream({session: new PrivacySession('stream-retry')});
  stream.beginAttempt();
  stream.appendText(`${'这是失败请求的未完成前缀。'.repeat(30)}`);
  const rolledBack = stream.finishAttempt(false);
  assert.equal(rolledBack.text, '');
  stream.beginAttempt();
  stream.appendText(`${'这是重试后的完整内容。'.repeat(30)}`);
  const completed = stream.finishAttempt(true);
  assert(completed.text.startsWith('这是重试后的完整内容。'));
  assert(!completed.text.includes('失败请求'));
});

test('the local privacy gateway forwards live provider text while preserving the wire response', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-assistant-gateway-'));
  const bridgeFile = path.join(root, 'privacy.bin');
  const bridgeKey = createBridgeKey();
  const session = new PrivacySession('gateway-stream');
  await writeBridge(bridgeFile, bridgeKey, session.exportState());
  const forwarded = [];
  const requests = [];
  const frames = [
    {choices: [{delta: {content: '本机流式内容'}}]},
    {choices: [{delta: {content: '第二段。'}}]},
    '[DONE]',
  ];
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) { void chunk; } // Drain the synthetic request before sending SSE.
    requests.push(req.url);
    res.writeHead(200, {'content-type': 'text/event-stream'});
    for (const frame of frames) {
      const data = typeof frame === 'string' ? frame : JSON.stringify(frame);
      res.write(`data: ${data}\n\n`);
    }
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const upstream = `http://127.0.0.1:${server.address().port}/v1`;
  const gateway = await startPrivacyGateway({baseUrl: upstream, protocol: 'openai', apiKey: 'synthetic-provider-key', bridgeFile, bridgeKey,
    privacyMode: 'redact', onAssistantText: event => forwarded.push(event)});
  try {
    const response = await fetch(`${gateway.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {authorization: `Bearer ${gateway.apiKey}`, 'content-type': 'application/json'},
      body: JSON.stringify({model: 'fixture', stream: true, messages: [{role: 'user', content: '只验证本机流式回传。'}]}),
    });
    const wire = await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(requests, ['/v1/chat/completions']);
    assert.deepEqual(forwarded, [
      {type: 'start'},
      {type: 'delta', text: '本机流式内容'},
      {type: 'delta', text: '第二段。'},
      {type: 'end'},
    ]);
    assert(wire.includes('本机流式内容'));
    assert(wire.includes('第二段。'));
  } finally {
    await gateway.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
    await fs.rm(resolved, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
  }
});

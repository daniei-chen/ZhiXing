import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { prepareVisualAttachment, readVisualAttachment } from '../electron/visual-attachments.mjs';
import { RuntimeManager } from '../electron/runtime.mjs';

function response(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  emit('message_start', { type: 'message_start', message: { id: 'vision-fixture', type: 'message', role: 'assistant', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 2 } } });
  emit('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  emit('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'VISION_OK' } });
  emit('content_block_stop', { type: 'content_block_stop', index: 0 });
  emit('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } });
  emit('message_stop', { type: 'message_stop' });
  res.end();
}

test('Windows visual input sends only the locally masked image through the native Harness route', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const fixture = path.join(import.meta.dirname, 'fixtures', 'ocr-office-read.png');
  const original = await fs.readFile(fixture);
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-vision-'));
  const visualRoot = path.join(root, 'visual');
  const requests = [];
  let server;
  let manager;
  try {
    const prepared = await prepareVisualAttachment({ root: visualRoot, name: 'source.png', bytes: original, privacyMode: 'redact' });
    if (!prepared.maskCount) return t.skip('Windows OCR did not return a sensitive word box for the fixture');
    const masked = await readVisualAttachment(visualRoot, prepared, 'redact');
    assert.notEqual(masked.sha256, prepared.originalSha256);
    assert.notEqual(masked.data, original.toString('base64'));

    server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      requests.push(body);
      response(res);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const vaults = new Map();
    manager = new RuntimeManager({ root, readVault: async id => vaults.get(id), writeVault: async (id, value) => vaults.set(id, value), onEvent: () => {} });
    const config = {
      baseUrl: `http://127.0.0.1:${server.address().port}/anthropic`,
      protocol: 'deepseek', providerId: 'deepseek', model: 'deepseek-flash', reasoning: 'off',
      inputModalities: ['text', 'image'], workspaceRoot: root, permission: 'full', persist: false,
    };
    const result = await manager.run({
      runId: 'vision-run', sessionId: 'vision-run', prompt: '请看 source.png 并确认已收到视觉输入。', privacyMode: 'redact',
      visualAttachments: [{ ...masked, name: 'source.png' }],
    }, config, 'vision-fixture-key');
    assert.equal(result.text, 'VISION_OK');
    assert.equal(requests.length, 1);
    const wire = JSON.stringify(requests[0]);
    assert(wire.includes(masked.data), 'masked image bytes did not reach the upstream model');
    assert(!wire.includes(original.toString('base64')), 'original image bytes reached the upstream model');
    assert.match(wire, /"type":"image"/);
  } catch (error) {
    if (/安装具有文字识别功能的语言/.test(error.message)) return t.skip('Windows 未安装 OCR 语言');
    throw error;
  } finally {
    await manager?.close();
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    const resolved = await fs.realpath(root);
    if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('zhixing-vision-')) await fs.rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
});

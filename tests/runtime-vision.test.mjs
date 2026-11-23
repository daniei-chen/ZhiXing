import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const app = process.env.ZHIXING_TEST_PACKED_APP || path.resolve(import.meta.dirname, '..');
const url = file => pathToFileURL(path.join(app, file)).href;
const sharp = createRequire(url('package.json'))('sharp');
const { prepareVisualAttachment, readVisualAttachment, visionPrivacy } = await import(url('electron/visual-attachments.mjs'));
const { recognizeImage } = await import(url('electron/ocr-service.mjs'));
const { RuntimeManager } = await import(url('electron/runtime.mjs'));
const { startPrivacyGateway } = await import(url('electron/privacy-gateway.mjs'));
const { createBridgeKey, writeBridge } = await import(url('harness/privacy-bridge.mjs'));
const { PrivacySession } = await import(url('src/privacy-core.js'));
const windows = { skip: process.platform !== 'win32', timeout: 90000 };
const phone = '13800000000';
const fixture = () => fs.readFile(path.join(import.meta.dirname, 'fixtures', 'ocr-office-read.png'));

async function temporaryRoot(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-vision-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert(path.basename(resolved).startsWith('zhixing-vision-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  });
  return root;
}

function respond(res, body, openai) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (openai) {
    const chunk = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({
      id: 'vision-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    }) + '\n\n');
    chunk({ role: 'assistant', content: 'VISION_OK' });
    chunk({}, 'stop');
    return res.end('data: [DONE]\n\n');
  }
  const emit = (type, data) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n');
  emit('message_start', { message: { id: 'vision-fixture', type: 'message', role: 'assistant', content: [], stop_reason: null, model: body.model, usage: { input_tokens: 10, output_tokens: 0 } } });
  emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'VISION_OK' } });
  emit('content_block_stop', { index: 0 });
  emit('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } });
  emit('message_stop', {});
  res.end();
}

async function receiver() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests.push({ body, path: req.url });
    respond(res, body, req.url.endsWith('/chat/completions'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { requests, url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }) };
}

test('Windows image privacy masks the actual pixels, removes metadata with zero hits, and handles no-text images', windows, async () => {
  const original = await fixture();
  const privacy = visionPrivacy();
  const { record, parsed } = await prepareVisualAttachment({ name: 'source.png', bytes: original, privacy });
  assert(parsed.visual.maskCount > 0, 'The supported Windows Gate must detect the synthetic phone');
  assert.match(parsed.text, /13800000000/);
  assert(!Object.hasOwn(parsed.visual, 'data'));
  assert(!Object.hasOwn(parsed, 'layout'));
  const wire = Buffer.from(readVisualAttachment(record, parsed.visual.visualId, privacy.key).data, 'base64');
  assert(!wire.equals(original));
  const protectedRead = await recognizeImage('protected.png', wire, { allowEmpty: true });
  assert(!protectedRead.text.replace(/\D+/g, '').includes(phone), 'Sensitive fixture pixels remain readable');

  const tag = 'SYNTHETIC_PRIVATE_EXIF';
  const jpeg = await sharp(original).withExif({ IFD0: { ImageDescription: tag } }).jpeg().toBuffer();
  assert(jpeg.includes(Buffer.from(tag)));
  const zero = await prepareVisualAttachment({ name: 'meta.jpg', bytes: jpeg, privacy: visionPrivacy({ privacyPolicy: { actions: { PHONE: 'allow' } } }) });
  assert.equal(zero.parsed.visual.maskCount, 0);
  const clean = Buffer.from(zero.record.data, 'base64');
  assert.equal((await sharp(clean).metadata()).format, zero.record.mediaType.split('/')[1]);
  assert(!clean.equals(jpeg));
  assert(!clean.includes(Buffer.from(tag)));
  assert.equal((await sharp(clean).metadata()).exif, undefined);

  const blank = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#fafafa' } }).png().toBuffer();
  const noText = await prepareVisualAttachment({ name: 'shape.png', bytes: blank, privacy });
  assert.equal(noText.parsed.text, '');
  assert.equal(noText.parsed.visual.maskCount, 0);
  assert.match(noText.parsed.coverage.notice, /未读到文字/);
  assert.notEqual(noText.record.data, blank.toString('base64'));

  const sideways = await sharp(original).rotate(270).jpeg().toBuffer();
  const rotated = await sharp(sideways).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  assert.equal((await sharp(rotated).metadata()).orientation, 6);
  const rotatedImage = await prepareVisualAttachment({ name: 'rotated.jpg', bytes: rotated, privacy });
  assert(rotatedImage.parsed.visual.maskCount > 0, 'OCR and masking must agree after EXIF orientation');
  const rotatedRead = await recognizeImage('protected.png', Buffer.from(rotatedImage.record.data, 'base64'), { allowEmpty: true });
  assert(!rotatedRead.text.replace(/\D+/g, '').includes(phone));

  const raw = visionPrivacy({ privacyMode: 'raw' });
  const rawImage = await prepareVisualAttachment({ name: 'source.png', bytes: original, privacy: raw });
  assert.equal(rawImage.parsed.visual.maskCount, 0);
  assert.notEqual(rawImage.record.data, original.toString('base64'));
  assert.match((await recognizeImage('raw.png', Buffer.from(rawImage.record.data, 'base64'))).text, /13800000000/);
  await assert.rejects(prepareVisualAttachment({ name: 'source.png', bytes: original, privacy: visionPrivacy({ privacyMode: 'raw' }, [phone]) }), /已配置的凭证/);
  assert.throws(() => readVisualAttachment(record, parsed.visual.visualId, raw.key), /规则已变化/);
  assert.throws(() => readVisualAttachment(record, parsed.visual.visualId, visionPrivacy({ customTerms: ['新词'] }).key), /规则已变化/);
});

function assertWire(request, record, original) {
  const blocks = request.body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
  const images = blocks.filter(block => block.type === 'image' || block.type === 'image_url');
  assert.equal(images.length, 1);
  if (request.path.endsWith('/chat/completions')) {
    assert.equal(images[0].image_url.url, 'data:' + record.mediaType + ';base64,' + record.data);
  } else {
    assert.deepEqual(images[0].source, { type: 'base64', media_type: record.mediaType, data: record.data });
  }
  const wireText = JSON.stringify(request.body);
  assert(!wireText.includes(original.toString('base64')));
  assert(!wireText.includes(phone));
}

test('Windows WebP 和单帧 GIF 复用同一遮罩链，动图与伪装扩展名被拒绝', windows, async () => {
 const original = await fixture();
 const privacy = visionPrivacy();
 for (const [name, bytes] of [
  ['source.webp', await sharp(original).webp({ lossless: true }).toBuffer()],
  ['lossy.webp', await sharp(original).webp({ quality: 92 }).toBuffer()],
  ['source.gif', await sharp(original).gif().toBuffer()],
 ]) {
  const { record, parsed } = await prepareVisualAttachment({ name, bytes, privacy });
  assert.equal(record.mediaType, 'image/png');
  assert(parsed.visual.maskCount > 0, name + ' 应命中同一处合成手机号');
  assert.match(parsed.text, /13800000000/);
  const wire = Buffer.from(readVisualAttachment(record, parsed.visual.visualId, privacy.key).data, 'base64');
  assert(!wire.equals(bytes));
  const reread = await recognizeImage('wire.png', wire, { allowEmpty: true });
  assert(!reread.text.replace(/\D+/g, '').includes(phone), name + ' 的出站副本仍可读出手机号');
 }
 const meta = await sharp(original).metadata();
 const second = await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 1 } } }).png().toBuffer();
 await assert.rejects(prepareVisualAttachment({ name: 'animated.gif', bytes: await sharp([original, second], { join: { animated: true } }).gif().toBuffer(), privacy }), /多个画面/);
 await assert.rejects(prepareVisualAttachment({ name: 'animated.webp', bytes: await sharp([original, second], { join: { animated: true } }).webp().toBuffer(), privacy }), /多个画面/);
 await assert.rejects(prepareVisualAttachment({ name: 'renamed.png', bytes: await sharp(original).webp({ lossless: true }).toBuffer(), privacy }), /格式与文件名不符/);
 await assert.rejects(prepareVisualAttachment({ name: 'source.bmp', bytes: original, privacy }), /10 MB 以内/);
});

test('Windows 项目图片路径接受 WebP 与单帧 GIF，副本仍统一为 PNG', windows, async t => {
 const root = await temporaryRoot(t);
 const original = await fixture();
 const privacy = visionPrivacy();
 const { readProjectVision } = await import(url('electron/office-visual.mjs'));
 await fs.writeFile(path.join(root, 'photo.webp'), await sharp(original).webp({ lossless: true }).toBuffer());
 await fs.writeFile(path.join(root, 'photo.gif'), await sharp(original).gif().toBuffer());
 for (const name of ['photo.webp', 'photo.gif']) {
  const { records } = await readProjectVision(root, name, privacy);
  assert.equal(records.length, 1);
  assert.equal(records[0].mediaType, 'image/png');
  assert(!Buffer.from(records[0].data, 'base64').equals(original));
 }
 await assert.rejects(readProjectVision(root, 'photo.bmp', privacy), /单帧 PNG、JPEG、WebP 或 GIF/);
});

test('Windows real Harness sends only approved pixels and retains approved visual history on reopen', windows, async t => {
  const root = await temporaryRoot(t);
  const original = await fixture();
  const privacy = visionPrivacy();
  const { record } = await prepareVisualAttachment({ name: 'source.png', bytes: original, privacy });
  const modelService = await receiver();
  const vaults = new Map();
  const openManager = () => new RuntimeManager({
    root, readVault: async id => vaults.get(id), writeVault: async (id, value) => vaults.set(id, value), onEvent: () => {},
  });
  let manager = openManager();
  try {
    const baseConfig = { model: 'deepseek-flash', reasoning: 'off', reasoningMap: false, permission: 'ask', inputModalities: ['text', 'image'], visualPolicyKey: privacy.key };
    for (const [protocol, route, suffix] of [['deepseek', '/anthropic', '/v1/messages'], ['anthropic', '/messages', '/v1/messages'], ['openai', '/chat/v1', '/chat/completions']]) {
      const config = { ...baseConfig, baseUrl: modelService.url + route, protocol, providerId: protocol };
      const options = { runId: protocol + '-first', sessionId: protocol, prompt: '请辨认图片中的形状。电话 ' + phone, privacyMode: 'redact', visualAttachments: [record] };
      const before = modelService.requests.length;
      await assert.rejects(manager.preview(options, { ...config, inputModalities: ['text'] }), { code: 'VISION_MODEL_UNSUPPORTED' });
      assert.equal(modelService.requests.length, before);
      const preview = await manager.preview(options, config);
      assert(preview.preparationId);
      assert.notEqual(preview.text, options.prompt);
      const result = await manager.runPrepared({ preparationId: preview.preparationId, runId: options.runId }, config, 'vision-fixture-key');
      assert.equal(result.finishReason, 'completed', result.text);
      assert.equal(result.text, 'VISION_OK');
      assert.equal(modelService.requests.length, before + 1);
      const request = modelService.requests.at(-1);
      assert.equal(request.path, route + suffix);
      assert.equal(request.body.model, baseConfig.model);
      assertWire(request, record, original);
      const capability = result.context.capabilityManifest.entries.find(item => item.id === 'vision-input');
      assert.equal(capability.effective, true, JSON.stringify(capability));
      assert.equal(capability.invocation, 'image_input');
      if (protocol !== 'deepseek') continue;

      assert(!JSON.stringify(vaults.get(protocol)).includes(record.data));
      await manager.close();
      manager = openManager();
      const followup = { runId: 'visual-followup', sessionId: protocol, prompt: '继续按上一张图回答。', privacyMode: 'redact' };
      const second = await manager.run(followup, config, 'vision-fixture-key');
      assert.equal(second.text, 'VISION_OK');
      assert.equal(modelService.requests.length, before + 2);
      assertWire(modelService.requests.at(-1), record, original);
      await assert.rejects(manager.preview(followup, { ...config, visualPolicyKey: visionPrivacy({ customTerms: ['新规则'] }).key }), { code: 'VISION_HISTORY_STALE' });
      assert.equal(modelService.requests.length, before + 2);
    }
  } finally {
    await manager.close();
    await modelService.close();
  }
});

test('model gateway forwards only the approved image representation in both wire formats', windows, async t => {
  const root = await temporaryRoot(t);
  const original = await fixture();
  const { record } = await prepareVisualAttachment({ name: 'source.png', bytes: original, privacy: visionPrivacy() });
  const modelService = await receiver();
  try {
    for (const protocol of ['deepseek', 'openai']) {
      const openai = protocol === 'openai';
      const bridgeFile = path.join(root, protocol + '.bin'), bridgeKey = createBridgeKey();
      await writeBridge(bridgeFile, bridgeKey, new PrivacySession('fixture').exportState());
      const gateway = await startPrivacyGateway({
        protocol, baseUrl: modelService.url, apiKey: 'visual-gateway-key', bridgeFile, bridgeKey,
        privacyMode: 'redact', visualAttachments: [{ sha256: record.sha256, bytes: record.bytes, mediaType: record.mediaType }],
      });
      try {
        const block = (type, data) => openai ? { type: 'image_url', image_url: { url: 'data:' + type + ';base64,' + data } } : { type: 'image', source: { type: 'base64', media_type: type, data } };
        async function send(content) {
          const response = await fetch(gateway.baseUrl + (openai ? '/chat/completions' : '/v1/messages'), {
            method: 'POST', headers: { 'content-type': 'application/json', ...(openai ? { authorization: 'Bearer ' + gateway.apiKey } : { 'x-api-key': gateway.apiKey }) },
            body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: [content] }] }),
          });
          await response.text();
          return response.status;
        }
        const before = modelService.requests.length;
        assert.equal(await send(block(record.mediaType, original.toString('base64'))), 400);
        assert.equal(await send(block('image/jpeg', record.data)), 400);
        assert.equal(modelService.requests.length, before);
        assert.equal(await send(block(record.mediaType, record.data)), 200);
        assert.equal(modelService.requests.length, before + 1);
        assertWire(modelService.requests.at(-1), record, original);
      } finally { await gateway.close(); }
    }
  } finally { await modelService.close(); }
});

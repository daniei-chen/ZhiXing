import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const root = process.env.ZHIXING_TEST_PACKED_APP || path.resolve(import.meta.dirname, '..');
const {DeliveryService} = await import(pathToFileURL(path.join(root, 'electron/delivery-service.mjs')));
const {exportOfficeFile} = await import(pathToFileURL(path.join(root, 'electron/office-files.mjs')));
const require = createRequire(path.join(root, 'package.json'));
const {unzipSync, strFromU8} = require('fflate');
const ExcelJS = require('exceljs');
const binding = review => Object.fromEntries(['reviewId', 'contentHash', 'policyRevision', 'recipientScope', 'format'].map(key => [key, review[key]]));

function fixture() {
  const settings = {privacyMode: 'redact', customTerms: ['合成机密部门'], privacyPolicy: {secretPrefixes: ['zxcorp_']}};
  const keys = ['fixture-config-key-123'];
  const service = new DeliveryService({getSettings: () => settings, getSecrets: () => keys});
  return {settings, keys, service};
}

test('交付快照继承当前规则，旧 masked 不能复活自定义秘密；raw/self 也不能绕过凭据', () => {
  const {service, settings, keys} = fixture();
  for (const privacyMode of ['raw', 'redact']) for (const recipientScope of ['recipient', 'self']) for (const masked of [undefined, '', '历史已隐藏版']) {
    settings.privacyMode = privacyMode;
    for (const original of ['合成值 zxcorp_ABCDEF1234567890', `合成值 ${keys[0]}`]) {
      const snapshot = service.prepare({original, masked, recipientScope});
      assert.equal(snapshot.blocked, true);
      assert.deepEqual(snapshot.allowedActions, []);
      assert(!snapshot.text.includes('ABCDEF1234567890'));
      assert(!snapshot.text.includes(keys[0]));
      assert.throws(() => service.resolve(binding(snapshot), 'export'), {code: 'DELIVERY_BLOCKED'});
    }
  }
});

test('TXT/DOCX/XLSX 与剪贴板的真实内容来自同一主机策略快照', async () => {
  const {service, settings} = fixture();
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'zhixing-delivery-review-'));
  const original = '合成机密部门\n电话13800000000\n普通成果';
  const texts = [];
  try {
    settings.privacyMode = 'raw';
    for (const format of ['txt', 'docx', 'xlsx']) {
      const review = service.prepare({original, format});
      assert(!review.blocked);
      const target = path.join(directory, `result.${format}`);
      await service.execute(binding(review), 'export', async (snapshot, validate) => {
        assert.equal(validate().text, snapshot.text);
        await fs.writeFile(target, await exportOfficeFile(snapshot.text, format));
        return {path: target};
      });
      const bytes = await fs.readFile(target);
      let decoded;
      if (format === 'txt') decoded = bytes.toString('utf8');
      if (format === 'docx') decoded = strFromU8(unzipSync(bytes)['word/document.xml']);
      if (format === 'xlsx') {
        const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
        decoded = book.worksheets[0].getSheetValues().map(row => row?.slice(1).join('\t')).filter(Boolean).join('\n');
      }
      assert(!decoded.includes('13800000000'));
      assert(!decoded.includes('合成机密部门'));
      assert(decoded.includes('普通成果'));
      assert(!decoded.includes('⟦ZX-'));
      texts.push(review.text);
      assert.throws(() => service.resolve(binding(review), 'export'), {code: 'DELIVERY_REVIEW_EXPIRED'});
    }
    const review = service.prepare({original, action: 'share'});
    let clipboard;
    await service.execute(binding(review), 'share', async snapshot => {clipboard = snapshot.text; return {copied: true};});
    assert(!clipboard.includes('13800000000'));
    assert(!clipboard.includes('合成机密部门'));
    assert(clipboard.includes('普通成果'));
    // Tokens are replaced with category labels, so independent reviews produce identical bytes.
    assert(texts.every(value => value === clipboard));
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});

test('本人版普通个人信息允许保留，显式禁止类别继续阻止全部交付入口', () => {
  const {service, settings} = fixture();
  const original = '电话13800000000';
  assert.equal(service.prepare({original, recipientScope: 'self'}).text, original);
  settings.privacyPolicy.actions = {PHONE: 'block'};
  for (const action of ['share', 'export']) for (const recipientScope of ['self', 'recipient']) {
    const review = service.prepare({original, action, recipientScope});
    assert(review.blocked);
    assert.throws(() => service.resolve(binding(review), action), {code: 'DELIVERY_BLOCKED'});
  }
});

test('审阅绑定内容、策略、格式、接收范围与动作；修改规则/模式/凭据后禁止复用', async () => {
  const {service, settings, keys} = fixture();
  const review = service.prepare({original: '普通成果'});
  for (const mutation of [{contentHash: 'changed'}, {recipientScope: 'self'}, {format: 'docx'}, {text: '篡改内容'}, {policyRevision: 'old'}]) {
    assert.throws(() => service.resolve({...binding(review), ...mutation}, 'export'), {code: 'DELIVERY_REVIEW_MISMATCH'});
  }
  assert.throws(() => service.resolve(binding(review), 'share'), {code: 'DELIVERY_REVIEW_MISMATCH'});
  let writes = 0;
  for (const mutate of [() => settings.customTerms.push('新规则'), () => settings.privacyMode = 'raw', () => keys.push('new-fixture-key-123')]) {
    const current = service.prepare({original: '普通成果'});
    mutate();
    await assert.rejects(service.execute(binding(current), 'export', async () => {writes++;}), {code: 'DELIVERY_POLICY_CHANGED'});
  }
  assert.equal(writes, 0);
});

test('原生对话框期间规则更新二次检查；取消可重用，过期与返回对象篡改无效', async () => {
  const {service, settings} = fixture();
  const review = service.prepare({original: '普通成果'});
  const originalText = review.text;
  review.text = '渲染器篡改'; review.blocked = true;
  assert.equal(service.resolve(binding(review), 'export').text, originalText);
  await service.execute(binding(review), 'export', async () => ({cancelled: true}));
  assert.equal(service.resolve(binding(review), 'export').text, originalText);
  let writes = 0;
  await assert.rejects(service.execute(binding(review), 'export', async (_snapshot, validate) => {
    settings.customTerms.push('对话框期间变更'); validate(); writes++;
  }), {code: 'DELIVERY_POLICY_CHANGED'});
  assert.equal(writes, 0);
  let now = 100;
  const expiring = new DeliveryService({getSettings: () => ({}), now: () => now, ttlMs: 5});
  const expired = expiring.prepare({original: '普通成果'}); now = 106;
  assert.throws(() => expiring.resolve(binding(expired), 'export'), {code: 'DELIVERY_REVIEW_EXPIRED'});
  const deleted = service.prepare({original: '待删除聊天的已审阅内容'});
  service.invalidateAll();
  assert.throws(() => service.resolve(binding(deleted), 'export'), {code: 'DELIVERY_REVIEW_EXPIRED'});
});

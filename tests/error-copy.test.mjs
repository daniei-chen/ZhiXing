import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { friendlyError, errorText } from '../src/error-copy.js';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const load = name => import(packed ? pathToFileURL(path.join(packed, 'electron', name)).href : `../electron/${name}`);
const { failureCode, fetchModels } = await load('model-catalog.mjs');
const key = 'Ab7!xyZ9';

// 这些句子是产品承诺的一部分：用户看到的不是技术串，而是下一步做什么。
// 改文案要先改这里，避免映射表悄悄漂移。
const COPY = {
  unauthorized: 'API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。',
  forbidden: '服务端拒绝了这次请求（403），请检查 API Key 权限或账户状态。',
  throttled: '请求太频繁（429），请稍等再试。',
  dns: '解析不到服务地址，请检查网络连接或代理设置。',
  refused: '服务地址拒绝连接，请确认地址和端口是否正确。',
  reset: '连接被中途断开，请检查网络后重试。',
  timeout: '请求超时，请检查网络后重试。',
  certificate: 'HTTPS 证书校验未通过，请确认服务地址可信。',
  fetch: '网络请求失败，请检查网络连接或代理设置。',
};

test('每个真实网络故障都有对应的可行动文案', async () => {
  const cases = [
    ['读取模型列表失败（HTTP 401），已保留当前配置。', COPY.unauthorized],
    ['HTTP 401 Unauthorized', COPY.unauthorized],
    ['读取模型列表失败（HTTP 403），已保留当前配置。', COPY.forbidden],
    ['读取模型列表失败（HTTP 429），已保留当前配置。', COPY.throttled],
    ['无法读取模型列表（ENOTFOUND），请检查网络和 API 地址。', COPY.dns],
    ['无法读取模型列表（EAI_AGAIN），请检查网络和 API 地址。', COPY.dns],
    ['无法读取模型列表（ECONNREFUSED），请检查网络和 API 地址。', COPY.refused],
    ['无法读取模型列表（ECONNRESET），请检查网络和 API 地址。', COPY.reset],
    ['无法读取模型列表（TIMEOUT），请检查网络和 API 地址。', COPY.timeout],
    ['request to https://api.example/v1 failed, reason: self signed certificate', COPY.certificate],
    ['TypeError: fetch failed', COPY.fetch],
  ];
  for (const [raw, expected] of cases) assert.equal(friendlyError(raw), expected, raw);
});

test('IPC 包装层被剥掉，非 Error 输入不抛异常', async () => {
  const wrapped = new Error("Error invoking remote method 'providers:save': Error: 无法读取模型列表（ECONNREFUSED），请检查网络和 API 地址。");
  assert.equal(errorText(wrapped), COPY.refused);
  assert.equal(errorText('plain string'), 'plain string');
  assert.equal(errorText(undefined), 'undefined');
  assert.equal(errorText(null), 'null');
  assert.equal(errorText({ message: undefined }), '[object Object]');
  assert.equal(errorText({ toString: () => '对象错误' }), '对象错误');
});

test('匹配不到的原始错误保持原样', async () => {
  for (const raw of ['请选择自定义接口协议。', '读取模型列表失败（HTTP 500），已保留当前配置。', '模型服务返回格式无效。']) {
    assert.equal(friendlyError(raw), raw);
  }
});

test('主进程保留系统错误码，界面把整句换成对应文案', async () => {
  const server = http.createServer(() => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const config = { baseUrl: `http://127.0.0.1:${port}/v1`, protocol: 'openai' };
  const error = await fetchModels(config, key).then(() => null, cause => cause);
  assert(error, '关闭的端口必须让模型目录拉取失败');
  assert.match(error.message, /^无法读取模型列表（ECONNREFUSED），请检查网络和 API 地址。$/, error.message);
  // 界面拿到的就是这句带错误码的消息，经过同一层 IPC 包装后仍要落到连接被拒绝的文案。
  assert.equal(errorText(new Error(`Error invoking remote method 'providers:save': Error: ${error.message}`)), COPY.refused);
});

test('超时与未知原因不冒充网络故障', async () => {
  assert.equal(failureCode(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'TIMEOUT');
  assert.equal(failureCode({ cause: { code: 'ENOTFOUND' } }), 'ENOTFOUND');
  assert.equal(failureCode({ code: 'ECONNRESET' }), 'ECONNRESET');
  assert.equal(failureCode({ cause: { code: 'bad port' } }), '');
  assert.equal(failureCode(undefined), '');
  assert.equal(failureCode(new TypeError('fetch failed')), '');
  // 没有错误码时不编造号码，但仍说明拉取失败并保留原始技术兜底。
  assert.equal(friendlyError('无法读取模型列表，请检查网络和 API 地址。'), '无法读取模型列表，请检查网络和 API 地址。');
});

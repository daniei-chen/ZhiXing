import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_PLACEHOLDER, SECRET_RULES, redactSecrets } from '../src/secret-redact.js';
import { PrivacySession } from '../src/privacy-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => fs.readFile(path.join(ROOT, file), 'utf8');

const PEM = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEA1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

// 八种凭据形状：每一条都是审计 D5 里「模型路径遮得住、IPC 错误路径原样漏」的实例。
const SHAPES = [
  ['GitHub 令牌', 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'],
  ['AWS 访问密钥', 'AKIAIOSFODNN7EXAMPLE'],
  ['PEM 私钥块', PEM],
  [
    'JWT',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  ],
  ['Bearer 令牌', 'Bearer AbCdEfGhIjKlMnOpQrStUvWx'],
  ['等号赋值口令', 'password=S3cr3t!Value'],
  ['带口令的连接串', 'postgres://appuser:S3cr3tPassw0rd@db.internal:5432/orders'],
  ['authorization 头', 'authorization: Basic dXNlcjpwYXNzd29yZA=='],
];

test('八种凭据形状在 IPC 错误串里都被替换成占位符', () => {
  for (const [label, secret] of SHAPES) {
    const output = redactSecrets(`同步失败：${secret} 已过期`);
    assert.ok(output.includes(SECRET_PLACEHOLDER), `${label} 没有被遮住：${output}`);
    assert.ok(!output.includes(secret), `${label} 仍有原文残留：${output}`);
    assert.ok(output.startsWith('同步失败：') && output.endsWith(' 已过期'), `${label} 改坏了文案`);
  }
});

test('普通错误文案一字不改', () => {
  for (const message of ['文件不存在，请重新选择。', 'HTTP 409 冲突：这个名称已被占用。', ''])
    assert.equal(redactSecrets(message), message);
});

test('同一条消息里的多个凭据全部替换', () => {
  const secrets = SHAPES.map(([, secret]) => secret);
  const output = redactSecrets(`读取失败：${secrets.join(' 与 ')}`);
  assert.equal(output.split(SECRET_PLACEHOLDER).length - 1, secrets.length);
  for (const secret of secrets) assert.ok(!output.includes(secret), `残留：${secret}`);
});

test('先脱敏后截断：600 字符上限生效，且结尾不留密钥前半段', () => {
  const key = 'sk-A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
  const output = redactSecrets(`${'a'.repeat(594)} ${key}`).slice(0, 600);
  assert.equal(output.length, 600);
  assert.ok(output.startsWith(`${'a'.repeat(594)} `), '前缀应原样保留');
  // 先截断会把密钥切成 `sk-` 这样半截前缀，所以这里必须完全看不到它。
  assert.ok(!output.includes('sk-'), `截断后留下半截密钥：${output.slice(580)}`);
  assert.ok(
    !/sk-[A-Za-z0-9_-]{0,}$/.test(output.slice(580)),
    `截断后留下密钥前缀：${output.slice(580)}`,
  );
});

test('脱敏引擎与 IPC 路径共用同一份规则', () => {
  assert.equal(SECRET_RULES.length, 8);
  assert.ok(SECRET_RULES.every(([type]) => type === 'SECRET'));
  const session = new PrivacySession('error-redaction');
  for (const [label, secret] of SHAPES) {
    const { text: masked } = session.protect(`同步失败：${secret} 已过期`);
    assert.ok(!masked.includes(secret), `${label} 在脱敏引擎里漏了：${masked}`);
    assert.match(masked, /⟦ZX-[a-f0-9]{12}-SECRET-\d+⟧/, `${label} 没有被当作 SECRET 遮住`);
  }
});

test('electron/main.cjs 的 handle() catch 调用共享脱敏函数，且不再内联 sk- 正则', async () => {
  const source = await read('electron/main.cjs');
  const start = source.indexOf('function handle(channel,fn,ready){');
  assert.ok(start > 0, '找不到 handle()');
  const end = source.indexOf('function requestRendererFlush()', start);
  assert.ok(end > start, '找不到 handle() 的结尾');
  const handler = source.slice(start, end);

  assert.match(
    handler,
    /throw new Error\(redactSecrets\(message\)\.slice\(0,600\)\);/,
    'catch 必须调用共享 redactSecrets()，并保留 600 字符上限',
  );
  assert.match(
    handler,
    /throw new Error\('DeepSeek 内核启动失败。/,
    '内核启动失败整句替换必须保留',
  );
  assert.equal(
    (handler.match(/preserve-caught-error/g) || []).length,
    2,
    '两处 eslint-disable 说明必须保留',
  );
  assert.ok(!/cause\s*[:,}]/.test(handler), '不得把 cause 带出去');
  assert.ok(!/sk-\[A-Za-z0-9_-\]\{12,\}/.test(source), 'main.cjs 不得再内联旧的 sk- 正则');
  assert.ok(!/\.replace\(\/sk-/.test(source), 'main.cjs 不得再用内联 replace 遮凭据');
});

test('凭据规则只有一份，且共享模块进了安装包清单', async () => {
  const privacy = await read('src/privacy-core.js');
  assert.match(privacy, /import \{SECRET_RULES\} from '\.\/secret-redact\.js';/);
  assert.match(privacy, /\.\.\.SECRET_RULES,/);
  for (const file of ['src/privacy-core.js', 'electron/main.cjs', 'src/error-copy.js']) {
    const text = await read(file);
    assert.ok(!/ghp_|github_pat_|glpat-|sk_live_/.test(text), `${file} 不应再抄一份凭据正则`);
  }
  const config = JSON.parse(await read('electron-builder.yml'));
  assert.ok(config.files.includes('src/secret-redact.js'), '安装包清单必须带上共享脱敏模块');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = name => process.env.ZHIXING_TEST_PACKED_APP
  ? pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP, name)).href
  : new URL(`../${name}`, import.meta.url).href;
const { apply } = await import(moduleUrl('harness/office-tools.mjs'));
const { resolveOfficePath, prepareOfficeWrite, writeOfficeFile } = await import(moduleUrl('harness/file-policy.mjs'));
const { PrivacySession } = await import(moduleUrl('src/privacy-core.js'));
const { createBridgeKey, readBridge, writeBridge } = await import(moduleUrl('harness/privacy-bridge.mjs'));

async function fixture(t, { mode = 'ask', approval = async () => 'allowed-once' } = {}) {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const base = await fs.mkdtemp(path.join(temporaryRoot, 'zhixing-office-write-'));
  const root = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  const bridgeFile = path.join(base, 'privacy-bridge.bin');
  const bridgeKey = createBridgeKey();
  const environment = {
    ZHIXING_WORKSPACE_ROOT: root, ZHIXING_PERMISSION_MODE: mode,
    ZHIXING_PRIVACY_MODE: 'redact', ZHIXING_PRIVACY_POLICY: '{}', ZHIXING_CUSTOM_TERMS: '[]',
    ZHIXING_BRIDGE_FILE: bridgeFile, ZHIXING_BRIDGE_KEY: bridgeKey,
    ZHIXING_KERNEL: '{}', ZHIXING_AUTOMATION_BRIDGE: '', ZHIXING_BROWSER_BRIDGE: '', DEEPSEEK_API_KEY: '',
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const actual = await fs.realpath(base);
    assert.equal(path.dirname(actual), temporaryRoot);
    assert(path.basename(actual).startsWith('zhixing-office-write-'));
    await fs.rm(actual, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  });
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await writeBridge(bridgeFile, bridgeKey, new PrivacySession('office-write-test').exportState());
  Object.assign(process.env, environment);
  const registered = new Map(), approvals = [];
  apply({ tools: { register: tool => registered.set(tool.name, tool), guard() {} }, on() {},
    approval: { async request(request) { approvals.push(request); return approval(request); } } });
  const tool = registered.get('office_write_file');
  assert(tool);
  return {
    base, root, outside, approvals,
    run: (file_path = '交付/2026年报/汇总.md', content = '真实文件写入验证', signal = new AbortController().signal) =>
      tool.execute({ file_path, content }, { name: 'office_write_file', callId: 'write-call', agent: { id: 'write-agent' }, signal }),
    async restore(value) { const saved = await readBridge(bridgeFile, bridgeKey); return new PrivacySession(saved.id, saved).restore(value).text; },
  };
}

async function absent(target) {
  await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
}

test('嵌套输出先解析最近存在祖先，解析期间不创建任何目录', async t => {
  const fx = await fixture(t);
  const info = await resolveOfficePath('交付/2026年报/汇总.md', fx.root, { write: true });
  assert.equal(info.target, path.join(fx.root, '交付/2026年报/汇总.md'));
  assert.equal(info.inside, true);
  assert.equal(info.exists, false);
  assert.equal(info.scope.anchor.path, fx.root);
  assert.deepEqual(info.scope.missing, ['交付', '2026年报']);
  await absent(path.join(fx.root, '交付'));
});

test('ask 获批后创建嵌套目录并写入真实文件；审批时目录尚不存在', async t => {
  let fx;
  fx = await fixture(t, { approval: async request => {
    await absent(path.join(fx.root, '交付'));
    assert.deepEqual(JSON.parse(request.reason), { operation: '保存办公成果', path: path.join(fx.root, '交付/2026年报/汇总.md'), overwrite: false });
    return 'allowed-once';
  } });
  const result = await fx.run();
  const written = await fx.restore(result.path);
  assert.equal(written, path.join(fx.root, '交付/2026年报/汇总.md'));
  assert.equal(await fs.readFile(written, 'utf8'), '真实文件写入验证');
  assert.equal(result.written, true);
  assert.equal(result.bytes, Buffer.byteLength('真实文件写入验证'));
  assert.equal(fx.approvals.length, 1);
});

for (const mode of ['auto', 'full']) test(`${mode} 的既有工作区写入授权支持嵌套目录`, async t => {
  const fx = await fixture(t, { mode });
  const result = await fx.run();
  assert.equal(await fs.readFile(await fx.restore(result.path), 'utf8'), '真实文件写入验证');
  assert.equal(fx.approvals.length, 0);
});

test('拒绝审批不创建目录或文件', async t => {
  const fx = await fixture(t, { approval: async () => 'denied' });
  await assert.rejects(fx.run(), /未获批准/);
  assert.equal(fx.approvals.length, 1);
  await absent(path.join(fx.root, '交付'));
});

test('调用前或审批期间取消不创建目录', async t => {
  const controller = new AbortController();
  const fx = await fixture(t, { approval: async () => { controller.abort(new Error('write cancelled')); return 'allowed-once'; } });
  await assert.rejects(fx.run(undefined, undefined, controller.signal), /write cancelled/);
  await absent(path.join(fx.root, '交付'));
  assert.equal(fx.approvals.length, 1);
  await assert.rejects(fx.run(undefined, undefined, controller.signal), /write cancelled/);
  assert.equal(fx.approvals.length, 1);
});

test('工作区链接指向外部时按真实外部目标审批，不能继承 auto 的内部授权', async t => {
  const fx = await fixture(t, { mode: 'auto' });
  await fs.symlink(fx.outside, path.join(fx.root, 'external'), 'junction');
  const result = await fx.run('external/new/nested/report.md', 'outside approved');
  assert.equal(fx.approvals.length, 1);
  assert.equal(JSON.parse(fx.approvals[0].reason).path, path.join(fx.outside, 'new/nested/report.md'));
  assert.equal(await fx.restore(result.path), path.join(fx.outside, 'new/nested/report.md'));
  assert.equal(await fs.readFile(path.join(fx.outside, 'new/nested/report.md'), 'utf8'), 'outside approved');
});

test('外部嵌套目录拒绝批准后保持不存在', async t => {
  const fx = await fixture(t, { mode: 'auto', approval: async () => 'denied' });
  await assert.rejects(fx.run(path.join(fx.outside, 'new/report.md')), /未获批准/);
  await absent(path.join(fx.outside, 'new'));
});

test('现有成果自动编号另存，原件内容不变', async t => {
  const fx = await fixture(t, { mode: 'auto' });
  await fs.writeFile(path.join(fx.root, 'report.md'), 'original');
  const result = await fx.run('report.md', 'new');
  assert.equal(await fx.restore(result.path), path.join(fx.root, 'report (2).md'));
  assert.equal(await fs.readFile(path.join(fx.root, 'report.md'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(fx.root, 'report (2).md'), 'utf8'), 'new');
});

for (const change of ['link', 'directory', 'root']) test(`审批期间 ${change} 置换导致原授权失效`, async t => {
  let fx;
  fx = await fixture(t, { approval: async () => {
    const target = change === 'root' ? fx.root : path.join(fx.root, 'existing');
    await fs.rename(target, `${target}-before`);
    if (change === 'link') await fs.symlink(fx.outside, target, 'junction'); else await fs.mkdir(target);
    return 'allowed-once';
  } });
  await fs.mkdir(path.join(fx.root, 'existing'));
  await assert.rejects(fx.run('existing/new/report.md'), /FILE_CHANGED/);
  await absent(path.join(fx.root, 'existing/new/report.md'));
  await absent(path.join(fx.outside, 'new'));
});

test('审批期间原本缺少的目录出现，不采用未知目录继续写入', async t => {
  let fx;
  fx = await fixture(t, { approval: async () => { await fs.mkdir(path.join(fx.root, '交付')); return 'allowed-once'; } });
  await assert.rejects(fx.run(), /FILE_CHANGED/);
  await absent(path.join(fx.root, '交付/2026年报'));
});

test('非目录祖先、断链与目标链接均拒绝，不伪装成可创建目录', async t => {
  const fx = await fixture(t);
  await fs.writeFile(path.join(fx.root, 'plain'), 'not a directory');
  await fs.symlink(path.join(fx.outside, 'missing'), path.join(fx.root, 'dangling'), 'junction');
  await fs.symlink(fx.outside, path.join(fx.root, 'linked.md'), 'junction');
  await assert.rejects(fx.run('plain/next/report.md'), /ENOTDIR|NOT_DIRECTORY/);
  await assert.rejects(fx.run('dangling/next/report.md'), /ENOENT|NOT_DIRECTORY/);
  await assert.rejects(fx.run('linked.md'), /链接/);
  assert.equal(fx.approvals.length, 0);
  assert.equal(await fs.readFile(path.join(fx.root, 'plain'), 'utf8'), 'not a directory');
  await absent(path.join(fx.outside, 'missing'));
});

test('禁止位置在创建缺失目录和审批之前被拒绝', async t => {
  const fx = await fixture(t, { mode: 'full' });
  await assert.rejects(fx.run('new/.ssh/report.md'), /私密记录/);
  await absent(path.join(fx.root, 'new'));
  assert.equal(fx.approvals.length, 0);
});

test('mkdir 后立即检查链接置换，不向替换目录写入成果', async t => {
  const fx = await fixture(t, { mode: 'auto' }), nativeMkdir = fs.mkdir;
  const first = path.join(fx.root, '交付');
  t.mock.method(fs, 'mkdir', async (target, ...args) => {
    const result = await nativeMkdir(target, ...args);
    if (target === first) { await fs.rename(first, `${first}-before`); await fs.symlink(fx.outside, first, 'junction'); }
    return result;
  });
  await assert.rejects(fx.run(), /NOT_DIRECTORY|FILE_CHANGED/);
  await absent(path.join(fx.outside, '2026年报'));
  await absent(path.join(fx.root, '交付-before/2026年报'));
});

test('mkdir 期间取消停止后续层级和文件写入', async t => {
  const fx = await fixture(t, { mode: 'auto' }), nativeMkdir = fs.mkdir, controller = new AbortController();
  t.mock.method(fs, 'mkdir', async (target, ...args) => {
    const result = await nativeMkdir(target, ...args);
    if (target === path.join(fx.root, '交付')) controller.abort(new Error('mkdir cancelled'));
    return result;
  });
  await assert.rejects(fx.run(undefined, undefined, controller.signal), /mkdir cancelled/);
  await absent(path.join(fx.root, '交付/2026年报'));
});

for (const existing of [false, true]) test(`审批后同名竞争保留竞争者与原件（自动编号=${existing}）`, async t => {
  let fx;
  fx = await fixture(t, { approval: async request => { await fs.writeFile(JSON.parse(request.reason).path, 'competitor'); return 'allowed-once'; } });
  if (existing) await fs.writeFile(path.join(fx.root, 'report.md'), 'original');
  await assert.rejects(fx.run('report.md', 'must not be written'), /FILE_CHANGED/);
  assert.equal(await fs.readFile(path.join(fx.root, existing ? 'report (2).md' : 'report.md'), 'utf8'), 'competitor');
  if (existing) assert.equal(await fs.readFile(path.join(fx.root, 'report.md'), 'utf8'), 'original');
});

test('最后一次校验后出现同名文件仍由 wx 拒绝，不覆盖或改名重试', async t => {
  const fx = await fixture(t, { mode: 'auto' }), nativeOpen = fs.open;
  const target = path.join(fx.root, 'report.md');
  t.mock.method(fs, 'open', async (file, flags, ...args) => {
    if (file === target && flags === 'wx') await fs.writeFile(target, 'competitor');
    return nativeOpen(file, flags, ...args);
  });
  await assert.rejects(fx.run('report.md', 'must not overwrite'), /FILE_CHANGED/);
  assert.equal(await fs.readFile(target, 'utf8'), 'competitor');
  await absent(path.join(fx.root, 'report (2).md'));
});

test('排他打开后目标被替换，拒绝写入且失败清理不删除竞争者', async t => {
  const fx = await fixture(t), nativeOpen = fs.open;
  const target = path.join(fx.root, 'report.md');
  const approved = await resolveOfficePath(target, fx.root, { write: true });
  const destination = await prepareOfficeWrite(approved);
  t.mock.method(fs, 'open', async (file, flags, ...args) => {
    const handle = await nativeOpen(file, flags, ...args);
    if (file === target && flags === 'wx') { await fs.unlink(target); await fs.writeFile(target, 'replacement'); }
    return handle;
  });
  await assert.rejects(writeOfficeFile(target, 'must not be written', { verify: destination.verify }), /FILE_CHANGED/);
  assert.equal(await fs.readFile(target, 'utf8'), 'replacement');
});

test('路径系统错误保留代码但不向工具泄露绝对路径', async t => {
  const fx = await fixture(t), nativeLstat = fs.lstat;
  const blocked = path.join(fx.root, 'audit.person@example.test');
  t.mock.method(fs, 'lstat', async (target, ...args) => {
    if (target === blocked) throw Object.assign(new Error(`EACCES ${blocked}`), { code: 'EACCES' });
    return nativeLstat(target, ...args);
  });
  await assert.rejects(fx.run('audit.person@example.test/report.md'), error => {
    assert.match(error.message, /OFFICE_WRITE_FAILED.*EACCES/);
    assert(!error.message.includes(fx.root));
    assert(!error.message.includes('audit.person@example.test'));
    return true;
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createMaintenanceInventory,
  MAINTENANCE_TARGETS,
} from '../scripts/maintenance-inventory.mjs';

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const base = await fs.mkdtemp(path.join(parent, 'zhixing-maintenance-inventory-'));
  const root = path.join(base, 'repository');
  await fs.mkdir(root);
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }));
  const write = async (relative, body) => {
    const file = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    return file;
  };
  return { base, root, write };
}

test('清单完整列出固定目录的普通文件元数据、分类和保留理由，不改动文件', async (t) => {
  const f = await fixture(t);
  const content = new Map([
    ['release/ZhiXing-0.40.0-x64.exe', 'binary-fixture'],
    ['release/win-unpacked/resources/app/main.cjs', 'compiled-fixture'],
    ['.preview/qa/result.json', '{"status":"passed"}'],
    ['.preview/qa/profile/workspace.bin', 'private-fixture'],
    ['.preview/models/sensevoice.onnx', 'model-fixture'],
    ['.zhixing-pack-check/resources/dll.bin', 'pack-fixture'],
  ]);
  const before = new Map();
  for (const [relative, body] of content) {
    const file = await f.write(relative, body);
    before.set(relative, await fs.stat(file));
  }
  await f.write('src/untouched.txt', 'outside-targets');
  const report = await createMaintenanceInventory({ root: f.root });
  assert.equal(report.status, 'complete');
  assert.equal(report.mode, 'read-only');
  assert.equal(report.contentsRead, false);
  assert.deepEqual(report.scope, [...MAINTENANCE_TARGETS]);
  assert.equal(report.totals.files, content.size);
  assert.equal(
    report.totals.bytes,
    [...content.values()].reduce((sum, body) => sum + Buffer.byteLength(body), 0),
  );
  assert.equal(
    report.files.find((file) => file.path.endsWith('workspace.bin')).category,
    'protected-data',
  );
  assert.equal(
    report.files.find((file) => file.path.endsWith('result.json')).category,
    'audit-evidence',
  );
  assert.equal(report.files.find((file) => file.path.endsWith('.onnx')).category, 'runtime-model');
  for (const row of report.files) {
    assert(content.has(row.path));
    assert.equal(row.retain, true);
    assert(row.category && row.retainReason);
    assert.equal(row.sizeBytes, before.get(row.path).size);
    assert.equal(row.mtime, before.get(row.path).mtime.toISOString());
    assert.equal(await fs.readFile(path.join(f.root, row.path), 'utf8'), content.get(row.path));
    assert.equal(
      (await fs.stat(path.join(f.root, row.path))).mtimeMs,
      before.get(row.path).mtimeMs,
    );
  }
  assert.deepEqual((await fs.readdir(f.root)).sort(), [
    '.preview',
    '.zhixing-pack-check',
    'release',
    'src',
  ]);
});

test('固定目标和目标内部的目录链接/junction 均只记录跳过，不读取链接目标', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.base, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'do-not-read.txt'), 'outside');
  await f.write('.preview/kept.txt', 'kept');
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(outside, path.join(f.root, 'release'), type);
  await fs.symlink(outside, path.join(f.root, '.preview', 'external'), type);
  const visited = [];
  const io = {
    ...fs,
    readdir: async (directory, options) => {
      visited.push(directory);
      assert(!directory.startsWith(outside));
      return fs.readdir(directory, options);
    },
  };
  const report = await createMaintenanceInventory({ root: f.root, io });
  assert.equal(report.status, 'complete');
  assert.equal(report.totals.files, 1);
  assert.deepEqual(report.skipped.map((row) => row.path).sort(), ['.preview/external', 'release']);
  assert(report.skipped.every((row) => row.type === 'symbolic-link'));
  assert.deepEqual(visited, [path.join(f.root, '.preview')]);
  assert.equal(await fs.readFile(path.join(outside, 'do-not-read.txt'), 'utf8'), 'outside');
});

test('目录拒绝访问和文件读取状态失败均保留错误，清单不能冒充完整', async (t) => {
  const f = await fixture(t);
  await f.write('release/private.bin', 'not-read');
  await f.write('.preview/changed.bin', 'not-read');
  const denied = path.join(f.root, 'release');
  const changed = path.join(f.root, '.preview', 'changed.bin');
  const io = {
    ...fs,
    readdir: async (directory, options) => {
      if (directory === denied)
        throw Object.assign(new Error('fixture denial'), { code: 'EACCES' });
      return fs.readdir(directory, options);
    },
    lstat: async (file) => {
      if (file === changed) throw Object.assign(new Error('fixture vanished'), { code: 'ENOENT' });
      return fs.lstat(file);
    },
  };
  const report = await createMaintenanceInventory({ root: f.root, io });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.errors, [
    { path: 'release', operation: 'readdir', code: 'EACCES' },
    { path: '.preview/changed.bin', operation: 'lstat', code: 'ENOENT' },
  ]);
  assert.equal(report.targets.find((target) => target.path === 'release').status, 'incomplete');
  assert.equal(report.totals.files, 0);
});

test('列目录期间目标被换成外部链接时中止该树，不继续扫描外部文件', async (t) => {
  const f = await fixture(t);
  await f.write('release/inside.txt', 'inside');
  const outside = path.join(f.base, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'inside.txt'), 'outside');
  const target = path.join(f.root, 'release');
  const io = {
    ...fs,
    readdir: async (directory, options) => {
      const rows = await fs.readdir(directory, options);
      if (directory === target) {
        await fs.rename(target, path.join(f.base, 'original-release'));
        await fs.symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
      }
      return rows;
    },
  };
  const report = await createMaintenanceInventory({ root: f.root, io });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.totals.files, 0);
  assert.deepEqual(report.errors, [
    { path: 'release', operation: 'validate-path-after-readdir', code: 'PATH_CHANGED' },
  ]);
});

test('固定目录不存在时逐项说明 absent，不推测清理量或创建目录', async (t) => {
  const f = await fixture(t);
  const report = await createMaintenanceInventory({ root: f.root });
  assert.equal(report.status, 'complete');
  assert(report.targets.every((target) => target.status === 'absent'));
  assert.deepEqual(report.files, []);
  assert.equal(report.totals.bytes, 0);
  assert.deepEqual(await fs.readdir(f.root), []);
});

test('仓库根为链接时拒绝扫描，CLI 也不接受任意根目录或删除参数', async (t) => {
  const f = await fixture(t);
  const linked = path.join(f.base, 'linked-repository');
  await fs.symlink(f.root, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const report = await createMaintenanceInventory({ root: linked });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.errors, [
    { path: '.', operation: 'validate-root', code: 'ROOT_NOT_DIRECTORY' },
  ]);
  const script = fileURLToPath(new URL('../scripts/maintenance-inventory.mjs', import.meta.url));
  for (const args of [['--root', f.root], ['--delete']]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      cwd: f.root,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(await fs.readdir(f.root), []);
});

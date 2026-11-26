import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { pathToFileURL } from 'node:url';
const packed = process.env.ZHIXING_TEST_PACKED_APP;
const load = async file => import(packed ? pathToFileURL(path.join(packed, 'electron', file)).href : new URL(`../electron/${file}`, import.meta.url));
const { compareVersions, versionInName, planCachePrune, pruneUpdateCache, updaterCacheDir } = await load('updater-cache.mjs');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-25T04:00:00Z');
const file = (relativePath, size, ageDays, version) => ({ relativePath, size, mtimeMs: now - ageDays * DAY, ...(version ? { version } : {}) });

test('文件名里的版本号能取出来，取不出来就返回空串', () => {
  assert.equal(versionInName('ZhiXing-0.13.8-x64.exe'), '0.13.8');
  assert.equal(versionInName('deepseek-harness-0.2.2-rc.5-win-x64.exe'), '0.2.2');
  assert.equal(versionInName('update-info.json'), '');
  assert.equal(versionInName('current.blockmap'), '');
});

test('版本比较：预发布版低于同号正式版，补齐位数', () => {
  assert.equal(compareVersions('0.14.3', '0.14.3'), 0);
  assert.equal(compareVersions('0.13.8', '0.14.3'), -1);
  assert.equal(compareVersions('0.14.10', '0.14.9'), 1);
  assert.equal(compareVersions('0.2.2-rc.5', '0.2.2'), -1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
});

test('装着的东西删掉：版本不高于当前版本的缓存一律清理，含同号', () => {
  const plan = planCachePrune({ entries: [
    file('pending/ZhiXing-0.13.8-x64.exe', 338_000_000, 0.5),
    file('pending/ZhiXing-0.14.4-x64.exe', 340_000_000, 0.5),
    file('pending/ZhiXing-0.14.3-x64.exe', 339_000_000, 0.5),
    file('pending/update-info.json', 100, 0.5),
  ], currentVersion: '0.14.3', now });
  assert.deepEqual(plan.remove.map(entry => entry.relativePath).sort(),
    ['pending/ZhiXing-0.13.8-x64.exe', 'pending/ZhiXing-0.14.4-x64.exe'.replace('0.14.4', '0.14.3')].sort());
  assert.deepEqual(plan.keep.map(entry => entry.relativePath), ['pending/ZhiXing-0.14.4-x64.exe', 'pending/update-info.json']);
  assert.equal(plan.removedBytes, 338_000_000 + 339_000_000);
});

test('正在等的更新不删：比当前版本新、而且是刚写入的', () => {
  const plan = planCachePrune({ entries: [
    file('pending/ZhiXing-0.15.0-x64.exe', 350_000_000, 0.01),
    file('pending/ZhiXing-0.15.0-x64.exe.blockmap', 300_000, 0.01),
    file('pending/update-info.json', 100, 0.01),
  ], currentVersion: '0.14.3', now });
  assert.equal(plan.remove.length, 0);
  assert.equal(plan.keep.length, 3);
});

test('解析不出版本又过了保留期的陈旧文件也会清掉，连同它的元数据', () => {
  const plan = planCachePrune({ entries: [
    file('pending/installer.exe', 1000, 30),
    file('pending/installer.exe.blockmap', 10, 3),
    file('pending/update-info.json', 100, 1),
  ], currentVersion: '0.14.3', now, keepDays: 7 });
  assert.deepEqual(plan.remove.map(entry => entry.relativePath).sort(),
    ['pending/installer.exe', 'pending/installer.exe.blockmap', 'pending/update-info.json']);
  assert.equal(plan.keep.length, 0);
});

test('没有待装安装包时元数据一起清，有就一起留', () => {
  const withPending = planCachePrune({ entries: [
    file('pending/ZhiXing-0.14.3-x64.exe', 339_000_000, 0.5),
    file('pending/current.blockmap', 300_000, 0.5),
  ], currentVersion: '0.14.3', now });
  assert.deepEqual(withPending.remove.map(entry => entry.reason).sort(), ['installed', 'orphaned-metadata']);
  const withoutPending = planCachePrune({ entries: [
    file('pending/current.blockmap', 300_000, 0.5),
    file('pending/update-info.json', 100, 0.5),
  ], currentVersion: '0.14.3', now });
  assert.equal(withoutPending.keep.length, 0);
  assert.equal(withoutPending.remove.length, 2);
});

test('真删：目录不存在不报错，空掉的 pending 目录一起收走', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-cache-'));
  await fs.mkdir(path.join(root, 'pending'), { recursive: true });
  await fs.writeFile(path.join(root, 'pending', 'ZhiXing-0.13.8-x64.exe'), Buffer.alloc(2048, 1));
  await fs.writeFile(path.join(root, 'pending', 'current.blockmap'), Buffer.alloc(16, 2));
  const report = await pruneUpdateCache({ cacheDir: root, currentVersion: '0.14.3', now });
  assert.equal(report.removed.length, 2);
  assert.equal(report.removedBytes, 2064);
  assert.equal(await fs.readdir(root).then(items => items.length), 0);
  const missing = await pruneUpdateCache({ cacheDir: path.join(root, 'nope'), currentVersion: '0.14.3', now });
  assert.equal(missing.removed.length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test('缓存目录名只认 app-update.yml，不按应用名猜', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-yml-'));
  await fs.writeFile(path.join(root, 'app-update.yml'), 'provider: github\nowner: o\nrepo: r\nupdaterCacheDirName: zhixing-updater\n');
  assert.equal(await updaterCacheDir({ resourcesPath: root, localAppData: 'C:\\Local' }), path.join('C:\\Local', 'zhixing-updater'));
  await fs.writeFile(path.join(root, 'app-update.yml'), 'provider: github\n');
  assert.equal(await updaterCacheDir({ resourcesPath: root, localAppData: 'C:\\Local' }), null);
  await fs.writeFile(path.join(root, 'app-update.yml'), 'updaterCacheDirName: ../escape\n');
  assert.equal(await updaterCacheDir({ resourcesPath: root, localAppData: 'C:\\Local' }), null);
  assert.equal(await updaterCacheDir({ resourcesPath: root, localAppData: '' }), null);
  await fs.rm(root, { recursive: true, force: true });
});

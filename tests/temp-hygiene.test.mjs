import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { containsMarker, judgeStuckUninstaller, pruneStuckUninstaller } = await import('../electron/temp-hygiene.mjs');

const NOW = Date.parse('2026-11-25T06:00:00Z');
const MINUTE = 60 * 1000;

test('只有字节里带产品名的卸载器副本才算知行的', () => {
  assert.equal(containsMarker(Buffer.from('MZ....知行....', 'utf16le')), true);
  assert.equal(containsMarker(Buffer.from('zhixing-uninstaller', 'utf8')), true);
  assert.equal(containsMarker(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])), false);
  assert.equal(containsMarker(Buffer.alloc(0)), false);
});

test('三条判据缺一不可：目录存在、够旧、字节能证明是我们', () => {
  assert.deepEqual(judgeStuckUninstaller({ exists: false, newestMtimeMs: 0, now: NOW, ours: false }).remove, false);
  assert.equal(judgeStuckUninstaller({ exists: false, newestMtimeMs: 0, now: NOW, ours: false }).reason, 'missing');
  assert.equal(judgeStuckUninstaller({ exists: true, newestMtimeMs: NOW - 1 * MINUTE, now: NOW, ours: true }).reason, 'recent');
  assert.equal(judgeStuckUninstaller({ exists: true, newestMtimeMs: NOW - 60 * MINUTE, now: NOW, ours: false }).reason, 'not-ours');
  assert.equal(judgeStuckUninstaller({ exists: true, newestMtimeMs: NOW - 11 * MINUTE, now: NOW, ours: true }).reason, 'stale-uninstaller-copy');
});

async function seed({ content, ageMinutes }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-nsu-'));
  const dir = path.join(root, '~nsu.tmp');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'Un_A.exe');
  await fs.writeFile(file, content);
  const when = new Date(Date.now() - ageMinutes * MINUTE);
  await fs.utimes(file, when, when);
  await fs.utimes(dir, when, when);
  return { root, dir };
}

test('过期且带产品名的 ~nsu.tmp 会被整体删除', async () => {
  const { root, dir } = await seed({ content: Buffer.concat([Buffer.from('MZ'), Buffer.from('知行', 'utf16le')]), ageMinutes: 30 });
  const report = await pruneStuckUninstaller({ tempDir: root });
  assert.equal(report.removed, true);
  assert.equal(report.reason, 'stale-uninstaller-copy');
  assert.equal(await fs.access(dir).then(() => true, () => false), false);
  await fs.rm(root, { recursive: true, force: true });
});

test('别家应用的同名目录不动，刚写入的也不动', async () => {
  const foreign = await seed({ content: Buffer.from('MZ another installer payload'), ageMinutes: 120 });
  const keptForeign = await pruneStuckUninstaller({ tempDir: foreign.root });
  assert.equal(keptForeign.removed, false);
  assert.equal(keptForeign.reason, 'not-ours');
  assert.equal(await fs.access(foreign.dir).then(() => true, () => false), true);
  await fs.rm(foreign.root, { recursive: true, force: true });

  const fresh = await seed({ content: Buffer.from('知行', 'utf16le'), ageMinutes: 0 });
  const keptFresh = await pruneStuckUninstaller({ tempDir: fresh.root });
  assert.equal(keptFresh.removed, false);
  assert.equal(keptFresh.reason, 'recent');
  await fs.rm(fresh.root, { recursive: true, force: true });
});

test('目录不存在或没有临时目录时安静返回', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-empty-'));
  const missing = await pruneStuckUninstaller({ tempDir: root });
  assert.equal(missing.removed, false);
  assert.equal(missing.reason, 'missing');
  assert.equal((await pruneStuckUninstaller({ tempDir: '' })).reason, 'no-temp-dir');
  await fs.rm(root, { recursive: true, force: true });
});

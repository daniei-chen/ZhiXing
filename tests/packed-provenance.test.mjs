import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('包来源核对接受当前 HEAD，拒绝仅格式正确但不属于当前 checkout 的提交', async (t) => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-packed-provenance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }));
  await fs.mkdir(path.join(root, 'scripts'));
  const sourceScript = fileURLToPath(
    new URL('../scripts/verify-packed-sources.mjs', import.meta.url),
  );
  const script = path.join(root, 'scripts/verify-packed-sources.mjs');
  await fs.copyFile(sourceScript, script);
  const manifest = {
    name: 'provenance-fixture',
    version: '0.40.0',
    main: 'main.cjs',
    dependencies: {},
  };
  const lock = JSON.stringify({ lockfileVersion: 3, packages: {} });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(root, 'package-lock.json'), lock);
  await fs.writeFile(path.join(root, 'electron-builder.yml'), JSON.stringify({ files: [] }));
  const git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  git(['init', '--quiet']);
  git([
    'add',
    '--',
    'package.json',
    'package-lock.json',
    'electron-builder.yml',
    'scripts/verify-packed-sources.mjs',
  ]);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=.no-hooks',
    'commit',
    '--quiet',
    '-m',
    'provenance fixture',
  ]);
  const head = git(['rev-parse', 'HEAD']).trim();
  const application = path.join(root, 'application');
  await fs.mkdir(application);
  await fs.writeFile(path.join(application, 'package.json'), JSON.stringify(manifest));
  const provenance = {
    version: manifest.version,
    sourceDirty: false,
    sourceCommit: head,
    lockSha256: createHash('sha256').update(lock).digest('hex'),
  };
  const provenanceFile = path.join(application, 'build-provenance.json');
  await fs.writeFile(provenanceFile, JSON.stringify(provenance));
  const matchedOutput = path.join(root, 'matched.json');
  const matched = spawnSync(process.execPath, [script, application, matchedOutput], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(matched.status, 0, matched.stderr);
  assert.equal(JSON.parse(await fs.readFile(matchedOutput, 'utf8')).sourceCommit, head);

  provenance.sourceCommit = '0'.repeat(40);
  await fs.writeFile(provenanceFile, JSON.stringify(provenance));
  const mismatchOutput = path.join(root, 'mismatched.json');
  const mismatched = spawnSync(process.execPath, [script, application, mismatchOutput], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /Build provenance commit differs from the checked-out source/);
  await assert.rejects(fs.access(mismatchOutput), { code: 'ENOENT' });
});

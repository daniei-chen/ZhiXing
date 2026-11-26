import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkFiles, discoverFiles, verifyRuntimeProperties } from '../scripts/check-quality.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const emptySelection = () => ({ eslint: [], stylelint: [], prettier: [] });

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-quality-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }));
  const write = async (relative, body) => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    return file;
  };
  return { root, write };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function commit(root) {
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Quality fixture',
    '-c',
    'user.email=quality@example.invalid',
    'commit',
    '-m',
    'fixture baseline',
  ]);
  return git(root, ['rev-parse', 'HEAD']);
}

function scope(baselineCommit) {
  return {
    schemaVersion: 1,
    baselineCommit,
    baselineSnapshot: 'quality/baseline.json',
    eslintFiles: [],
    stylelintFiles: [],
    formatFiles: [],
    generatedFiles: ['package-lock.json'],
    generatedDirectories: ['docs/evidence/'],
    runtimeCustomProperties: [],
  };
}

async function saveSnapshot(f, settings) {
  const entries = git(f.root, ['ls-tree', '-r', settings.baselineCommit])
    .split('\n')
    .filter(Boolean);
  const files = Object.fromEntries(
    entries.map((row) => {
      const tab = row.indexOf('\t');
      return [row.slice(tab + 1), row.slice(0, tab).split(' ')[2]];
    }),
  );
  await f.write(
    settings.baselineSnapshot,
    JSON.stringify({
      schemaVersion: 1,
      sourceCommit: settings.baselineCommit,
      hashAlgorithm: 'git-blob-sha1',
      files,
    }),
  );
}

async function configs(f) {
  const module = (name) => JSON.stringify(pathToFileURL(path.join(ROOT, name)).href);
  await f.write('eslint.config.mjs', `export { default } from ${module('eslint.config.mjs')};\n`);
  await f.write(
    'stylelint.config.mjs',
    `import config from ${module('stylelint.config.mjs')};\nexport default { ...config, referenceFiles: [] };\n`,
  );
  await fs.copyFile(path.join(ROOT, '.prettierrc.json'), path.join(f.root, '.prettierrc.json'));
}

test('scope includes changed and untracked code, keeps old formatting separate, and rejects a missing snapshot', async (t) => {
  const f = await fixture(t);
  git(f.root, ['init', '--quiet']);
  await f.write('src/legacy.jsx', 'export default function View() { return null; }\n');
  await f.write('src/adopted.js', 'export const kept = 1;\n');
  await f.write('src/removed.js', 'export const removed = 1;\n');
  const settings = scope(commit(f.root));
  await saveSnapshot(f, settings);
  settings.eslintFiles = ['src/adopted.js'];
  await f.write('src/legacy.jsx', 'export default function View() { return <main />; }\n');
  await f.write('src/new.js', 'export const added = 2;\n');
  await f.write('docs/evidence/fixture.json', '{}\n');
  await f.write('package-lock.json', '{}\n');
  await fs.unlink(path.join(f.root, 'src/removed.js'));
  const selected = await discoverFiles(f.root, settings);
  assert.deepEqual(selected.eslint, ['src/adopted.js', 'src/legacy.jsx', 'src/new.js']);
  assert.deepEqual(selected.prettier, ['quality/baseline.json', 'src/new.js']);
  assert.deepEqual(selected.legacyFormatting, ['src/legacy.jsx']);
  assert.deepEqual(selected.generated, ['docs/evidence/fixture.json', 'package-lock.json']);
  await assert.rejects(
    discoverFiles(f.root, { ...settings, baselineCommit: '0'.repeat(40) }),
    /snapshot is invalid/,
  );
  await fs.unlink(path.join(f.root, settings.baselineSnapshot));
  await assert.rejects(discoverFiles(f.root, settings), { code: 'ENOENT' });
});

test('snapshot still detects new and modified files after a squash without the original Git object', async (t) => {
  const original = await fixture(t);
  git(original.root, ['init', '--quiet']);
  await original.write('src/unchanged.js', 'export const unchanged = true;\n');
  await original.write('src/changed.js', 'export const value = 1;\n');
  const settings = scope(commit(original.root));
  await saveSnapshot(original, settings);
  const squashed = await fixture(t);
  git(squashed.root, ['init', '--quiet']);
  await squashed.write(
    settings.baselineSnapshot,
    await fs.readFile(path.join(original.root, settings.baselineSnapshot)),
  );
  await squashed.write('src/unchanged.js', 'export const unchanged = true;\n');
  await squashed.write('src/changed.js', 'export const value = 2;\n');
  await squashed.write('src/new.js', 'export const added = true;\n');
  commit(squashed.root);
  const absent = spawnSync('git', ['cat-file', '-e', `${settings.baselineCommit}^{commit}`], {
    cwd: squashed.root,
    stdio: 'pipe',
  });
  assert.notEqual(absent.status, 0, 'The original commit must not exist in this fixture.');
  const selected = await discoverFiles(squashed.root, settings);
  assert.deepEqual(selected.eslint, ['src/changed.js', 'src/new.js']);
  assert(selected.prettier.includes('src/new.js'));
  assert(!selected.prettier.includes('src/changed.js'));
});

test('actual ESLint catches undefined JSX, invalid hook order, and ignored inline suppression', async (t) => {
  const f = await fixture(t);
  await configs(f);
  await f.write(
    'src/Broken.jsx',
    `import { useState } from 'react';\nexport default function Broken({ ready }) {\n  if (ready) useState(0);\n  return <MissingView />;\n}\n`,
  );
  await f.write('src/broken.js', '/* eslint-disable no-undef */\nmissingValue();\n');
  const errors = await checkFiles(
    f.root,
    { ...emptySelection(), eslint: ['src/Broken.jsx', 'src/broken.js'] },
    { only: 'lint' },
  );
  assert(errors.some((row) => row.file === 'src/Broken.jsx' && row.rule === 'no-undef'));
  assert(errors.some((row) => row.rule === 'react-hooks/rules-of-hooks'));
  assert(errors.some((row) => row.file === 'src/broken.js' && row.rule === 'no-undef'));
});

test('actual Stylelint catches unknown tokens and the invalid font shorthand even with a disable comment', async (t) => {
  const f = await fixture(t);
  await configs(f);
  await f.write(
    'broken.css',
    '/* stylelint-disable */\n.fixture { color: var(--missing-token); font: 13px/1.75 inherit; }\n',
  );
  const errors = await checkFiles(
    f.root,
    { ...emptySelection(), stylelint: ['broken.css'] },
    { only: 'lint' },
  );
  assert(errors.some((row) => row.rule === 'no-unknown-custom-properties'));
  assert(errors.some((row) => row.rule === 'declaration-property-value-no-unknown'));
  await f.write(
    'valid.css',
    ':root { --line: #ddd; }\n.fixture { color: var(--line); background: var(--optional, white); font-size: 13px; line-height: 1.75; font-family: inherit; }\n',
  );
  assert.deepEqual(
    await checkFiles(f.root, { ...emptySelection(), stylelint: ['valid.css'] }, { only: 'lint' }),
    [],
  );
});

test('format checks reject unformatted selected files without rewriting them', async (t) => {
  const f = await fixture(t);
  await configs(f);
  const original = 'export const value={ a:1}\n';
  await f.write('unformatted.js', original);
  await f.write('formatted.js', 'export const value = { a: 1 };\n');
  const errors = await checkFiles(
    f.root,
    { ...emptySelection(), prettier: ['formatted.js', 'unformatted.js'] },
    { only: 'format' },
  );
  assert.deepEqual(
    errors.map((row) => [row.tool, row.file]),
    [['prettier', 'unformatted.js']],
  );
  assert.equal(await fs.readFile(path.join(f.root, 'unformatted.js'), 'utf8'), original);
});

test('runtime CSS reference fails closed when its inline binding disappears', async (t) => {
  const f = await fixture(t);
  const properties = [{ name: '--position', source: 'view.jsx', reference: 'reference.css' }];
  await f.write('view.jsx', "export const style = { '--position': 0 };\n");
  await f.write('reference.css', ':root { --position: 0; }\n');
  await verifyRuntimeProperties(f.root, properties);
  await f.write('view.jsx', 'export const style = {};\n');
  await assert.rejects(verifyRuntimeProperties(f.root, properties), /must be reviewed/);
});

test('CLI reports failure with a nonzero exit and only becomes green after the actual error is removed', async (t) => {
  const f = await fixture(t);
  git(f.root, ['init', '--quiet']);
  await f.write('.gitignore', 'node_modules/\n');
  const settings = scope(commit(f.root));
  await saveSnapshot(f, settings);
  await configs(f);
  await f.write('.quality-scope.json', JSON.stringify(settings));
  await fs.mkdir(path.join(f.root, 'scripts'));
  await fs.copyFile(
    path.join(ROOT, 'scripts/check-quality.mjs'),
    path.join(f.root, 'scripts/check-quality.mjs'),
  );
  await fs.symlink(
    path.join(ROOT, 'node_modules'),
    path.join(f.root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await f.write('src/failure.js', 'unresolvedValue();\n');
  const run = () =>
    spawnSync(process.execPath, ['scripts/check-quality.mjs', '--only', 'lint'], {
      cwd: f.root,
      encoding: 'utf8',
      timeout: 30_000,
    });
  const failed = run();
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /no-undef/);
  await f.write('src/failure.js', 'export const resolvedValue = 1;\n');
  const passed = run();
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /Prettier not run/);
});

test('Git attributes keep checked source LF even with core.autocrlf enabled', async (t) => {
  const f = await fixture(t);
  git(f.root, ['init', '--quiet']);
  await fs.copyFile(path.join(ROOT, '.gitattributes'), path.join(f.root, '.gitattributes'));
  await f.write('fixture.mjs', 'export const value = 1;\n');
  commit(f.root);
  await fs.unlink(path.join(f.root, 'fixture.mjs'));
  git(f.root, ['-c', 'core.autocrlf=true', 'checkout-index', '--all', '--force']);
  assert.equal(
    await fs.readFile(path.join(f.root, 'fixture.mjs'), 'utf8'),
    'export const value = 1;\n',
  );
});

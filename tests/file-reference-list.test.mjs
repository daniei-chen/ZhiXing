import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isPrivateRelative } from '../electron/workspace-files.mjs';
import { listReferenceFiles } from '../electron/file-references.mjs';

const temporaryRoot = await realpath(os.tmpdir());

async function fixtures() {
  const root = await mkdtemp(path.join(temporaryRoot, 'zhixing-references-'));
  const write = async (relative, body = 'x') => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  };
  await write('src/App.jsx');
  await write('src/components/Button.jsx');
  await write('docs/说明.md');
  await write('docs/带 空格 的名字.md');
  await write('备注/季度汇总.docx');
  await write('deep/a/b/c/深处.txt');
  await write('.env', 'SECRET=1');
  await write('.env.local', 'SECRET=1');
  await write('config/deepseek.credential', '{}');
  await write('keys/server.pem');
  await write('keys/client.key');
  await write('vaults/保险库.txt');
  await write('node_modules/pkg/index.js');
  await write('.git/config');
  await write('dist/bundle.js');
  await write('build/out.txt');
  await mkdir(path.join(root, 'src/dir-only'), { recursive: true });
  await symlink(path.join(root, 'docs/说明.md'), path.join(root, 'src/外链.md'));
  await symlink(temporaryRoot, path.join(root, 'src/外链目录'));
  return root;
}

test('递归列出工作区文件与目录，路径一律相对且不带 ..', async (context) => {
  const root = await fixtures();
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }));
  const listed = await listReferenceFiles(root);
  assert.equal(listed.workspace, true);
  assert.equal(listed.truncated, false);
  const paths = listed.entries.map((entry) => entry.path).sort();
  assert.deepEqual(paths, [
    'build',
    'build/out.txt',
    'config',
    'deep',
    'deep/a',
    'deep/a/b',
    'deep/a/b/c',
    'deep/a/b/c/深处.txt',
    'dist',
    'dist/bundle.js',
    'docs',
    'docs/带 空格 的名字.md',
    'docs/说明.md',
    'keys',
    'src',
    'src/App.jsx',
    'src/components',
    'src/components/Button.jsx',
    'src/dir-only',
    '备注',
    '备注/季度汇总.docx',
  ]);
  for (const entry of listed.entries) {
    assert.equal(path.isAbsolute(entry.path), false, entry.path);
    assert.equal(entry.path.includes('..'), false, entry.path);
    assert.equal(entry.path.includes('\\'), false, entry.path);
    assert.ok(entry.kind === 'file' || entry.kind === 'directory');
  }
});

test('私密清单不进候选，判定复用同一份 isPrivateRelative', async (context) => {
  const root = await fixtures();
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }));
  const listed = await listReferenceFiles(root);
  const paths = listed.entries.map((entry) => entry.path);
  for (const secret of [
    '.env',
    '.env.local',
    'config/deepseek.credential',
    'keys/server.pem',
    'keys/client.key',
    'vaults/保险库.txt',
  ]) {
    assert.equal(paths.includes(secret), false, `${secret} 不该出现在候选里`);
    assert.equal(isPrivateRelative(secret), true, `${secret} 必须由私密清单判定`);
  }
  for (const skipped of [
    'node_modules',
    'node_modules/pkg/index.js',
    '.git',
    '.git/config',
    'vaults',
  ]) {
    assert.equal(paths.includes(skipped), false, `${skipped} 不该进入候选`);
  }
  assert.ok(paths.includes('src/App.jsx'));
  assert.ok(paths.includes('docs/带 空格 的名字.md'));
  assert.ok(paths.includes('build/out.txt'), 'build 同时承载源码的项目不能整体藏起来');
});

test('符号链接不跟随，避免引用到工作区之外', async (context) => {
  const root = await fixtures();
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }));
  const paths = (await listReferenceFiles(root)).entries.map((entry) => entry.path);
  assert.equal(paths.includes('src/外链.md'), false);
  assert.equal(paths.includes('src/外链目录'), false);
});

test('条目上限生效并标出已截断', async (context) => {
  const root = await fixtures();
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }));
  const listed = await listReferenceFiles(root, { limit: 4 });
  assert.equal(listed.entries.length, 4);
  assert.equal(listed.truncated, true);
  const roomy = await listReferenceFiles(root, { limit: 500 });
  assert.equal(roomy.truncated, false);
  assert.ok(roomy.entries.length > 4);
});

test('没有项目工作区时明确返回 workspace:false，而不是空列表', async () => {
  assert.deepEqual(await listReferenceFiles(''), {
    workspace: false,
    entries: [],
    truncated: false,
  });
  assert.deepEqual(await listReferenceFiles(undefined), {
    workspace: false,
    entries: [],
    truncated: false,
  });
  assert.deepEqual(await listReferenceFiles('relative/dir'), {
    workspace: false,
    entries: [],
    truncated: false,
  });
  const missing = path.join(temporaryRoot, 'zhixing-references-missing-workspace');
  assert.deepEqual(await listReferenceFiles(missing), {
    workspace: false,
    entries: [],
    truncated: false,
  });
});

test('空工作区是 workspace:true 的空列表', async (context) => {
  const root = await mkdtemp(path.join(temporaryRoot, 'zhixing-references-empty-'));
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }));
  assert.deepEqual(await listReferenceFiles(root), {
    workspace: true,
    entries: [],
    truncated: false,
  });
});

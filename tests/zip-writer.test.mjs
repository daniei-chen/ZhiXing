import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yauzl from 'yauzl';

const {buildZip, collectDirectory, crc32, normalizeEntryName} = await import('../electron/zip-writer.mjs');

const readZip = buffer => new Promise((resolve, reject) => {
  const files = new Map();
  yauzl.fromBuffer(buffer, {lazyEntries: true, autoClose: true}, (error, zip) => {
    if (error) return reject(error);
    zip.on('error', reject);
    zip.on('end', () => resolve(files));
    zip.on('entry', entry => {
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError) return reject(streamError);
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry(); });
      });
    });
    zip.readEntry();
  });
});

test('CRC32 与标准向量一致', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('打出来的 zip 能被系统同一套解析库读回，中文名与空文件都在', async () => {
  const zip = buildZip([
    {name: '报告/季度总结.md', data: Buffer.from('# 一季报\n'), mtime: new Date('2026-11-01T10:00:00')},
    {name: 'empty.txt', data: Buffer.alloc(0)},
    {name: 'big.txt', data: Buffer.from('重复内容'.repeat(500))},
  ]);
  const files = await readZip(zip);
  assert.deepEqual([...files.keys()].sort(), ['big.txt', 'empty.txt', '报告/季度总结.md'].sort());
  assert.equal(files.get('报告/季度总结.md'), '# 一季报\n');
  assert.equal(files.get('empty.txt'), '');
  assert.equal(files.get('big.txt'), '重复内容'.repeat(500));
  assert.ok(zip.length < Buffer.byteLength('重复内容'.repeat(500)) + 400, '重复内容应被压缩');
});

test('不压缩模式同样可读', async () => {
  const zip = buildZip([{name: 'plain.txt', data: Buffer.from('abc')}], {compress: false});
  const files = await readZip(zip);
  assert.equal(files.get('plain.txt'), 'abc');
});

test('归档路径必须相对、不许穿越、不许重名', () => {
  assert.equal(normalizeEntryName('a\\b\\c.txt'), 'a/b/c.txt');
  assert.equal(normalizeEntryName('./a//b.txt'), 'a/b.txt');
  for (const bad of ['/abs.txt', 'C:/x.txt', '../up.txt', 'a/../../b.txt', '', 'x'.repeat(600)]) {
    assert.throws(() => normalizeEntryName(bad), /压缩包|绝对路径|上级目录/);
  }
  assert.throws(() => buildZip([{name: 'a.txt', data: Buffer.from('1')}, {name: 'a.txt', data: Buffer.from('2')}]), /重名/);
});

test('目录收集：跳过私密文件、保持稳定顺序、按上限拒绝', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-zip-'));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'a.txt'), 'a');
  await fs.writeFile(path.join(root, 'b.txt'), 'b');
  await fs.writeFile(path.join(root, '.env'), 'SECRET=1');

  const collected = await collectDirectory({root, skip: name => name === '.env'});
  assert.deepEqual(collected.entries.map(entry => entry.name), ['b.txt', 'src/a.txt']);
  assert.equal(collected.skipped, 1);

  await assert.rejects(() => collectDirectory({root, maxEntries: 1}), /超过 1 个/);
  await assert.rejects(() => collectDirectory({root, maxBytes: 1}), /无法打包/);

  const sub = await collectDirectory({root, relative: 'src'});
  assert.deepEqual(sub.entries.map(entry => entry.name), ['a.txt']);
  await fs.rm(root, {recursive: true, force: true});
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AppLog } from '../electron/app-log.mjs';

const makeTemp = () => fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-log-'));

test('writes and tails events', async () => {
  const directory = await makeTemp();
  try {
    const log = new AppLog({ directory });
    await log.write('info', 'app.start', { version: '1.0.0' });
    const lines = await log.tail();
    assert.equal(lines.length, 1);
    assert.match(lines[0], /info app\.start/);
    assert.match(lines[0], /"version":"1\.0\.0"/);
    assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('redacts secret-shaped fields and truncates long strings', async () => {
  const directory = await makeTemp();
  try {
    const log = new AppLog({ directory });
    await log.write('error', 'provider.failed', { apiKey: 'sk-secret', nested: { password: 'hunter2' }, note: 'x'.repeat(900) });
    const [line] = await log.tail();
    assert.doesNotMatch(line, /sk-secret/);
    assert.doesNotMatch(line, /hunter2/);
    assert.match(line, /\[redacted\]/);
    assert.match(line, /…/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('rotates once the file exceeds its limit', async () => {
  const directory = await makeTemp();
  try {
    const log = new AppLog({ directory, maxBytes: 400 });
    for (let index = 0; index < 12; index++) await log.write('info', 'tick', { index, padding: 'y'.repeat(40) });
    await log.write('info', 'after', {});
    const rotated = await fs.readFile(path.join(directory, 'app.log.1'), 'utf8').catch(() => '');
    assert.ok(rotated.length > 0, 'expected a rotated file');
    const current = await fs.readFile(path.join(directory, 'app.log'), 'utf8');
    assert.ok(current.length <= 400 + 200, 'current file should stay near the limit');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('copies existing log files to an export directory', async () => {
  const directory = await makeTemp();
  const target = await makeTemp();
  try {
    const log = new AppLog({ directory });
    await log.write('info', 'app.start', {});
    const copied = await log.copyTo(target);
    assert.deepEqual(copied, ['app.log']);
    const body = await fs.readFile(path.join(target, 'app.log'), 'utf8');
    assert.match(body, /app\.start/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(target, { recursive: true, force: true });
  }
});

test('survives an unwritable directory without throwing to the caller', async () => {
  const directory = await makeTemp();
  try {
    const blocker = path.join(directory, 'blocked');
    await fs.writeFile(blocker, 'x');
    const log = new AppLog({ directory: path.join(blocker, 'logs') });
    await log.write('info', 'app.start', {}).catch(() => {});
    const lines = await log.tail();
    assert.deepEqual(lines, []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});


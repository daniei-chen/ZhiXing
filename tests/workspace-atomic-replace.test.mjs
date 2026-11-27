import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const { renameEncryptedTemp } = await import(
  packed
    ? pathToFileURL(path.join(packed, 'harness/privacy-bridge.mjs')).href
    : '../harness/privacy-bridge.mjs'
);
const windows = { skip: process.platform !== 'win32', timeout: 25000 };
const sharingErrors = new Set(['EPERM', 'EACCES', 'EBUSY']);

async function within(promise, label, milliseconds = 10000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function holdWithoutDeleteSharing(file) {
  // FileShare.ReadWrite permits reads/writes, but deliberately omits Delete.
  // Microsoft documents delete sharing as covering both deletion and rename:
  // https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-createfilew
  const script = `
$ErrorActionPreference = 'Stop'
$stream = [System.IO.File]::Open($env:ZHIXING_ATOMIC_TARGET, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
try {
  [Console]::Out.WriteLine('LOCKED')
  [Console]::Out.Flush()
  $command = [Console]::In.ReadLine()
  if ($null -ne $command -and $command -ne 'release') { throw 'Unexpected fixture command' }
} finally {
  $stream.Dispose()
}
[Console]::Out.WriteLine('RELEASED')
[Console]::Out.Flush()
`;
  const child = spawn(
    'pwsh.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      env: { ...process.env, ZHIXING_ATOMIC_TARGET: file },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let exit,
    processError,
    inputError,
    stderr = '';
  const closed = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    }),
  );
  child.on('error', (error) => {
    processError = error;
  });
  child.stdin.on('error', (error) => {
    inputError = error;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  const reader = createInterface({ input: child.stdout });
  const lines = reader[Symbol.asyncIterator]();
  async function line(expected) {
    const next = await within(lines.next(), `PowerShell ${expected} handshake`);
    if (processError) throw processError;
    assert.equal(next.done, false, `PowerShell ended before ${expected}: ${stderr}`);
    assert.equal(next.value, expected);
  }
  let release;
  return {
    ready: () => line('LOCKED'),
    release() {
      release ??= (async () => {
        child.stdin.end('release\n');
        await line('RELEASED');
        assert.deepEqual(await within(closed, 'PowerShell normal exit'), { code: 0, signal: null });
        if (inputError) throw inputError;
        reader.close();
      })();
      return release;
    },
    async dispose() {
      if (!exit) {
        child.stdin.end();
        const kill = setTimeout(() => child.kill(), 3000);
        try {
          await within(closed, 'PowerShell fixture cleanup', 5000);
        } finally {
          clearTimeout(kill);
        }
      }
      reader.close();
    },
  };
}

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-atomic-replace-'));
  const target = path.join(root, 'drafts.bin');
  const temp = path.join(root, 'drafts.bin.owned.tmp');
  const original = randomBytes(128),
    replacement = randomBytes(160);
  let holder;
  t.after(async () => {
    await holder?.dispose();
    const actual = await fs.realpath(root);
    assert.equal(path.dirname(actual), parent);
    assert.ok(path.basename(actual).startsWith('zhixing-atomic-replace-'));
    await fs.rm(actual, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  });
  await fs.writeFile(target, original);
  await fs.writeFile(temp, replacement);
  return {
    target,
    temp,
    original,
    replacement,
    async lock() {
      holder = holdWithoutDeleteSharing(target);
      await holder.ready();
      return holder;
    },
  };
}

test(
  'Windows real no-delete-share handle releases during atomic replacement without rewriting either file',
  windows,
  async (t) => {
    const f = await fixture(t);
    const holder = await f.lock();
    const rename = fs.rename.bind(fs);
    let firstFailure;
    const failed = new Promise((resolve) => {
      firstFailure = resolve;
    });
    const attempts = [],
      failures = [];
    // Observe real OS results; no rename error or delay is fabricated here.
    t.mock.method(fs, 'rename', async (temp, target) => {
      attempts.push({ temp, target });
      try {
        return await rename(temp, target);
      } catch (error) {
        failures.push(error);
        firstFailure(error);
        throw error;
      }
    });
    const replacing = renameEncryptedTemp(f.temp, f.target).then(
      () => ({ ok: true }),
      (error) => ({ error }),
    );
    try {
      const blocked = await within(failed, 'observed Windows sharing violation');
      assert.ok(sharingErrors.has(blocked.code));
      assert.deepEqual(await fs.readFile(f.target), f.original);
      assert.deepEqual(await fs.readFile(f.temp), f.replacement);
      await holder.release();
      const result = await within(replacing, 'replacement after handle release', 5000);
      if (result.error) throw result.error;
      assert.equal(result.ok, true);
      assert.ok(attempts.length >= 2 && attempts.length <= 9);
      assert.equal(failures.length, attempts.length - 1);
      for (const attempt of attempts) assert.deepEqual(attempt, { temp: f.temp, target: f.target });
      assert.deepEqual(await fs.readFile(f.target), f.replacement);
      await assert.rejects(fs.stat(f.temp), { code: 'ENOENT' });
      t.diagnostic(
        JSON.stringify({
          case: 'temporary-no-delete-sharing',
          firstErrorCode: failures[0].code,
          lastObservedErrorCode: failures.at(-1).code,
          renameAttempts: attempts.length,
          holderReleasedNormally: true,
          originalBytesPreservedWhileHeld: true,
          replacementBytesMatched: true,
          temporaryRemovedAfterCommit: true,
        }),
      );
    } finally {
      await holder.dispose();
      await within(replacing, 'settle observed replacement', 5000);
    }
  },
);

test(
  'Windows persistent no-delete-share handle exhausts retries and preserves bytes for an explicit retry',
  windows,
  async (t) => {
    const f = await fixture(t);
    const holder = await f.lock();
    const rename = fs.rename.bind(fs);
    const attempts = [],
      failures = [];
    t.mock.method(fs, 'rename', async (temp, target) => {
      attempts.push({ temp, target });
      try {
        return await rename(temp, target);
      } catch (error) {
        failures.push(error);
        throw error;
      }
    });
    await assert.rejects(renameEncryptedTemp(f.temp, f.target), (error) => {
      assert.ok(sharingErrors.has(error.code));
      assert.equal(error, failures.at(-1), 'the original final OS error must propagate');
      return true;
    });
    assert.equal(attempts.length, 9);
    assert.equal(failures.length, 9);
    for (const attempt of attempts) assert.deepEqual(attempt, { temp: f.temp, target: f.target });
    assert.deepEqual(await fs.readFile(f.target), f.original);
    assert.deepEqual(await fs.readFile(f.temp), f.replacement);
    await holder.release();
    await renameEncryptedTemp(f.temp, f.target);
    assert.equal(attempts.length, 10);
    assert.equal(failures.length, 9);
    assert.deepEqual(await fs.readFile(f.target), f.replacement);
    await assert.rejects(fs.stat(f.temp), { code: 'ENOENT' });
    t.diagnostic(
      JSON.stringify({
        case: 'persistent-no-delete-sharing',
        firstErrorCode: failures[0].code,
        lastObservedErrorCode: failures.at(-1).code,
        failedRenameAttempts: failures.length,
        renameAttemptsIncludingExplicitRetry: attempts.length,
        holderReleasedNormally: true,
        originalBytesPreservedWhileHeld: true,
        replacementBytesMatched: true,
        temporaryRemovedAfterCommit: true,
      }),
    );
  },
);

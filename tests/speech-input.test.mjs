import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electron from 'electron';

test('mounted VoiceInput isolates stale microphone callbacks and cleans scope, suspension and unmount', { timeout: 30000 }, async () => {
  const parent = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(parent, 'zhixing-speech-input-'));
  const bundle = path.join(directory, 'speech-input.js');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  try {
    await writeFile(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Speech component fixture</title>');
    await build({ entryPoints: [fileURLToPath(new URL('./fixtures/speech-input.jsx', import.meta.url))],
      outfile: bundle, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
    const child = spawn(electron, [`--user-data-dir=${path.join(directory, 'profile')}`,
      fileURLToPath(new URL('./fixtures/speech-input.cjs', import.meta.url)), bundle],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), 25000);
    const [code] = await once(child, 'close');
    clearTimeout(timer);
    assert.equal(code, 0, `${stdout}\n${stderr}`);
    const result = stdout.split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } })
      .find(row => row?.speechComponentResults);
    assert.equal(result?.speechComponentResults.length, 6, stdout);
  } finally {
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), parent);
    assert(path.basename(resolved).startsWith('zhixing-speech-input-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});

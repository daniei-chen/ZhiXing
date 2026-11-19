import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exe = path.resolve(process.argv[2] || 'release/win-unpacked/知行.exe');
const app = path.join(path.dirname(exe), 'resources', 'app');
await Promise.all([access(exe), access(path.join(app, 'electron', 'runtime.mjs'))]);
const parent = await realpath(os.tmpdir());
const cwd = await mkdtemp(path.join(parent, 'zhixing-packed-smoke-'));
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ZHIXING_TEST_PACKED_APP: app };
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
try {
  // Harness and its spawned tools share the packaged executable on Windows.
  // Run the test files serially so cleanup checks do not race other test processes.
  const child = spawn(exe, ['--test', '--test-concurrency=1', ...['automation.test.mjs','runtime.test.mjs','document-text.test.mjs','workbench.test.mjs','composer-runtime.test.mjs','providers.test.mjs','plugins.test.mjs'].map(name=>fileURLToPath(new URL(`../tests/${name}`,import.meta.url)))], { cwd, env, stdio: 'inherit', windowsHide: true });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Packaged Harness test failed (${signal || code}).`);
} finally {
  const resolved = await realpath(cwd);
  if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('zhixing-packed-smoke-')) await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
}

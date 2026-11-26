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

const tests = [
  'privacy.test.mjs',
  'credential-boundary.test.mjs',
  'privacy-dynamic-keys.test.mjs',
  'privacy-mcp-native.test.mjs',
  'privacy-gateway.test.mjs',
  'delivery-review.test.mjs',
  'conversation-state.test.mjs',
  'kernel-native.test.mjs',
  'capability-manifest.test.mjs',
  'capability-runtime.test.mjs',
  'office-directory.test.mjs',
  'office-file-policy.test.mjs',
  'privacy-lock-recovery.test.mjs',
  'automation.test.mjs',
  'automation-persistence.test.mjs',
  'runtime.test.mjs',
  'runtime-native-entrypoints.test.mjs',
  'runtime-image-ocr.test.mjs',
  'runtime-vision.test.mjs',
  'runtime-cleanup.test.mjs',
  'runtime-finalization.test.mjs',
  'runtime-context.test.mjs',
  'runtime-launch.test.mjs',
  'runtime-lifecycle.test.mjs',
  'document-text.test.mjs',
  'workbench.test.mjs',
  'deliverable-access.test.mjs',
  'assistant-stream.test.mjs',
  'composer-runtime.test.mjs',
  'speech-audio.test.mjs',
  'speech-service.test.mjs',
  'providers.test.mjs',
  'mcp-identity.test.mjs',
  'mcp-destination.test.mjs',
  'workspace-save-queue.test.mjs',
  'plugins.test.mjs',
  'updater-cache.test.mjs',
  'temp-hygiene.test.mjs',
  'zip-writer.test.mjs',
  'subagent-archive.test.mjs',
  'archive-name.test.mjs',
];

// Test files and synthetic fixtures remain in the source checkout. Only the
// application modules selected through ZHIXING_TEST_PACKED_APP come from the
// candidate package. These renderer helpers are bundled into dist/client,
// so importing their source files is explicitly mixed/source-only evidence.
const sourceHelpers = {
  'composer-runtime.test.mjs': ['src/model-options.js'],
  'speech-audio.test.mjs': ['src/speech-audio.js'],
  'speech-service.test.mjs': ['src/speech-audio.js', 'source Electron fixture launcher'],
  'subagent-archive.test.mjs': ['src/subagent-archive.js'],
};
const sourceOnlyTests = ['subagent-archive.test.mjs'];
const mixedSourceTests = Object.keys(sourceHelpers).filter(name => !sourceOnlyTests.includes(name));
const packageAwareTests = tests.filter(name => !sourceOnlyTests.includes(name) && !mixedSourceTests.includes(name));
try {
  console.log(JSON.stringify({
    type: 'packed-test-scope',
    unit: 'test-files',
    'package-aware': packageAwareTests,
    'mixed-source': mixedSourceTests,
    'source-only': sourceOnlyTests,
    sourceHelpers,
    boundary: 'Packaged EXE runs source test files; fixture generators and test dependencies may come from the checkout. Mixed/source-only helpers do not verify the renderer bundle.',
  }));
  // Run the test files serially so cleanup checks do not race other test processes.
  const child = spawn(exe, ['--test', '--test-concurrency=1', ...tests.map(name=>fileURLToPath(new URL(`../tests/${name}`,import.meta.url)))], { cwd, env, stdio: 'inherit', windowsHide: true });
  const [code, signal] = await once(child, 'close');
  if (code !== 0) throw new Error(`Packaged Harness test failed (${signal || code}).`);
} finally {
  const resolved = await realpath(cwd);
  if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('zhixing-packed-smoke-')) await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
}

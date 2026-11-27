// Collect explicit synthetic QA evidence, never entire profiles or workspaces.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const temporary = process.env.RUNNER_TEMP || os.tmpdir();
const target = path.join(temporary, 'zhixing-packed-artifact');
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const copied = [];
let totalBytes = 0;
await fs.mkdir(target, { recursive: true });

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function directorySize(directory) {
  const info = await fs.lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info?.isDirectory()) return { missing: true };
  const result = { files: 0, directories: 0, symbolicLinks: 0, bytes: 0 };
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) result.symbolicLinks += 1;
      else if (entry.isDirectory()) {
        result.directories += 1;
        await walk(file);
      } else if (entry.isFile()) {
        result.files += 1;
        result.bytes += (await fs.lstat(file)).size;
      }
    }
  }
  await walk(directory);
  return result;
}

async function copy(source, destination, limit, allowTruncate = false) {
  const stat = await fs.lstat(source).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!stat) return;
  if (!stat.isFile()) {
    copied.push({ file: destination, omitted: 'not-regular-file' });
    return;
  }
  if (
    (stat.size > limit && !allowTruncate) ||
    totalBytes + Math.min(stat.size, limit) > 32 * 1024 * 1024
  ) {
    copied.push({ file: destination, omitted: 'size-limit', originalBytes: stat.size });
    return;
  }
  // Read only the bounded tail for logs. Never truncate JSON or image evidence.
  const file = await fs.open(source, 'r');
  let bytes;
  try {
    bytes = Buffer.alloc(Math.min(stat.size, limit));
    const read = await file.read(bytes, 0, bytes.length, Math.max(0, stat.size - limit));
    bytes = bytes.subarray(0, read.bytesRead);
  } finally {
    await file.close();
  }
  const output = path.join(target, destination);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, bytes);
  totalBytes += bytes.length;
  copied.push({
    file: destination,
    originalBytes: stat.size,
    bytes: bytes.length,
    truncated: stat.size > limit,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

async function journey(directory, prefix, depth = 0) {
  const info = await fs.lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info?.isDirectory() || depth > 4) return;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(directory, entry.name);
    const destination = path.join(prefix, entry.name);
    if (
      entry.isDirectory() &&
      (depth === 0 || /^(?:run-|phase0a-ui-|phase1-ui-|workbench-preview-ui-)/.test(entry.name))
    ) {
      await journey(source, destination, depth + 1);
    } else if (entry.isFile() && entry.name === 'app-log-tail.txt') {
      await copy(source, destination, 128 * 1024, true);
    } else if (
      entry.isFile() &&
      (entry.name === 'result.json' || entry.name === 'failure.json' || entry.name.endsWith('.png'))
    ) {
      await copy(source, destination, entry.name.endsWith('.png') ? 8 * 1024 * 1024 : 1024 * 1024);
    }
  }
}

for (const name of [
  'install',
  'electron',
  'package',
  'verify',
  'packed',
  'errors',
  'native',
  'tools',
  'phase0a',
  'phase1',
  'workbench',
  'nsis',
]) {
  await copy(
    path.join(temporary, 'zhixing-packed-logs', `${name}.log`),
    `logs/${name}.log`,
    512 * 1024,
    true,
  );
}
await journey(path.join(temporary, 'zhixing-packed-journeys'), 'journeys');
await journey(path.join(root, `.preview/qa-${version}/tool-timeline`), 'tool-timeline');
const app = path.join(root, 'release/win-unpacked/resources/app');
await copy(path.join(app, 'build-provenance.json'), 'build-provenance.json', 64 * 1024);
await copy(
  path.join(root, 'release/win-unpacked/resources/app-update.yml'),
  'app-update.yml',
  64 * 1024,
);

const binaries = [];
for (const relative of [
  `release/ZhiXing-${version}-x64.exe`,
  `release/ZhiXing-${version}-x64.exe.blockmap`,
  'release/win-unpacked/知行.exe',
  'release/win-unpacked/resources/app/runtime/node.exe',
]) {
  const file = path.join(root, relative);
  const stat = await fs.stat(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  binaries.push(
    stat?.isFile()
      ? { file: relative, bytes: stat.size, sha256: await digest(file) }
      : { file: relative, missing: true },
  );
}
const checksums = binaries
  .filter((item) => item.sha256 && path.dirname(item.file) === 'release')
  .map((item) => `${item.sha256}  ${path.basename(item.file)}`)
  .join('\n');
if (checksums) {
  await fs.writeFile(path.join(root, 'release/SHA256SUMS-candidate.txt'), checksums + '\n');
  await copy(
    path.join(root, 'release/SHA256SUMS-candidate.txt'),
    'SHA256SUMS-candidate.txt',
    64 * 1024,
  );
}
const packedDirectory = await directorySize(path.join(root, 'release/win-unpacked'));
const steps = JSON.parse(process.env.CI_STEP_RESULTS || '{}');
let checkoutCommit = null;
try {
  checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
} catch {
  // A failed checkout still deserves an explicit failure report, not a guessed SHA.
}

await fs.writeFile(
  path.join(target, 'checks.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      layer:
        'Windows hosted packaging workflow; only successful steps below establish their respective coverage',
      notCovered: [
        'installer execution and upgrade lifecycle',
        'user installation or D drive',
        'real cloud model tasks',
        'code signing',
        'manual visual review unless separately recorded',
      ],
      sourceRef: process.env.GITHUB_REF,
      checkoutCommit,
      workflowSha: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      node: process.version,
      version,
      steps,
      coverage: {
        directoryPackageBuilt: steps.package?.outcome === 'success',
        packagedSourceMatched: steps.verify?.outcome === 'success',
        packagedRegressionPassed: steps.packed?.outcome === 'success',
        networkErrorUiPassed: steps.errors?.outcome === 'success',
        nativeFilesUiPassed: steps.native?.outcome === 'success',
        toolTimelineUiPassed: steps.tools?.outcome === 'success',
        phase0aUiPassed: steps.phase0a?.outcome === 'success',
        phase1UiPassed: steps.phase1?.outcome === 'success',
        workbenchUiPassed: steps.workbench?.outcome === 'success',
        uninstalledNsisBuilt: steps.nsis?.outcome === 'success',
      },
      packedDirectory,
      binaries,
      files: copied,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    { evidence: target, retainedBytes: totalBytes, files: copied.length, binaries },
    null,
    2,
  ),
);

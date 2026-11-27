// Retain named synthetic QA reports, never whole profiles or project folders.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REQUIRED_GATES, jsonFile } from './release-common.mjs';

const [input, output] = process.argv.slice(2).map((value) => path.resolve(value));
if (!input || !output || input === output)
  throw new Error('Pass separate evidence input and output directories');
const root = process.cwd();
const version = (await jsonFile(path.join(root, 'package.json'))).version;
const copied = [];
let total = 0;
await fs.mkdir(output, { recursive: true });

async function copy(source, destination, limit) {
  const info = await fs.lstat(source).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info) return;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Evidence is not an ordinary file');
  if (info.size > limit || total + info.size > 64 * 1024 * 1024) {
    copied.push({ file: destination, omitted: 'size-limit', bytes: info.size });
    return;
  }
  const bytes = await fs.readFile(source);
  const target = path.join(output, destination);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  total += bytes.length;
  copied.push({
    file: destination,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

async function journey(directory, prefix, depth = 0) {
  const info = await fs.lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info?.isDirectory() || info.isSymbolicLink() || depth > 3) return;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const source = path.join(directory, entry.name);
    if (
      entry.isDirectory() &&
      /^(run-|phase[01][a-z]?-ui-|workbench-preview-ui-|approval-recovery-ui-|zhixing-(?:recovery-ui|drafts-native)-)/.test(
        entry.name,
      )
    ) {
      await journey(source, relative, depth + 1);
    } else if (
      entry.isFile() &&
      [
        'result.json',
        'failure.json',
        'journey.json',
        'summary.json',
        'source-hashes.json',
        'app-log-tail.txt',
        'electron.log',
      ].includes(entry.name)
    ) {
      await copy(source, relative, entry.name.endsWith('.json') ? 2 * 1024 * 1024 : 128 * 1024);
    } else if (entry.isFile() && entry.name.endsWith('.png')) {
      await copy(source, relative, 8 * 1024 * 1024);
    }
  }
}

for (const name of REQUIRED_GATES)
  await copy(path.join(input, 'logs', `${name}.log`), `logs/${name}.log`, 2 * 1024 * 1024);
for (const name of [
  'plan.json',
  'outcomes.json',
  'signature-status.json',
  'packed-source-manifest.json',
])
  await copy(path.join(input, name), name, 2 * 1024 * 1024);
for (const name of [
  'production-inventory.json',
  'production-sbom.cdx.json',
  'advisories-by-path.json',
  'summary.json',
  'npm-audit.json',
])
  await copy(path.join(input, 'dependencies', name), `dependencies/${name}`, 8 * 1024 * 1024);
for (const name of ['errors', 'native', 'phase0a', 'phase1', 'workbench', 'approvals'])
  await journey(path.join(input, 'journeys', name), `journeys/${name}`);
await journey(path.join(input, 'components'), 'components');
await journey(path.join(root, `.preview/qa-${version}/tool-timeline`), 'tool-timeline');
await copy(
  path.join(root, 'release/win-unpacked/resources/app/build-provenance.json'),
  'build-provenance.json',
  64 * 1024,
);
await copy(
  path.join(root, 'release/win-unpacked/resources/app-update.yml'),
  'app-update.yml',
  64 * 1024,
);
await copy(path.join(root, 'release/latest.yml'), 'latest.yml', 64 * 1024);
await fs.writeFile(
  path.join(output, 'collection.json'),
  `${JSON.stringify({ schemaVersion: 1, version, sourceCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, files: copied, retainedBytes: total, boundary: 'Only explicitly named synthetic reports, bounded logs, screenshots and build metadata; no profile or project directories.' }, null, 2)}\n`,
);
console.log(JSON.stringify({ evidence: output, files: copied.length, bytes: total }));

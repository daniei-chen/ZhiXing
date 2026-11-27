import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

export const REPOSITORY = 'daniei-chen/ZhiXing';
export const REQUIRED_GATES = [
  'install',
  'electron',
  'quality',
  'package',
  'nsis',
  'verify',
  'unit',
  'components',
  'sites',
  'packed',
  'errors',
  'native',
  'tools',
  'phase0a',
  'phase1',
  'workbench',
  'approvals',
  'dependencies',
  'startup',
  'signature',
];

export function versionOf(value) {
  assert.equal(typeof value, 'string', 'A release version is required');
  assert.match(
    value,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    'Use an exact numeric release version',
  );
  return value;
}

export function commitOf(value) {
  assert.match(value ?? '', /^[a-f0-9]{40}$/, 'An exact commit SHA is required');
  return value;
}

export function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

export async function jsonFile(file) {
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

export async function digestFile(file, algorithm = 'sha256', encoding = 'hex') {
  const info = await fs.lstat(file);
  assert.ok(
    info.isFile() && !info.isSymbolicLink(),
    `Expected an ordinary file: ${path.basename(file)}`,
  );
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { bytes: info.size, digest: hash.digest(encoding) };
}

export function assetNames(version, baseTag) {
  versionOf(version);
  assert.match(baseTag ?? '', /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
  return [
    `ZhiXing-${version}-x64.exe`,
    `ZhiXing-${version}-x64.exe.blockmap`,
    'latest.yml',
    'build-provenance.json',
    'app-update.yml',
    'packed-source-manifest.json',
    'production-inventory.json',
    'production-sbom.cdx.json',
    'advisories-by-path.json',
    'harness-capability-map.md',
    `iteration-${version}.md`,
    `windows-acceptance-${version}.md`,
    `audit-request-${version}.md`,
    'signing.md',
    `release-notes-${version}.md`,
    `ZhiXing-${baseTag}-to-v${version}.patch`,
    `acceptance-summary-${version}.json`,
    'SHA256SUMS-release.txt',
  ];
}

export function requireGates(steps) {
  const invalid = REQUIRED_GATES.filter((name) => steps[name]?.outcome !== 'success');
  assert.equal(invalid.length, 0, `Release gates failed or did not run: ${invalid.join(', ')}`);
}

export function cleanLog(text) {
  return stripVTControlCharacters(text).replace(/^\uFEFF/, '');
}

export function nodeTestCounts(text) {
  const lines = cleanLog(text).split(/\r?\n/);
  const result = {};
  for (const key of [
    'tests',
    'suites',
    'pass',
    'fail',
    'cancelled',
    'skipped',
    'todo',
    'duration_ms',
  ]) {
    const match = lines
      .map((line) => line.match(new RegExp(`^(?:ℹ|#)\\s+${key}\\s+([\\d.]+)\\s*$`)))
      .filter(Boolean)
      .at(-1);
    assert.ok(match, `Missing Node test summary field: ${key}`);
    result[key === 'duration_ms' ? 'durationMs' : key] = Number(match[1]);
  }
  assert.ok(result.tests > 0 && result.pass > 0, 'An empty suite cannot pass a release gate');
  assert.equal(result.fail, 0, 'A Node test suite failed');
  assert.equal(result.cancelled, 0, 'A Node test suite was cancelled');
  return result;
}

export function compareVersions(left, right) {
  const a = versionOf(left).split('.').map(Number),
    b = versionOf(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export async function githubApi(
  endpoint,
  { method = 'GET', body, allow404 = false, token = process.env.GH_TOKEN } = {},
) {
  assert.ok(
    endpoint.startsWith('repos/') && !endpoint.includes('://'),
    'Unexpected GitHub API path',
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://api.github.com/${endpoint}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'zhixing-release-verifier',
        'x-github-api-version': '2026-03-10',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
      redirect: 'error',
    });
    if (response.status === 404 && allow404) return null;
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
      continue;
    }
    assert.ok(response.ok, `GitHub ${method} ${endpoint} returned HTTP ${response.status}`);
    if (response.status === 204) return null;
    return response.json();
  }
  throw new Error('GitHub API retry budget exhausted');
}

export async function releaseForTag(repository, tag, api = githubApi) {
  // GitHub's by-tag REST route addresses published releases. Draft lookup must
  // use the authenticated release list and then its real numeric release ID.
  // See cli/cli pkg/cmd/release/shared/fetch.go (FetchRelease/fetchDraftRelease).
  const published = await api(`repos/${repository}/releases/tags/${tag}`, { allow404: true });
  if (published) {
    assert.equal(published.tag_name, tag);
    return published;
  }
  for (let page = 1; page <= 3; page += 1) {
    const rows = await api(
      `repos/${repository}/releases?per_page=100${page === 1 ? '' : `&page=${page}`}`,
    );
    assert.ok(Array.isArray(rows), 'Expected a real release listing');
    const matches = rows.filter((row) => row.tag_name === tag);
    assert.ok(matches.length <= 1, 'Multiple releases use the pending tag');
    if (matches.length === 1) {
      const id = matches[0].id;
      assert.ok(Number.isSafeInteger(id) && id > 0, 'Invalid release ID');
      const release = await api(`repos/${repository}/releases/${id}`);
      assert.equal(release.id, id);
      assert.equal(release.tag_name, tag);
      return release;
    }
    if (rows.length < 100) return null;
  }
  throw new Error('Release lookup exceeded its bounded listing; no release was created');
}

export async function tagCommit(repository, tag, api = githubApi) {
  assert.match(tag, /^v\d+\.\d+\.\d+$/);
  const ref = await api(`repos/${repository}/git/ref/tags/${tag}`, { allow404: true });
  if (!ref) return null;
  let object = ref.object;
  for (let depth = 0; object?.type === 'tag' && depth < 4; depth += 1) {
    object = (await api(`repos/${repository}/git/tags/${commitOf(object.sha)}`)).object;
  }
  assert.equal(object?.type, 'commit', 'Release tag does not resolve to a commit');
  return commitOf(object.sha);
}

export async function verifyBundle(bundle, expectedCommit) {
  const manifest = await jsonFile(path.join(bundle, 'manifest.json'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.repository, REPOSITORY);
  assert.equal(commitOf(manifest.sourceCommit), commitOf(expectedCommit));
  assert.equal(manifest.tag, `v${versionOf(manifest.version)}`);
  const expected = assetNames(manifest.version, manifest.baseTag).sort();
  assert.deepEqual(
    manifest.files.map((row) => row.name).sort(),
    expected,
    'Asset manifest must contain exactly the prescribed 18 names',
  );
  const directory = path.join(bundle, 'assets');
  assert.deepEqual(
    (await fs.readdir(directory)).sort(),
    expected,
    'Release directory has missing or extra files',
  );
  for (const row of manifest.files) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    const file = await digestFile(path.join(directory, row.name));
    assert.equal(file.bytes, row.bytes, `Release asset size differs: ${row.name}`);
    assert.equal(file.digest, row.sha256, `Release asset digest differs: ${row.name}`);
  }
  const checksums = await fs.readFile(path.join(directory, 'SHA256SUMS-release.txt'), 'utf8');
  const listed = checksums
    .trim()
    .split('\n')
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64}) {2}([^\r\n]+)$/);
      assert.ok(match, 'Invalid release checksum line');
      return { name: match[2], sha256: match[1] };
    });
  assert.deepEqual(
    listed.map((row) => row.name).sort(),
    expected.filter((name) => name !== 'SHA256SUMS-release.txt'),
  );
  for (const row of listed)
    assert.equal(row.sha256, manifest.files.find((file) => file.name === row.name).sha256);
  const provenance = await jsonFile(path.join(directory, 'build-provenance.json'));
  assert.equal(provenance.sourceCommit, expectedCommit);
  assert.equal(provenance.sourceDirty, false);
  assert.equal(provenance.version, manifest.version);
  return manifest;
}

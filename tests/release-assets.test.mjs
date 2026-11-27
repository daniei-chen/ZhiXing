import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  REPOSITORY,
  REQUIRED_GATES,
  assetNames,
  nodeTestCounts,
  releaseForTag,
  requireGates,
  verifyBundle,
} from '../scripts/release-common.mjs';
import { planRelease } from '../scripts/release-plan.mjs';
import {
  assembleRelease,
  journeySummary,
  startupSummary,
  validateUpdateFeed,
} from '../scripts/assemble-release.mjs';
import {
  downloadedAssetDigest,
  draftAssetNeedsReplacement,
  findCreatedDraft,
  verifyRemoteAssets,
} from '../scripts/publish-release.mjs';

const hash = (value, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(value).digest(encoding);
const gates = () =>
  Object.fromEntries(REQUIRED_GATES.map((name) => [name, { outcome: 'success' }]));
const countsLog =
  '# tests 2\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 25.5\n';
const feed = (version, installer, bytes) =>
  `version: ${version}\nfiles:\n  - url: ${installer}\n    sha512: ${hash(bytes, 'sha512', 'base64')}\n    size: ${bytes.length}\npath: ${installer}\nsha512: ${hash(bytes, 'sha512', 'base64')}\nreleaseDate: '2026-11-26T00:00:00Z'\n`;
const startupLog = () =>
  Array.from({ length: 10 }, (_, index) =>
    JSON.stringify({ run: index + 1, spawnToInteractiveMs: 100 + index, stages: {} }),
  )
    .concat(
      JSON.stringify({
        summary: { runs: 10, spawnToInteractiveMs: 105, rendererFirstContentfulPaintMs: null },
      }),
    )
    .join('\n');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-release-fixture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Release fixture');
  git('config', 'user.email', 'release-fixture@example.invalid');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.40.0' }));
  git('add', '.');
  git('commit', '--quiet', '-m', 'baseline fixture');
  git('tag', 'v0.40.0');
  const baseCommit = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.41.0' }));
  git('add', '.');
  git('commit', '--quiet', '-m', 'candidate fixture');
  const sourceCommit = git('rev-parse', 'HEAD'),
    sourceTree = git('rev-parse', 'HEAD^{tree}');
  return { directory, root, git, baseCommit, sourceCommit, sourceTree };
}

function planApi(f, overrides = {}) {
  const rows = {
    [`repos/${REPOSITORY}/git/ref/heads/main`]: { object: { sha: f.sourceCommit } },
    [`repos/${REPOSITORY}/releases/tags/v0.41.0`]: null,
    [`repos/${REPOSITORY}/git/ref/tags/v0.41.0`]: null,
    [`repos/${REPOSITORY}/releases?per_page=100`]: [{ tag_name: 'v0.40.0', draft: false }],
    [`repos/${REPOSITORY}/git/ref/tags/v0.40.0`]: { object: { type: 'commit', sha: f.baseCommit } },
    ...overrides,
  };
  return async (endpoint, options) => {
    assert.ok(!options?.method || options.method === 'GET', 'Planning must be read-only');
    assert.ok(Object.hasOwn(rows, endpoint), `Unexpected fixture API request: ${endpoint}`);
    return rows[endpoint];
  };
}

test('release gate aggregation rejects failed, cancelled, skipped and missing steps', () => {
  requireGates(gates());
  for (const gate of ['phase1', 'workbench', 'approvals']) {
    for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
      const rows = gates();
      rows[gate] = { outcome };
      assert.throws(() => requireGates(rows), new RegExp(gate));
    }
    const missing = gates();
    delete missing[gate];
    assert.throws(() => requireGates(missing), new RegExp(gate));
  }
  const rows = gates();
  delete rows.signature;
  assert.throws(() => requireGates(rows), /signature/);
});

test('test and journey reports preserve skips and observations rather than counting them as passed', () => {
  assert.deepEqual(nodeTestCounts(countsLog), {
    tests: 2,
    suites: 0,
    pass: 1,
    fail: 0,
    cancelled: 0,
    skipped: 1,
    todo: 0,
    durationMs: 25.5,
  });
  assert.throws(() => nodeTestCounts(countsLog.replace('# fail 0', '# fail 1')), /failed/);
  assert.throws(() => nodeTestCounts('command exited zero'), /Missing/);
  const identity = { version: '0.41.0', sourceCommit: 'a'.repeat(40), exeSha256: 'b'.repeat(64) };
  const report = {
    ...identity,
    status: 'passed',
    cases: [
      { name: 'asserted', status: 'passed' },
      { name: 'observed only', status: 'observed' },
    ],
  };
  const summary = journeySummary(report, identity);
  assert.equal(summary.passed, 1);
  assert.equal(summary.observed, 1);
  assert.throws(
    () => journeySummary({ ...report, exeSha256: 'c'.repeat(64) }, identity),
    /different executable/,
  );
  assert.throws(
    () => journeySummary({ ...report, cases: [report.cases[1]] }, identity),
    /Observations alone/,
  );
});

test('release feed and startup measurement require the actual installer and ten completed starts', () => {
  const bytes = Buffer.from('synthetic installer bytes, never executable');
  const installer = 'ZhiXing-0.41.0-x64.exe';
  const expected = {
    version: '0.41.0',
    installer,
    bytes: bytes.length,
    sha512: hash(bytes, 'sha512', 'base64'),
  };
  validateUpdateFeed(feed('0.41.0', installer, bytes), expected);
  assert.throws(
    () => validateUpdateFeed(feed('0.40.0', installer, bytes), expected),
    /version differs/,
  );
  assert.throws(
    () => validateUpdateFeed(feed('0.41.0', installer, bytes), { ...expected, sha512: 'wrong' }),
    /hash/,
  );
  assert.equal(startupSummary(startupLog()).runs, 10);
  assert.throws(() => startupSummary(startupLog().split('\n').slice(1).join('\n')), /10 runs/);
});

test('release planning only permits the exact main push and a newer unpublished version', async (t) => {
  const f = await fixture(t);
  const args = {
    root: f.root,
    sha: f.sourceCommit,
    repository: REPOSITORY,
    ref: 'refs/heads/main',
    event: 'push',
    api: planApi(f),
  };
  const plan = await planRelease(args);
  assert.equal(plan.eligible, true);
  assert.equal(plan.baseCommit, f.baseCommit);
  await assert.rejects(planRelease({ ...args, event: 'pull_request' }), /Only a main push/);
  await assert.rejects(planRelease({ ...args, ref: 'refs/heads/feature' }), /Only main/);
  await assert.rejects(
    planRelease({
      ...args,
      api: planApi(f, {
        [`repos/${REPOSITORY}/git/ref/heads/main`]: { object: { sha: f.baseCommit } },
      }),
    }),
    /Main advanced/,
  );
  const published = await planRelease({
    ...args,
    api: planApi(f, {
      [`repos/${REPOSITORY}/releases/tags/v0.41.0`]: {
        tag_name: 'v0.41.0',
        draft: false,
        html_url: 'https://example.invalid/release',
      },
      [`repos/${REPOSITORY}/git/ref/tags/v0.41.0`]: {
        object: { type: 'commit', sha: f.baseCommit },
      },
    }),
  });
  assert.equal(published.eligible, false);
  const draft = { id: 41, tag_name: 'v0.41.0', draft: true, prerelease: true };
  const draftRows = {
    [`repos/${REPOSITORY}/releases?per_page=100`]: [draft, { tag_name: 'v0.40.0', draft: false }],
    [`repos/${REPOSITORY}/releases/41`]: draft,
  };
  const resumed = await planRelease({
    ...args,
    api: planApi(f, {
      ...draftRows,
      [`repos/${REPOSITORY}/git/ref/tags/v0.41.0`]: {
        object: { type: 'commit', sha: f.sourceCommit },
      },
    }),
  });
  assert.equal(resumed.existingDraftId, 41);
  await assert.rejects(
    planRelease({ ...args, api: planApi(f, draftRows) }),
    /draft needs the exact verified source tag/,
  );
  await assert.rejects(
    planRelease({
      ...args,
      api: planApi(f, {
        [`repos/${REPOSITORY}/git/ref/tags/v0.41.0`]: {
          object: { type: 'commit', sha: f.baseCommit },
        },
      }),
    }),
    /different commit/,
  );
});

test('draft lookup handles the real by-tag 404 contract and reads the listed release by ID', async () => {
  const visited = [];
  const draft = { id: 41, tag_name: 'v0.41.0', draft: true, prerelease: true };
  const api = async (endpoint, options) => {
    visited.push(endpoint);
    assert.ok(!options?.method || options.method === 'GET');
    if (endpoint.endsWith('/tags/v0.41.0')) {
      assert.equal(options.allow404, true);
      return null;
    }
    if (endpoint.endsWith('/releases?per_page=100')) return [draft];
    if (endpoint.endsWith('/releases/41')) return draft;
    assert.fail(`Unexpected request: ${endpoint}`);
  };
  assert.deepEqual(await releaseForTag(REPOSITORY, draft.tag_name, api), draft);
  assert.deepEqual(visited, [
    `repos/${REPOSITORY}/releases/tags/v0.41.0`,
    `repos/${REPOSITORY}/releases?per_page=100`,
    `repos/${REPOSITORY}/releases/41`,
  ]);
  await assert.rejects(
    releaseForTag(REPOSITORY, draft.tag_name, async (endpoint, options) => {
      const value = await api(endpoint, options);
      return endpoint.endsWith('/releases/41') ? { ...value, tag_name: 'v0.40.0' } : value;
    }),
    /v0\.40\.0/,
  );
});

test('new draft lookup retries only temporary absence and keeps an exact source identity', async () => {
  const tag = 'v0.42.0',
    sourceCommit = 'a'.repeat(40);
  const draft = {
    id: 42,
    tag_name: tag,
    target_commitish: sourceCommit,
    draft: true,
    prerelease: true,
  };
  const waits = [];
  let lookups = 0;
  const result = await findCreatedDraft({
    tag,
    sourceCommit,
    lookup: async (repository, observedTag) => {
      assert.equal(repository, REPOSITORY);
      assert.equal(observedTag, tag);
      lookups += 1;
      return lookups < 3 ? null : draft;
    },
    wait: async (delay) => {
      waits.push(delay);
    },
  });
  assert.deepEqual(result, draft);
  assert.equal(lookups, 3);
  assert.deepEqual(waits, [500, 1000]);
  for (const invalid of [
    { id: 0 },
    { tag_name: 'v0.41.0' },
    { target_commitish: 'b'.repeat(40) },
    { draft: false },
    { prerelease: false },
  ]) {
    let attempts = 0;
    await assert.rejects(
      findCreatedDraft({
        tag,
        sourceCommit,
        lookup: async () => {
          attempts += 1;
          return { ...draft, ...invalid };
        },
        wait: async () => assert.fail('Identity mismatches must not be retried'),
      }),
    );
    assert.equal(attempts, 1);
  }
});

test('new draft lookup fails after four missing records and propagates API failures', async () => {
  const tag = 'v0.42.0',
    sourceCommit = 'a'.repeat(40);
  const waits = [];
  let lookups = 0;
  await assert.rejects(
    findCreatedDraft({
      tag,
      sourceCommit,
      lookup: async () => {
        lookups += 1;
        return null;
      },
      wait: async (delay) => {
        waits.push(delay);
      },
    }),
    /not found by its real release ID/,
  );
  assert.equal(lookups, 4);
  assert.deepEqual(waits, [500, 1000, 2000]);
  const failure = new Error('Synthetic GitHub request failure');
  await assert.rejects(
    findCreatedDraft({
      tag,
      sourceCommit,
      lookup: async () => {
        throw failure;
      },
      wait: async () => assert.fail('API errors must not be silently retried'),
    }),
    (error) => error === failure,
  );
});

test('asset assembly produces exactly 18 files with a non-self-referential checksum manifest', async (t) => {
  const f = await fixture(t);
  const evidence = path.join(f.directory, 'evidence'),
    output = path.join(f.directory, 'bundle');
  const put = async (file, content) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content),
    );
  };
  const version = '0.41.0',
    exe = Buffer.from('synthetic application bytes'),
    installer = Buffer.from('synthetic installer bytes');
  const app = path.join(f.root, 'release/win-unpacked/resources/app');
  const identity = { version, sourceCommit: f.sourceCommit, exeSha256: hash(exe) };
  const lockSha256 = 'd'.repeat(64);
  await put(path.join(app, 'build-provenance.json'), {
    version,
    sourceCommit: f.sourceCommit,
    sourceDirty: false,
    nodeVersion: 'v24.19.0',
    lockSha256,
  });
  await put(path.join(f.root, 'release/win-unpacked/知行.exe'), exe);
  await put(
    path.join(f.root, 'release/win-unpacked/resources/app-update.yml'),
    'provider: github\n',
  );
  await put(path.join(f.root, `release/ZhiXing-${version}-x64.exe`), installer);
  await put(path.join(f.root, `release/ZhiXing-${version}-x64.exe.blockmap`), 'synthetic blockmap');
  await put(
    path.join(f.root, 'release/latest.yml'),
    feed(version, `ZhiXing-${version}-x64.exe`, installer),
  );
  await put(path.join(evidence, 'packed-source-manifest.json'), {
    version,
    sourceCommit: f.sourceCommit,
    lockSha256,
    matchedFiles: 1,
    sourceFingerprint: 'f'.repeat(64),
  });
  for (const name of ['unit', 'components', 'sites'])
    await put(path.join(evidence, `logs/${name}.log`), countsLog);
  await put(
    path.join(evidence, 'logs/packed.log'),
    JSON.stringify({
      type: 'packed-test-scope',
      unit: 'test-files',
      'package-aware': ['synthetic.test.mjs'],
      'mixed-source': [],
      'source-only': [],
    }) +
      '\n' +
      countsLog,
  );
  await put(
    path.join(evidence, 'logs/quality.log'),
    'ESLint 1/2 JS files; Stylelint 1/1 CSS files; Prettier 1/3 text files.\nErrors: 0; warnings: 0.\n',
  );
  await put(path.join(evidence, 'logs/startup.log'), startupLog());
  for (const name of ['errors', 'native', 'phase0a', 'phase1', 'workbench', 'approvals'])
    await put(
      path.join(
        evidence,
        `journeys/${name}/${name === 'workbench' ? 'workbench-preview-ui-fixture' : 'run-fixture'}/result.json`,
      ),
      {
        ...identity,
        status: 'passed',
        cases: [{ name: 'synthetic asserted case', status: 'passed' }],
      },
    );
  await put(path.join(f.root, `.preview/qa-${version}/tool-timeline/run-fixture/result.json`), {
    ...identity,
    status: 'passed',
    cases: [{ name: 'synthetic tool case', status: 'passed' }],
  });
  await put(path.join(evidence, 'dependencies/summary.json'), {
    appVersion: version,
    packageCount: 2,
    vulnerabilities: { high: 0, critical: 0 },
  });
  await put(path.join(evidence, 'dependencies/production-inventory.json'), {
    appVersion: version,
    lockSha256,
  });
  await put(path.join(evidence, 'dependencies/production-sbom.cdx.json'), {
    bomFormat: 'CycloneDX',
  });
  await put(path.join(evidence, 'dependencies/advisories-by-path.json'), []);
  await put(path.join(evidence, 'signature-status.json'), {
    version: '0.41.0',
    sourceCommit: f.sourceCommit,
    installer: 'NotSigned',
    executable: 'NotSigned',
  });
  for (const name of ['iteration', 'audit-request'])
    await put(path.join(f.root, `docs/${name}-${version}.md`), '# Synthetic authored notes\n');
  await put(path.join(f.root, `release-notes-${version}.md`), '# Synthetic release notes\n');
  await put(path.join(f.root, 'docs/harness-capability-map.md'), '# Synthetic capability map\n');
  const plan = {
    schemaVersion: 1,
    eligible: true,
    repository: REPOSITORY,
    version,
    sourceCommit: f.sourceCommit,
    sourceTree: f.sourceTree,
    baseTag: 'v0.40.0',
    baseCommit: f.baseCommit,
  };
  const result = await assembleRelease({
    root: f.root,
    evidence,
    output,
    plan,
    steps: gates(),
    runId: '1234',
  });
  assert.equal(result.assets, 18);
  const manifest = await verifyBundle(output, f.sourceCommit);
  assert.deepEqual(
    manifest.files.map((row) => row.name).sort(),
    assetNames(version, 'v0.40.0').sort(),
  );
  const checksumLines = (
    await fs.readFile(path.join(output, 'assets/SHA256SUMS-release.txt'), 'utf8')
  )
    .trim()
    .split('\n');
  assert.equal(checksumLines.length, 17);
  assert.ok(checksumLines.every((line) => !line.endsWith('  SHA256SUMS-release.txt')));
  const summary = JSON.parse(
    await fs.readFile(path.join(output, `assets/acceptance-summary-${version}.json`), 'utf8'),
  );
  assert.equal(summary.checks.unit.skipped, 1);
  assert.equal(summary.installationLifecycle, 'not_run');
  await fs.appendFile(path.join(output, 'assets/latest.yml'), '# changed after validation\n');
  await assert.rejects(verifyBundle(output, f.sourceCommit), /size differs/);
});

test('remote asset validation rejects a mismatch and downloads bytes when GitHub omits its digest', async () => {
  const expected = [{ name: 'a.txt', bytes: 3, sha256: hash('abc') }];
  const asset = {
    id: 1,
    name: 'a.txt',
    size: 3,
    state: 'uploaded',
    digest: `sha256:${hash('abc')}`,
  };
  let downloads = 0;
  const download = async () => {
    downloads += 1;
    return { bytes: 3, sha256: hash('abc') };
  };
  assert.equal(
    (await verifyRemoteAssets(expected, [asset], download))[0].method,
    'github-api-sha256',
  );
  assert.equal(downloads, 0);
  assert.equal(
    (await verifyRemoteAssets(expected, [{ ...asset, digest: null }], download))[0].method,
    'independently-downloaded-sha256',
  );
  assert.equal(downloads, 1);
  await assert.rejects(
    verifyRemoteAssets(expected, [{ ...asset, digest: `sha256:${hash('bad')}` }], download),
    /digest differs/,
  );
  await assert.rejects(
    verifyRemoteAssets(expected, [{ ...asset, digest: null }], async () => ({
      bytes: 3,
      sha256: hash('bad'),
    })),
    /digest differs/,
  );
  await assert.rejects(verifyRemoteAssets(expected, [asset, asset], download), /duplicate/);
});

test('draft retries replace only provably incomplete or different assets', async () => {
  const file = { name: 'a.txt', bytes: 3, sha256: hash('abc') };
  const asset = {
    id: 1,
    name: file.name,
    size: file.bytes,
    state: 'uploaded',
    digest: `sha256:${file.sha256}`,
  };
  assert.equal(draftAssetNeedsReplacement(file, asset), false);
  assert.equal(draftAssetNeedsReplacement(file, { ...asset, state: 'starter' }), true);
  assert.equal(draftAssetNeedsReplacement(file, { ...asset, size: 1 }), true);
  assert.equal(
    draftAssetNeedsReplacement(file, { ...asset, digest: `sha256:${hash('bad')}` }),
    true,
  );
  const noDigest = { ...asset, digest: null };
  assert.equal(draftAssetNeedsReplacement(file, noDigest), false);
  await assert.rejects(
    verifyRemoteAssets([file], [noDigest], async () => {
      throw new Error('synthetic network failure');
    }),
    /synthetic network failure/,
  );
  assert.throws(
    () => draftAssetNeedsReplacement(file, { ...asset, digest: 'unexpected format' }),
    /Unrecognized/,
  );
});

test('fallback download streams bytes and never forwards the GitHub token to storage hosts', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, headers: options.headers });
    return requests.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/synthetic' },
        })
      : new Response('abc');
  };
  const result = await downloadedAssetDigest({ id: 5 }, 3, {
    token: 'synthetic-fixture-token',
    fetcher,
  });
  assert.equal(result.sha256, hash('abc'));
  assert.equal(requests[0].headers.authorization, 'Bearer synthetic-fixture-token');
  assert.equal(requests[1].headers.authorization, undefined);
  await assert.rejects(
    downloadedAssetDigest({ id: 5 }, 3, { fetcher: async () => new Response('too long') }),
    /exceeds/,
  );
  await assert.rejects(
    downloadedAssetDigest({ id: 5 }, 3, {
      fetcher: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://untrusted.example.invalid/file' },
        }),
    }),
    /Unexpected release download host/,
  );
});

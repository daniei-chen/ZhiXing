import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  REPOSITORY,
  commitOf,
  githubApi,
  releaseForTag,
  tagCommit,
  verifyBundle,
} from './release-common.mjs';

const run = promisify(execFile);

export async function downloadedAssetDigest(
  asset,
  expectedBytes,
  { token = process.env.GH_TOKEN, fetcher = fetch } = {},
) {
  assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0, 'Invalid release asset id');
  let address = `https://api.github.com/repos/${REPOSITORY}/releases/assets/${asset.id}`;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const url = new URL(address);
    assert.equal(url.protocol, 'https:');
    assert.ok(
      [
        'api.github.com',
        'release-assets.githubusercontent.com',
        'objects.githubusercontent.com',
      ].includes(url.hostname),
      'Unexpected release download host',
    );
    const response = await fetcher(address, {
      headers: {
        accept: 'application/octet-stream',
        'user-agent': 'zhixing-release-verifier',
        ...(url.hostname === 'api.github.com' ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(180000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      assert.ok(location, 'Release redirect omitted its location');
      address = new URL(location, address).href;
      await response.body?.cancel();
      continue;
    }
    assert.equal(response.status, 200, `Release download returned HTTP ${response.status}`);
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      assert.ok(bytes <= expectedBytes, 'Downloaded asset exceeds its expected size');
      hash.update(chunk);
    }
    assert.equal(bytes, expectedBytes, 'Downloaded asset is incomplete');
    return { bytes, sha256: hash.digest('hex') };
  }
  throw new Error('Too many release asset redirects');
}

export async function verifyRemoteAssets(expected, actual, download = downloadedAssetDigest) {
  assert.deepEqual(
    actual.map((row) => row.name).sort(),
    expected.map((row) => row.name).sort(),
    'Remote release has missing, duplicate, or extra assets',
  );
  const verified = [];
  for (const file of expected) {
    const asset = actual.find((row) => row.name === file.name);
    assert.equal(asset.state, 'uploaded', `Asset upload is incomplete: ${file.name}`);
    assert.equal(asset.size, file.bytes, `Remote asset size differs: ${file.name}`);
    let method = 'github-api-sha256',
      sha256;
    if (asset.digest == null || asset.digest === '') {
      const downloaded = await download(asset, file.bytes);
      assert.equal(downloaded.bytes, file.bytes);
      sha256 = downloaded.sha256;
      method = 'independently-downloaded-sha256';
    } else {
      assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/, 'Unrecognized GitHub asset digest');
      sha256 = asset.digest.slice(7);
    }
    assert.equal(sha256, file.sha256, `Remote asset digest differs: ${file.name}`);
    verified.push({
      name: file.name,
      assetId: asset.id,
      bytes: file.bytes,
      sha256,
      method,
      url: asset.browser_download_url,
    });
  }
  return verified;
}

export function draftAssetNeedsReplacement(file, asset) {
  if (asset.state !== 'uploaded' || asset.size !== file.bytes) return true;
  // Missing digest needs a byte download. An unavailable download is a failed
  // verification, never evidence that an already uploaded asset can be deleted.
  if (asset.digest == null || asset.digest === '') return false;
  assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/, 'Unrecognized GitHub asset digest');
  return asset.digest !== `sha256:${file.sha256}`;
}

async function gh(args) {
  const result = await run('gh', args, {
    env: process.env,
    timeout: 300000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function assetsFor(releaseId) {
  const rows = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await githubApi(
      `repos/${REPOSITORY}/releases/${releaseId}/assets?per_page=100&page=${page}`,
    );
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error('Unexpectedly large release asset collection');
}

// 0.41.0 created its draft successfully, but the immediately following lookup
// returned no record. Retry only that observed absence, never draft creation.
export async function findCreatedDraft({
  tag,
  sourceCommit,
  lookup = releaseForTag,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  for (const delay of [0, 500, 1000, 2000]) {
    if (delay) await wait(delay);
    const release = await lookup(REPOSITORY, tag);
    if (!release) continue;
    assert.ok(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid created draft ID');
    assert.equal(release.tag_name, tag, 'Created draft tag differs from the verified bundle');
    assert.equal(release.target_commitish, sourceCommit, 'Created draft has a different source');
    assert.equal(release.draft, true, 'Newly created release is no longer a draft');
    assert.equal(release.prerelease, true, 'Newly created release must be a prerelease');
    return release;
  }
  throw new Error('The newly created draft was not found by its real release ID');
}

export async function publishRelease({ bundle, sha, ref, event }) {
  assert.ok(process.env.GH_TOKEN, 'The publishing job needs its scoped GitHub token');
  assert.equal(process.env.GITHUB_REPOSITORY, REPOSITORY);
  assert.equal(ref, 'refs/heads/main');
  assert.equal(event, 'push');
  commitOf(sha);
  const manifest = await verifyBundle(bundle, sha);
  const main = await githubApi(`repos/${REPOSITORY}/git/ref/heads/main`);
  assert.equal(main.object.sha, sha, 'Main advanced; refusing to publish an obsolete checkout');
  const commit = await githubApi(`repos/${REPOSITORY}/git/commits/${sha}`);
  assert.equal(
    commit.tree.sha,
    manifest.sourceTree,
    'Remote source tree differs from the verified bundle',
  );
  let tagged = await tagCommit(REPOSITORY, manifest.tag);
  let release = await releaseForTag(REPOSITORY, manifest.tag);
  if (release)
    assert.equal(tagged, sha, 'An existing release must retain the exact verified source tag');
  if (!tagged) {
    await githubApi(`repos/${REPOSITORY}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/tags/${manifest.tag}`, sha },
    });
    tagged = await tagCommit(REPOSITORY, manifest.tag);
  }
  assert.equal(tagged, sha, 'Release tag must point to the exact verified main checkout');
  if (!release) {
    await gh([
      'release',
      'create',
      manifest.tag,
      '--repo',
      REPOSITORY,
      '--target',
      sha,
      '--verify-tag',
      '--draft',
      '--prerelease',
      '--title',
      `知行 ${manifest.version} · Windows 预发行版`,
      '--notes-file',
      path.join(bundle, 'assets', `release-notes-${manifest.version}.md`),
    ]);
    release = await findCreatedDraft({ tag: manifest.tag, sourceCommit: sha });
  }
  assert.equal(release.tag_name, manifest.tag);
  assert.equal(release.prerelease, true, 'This workflow only publishes prereleases');
  const receipt = {
    schemaVersion: 1,
    repository: REPOSITORY,
    version: manifest.version,
    sourceCommit: sha,
    sourceTree: manifest.sourceTree,
    tag: manifest.tag,
    releaseId: release.id,
    runId: process.env.GITHUB_RUN_ID,
    status: 'verifying',
    releaseUrl: release.html_url,
    files: [],
  };
  if (release.draft) {
    for (const file of manifest.files) {
      const current = await githubApi(`repos/${REPOSITORY}/releases/${release.id}`);
      assert.equal(
        current.draft,
        true,
        'Release became public before upload completion; refusing asset mutation',
      );
      const existing = (await assetsFor(release.id)).find((row) => row.name === file.name);
      if (existing) {
        if (!draftAssetNeedsReplacement(file, existing)) {
          await verifyRemoteAssets([file], [existing]);
          continue;
        }
        // Only an unpublished draft at the exact verified tag can replace an
        // asset whose metadata proves it incomplete or different. Recheck draft
        // state immediately before the write, including on a resumed run.
        const beforeDelete = await githubApi(`repos/${REPOSITORY}/releases/${release.id}`);
        assert.equal(beforeDelete.draft, true, 'Cannot replace a public release asset');
        await githubApi(`repos/${REPOSITORY}/releases/assets/${existing.id}`, {
          method: 'DELETE',
        });
      }
      let uploaded = false;
      for (let attempt = 0; attempt < 3 && !uploaded; attempt += 1) {
        try {
          await gh([
            'release',
            'upload',
            manifest.tag,
            path.join(bundle, 'assets', file.name),
            '--repo',
            REPOSITORY,
          ]);
          uploaded = true;
        } catch (error) {
          const observed = (await assetsFor(release.id)).find((row) => row.name === file.name);
          if (observed) {
            await verifyRemoteAssets([file], [observed]);
            uploaded = true;
          } else if (attempt === 2) throw error;
          else await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
        }
      }
    }
    receipt.files = await verifyRemoteAssets(manifest.files, await assetsFor(release.id));
    assert.equal(await tagCommit(REPOSITORY, manifest.tag), sha);
    assert.equal(
      (await githubApi(`repos/${REPOSITORY}/git/ref/heads/main`)).object.sha,
      sha,
      'Main advanced before publication',
    );
    await gh([
      'release',
      'edit',
      manifest.tag,
      '--repo',
      REPOSITORY,
      '--draft=false',
      '--prerelease',
      '--latest=false',
    ]);
  }
  // A rerun can inspect an already published release, but never overwrite it.
  release = await githubApi(`repos/${REPOSITORY}/releases/${release.id}`);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, true);
  assert.equal(await tagCommit(REPOSITORY, manifest.tag), sha);
  receipt.releaseUrl = release.html_url;
  receipt.files = await verifyRemoteAssets(manifest.files, await assetsFor(release.id));
  receipt.status = 'published_and_verified';
  receipt.verifiedAt = new Date().toISOString();
  receipt.assetCount = receipt.files.length;
  receipt.digestFallbackDownloads = receipt.files.filter(
    (row) => row.method === 'independently-downloaded-sha256',
  ).length;
  receipt.boundary =
    'Release asset bytes were checked; this does not establish installation, signing, upgrade, or real-cloud acceptance.';
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [bundle, receiptFile] = process.argv.slice(2);
  assert.ok(bundle && receiptFile, 'Pass bundle and receipt paths');
  let receipt;
  try {
    receipt = await publishRelease({
      bundle: path.resolve(bundle),
      sha: process.env.GITHUB_SHA,
      ref: process.env.GITHUB_REF,
      event: process.env.GITHUB_EVENT_NAME,
    });
    console.log(
      JSON.stringify({
        status: receipt.status,
        releaseUrl: receipt.releaseUrl,
        assetCount: receipt.assetCount,
      }),
    );
  } catch (error) {
    receipt = {
      schemaVersion: 1,
      status: 'failed_or_incomplete',
      sourceCommit: process.env.GITHUB_SHA,
      error: error.message,
      boundary:
        'Inspect the exact release/tag state before retrying; a failed network response does not prove that no remote object was created.',
    };
    process.exitCode = 1;
    console.error(error.message);
  }
  await fs.mkdir(path.dirname(path.resolve(receiptFile)), { recursive: true });
  await fs.writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
}

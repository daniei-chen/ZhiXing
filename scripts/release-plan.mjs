import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPOSITORY,
  commitOf,
  compareVersions,
  git,
  githubApi,
  jsonFile,
  releaseForTag,
  tagCommit,
  versionOf,
} from './release-common.mjs';

export async function planRelease({ root, sha, repository, ref, event, api = githubApi }) {
  assert.equal(repository, REPOSITORY);
  assert.equal(ref, 'refs/heads/main', 'Only main can start a release');
  assert.equal(event, 'push', 'Only a main push can start a release');
  commitOf(sha);
  assert.equal(
    git(root, ['rev-parse', 'HEAD']),
    sha,
    'Checkout differs from the triggering main commit',
  );
  const version = versionOf((await jsonFile(path.join(root, 'package.json'))).version);
  const tag = `v${version}`;
  const sourceTree = git(root, ['rev-parse', 'HEAD^{tree}']);
  const main = await api(`repos/${repository}/git/ref/heads/main`);
  assert.equal(main.object.sha, sha, 'Main advanced before this release started');
  const release = await releaseForTag(repository, tag, api);
  const tagged = await tagCommit(repository, tag, api);
  const base = { schemaVersion: 1, repository, version, tag, sourceCommit: sha, sourceTree };
  if (release && !release.draft) {
    assert.ok(tagged, 'Published release has no resolvable tag');
    return {
      ...base,
      eligible: false,
      reason: 'version-already-published',
      releaseUrl: release.html_url,
      publishedCommit: tagged,
    };
  }
  if (tagged) assert.equal(tagged, sha, 'An unpublished release tag points to a different commit');
  if (release?.draft)
    assert.equal(tagged, sha, 'An existing draft needs the exact verified source tag');
  const releases = await api(`repos/${repository}/releases?per_page=100`);
  const previous = releases
    .filter((row) => !row.draft && /^v\d+\.\d+\.\d+$/.test(row.tag_name))
    .sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
  assert.ok(previous, 'A published baseline is required for the audit patch');
  assert.ok(
    compareVersions(version, previous.tag_name.slice(1)) > 0,
    'Release version must be newer than the published baseline',
  );
  const baseCommit = await tagCommit(repository, previous.tag_name, api);
  assert.ok(baseCommit, 'Published baseline tag is missing');
  assert.equal(
    git(root, ['rev-parse', `${previous.tag_name}^{commit}`]),
    baseCommit,
    'Local baseline tag differs from GitHub',
  );
  git(root, ['merge-base', '--is-ancestor', baseCommit, sha]);
  return {
    ...base,
    eligible: true,
    baseTag: previous.tag_name,
    baseCommit,
    existingDraftId: release?.id ?? null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const plan = await planRelease({
    root,
    sha: process.env.GITHUB_SHA,
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
    event: process.env.GITHUB_EVENT_NAME,
  });
  const destination = process.argv[2];
  assert.ok(destination, 'Pass a destination for the release plan');
  await fs.mkdir(path.dirname(path.resolve(destination)), { recursive: true });
  await fs.writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `eligible=${plan.eligible}\nversion=${plan.version}\ntag=${plan.tag}\n`,
    );
  console.log(JSON.stringify(plan));
}

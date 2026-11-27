import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const { WorkspacePersistence, loadWorkspacePersistence } = await import(
  packed
    ? pathToFileURL(path.join(packed, 'electron/workspace-persistence.mjs')).href
    : '../electron/workspace-persistence.mjs'
);
const { renameEncryptedTemp } = await import(
  packed
    ? pathToFileURL(path.join(packed, 'harness/privacy-bridge.mjs')).href
    : '../harness/privacy-bridge.mjs'
);

const draft = (text, revision = 1) => ({
  kind: 'new',
  draftId: 'one',
  workspaceId: 'office-home',
  projectId: null,
  revision,
  filesRevision: 0,
  text,
  files: [],
  updatedAt: revision,
});
const workspace = (drafts = {}, changes = {}) => ({
  version: 2,
  workspaceId: 'office-home',
  workspaces: [{ id: 'office-home', type: 'office' }],
  projects: [],
  chats: [],
  documents: [],
  automations: [],
  settings: { persist: true },
  drafts,
  ...changes,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function fixture({
  state = workspace(),
  epoch = 'baseline',
  beforeWrite,
  afterBaselineWrite,
} = {}) {
  let baseline = JSON.stringify({ ...state, ...(epoch ? { draftEpoch: epoch } : {}) });
  let overlay = null;
  let nextEpoch = 0;
  const writes = [];
  const persistence = new WorkspacePersistence({
    initialState: state,
    initialEpoch: epoch,
    createEpoch: () => `epoch-${++nextEpoch}`,
    write: async (commit) => {
      writes.push(commit);
      await beforeWrite?.(commit, writes.length);
      if (commit.kind === 'workspace') {
        baseline = commit.body;
        await afterBaselineWrite?.(commit, writes.length);
        overlay = null;
      } else overlay = commit.body;
    },
  });
  return {
    persistence,
    writes,
    get baseline() {
      return baseline;
    },
    get overlay() {
      return overlay;
    },
    set overlay(value) {
      overlay = value;
    },
    read: () =>
      loadWorkspacePersistence({
        readWorkspace: async () => baseline,
        readDrafts: async () => overlay,
      }),
  };
}

test('legacy workspace drafts retain their keys, attachments and revisions without reading a sidecar', async () => {
  const original = workspace({
    'legacy-first': {
      ...draft('旧草稿', 7),
      filesRevision: 3,
      files: [{ name: '材料.pdf', text: '正文' }],
    },
    'chat:missing': { ...draft('缺失归属仍保留'), kind: 'chat', chatId: 'missing' },
  });
  const loaded = await loadWorkspacePersistence({
    readWorkspace: async () => JSON.stringify(original),
    readDrafts: async () => {
      throw new Error('A legacy workspace must not adopt unrelated sidecars.');
    },
  });
  assert.deepEqual(loaded, { state: original, epoch: null });
});

test('matching overlay restores edits while an empty overlay does not resurrect baseline drafts', async () => {
  const app = fixture({ state: workspace({ original: draft('BASELINE_MARKER') }) });
  await app.persistence.saveDrafts({ edited: draft('OVERLAY_MARKER', 4) });
  assert.deepEqual((await app.read()).state.drafts, { edited: draft('OVERLAY_MARKER', 4) });
  await app.persistence.saveDrafts({});
  assert.deepEqual((await app.read()).state.drafts, {});
  assert.equal(app.writes[0].epoch, 'baseline');
  assert.equal(app.writes[1].epoch, 'baseline');
});

test('a superseded epoch cannot restore deleted drafts after a full commit', async () => {
  const app = fixture({ state: workspace({ original: draft('DELETE_MARKER') }) });
  await app.persistence.saveDrafts({ original: draft('LATEST_DELETE_MARKER', 2) });
  const staleOverlay = app.overlay;
  const next = workspace(
    {},
    { pendingWorkspaceDeletes: [{ id: 'delete-op', chatIds: ['gone'], taskIds: [] }] },
  );
  await app.persistence.saveWorkspace(next);
  app.overlay = staleOverlay;
  const loaded = await app.read();
  assert.deepEqual(loaded.state, next);
  assert.equal(loaded.epoch, 'epoch-1');
  assert.doesNotMatch(JSON.stringify(loaded.state), /DELETE_MARKER/);
});

test('missing overlays use the durable baseline and missing workspaces do not adopt orphan overlays', async () => {
  const app = fixture({ state: workspace({ one: draft('baseline') }) });
  assert.deepEqual((await app.read()).state.drafts, { one: draft('baseline') });
  assert.deepEqual(
    await loadWorkspacePersistence({
      readWorkspace: async () => null,
      readDrafts: async () => {
        throw new Error('Must not read an orphan overlay.');
      },
    }),
    { state: null, epoch: null },
  );
});

test('corrupt matching overlays fail closed without returning or exposing baseline content', async () => {
  const app = fixture({ state: workspace({ one: draft('PRIVATE_BASELINE_MARKER') }) });
  for (const body of [
    '{"PRIVATE_BROKEN_MARKER',
    JSON.stringify({ version: 1, draftEpoch: 'baseline', drafts: { one: null } }),
    JSON.stringify({ version: 1, draftEpoch: 'baseline' }),
    JSON.stringify({ version: 3, draftEpoch: 'baseline', drafts: {} }),
    JSON.stringify({ version: 1, drafts: {} }),
  ]) {
    app.overlay = body;
    await assert.rejects(app.read(), (error) => {
      assert.match(error.code, /^DRAFT_/);
      assert.doesNotMatch(error.message, /PRIVATE_|MARKER/);
      return true;
    });
    assert.equal(app.overlay, body, 'read failures never replace the original bytes');
  }
});

test('overlay reads crossing a baseline commit retry instead of returning a mixed snapshot', async () => {
  let baseline = JSON.stringify({ ...workspace({ one: draft('old') }), draftEpoch: 'old' });
  const next = workspace({ one: draft('new baseline') }, { projects: [{ id: 'new-project' }] });
  let reads = 0;
  const loaded = await loadWorkspacePersistence({
    readWorkspace: async () => baseline,
    readDrafts: async () => {
      reads++;
      baseline = JSON.stringify({ ...next, draftEpoch: 'new' });
      return JSON.stringify({
        version: 1,
        draftEpoch: 'new',
        drafts: { one: draft('new overlay', 8) },
      });
    },
  });
  assert.equal(reads, 2);
  assert.equal(loaded.epoch, 'new');
  assert.deepEqual(loaded.state.projects, next.projects);
  assert.equal(loaded.state.drafts.one.text, 'new overlay');
});

test('draft-only saves leave baseline bytes unchanged and expose only draft payload to the writer', async () => {
  const app = fixture({
    state: workspace({}, { chats: [{ id: 'chat', messages: [{ text: 'HISTORY_MARKER' }] }] }),
  });
  const baseline = app.baseline;
  await app.persistence.saveDrafts({ one: draft('草稿', 2) });
  await app.persistence.flush();
  assert.equal(app.baseline, baseline);
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].kind, 'drafts');
  assert.doesNotMatch(app.writes[0].body, /HISTORY_MARKER/);
  assert.deepEqual(app.persistence.state(), {
    status: 'saved',
    requestedRevision: 1,
    persistedRevision: 1,
  });
});

test('the first legacy draft save migrates once and later edits only write the overlay', async () => {
  const app = fixture({ epoch: null, state: workspace({ old: draft('old') }) });
  await app.persistence.saveDrafts({ old: draft('first edit', 2) });
  const migrated = app.baseline;
  await app.persistence.saveDrafts({ old: draft('second edit', 3) });
  assert.deepEqual(
    app.writes.map((row) => row.kind),
    ['workspace', 'drafts'],
  );
  assert.equal(app.baseline, migrated);
  assert.equal((await app.read()).state.drafts.old.text, 'second edit');
});

test('coalescing drafts after two structural saves retains the latest structural intent', async () => {
  const gate = deferred();
  const app = fixture({ beforeWrite: (_, count) => (count === 1 ? gate.promise : undefined) });
  const first = app.persistence.saveWorkspace(
    workspace({ one: draft('first') }, { projects: [{ id: 'first' }] }),
  );
  const second = app.persistence.saveWorkspace(
    workspace({ one: draft('second') }, { projects: [{ id: 'second' }] }),
  );
  const latest = app.persistence.saveDrafts({ one: draft('latest', 3) });
  const flushing = app.persistence.flush();
  gate.resolve();
  await Promise.all([first, second, latest, flushing]);
  assert.deepEqual(
    app.writes.map((row) => row.kind),
    ['workspace', 'workspace'],
  );
  assert.deepEqual(app.writes[1].state.projects, [{ id: 'second' }]);
  assert.equal(app.writes[1].state.drafts.one.text, 'latest');
  assert.equal(app.writes[1].revision, 3);
  assert.equal((await app.read()).state.drafts.one.text, 'latest');
});

test('coalescing a pending full save behind an active draft write preserves both stores', async () => {
  const gate = deferred();
  const app = fixture({ beforeWrite: (_, count) => (count === 1 ? gate.promise : undefined) });
  const first = app.persistence.saveDrafts({ one: draft('first') });
  const full = app.persistence.saveWorkspace(
    workspace({ one: draft('middle') }, { chats: [{ id: 'created', messages: [] }] }),
  );
  const latest = app.persistence.saveDrafts({ one: draft('last', 3) });
  gate.resolve();
  await Promise.all([first, full, latest, app.persistence.flush()]);
  assert.deepEqual(
    app.writes.map((row) => row.kind),
    ['drafts', 'workspace'],
  );
  assert.equal(app.overlay, null);
  const loaded = (await app.read()).state;
  assert.equal(loaded.chats[0].id, 'created');
  assert.equal(loaded.drafts.one.text, 'last');
});

test('a failed active full save cannot let a newer draft incorrectly commit as an overlay', async () => {
  const gate = deferred();
  const app = fixture({ beforeWrite: (_, count) => (count === 1 ? gate.promise : undefined) });
  const full = app.persistence.saveWorkspace(workspace({}, { projects: [{ id: 'must-survive' }] }));
  const latest = app.persistence.saveDrafts({ one: draft('last') });
  gate.reject(Object.assign(new Error('synthetic full write failure'), { code: 'ENOSPC' }));
  await Promise.all([full, latest, app.persistence.flush()]);
  assert.deepEqual(
    app.writes.map((row) => row.kind),
    ['workspace', 'workspace'],
  );
  assert.equal((await app.read()).state.projects[0].id, 'must-survive');
  assert.equal((await app.read()).state.drafts.one.text, 'last');
});

test('failed overlay saves retain their revision and retry persistence without repeating any task', async () => {
  const app = fixture({
    beforeWrite: (_, count) => {
      if (count === 1) throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' });
    },
  });
  await assert.rejects(app.persistence.saveDrafts({ one: draft('retry me') }), { code: 'ENOSPC' });
  await assert.rejects(app.persistence.flush(), { code: 'ENOSPC' });
  assert.equal(app.overlay, null);
  assert.deepEqual(app.persistence.state(), {
    status: 'failed',
    requestedRevision: 1,
    persistedRevision: 0,
    errorCode: 'ENOSPC',
  });
  await app.persistence.retry();
  assert.equal(app.writes.length, 2);
  assert.equal(app.writes[0].body, app.writes[1].body);
  assert.equal(app.writes[1].revision, 1);
  assert.equal((await app.read()).state.drafts.one.text, 'retry me');
});

test('shared atomic replacement keeps the draft commit and following full save in one queue', async (t) => {
  const entered = deferred(),
    releaseFirst = deferred(),
    retried = deferred(),
    releaseRetry = deferred();
  const attempts = [];
  const fault = Object.assign(new Error('Synthetic temporary Windows sharing violation'), {
    code: 'EPERM',
  });
  t.mock.method(fs, 'rename', async (temp, target) => {
    attempts.push({ temp, target });
    if (attempts.length === 1) {
      entered.resolve();
      await releaseFirst.promise;
      if (process.platform === 'win32') throw fault;
    } else if (target === 'drafts.bin') {
      retried.resolve();
      await releaseRetry.promise;
    }
  });
  const app = fixture({
    beforeWrite: (commit) =>
      renameEncryptedTemp(`encrypted-${commit.kind}.tmp`, `${commit.kind}.bin`),
  });
  const baseline = app.baseline;
  const first = app.persistence.saveDrafts({ one: draft('first', 2) });
  await entered.promise;
  const full = app.persistence.saveWorkspace(
    workspace({ one: draft('middle', 3) }, { projects: [{ id: 'must-survive' }] }),
  );
  const latest = app.persistence.saveDrafts({ one: draft('latest', 4) });
  let acknowledged = false;
  const flushing = app.persistence.flush().then(() => {
    acknowledged = true;
  });
  const pending = Promise.all([first, full, latest, flushing]);
  try {
    assert.equal(app.writes.length, 1);
    assert.equal(app.baseline, baseline);
    assert.equal(app.overlay, null);
    assert.equal(app.persistence.epoch, 'baseline');
    assert.equal(app.persistence.state().persistedRevision, 0);
    assert.equal(acknowledged, false);
    releaseFirst.resolve();
    if (process.platform === 'win32') {
      await retried.promise;
      assert.equal(app.writes.length, 1, 'a rename retry must not rerun the commit producer');
      assert.equal(app.persistence.epoch, 'baseline');
      assert.equal(app.persistence.state().persistedRevision, 0);
      assert.equal(acknowledged, false);
      assert.deepEqual(attempts[1], attempts[0], 'retry commits the same encrypted temporary file');
    }
    releaseRetry.resolve();
    await pending;
    assert.deepEqual(
      app.writes.map((commit) => [commit.kind, commit.revision]),
      [
        ['drafts', 1],
        ['workspace', 3],
      ],
    );
    assert.equal(attempts.length, process.platform === 'win32' ? 3 : 2);
    assert.equal(app.persistence.epoch, 'epoch-1');
    assert.deepEqual(app.persistence.state(), {
      status: 'saved',
      requestedRevision: 3,
      persistedRevision: 3,
    });
    assert.equal(acknowledged, true);
    const loaded = (await app.read()).state;
    assert.deepEqual(loaded.projects, [{ id: 'must-survive' }]);
    assert.equal(loaded.drafts.one.text, 'latest');
  } finally {
    releaseFirst.resolve();
    releaseRetry.resolve();
    await Promise.allSettled([pending]);
  }
});

test('exhausted shared replacement retains the durable draft and requires an explicit persistence retry', async (t) => {
  const fault = Object.assign(new Error('Synthetic persistent Windows sharing violation'), {
    code: 'EPERM',
  });
  let occupied = true;
  const attempts = [];
  t.mock.method(fs, 'rename', async (temp, target) => {
    attempts.push({ temp, target });
    if (occupied) throw fault;
  });
  const app = fixture({
    state: workspace({ one: draft('durable baseline') }),
    beforeWrite: (commit) =>
      renameEncryptedTemp(`encrypted-${commit.kind}.tmp`, `${commit.kind}.bin`),
  });
  const previous = JSON.stringify({
    version: 1,
    draftEpoch: 'baseline',
    drafts: { one: draft('durable overlay') },
  });
  app.overlay = previous;
  const baseline = app.baseline;
  await assert.rejects(
    app.persistence.saveDrafts({ one: draft('pending edit', 2) }),
    (error) => error === fault,
  );
  await assert.rejects(app.persistence.flush(), { code: 'EPERM' });
  assert.equal(app.baseline, baseline);
  assert.equal(app.overlay, previous);
  assert.equal((await app.read()).state.drafts.one.text, 'durable overlay');
  assert.equal(app.persistence.epoch, 'baseline');
  assert.deepEqual(app.persistence.state(), {
    status: 'failed',
    requestedRevision: 1,
    persistedRevision: 0,
    errorCode: 'EPERM',
  });
  assert.equal(app.writes.length, 1);
  assert.equal(attempts.length, process.platform === 'win32' ? 9 : 1);
  for (const attempt of attempts) assert.deepEqual(attempt, attempts[0]);
  occupied = false;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.writes.length, 1, 'releasing the handle does not silently retry a failed save');
  assert.equal(app.persistence.state().status, 'failed');
  await app.persistence.retry();
  assert.equal(app.writes.length, 2);
  assert.equal(app.writes[1].body, app.writes[0].body);
  assert.equal(app.writes[1].revision, 1);
  assert.equal(app.baseline, baseline);
  assert.equal((await app.read()).state.drafts.one.text, 'pending edit');
  assert.deepEqual(app.persistence.state(), {
    status: 'saved',
    requestedRevision: 1,
    persistedRevision: 1,
  });
});

test('a crash after full baseline replacement leaves the stale overlay harmless and retryable', async () => {
  const app = fixture({
    afterBaselineWrite: (_, count) => {
      if (count === 2)
        throw Object.assign(new Error('synthetic cleanup failure'), { code: 'EACCES' });
    },
  });
  await app.persistence.saveDrafts({ one: draft('OLD_OVERLAY_MARKER') });
  const staleOverlay = app.overlay;
  await assert.rejects(app.persistence.saveWorkspace(workspace({ next: draft('NEW_BASELINE') })), {
    code: 'EACCES',
  });
  assert.equal(app.overlay, staleOverlay);
  assert.deepEqual((await app.read()).state.drafts, { next: draft('NEW_BASELINE') });
  await app.persistence.retry();
  assert.equal(app.overlay, null);
  assert.equal(app.persistence.state().status, 'saved');
});

test('turning persistence off suppresses raw draft persistence and waits for the pending clear', async () => {
  const gate = deferred();
  const app = fixture({ beforeWrite: (_, count) => (count === 1 ? gate.promise : undefined) });
  const clearing = app.persistence.saveWorkspace(
    workspace({ ignored: draft('MUST_NOT_PERSIST') }, { settings: { persist: false } }),
  );
  let settled = false;
  const drafts = app.persistence.saveDrafts({ ignored: draft('ALSO_PRIVATE') }).then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  gate.resolve();
  await Promise.all([clearing, drafts]);
  assert.equal(app.writes.length, 1);
  assert.deepEqual(JSON.parse(app.baseline).drafts, {});
  assert.doesNotMatch(app.baseline, /MUST_NOT_PERSIST|ALSO_PRIVATE/);
});

test('no-persistence loading never restores draft content from an otherwise matching overlay', async () => {
  const app = fixture({ state: workspace({}, { settings: { persist: false } }) });
  app.overlay = JSON.stringify({
    version: 1,
    draftEpoch: 'baseline',
    drafts: { one: draft('PRIVATE') },
  });
  assert.deepEqual((await app.read()).state.drafts, {});
});

test('invalid and oversized draft submissions cannot replace durable records', async () => {
  const app = fixture({ state: workspace({ kept: draft('kept') }) });
  const baseline = app.baseline;
  assert.throws(() => app.persistence.saveDrafts({ broken: { text: 'bad' } }), {
    code: 'DRAFT_FORMAT',
  });
  assert.throws(() => app.persistence.saveDrafts(new Date()), { code: 'DRAFT_FORMAT' });
  await assert.rejects(app.persistence.saveDrafts({ huge: draft('x'.repeat(12 * 1024 * 1024)) }), {
    code: 'DRAFT_LIMIT',
  });
  assert.equal(app.writes.length, 0);
  assert.equal(app.baseline, baseline);
  assert.equal(app.overlay, null);
  await app.persistence.saveDrafts({ kept: draft('recover', 2) });
  assert.equal((await app.read()).state.drafts.kept.text, 'recover');
});

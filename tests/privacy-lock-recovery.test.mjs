import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
const moduleUrl = name => process.env.ZHIXING_TEST_PACKED_APP
  ? new URL(`file:///${path.join(process.env.ZHIXING_TEST_PACKED_APP, name).replaceAll('\\', '/')}`).href
  : new URL(`../${name}`, import.meta.url).href;
const {createBridgeKey, readBridge, writeBridge, updateBridge} = await import(moduleUrl('harness/privacy-bridge.mjs'));
const bridgeUrl = moduleUrl('harness/privacy-bridge.mjs');

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-lock-recovery-'));
  const file = path.join(root, 'map.bin'), key = createBridgeKey();
  const workers = [];
  await writeBridge(file, key, {count: 0});
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.stop()));
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert(path.basename(resolved).startsWith('zhixing-lock-recovery-'));
    await fs.rm(resolved, {recursive: true, force: true, maxRetries: 6, retryDelay: 100});
  });
  return {root, file, key, workers};
}

function childProcess(t, f, source, extra = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: {...process.env, ZX_FILE: f.file, ZX_KEY: f.key, ...extra},
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', text => { stderr += text; });
  const messages = [], waiting = [];
  child.on('message', message => { if (waiting.length) waiting.shift()(message); else messages.push(message); });
  const exited = once(child, 'exit').then(([code, signal]) => ({code, signal, stderr}));
  const worker = {child, exited, async stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    return exited;
  }, async message() {
    return Promise.race([
      messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => { waiting.push(resolve); }),
      exited.then(result => { throw new Error(`Child exited before handshake: ${JSON.stringify(result)}`); }),
    ]);
  }};
  f.workers.push(worker);
  return worker;
}

// Fault after the actual mkdir syscall has completed, before owner.json is written.
const crashBeforeOwner = `
  import fs from 'node:fs/promises';
  import {updateBridge} from ${JSON.stringify(bridgeUrl)};
  const mkdir = fs.mkdir.bind(fs);
  let paused = false;
  fs.mkdir = async (...args) => {
    const result = await mkdir(...args);
    const target = String(args[0]);
    const base = process.env.ZX_FILE + '.lock';
    const selected = process.env.ZX_LOCK_KIND === 'guard'
      ? target.startsWith(base + '.guard')
      : target.startsWith(base) && !target.startsWith(base + '.guard');
    if (selected && !paused) {
      paused = true;
      process.send({phase: 'before-owner', target});
      await new Promise(resolve => process.once('message', resolve));
    }
    return result;
  };
  await updateBridge(process.env.ZX_FILE, process.env.ZX_KEY,
    state => ({state: {count: state.count + 1}}));
  process.disconnect();
`;

for (const kind of ['lock', 'guard']) {
  test(`R09 ${kind}: kill child after mkdir and before owner publication, then recover`, {timeout: 10000}, async t => {
    const f = await fixture(t);
    const worker = childProcess(t, f, crashBeforeOwner, {ZX_LOCK_KIND: kind});
    const message = await worker.message();
    assert.equal(message.phase, 'before-owner');
    assert.deepEqual(await fs.readdir(message.target), []);
    worker.child.kill('SIGKILL');
    assert.notEqual((await worker.exited).code, 0);
    let calls = 0;
    await updateBridge(f.file, f.key, state => {
      calls++;
      return {state: {count: state.count + 1}};
    }, {timeoutMs: 250});
    assert.equal(calls, 1);
    assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
  });
}

const pauseAtPublication = `
  import fs from 'node:fs/promises';
  import {updateBridge} from ${JSON.stringify(bridgeUrl)};
  const lock = process.env.ZX_FILE + '.lock';
  const target = process.env.ZX_LOCK_KIND === 'guard' ? lock + '.guard.v2' : lock;
  const rename = fs.rename.bind(fs), writeFile = fs.writeFile.bind(fs);
  let paused = false;
  const pause = async phase => {
    if (paused) return;
    paused = true;
    process.send({phase, target});
    await new Promise(resolve => process.once('message', resolve));
  };
  fs.writeFile = async (file, data, options) => {
    const parent = String(file).replace(/[\\/][^\\/]+$/, '');
    if (process.env.ZX_PHASE === 'partial-owner' && parent.startsWith(target + '.pending-')) {
      await writeFile(file, String(data).slice(0, 7), options);
      await pause('partial-owner');
      throw new Error('Partial owner writer must be killed');
    }
    return writeFile(file, data, options);
  };
  fs.rename = async (from, to) => {
    if (to === target && process.env.ZX_PHASE === 'before-publish') await pause('before-publish');
    const result = await rename(from, to);
    if (to === target && process.env.ZX_PHASE === 'published') await pause('published');
    return result;
  };
  await updateBridge(process.env.ZX_FILE, process.env.ZX_KEY,
    state => ({state: {count: state.count + 1}}));
  process.disconnect();
`;

for (const kind of ['lock', 'guard']) {
  for (const phase of ['partial-owner', 'before-publish', 'published']) {
    test(`R09 ${kind}: real child crash at ${phase} remains recoverable`, {timeout: 10000}, async t => {
      const f = await fixture(t);
      const worker = childProcess(t, f, pauseAtPublication, {ZX_LOCK_KIND: kind, ZX_PHASE: phase});
      assert.equal((await worker.message()).phase, phase);
      await worker.stop();
      await updateBridge(f.file, f.key, state => ({state: {count: state.count + 1}}), {timeoutMs: 1000});
      assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
      await assert.rejects(fs.lstat(`${f.file}.lock`), {code: 'ENOENT'});
      await assert.rejects(fs.lstat(`${f.file}.lock.guard.v2`), {code: 'ENOENT'});
    });
  }
}

for (const kind of ['lock', 'guard']) {
  test(`R09 ${kind}: live published owner is never reclaimed on timeout`, {timeout: 10000}, async t => {
    const f = await fixture(t);
    const worker = childProcess(t, f, pauseAtPublication, {ZX_LOCK_KIND: kind, ZX_PHASE: 'published'});
    const {target} = await worker.message();
    const before = await fs.readdir(target);
    let calls = 0;
    await assert.rejects(updateBridge(f.file, f.key, state => { calls++; return {state}; }, {timeoutMs: 60}), /繁忙/);
    assert.equal(calls, 0);
    assert.deepEqual(await fs.readdir(target), before);
    assert.deepEqual(await readBridge(f.file, f.key), {count: 0});
    worker.child.send('release');
    assert.equal((await worker.exited).code, 0);
    assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
    assert.deepEqual(await fs.readdir(f.root), ['map.bin']);
  });
}

test('R09 live unpublished guard does not block another writer or overwrite its result', {timeout: 10000}, async t => {
  const f = await fixture(t);
  const worker = childProcess(t, f, crashBeforeOwner, {ZX_LOCK_KIND: 'guard'});
  await worker.message();
  await updateBridge(f.file, f.key, state => ({state: {count: state.count + 1}}));
  worker.child.send('release');
  assert.equal((await worker.exited).code, 0);
  assert.deepEqual(await readBridge(f.file, f.key), {count: 2});
  assert.deepEqual(await fs.readdir(f.root), ['map.bin']);
});

test('R09 live main-lock initializer retains the guard until owner publication', {timeout: 10000}, async t => {
  const f = await fixture(t);
  const worker = childProcess(t, f, crashBeforeOwner, {ZX_LOCK_KIND: 'lock'});
  await worker.message();
  let calls = 0;
  await assert.rejects(updateBridge(f.file, f.key, state => { calls++; return {state}; }, {timeoutMs: 50}), /繁忙/);
  assert.equal(calls, 0);
  worker.child.send('release');
  assert.equal((await worker.exited).code, 0);
  assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
});

for (const code of ['EEXIST', 'ENOTEMPTY']) {
  test(`R09 ${code}: a rename loser retries after the competing guard has already retired`, {timeout: 10000}, async t => {
    const f = await fixture(t);
    const loser = childProcess(t, f, `
      import fs from 'node:fs/promises';
      import {updateBridge} from ${JSON.stringify(bridgeUrl)};
      const target = process.env.ZX_FILE + '.lock.guard.v2';
      const rename = fs.rename.bind(fs);
      let injected = false, calls = 0;
      fs.rename = async (from, to) => {
        if (to !== target || injected) return rename(from, to);
        injected = true;
        process.send('before-rename');
        await new Promise(resolve => process.once('message', resolve));
        let collision;
        try { await rename(from, to); } catch (error) { collision = error; }
        if (!collision) throw new Error('Expected a collision with the published competing owner');
        process.send({nativeCode: collision.code});
        await new Promise(resolve => process.once('message', resolve));
        // Exercise both portable collision codes, regardless of the host OS.
        collision.code = process.env.ZX_RENAME_CODE;
        throw collision;
      };
      await updateBridge(process.env.ZX_FILE, process.env.ZX_KEY, state => {
        calls++;
        return {state: {count: state.count + 1}};
      });
      process.send({calls});
      process.disconnect();
    `, {ZX_RENAME_CODE: code});
    assert.equal(await loser.message(), 'before-rename');
    const winner = childProcess(t, f, pauseAtPublication, {ZX_LOCK_KIND: 'guard', ZX_PHASE: 'published'});
    const {target} = await winner.message();
    loser.child.send('attempt-rename');
    assert(['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes((await loser.message()).nativeCode));
    winner.child.send('release');
    assert.equal((await winner.exited).code, 0);
    await assert.rejects(fs.lstat(target), {code: 'ENOENT'});
    assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
    loser.child.send('observe-error');
    assert.deepEqual(await loser.message(), {calls: 1});
    assert.equal((await loser.exited).code, 0);
    assert.deepEqual(await readBridge(f.file, f.key), {count: 2});
    assert.deepEqual(await fs.readdir(f.root), ['map.bin']);
  });
}

for (const code of ['EPERM', 'EACCES']) {
  test(`R09 ${code}: publication permission failures without a competing lock are not swallowed`, {timeout: 10000}, async t => {
    const f = await fixture(t);
    const worker = childProcess(t, f, `
      import fs from 'node:fs/promises';
      import {updateBridge} from ${JSON.stringify(bridgeUrl)};
      const rename = fs.rename.bind(fs);
      fs.rename = async (from, to) => {
        if (to === process.env.ZX_FILE + '.lock')
          throw Object.assign(new Error('Publication denied'), {code: process.env.ZX_RENAME_CODE});
        return rename(from, to);
      };
      let calls = 0;
      try {
        await updateBridge(process.env.ZX_FILE, process.env.ZX_KEY, state => { calls++; return {state}; });
        process.send({calls, code: null});
      } catch (error) { process.send({calls, code: error.code}); }
      process.disconnect();
    `, {ZX_RENAME_CODE: code});
    assert.deepEqual(await worker.message(), {calls: 0, code});
    assert.equal((await worker.exited).code, 0);
    assert.deepEqual(await readBridge(f.file, f.key), {count: 0});
    assert.deepEqual(await fs.readdir(f.root), ['map.bin']);
  });
}

test('R09 simultaneous real writers preserve all updates and exclusive callback entry', {timeout: 20000}, async t => {
  const f = await fixture(t);
  const source = `
    import fs from 'node:fs/promises';
    import {updateBridge} from ${JSON.stringify(bridgeUrl)};
    process.send('ready');
    await new Promise(resolve => process.once('message', resolve));
    for (let i = 0; i < 12; i++) await updateBridge(process.env.ZX_FILE, process.env.ZX_KEY, async state => {
      const sentinel = process.env.ZX_FILE + '.critical';
      const handle = await fs.open(sentinel, 'wx');
      try {
        await new Promise(resolve => setTimeout(resolve, 2));
        return {state: {count: state.count + 1}};
      } finally { await handle.close(); await fs.unlink(sentinel); }
    });
    process.disconnect();
  `;
  const workers = Array.from({length: 4}, () => childProcess(t, f, source));
  assert.deepEqual(await Promise.all(workers.map(worker => worker.message())), Array(4).fill('ready'));
  for (const worker of workers) worker.child.send('go');
  for (const result of await Promise.all(workers.map(worker => worker.exited))) assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readBridge(f.file, f.key), {count: 48});
  assert.deepEqual(await fs.readdir(f.root), ['map.bin']);
});

test('R09 stale guard reaper cannot remove a replacement live token', {timeout: 10000}, async t => {
  const f = await fixture(t);
  const dead = childProcess(t, f, pauseAtPublication, {ZX_LOCK_KIND: 'guard', ZX_PHASE: 'published'});
  const {target} = await dead.message();
  const [entry] = await fs.readdir(target);
  await dead.stop();
  const reaper = childProcess(t, f, `
    import fs from 'node:fs/promises';
    import {updateBridge} from ${JSON.stringify(bridgeUrl)};
    const unlink = fs.unlink.bind(fs);
    fs.unlink = async file => {
      if (file === process.env.ZX_STALE_ENTRY) {
        process.send('stale-unlink');
        await new Promise(resolve => process.once('message', resolve));
      }
      return unlink(file);
    };
    let calls = 0;
    try {
      await updateBridge(process.env.ZX_FILE, process.env.ZX_KEY,
        state => {calls++; return {state};}, {timeoutMs: 1500});
      process.send({calls, error: null});
    } catch (error) { process.send({calls, error: error.message}); }
    process.disconnect();
  `, {ZX_STALE_ENTRY: `${target}/${entry}`});
  assert.equal(await reaper.message(), 'stale-unlink');
  const live = childProcess(t, f, pauseAtPublication, {ZX_LOCK_KIND: 'guard', ZX_PHASE: 'published'});
  await live.message();
  const replacement = await fs.readdir(target);
  assert.notDeepEqual(replacement, [entry]);
  reaper.child.send('continue');
  const result = await reaper.message();
  assert.equal(result.calls, 0);
  assert.match(result.error, /繁忙/);
  assert.equal((await reaper.exited).code, 0);
  assert.deepEqual(await fs.readdir(target), replacement);
  await live.stop();
  await updateBridge(f.file, f.key, state => ({state: {count: state.count + 1}}));
  assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
});

test('R09 killing a guard reaper after unlink leaves a safely recoverable empty V2 guard', {timeout: 10000}, async t => {
  const f = await fixture(t);
  const dead = childProcess(t, f, pauseAtPublication, {ZX_LOCK_KIND: 'guard', ZX_PHASE: 'published'});
  const {target} = await dead.message();
  const [entry] = await fs.readdir(target);
  await dead.stop();
  const reaper = childProcess(t, f, `
    import fs from 'node:fs/promises';
    import {updateBridge} from ${JSON.stringify(bridgeUrl)};
    const unlink = fs.unlink.bind(fs);
    fs.unlink = async file => {
      const result = await unlink(file);
      if (file === process.env.ZX_STALE_ENTRY) {
        process.send('unlinked');
        await new Promise(resolve => process.once('message', resolve));
      }
      return result;
    };
    await updateBridge(process.env.ZX_FILE, process.env.ZX_KEY, state => ({state}));
    process.disconnect();
  `, {ZX_STALE_ENTRY: `${target}/${entry}`});
  assert.equal(await reaper.message(), 'unlinked');
  assert.deepEqual(await fs.readdir(target), []);
  await reaper.stop();
  await updateBridge(f.file, f.key, state => ({state: {count: state.count + 1}}), {timeoutMs: 1000});
  assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
});

test('R09 killing main-lock release after owner removal cannot strand the canonical lock', {timeout: 10000}, async t => {
  const f = await fixture(t);
  const worker = childProcess(t, f, `
    import fs from 'node:fs/promises';
    import {updateBridge} from ${JSON.stringify(bridgeUrl)};
    const rm = fs.rm.bind(fs), lock = process.env.ZX_FILE + '.lock';
    fs.rm = async (target, options) => {
      if (target === lock || target.startsWith(lock + '.released-')) {
        await fs.unlink(target + '/owner.json');
        process.send('release-owner-removed');
        await new Promise(resolve => process.once('message', resolve));
      }
      return rm(target, options);
    };
    await updateBridge(process.env.ZX_FILE, process.env.ZX_KEY,
      state => ({state: {count: state.count + 1}}));
    process.disconnect();
  `);
  assert.equal(await worker.message(), 'release-owner-removed');
  assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
  await updateBridge(f.file, f.key, state => ({state: {count: state.count + 1}}), {timeoutMs: 500});
  await worker.stop();
  await updateBridge(f.file, f.key, state => ({state: {count: state.count + 1}}), {timeoutMs: 500});
  assert.deepEqual(await readBridge(f.file, f.key), {count: 3});
});

test('R09 killing normal guard release after unlink remains recoverable without stealing a live main lock', {timeout: 10000}, async t => {
  const f = await fixture(t);
  const worker = childProcess(t, f, `
    import fs from 'node:fs/promises';
    import {updateBridge} from ${JSON.stringify(bridgeUrl)};
    const unlink = fs.unlink.bind(fs), guard = process.env.ZX_FILE + '.lock.guard.v2/';
    fs.unlink = async target => {
      const result = await unlink(target);
      if (target.startsWith(guard)) {
        process.send('guard-owner-removed');
        await new Promise(resolve => process.once('message', resolve));
      }
      return result;
    };
    await updateBridge(process.env.ZX_FILE, process.env.ZX_KEY,
      state => ({state: {count: state.count + 1}}));
    process.disconnect();
  `);
  assert.equal(await worker.message(), 'guard-owner-removed');
  let calls = 0;
  await assert.rejects(updateBridge(f.file, f.key, state => { calls++; return {state}; }, {timeoutMs: 50}), /繁忙/);
  assert.equal(calls, 0);
  await worker.stop();
  await updateBridge(f.file, f.key, state => ({state: {count: state.count + 1}}), {timeoutMs: 500});
  assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
});

test('R09 same-process reentry times out without stealing the outer lock', async t => {
  const f = await fixture(t);
  let innerCalls = 0;
  await updateBridge(f.file, f.key, async state => {
    const owner = await fs.readFile(`${f.file}.lock/owner.json`, 'utf8');
    await assert.rejects(updateBridge(f.file, f.key, state => { innerCalls++; return {state}; }, {timeoutMs: 40}), /繁忙/);
    assert.equal(await fs.readFile(`${f.file}.lock/owner.json`, 'utf8'), owner);
    return {state: {count: state.count + 1}};
  });
  assert.equal(innerCalls, 0);
  assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
});

test('R09 parallel same-process callers queue instead of treating the PID as reentrant ownership', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled(Array.from({length: 8}, () => updateBridge(f.file, f.key, async state => {
    await new Promise(resolve => setTimeout(resolve, 2));
    return {state: {count: state.count + 1}};
  })));
  for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.stack);
  assert.deepEqual(await readBridge(f.file, f.key), {count: 8});
  assert.deepEqual(await fs.readdir(f.root), ['map.bin']);
});

for (const changed of ['token', 'pid']) {
  test(`R09 release preserves an owner whose ${changed} no longer matches`, async t => {
    const f = await fixture(t);
    let replacement;
    await updateBridge(f.file, f.key, async state => {
      const owner = JSON.parse(await fs.readFile(`${f.file}.lock/owner.json`, 'utf8'));
      replacement = {...owner, [changed]: changed === 'token' ? randomUUID() : owner.pid + 1};
      await fs.writeFile(`${f.file}.lock/owner.json`, JSON.stringify(replacement));
      return {state: {count: state.count + 1}};
    });
    assert.deepEqual(JSON.parse(await fs.readFile(`${f.file}.lock/owner.json`, 'utf8')), replacement);
    assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
  });
}

test('R09 main-lock recovery restores a changed live owner instead of deleting its token', {timeout: 10000}, async t => {
  const f = await fixture(t), lock = `${f.file}.lock`;
  const dead = childProcess(t, f, pauseAtPublication, {ZX_LOCK_KIND: 'lock', ZX_PHASE: 'published'});
  await dead.message();
  await dead.stop();
  const replacement = {pid: process.pid, token: randomUUID()};
  const rename = fs.rename.bind(fs), rm = fs.rm.bind(fs);
  let replaced = false, removed = 0, calls = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (from === lock && to.startsWith(`${lock}.abandoned-`) && !replaced) {
      replaced = true;
      await fs.writeFile(`${lock}/owner.json`, JSON.stringify(replacement));
    }
    return rename(from, to);
  });
  t.mock.method(fs, 'rm', async (target, options) => {
    if (String(target).startsWith(`${lock}.abandoned-`)) removed++;
    return rm(target, options);
  });
  await assert.rejects(updateBridge(f.file, f.key, state => { calls++; return {state}; }, {timeoutMs: 75}), /繁忙/);
  t.mock.restoreAll();
  assert.equal(replaced, true);
  assert.equal(removed, 0);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(`${lock}/owner.json`, 'utf8')), replacement);
});

test('R09 empty-guard observer cannot delete a newly published nonempty live guard', async t => {
  const f = await fixture(t), guard = `${f.file}.lock.guard.v2`;
  await fs.mkdir(guard);
  const rmdir = fs.rmdir.bind(fs);
  const entry = `${process.pid}-${randomUUID()}.owner`;
  let replaced = false;
  t.mock.method(fs, 'rmdir', async target => {
    if (target === guard && !replaced) {
      replaced = true;
      await rmdir(guard);
      await fs.mkdir(guard);
      await fs.writeFile(`${guard}/${entry}`, '{}', {flag: 'wx'});
    }
    return rmdir(target);
  });
  await assert.rejects(updateBridge(f.file, f.key, state => ({state}), {timeoutMs: 50}), /繁忙/);
  t.mock.restoreAll();
  assert.equal(replaced, true);
  assert.deepEqual(await fs.readdir(guard), [entry]);
});

for (const code of ['EPERM', 'EACCES', 'EIO']) {
  test(`R09 uncertain PID probe (${code}) never authorizes reclamation`, async t => {
    const f = await fixture(t), lock = `${f.file}.lock`, pid = 2147483647;
    const owner = {pid, token: randomUUID()};
    await fs.mkdir(lock);
    await fs.writeFile(`${lock}/owner.json`, JSON.stringify(owner));
    const kill = process.kill.bind(process);
    t.mock.method(process, 'kill', (target, signal) => {
      if (target === pid && signal === 0) throw Object.assign(new Error('Synthetic uncertain PID probe'), {code});
      return kill(target, signal);
    });
    await assert.rejects(updateBridge(f.file, f.key, state => ({state}), {timeoutMs: 35}), /繁忙/);
    t.mock.restoreAll();
    assert.deepEqual(JSON.parse(await fs.readFile(`${lock}/owner.json`, 'utf8')), owner);
  });
}

for (const suffix of ['.lock', '.lock.guard']) {
  for (const content of [undefined, '{partial', JSON.stringify({pid: 0, token: ''})]) {
    test(`R09 anonymous/malformed legacy ${suffix} stays fail-closed (${String(content)})`, async t => {
      const f = await fixture(t), lock = f.file + suffix;
      await fs.mkdir(lock);
      if (content !== undefined) await fs.writeFile(`${lock}/owner.json`, content);
      let calls = 0;
      await assert.rejects(updateBridge(f.file, f.key, state => { calls++; return {state}; }, {timeoutMs: 35}), /繁忙/);
      assert.equal(calls, 0);
      assert.deepEqual(await fs.readdir(lock), content === undefined ? [] : ['owner.json']);
      if (content !== undefined) assert.equal(await fs.readFile(`${lock}/owner.json`, 'utf8'), content);
    });
  }
}

for (const suffix of ['.lock', '.lock.guard', '.lock.guard.v2']) {
  test(`R09 ${suffix} directory symlink/junction is not followed or removed`, async t => {
    const f = await fixture(t), target = path.join(f.root, 'external');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'sentinel'), 'KEEP_EXTERNAL');
    await fs.symlink(target, f.file + suffix, process.platform === 'win32' ? 'junction' : 'dir');
    let calls = 0;
    await assert.rejects(updateBridge(f.file, f.key, state => { calls++; return {state}; }, {timeoutMs: 35}), /繁忙/);
    assert.equal(calls, 0);
    assert((await fs.lstat(f.file + suffix)).isSymbolicLink());
    assert.equal(await fs.readFile(path.join(target, 'sentinel'), 'utf8'), 'KEEP_EXTERNAL');
    assert.deepEqual(await readBridge(f.file, f.key), {count: 0});
  });
}

test('R09 guard owner-entry junction and malformed names cannot authorize external cleanup', async t => {
  const f = await fixture(t), guard = `${f.file}.lock.guard.v2`, target = path.join(f.root, 'external-guard-owner');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'sentinel'), 'KEEP_GUARD_OWNER');
  await fs.mkdir(guard);
  const entry = `2147483647-${randomUUID()}.owner`;
  await fs.symlink(target, `${guard}/${entry}`, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(updateBridge(f.file, f.key, state => ({state}), {timeoutMs: 35}), /繁忙/);
  assert.equal(await fs.readFile(path.join(target, 'sentinel'), 'utf8'), 'KEEP_GUARD_OWNER');
  assert((await fs.lstat(`${guard}/${entry}`)).isSymbolicLink());
});

for (const entry of ['owner.json', '1-not-a-token.owner', '9007199254740992-00000000-0000-4000-8000-000000000000.owner']) {
  test(`R09 malformed V2 guard entry stays fail-closed: ${entry}`, async t => {
    const f = await fixture(t), guard = `${f.file}.lock.guard.v2`;
    await fs.mkdir(guard);
    await fs.writeFile(`${guard}/${entry}`, '{}');
    await assert.rejects(updateBridge(f.file, f.key, state => ({state}), {timeoutMs: 35}), /繁忙/);
    assert.deepEqual(await fs.readdir(guard), [entry]);
  });
}

test('R09 owner.json symlink is rejected without reading or deleting its target', async t => {
  const f = await fixture(t), target = path.join(f.root, 'external-owner.json');
  const content = JSON.stringify({pid: 2147483647, token: randomUUID()});
  await fs.writeFile(target, content);
  await fs.mkdir(`${f.file}.lock`);
  try { await fs.symlink(target, `${f.file}.lock/owner.json`, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Windows does not grant file-symlink privilege; real junction and injected owner-symlink checks run separately');
      return;
    }
    throw error;
  }
  await assert.rejects(updateBridge(f.file, f.key, state => ({state}), {timeoutMs: 35}), /繁忙/);
  assert((await fs.lstat(`${f.file}.lock/owner.json`)).isSymbolicLink());
  assert.equal(await fs.readFile(target, 'utf8'), content);
});

test('R09 owner.json junction is rejected and its external contents survive', async t => {
  const f = await fixture(t), target = path.join(f.root, 'external-owner');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'sentinel'), 'KEEP_OWNER_TARGET');
  await fs.mkdir(`${f.file}.lock`);
  await fs.symlink(target, `${f.file}.lock/owner.json`, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(updateBridge(f.file, f.key, state => ({state}), {timeoutMs: 35}), /繁忙/);
  assert((await fs.lstat(`${f.file}.lock/owner.json`)).isSymbolicLink());
  assert.equal(await fs.readFile(path.join(target, 'sentinel'), 'utf8'), 'KEEP_OWNER_TARGET');
});

test('R09 owner-file symlink metadata fails closed before owner content is read', async t => {
  const f = await fixture(t), lstat = fs.lstat.bind(fs), readFile = fs.readFile.bind(fs);
  await fs.mkdir(`${f.file}.lock`);
  await fs.writeFile(`${f.file}.lock/owner.json`, JSON.stringify({pid: 2147483647, token: randomUUID()}));
  let reads = 0;
  t.mock.method(fs, 'lstat', async file => file === `${f.file}.lock/owner.json`
    ? {isFile: () => true, isSymbolicLink: () => true} : lstat(file));
  t.mock.method(fs, 'readFile', async (...args) => { if (args[0] === `${f.file}.lock/owner.json`) reads++; return readFile(...args); });
  await assert.rejects(updateBridge(f.file, f.key, state => ({state}), {timeoutMs: 35}), /繁忙/);
  t.mock.restoreAll();
  assert.equal(reads, 0);
});

for (const kind of ['lock', 'guard']) {
  test(`R09 ${kind} owner write failure cleans only its private candidate`, async t => {
    const f = await fixture(t), writeFile = fs.writeFile.bind(fs);
    const fault = Object.assign(new Error('Synthetic owner write failure'), {code: 'EIO'});
    const prefix = kind === 'guard' ? `${f.file}.lock.guard.v2.pending-` : `${f.file}.lock.pending-`;
    let calls = 0;
    t.mock.method(fs, 'writeFile', async (file, data, options) => {
      if (String(file).startsWith(prefix)) { await writeFile(file, '{partial', options); throw fault; }
      return writeFile(file, data, options);
    });
    await assert.rejects(updateBridge(f.file, f.key, state => { calls++; return {state}; }), error => error === fault);
    t.mock.restoreAll();
    assert.equal(calls, 0);
    assert.deepEqual(await fs.readdir(f.root), ['map.bin']);
    assert.deepEqual(await readBridge(f.file, f.key), {count: 0});
  });
}

for (const kind of ['lock', 'guard']) {
  test(`R09 ${kind} publication failure does not run the producer or delete another path`, async t => {
    const f = await fixture(t), rename = fs.rename.bind(fs);
    const target = kind === 'guard' ? `${f.file}.lock.guard.v2` : `${f.file}.lock`;
    const fault = Object.assign(new Error('Synthetic publication failure'), {code: 'EIO'});
    let calls = 0;
    t.mock.method(fs, 'rename', async (from, to) => { if (to === target) throw fault; return rename(from, to); });
    await assert.rejects(updateBridge(f.file, f.key, state => { calls++; return {state}; }), error => error === fault);
    t.mock.restoreAll();
    assert.equal(calls, 0);
    assert.deepEqual(await fs.readdir(f.root), ['map.bin']);
  });
}

for (const operation of ['readdir', 'rename']) {
  test(`R09 Windows delete-pending ${operation} retries acquisition before the callback`, async t => {
    const f = await fixture(t), guard = `${f.file}.lock.guard.v2`;
    const original = fs[operation].bind(fs), fault = Object.assign(new Error('Synthetic delete-pending guard'), {code: 'EPERM'});
    if (operation === 'readdir') await fs.mkdir(guard);
    let attempts = 0, calls = 0;
    t.mock.method(fs, operation, async (...args) => {
      if ((operation === 'readdir' ? args[0] : args[1]) === guard && attempts++ === 0) throw fault;
      return original(...args);
    });
    const pending = updateBridge(f.file, f.key, state => { calls++; return {state: {count: state.count + 1}}; });
    if (process.platform === 'win32') {
      await pending;
      assert.equal(calls, 1);
      assert.deepEqual(await readBridge(f.file, f.key), {count: 1});
      assert.deepEqual(await fs.readdir(f.root), ['map.bin']);
    } else {
      await assert.rejects(pending, error => error === fault);
      assert.equal(calls, 0);
    }
    t.mock.restoreAll();
  });
}

test('R09 persistent Windows guard access failure remains bounded without invoking the callback', async t => {
  const f = await fixture(t), guard = `${f.file}.lock.guard.v2`, readdir = fs.readdir.bind(fs);
  await fs.mkdir(guard);
  const fault = Object.assign(new Error('Synthetic persistent guard access failure'), {code: 'EACCES'});
  let calls = 0;
  t.mock.method(fs, 'readdir', async (...args) => { if (args[0] === guard) throw fault; return readdir(...args); });
  const pending = updateBridge(f.file, f.key, state => { calls++; return {state}; }, {timeoutMs: 45});
  if (process.platform === 'win32') await assert.rejects(pending, /繁忙/);
  else await assert.rejects(pending, error => error === fault);
  t.mock.restoreAll();
  assert.equal(calls, 0);
  assert.deepEqual(await readBridge(f.file, f.key), {count: 0});
  assert.deepEqual(await fs.readdir(guard), []);
});

test('R09 abort while waiting leaves the live owner unchanged and never calls update', async t => {
  const f = await fixture(t);
  const worker = childProcess(t, f, pauseAtPublication, {ZX_LOCK_KIND: 'lock', ZX_PHASE: 'published'});
  await worker.message();
  const original = await fs.readFile(`${f.file}.lock/owner.json`, 'utf8');
  const controller = new AbortController(), reason = new Error('Synthetic cancellation');
  let calls = 0;
  const pending = updateBridge(f.file, f.key, state => { calls++; return {state}; }, {signal: controller.signal});
  setTimeout(() => controller.abort(reason), 25);
  await assert.rejects(pending, error => error === reason);
  assert.equal(calls, 0);
  assert.equal(await fs.readFile(`${f.file}.lock/owner.json`, 'utf8'), original);
  worker.child.send('release');
  assert.equal((await worker.exited).code, 0);
});

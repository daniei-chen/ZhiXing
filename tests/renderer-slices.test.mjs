import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedStore } from '../src/keyed-store.js';
import { createDebouncedWriter } from '../src/debounced-writer.js';

function clock() {
  let time = 0;
  let id = 0;
  const jobs = new Map();
  return {
    schedule(callback, delay) {
      const key = ++id;
      jobs.set(key, { callback, at: time + delay });
      return key;
    },
    cancel(key) {
      jobs.delete(key);
    },
    async advance(milliseconds) {
      const end = time + milliseconds;
      for (;;) {
        const next = [...jobs.entries()]
          .filter(([, value]) => value.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        jobs.delete(next[0]);
        time = next[1].at;
        next[1].callback();
        await new Promise((resolve) => setImmediate(resolve));
      }
      time = end;
    },
  };
}

test('draft and run subscribers receive only their own changes, including deletion', () => {
  const store = createKeyedStore();
  let first = 0;
  let second = 0;
  const off = store.subscribe('draft:first', () => first++);
  store.subscribe('run:second', () => second++);
  const draft = { text: 'first' };
  store.set('draft:first', draft);
  store.set('draft:first', draft);
  assert.equal(first, 1);
  assert.equal(second, 0);
  for (let index = 0; index < 100; index++) store.set('run:second', `chunk ${index}`);
  assert.equal(first, 1);
  assert.equal(second, 100);
  store.replace({ 'run:second': 'chunk 99' });
  assert.equal(first, 2);
  assert.equal(store.get('draft:first'), undefined);
  off();
  store.set('draft:first', { text: 'new' });
  assert.equal(first, 2);
});

test('typing a burst writes one latest snapshot after the quiet period', async () => {
  const timer = clock();
  let text = '';
  const writes = [];
  const writer = createDebouncedWriter({
    ...timer,
    snapshot: () => text,
    write: (value) => writes.push(value),
  });
  for (let index = 0; index < 40; index++) {
    text += '字';
    writer.schedule();
    await timer.advance(20);
  }
  assert.equal(writes.length, 0);
  await timer.advance(400);
  assert.deepEqual(writes, ['字'.repeat(40)]);
  assert.equal(writer.pending(), false);
});

test('continuous typing reaches the maximum wait without waiting for blur', async () => {
  const timer = clock();
  let text = '';
  const writes = [];
  const writer = createDebouncedWriter({
    ...timer,
    snapshot: () => text,
    write: (value) => writes.push(value),
  });
  for (let index = 0; index < 30; index++) {
    text += '字';
    writer.schedule();
    await timer.advance(100);
  }
  assert.equal(writes[0], '字'.repeat(20));
  assert.equal(writes.length, 1);
  await writer.flush();
  assert.equal(writes.at(-1), text);
  assert.equal(writer.pending(), false);
});

test('navigation/quit barrier waits for the active write and a newer edit', async () => {
  const timer = clock();
  let text = 'first';
  let release;
  const writes = [];
  const writer = createDebouncedWriter({
    ...timer,
    snapshot: () => text,
    write: (value) => {
      writes.push(value);
      if (value === 'first')
        return new Promise((resolve) => {
          release = resolve;
        });
    },
  });
  writer.schedule();
  const first = writer.flush();
  await new Promise((resolve) => setImmediate(resolve));
  text = 'edited while saving';
  writer.schedule();
  let ended = false;
  const barrier = writer.flush().then(() => {
    ended = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended, false);
  release();
  await Promise.all([first, barrier]);
  assert.deepEqual(writes, ['first', 'edited while saving']);
  assert.equal(writer.pending(), false);
});

test('write failure remains retryable without silently discarding or looping', async () => {
  const timer = clock();
  let failing = true;
  let attempts = 0;
  const errors = [];
  const writer = createDebouncedWriter({
    ...timer,
    snapshot: () => 'draft',
    onError: (error) => errors.push(error.code),
    write: () => {
      attempts++;
      if (failing) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    },
  });
  writer.schedule();
  await timer.advance(400);
  assert.equal(writer.pending(), true);
  assert.deepEqual(errors, ['ENOSPC']);
  await timer.advance(10000);
  assert.equal(attempts, 1);
  failing = false;
  await writer.flush();
  assert.equal(attempts, 2);
  assert.equal(writer.pending(), false);
});

test('unmount cancels timers without cancelling an explicitly flushed final draft', async () => {
  const timer = clock();
  const writes = [];
  const writer = createDebouncedWriter({
    ...timer,
    snapshot: () => 'last input',
    write: (value) => writes.push(value),
  });
  writer.schedule();
  const flush = writer.flush();
  writer.dispose();
  await flush;
  await timer.advance(10000);
  assert.deepEqual(writes, ['last input']);
});

test('disposed writers ignore late schedules and resume explicitly for StrictMode setup', async () => {
  const timer = clock();
  let text = 'saved before unmount';
  const writes = [];
  const writer = createDebouncedWriter({
    ...timer,
    snapshot: () => text,
    write: (value) => writes.push(value),
  });
  writer.schedule();
  await writer.flush();
  writer.dispose();
  text = 'late producer';
  writer.schedule();
  await timer.advance(10000);
  await writer.flush();
  assert.equal(writer.pending(), false);
  assert.deepEqual(writes, ['saved before unmount']);
  writer.resume();
  writer.schedule();
  await timer.advance(400);
  assert.deepEqual(writes, ['saved before unmount', 'late producer']);
});

test('disposing during write A still flushes an already requested newer draft B', async () => {
  const timer = clock();
  let text = 'A';
  let release;
  const writes = [];
  const writer = createDebouncedWriter({
    ...timer,
    snapshot: () => text,
    write: (value) => {
      writes.push(value);
      if (value === 'A')
        return new Promise((resolve) => {
          release = resolve;
        });
    },
  });
  writer.schedule();
  const first = writer.flush();
  await new Promise((resolve) => setImmediate(resolve));
  text = 'B';
  writer.schedule();
  let settled = false;
  const final = writer.flush().then(() => {
    settled = true;
  });
  writer.dispose();
  await timer.advance(10000);
  assert.equal(settled, false);
  release();
  await Promise.all([first, final]);
  assert.deepEqual(writes, ['A', 'B']);
  assert.equal(writer.pending(), false);
});

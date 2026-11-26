import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebouncedWriter } from '../src/debounced-writer.js';

let instance = 0;
const fresh = () =>
  import(new URL(`../src/renderer-durability.js?test=${++instance}`, import.meta.url));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

function desktopFixture() {
  let listener;
  let subscriptions = 0;
  const acknowledgements = [];
  return {
    acknowledgements,
    get subscriptions() {
      return subscriptions;
    },
    get listening() {
      return typeof listener === 'function';
    },
    quit: () => listener(),
    desktop: {
      onPrepareToQuit(callback) {
        listener = callback;
        subscriptions++;
        return () => {
          listener = undefined;
        };
      },
      acknowledgeQuitPreparation: (value) => acknowledgements.push(value),
    },
  };
}

test('quit before an App barrier is registered fails closed while restore can retry initial loading', async () => {
  const { bindRendererDurability, flushRendererDurability } = await fresh();
  const fixture = desktopFixture();
  bindRendererDurability(fixture.desktop);
  await flushRendererDurability();
  await fixture.quit();
  assert.equal(fixture.acknowledgements.length, 1);
  assert.equal(fixture.acknowledgements[0].saved, false);
  assert.equal(fixture.subscriptions, 1);
});

test('the entrypoint quit listener survives App disposal and waits for active A plus queued B', async () => {
  const { bindRendererDurability, registerRendererDurability } = await fresh();
  const fixture = desktopFixture();
  const unbind = bindRendererDurability(fixture.desktop);
  const gate = deferred();
  let text = 'A';
  const writes = [];
  const writer = createDebouncedWriter({
    snapshot: () => text,
    write: async (value) => {
      writes.push(value);
      if (value === 'A') await gate.promise;
    },
  });
  registerRendererDurability(async ({ reason }) => {
    assert.equal(reason, 'quit');
    await writer.flush();
    writes.push('workspace snapshot');
  });
  writer.schedule();
  const first = writer.flush();
  await settle();
  text = 'B';
  writer.schedule();
  // App cleanup disposes its producer/writer but does not own this listener.
  writer.dispose();
  assert.equal(fixture.listening, true);
  const quitting = fixture.quit();
  await settle();
  assert.deepEqual(fixture.acknowledgements, []);
  assert.deepEqual(writes, ['A']);
  gate.resolve();
  await Promise.all([first, quitting]);
  assert.deepEqual(writes, ['A', 'B', 'workspace snapshot']);
  assert.deepEqual(fixture.acknowledgements, [{ saved: true }]);
  assert.equal(fixture.subscriptions, 1);
  unbind();
  assert.equal(fixture.listening, false);
});

test('a rejected barrier reports fixed safe failure and the same quit listener can retry', async () => {
  const { bindRendererDurability, registerRendererDurability } = await fresh();
  const fixture = desktopFixture();
  bindRendererDurability(fixture.desktop);
  let attempts = 0;
  registerRendererDurability(async () => {
    attempts++;
    if (attempts === 1) throw new Error('PRIVATE_WORKSPACE_TEXT_AND_PATH');
  });
  await fixture.quit();
  assert.equal(fixture.acknowledgements[0].saved, false);
  assert.match(fixture.acknowledgements[0].error, /未保存/);
  assert.doesNotMatch(JSON.stringify(fixture.acknowledgements), /PRIVATE_WORKSPACE/);
  await fixture.quit();
  assert.deepEqual(fixture.acknowledgements[1], { saved: true });
  assert.equal(fixture.subscriptions, 1);
  assert.equal(attempts, 2);
});

test('remount replaces the barrier without registering a second native quit listener', async () => {
  const { bindRendererDurability, registerRendererDurability } = await fresh();
  const fixture = desktopFixture();
  bindRendererDurability(fixture.desktop);
  const calls = [];
  registerRendererDurability(async () => {
    calls.push('old App');
  });
  await fixture.quit();
  registerRendererDurability(async () => {
    calls.push('new App');
  });
  await fixture.quit();
  assert.deepEqual(calls, ['old App', 'new App']);
  assert.deepEqual(fixture.acknowledgements, [{ saved: true }, { saved: true }]);
  assert.equal(fixture.subscriptions, 1);
});

test('browser-only initialization does not create a native quit subscription', async () => {
  const { bindRendererDurability } = await fresh();
  assert.equal(bindRendererDurability(undefined), undefined);
  assert.equal(bindRendererDurability({}), undefined);
});

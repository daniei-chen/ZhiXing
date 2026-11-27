import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { connectUi } from '../scripts/qa-cdp.mjs';

const require = createRequire(import.meta.url);
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Electron fixture did not exit')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// This isolated page exercises the production CDP helper against Chromium's
// actual line boxes and trusted mouse events. No geometry or DOM clicks are mocked.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 24px; font: 16px monospace; overflow: hidden; }
  #paragraph { width: 200px; margin: 0; line-height: 40px; word-break: break-all; }
  #prefix { display: inline-block; width: 172px; height: 1px; }
  #wrapped { font: inherit; background: #eee; cursor: pointer; }
  #ordinary { margin-top: 32px; }
  #clipped { position: fixed; left: -30px; top: -14px; width: 160px; height: 50px; }
  #outside { position: fixed; left: -300px; top: 150px; width: 100px; height: 30px; }
  #cover { position: fixed; z-index: 100; background: #333; }
</style></head><body>
  <p id="paragraph"><span id="prefix"></span><code id="wrapped" role="link" tabindex="0">quarter-summary.md</code></p>
  <div id="ordinary"><button id="disabled" disabled>Disabled</button><button id="duplicate-a">Duplicate</button><button id="duplicate-b">Duplicate</button></div>
  <button id="clipped" hidden>Clipped</button><button id="outside" hidden>Outside</button>
  <div id="cover" hidden></div>
  <script>
    window.mouseEvents = [];
    for (const type of ['mousedown', 'mouseup', 'click']) {
      document.addEventListener(type, event => window.mouseEvents.push({
        type, target: event.target.id, trusted: event.isTrusted, x: event.clientX, y: event.clientY
      }));
    }
  </script>
</body></html>`;

// Runs in a separate Electron process with a fresh, disposable profile.
function fixtureMain() {
  const { app, BrowserWindow, protocol } = require('electron');
  const { readFile } = require('node:fs/promises');
  const path = require('node:path');
  app.setPath('userData', path.join(__dirname, 'profile'));
  app.commandLine.appendSwitch('remote-debugging-port', '0');
  protocol.registerSchemesAsPrivileged([
    { scheme: 'zhixing', privileges: { standard: true, secure: true } },
  ]);
  process.on('message', (message) => {
    if (message === 'qa-quit') app.quit();
  });
  app
    .whenReady()
    .then(async () => {
      const page = await readFile(path.join(__dirname, 'index.html'), 'utf8');
      protocol.handle(
        'zhixing',
        () =>
          new Response(page, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      );
      const window = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await window.loadURL('zhixing://app/index.html');
      // Linux headless can start at 1x1; the same fixture must use a real viewport.
      window.setContentSize(800, 600);
      await window.webContents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      console.log('QA_CDP_READY');
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}

test('真实 Electron/CDP 点击遵守文字片段、遮挡与控件约束', { timeout: 30000 }, async (context) => {
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-qa-cdp-'));
  let child, exited, exitResult, spawnError, ui;
  let output = '';
  context.after(async () => {
    ui?.close();
    const errors = [];
    if (child) {
      try {
        if (!exitResult && child.connected) child.send('qa-quit');
        const outcome = await within(exited, 5000);
        assert.deepEqual(outcome, { code: 0, signal: null }, output);
      } catch (error) {
        errors.push(error);
        if (!exitResult) {
          child.kill();
          try {
            await within(exited, 5000);
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
        }
      }
    }
    try {
      const resolved = await realpath(directory);
      assert.equal(path.dirname(resolved), temporaryRoot);
      assert.ok(path.basename(resolved).startsWith('zhixing-qa-cdp-'));
      await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'Electron CDP fixture cleanup failed');
  });
  await writeFile(path.join(directory, 'index.html'), html);
  const mainPath = path.join(directory, 'main.cjs');
  await writeFile(mainPath, `(${fixtureMain.toString()})();`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const flags =
    process.platform === 'linux'
      ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu']
      : [];
  child = spawn(require('electron'), [...flags, mainPath], {
    env,
    signal: context.signal,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.once('error', (error) => {
    spawnError = error;
  });
  exited = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      exitResult = { code, signal };
      resolve(exitResult);
    }),
  );
  const collect = (chunk) => {
    output = (output + chunk).slice(-65536);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const deadline = Date.now() + 10000;
  while (!output.includes('QA_CDP_READY') && !exitResult && !spawnError && Date.now() < deadline) {
    await pause(25);
  }
  assert.equal(spawnError, undefined, String(spawnError));
  assert.match(output, /QA_CDP_READY/, output);
  const port = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
  assert.ok(port, output);
  ui = await connectUi(Number(port));
  assert.deepEqual(await ui.evaluate('({width:innerWidth,height:innerHeight})'), {
    width: 800,
    height: 600,
  });
  const reset = () =>
    ui.evaluate(`(() => {
    window.mouseEvents=[];
    document.querySelector('#cover').hidden=true;
    document.querySelector('#clipped').hidden=true;
    document.querySelector('#outside').hidden=true;
  })()`);
  const events = () => ui.evaluate('window.mouseEvents');
  const trustedClick = async (id) => {
    const recorded = await events();
    assert.deepEqual(
      recorded.map(({ type, target, trusted }) => ({ type, target, trusted })),
      ['mousedown', 'mouseup', 'click'].map((type) => ({ type, target: id, trusted: true })),
    );
    return recorded;
  };

  await context.test('换行引用的整体中心未命中时，实际片段仍收到可信鼠标点击', async () => {
    await reset();
    const geometry = await ui.evaluate(`(() => {
      const e=document.querySelector('#wrapped'),r=e.getBoundingClientRect();
      return {fragments:e.getClientRects().length,unionHit:e.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2))};
    })()`);
    assert.equal(geometry.fragments, 2);
    assert.equal(geometry.unionHit, false);
    await ui.click('quarter-summary.md', '#wrapped');
    await trustedClick('wrapped');
  });

  await context.test('首片段被真实覆盖时使用仍可命中的下一片段', async () => {
    await reset();
    const secondTop = await ui.evaluate(`(() => {
      const e=document.querySelector('#wrapped'),rects=[...e.getClientRects()],cover=document.querySelector('#cover'),r=rects[0];
      Object.assign(cover.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
      cover.hidden=false;
      return rects[1].top;
    })()`);
    await ui.click('quarter-summary.md', '#wrapped');
    const recorded = await trustedClick('wrapped');
    assert.ok(recorded[2].y >= secondTop);
  });

  await context.test('覆盖全部片段时拒绝点击且覆盖层也收不到鼠标事件', async () => {
    await reset();
    await ui.evaluate(`(() => {
      const cover=document.querySelector('#cover');
      Object.assign(cover.style,{left:'0',top:'0',width:'100vw',height:'100vh'});
      cover.hidden=false;
    })()`);
    await assert.rejects(ui.click('quarter-summary.md', '#wrapped'), /Control is obscured/);
    assert.deepEqual(await events(), []);
  });

  await context.test('视口裁剪后只点击可见部分，完全在视口外时拒绝', async () => {
    await reset();
    await ui.evaluate("document.querySelector('#clipped').hidden=false");
    await ui.click('Clipped', '#clipped');
    const recorded = await trustedClick('clipped');
    assert.ok(recorded[2].x > 0 && recorded[2].x < 130);
    assert.ok(recorded[2].y > 0 && recorded[2].y < 36);
    await reset();
    await ui.evaluate("document.querySelector('#outside').hidden=false");
    await assert.rejects(ui.click('Outside', '#outside'), /Control is obscured/);
    assert.deepEqual(await events(), []);
  });

  await context.test('禁用控件保持拒绝且没有鼠标事件', async () => {
    await reset();
    await assert.rejects(ui.click('Disabled', '#disabled'), /Disabled control/);
    assert.deepEqual(await events(), []);
  });

  await context.test('多个可见同名控件保持拒绝且没有鼠标事件', async () => {
    await reset();
    await assert.rejects(ui.click('Duplicate'), /Expected one visible control Duplicate, found 2/);
    assert.deepEqual(await events(), []);
  });
});

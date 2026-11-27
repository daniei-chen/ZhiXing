import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repository = path.resolve(import.meta.dirname, '..');

// Executes in an isolated Electron main process against the actual React DOM.
async function exerciseWindow(window) {
  const assert = require('node:assert/strict');
  const run = (source) => window.webContents.executeJavaScript(source);
  const click = (selector) => run(`window.deliveryQA.click(${JSON.stringify(selector)})`);
  const resolve = (index, value) =>
    run(`window.deliveryQA.resolve(${index},${JSON.stringify(value)})`);
  const calls = () => run('window.deliveryQA.calls');
  const settle = async () => {
    await run('window.deliveryQA.settle()');
    await run('window.deliveryQA.settle()');
  };
  const wait = async (expression) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await run(expression)) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error(`Timeout: ${expression}`);
  };
  const start = async (letter = 'a') => {
    const index = (await calls()).length;
    await click(`#open-${letter}`);
    assert.equal((await calls())[index].method, 'list');
    assert.equal(
      await run('document.querySelector(".delivery-preview").getAttribute("aria-busy")'),
      'true',
    );
    return index;
  };
  const list = (letter = 'a') => [
    {
      path: `C:\\qa\\${letter}.txt`,
      available: true,
      id: `signed-${letter}`,
      size: 50,
    },
  ];
  const resolveList = async (index, letter = 'a') => {
    const read = (await calls()).length;
    await resolve(index, list(letter));
    await wait(`window.deliveryQA.calls.length===${read + 1}`);
    const request = (await calls())[read];
    assert.equal(request.method, 'read');
    assert.equal(request.options.id, `signed-${letter}`);
    assert.equal(Object.hasOwn(request.options, 'path'), false);
    return read;
  };
  const ready = (name, text, extra = {}) => ({ name, text, size: 50, ...extra });
  const text = () => run('document.querySelector(".delivery-preview-text")?.textContent||""');

  await wait('!!document.querySelector("#open-a")');
  await click('#edit-draft');
  const first = await start();
  const firstRead = await resolveList(first);
  await resolve(
    firstRead,
    ready('a.txt', '第一份文件正文', {
      coverage: {
        kind: 'extracted-text',
        images: 2,
        formulaCells: 3,
        notice: '公式未重算，仅提取文字。',
      },
      warnings: ['隐藏区域包含在读取范围中。'],
    }),
  );
  await wait('document.querySelector(".delivery-preview-text")?.textContent==="第一份文件正文"');
  assert.match(await run('document.querySelector(".file-coverage").textContent'), /2 张图片未识别/);
  assert.match(await run('document.querySelector(".file-coverage").textContent'), /公式未重算/);
  assert.match(await run('document.querySelector(".file-coverage").textContent'), /隐藏区域/);
  assert.equal(await run('document.querySelector("textarea").value'), '查看文件时仍可编辑的草稿');
  assert.equal(await run('!!document.querySelector(".modal")'), false);
  console.log('PASS signed-reference reading retains coverage without blocking the sibling draft');

  const slow = await start('a');
  const slowRead = await resolveList(slow, 'a');
  const fast = await start('b');
  const fastRead = await resolveList(fast, 'b');
  await resolve(fastRead, ready('b.txt', '较新选择 B'));
  await wait('document.querySelector(".delivery-preview-text")?.textContent==="较新选择 B"');
  await resolve(slowRead, ready('a.txt', '迟到的 A 不得覆盖 B'));
  await settle();
  assert.equal(await text(), '较新选择 B');
  assert.equal(
    await run('document.querySelector(".delivery-preview-heading strong").textContent'),
    'b.txt',
  );
  console.log('PASS out-of-order reads preserve the most recently selected file and title');

  const closedList = await start();
  await click('#close-panel');
  const countAtClose = (await calls()).length;
  await resolve(closedList, list());
  await settle();
  assert.equal((await calls()).length, countAtClose);
  assert.equal(await run('!!document.querySelector(".delivery-preview")'), false);
  console.log('PASS closing during list lookup prevents a later read or reopened preview');

  const returned = await start();
  const returnedRead = await resolveList(returned);
  await click('[aria-label="返回产出列表"]');
  await resolve(returnedRead, ready('a.txt', '返回列表后不再显示'));
  await settle();
  assert.equal(await run('!!document.querySelector("#empty-preview")'), true);
  console.log('PASS returning to the output list invalidates an in-flight file read');

  const switched = await start();
  const switchedRead = await resolveList(switched);
  await run('window.deliveryQA.configure({sessionId:"second-chat",epoch:1})');
  await resolve(switchedRead, ready('a.txt', '其他会话的旧正文'));
  await settle();
  assert.equal(await run('!!document.querySelector(".delivery-preview")'), false);
  await run('window.deliveryQA.configure({sessionId:"first-chat",epoch:2})');
  assert.equal(await run('!!document.querySelector(".delivery-preview")'), false);
  const currentList = await start('b');
  assert.equal((await calls())[currentList].options.sessionId, 'first-chat');
  await click('#close-panel');
  await resolve(currentList, list('b'));
  await settle();
  console.log('PASS switching chats in one project and returning cannot resurrect the old preview');

  const missing = await start();
  await resolve(missing, [
    { path: 'C:\\qa\\a.txt', available: false, reason: '交付文件已不存在。' },
  ]);
  await wait('!!document.querySelector(".delivery-preview-failure")');
  assert.match(
    await run('document.querySelector(".delivery-preview [role=alert]").textContent'),
    /交付文件已不存在/,
  );
  assert.equal((await calls()).at(-1).method, 'list');
  const retryList = (await calls()).length;
  await click('.delivery-preview-failure button');
  const retryRead = await resolveList(retryList);
  await resolve(retryRead, ready('a.txt', '重试后的实际正文'));
  await wait('document.querySelector(".delivery-preview-text")?.textContent==="重试后的实际正文"');
  console.log('PASS unavailable references fail inline and retry obtains a fresh signed reference');

  const longList = await start();
  const longRead = await resolveList(longList);
  const plain = '<script>window.unexpectedExecution=true</script>\n' + '正文'.repeat(7000);
  await resolve(longRead, ready('a.txt', plain));
  await wait('!!document.querySelector(".delivery-preview-limit")');
  assert.equal((await text()).length, 12000);
  assert.equal(await text(), plain.slice(0, 12000));
  assert.equal(await run('!!window.unexpectedExecution'), false);
  assert.equal(await run('!!document.querySelector(".delivery-preview-content script")'), false);
  await click('.delivery-preview-heading .secondary-button');
  assert.equal(await run('window.deliveryQA.enlarged.text.length'), plain.length);
  assert.equal(await run('document.querySelector("textarea").value'), '查看文件时仍可编辑的草稿');
  console.log(
    'PASS text stays inert, truncation is explicit, and enlargement receives the same material',
  );

  const disposed = await start();
  await run('window.deliveryQA.configure({mounted:false})');
  const disposedCount = (await calls()).length;
  await resolve(disposed, list());
  await settle();
  assert.equal((await calls()).length, disposedCount);
  assert.equal(await run('!!document.querySelector("#unmounted")'), true);
  assert.ok((await calls()).every((call) => ['list', 'read'].includes(call.method)));
  console.log('PASS StrictMode unmount invalidates work without persistence or model operations');
}

test(
  '交付预览真实 renderer：安全引用、选择竞态、关闭、会话隔离、重试与提取边界',
  { timeout: 45000 },
  async (context) => {
    const temporaryRoot = await realpath(os.tmpdir());
    const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-delivery-preview-'));
    let child;
    let exited;
    let spawnError;
    try {
      const renderer = await build({
        entryPoints: [path.join(repository, 'tests/fixtures/delivery-preview.jsx')],
        outfile: path.join(directory, 'renderer.js'),
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"test"' },
        logLevel: 'silent',
      });
      for (const output of renderer.outputFiles) await writeFile(output.path, output.contents);
      await writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>',
      );
      const main = `
      const {app,BrowserWindow}=require('electron');
      const path=require('node:path');
      app.setPath('userData',path.join(__dirname,'profile'));
      app.whenReady().then(async()=>{
        const window=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
        try {await window.loadFile(path.join(__dirname,'index.html'));await (${exerciseWindow.toString()})(window);console.log('PASS delivery preview renderer');app.exit(0);}
        catch(error){console.error(error);app.exit(1);}
      }).catch(error=>{console.error(error);app.exit(1);});
    `;
      const mainPath = path.join(directory, 'main.cjs');
      await writeFile(mainPath, main);
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
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.once('error', (error) => {
        spawnError = error;
      });
      exited = new Promise((resolve) => child.once('close', (code) => resolve(code)));
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      const code = await exited;
      assert.equal(spawnError, undefined, String(spawnError));
      assert.equal(code, 0, output);
      assert.match(output, /PASS delivery preview renderer/);
      assert.equal((output.match(/PASS /g) || []).length, 9, output);
    } finally {
      if (child && child.exitCode === null) {
        child.kill();
        await exited;
      }
      const resolved = await realpath(directory);
      assert.equal(path.dirname(resolved), temporaryRoot);
      assert.ok(path.basename(resolved).startsWith('zhixing-delivery-preview-'));
      await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  },
);

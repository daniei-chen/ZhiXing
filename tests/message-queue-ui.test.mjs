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

// 在真实 Electron renderer 里挂载 Composer，只验证排队消息的界面契约：
// 运行中仍可提交、队列表、失败重试、编辑与删除。
async function exerciseWindow(window) {
  const assert = require('node:assert/strict');
  const run = (source) => window.webContents.executeJavaScript(source);
  const wait = async (expression) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await run(expression)) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error(`Timeout: ${expression}`);
  };
  const settle = async () => {
    await run('window.queueQA.settle()');
    await run('window.queueQA.settle()');
  };
  const text = (selector) => run(`window.queueQA.text(${JSON.stringify(selector)})`);
  const calls = () => run('window.queueQA.calls');

  await wait('!!window.queueReady');
  await wait('!!document.querySelector("textarea[aria-label=\\"聊天输入框\\"]")');

  // 运行中：输入框可用、发送按钮改为排队发送、占位文案说明会自动发出。
  const placeholder = await run(
    'document.querySelector("textarea[aria-label=\\"聊天输入框\\"]").placeholder',
  );
  assert.match(placeholder, /本轮结束后自动发送/);
  assert.equal(
    await run('!!document.querySelector(".send-button[aria-label=\\"排队发送\\"]")'),
    true,
  );
  assert.equal(
    await run('!!document.querySelector(".send-button[aria-label=\\"停止生成\\"]")'),
    true,
  );

  await run('window.queueQA.type("运行中的第二件交办")');
  await settle();
  await run('window.queueQA.pressEnter()');
  await settle();
  assert.deepEqual(
    (await calls()).filter((call) => call.name === 'submit').length,
    1,
    'Enter while running still submits (the host queues it)',
  );
  console.log('PASS composing during a run keeps the field usable and submits through Enter');

  // 队列渲染：标题、序号、正文预览、附件数与操作按钮。
  await run(
    'window.queueQA.add({id:"q1",chatId:"chat-a",workspaceId:"office-home",text:"先核对这张表",files:[],mode:"office"})',
  );
  await run(
    'window.queueQA.add({id:"q2",chatId:"chat-a",workspaceId:"office-home",text:"再整理成纪要",files:[{id:"f1",name:"a.txt"},{id:"f2",name:"b.txt"}],mode:"office"})',
  );
  await settle();
  assert.equal(await text('.queued-heading span'), '2 条排队消息');
  assert.match(await text('.queued-messages'), /本轮结束后按顺序发送/);
  const rows = await run(
    '[...document.querySelectorAll(".queued-messages li .queued-text")].map(node=>node.textContent)',
  );
  assert.deepEqual(rows, ['先核对这张表', '再整理成纪要']);
  assert.match(
    await run('document.querySelectorAll(".queued-messages li")[1].textContent'),
    /2 个附件/,
  );
  assert.equal(
    await run('document.querySelector(".queued-messages").getAttribute("aria-label")'),
    '2 条排队消息',
  );
  console.log('PASS queued messages render in order with previews, attachments and count');

  // 编辑与删除都交给调用方，且不误动其它排队项。
  await run('window.queueQA.click(".queued-messages li:nth-child(1) .text-button")');
  await settle();
  const editCall = (await calls()).at(-1);
  assert.equal(editCall.name, 'edit');
  assert.equal(
    editCall.id.id,
    'q1',
    'editing receives the queued item so its text and files return to the composer',
  );
  assert.equal(editCall.id.text, '先核对这张表');
  assert.equal(await text('.queued-heading span'), '1 条排队消息');
  await run('window.queueQA.click(".queued-messages li .icon-button")');
  await settle();
  assert.deepEqual((await calls()).at(-1), { name: 'remove', id: 'q2' });
  assert.equal(await run('!!document.querySelector(".queued-messages")'), false);
  console.log('PASS editing and deleting one queued message leaves the rest untouched');

  // 队头失败：错误就地显示，重试按钮清掉错误，发送按钮不受影响。
  await run(
    'window.queueQA.add({id:"q3",chatId:"chat-a",workspaceId:"office-home",text:"这条会失败",files:[],mode:"office"})',
  );
  await run('window.queueQA.fail("q3","模型服务未连接")');
  await settle();
  assert.match(await text('.queued-error'), /模型服务未连接/);
  assert.equal(await run('!!document.querySelector(".queued-messages li.failed")'), true);
  await run('window.queueQA.click(".queued-messages li.failed .text-button")');
  await settle();
  assert.deepEqual((await calls()).at(-1), { name: 'retry', id: 'q3' });
  assert.equal(await run('!!document.querySelector(".queued-messages li.failed")'), false);
  console.log('PASS a failed head keeps its error inline and offers retry');

  // 运行结束后占位与发送标签回到常态。
  await run('window.queueQA.setRunning(false)');
  await settle();
  assert.equal(
    await run('document.querySelector("textarea[aria-label=\\"聊天输入框\\"]").placeholder'),
    '交代一件事，或添加要处理的资料…',
  );
  assert.equal(
    await run('!!document.querySelector(".send-button[aria-label=\\"发送消息\\"]")'),
    true,
  );
  assert.equal(
    await run('!!document.querySelector(".send-button[aria-label=\\"停止生成\\"]")'),
    false,
  );
  console.log('PASS once the run ends the composer returns to its normal send affordance');
}

test(
  '运行中排队：真实 renderer 里的输入、队列、失败重试与编辑删除',
  { timeout: 45000 },
  async (context) => {
    const temporaryRoot = await realpath(os.tmpdir());
    const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-composer-queue-'));
    let child;
    let exited;
    let spawnError;
    try {
      const renderer = await build({
        entryPoints: [path.join(repository, 'tests/fixtures/composer-queue.jsx')],
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
      await writeFile(
        path.join(directory, 'main.cjs'),
        `const {app,BrowserWindow}=require('electron');
app.setPath('userData',require('node:path').join(__dirname,'profile'));
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 try{await window.loadFile(require('node:path').join(__dirname,'index.html'));await (${exerciseWindow.toString()})(window);app.exit(0);}
 catch(error){console.error(error);app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});`,
      );
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const flags =
        process.platform === 'linux'
          ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu']
          : [];
      child = spawn(require('electron'), [...flags, path.join(directory, 'main.cjs')], {
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
      assert.equal((output.match(/PASS /g) || []).length, 5, output);
    } finally {
      if (child && child.exitCode === null) {
        child.kill();
        await exited;
      }
      const resolved = await realpath(directory);
      assert.equal(path.dirname(resolved), temporaryRoot);
      assert.ok(path.basename(resolved).startsWith('zhixing-composer-queue-'));
      await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  },
);

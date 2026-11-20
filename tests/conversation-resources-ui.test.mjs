import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repository = path.resolve(import.meta.dirname, '..');

test('独立 Windows renderer 验证资源浮层导航、滚动、键盘关闭和焦点恢复', {
  skip: process.platform !== 'win32',
  timeout: 45000,
}, async context => {
  const tempRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, 'zhixing-resources-test-'));
  let child;
  let exited;
  try {
    await mkdir(path.join(directory, 'profile'));
    const renderer = await build({
      stdin: {
        resolveDir: repository,
        loader: 'jsx',
        contents: `
          import {createElement} from 'react';
          import {createRoot} from 'react-dom/client';
          import {flushSync} from 'react-dom';
          import {ConversationResources} from './src/ConversationResources.jsx';
          const root = createRoot(document.getElementById('root'));
          const file = {path: 'D:/合成资料/成果.docx', description: '合成产出'};
          const calls = [];
          const record = name => (...args) => calls.push({name, args});
          const close = () => {
            record('close')();
            flushSync(() => root.render(null));
          };
          const defaults = {
            messages: [
              {id:'user', role:'user', files:[{name:'仅文件记录.txt',size:12}]},
              {id:'reply', runId:'run', deliverables:[file], children:[{id:'child'}],
                importedTools:[{name:'web_fetch',url:'https://example.com/source'}],
                trace:[{type:'tool/result',category:'tools',label:'网页搜索 · 完成'},
                  {type:'job/registered',itemId:'job'},{type:'job/settled',itemId:'job'}]},
            ],
            running: {workspaceId:'another-mode',chatId:'another-chat'},
            runningTitle: '另一个模式中的任务',
            onOpenDeliverable:record('deliverable'), onOpenSource:record('source'),
            onViewActivity:record('activity'), onViewFiles:record('files'),
            onAddSource:record('addSource'), onReturnToRun:record('return'), onClose:close,
          };
          window.resourceQA = {
            calls, file,
            open(props={}) {
              calls.length=0;
              document.getElementById('trigger').focus();
              flushSync(() => root.render(createElement(ConversationResources,{...defaults,...props})));
            },
            close,
          };
          document.getElementById('trigger').addEventListener('click', () => window.resourceQA.open());
        `,
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"test"' },
      logLevel: 'silent',
    });
    await writeFile(path.join(directory, 'renderer.js'), renderer.outputFiles[0].text);
    const main = `
      const {app,BrowserWindow}=require('electron');
      const assert=require('node:assert/strict');
      const fs=require('node:fs/promises');
      const path=require('node:path');
      app.setPath('userData',path.join(__dirname,'profile'));
      app.whenReady().then(async()=>{
        const window=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
        const run=source=>window.webContents.executeJavaScript(source);
        const open=()=>run('window.resourceQA.open()');
        const click=selector=>run('document.querySelector('+JSON.stringify(selector)+').click()');
        const actions=()=>run('window.resourceQA.calls.map(call=>call.name)');
        const returned=async()=>assert.equal(await run('document.activeElement.id'),'trigger');
        try {
          await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html><body><button id="trigger">当前对话产出</button><button id="outside">其他操作</button><div id="root"></div></body></html>'));
          await run(await fs.readFile(path.join(__dirname,'renderer.js'),'utf8'));
          await open();
          assert.equal(await run('document.querySelector("[role=dialog]").getAttribute("aria-label")'),'当前对话产出与来源');
          assert.equal(await run('document.querySelector("[role=dialog]").classList.contains("dropdown")'),true);
          assert.equal(await run('!!document.querySelector("[role=dialog] h2")'),false);
          assert.equal(await run('document.activeElement.className'),'resource-close');
          assert.match(await run('document.querySelector(".resource-sources").textContent'),/附件记录/);
          assert.match(await run('document.querySelector(".resource-activity").textContent'),/协作子任务 · 1/);
          assert.match(await run('document.querySelector(".resource-activity").textContent'),/后台作业 · 1/);

          await click('.resource-outputs button');
          assert.deepEqual(await actions(),['deliverable','close']);
          assert.equal(await run('window.resourceQA.calls[0].args[0]===window.resourceQA.file'),true);
          await returned();
          await open();
          await click('.resource-sources button:has(.resource-copy small):not(:has(.resource-action))');
          assert.deepEqual(await actions(),['source','close']);
          assert.equal(await run('window.resourceQA.calls[0].args[0].url'),'https://example.com/source');
          await returned();
          await open();
          await run('[...document.querySelectorAll(".resource-sources button")].find(button=>button.textContent.includes("仅文件记录.txt")).click()');
          assert.deepEqual(await actions(),['source','close']);
          assert.equal(await run('window.resourceQA.calls[0].args[0].recordOnly'),true);
          assert.equal(await run('window.resourceQA.calls[0].args[0].file.name'),'仅文件记录.txt');
          await open();
          await click('.resource-action');
          assert.deepEqual(await actions(),['activity','close']);
          await open();
          await click('button[aria-label="在文件面板添加或查看输出内容"]');
          assert.deepEqual(await actions(),['files','close']);
          await open();
          await click('button[aria-label="在浏览器中添加来源"]');
          assert.deepEqual(await actions(),['addSource','close']);
          await open();
          assert.match(await run('document.querySelector(".resource-running").textContent'),/另一个模式中的任务/);
          await click('.resource-running');
          assert.deepEqual(await actions(),['return','close']);
          assert.equal(await run('window.resourceQA.calls[0].args.length'),0);
          await returned();

          await open();
          await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",isComposing:true,bubbles:true}))');
          assert.equal(await run('!!document.querySelector("[role=dialog]")'),true);
          await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",shiftKey:true,bubbles:true,cancelable:true}))');
          assert.equal(await run('document.activeElement.textContent.includes("查看执行轨迹")'),true);
          await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}))');
          assert.equal(await run('document.activeElement.className'),'resource-close');
          await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
          assert.equal(await run('!!document.querySelector("[role=dialog]")'),false);
          await returned();
          await open();
          await click('#outside');
          assert.equal(await run('!!document.querySelector("[role=dialog]")'),false);
          await returned();
          await open();
          await click('.resource-close');
          assert.deepEqual(await actions(),['close']);
          await returned();
          await click('#trigger');
          assert.equal(await run('!!document.querySelector("[role=dialog]")'),true);
          await run('window.resourceQA.close()');
          await run('(()=>{const style=document.createElement("style");style.textContent=".resource-header { display: none; }";document.head.append(style);window.resourceQA.open();})()');
          assert.equal(await run('document.activeElement.className'),'resource-running');
          await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
          await returned();

          await run('window.resourceQA.open({messages:[{role:"assistant",text:"https://example.com/unvisited"}],liveTrace:[],running:false})');
          assert.equal(await run('document.querySelectorAll(".resource-empty").length'),2);
          assert.equal(await run('document.querySelectorAll(".resource-summary").length'),1);
          assert.equal(await run('!!document.querySelector(".resource-running")'),false);
          await run('window.resourceQA.close()');
          await run('window.resourceQA.open({messages:[{deliverables:Array.from({length:100},(_,i)=>({path:"D:/合成/"+i+".txt"}))}],onOpenDeliverable:undefined})');
          assert.equal(await run('document.querySelector(".resource-outputs button").disabled'),true);
          assert.equal(await run('(()=>{const list=document.querySelector(".resource-outputs");return getComputedStyle(list).overflowY==="auto"&&list.scrollHeight>list.clientHeight})()'),true);
          console.log('PASS resource renderer navigation, records, counts, keyboard, focus and scroll');
        } finally {window.destroy();}
        app.quit();
      }).catch(error=>{console.error(error.stack);app.exit(1);});
    `;
    const mainPath = path.join(directory, 'main.cjs');
    await writeFile(mainPath, main);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(require('electron'), [mainPath], { env, signal: context.signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const [code] = await exited;
    assert.equal(code, 0, output);
    assert.match(output, /PASS resource renderer/);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await exited;
    }
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), tempRoot);
    assert(path.basename(resolved).startsWith('zhixing-resources-test-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});

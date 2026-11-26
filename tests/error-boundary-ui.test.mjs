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

// This function runs inside a separate Electron main process. Its assertions
// inspect the real React DOM, not a mock renderer or server rendering.
async function exerciseWindow(window) {
  const assert = require('node:assert/strict');
  const { once } = require('node:events');
  const run = (source) => window.webContents.executeJavaScript(source);
  const configure = (value) => run(`window.boundaryQA.configure(${JSON.stringify(value)})`);
  const click = (selector) => run(`window.boundaryQA.click(${JSON.stringify(selector)})`);
  const exists = (selector) => run(`!!document.querySelector(${JSON.stringify(selector)})`);
  const settle = () => run('window.boundaryQA.settle()');
  const pendingBarrier = () => run('window.boundaryQA.pendingBarrier()');
  const releaseBarrier = async (success) => {
    await run(`window.boundaryQA.releaseBarrier(${success})`);
    await settle();
  };
  const safe = async () => {
    assert.equal(await run('document.body.textContent.includes(window.boundaryQA.secret)'), false);
    const diagnostics = await run('window.boundaryQA.diagnostics');
    assert.ok(diagnostics.length > 0);
    for (const [name, data] of diagnostics) {
      assert.equal(name, 'renderer.boundary');
      assert.deepEqual(Object.keys(data).sort(), ['code', 'scope']);
      assert.equal(data.code, 'RENDER_FAILED');
      assert.ok(['application', 'workbench'].includes(data.scope));
    }
    assert.equal(await run('window.boundaryQA.workspaceCalls'), 0);
    assert.equal(
      await run('localStorage.getItem("boundary-workspace")'),
      'keep-existing-workspace',
    );
  };

  await click('#edit-draft');
  await configure({ fault: 'render' });
  assert.equal(await exists('.render-error-workbench'), true);
  assert.equal(await exists('.render-error-application'), false);
  assert.equal(await run('document.querySelector("#draft").value'), '尚未发送的聊天草稿');
  await click('#increment-chat');
  assert.equal(await run('document.querySelector("#chat-count").textContent'), '1');
  await safe();
  console.log('PASS render failure isolates the panel and preserves the live sibling draft');

  for (let index = 0; index < 3; index += 1) await click('.render-error-retry');
  assert.equal(await exists('.render-error-workbench'), true);
  assert.equal(await exists('.render-error-application'), false);
  assert.equal(await run('document.querySelector("#draft").value'), '尚未发送的聊天草稿');
  await safe();
  console.log('PASS retrying a still-broken child remains contained without exposing the error');

  await configure({ fault: 'none' });
  assert.equal(await exists('.render-error-workbench'), true);
  await click('.render-error-retry');
  assert.equal(await exists('#healthy-panel'), true);
  assert.equal(await exists('.render-error-workbench'), false);
  assert.equal(await run('document.querySelector("#chat-count").textContent'), '1');
  console.log('PASS explicit retry remounts a repaired panel without remounting the chat');

  await configure({ fault: 'effect' });
  assert.equal(await exists('.render-error-workbench'), true);
  await configure({ hidden: true });
  assert.equal(await run('document.querySelector(".render-error-workbench").hidden'), true);
  assert.equal(
    await run('getComputedStyle(document.querySelector(".render-error-workbench")).display'),
    'none',
  );
  await configure({ hidden: false });
  assert.notEqual(
    await run('getComputedStyle(document.querySelector(".render-error-workbench")).display'),
    'none',
  );
  await safe();
  console.log('PASS lifecycle failure is contained and the failed panel still obeys visibility');

  await configure({ fault: 'none', scopeKey: 'next-chat' });
  assert.equal(await exists('#healthy-panel'), true);
  assert.equal(await exists('.render-error-workbench'), false);
  assert.equal(await run('document.querySelector("#draft").value'), '尚未发送的聊天草稿');
  console.log('PASS changing the boundary key permits a fresh panel scope');

  await configure({ fatal: true });
  assert.equal(await exists('.render-error-application [role="alert"]'), true);
  assert.equal(await exists('#chat'), false);
  await safe();
  await configure({ fatal: false });
  await pendingBarrier();
  await click('.render-error-retry');
  assert.equal(await exists('.render-error-application'), true);
  assert.equal(await exists('#chat'), false);
  assert.equal(
    await run(
      '[...document.querySelectorAll(".render-error-application button")].every(button=>button.disabled)',
    ),
    true,
  );
  assert.equal(await run('window.boundaryQA.barrierCalls'), 1);
  console.log(
    'PASS pending durability barrier prevents application remount and duplicate restore clicks',
  );

  await releaseBarrier(false);
  assert.equal(await exists('.render-error-application'), true);
  assert.equal(await exists('#chat'), false);
  assert.equal(await run('document.body.textContent.includes("最后的更改仍未保存")'), true);
  assert.equal(await run('document.querySelector(".render-error-retry").disabled'), false);
  await safe();
  console.log('PASS rejected durability barrier retains the fallback and hides the raw failure');

  await pendingBarrier();
  await click('.render-error-retry');
  await releaseBarrier(true);
  assert.equal(await exists('#chat'), true);
  assert.equal(await exists('.render-error-application'), false);
  console.log('PASS global fallback retries a repaired application without changing stored data');

  await configure({ fatal: true });
  const originalDocument = await run('performance.timeOrigin');
  await pendingBarrier();
  await click('.render-error-application button:last-child');
  await settle();
  assert.equal(await run('performance.timeOrigin'), originalDocument);
  assert.equal(await exists('.render-error-application'), true);
  await releaseBarrier(false);
  assert.equal(await run('performance.timeOrigin'), originalDocument);
  assert.equal(await exists('.render-error-application'), true);
  await safe();
  console.log('PASS pending and rejected reload barriers keep the original document alive');

  await pendingBarrier();
  const reloaded = once(window.webContents, 'did-finish-load');
  await click('.render-error-application button:last-child');
  await run('window.boundaryQA.releaseBarrier(true)');
  await reloaded;
  assert.equal(await exists('#chat'), true);
  assert.equal(await exists('.render-error-application'), false);
  assert.equal(await run('localStorage.getItem("boundary-workspace")'), 'keep-existing-workspace');
  assert.equal(await run('window.boundaryQA.workspaceCalls'), 0);
  console.log('PASS reload performs a real navigation and leaves stored workspace bytes intact');
}

test(
  '真实 React renderer 验证全局/面板异常隔离、隐藏状态、安全诊断及实际恢复',
  {
    timeout: 45000,
  },
  async (context) => {
    const temporaryRoot = await realpath(os.tmpdir());
    const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-error-boundary-'));
    let child;
    let exited;
    let spawnError;
    try {
      const renderer = await build({
        stdin: {
          resolveDir: repository,
          loader: 'jsx',
          contents: `
          import {StrictMode, useLayoutEffect, useState} from 'react';
          import {createRoot} from 'react-dom/client';
          import {flushSync} from 'react-dom';
          import {ErrorBoundary, reportRenderError} from './src/ErrorBoundary.jsx';
          import {registerRendererDurability, flushRendererDurability} from './src/renderer-durability.js';
          import './src/styles.css';
          const secret='QA_SYNTHETIC_SECRET_DO_NOT_DISPLAY';
          const diagnostics=[];
          console.error=(...args)=>diagnostics.push(args);
          let workspaceCalls=0;
          let barrierCalls=0, barrier;
          registerRendererDurability(()=>{barrierCalls++;return barrier?.promise;});
          window.zhixing={saveWorkspace(){workspaceCalls++;throw Error('Unexpected workspace write');}};
          if(localStorage.getItem('boundary-workspace')===null)localStorage.setItem('boundary-workspace','keep-existing-workspace');
          const root=createRoot(document.getElementById('root'),{onCaughtError:reportRenderError});
          const config={fault:'none',hidden:false,scopeKey:'first-chat',fatal:false};
          function Chat(){
            const [draft,setDraft]=useState(''),[count,setCount]=useState(0);
            return <section id="chat"><textarea id="draft" value={draft} readOnly/>
              <button id="edit-draft" onClick={()=>setDraft('尚未发送的聊天草稿')}>编辑草稿</button>
              <button id="increment-chat" onClick={()=>setCount(value=>value+1)}>继续聊天</button>
              <output id="chat-count">{count}</output></section>;
          }
          function Panel({fault}){
            useLayoutEffect(()=>{if(fault==='effect')throw Error(secret);},[fault]);
            if(fault==='render')throw Error(secret);
            return <aside className="workbench" id="healthy-panel">工作面板</aside>;
          }
          function Frame({fault,hidden,scopeKey,fatal}){
            if(fatal)throw Error(secret);
            return <div className="app-shell"><div className="main-columns"><Chat/>
              <ErrorBoundary key={scopeKey} scope="workbench" hidden={hidden}>
                <Panel fault={fault}/>
              </ErrorBoundary></div></div>;
          }
          function render(){flushSync(()=>root.render(<StrictMode><ErrorBoundary scope="application" beforeRestore={flushRendererDurability}><Frame {...config}/></ErrorBoundary></StrictMode>));}
          window.boundaryQA={secret,diagnostics,get workspaceCalls(){return workspaceCalls;},get barrierCalls(){return barrierCalls;},
            configure(next){Object.assign(config,next);render();},
            click(selector){const button=document.querySelector(selector);if(!button)throw Error('Missing test control');flushSync(()=>button.click());},
            pendingBarrier(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});barrier={promise,resolve,reject};},
            releaseBarrier(success){if(!barrier)throw Error('Missing durability barrier');if(success)barrier.resolve();else barrier.reject(Error(secret));},
            async settle(){await new Promise(resolve=>setTimeout(resolve,0));flushSync(()=>{});},
          };
          render();
        `,
        },
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
        const window=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
        try {
          await window.loadFile(path.join(__dirname,'index.html'));
          await (${exerciseWindow.toString()})(window);
          console.log('PASS error boundary renderer');app.exit(0);
        } catch(error) {console.error(error);app.exit(1);}
      }).catch(error=>{console.error(error);app.exit(1);});
    `;
      const mainPath = path.join(directory, 'main.cjs');
      await writeFile(mainPath, main);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      // Linux CI can run the same real DOM assertions without an X server.
      // This remains renderer-level evidence, not Windows package acceptance.
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
      assert.match(output, /PASS error boundary renderer/);
      assert.equal((output.match(/PASS /g) || []).length, 11, output);
    } finally {
      if (child && child.exitCode === null) {
        child.kill();
        await exited;
      }
      const resolved = await realpath(directory);
      assert.equal(path.dirname(resolved), temporaryRoot);
      assert.ok(path.basename(resolved).startsWith('zhixing-error-boundary-'));
      await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  },
);

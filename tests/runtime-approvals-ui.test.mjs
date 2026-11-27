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

// Real React/Electron DOM with a controlled host contract. Actual Harness,
// filesystem side effects, and native mouse input belong to the packaged gate.
async function exerciseWindow(window) {
  const assert = require('node:assert/strict');
  const run = (source) => window.webContents.executeJavaScript(source);
  const tick = () => run('window.approvalQA.tick()');
  const configure = (value) => run(`window.approvalQA.configure(${JSON.stringify(value)})`);
  const click = (selector) => run(`window.approvalQA.click(${JSON.stringify(selector)})`);
  const publish = (rows) => run(`window.approvalQA.publish(${JSON.stringify(rows)})`);
  const calls = () => run('window.approvalQA.calls');
  const exists = (selector) => run(`!!document.querySelector(${JSON.stringify(selector)})`);
  const active = () => run('document.querySelector(".approval-request")?.dataset.approvalRequest');
  const request = (id, root = 'chat-a', child = root) => ({
    requestId: id,
    runId: `run-${root}`,
    rootSessionId: root,
    sourceSessionId: child,
    toolName: 'office_write_file',
    callId: 'same-call',
    createdAt: 1,
    presentation: { operation: '写入项目文件', path: `${id}.txt`, overwrite: true },
  });
  const resolve = (index, accepted, remove = true) =>
    run(`window.approvalQA.resolve(${index},${accepted},${remove})`);
  const key = (key, options = {}) =>
    run(`window.approvalQA.key(${JSON.stringify(key)},${JSON.stringify(options)})`);

  await tick();
  assert.equal(await run('innerWidth >= 260 && innerHeight >= 600'), true);
  assert.equal(await run('window.approvalQA.subscriberCount'), 1);
  await run('document.querySelector("#other-input").focus()');
  await publish([
    request('first'),
    request('second', 'chat-a', 'child-a'),
    request('other', 'chat-b'),
  ]);
  assert.equal(await active(), 'first');
  assert.equal(await run('document.activeElement.id'), 'other-input');
  assert.equal(await run('document.querySelector("#other-count").textContent'), '1');
  assert.equal(
    await run('document.querySelector(".approval-heading span").textContent'),
    '2 项待批准',
  );
  assert.equal(await run('window.approvalQA.sameTextarea()'), true);
  assert.equal(await run('document.querySelector(".composer").hidden'), true);
  assert.equal(await run('document.querySelector(".composer").inert'), true);
  assert.equal(await run('document.querySelector("textarea").value'), '未发送的合成草稿');
  assert.equal(await run('document.querySelectorAll(".attachment-chip").length'), 1);
  assert.equal(await exists('.effort-popover,.permission-dropdown,.attachment-menu'), false);
  assert.equal(await exists('.app-body[inert]'), false);
  assert.deepEqual(await calls(), []);
  console.log(
    'PASS scoped approvals preserve the hidden input, attachments, other requests and focus',
  );

  await click('.approval-queue button:nth-child(2)');
  assert.equal(await active(), 'second');
  assert.equal(await run('document.querySelector(".approval-origin").textContent'), '子任务请求');
  await configure({ chat: 'chat-b' });
  assert.equal(await active(), 'other');
  assert.equal(await run('document.querySelector("#other-count").textContent'), '2');
  await configure({ chat: 'chat-a' });
  await click('.approval-queue button:first-child');
  assert.equal(await active(), 'first');
  assert.deepEqual(await calls(), []);
  console.log(
    'PASS selecting same-call operations and switching chat never decides another request',
  );

  await click('.approval-allow');
  await click('.approval-allow');
  assert.equal((await calls()).length, 1);
  assert.deepEqual((await calls())[0], {
    hostEpoch: 'host-a',
    requestId: 'first',
    runId: 'run-chat-a',
    rootSessionId: 'chat-a',
    outcome: 'allowed-once',
  });
  assert.equal(await run('window.approvalQA.snapshot.pending.length'), 3);
  assert.equal(await run('document.querySelector(".approval-allow").disabled'), true);
  assert.match(await run('document.querySelector(".approval-notice").textContent'), /正在提交决定/);
  await click('.approval-queue button:nth-child(2)');
  await resolve(0, true);
  await tick();
  assert.equal(await active(), 'second');
  assert.equal(await run('document.querySelector(".approval-allow").disabled'), false);
  assert.equal(await exists('.approval-notice'), false);
  console.log(
    'PASS double clicks submit once and a late acknowledgement does not alter the next card',
  );

  await click('.approval-decisions button:first-child');
  assert.equal((await calls())[1].outcome, 'rejected');
  await run('window.approvalQA.fail(1)');
  await tick();
  assert.match(await run('document.querySelector(".approval-notice").textContent'), /决定尚未确认/);
  assert.equal(await run('document.body.textContent.includes("PRIVATE_FAILURE_CONTENT")'), false);
  await click('.approval-notice button');
  await tick();
  assert.equal(await exists('.approval-notice'), false);
  await click('.approval-decisions button:first-child');
  await resolve(2, true);
  await tick();
  assert.equal(await exists('.approval-panel'), false);
  assert.equal(await run('document.querySelector(".composer").hidden'), false);
  assert.equal(await run('window.approvalQA.sameTextarea()'), true);
  assert.equal(await run('document.querySelector("textarea").value'), '未发送的合成草稿');
  console.log(
    'PASS failed submissions stay unconfirmed, can synchronize and preserve the original draft',
  );

  await configure({ chat: 'chat-b' });
  await click('.approval-allow');
  await publish([request('replacement', 'chat-b')]);
  await resolve(3, false, false);
  await tick();
  assert.equal(await active(), 'replacement');
  assert.equal(await run('document.querySelector(".approval-allow").disabled'), false);
  assert.equal(await exists('.approval-notice'), false);
  console.log(
    'PASS withdrawing an in-flight request prevents its response from reviving an old card',
  );

  await run('window.approvalQA.remount()');
  await tick();
  assert.equal(await active(), 'replacement');
  assert.equal(await run('window.approvalQA.subscriberCount'), 1);
  assert.equal((await calls()).length, 4);
  await run('window.approvalQA.rebind()');
  await tick();
  assert.equal(await active(), 'replacement');
  assert.equal(await run('window.approvalQA.subscriberCount'), 1);
  assert.equal((await calls()).length, 4);
  console.log(
    'PASS StrictMode remount and fresh bridge subscription restore host pending without answering',
  );

  await run('document.querySelector("#other-input").focus()');
  await key('Enter');
  await run('document.querySelector(".approval-detail").focus()');
  await run('window.approvalQA.composition("compositionstart")');
  await key('Enter', { isComposing: true });
  await run('window.approvalQA.composition("compositionend")');
  await key('Enter');
  await run('window.approvalQA.keyup()');
  await key('Enter', { repeat: true });
  await key('Enter', { ctrlKey: true });
  assert.equal((await calls()).length, 4);
  await key('Enter');
  assert.equal((await calls()).length, 5);
  assert.equal((await calls())[4].outcome, 'allowed-once');
  await resolve(4, true);
  await tick();
  await publish([request('escape', 'chat-b')]);
  await run('document.querySelector(".approval-detail").focus()');
  await key('Escape');
  assert.equal((await calls())[5].outcome, 'rejected');
  await resolve(5, true);
  await tick();
  console.log(
    'PASS IME/repeat/global Enter cannot approve while explicit local Enter/Escape use once-only decisions',
  );

  const longRequest = request('long', 'chat-b', 'child-b');
  longRequest.presentation = {
    operation: '检查完整命令与目标',
    overwrite: true,
    path: 'D:\\合成项目\\' + '长路径'.repeat(100) + '\\完整对象.txt',
    command: Array.from(
      { length: 70 },
      (_, index) => `Write-Output '合成命令 ${index} <img src=x>'`,
    ).join('\n'),
    network: JSON.stringify({
      url: 'https://example.invalid/' + 'range/'.repeat(100),
      method: 'GET',
    }),
  };
  await publish([longRequest]);
  const light = await run(
    'getComputedStyle(document.querySelector(".approval-panel")).backgroundColor',
  );
  await configure({ width: 260, dark: true });
  await tick();
  assert.notEqual(
    await run('getComputedStyle(document.querySelector(".approval-panel")).backgroundColor'),
    light,
  );
  for (const field of ['path', 'command', 'network']) {
    assert.equal(
      await run(`document.querySelector('[data-approval-field="${field}"]').textContent`),
      longRequest.presentation[field],
    );
  }
  assert.equal(await exists('.approval-panel img'), false);
  assert.match(
    await run('document.querySelector(".approval-overwrite").textContent'),
    /覆盖已有文件/,
  );
  const geometry = await run(`(() => {
    const panel=document.querySelector('.approval-panel').getBoundingClientRect();
    const detail=document.querySelector('.approval-detail');
    const buttons=[...document.querySelectorAll('.approval-decisions button,.approval-stop button')];
    return {scrolls:detail.scrollHeight>detail.clientHeight,
      contained:buttons.every(button=>{const r=button.getBoundingClientRect();return r.top>=panel.top&&r.bottom<=panel.bottom&&r.left>=panel.left&&r.right<=panel.right;}),
      noHorizontalOverflow:detail.scrollWidth<=detail.clientWidth+1,
      viewport:{width:innerWidth,height:innerHeight},maxHeight:getComputedStyle(document.querySelector('.approval-panel')).maxHeight,
      panel:panel.toJSON(),buttons:buttons.map(button=>button.getBoundingClientRect().toJSON())};
  })()`);
  assert.deepEqual(
    {
      scrolls: geometry.scrolls,
      contained: geometry.contained,
      noHorizontalOverflow: geometry.noHorizontalOverflow,
    },
    { scrolls: true, contained: true, noHorizontalOverflow: true },
    JSON.stringify(geometry),
  );
  console.log(
    'PASS narrow dark cards retain full plain-text details and keep decisions outside the scroll area',
  );

  await click('.approval-stop button');
  await tick();
  assert.equal(await run('window.approvalQA.stops'), 1);
  assert.equal(await exists('.approval-panel'), false);
  assert.equal((await calls()).length, 6);
  assert.equal(await run('document.querySelector("textarea").value'), '未发送的合成草稿');
  assert.equal(await run('document.querySelectorAll(".attachment-chip").length'), 1);
  console.log(
    'PASS stop invokes its separate callback without issuing an approval or clearing input',
  );
}

test(
  '真实 React 审批卡：作用域、一次性决定、重订阅、IME、完整详情与输入保留',
  { timeout: 45000 },
  async (context) => {
    const temporaryRoot = await realpath(os.tmpdir());
    const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-approval-ui-'));
    let child, exited, spawnError;
    try {
      const renderer = await build({
        stdin: {
          resolveDir: repository,
          loader: 'jsx',
          contents: `
          import {StrictMode,useLayoutEffect,useRef} from 'react';
          import {createRoot} from 'react-dom/client';
          import {flushSync} from 'react-dom';
          import {ApprovalPanel} from './src/ApprovalPanel.jsx';
          import {Composer} from './src/Composer.jsx';
          import {createRuntimeApprovals} from './src/runtime-approvals.js';
          import {useRuntimeApprovals} from './src/use-runtime-approvals.js';
          import {createKeyedStore} from './src/keyed-store.js';
          import {mergeState} from './src/store.js';
          import './src/styles.css';
          import './src/model-controls.css';
          const subscribers=new Set(),calls=[],answers=[];
          let host={hostEpoch:'host-a',revision:0,pending:[]};
          const api={
            onApprovalsChanged(callback){subscribers.add(callback);return()=>subscribers.delete(callback);},
            async approvalSnapshot(){return structuredClone(host);},
            answerApproval(value){calls.push(value);return new Promise((resolve,reject)=>answers.push({resolve,reject,requestId:value.requestId}));},
          };
          const store=createRuntimeApprovals();
          let off=store.bind(api);
          const drafts=createKeyedStore();
          const files=[{id:'attachment',name:'合成资料.txt',status:'ready',text:'合成附件',size:4}];
          drafts.set('draft',{text:'未发送的合成草稿',files});
          const settings=mergeState(null).settings;
          const config={chat:'chat-a',width:738,dark:false,menu:'reasoning'};
          let root=createRoot(document.getElementById('root')),initialTextarea,stops=0;
          function publish(rows){host={...host,revision:host.revision+1,pending:rows};flushSync(()=>{for(const listener of subscribers)listener(structuredClone(host));});}
          function closeMenu(){if(config.menu!==null){config.menu=null;render();}}
          function Frame(){
            const snapshot=useRuntimeApprovals(store),composer=useRef(null);
            useLayoutEffect(()=>{initialTextarea ||= composer.current;},[]);
            const requests=snapshot.pending.filter(item=>item.rootSessionId===config.chat);
            const takeover=requests.length?<ApprovalPanel hostEpoch={snapshot.hostEpoch} requests={requests}
              connection={snapshot.connection} onAnswer={store.answer} onRefresh={store.refresh}
              onStop={async()=>{stops++;publish(host.pending.filter(item=>item.rootSessionId!==config.chat));}}/>:null;
            const noop=()=>{};
            return <div className={'app-shell'+(config.dark?' dark':'')}><div id="fixture" style={{width:config.width}}>
              <input id="other-input" aria-label="另一处输入"/><output id="other-count">{snapshot.pending.length-requests.length}</output>
              <Composer settings={settings} input="" files={files} draftStore={drafts} draftKey="draft"
                setInput={value=>{const current=drafts.get('draft');drafts.set('draft',{...current,text:typeof value==='function'?value(current.text):value});}}
                setFiles={noop} setSetting={noop} onSubmit={noop} onStop={noop} running={false}
                disabled={false} busy={false} chooseFiles={noop} addFiles={noop} openModal={noop}
                menu={config.menu?{name:config.menu}:null} toggleMenu={noop} closeMenu={closeMenu}
                composer={composer} runtime={{configured:false}} setRuntime={noop} openWorkbench={noop}
                scopeKey={config.chat} onLocalCommand={noop} suspended={false} takeover={takeover}/>
            </div></div>;
          }
          function render(){flushSync(()=>root.render(<StrictMode><Frame/></StrictMode>));}
          window.approvalQA={calls,get snapshot(){return store.getSnapshot();},get subscriberCount(){return subscribers.size;},get stops(){return stops;},
            configure(value){Object.assign(config,value);render();},publish,
            click(selector){const button=document.querySelector(selector);if(!button)throw Error('Missing approval fixture control: '+selector);flushSync(()=>button.click());},
            key(key,options){flushSync(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options})));},
            keyup(){flushSync(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true})));},
            composition(type){flushSync(()=>document.activeElement.dispatchEvent(new CompositionEvent(type,{bubbles:true})));},
            resolve(index,accepted,remove){const answer=answers[index];if(!answer)throw Error('Missing pending fixture answer');if(remove)publish(host.pending.filter(item=>item.requestId!==answer.requestId));answer.resolve({accepted});},
            fail(index){answers[index].reject(Error('PRIVATE_FAILURE_CONTENT'));},
            sameTextarea(){return document.querySelector('textarea')===initialTextarea;},
            remount(){flushSync(()=>root.unmount());root=createRoot(document.getElementById('root'));render();},
            rebind(){off();off=store.bind(api);},
            async tick(){await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>requestAnimationFrame(resolve));flushSync(()=>{});return true;},
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
        '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>#fixture{margin:20px}.composer-area{width:100%}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>',
      );
      const mainPath = path.join(directory, 'main.cjs');
      await writeFile(
        mainPath,
        `
      const {app,BrowserWindow}=require('electron');const path=require('node:path');
      app.setPath('userData',path.join(__dirname,'profile'));
      app.whenReady().then(async()=>{
        const window=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
        try{
          await window.loadFile(path.join(__dirname,'index.html'));
          // The Linux headless display reports a 1x1 native surface. Configure
          // Chromium's viewport before measuring actual CSS/DOM geometry.
          if(process.platform==='linux')window.webContents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width:1100,height:900},viewPosition:{x:0,y:0},deviceScaleFactor:1,viewSize:{width:1100,height:900},scale:1});
          await (${exerciseWindow.toString()})(window);console.log('PASS approvals renderer');app.exit(0);
        }
        catch(error){console.error(error);app.exit(1);}
      }).catch(error=>{console.error(error);app.exit(1);});
    `,
      );
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
      assert.match(output, /PASS approvals renderer/);
      assert.equal((output.match(/PASS /g) || []).length, 10, output);
    } finally {
      if (child && child.exitCode === null) {
        child.kill();
        await exited;
      }
      const resolved = await realpath(directory);
      assert.equal(path.dirname(resolved), temporaryRoot);
      assert.ok(path.basename(resolved).startsWith('zhixing-approval-ui-'));
      await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  },
);

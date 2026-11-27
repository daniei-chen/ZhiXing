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

// Runs in an isolated Electron process against the actual Workbench and CSS.
// DOM keyboard events exercise React navigation; native input and service IPC
// are separate packaged journeys, not claimed by this renderer test.
async function exerciseWindow(window) {
  const assert = require('node:assert/strict');
  const run = (source) => window.webContents.executeJavaScript(source);
  const click = (selector) => run(`window.workbenchQA.click(${JSON.stringify(selector)})`);
  const configure = (value) => run(`window.workbenchQA.configure(${JSON.stringify(value)})`);
  const key = (value) => run(`window.workbenchQA.key(${JSON.stringify(value)})`);
  const tab = (page) => `[role="tab"][data-workbench-page="${page}"]`;
  const select = (page) => click(tab(page));
  const selected = () =>
    run('document.querySelector("[role=tab][aria-selected=true]").dataset.workbenchPage');
  const focused = () => run('document.activeElement.dataset.workbenchPage');
  const tick = () => run('new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))');
  const pages = [
    'browser',
    'files',
    'terminal',
    'chat',
    'activity',
    'review',
    'deliverables',
    'stats',
    'details',
  ];

  assert.deepEqual(
    await run('[...document.querySelectorAll("[role=tab]")].map(tab=>tab.dataset.workbenchPage)'),
    pages,
  );
  assert.equal(await run('!!document.querySelector("select[aria-label=工作面板视图]")'), false);
  assert.equal(await run('document.querySelectorAll("[role=tabpanel]").length'), 9);
  assert.equal(
    await run(`
    [...document.querySelectorAll('[role=tab]')].every(tab => {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      return panel?.getAttribute('role') === 'tabpanel'
        && panel.getAttribute('aria-labelledby') === tab.id
        && panel.dataset.workbenchPanel === tab.dataset.workbenchPage;
    })
  `),
    true,
  );
  console.log('PASS all nine visible tabs have unique, reciprocal panel associations');

  for (const page of pages) {
    await select(page);
    assert.equal(await selected(), page);
    assert.deepEqual(
      await run(`
      [...document.querySelectorAll('[role=tabpanel]')]
        .filter(panel=>panel.getClientRects().length).map(panel=>panel.dataset.workbenchPanel)
    `),
      [page],
    );
    assert.equal(await run('document.querySelectorAll("[role=tab][tabindex=\\"0\\"]").length'), 1);
  }
  console.log('PASS each tab switches the actual visible panel with one keyboard entry point');

  await select('browser');
  await run(`document.querySelector('${tab('browser')}').focus({preventScroll:true})`);
  for (const [pressed, expected] of [
    ['ArrowRight', 'files'],
    ['End', 'details'],
    ['ArrowRight', 'browser'],
    ['ArrowLeft', 'details'],
    ['Home', 'browser'],
  ]) {
    await key(pressed);
    assert.equal(await selected(), expected);
    assert.equal(await focused(), expected);
  }
  console.log('PASS arrows wrap and Home/End automatically activate and focus the intended tab');

  await configure({ width: 280 });
  await tick();
  const before = await run(`(() => {
    document.querySelector('#scroll-frame').scrollTop = 120;
    document.querySelector('#scroll-frame').scrollLeft = 200;
    document.querySelector('#chat-scroll').scrollTop = 180;
    return window.workbenchQA.scrollPositions();
  })()`);
  await key('End');
  await tick();
  assert.deepEqual(await run('window.workbenchQA.scrollPositions()'), before);
  const geometry = await run(`(() => {
    const strip = document.querySelector('[role=tablist]');
    const controls = document.querySelector('.workbench-controls');
    const tab = document.querySelector('[role=tab][aria-selected=true]');
    const viewport = strip.getBoundingClientRect();
    const bounds = tab.getBoundingClientRect();
    return {
      overflow: strip.scrollWidth > strip.clientWidth,
      moved: strip.scrollLeft > 0,
      selectedVisible: bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1,
      controlsClear: viewport.right <= controls.getBoundingClientRect().left,
      controlsContained: controls.getBoundingClientRect().right <= document.querySelector('.workbench').getBoundingClientRect().right,
      controlsInFlow: getComputedStyle(controls).position === 'static',
    };
  })()`);
  assert.deepEqual(geometry, {
    overflow: true,
    moved: true,
    selectedVisible: true,
    controlsClear: true,
    controlsContained: true,
    controlsInFlow: true,
  });
  console.log(
    'PASS a narrow tab strip scrolls locally without moving the chat or covering controls',
  );

  await run('document.querySelector("#chat-input").focus({preventScroll:true})');
  await configure({ page: 'browser' });
  await tick();
  assert.equal(await run('document.activeElement.id'), 'chat-input');
  assert.equal(
    await run(`(() => {
    const strip = document.querySelector('[role=tablist]').getBoundingClientRect();
    const tab = document.querySelector('[role=tab][aria-selected=true]').getBoundingClientRect();
    return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
  })()`),
    true,
  );
  const light = await run(
    'getComputedStyle(document.querySelector("[role=tab][aria-selected=true]")).backgroundColor',
  );
  await configure({ dark: true });
  const dark = await run(
    'getComputedStyle(document.querySelector("[role=tab][aria-selected=true]")).backgroundColor',
  );
  assert.notEqual(light, dark);
  assert.notEqual(dark, 'rgba(0, 0, 0, 0)');
  console.log(
    'PASS external selection reveals the tab without stealing focus and dark tokens apply',
  );

  await click('[aria-label="新建浏览器标签"]');
  await click('[aria-label="新建浏览器标签"]');
  await tick();
  assert.equal(await run('document.querySelectorAll(".browser-tabs > div").length'), 2);
  assert.equal(await run('document.querySelectorAll(".browser-tabs [role=tab]").length'), 0);
  assert.equal(
    await run(`(() => {
    const navigation = document.querySelector('.workbench-navigation').getBoundingClientRect();
    const browser = document.querySelector('.browser-tabs').getBoundingClientRect();
    return browser.top >= navigation.bottom;
  })()`),
    true,
  );
  await select('terminal');
  await select('browser');
  assert.equal(await run('document.querySelectorAll(".browser-tabs > div").length'), 2);
  await configure({ visible: false });
  assert.equal(await run('getComputedStyle(document.querySelector(".workbench")).display'), 'none');
  await configure({ visible: true });
  assert.equal(await selected(), 'browser');
  assert.equal(await run('document.querySelectorAll(".browser-tabs > div").length'), 2);
  console.log('PASS webpage tabs remain separate and survive view switches and panel hiding');

  await select('deliverables');
  assert.equal(await run('document.querySelectorAll(".deliverables-list article").length'), 1);
  await configure({ preview: true });
  assert.equal(await run('!!document.querySelector("#delivery-preview-fixture")'), true);
  assert.equal(await run('!!document.querySelector(".deliverables-list")'), false);
  await click('#preview-increment');
  await select('files');
  await select('deliverables');
  assert.equal(await run('document.querySelector("#preview-count").textContent'), '1');
  await configure({ preview: false });
  assert.equal(await run('!!document.querySelector("#delivery-preview-fixture")'), false);
  assert.equal(await run('document.querySelectorAll(".deliverables-list article").length'), 1);
  console.log('PASS optional delivery preview retains its state and returns to the original list');
}

test(
  '真实 React 工作面板：九视图、键盘、窄栏焦点、浏览器标签与交付预览插槽',
  {
    timeout: 45000,
  },
  async (context) => {
    const temporaryRoot = await realpath(os.tmpdir());
    const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-workbench-tabs-'));
    let child, exited, spawnError;
    try {
      const renderer = await build({
        stdin: {
          resolveDir: repository,
          loader: 'jsx',
          contents: `
          import {StrictMode,useState} from 'react';
          import {createRoot} from 'react-dom/client';
          import {flushSync} from 'react-dom';
          import {Workbench} from './src/Workbench.jsx';
          import './src/styles.css';
          const root=createRoot(document.getElementById('root'));
          const config={page:'browser',visible:true,dark:false,width:320,preview:false};
          function Preview(){const [count,setCount]=useState(0);return <div id="delivery-preview-fixture"><button id="preview-increment" onClick={()=>setCount(value=>value+1)}>预览操作</button><output id="preview-count">{count}</output></div>;}
          const messages=[{id:'reply',role:'assistant',text:'合成产出',deliverables:[{path:'summary.txt'}]}];
          const noop=()=>{};
          function render(){flushSync(()=>root.render(<StrictMode><div className={'app-shell'+(config.dark?' dark':'')}>
            <div id="scroll-frame"><div className="main-columns" style={{'--qa-panel-width':config.width+'px'}}>
              <section id="chat-scroll"><div style={{height:2000}}><input id="chat-input" aria-label="合成聊天输入框"/></div></section>
              <Workbench visible={config.visible} suspended={false} onClose={()=>{config.visible=false;render();}}
                page={config.page} setPage={page=>{config.page=page;render();}}
                context={{sessionId:'qa-workbench'}} scopeKey="qa-workbench" scopeReady={true}
                project={{id:'project',name:'合成项目'}} files={[]} messages={messages} chatTitle="合成聊天"
                liveTrace={[]} attach={noop} openProject={noop} openDeliverable={noop}
                mode="office" privacyMode="redact" sideFiles={[]} sideDraft="" sideChats={[]}
                onSideNew={noop} deliveryPreview={config.preview?<Preview/>:null}/>
            </div></div></div></StrictMode>));}
          window.workbenchQA={
            configure(value){Object.assign(config,value);render();},
            click(selector){const button=document.querySelector(selector);if(!button)throw Error('Missing test control: '+selector);flushSync(()=>button.click());},
            key(key){flushSync(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));},
            scrollPositions(){return {outerTop:document.querySelector('#scroll-frame').scrollTop,outerLeft:document.querySelector('#scroll-frame').scrollLeft,chat:document.querySelector('#chat-scroll').scrollTop,windowX:window.scrollX,windowY:window.scrollY};},
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
        `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>
      #scroll-frame{width:1000px;height:700px;overflow:auto}
      #scroll-frame .main-columns{width:1200px;height:1000px;padding-top:180px}
      #scroll-frame .workbench{width:var(--qa-panel-width);height:500px}
      #chat-scroll{flex:1;height:500px;overflow:auto}
    </style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>`,
      );
      const mainPath = path.join(directory, 'main.cjs');
      await writeFile(
        mainPath,
        `
      const {app,BrowserWindow}=require('electron');
      const path=require('node:path');
      app.setPath('userData',path.join(__dirname,'profile'));
      app.whenReady().then(async()=>{
        const window=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
        try{await window.loadFile(path.join(__dirname,'index.html'));await (${exerciseWindow.toString()})(window);console.log('PASS workbench renderer');app.exit(0);}
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
      assert.match(output, /PASS workbench renderer/);
      assert.equal((output.match(/PASS /g) || []).length, 8, output);
    } finally {
      if (child && child.exitCode === null) {
        child.kill();
        await exited;
      }
      const resolved = await realpath(directory);
      assert.equal(path.dirname(resolved), temporaryRoot);
      assert.ok(path.basename(resolved).startsWith('zhixing-workbench-tabs-'));
      await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  },
);

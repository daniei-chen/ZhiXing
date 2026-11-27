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

// 在真实 Electron renderer 里挂载 Composer，只验证 `@` 文件引用的界面契约：
// 候选出现、键盘选择与插入、Esc 关闭、空态、切聊天关闭、IME 组合不抢键。
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
    await run('window.mentionQA.settle()');
    await run('window.mentionQA.settle()');
  };
  const rows = () => run('window.mentionQA.rows()');
  const value = () => run('window.mentionQA.value()');
  const palette = () => run('window.mentionQA.palette()');
  const calls = () => run('window.mentionQA.calls');
  const type = async (text) => {
    await run(`window.mentionQA.type(${JSON.stringify(text)})`);
    await settle();
  };
  const press = async (key, init = {}) => {
    await run(`window.mentionQA.press(${JSON.stringify(key)}, ${JSON.stringify(init)})`);
    await settle();
  };

  await wait('!!window.mentionReady');
  await wait('!!document.querySelector("textarea[aria-label=\\"聊天输入框\\"]")');

  // 打出 @：候选来自主机列出的工作区索引，一次 @ 只请求一次。
  await type('复核 @');
  assert.equal(await palette(), true, '输入 @ 应当展开候选');
  assert.deepEqual(await rows(), [
    'docs/',
    'src/',
    'docs/带 空格 的名字.md',
    'docs/说明.md',
    'src/App.jsx',
    'src/app.css',
  ]);
  assert.equal(
    (await calls()).filter((call) => call.name === 'list').length,
    1,
    '一次 @ 只向主机要一次索引',
  );
  assert.deepEqual((await calls()).at(-1).scope, {
    workspaceId: 'office',
    projectId: 'qa-project',
    sessionId: 'chat-a',
  });
  await type('复台 @s');
  await type('复核 @sr');
  assert.equal(
    (await calls()).filter((call) => call.name === 'list').length,
    1,
    '继续打字只在本地筛选，不重复列目录',
  );
  console.log('PASS typing @ lists the project workspace once and filters locally');

  // 上下键移动高亮，Enter 插入相对路径并在行尾留一个空格。
  assert.deepEqual(await rows(), ['src/', 'src/App.jsx', 'src/app.css']);
  await press('ArrowDown');
  assert.equal(await run('window.mentionQA.selected()'), 'src/App.jsx');
  await press('Enter');
  assert.equal(await value(), '复核 @src/App.jsx ');
  assert.equal(await palette(), false, '插入后候选关闭');
  assert.equal(await run('window.mentionQA.caret()'), '复核 @src/App.jsx '.length);
  console.log('PASS arrow keys move the highlight and Enter inserts the relative path');

  // 索引只服务一次 @ 记号：插入候选后新打一个 @ 必须重新向主机要索引，
  // 这样交办中新写或删掉的文件不会永远停留在旧列表里。
  const listedBeforeSecond = (await calls()).filter((call) => call.name === 'list').length;
  await type('复核 @src/App.jsx 之后再看 @sr');
  assert.equal(await palette(), true);
  assert.equal(
    (await calls()).filter((call) => call.name === 'list').length,
    listedBeforeSecond + 1,
    '新开一个 @ 记号重新列一次工作区',
  );
  console.log('PASS each new @ refetches the index instead of reusing the old one');

  // 索引还在路上时，逐字输入不能为每个按键重新列一次工作区。
  await run('window.mentionQA.reset()');
  await settle();
  await run('window.mentionQA.deferHost(true)');
  const beforeSlow = (await calls()).filter((call) => call.name === 'list').length;
  await run('window.mentionQA.typeChars("复核 @src")');
  await settle();
  assert.equal(
    (await calls()).filter((call) => call.name === 'list').length,
    beforeSlow + 1,
    '索引未返回时只保留一个在途请求',
  );
  assert.match(await run('window.mentionQA.text(".mention-empty")'), /正在读取项目文件/);
  await run('window.mentionQA.releaseHost()');
  await settle();
  assert.deepEqual(await rows(), ['src/', 'src/App.jsx', 'src/app.css']);
  console.log('PASS a pending index keeps one request even while keys keep coming');

  // 光标停在已有引用中间时补全，不能把原路径的后半截留在草稿里。
  await run('window.mentionQA.reset()');
  await settle();
  await type('复核 @src/App.jsx 的布局');
  assert.equal(await palette(), false, '光标在文本末尾时记号已结束');
  await run('window.mentionQA.setCaret(9)');
  await settle();
  assert.equal(await palette(), true, '光标移进已有引用时重新给出候选');
  await press('Enter');
  assert.equal(await value(), '复核 @src/App.jsx 的布局', '整段记号被替换，没有残留 .jsx');
  console.log('PASS completing inside an existing mention replaces the whole token');

  // Esc 关闭；继续打同一个记号会重新展开；插入后仍可继续编辑。
  await run('window.mentionQA.reset()');
  await settle();
  await type('看看 @sr');
  await press('Escape');
  assert.equal(await palette(), false, 'Esc 关闭候选');
  assert.equal(await value(), '看看 @sr', 'Esc 不改动草稿');
  await type('看看 @src');
  assert.equal(await palette(), true, '记号变了之后重新给出候选');
  await press('Enter');
  assert.equal(await value(), '看看 @src/ ');
  await type('看看 @src/ App.jsx 里的重试');
  assert.equal(await value(), '看看 @src/ App.jsx 里的重试');
  assert.equal(await palette(), false, '记号被空白结束后不再展开');
  console.log('PASS Esc closes without rewriting the draft and the mention stays editable text');

  // 空态：没有匹配与没有项目工作区都给出明确说明。
  await run('window.mentionQA.reset()');
  await settle();
  await type('复核 @zzz');
  assert.equal(await palette(), true);
  assert.deepEqual(await rows(), []);
  assert.match(await run('window.mentionQA.text(".mention-empty")'), /没有匹配的文件/);
  await press('Escape');
  await run('window.mentionQA.reset({workspace:false,entries:[],truncated:false})');
  await settle();
  await type('复核 @src');
  assert.deepEqual(await rows(), []);
  assert.match(await run('window.mentionQA.text(".mention-empty")'), /项目工作区/);
  console.log('PASS no-match and no-workspace each explain themselves');

  // 切聊天后候选关闭，回来再打 @ 重新取一份索引。
  await run('window.mentionQA.reset()');
  await settle();
  await type('复核 @src');
  assert.equal(await palette(), true);
  await run('window.mentionQA.setScope("chat-b")');
  await settle();
  assert.equal(await palette(), false, '切换聊天后候选关闭');
  const beforeSwitch = (await calls()).filter((call) => call.name === 'list').length;
  await run('window.mentionQA.clear()');
  await settle();
  await type('复核 @src');
  assert.equal(await palette(), true);
  assert.equal(
    (await calls()).filter((call) => call.name === 'list').length,
    beforeSwitch + 1,
    '新聊天重新向主机要索引',
  );
  assert.equal((await calls()).at(-1).scope.sessionId, 'chat-b');
  console.log('PASS switching chats closes the candidates and refetches for the new chat');

  // 手写或重发的 @ 一律是纯文本：不让候选改写待发内容，也不重复插入。
  await run('window.mentionQA.reset()');
  await settle();
  await type('把 @src/App.jsx 的重试改成指数退避');
  assert.equal(await palette(), false, '空白之后的 @ 不再是活跃记号');
  await press('Enter');
  const submitted = (await calls()).filter((call) => call.name === 'submit');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].text, '把 @src/App.jsx 的重试改成指数退避');
  assert.equal(
    (submitted[0].text.match(/@/g) || []).length,
    1,
    '提交内容里只有一个 @ 记号，不叠加',
  );
  console.log('PASS an @ typed by hand or resent is submitted verbatim');

  // 中文输入法组合期间不抢方向键与回车。
  await run('window.mentionQA.reset()');
  await settle();
  const submitsBefore = (await calls()).filter((call) => call.name === 'submit').length;
  await type('复核 @sr');
  assert.equal(await run('window.mentionQA.selected()'), 'src/');
  await press('ArrowDown', { isComposing: true });
  assert.equal(await run('window.mentionQA.selected()'), 'src/', '组合期间方向键不移动高亮');
  await press('Enter', { isComposing: true });
  assert.equal(await value(), '复核 @sr', '组合期间回车不插入');
  assert.equal(
    (await calls()).filter((call) => call.name === 'submit').length,
    submitsBefore,
    '组合期间回车也不提交',
  );
  assert.equal(await palette(), true, '组合结束后候选仍在');
  console.log('PASS IME composition never takes the arrow or Enter keys');
}

test(
  '@ 文件引用：真实 renderer 里的候选、键盘、空态与切聊天',
  { timeout: 45000 },
  async (context) => {
    const temporaryRoot = await realpath(os.tmpdir());
    const directory = await mkdtemp(path.join(temporaryRoot, 'zhixing-composer-mention-'));
    let child;
    let exited;
    let spawnError;
    try {
      const renderer = await build({
        entryPoints: [path.join(repository, 'tests/fixtures/composer-mention.jsx')],
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
      assert.equal((output.match(/PASS /g) || []).length, 10, output);
    } finally {
      if (child && child.exitCode === null) {
        child.kill();
        await exited;
      }
      const resolved = await realpath(directory);
      assert.equal(path.dirname(resolved), temporaryRoot);
      assert.ok(path.basename(resolved).startsWith('zhixing-composer-mention-'));
      await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  },
);

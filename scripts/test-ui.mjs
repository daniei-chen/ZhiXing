import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { connectUi } from './qa-cdp.mjs';
import { selectWorkbenchTab } from './qa-workbench.mjs';

// Run against an isolated source or packaged Windows renderer started with a
// loopback remote-debugging port. No renderer or IPC implementations are mocked.
const ui = await connectUi(Number(process.env.ZHIXING_QA_PORT || 9333));
const evidence = path.resolve(process.env.ZHIXING_QA_EVIDENCE || '.preview/qa-0.11.0/ui-evidence');
const records = [];
const phase = process.argv[2] || 'drafts';
await mkdir(evidence, { recursive: true });
const inputSelector = 'textarea[aria-label="聊天输入框"]';
const inputValue = () => ui.evaluate(`document.querySelector(${JSON.stringify(inputSelector)})?.value`);
async function record(name, details) {
  records.push({ name, time: new Date().toISOString(), status: 'passed', details });
  await writeFile(path.join(evidence, `${phase}.json`), JSON.stringify(records, null, 2));
  console.log(`PASS ${name}`);
}
async function home() {
  if (await ui.evaluate('!!document.querySelector(".settings-page")')) await ui.click('返回工作台');
  await ensureNav();
  await ui.click('首页', '.app-rail button');
  await ensureNav();
  await ui.waitFor('!!document.querySelector(".workspace-nav .new-chat")?.getClientRects().length&&!!document.querySelector("textarea[aria-label=聊天输入框]")');
}
async function ensureNav() {
  if (await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")')) {
    await ui.click('展开侧栏');
    await ui.waitFor('!!document.querySelector("button[aria-label=收起侧栏]")?.getClientRects().length');
  }
}
async function settings(tab) {
  if (!await ui.evaluate('!!document.querySelector(".settings-page")')) { await ensureNav(); await ui.click('打开设置'); }
  await ui.click(tab, '.settings-nav button');
}
async function clickOne(selector) {
  const name = await ui.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');return e.getAttribute('aria-label')||e.textContent.trim();})()`);
  await ui.click(name, selector);
}
const serviceState = () => fetch('http://127.0.0.1:43123/__qa/state').then(response => response.json());
async function checkMcp(success = true) {
  await ui.click('检查连接与工具');
  await ui.waitFor(`document.querySelector('.setting-notice')?.textContent.includes(${JSON.stringify(success ? '工具发现完成' : '连接失败')})`, 45000);
}
async function newProject(name) {
  await ui.click('新建项目');
  await ui.fill('.modal input[placeholder="输入名称"]', name);
  await ui.click('保存', '.modal button');
  await ui.waitFor(`document.body.innerText.includes(${JSON.stringify(name)}) && !document.querySelector('.modal')`);
}
try {
  await ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"');
  if (phase === 'drafts') {
    await home();
    const homeDraft = '首页草稿验收，仅合成资料。';
    await ui.fill(inputSelector, homeDraft);
    for (const page of ['资料空间', '定时任务', '自定义']) {
      await ui.click(page, '.app-rail button');
      await home();
      assert.equal(await inputValue(), homeDraft, `${page} navigation`);
      await record(`草稿往返 ${page}`, { text: homeDraft });
    }
    await settings('供应商');
    await ui.click('返回工作台');
    assert.equal(await inputValue(), homeDraft);
    await record('草稿往返 设置');
    for (const suffix of ['甲', '乙', '丙']) {
      const name = `验收项目${suffix}`;
      if (!await ui.evaluate(`[...document.querySelectorAll('.project-name')].some(e=>e.textContent.trim()===${JSON.stringify(name)})`)) await newProject(name);
      else await ui.click(name, '.project-name');
      await ui.fill(inputSelector, `${name}的独立中文草稿`);
    }
    for (const suffix of ['甲', '乙', '丙', '甲', '丙', '乙']) {
      const name = `验收项目${suffix}`;
      await ui.click(name, '.project-name');
      assert.equal(await inputValue(), `${name}的独立中文草稿`);
    }
    await record('三项目草稿隔离与往返');
    await ui.click('切换工作模式，当前办公');
    await ui.click('政务', '.mode-dropdown strong');
    await ui.fill(inputSelector, '政务模式的独立草稿');
    await ui.click('切换工作模式，当前政务');
    await ui.click('办公', '.mode-dropdown strong');
    assert.equal(await inputValue(), homeDraft);
    await record('办公政务草稿隔离');
    await ui.click('验收项目乙', '.project-name');
    await ui.fill(inputSelector, '验收项目乙的独立中文草稿 · 重启恢复');
    if (!await ui.evaluate("document.querySelector('.attachment-chips')?.textContent.includes('草稿材料.txt')")) {
      await ui.evaluate(`(() => {const data=new DataTransfer();data.items.add(new File(['合成附件来源，数值 123.45，编号 00123。'],'草稿材料.txt',{type:'text/plain'}));document.querySelector('.composer').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));})()`);
      await ui.waitFor("!!document.querySelector('.attachment-chip:not(.invalid)')");
    }
    await ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"');
    await ui.send('Page.reload');
    await ui.waitFor(`document.querySelector(${JSON.stringify(inputSelector)})?.value==='验收项目乙的独立中文草稿 · 重启恢复'`);
    await record('重启渲染页面恢复最近草稿作用域');
    assert(await ui.evaluate("document.querySelector('.attachment-name')?.textContent.includes('草稿材料.txt')"));
    await clickOne('.attachment-name[title="草稿材料.txt"]');
    await ui.waitFor("document.querySelector('.modal')?.textContent.includes('合成附件来源')");
    await ui.click('关闭对话框');
    await record('附件提取内容随草稿恢复');
    await ui.screenshot(path.join(evidence, 'draft-restored.png'));
    const short = '短输入';
    await ui.fill(inputSelector, short);
    const shortHeight = await ui.evaluate('document.querySelector(".composer").getBoundingClientRect().height');
    await ui.fill(inputSelector, Array.from({ length: 25 }, (_, i) => `第${i + 1}行 中文长输入换行验收，保留底部操作按钮。`).join('\n'));
    const long = await ui.evaluate('(() => {const e=document.querySelector("textarea[aria-label=聊天输入框]");return {height:document.querySelector(".composer").getBoundingClientRect().height,client:e.clientHeight,scroll:e.scrollHeight};})()');
    assert(long.height > shortHeight);
    assert(long.scroll > long.client);
    await ui.screenshot(path.join(evidence, 'composer-long.png'));
    await ui.fill(inputSelector, short);
    assert.equal(await ui.evaluate('document.querySelector(".composer").getBoundingClientRect().height'), shortHeight);
    await record('中文输入短长短回缩', { shortHeight, long });
  } else if (phase === 'workflows') {
    await home();
    await settings('供应商');
    if (!await ui.evaluate("document.querySelector('.provider-list')?.textContent.includes('Windows 本机验收')")) {
      await ui.click('自定义', '.provider-presets button');
      await ui.fill('input[placeholder="例如，公司模型网关"]', 'Windows 本机验收');
      await ui.fill('input[placeholder="https://api.example.com/v1"]', 'http://127.0.0.1:43123/v1');
      await ui.fill('input[type="password"]', 'zhixing-qa-model');
      await ui.click('高级设置');
      await ui.fill('select[aria-label="思考参数"]', 'standard');
      await ui.click('拉取模型并保存');
      await ui.waitFor("document.querySelector('.setting-notice')?.textContent.includes('模型已更新')");
    }
    await record('供应商 UI 目录发现与加密保存');
    await settings('MCP 连接');
    const already = await ui.evaluate("document.querySelector('.settings-card')?.textContent.includes('qa')");
    await ui.click(already ? '编辑 MCP qa' : '添加 MCP 服务');
    if (!already) await ui.fill('input[aria-label="MCP 服务名称"]', 'qa');
    await ui.fill('.mcp-form select', 'streamable-http');
    await ui.fill('input[aria-label="MCP 服务地址"]', 'http://127.0.0.1:43121/mcp');
    await ui.fill('textarea[aria-label="MCP 凭据"]', '{"Authorization":"Bearer zhixing-qa-mcp-a"}');
    await ui.click('保存连接');
    await checkMcp();
    let receipts = (await serviceState()).records;
    assert(receipts.some(row => row.destination === 'a' && row.authorization === 'Bearer zhixing-qa-mcp-a' && row.method === 'tools/list'));
    await record('MCP A 真实工具发现');
    await ui.click('编辑 MCP qa');
    await ui.fill('input[aria-label="MCP 服务地址"]', 'http://127.0.0.1:43122/mcp');
    await ui.click('保存连接');
    assert.equal(await ui.evaluate(`document.querySelector('textarea[aria-label="MCP 凭据"]').checkValidity()`), false);
    assert.equal((await ui.evaluate('window.zhixing.listMcp()'))[0].url, 'http://127.0.0.1:43121/mcp');
    await ui.screenshot(path.join(evidence, 'mcp-destination-reentry.png'));
    await record('MCP A 改 B 空凭据阻止提交');
    await ui.fill('textarea[aria-label="MCP 凭据"]', '{}');
    await ui.click('保存连接');
    await checkMcp(false);
    receipts = (await serviceState()).records;
    assert(receipts.some(row => row.destination === 'b' && row.authorization === null));
    assert(!receipts.some(row => row.destination === 'b' && row.authorization === 'Bearer zhixing-qa-mcp-a'));
    await record('MCP B 显式空凭据不接收 A 秘密');
    await ui.click('编辑 MCP qa');
    await ui.fill('textarea[aria-label="MCP 凭据"]', '{"Authorization":"Bearer zhixing-qa-mcp-b"}');
    await ui.click('保存连接');
    await checkMcp();
    await ui.click('启用 qa');
    await ui.waitFor(`document.querySelector('[aria-label="启用 qa"]')?.getAttribute('aria-checked')==='false'`);
    await ui.click('启用 qa');
    await checkMcp();
    receipts = (await serviceState()).records;
    assert(receipts.some(row => row.destination === 'b' && row.authorization === 'Bearer zhixing-qa-mcp-b' && row.method === 'tools/list'));
    assert(!receipts.some(row => row.destination === 'b' && row.authorization === 'Bearer zhixing-qa-mcp-a'));
    await record('MCP B 新凭据与禁用启用保留');
    await ui.screenshot(path.join(evidence, 'mcp-b-connected.png'));
    await ui.click('返回工作台');
    await ui.click('新聊天', '.new-chat');
    await clickOne('.model-trigger');
    await clickOne('.effort-model-link');
    await clickOne('.model-picker-option[title="zhixing-qa"]');
    await clickOne('.model-trigger');
    await ui.fill('input[type="range"]', '2');
    await ui.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await ui.fill(inputSelector, 'QA_NORMAL 再次执行验收，保留原回答。');
    await ui.click('发送消息');
    await ui.waitFor('document.querySelectorAll(".assistant-message").length===1 && !!document.querySelector("button[aria-label=再次执行]:not(:disabled)")', 45000);
    const firstAnswer = await ui.evaluate('document.querySelector(".assistant-message").innerText');
    assert(firstAnswer.includes('QA_NORMAL_RESPONSE'));
    await ui.click('再次执行');
    await ui.waitFor('document.querySelectorAll(".assistant-message").length===2 && !!document.querySelector("button[aria-label=再次执行]:not(:disabled)")', 45000);
    assert.equal(await ui.evaluate('document.querySelectorAll(".user-message").length'), 2);
    assert.equal(await ui.evaluate('document.querySelector(".assistant-message").innerText'), firstAnswer);
    const modelRequests = (await serviceState()).records.filter(row => row.service === 'model' && row.event === 'request');
    assert(modelRequests.at(-1).body.messages.some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('QA_NORMAL_RESPONSE')));
    assert.equal(modelRequests.at(-1).body.model, 'zhixing-qa');
    assert.equal(modelRequests.at(-1).body.reasoning_effort, 'high');
    await record('再次执行保留 UI 与实际模型历史', { requests: modelRequests.length });
    await ui.screenshot(path.join(evidence, 'repeat-history.png'));
    await ui.fill(inputSelector, 'QA_LONG 停止验收，保留已经生成的正文。');
    const sequence = (await serviceState()).sequence;
    await ui.click('发送消息');
    const until = Date.now() + 45000;
    let firstChunk;
    while (Date.now() < until && !firstChunk) {
      firstChunk = (await serviceState()).records.find(row => row.sequence > sequence && row.service === 'model' && row.event === 'first-chunk');
      if (!firstChunk) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(firstChunk, 'Synthetic provider must deliver a prefix before cancellation');
    await ui.click('停止生成');
    await ui.waitFor('!document.querySelector("button[aria-label=停止生成]") && document.querySelectorAll(".assistant-message").length===3', 30000);
    const stoppedText = await ui.evaluate('[...document.querySelectorAll(".assistant-message")].at(-1).innerText');
    assert(stoppedText.includes('QA_LONG_CHUNK'), 'Interrupted provider prefix must survive stop');
    assert((await serviceState()).records.some(row => row.event === 'aborted' && row.requestNumber === firstChunk.requestNumber));
    await record('流式首段后停止并保留正文', { requestNumber: firstChunk.requestNumber });
    await ui.screenshot(path.join(evidence, 'stopped-prefix.png'));
    await ui.fill(inputSelector, '当前聊天未发送草稿，供安装与重启保留验收。');
    await ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"');
  } else if (phase === 'recovery') {
    await home();
    await ui.fill(inputSelector, 'QA_ERROR 发送失败时保留这份中文草稿');
    await ui.click('发送消息');
    await ui.waitFor('!document.querySelector("button[aria-label=停止生成]") && document.querySelector(".assistant-message.error-message")', 45000);
    await home();
    assert.equal(await inputValue(), 'QA_ERROR 发送失败时保留这份中文草稿');
    await record('模型请求失败恢复已提交草稿');
    const main = await connectUi(Number(process.env.ZHIXING_QA_MAIN_PORT || 9334), true);
    let lock;
    try {
      const profile = await main.evaluate("process.mainModule.require('electron').app.getPath('userData')");
      assert(path.resolve(profile).startsWith(path.resolve('.preview/qa-0.11.0') + path.sep));
      const file = path.join(profile, 'zhixing', 'workspace.bin');
      const command = `$stream=[IO.File]::Open('${file.replaceAll("'", "''")}','Open','Read','None');[Console]::Out.WriteLine('LOCKED');[Console]::Out.Flush();[Console]::ReadLine()|Out-Null;$stream.Dispose()`;
      lock = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => lock.kill(), 45000);
      try {
        await new Promise((resolve, reject) => {
          lock.stdout.on('data', chunk => { if (chunk.toString().includes('LOCKED')) resolve(); });
          lock.once('exit', code => reject(new Error(`File lock exited early ${code}`)));
          lock.once('error', reject);
        });
        await ui.fill(inputSelector, '工作空间写入失败仍应保留，释放文件后重试保存。');
        await ui.waitFor('!!document.querySelector(".workspace-save-banner.failed")');
        await new Promise(resolve => setTimeout(resolve, 4500));
        assert(await ui.evaluate('!!document.querySelector(".workspace-save-banner.failed button")'));
        await ui.screenshot(path.join(evidence, 'save-failure-visible.png'));
        await record('真实 Windows 文件占用保存失败持续可见');
        lock.stdin.end('release\n');
        await once(lock, 'exit');
        await ui.click('重试保存');
        await ui.waitFor('!!document.querySelector(".workspace-save-banner.saved")');
        assert.equal(await inputValue(), '工作空间写入失败仍应保留，释放文件后重试保存。');
        const saved = await ui.evaluate('window.zhixing.loadWorkspace()');
        assert(Object.values(saved.drafts).some(draft => draft.text === '工作空间写入失败仍应保留，释放文件后重试保存。'));
        await record('释放占用后重试保存落盘');
      } finally { clearTimeout(timer); lock.stdin.end(); if (lock.exitCode === null) lock.kill(); }
      await ui.click('新建项目');
      await ui.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await ui.waitFor('!document.querySelector(".modal")');
      assert.equal(await ui.evaluate('document.activeElement?.getAttribute("aria-label")'), '新建项目');
      await ui.click('新建项目');
      await ui.click('关闭对话框');
      await ui.waitFor('!document.querySelector(".modal")');
      assert.equal(await ui.evaluate('document.activeElement?.getAttribute("aria-label")'), '新建项目');
      await record('弹窗 Escape 与关闭按钮返回焦点');
      if (!await ui.evaluate('!!document.querySelector(".workbench:not([hidden])")')) await ui.click('打开工作面板');
      await selectWorkbenchTab(ui, 'browser');
      if (await ui.evaluate('!!document.querySelector("input[aria-label=新标签页网址]")')) {
        await ui.fill('input[aria-label="新标签页网址"]', 'http://127.0.0.1:43123/__qa/health');
        await ui.click('前往网址');
      }
      await main.waitFor("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].contentView.children.length===1");
      await settings('MCP 连接');
      await main.waitFor("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].contentView.children.length===0");
      await ui.screenshot(path.join(evidence, 'native-browser-settings-occlusion.png'));
      await record('原生浏览器在设置页自动隐藏');
      await ui.click('返回工作台');
      await main.waitFor("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].contentView.children.length===1");
      await ensureNav();
      await ui.click('新建项目');
      await main.waitFor("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].contentView.children.length===0");
      await ui.click('关闭对话框');
      await ui.click('收起工作面板');
      await record('原生浏览器在弹窗中隐藏并恢复');
      await settings('外观');
      await ui.click('浅色', '.theme-choices button');
      await ui.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await ui.waitFor("document.querySelector('.theme-choices [aria-checked=true]')?.textContent==='深色'");
      assert.equal(await ui.evaluate('document.activeElement?.getAttribute("aria-checked")'), 'true');
      await ui.click('浅色', '.theme-choices button');
      await ui.click('返回工作台');
      await record('外观方向键切换并保持焦点');
    } finally { main.close(); }
  } else if (phase === 'sidebar') {
    const main = await connectUi(Number(process.env.ZHIXING_QA_MAIN_PORT || 9334), true);
    try {
      await home();
      const state = await ui.evaluate('window.zhixing.loadWorkspace()');
      const now = Date.now();
      state.workspaceId = 'office-home';
      state.workspaces = state.workspaces.map(item => item.id === 'office-home' ? {...item, projectId: 'qa-sidebar-a'} : item);
      state.projects = [...state.projects.filter(item => item.workspaceId !== 'office-home'),
        {id:'qa-sidebar-a',workspaceId:'office-home',name:'产品周报',expanded:true},
        {id:'qa-sidebar-b',workspaceId:'office-home',name:'客户回访',expanded:true},
        {id:'qa-sidebar-c',workspaceId:'office-home',name:'资料整理',expanded:false},
      ];
      state.chats = [
        {id:'qa-sidebar-pin',workspaceId:'office-home',projectId:null,title:'本周工作重点',pinned:true,createdAt:now,updatedAt:now,messages:[]},
        {id:'qa-sidebar-chat-a',workspaceId:'office-home',projectId:'qa-sidebar-a',title:'月度数据核对',createdAt:now,updatedAt:now,messages:[]},
        {id:'qa-sidebar-chat-b',workspaceId:'office-home',projectId:'qa-sidebar-b',title:'会议纪要整理',createdAt:now-1000,updatedAt:now-1000,messages:[]},
        {id:'qa-sidebar-chat-home',workspaceId:'office-home',projectId:null,title:'临时问题记录',createdAt:now-2000,updatedAt:now-2000,messages:[]},
      ];
      await ui.evaluate(`window.zhixing.saveWorkspace(${JSON.stringify(state)})`);
      await ui.send('Page.reload');
      await ui.waitFor('document.querySelectorAll(".project-name").length===3 && document.querySelectorAll(".chat-row").length>=6');
      const matrix = [];
      for (const zoom of [1, 1.25, 1.5, 2]) {
        await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${zoom})`);
        for (const [width, height] of [[1255, 912], [1366, 768], [1920, 1080]]) {
          await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].setBounds({x:0,y:0,width:${width},height:${height}})`);
          await ui.waitFor('document.querySelectorAll(".project-name").length===3');
          const projectToggle = await ui.evaluate('[...document.querySelectorAll(".project-name")].find(item=>item.textContent.includes("客户回访"))?.closest(".project-group")?.querySelector(".project-expand")?.getAttribute("aria-expanded")');
          if (projectToggle === 'true') await ui.click('收起 客户回访', '.project-expand');
          assert.equal(await ui.evaluate('[...document.querySelectorAll(".project-name")].find(item=>item.textContent.includes("客户回访"))?.closest(".project-group")?.querySelector(".project-expand")?.getAttribute("aria-expanded")'), 'false');
          await ui.click('展开 客户回访', '.project-expand');
          assert.equal(await ui.evaluate('[...document.querySelectorAll(".project-name")].find(item=>item.textContent.includes("客户回访"))?.closest(".project-group")?.querySelector(".project-expand")?.getAttribute("aria-expanded")'), 'true');
          await ui.click('客户回访', '.project-name');
          await ui.waitFor('document.querySelector(".main-topbar")?.innerText.includes("客户回访")');
          await ensureNav();
          await ui.waitFor('[...document.querySelectorAll(".project-row")].find(item=>item.textContent.includes("客户回访"))?.classList.contains("selected")');
          assert.equal(await ui.evaluate('[...document.querySelectorAll(".project-row")].find(item=>item.textContent.includes("客户回访"))?.classList.contains("selected")'), true);
          await ui.click('筛选最近聊天');
          await ui.click('项目聊天', '.chat-filter-dropdown button');
          assert.equal(await ui.evaluate('document.getElementById(document.querySelector(".sidebar-section-toggle").getAttribute("aria-controls")).innerText.includes("临时问题记录")'), false);
          assert.equal(await ui.evaluate('document.getElementById(document.querySelector(".sidebar-section-toggle").getAttribute("aria-controls")).innerText.includes("月度数据核对")'), true);
          await ui.click('筛选最近聊天');
          await ui.click('全部聊天', '.chat-filter-dropdown button');
          const metrics = await ui.evaluate('({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,rail:document.querySelector(".app-rail").getBoundingClientRect().width,sidebar:document.querySelector(".sidebar").getBoundingClientRect().width,projectOrder:[...document.querySelectorAll(".project-name")].map(item=>item.textContent.trim()),pinnedFirst:document.querySelector(".sidebar-scroll")?.firstElementChild?.classList.contains("pinned-chats"),recentVisible:!!document.querySelector(".sidebar-section-toggle")})');
          assert.equal(metrics.overflow, false, `${width}x${height} at ${zoom * 100}% document overflow`);
          assert.equal(metrics.rail, 46);
          assert.equal(metrics.sidebar, metrics.width <= 700 ? Math.min(308, metrics.width * 0.9) : metrics.width <= 1100 ? 282 : 302);
          assert.deepEqual(metrics.projectOrder, ['产品周报','客户回访','资料整理']);
          assert.equal(metrics.pinnedFirst, true);
          assert.equal(metrics.recentVisible, true);
          if ((width === 1255 && zoom === 1) || (width === 1366 && zoom === 1.25) || (width === 1920 && zoom === 1.5) || (width === 1255 && zoom === 2)) {
            await ui.screenshot(path.join(evidence, `sidebar-${width}x${height}-${zoom * 100}pct.png`));
          }
          matrix.push({zoom, ...metrics});
        }
      }
      await record('侧栏分组、置顶、项目展开、最近聊天筛选和选中态', matrix);
    } finally {
      await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)").catch(()=>{});
      main.close();
    }
  } else if (phase === 'updates') {
    await home();
    await settings('关于知行');
    await ui.screenshot(path.join(evidence, 'updates-about-before-check.png'));
    await ui.click('检查知行更新');
    await ui.waitFor('!!document.querySelector(".desktop-release-result, .about-settings [role=alert]")', 30000);
    const result = await ui.evaluate('({status:document.querySelector(".desktop-release-result")?.innerText||document.querySelector(".about-settings [role=alert]")?.innerText,button:document.querySelector(".about-settings button")?.textContent,disabled:document.querySelector(".about-settings button")?.disabled})');
    assert(result.status, 'The update check must show a result or a recoverable error.');
    assert.equal(result.button, '检查知行更新');
    assert.equal(result.disabled, false);
    await ui.screenshot(path.join(evidence, 'updates-about-after-check.png'));
    await record('关于页手动检查 GitHub 发行信息', result);
  } else if (phase === 'pages') {
    const main = await connectUi(Number(process.env.ZHIXING_QA_MAIN_PORT || 9334), true);
    try {
    // A minimized native window has no guaranteed compositor surface for CDP
    // screenshots. Restore only this isolated QA window, without taking focus.
    await main.evaluate('(() => {const w=process.mainModule.require("electron").BrowserWindow.getAllWindows()[0];if(w.isMinimized())w.restore();w.showInactive();return !w.isMinimized();})()');
    for (const zoom of [1, 1.25, 1.5, 2]) {
    await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${zoom})`);
    for (const [width, height] of [[1255, 912], [1366, 768], [1920, 1080]]) {
      await main.evaluate(`(() => {const w=process.mainModule.require('electron').BrowserWindow.getAllWindows()[0];if(w.isMinimized())w.restore();w.showInactive();w.setBounds({x:0,y:0,width:${width},height:${height}});})()`);
      const sizeLabel = `${width}x${height}-${zoom * 100}pct`;
      for (const page of ['首页', '资料空间', '定时任务', '自定义']) {
        await home();
        if (page !== '首页') { await ensureNav(); await ui.click(page, '.app-rail button'); }
        const screenshot = await ui.screenshot(path.join(evidence, `${sizeLabel}-${page}.png`));
        const metrics = await ui.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth+1})');
        assert.equal(metrics.overflow, false, `${width} ${page} document overflow`);
        await record(`${width}×${height} ${zoom * 100}% ${page}`, { ...metrics, screenshot: screenshot.status, ...(screenshot.error ? { screenshotError: screenshot.error } : {}) });
      }
      for (const tab of ['常规', '通知', '外观', '已归档的聊天', '语音', '个性化', '键盘快捷键', '隐私与数据', '项目与工作区', '供应商', 'MCP 连接', 'Agent 内核', '权限与工具', '关于知行']) {
        await settings(tab);
        const screenshot = await ui.screenshot(path.join(evidence, `${sizeLabel}-设置-${tab}.png`));
        const metrics = await ui.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth+1,contentWidth:document.querySelector(".settings-page").getBoundingClientRect().width})');
        assert.equal(metrics.overflow, false, `${width} settings ${tab} overflow`);
        await record(`${width}×${height} ${zoom * 100}% 设置 ${tab}`, { ...metrics, screenshot: screenshot.status, ...(screenshot.error ? { screenshotError: screenshot.error } : {}) });
      }
      await home();
      await ensureNav();
      await ui.click('新聊天', '.new-chat');
      await ui.waitFor('document.querySelectorAll(".top-actions .icon-button").length===3');
      await ui.click('会话操作');
      assert(await ui.evaluate('document.querySelector(".session-actions-menu")?.innerText.includes("保存会话")'));
      assert(await ui.evaluate('document.querySelector(".session-actions-menu")?.innerText.includes("复制为文件")'));
      await ui.click('保存会话', '.session-actions-menu button');
      await ui.waitFor('document.body.innerText.includes("当前会话已保存")');
      if (await ui.evaluate('!!document.querySelector(".toast-dismiss")')) await clickOne('.toast-dismiss');
      await ui.waitFor('!document.querySelector(".toast")');
      await record('会话顶栏三入口与会话操作菜单');
      await ui.click('查看当前对话产出与来源');
      await ui.waitFor('!!document.querySelector(".conversation-resources")');
      assert(await ui.evaluate('document.querySelector(".conversation-resources")?.innerText.includes("本对话暂无已记录的文件产出")'));
      assert(await ui.evaluate('document.querySelector(".conversation-resources")?.innerText.includes("来源")'));
      await ui.screenshot(path.join(evidence, 'conversation-deliverables-empty.png'));
      await record('当前对话产出来源浮层可达');
      await ui.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      assert.equal(await ui.evaluate('document.activeElement?.getAttribute("aria-label")'),'查看当前对话产出与来源');
      assert.equal(await ui.evaluate('document.querySelector(".workspace-save-banner.saved")?.getClientRects().length'),0);
      if (!await ui.evaluate('!!document.querySelector(".workbench:not([hidden])")')) await ui.click('打开工作面板');
      for (const [id, label] of [['browser', '浏览器'], ['files', '文件'], ['terminal', '终端'], ['chat', '侧边聊天'], ['activity', '执行'], ['deliverables', '产出'], ['stats', '统计'], ['details', '详情']]) {
        await selectWorkbenchTab(ui, id);
        await ui.screenshot(path.join(evidence, `${sizeLabel}-面板-${label}.png`));
        await record(`${width}×${height} ${zoom * 100}% 面板 ${label}`, await ui.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})'));
      }
      await ui.click('收起工作面板');
    }
    }
    } finally { await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)").catch(()=>{}); main.close(); }
  } else throw new Error(`Unknown phase ${phase}`);
} catch (error) {
  records.push({ name: phase, status: 'failed', error: error.stack, time: new Date().toISOString() });
  await ui.screenshot(path.join(evidence, `${phase}-failure.png`)).catch(() => {});
  await writeFile(path.join(evidence, `${phase}.json`), JSON.stringify(records, null, 2));
  throw error;
} finally { ui.close(); }



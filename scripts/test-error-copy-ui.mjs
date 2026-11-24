import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {connectUi} from './qa-cdp.mjs';

// Windows 实包验收：用真实失败的请求，检查「设置 · 供应商」界面到底显示哪句话。
// 三个真实故障（真实 401、真实连接拒绝、真实超时）+ 一个本机可得到的域名失败。
// 断言分两段：主进程错误里是否保留了系统错误码，界面是否把它换成了可行动的文案。
const exe=path.resolve(process.argv[2]||'release/win-unpacked/知行.exe');
const appDir=path.join(path.dirname(exe),'resources','app');
const provenance=JSON.parse(await fs.readFile(path.join(appDir,'build-provenance.json'),'utf8'));
const evidenceRoot=path.resolve(process.env.ZHIXING_QA_EVIDENCE||`.preview/qa-${provenance.version}/error-copy-ui`);
await fs.mkdir(evidenceRoot,{recursive:true});
const evidence=await fs.mkdtemp(path.join(evidenceRoot,'run-'));
const profile=path.join(evidence,'profile');
await fs.mkdir(profile,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={layer:'windows-packaged-app',version:provenance.version,sourceCommit:provenance.sourceCommit,
 sourceDirty:provenance.sourceDirty,exeSha256:hash(await fs.readFile(exe)),status:'running',cases:[],exits:[]};
const reportFile=path.join(evidence,'result.json');
const persist=()=>fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
async function record(name,details={}){report.cases.push({name,status:'passed',...details});await persist();console.log(`PASS ${name}`);}
console.log(`Evidence: ${evidence}`);

// 界面文案与 src/error-copy.js 的映射表一一对应；测试侧重写一遍是为了在
// 界面出现新句子时立刻失败，而不是把新句子当成既有行为接受下来。
const COPY={
 ENOTFOUND:'解析不到服务地址，请检查网络连接或代理设置。',
 EAI_AGAIN:'解析不到服务地址，请检查网络连接或代理设置。',
 ECONNREFUSED:'服务地址拒绝连接，请确认地址和端口是否正确。',
 ECONNRESET:'连接被中途断开，请检查网络后重试。',
 TIMEOUT:'请求超时，请检查网络后重试。',
 HTTP_401:'API Key 无效或已过期，请在「设置 · 供应商」中更新后重试。',
};

// 连接会挂起但永不响应，用来触发 fetchModels 的 12 秒超时。
const hang=http.createServer(()=>{});
hang.listen(0,'127.0.0.1');await once(hang,'listening');
const hangUrl=`http://127.0.0.1:${hang.address().port}/v1`;
// 先占一个端口再关掉，得到一个确定没人监听的端口。
const closed=http.createServer(()=>{});
closed.listen(0,'127.0.0.1');await once(closed,'listening');
const closedUrl=`http://127.0.0.1:${closed.address().port}/v1`;
closed.closeAllConnections();await new Promise(resolve=>closed.close(resolve));
const nonexistent=`https://qa-error-copy-${Date.now().toString(36)}.invalid/v1`;
const fakeKey='sk-qa-error-copy-0000000000000000';

let ui,main,child,exit,log;
const input='textarea[aria-label="聊天输入框"]';
const notice='.setting-notice[role=alert]';
let nameSeq=0;
async function launch(){
 const logfile=path.join(evidence,`app-${report.exits.length}.log`);
 log=await fs.open(logfile,'a');
 const portsFile=path.join(profile,'DevToolsActivePort');await fs.rm(portsFile,{force:true});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_PATH;delete env.NODE_OPTIONS;
 child=spawn(exe,[`--user-data-dir=${profile}`,'--inspect=127.0.0.1:0','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'],
  {cwd:evidence,env,stdio:['ignore',log.fd,log.fd],windowsHide:true});
 exit=once(child,'close');
 const deadline=Date.now()+45000;
 while((!ui||!main)&&Date.now()<deadline){
  if(child.exitCode!==null)throw new Error(`Packaged app exited at launch (${child.exitCode})`);
  if(!ui){const ports=await fs.readFile(portsFile,'utf8').catch(()=>null);if(ports)ui=await connectUi(Number(ports.split('\n')[0])).catch(()=>null);}
  if(!main){const port=(await fs.readFile(logfile,'utf8')).match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];if(port)main=await connectUi(Number(port),true).catch(()=>null);}
  if(!ui||!main)await pause(100);
 }
 assert(ui&&main,'Windows renderer and main-process test connection both started');
 const activeProfile=await main.evaluate("process.mainModule.require('electron').app.getPath('userData')");
 assert.equal(path.resolve(activeProfile),path.resolve(profile));
 await ui.waitFor(`!!document.querySelector(${JSON.stringify(input)})&&!document.querySelector(${JSON.stringify(input)}).disabled`,45000);
 // 记录界面上真正交给用户的那次 IPC 原始错误，不改写任何返回值。
 await ui.evaluate(`(()=>{const api=window.zhixing;const original=api.saveProvider.bind(api);window.__qaRaw=null;
  api.saveProvider=async(...args)=>{try{return await original(...args);}catch(error){window.__qaRaw=String(error&&error.message||error);throw error;}};return true;})()`);
}
async function openFeature(){
 if(await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")'))await ui.click('展开侧栏');
 if(!await ui.evaluate('!!document.querySelector(".settings-page")'))await ui.click('打开设置');
 await ui.click('供应商','.settings-nav button');
 if(await ui.evaluate('!!document.querySelector(".provider-back")'))await ui.click('所有供应商','.provider-back');
 await ui.click('自定义','.provider-preset');
 await ui.waitFor('!!document.querySelector(".connection-form input[type=password]")');
}
// 主进程里对同一地址发一次一样的请求，确认这台机器上真实的错误码。
async function probe(url,headers={}){
 return main.evaluate(`fetch(${JSON.stringify(url)},{headers:${JSON.stringify(headers)},signal:AbortSignal.timeout(15000)}).then(
  response=>'HTTP_'+response.status,
  error=>error.name==='TimeoutError'?'TIMEOUT':(error.cause&&error.cause.code)||error.code||String(error.message))`);
}
async function attempt({label,baseUrl,expected,cause,name}){
 nameSeq+=1;
 const provider=`QA 错误文案 ${nameSeq}`;
 await openFeature();
 await ui.fill('input[placeholder="例如，公司模型网关"]',provider);
 await ui.fill('.connection-form input[type=url]',baseUrl);
 await ui.fill('.connection-form input[type=password]',fakeKey);
 await ui.evaluate('window.__qaRaw=null');
 await ui.click('拉取模型并保存','.primary-button');
 await ui.waitFor(`!!document.querySelector(${JSON.stringify(notice)})`,30000);
 const shown=(await ui.evaluate(`document.querySelector(${JSON.stringify(notice)}).textContent`)).trim();
 const raw=await ui.evaluate('window.__qaRaw');
 const saved=await ui.evaluate('(async()=>{const status=await window.zhixing.runtimeStatus();return status.providers.length})()');
 await ui.evaluate(`document.querySelector(${JSON.stringify(notice)}).scrollIntoView({block:"center"})`);
 await ui.screenshot(path.join(evidence,`${name}.png`));
 report.cases.push({name:label,status:'observed',cause,expected,shown,raw,savedProviders:saved});
 await persist();
 assert.equal(shown,expected,`${label}: 界面文案应为「${expected}」，实际「${shown}」`);
 assert.equal(saved,0,`${label}: 失败的拉取不应留下供应商`);
 const technical='请检查网络和 API 地址。';
 assert(!shown.includes(technical),`${label}: 界面仍然显示笼统的技术文案`);
 await record(`${label}（${cause}）显示「${shown}」`,{expected,cause,raw});
}

let failure;
try{
 await launch();
 const runtime=await ui.evaluate('(async()=>window.zhixing.runtimeStatus())()');
 const runtimeResolved=await runtime;
 assert.equal(runtimeResolved.appVersion,provenance.version);
 report.appVersion=runtimeResolved.appVersion;await persist();
 await record(`实包运行时报告 ${runtimeResolved.appVersion}`,{sourceCommit:provenance.sourceCommit,sourceDirty:provenance.sourceDirty});

 const unauthorized=await probe('https://api.deepseek.com/models',{Authorization:`Bearer ${fakeKey}`});
 assert.equal(unauthorized,'HTTP_401');
 await attempt({label:'真实 401 的 API Key 被换成可行动的文案',baseUrl:'https://api.deepseek.com',
  cause:unauthorized,expected:COPY.HTTP_401,name:'http-401'});

 const missingHost=await probe(nonexistent);
 assert(!missingHost.startsWith('HTTP_'),'不存在的域名不应返回 HTTP 状态');
 assert(COPY[missingHost],`本机对不存在域名的错误码 ${missingHost} 没有对应文案，需要更新映射`);
 await attempt({label:'不存在的域名按真实错误码给出对应文案',baseUrl:nonexistent,
  cause:missingHost,expected:COPY[missingHost],name:'no-such-host'});

 const refused=await probe(`${closedUrl}/models`);
 assert.equal(refused,'ECONNREFUSED');
 await attempt({label:'拒绝连接的端口显示连接被拒绝',baseUrl:closedUrl,
  cause:refused,expected:COPY.ECONNREFUSED,name:'connection-refused'});

 // 挂起服务：fetchModels 的 12 秒超时，界面应显示超时文案而不是笼统失败。
 await attempt({label:'无响应的服务地址按 12 秒超时给出超时文案',baseUrl:hangUrl,
  cause:'TIMEOUT',expected:COPY.TIMEOUT,name:'timeout'});

 report.status='passed';await persist();
}catch(error){
 failure=error;report.status='failed';report.error=String(error?.message||error);
 await persist();
 await ui?.screenshot(path.join(evidence,'failure.png')).catch(()=>{});
}finally{
 hang.closeAllConnections();hang.close();
 try{
  if(ui&&child?.exitCode===null){
   await ui.evaluate('window.zhixing.windowControl("close")').catch(()=>{});
   const closed=await Promise.race([exit,pause(30000,null).then(()=>null)]);
   if(!closed){
    report.close='windowControl did not quit; used app.quit()';
    await main?.evaluate("process.mainModule.require('electron').app.quit()").catch(()=>{});
    await Promise.race([exit,pause(20000,null).then(()=>{throw new Error('Packaged app did not close');})]);
   }
  }
  if(exit){const [code,signal]=await exit;report.exits.push({code,signal});await persist();
   if(code!==0)failure??=new Error(`Packaged app exited with ${code}`);}
 }catch(error){report.closeError=String(error?.message||error);await persist();failure??=error;}
 finally{main?.close();ui?.close();if(child?.exitCode===null){child.kill();await exit;}await log?.close();}
}
if(failure)throw failure;

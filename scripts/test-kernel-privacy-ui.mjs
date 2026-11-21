import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {connectUi} from './qa-cdp.mjs';

// Product React, real preload/IPC and native Harness. Only synthetic input is
// written to this separately launched QA profile. No renderer APIs are mocked.
const port=Number(process.env.ZHIXING_QA_PORT||9333),deadline=Date.now()+15000;
while(true){try{const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)});if(response.ok)break;}catch{}if(Date.now()>deadline)throw new Error('The isolated QA app did not become ready');await new Promise(resolve=>setTimeout(resolve,100));}
const ui=await connectUi(port);
const evidence=path.resolve(process.env.ZHIXING_QA_EVIDENCE||'.preview/qa-0.12.0/packed-kernel-privacy');
const checks=[];
await fs.mkdir(evidence,{recursive:true});
async function record(name){checks.push({name,status:'passed'});await fs.writeFile(path.join(evidence,'journey.json'),JSON.stringify({layer:'windows-packaged-app',checks},null,2));console.log(`PASS ${name}`);}
async function inspect(){await ui.click('检查工具目录');await ui.waitFor('!!document.querySelector(".kernel-tool-search")',45000);}
try{
 await ui.waitFor('!!document.querySelector("textarea[aria-label=聊天输入框]")');
 const runtime=await ui.evaluate('window.zhixing.runtimeStatus()');assert.equal(runtime.appVersion,'0.12.0');await record('actual packaged runtime reports 0.12.0');
 if(await ui.evaluate('!!document.querySelector("button[aria-label=展开侧栏]")'))await ui.click('展开侧栏');
 await ui.click('打开设置');await ui.click('隐私与数据','.settings-nav button');
 await ui.click('全角与零宽');await ui.click('测试脱敏');
 const result=await ui.evaluate('document.querySelector("[aria-label=脱敏测试结果]").textContent');
 assert(!result.includes('１３８'));assert(!result.includes('139'));assert(result.includes('ZX-'));assert(await ui.evaluate('document.querySelectorAll("[aria-label=脱敏识别依据] tbody tr").length>0'));
 await ui.evaluate('document.querySelector("[aria-label=脱敏测试结果]").scrollIntoView({block:"center"})');
 await ui.screenshot(path.join(evidence,'unicode-recognition.png'));await record('local Unicode sample masks fullwidth and invisible-character phone numbers with findings');
 await ui.click('凭证拦截');await ui.click('测试脱敏');
 assert(await ui.evaluate('[...document.querySelectorAll(".privacy-test [role=status]")].some(e=>e.textContent.includes("将被拦截"))'));
 assert(!await ui.evaluate('document.querySelector("[aria-label=脱敏测试结果]").textContent.includes("synthetic-secret")'));await record('forged-placeholder credential is blocked in the real settings page');
 const marker='QA_LOCAL_ONLY_0_12_PRIVATE_SAMPLE';await ui.fill('textarea[aria-label="脱敏测试原文"]',marker);await ui.click('测试脱敏');
 assert(!JSON.stringify(await ui.evaluate('window.zhixing.loadWorkspace()')).includes(marker));await record('local test input is absent from persisted workspace');
 await ui.click('Agent 内核','.settings-nav button');await inspect();
 await ui.fill('input[aria-label="搜索内核工具"]','team_task_');
 assert.equal(await ui.evaluate('document.querySelectorAll(".kernel-catalog details").length'),4);await record('native kernel inspection exposes four actual Agent Teams tools');
 await ui.evaluate('document.querySelector(".kernel-catalog").scrollIntoView({block:"center"})');await ui.screenshot(path.join(evidence,'native-team-catalog.png'));
 await ui.fill('input[aria-label="搜索内核工具"]','qa-no-such-native-tool');assert(await ui.evaluate('document.querySelector(".kernel-catalog").innerText.includes("没有匹配的工具")'));await record('tool search has an honest empty state');
 await ui.click('共享任务板','button[role=switch]');await ui.click('保存内核设置');await ui.waitFor('!document.querySelector(".kernel-tool-search")');await record('saving configuration invalidates the previous kernel catalogue');
 await inspect();await ui.fill('input[aria-label="搜索内核工具"]','team_task_');assert.equal(await ui.evaluate('document.querySelectorAll(".kernel-catalog details").length'),0);await record('disabling Teams removes native tools after real IPC and Harness restart');
 await ui.click('恢复默认');await ui.click('保存内核设置');await ui.waitFor('!document.querySelector(".kernel-tool-search")');
 const restored=await ui.evaluate('window.zhixing.runtimeStatus()');assert.equal(restored.kernel.teamEnabled,true);assert.equal(restored.kernel.ptcEnabled,false);await record('restored defaults enable Teams and keep PTC opt-in');
 await ui.click('返回工作台');await record('settings journey returns to working composer');
}catch(error){checks.push({name:'journey',status:'failed',error:error.message});await fs.writeFile(path.join(evidence,'journey.json'),JSON.stringify({layer:'windows-packaged-app',checks},null,2));await ui.screenshot(path.join(evidence,'failure.png')).catch(()=>{});throw error;}
finally{ui.close();}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {connectUi} from './qa-cdp.mjs';

// Product React, real preload/IPC and native Harness. Only synthetic input is
// written to this separately launched QA profile. No renderer APIs are mocked.
const port=Number(process.env.ZHIXING_QA_PORT||9333),deadline=Date.now()+15000;
while(true){try{const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)});if(response.ok)break;}catch{}if(Date.now()>deadline)throw new Error('The isolated QA app did not become ready');await new Promise(resolve=>setTimeout(resolve,100));}
const ui=await connectUi(port);
const version=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const evidence=path.resolve(process.env.ZHIXING_QA_EVIDENCE||`.preview/qa-${version}/packed-kernel-privacy`);
const checks=[];
await fs.mkdir(evidence,{recursive:true});
async function record(name){checks.push({name,status:'passed'});await fs.writeFile(path.join(evidence,'journey.json'),JSON.stringify({layer:'windows-packaged-app',checks},null,2));console.log(`PASS ${name}`);}
async function inspect(){await ui.click('检查工具目录');await ui.waitFor('!!document.querySelector(".kernel-tool-search")',45000);}
try{
 await ui.waitFor('!!document.querySelector("textarea[aria-label=聊天输入框]")');
 const runtime=await ui.evaluate('window.zhixing.runtimeStatus()');assert.equal(runtime.appVersion,version);await record(`actual packaged runtime reports ${version}`);
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
 await ui.fill('select[aria-label="密钥与密码处理方式"]','mask');
 await ui.click(await ui.evaluate('document.querySelector("input[value=raw]").closest("label").textContent.trim()'),'.mode-options label');
 assert(await ui.evaluate('document.querySelector("select[aria-label=密钥与密码处理方式]").disabled && document.querySelector("select[aria-label=密钥与密码处理方式]").value === "block"'));
 assert(!await ui.evaluate('!!document.querySelector("[aria-label=脱敏测试结果]")'));await record('raw mode locks credential blocking and invalidates the previous local test');
 await ui.click('凭证拦截');await ui.click('测试脱敏');assert(await ui.evaluate('document.querySelector(".privacy-test [role=status]").textContent.includes("将被拦截")'));
 await ui.evaluate('document.querySelector(".privacy-test").scrollIntoView({block:"end"})');await ui.screenshot(path.join(evidence,'raw-credential-block.png'));await record('raw local test blocks a generic credential even when the saved rule was mask');
 await ui.click('联系信息');await ui.click('测试脱敏');assert(await ui.evaluate('document.querySelector("[aria-label=脱敏测试结果]").textContent.includes("13800000000")'));await record('raw local test accurately preserves ordinary contact information');
 await ui.click(await ui.evaluate('document.querySelector("input[value=redact]").closest("label").textContent.trim()'),'.mode-options label');
 assert.equal(await ui.evaluate('document.querySelector("select[aria-label=密钥与密码处理方式]").value'),'mask');await ui.fill('select[aria-label="密钥与密码处理方式"]','block');await record('returning to redact restores the saved credential rule');
 const ipcChecks=await ui.evaluate(`(async()=>{
  const initial=await window.zhixing.runtimeStatus();let shortBlocked=false;
  const input={name:'QA credential boundary',protocol:'openai',baseUrl:'http://127.0.0.1:1/v1',reasoningStyle:'none',manualModels:'credential-fixture'};
  try{await window.zhixing.saveProvider({...input,apiKey:'short'});}catch(error){shortBlocked=error.message.includes('8–1024');}
  if(!shortBlocked)throw Error('Short key was accepted');
  const key='Ab7!xyZ9',saved=await window.zhixing.saveProvider({...input,apiKey:key});const provider=saved.providers.find(row=>row.name===input.name);if(!provider)throw Error('Fixture provider missing');
  try {
   for(const fields of [{prompt:key},{prompt:'普通内容',bootstrapPrompt:[...key].join('\\u200b')},{prompt:'普通内容',command:'/goal '+key}]){
    let blocked=false;try{await window.zhixing.prepareRun({sessionId:crypto.randomUUID(),workspaceId:'office-home',modelProviderId:provider.id,model:'credential-fixture',reasoning:'off',privacyMode:'redact',customTerms:[],...fields});}catch(error){blocked=error.message.includes('模型凭证');}
    if(!blocked)throw Error('Known key was not blocked before preview');
   }
  }finally{await window.zhixing.removeProvider(provider.id);}
  return {shortBlocked,restored:(await window.zhixing.runtimeStatus()).providers.length===initial.providers.length};
 })()`);assert(ipcChecks.shortBlocked&&ipcChecks.restored);await record('actual IPC rejects short saved keys and known eight-character keys in prompt bootstrap and command');
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

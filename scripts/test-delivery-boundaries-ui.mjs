import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {unzipSync, strFromU8} from 'fflate';
import ExcelJS from 'exceljs';
import {connectUi} from './qa-cdp.mjs';

// Run only against the separately launched synthetic QA profile. The one UI
// adapter replaced is the native save-dialog selection; policy, preload, host
// snapshots, serialization, writeFile and the Windows clipboard remain real.
const port = Number(process.env.ZHIXING_QA_PORT || 9343);
const mainPort = Number(process.env.ZHIXING_QA_MAIN_PORT || 9344);
const evidence = path.resolve(process.env.ZHIXING_QA_EVIDENCE || '.preview/qa-0.12.1-audit/windows-delivery');
await fs.mkdir(evidence, {recursive: true});
const ui = await connectUi(port), main = await connectUi(mainPort, true);
const checks = [];
let baseline, baselineMcp, providerId;
const bind = snapshot => Object.fromEntries(['reviewId', 'contentHash', 'policyRevision', 'recipientScope', 'format'].map(key => [key, snapshot[key]]));
const invoke = (method, value) => ui.evaluate(`window.zhixing.${method}(${JSON.stringify(value)})`);
const rejects = async (method, value, pattern) => {
  const result = await ui.evaluate(`(async()=>{try{await window.zhixing.${method}(${JSON.stringify(value)});return {rejected:false};}catch(error){return {rejected:true,message:error.message};}})()`);
  assert(result.rejected && pattern.test(result.message), JSON.stringify(result));
};
async function record(name, details) {
  checks.push({name, status: 'passed', ...details});
  await fs.writeFile(path.join(evidence, 'journey.json'), JSON.stringify({layer: 'windows-packaged-preload-main', saveDialogSelection: 'synthetic adapter; native dialog UX not tested here', checks}, null, 2));
  console.log(`PASS ${name}`);
}
async function saveSettings(settings) {
  const state = await invoke('loadWorkspace'); state.settings = {...state.settings, ...settings};
  await invoke('saveWorkspace', state);
}
try {
  baseline = await invoke('loadWorkspace');
  baselineMcp = await invoke('listMcp');
  const runtime = await invoke('runtimeStatus');
  assert.equal(runtime.appVersion, JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
  await main.evaluate(`(()=>{const electron=process.mainModule.require('electron');globalThis.__qaDeliveryOriginalDialog=electron.dialog.showSaveDialog;globalThis.__qaDeliveryClipboard=electron.clipboard.readText();return true;})()`);
  const key = 'QA_DELIVERY_CONFIG_KEY_123';
  const mcpKey = 'QA_MCP_DELIVERY_KEY_123';
  await invoke('saveMcp', [...baselineMcp, {serverName: `qa_delivery_${Date.now()}`, enabled: false, transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: {Authorization: `Bearer ${mcpKey}`}}]);
  const saved = await invoke('saveProvider', {name: 'QA delivery-only synthetic provider', protocol: 'openai', baseUrl: 'http://127.0.0.1:1/v1', reasoningStyle: 'none', manualModels: 'delivery-fixture', apiKey: key});
  providerId = saved.providers.find(row => row.name === 'QA delivery-only synthetic provider')?.id;
  assert(providerId);
  for (const privacyMode of ['raw', 'redact']) {
    await saveSettings({privacyMode, customTerms: ['合成内部单位'], privacyPolicy: {secretPrefixes: ['zxcorp_'], actions: {SECRET: 'mask'}}});
    for (const recipientScope of ['self', 'recipient']) for (const format of ['txt', 'docx', 'xlsx']) {
      for (const original of ['zxcorp_ABCDEF1234567890', key, mcpKey]) {
        const snapshot = await invoke('prepareDelivery', {original, masked: '旧历史已隐藏', recipientScope, format});
        assert(snapshot.blocked); assert(!snapshot.text.includes(original));
        await rejects('exportFile', bind(snapshot), /隐私规则阻止/);
      }
    }
    for (const recipientScope of ['self', 'recipient']) {
      const snapshot = await invoke('prepareDelivery', {original: key, recipientScope, action: 'share'});
      assert(snapshot.blocked); await rejects('shareReviewed', bind(snapshot), /隐私规则阻止/);
    }
    await record(`${privacyMode}: 三种文件及剪贴板的两种接收范围均阻断配置凭据/自定义秘密`);
  }
  const original = '合成内部单位\n电话13800000000\n普通交付成果';
  let expectedText;
  const files = [];
  for (const format of ['txt', 'docx', 'xlsx']) {
    const snapshot = await invoke('prepareDelivery', {original, recipientScope: 'recipient', format});
    assert(!snapshot.blocked); expectedText = snapshot.text;
    const target = path.join(evidence, `actual-export.${format}`);
    await main.evaluate(`(()=>{process.mainModule.require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(target)}});return true;})()`);
    const result = await invoke('exportFile', bind(snapshot)); assert.equal(result.path, target);
    const bytes = await fs.readFile(target);
    let decoded = format === 'txt' ? bytes.toString('utf8') : format === 'docx' ? strFromU8(unzipSync(bytes)['word/document.xml']) : '';
    if (format === 'xlsx') {const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes); decoded = JSON.stringify(book.worksheets[0].getSheetValues());}
    assert(!decoded.includes('13800000000')); assert(!decoded.includes('合成内部单位')); assert(decoded.includes('普通交付成果')); assert(!decoded.includes('⟦ZX-'));
    files.push({format, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  await record('真实主进程写出 TXT/DOCX/XLSX，读取文件内容确认当前规则生效', {files});
  const share = await invoke('prepareDelivery', {original, action: 'share'}); assert.equal(share.text, expectedText);
  await invoke('shareReviewed', bind(share));
  const clipboard = await main.evaluate("process.mainModule.require('electron').clipboard.readText()");
  assert.equal(clipboard.replaceAll('\r\n', '\n'), expectedText.replaceAll('\r\n', '\n'));
  await record('真实 Windows 剪贴板与已审阅主机文本相同');
  const snapshot = await invoke('prepareDelivery', {original});
  for (const changed of [{...bind(snapshot), text: '替换正文'}, {...bind(snapshot), recipientScope: 'self'}, {...bind(snapshot), format: 'docx'}]) await rejects('exportFile', changed, /快照不一致/);
  await saveSettings({customTerms: ['合成内部单位', '新策略词']});
  await rejects('exportFile', bind(snapshot), /规则.*变化/);
  await record('正文注入、范围/格式篡改与规则变更后使用旧快照均拒绝');
  const raced = await invoke('prepareDelivery', {original});
  await main.evaluate(`(()=>{process.mainModule.require('electron').dialog.showSaveDialog=()=>new Promise(resolve=>globalThis.__qaDeliveryRelease=resolve);return true;})()`);
  await ui.evaluate(`(()=>{globalThis.__qaDeliveryRace=window.zhixing.exportFile(${JSON.stringify(bind(raced))}).then(()=>({rejected:false}),error=>({rejected:true,message:error.message}));return true;})()`);
  await main.waitFor('typeof globalThis.__qaDeliveryRelease==="function"');
  await saveSettings({privacyMode: 'raw'});
  const racedTarget = path.join(evidence, 'must-not-exist.txt');
  await main.evaluate(`globalThis.__qaDeliveryRelease({canceled:false,filePath:${JSON.stringify(racedTarget)}})`);
  const raceResult = await ui.evaluate('globalThis.__qaDeliveryRace'); assert(raceResult.rejected && /变化/.test(raceResult.message));
  await assert.rejects(fs.stat(racedTarget), {code: 'ENOENT'});
  await record('原生保存选择期间策略变更：二次主机校验阻止写盘，目标文件不存在');
  await rejects('writeClipboardText', key, /隐私规则阻止/);
  await rejects('writeClipboardText', mcpKey, /隐私规则阻止/);
  await record('普通主进程复制路径同样不能输出模型凭据或 MCP Authorization 的裸令牌');
} catch (error) {
  checks.push({name: 'delivery journey', status: 'failed', error: error.message});
  await fs.writeFile(path.join(evidence, 'journey.json'), JSON.stringify({checks}, null, 2));
  throw error;
} finally {
  if (baseline) await invoke('saveWorkspace', baseline).catch(() => {});
  if (baselineMcp) await invoke('saveMcp', baselineMcp).catch(() => {});
  if (providerId) await invoke('removeProvider', providerId).catch(() => {});
  await main.evaluate("(()=>{const electron=process.mainModule.require('electron');if(globalThis.__qaDeliveryOriginalDialog)electron.dialog.showSaveDialog=globalThis.__qaDeliveryOriginalDialog;if(typeof globalThis.__qaDeliveryClipboard==='string')electron.clipboard.writeText(globalThis.__qaDeliveryClipboard);delete globalThis.__qaDeliveryOriginalDialog;delete globalThis.__qaDeliveryClipboard;delete globalThis.__qaDeliveryRelease;return true;})()").catch(() => {});
  ui.close(); main.close();
}

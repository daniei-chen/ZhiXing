import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const moduleUrl = relative => packed ? pathToFileURL(path.join(packed, relative)).href : new URL(`../${relative}`, import.meta.url).href;
const {DeliverableAccess} = await import(moduleUrl('electron/deliverable-access.mjs'));
const {DeliveryService} = await import(moduleUrl('electron/delivery-service.mjs'));
const {NativeSessionExport} = await import(moduleUrl('electron/native-session-export.mjs'));
const {createBridgeKey, writeBridge} = await import(moduleUrl('harness/privacy-bridge.mjs'));
const require = createRequire(import.meta.url);
const harnessRequire = createRequire(require.resolve('@deepseek-ai/dsh/lib/bin.js'));
const {SESSION_FORMAT_VERSION} = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-session')).href);

async function fixture(t) {
 const parent = await fs.realpath(os.tmpdir());
 const directory = await fs.mkdtemp(path.join(parent, 'zhixing-delivery-test-'));
 const root = path.join(directory, 'app-data');
 const project = path.join(directory, 'project');
 const outside = path.join(directory, 'outside');
 await Promise.all([root, project, outside].map(target => fs.mkdir(target)));
 const state = {
  workspaceId: 'office-home',
  workspaces: [{id: 'office-home'}, {id: 'government-home'}],
  projects: [{id: 'project-one', workspaceId: 'office-home', directory: project}, {id: 'project-two', workspaceId: 'office-home', directory: project}],
  chats: [{id: 'chat-one', workspaceId: 'office-home', projectId: 'project-one', messages: []},
   {id: 'chat-two', workspaceId: 'office-home', projectId: 'project-two', messages: []}],
 };
 const key = createBridgeKey();
 const vaults = new Map([['chat-one', {historyKey: key}], ['chat-two', {historyKey: key}]]);
 const callbacks = {root, getWorkspace: () => state, readVault: async id => vaults.get(id)};
 const access = new DeliverableAccess(callbacks);
 const scope = {workspaceId: 'office-home', projectId: 'project-one', sessionId: 'chat-one'};
 async function history(files, {mode = 'redact', id = 'chat-one', owner = 'chat-one', header = {}, events} = {}) {
  const folder = path.join(root, 'harness', owner, `history-${mode}`);
  await fs.mkdir(folder, {recursive: true});
  const target = path.join(folder, `${id}.bin`);
  await writeBridge(target, key, {
   header: {version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, ...header},
   events: events || [{type: 'deliverables/presented', seq: 0, time: 1, data: {turn: 1, callId: 'present-fixture', files}}],
  });
  return target;
 }
 t.after(async () => {
  const resolved = await fs.realpath(directory);
  assert.equal(path.dirname(resolved), parent);
  assert(path.basename(resolved).startsWith('zhixing-delivery-test-'));
  await fs.rm(resolved, {recursive: true, force: true, maxRetries: 6, retryDelay: 150});
 });
 return {directory, root, project, outside, state, key, vaults, access, callbacks, scope, history};
}

function sessionExportFixture(f, {secrets = [], isBusy = () => false} = {}) {
 f.state.settings = {persist:true,privacyMode:'redact'};
 const delivery = new DeliveryService({getSettings:()=>f.state.settings,getSecrets:()=>secrets});
 const service = new NativeSessionExport({...f.callbacks,delivery,isBusy});
 const request = (history = {}, options = {}) => ({format:'md',action:'export',history:{...f.scope,mode:'redact',...history},...options});
 return {delivery,service,request};
}

const conversation = text => [{type:'user/message',seq:0,time:1,surfaceOp:'append',data:{id:'fixture-user',role:'user',source:{kind:'user'},content:[{type:'text',text}]}}];
const bind = ({reviewId,contentHash,policyRevision,recipientScope,format}) => ({reviewId,contentHash,policyRevision,recipientScope,format});

test('Harness Markdown 逐模式审阅，主机历史不接受替代正文，交付只使用审阅后的 UTF-8 字节', async t => {
 const f = await fixture(t);
 const {delivery,service,request} = sessionExportFixture(f);
 const phone = '13800000000', masked = '⟦ZX-123456abcdef-PHONE-1⟧';
 await f.history([], {events:conversation(`脱敏历史 ${masked}`)});
 await f.history([], {mode:'raw',events:conversation(`原始历史 电话${phone}`)});
 await f.history([], {id:'child-one',header:{origin:'subagent',parentSession:'chat-one'},events:conversation('子会话内容')});
 await assert.rejects(service.prepare(request({projectId:'project-two'})), {code:'SESSION_EXPORT_SCOPE'});
 await assert.rejects(service.prepare(request({workspaceId:'government-home'})), {code:'SESSION_EXPORT_SCOPE'});
 await assert.rejects(service.prepare(request({sessionId:'child-one'})), {code:'SESSION_EXPORT_SCOPE'});
 await assert.rejects(service.prepare(request({}, {action:'share'})), {code:'SESSION_EXPORT_FORMAT'});
 assert.throws(()=>delivery.prepare({original:'伪造',format:'md'}), {code:'DELIVERY_INPUT_INVALID'});

 const redacted = await service.prepare(request({}, {original:'伪造正文',title:'伪造标题',recipientScope:'self'}));
 assert.match(redacted.text, /^# Untitled Session\n\n> 脱敏历史 /);
 assert(redacted.text.includes(masked));
 for (const omitted of [phone, '子会话内容', '原始历史', '伪造']) assert(!redacted.text.includes(omitted));

 const scope = {mode:'raw'};
 const recipient = await service.prepare(request(scope));
 assert.match(recipient.text,/原始历史/);assert(!recipient.text.includes(phone));
 const self = await service.prepare(request(scope,{recipientScope:'self'}));
 assert(self.text.includes(phone));
 assert.throws(()=>delivery.resolve({...bind(recipient),recipientScope:'self'},'export'), {code:'DELIVERY_REVIEW_MISMATCH'});
 const target = path.join(f.outside,'export.md');
 await delivery.execute(bind(recipient),'export',async(snapshot,validate)=>{
  assert.deepEqual(service.assertScope(snapshot.history), {...f.scope,...scope});
  await fs.writeFile(target, Buffer.from(validate().text, 'utf8'));
 });
 assert.deepEqual(await fs.readFile(target), Buffer.from(recipient.text, 'utf8'));
 f.state.settings.privacyPolicy = {actions:{PHONE:'block'}};
 assert.throws(()=>delivery.resolve(bind(self),'export'), {code:'DELIVERY_POLICY_CHANGED'});
 const blocked = await service.prepare(request(scope,{recipientScope:'self'}));
 assert.equal(blocked.blocked,true);assert(!blocked.text.includes(phone));
 f.state.chats[0].projectId = 'project-two';
 assert.throws(()=>service.assertScope(blocked.history), {code:'SESSION_EXPORT_SCOPE'});
});

test('Harness Markdown 阻断当前凭据，拒绝活动会话、关闭持久化、坏日志和重定向目录', async t => {
 const f = await fixture(t);
 const key = 'synthetic-legacy-configured-key';
 let busy = false;
 const {delivery,service,request} = sessionExportFixture(f,{secrets:[key],isBusy:()=>busy});
 await assert.rejects(service.prepare(request()), {code:'SESSION_EXPORT_MISSING'});
 const target = await f.history([], {mode:'raw',events:conversation(`旧日志样例 ${key}`)});
 for (const recipientScope of ['recipient','self']) {
  const blocked = await service.prepare(request({mode:'raw'},{recipientScope}));
  assert.equal(blocked.blockedReason,'CONFIGURED_CREDENTIAL');assert(!blocked.text.includes(key));
  assert.throws(()=>delivery.resolve(bind(blocked),'export'), {code:'DELIVERY_BLOCKED'});
 }
 busy = true;
 await assert.rejects(service.prepare(request({mode:'raw'})), {code:'SESSION_EXPORT_BUSY'});
 busy = false; f.state.settings.persist = false;
 await assert.rejects(service.prepare(request({mode:'raw'})), {code:'SESSION_EXPORT_DISABLED'});
 f.state.settings.persist = true;
 await f.history([], {header:{id:'chat-two'},events:conversation('错误归属')});
 await assert.rejects(service.prepare(request()), {code:'SESSION_EXPORT_HISTORY'});
 await f.history([], {events:[{...conversation('漏掉序号')[0],seq:5}]});
 await assert.rejects(service.prepare(request()), {code:'SESSION_EXPORT_HISTORY'});
 await fs.truncate(target, 24 * 1024 * 1024 + 1);
 await assert.rejects(service.prepare(request({mode:'raw'})), {code:'SESSION_EXPORT_TOO_LARGE'});
 const anotherHistory = path.join(f.root,'redirected-history');
 const historyDirectory = path.dirname(target);
 await fs.rename(historyDirectory,anotherHistory);
 await fs.symlink(anotherHistory,historyDirectory,process.platform==='win32'?'junction':'dir');
 await assert.rejects(service.prepare(request({mode:'raw'})), {code:'SESSION_EXPORT_HISTORY'});
});

test('项目外真实 present 文件可由专用引用读取，渲染端伪造路径不授予访问', async t => {
 const f = await fixture(t);
 const target = path.join(f.outside, '真实交付.txt');
 const unpresented = path.join(f.outside, '未交付.txt');
 await fs.writeFile(target, '合成办公交付正文。');
 await fs.writeFile(unpresented, '此文件没有原生交付记录。');
 f.state.chats[0].messages.push({role: 'assistant', deliverables: [{path: unpresented}]});
 await f.history([{path: target, description: '项目外合成交付'}]);

 const files = await f.access.list(f.scope);
 assert.equal(files.length, 1);
 assert.equal(files[0].path, target);
 assert.equal(files[0].available, true);
 assert.match(files[0].id, /^zx-delivery-v1\./);
 f.state.projects[0].directory = null;
 const parsed = await f.access.read({...f.scope, id: files[0].id, path: unpresented});
 assert.equal(parsed.path, target);
 assert.equal(parsed.text, '合成办公交付正文。');
 assert.equal(parsed.deliverableId, files[0].id);
 await assert.rejects(f.access.read({...f.scope, path: unpresented}), {code: 'DELIVERABLE_REFERENCE'});
});

test('引用拒绝跨会话、工作模式、项目以及签名或事件索引篡改', async t => {
 const f = await fixture(t);
 const target = path.join(f.outside, 'shared.txt');
 await fs.writeFile(target, 'synthetic');
 await f.history([{path: target}]);
 await f.history([{path: target}], {id: 'chat-two', owner: 'chat-two'});
 const [file] = await f.access.list(f.scope);
 await assert.rejects(f.access.readBytes({...f.scope, workspaceId: 'government-home', id: file.id}), {code: 'DELIVERABLE_SCOPE'});
 await assert.rejects(f.access.readBytes({...f.scope, projectId: 'project-two', id: file.id}), {code: 'DELIVERABLE_SCOPE'});
 await assert.rejects(f.access.readBytes({...f.scope, sessionId: 'missing-chat', id: file.id}), {code: 'DELIVERABLE_SCOPE'});
 await assert.rejects(f.access.readBytes({...f.scope, sessionId: 'chat-two', projectId: 'project-two', id: file.id}), {code: 'DELIVERABLE_REFERENCE'});
 for (const id of [file.id.replace('.redact.', '.raw.'), file.id.replace('.0.0.', '.0.1.'), `${file.id.slice(0, -1)}${file.id.endsWith('0') ? '1' : '0'}`]) {
  await assert.rejects(f.access.readBytes({...f.scope, id}), {code: 'DELIVERABLE_REFERENCE'});
 }
});

test('重建访问模块仍可验证引用，普通文件更新读取当前位置的内容', async t => {
 const f = await fixture(t);
 const target = path.join(f.project, 'current.txt');
 await fs.writeFile(target, 'first version');
 await f.history([{path: target}]);
 const [file] = await f.access.list(f.scope);
 await fs.writeFile(target, 'current version');
 const reopened = new DeliverableAccess(f.callbacks);
 assert.equal((await reopened.list(f.scope))[0].id, file.id);
 assert.equal((await reopened.readBytes({...f.scope, id: file.id})).bytes.toString(), 'current version');
});

test('raw 与 redact 历史保持独立，子会话须有完整原生归属链', async t => {
 const f = await fixture(t);
 const target = path.join(f.outside, 'child.txt');
 await fs.writeFile(target, 'native child delivery');
 await f.history([]);
 await f.history([{path: target}], {mode: 'raw'});
 await f.history([{path: target}], {id: 'child-one', header: {origin: 'subagent', parentSession: 'chat-one'}});
 await f.history([{path: target}], {id: 'grandchild', header: {origin: 'subagent', parentSession: 'child-one'}});
 await f.history([{path: target}], {id: 'unrelated', header: {origin: 'subagent', parentSession: 'chat-two'}});
 await f.history([{path: target}], {id: 'cycle', header: {origin: 'subagent', parentSession: 'cycle'}});
 const files = await f.access.list(f.scope);
 assert.equal(files.length, 3);
 assert(files.some(file => file.id.includes('.raw.chat-one.')));
 assert(files.some(file => file.id.includes('.redact.child-one.')));
 assert(files.some(file => file.id.includes('.redact.grandchild.')));
 for (const file of files) assert.equal((await f.access.readBytes({...f.scope, id: file.id})).bytes.toString(), 'native child delivery');
});

test('加密历史身份、版本、序号或密文损坏均拒绝交付访问', async t => {
 const f = await fixture(t);
 const target = path.join(f.outside, 'record.txt');
 await fs.writeFile(target, 'native evidence');
 await f.history([{path: target}]);
 const [file] = await f.access.list(f.scope);
 await f.history([{path: target}], {header: {id: 'another-session'}});
 await assert.rejects(f.access.readBytes({...f.scope, id: file.id}), {code: 'DELIVERABLE_HISTORY'});
 await f.history([{path: target}], {header: {version: SESSION_FORMAT_VERSION + 1}});
 await assert.rejects(f.access.list(f.scope), {code: 'DELIVERABLE_HISTORY'});
 await f.history([], {events: [{type: 'deliverables/presented', seq: 2, time: 1, data: {turn: 1, callId: 'gap', files: [{path: target}]}}]});
 await assert.rejects(f.access.list(f.scope), {code: 'DELIVERABLE_HISTORY'});
 const historyFile = await f.history([{path: target}]);
 const bytes = await fs.readFile(historyFile);
 bytes[bytes.length - 1] ^= 1;
 await fs.writeFile(historyFile, bytes);
 await assert.rejects(f.access.list(f.scope), {code: 'DELIVERABLE_HISTORY'});
});

test('没有主机密钥或原生日志时不从消息路径补造交付授权', async t => {
 const f = await fixture(t);
 const target = path.join(f.outside, 'forged.txt');
 await fs.writeFile(target, 'not yet presented');
 f.state.chats[0].messages.push({role: 'assistant', deliverables: [{path: target}]});
 assert.deepEqual(await f.access.list(f.scope), []);
 await f.history([{path: target}]);
 f.vaults.delete('chat-one');
 assert.deepEqual(await f.access.list(f.scope), []);
});

test('缺失文件、目录、私密路径和应用数据保留不可用状态', async t => {
 const f = await fixture(t);
 const missing = path.join(f.outside, 'missing.txt');
 const secret = path.join(f.outside, '.env');
 const internal = path.join(f.root, 'providers.bin');
 await fs.writeFile(secret, 'synthetic-private');
 await fs.writeFile(internal, 'synthetic-app-record');
 await f.history([{path: missing}, {path: f.project}, {path: secret}, {path: internal}]);
 const files = await f.access.list(f.scope);
 assert.equal(files.length, 4);
 assert(files.every(file => !file.available && file.id === null && file.reason));
 assert.match(files[0].reason, /不存在/);
});

test('目录链接重定向后旧引用失效，日志目录链接不能跨应用根读取', async t => {
 const f = await fixture(t);
 const replacement = path.join(f.directory, 'replacement');
 const link = path.join(f.directory, 'delivery-link');
 await fs.mkdir(replacement);
 await fs.writeFile(path.join(f.outside, 'linked.txt'), 'original');
 await fs.writeFile(path.join(replacement, 'linked.txt'), 'replacement');
 await fs.symlink(f.outside, link, process.platform === 'win32' ? 'junction' : 'dir');
 await f.history([{path: path.join(link, 'linked.txt')}]);
 const [file] = await f.access.list(f.scope);
 assert.equal((await f.access.readBytes({...f.scope, id: file.id})).bytes.toString(), 'original');
 await fs.rmdir(link);
 await fs.symlink(replacement, link, process.platform === 'win32' ? 'junction' : 'dir');
 await assert.rejects(f.access.readBytes({...f.scope, id: file.id}), {code: 'DELIVERABLE_REFERENCE'});

 const historyDirectory = path.join(f.root, 'harness', 'chat-one', 'history-redact');
 const movedHistory = path.join(f.directory, 'moved-history');
 await fs.rename(historyDirectory, movedHistory);
 await fs.symlink(movedHistory, historyDirectory, process.platform === 'win32' ? 'junction' : 'dir');
 await assert.rejects(f.access.list(f.scope), {code: 'DELIVERABLE_HISTORY'});
});

test('交付文件预览受大小限制，读取中归属变化拒绝返回内容', async t => {
 const f = await fixture(t);
 const target = path.join(f.outside, 'large.txt');
 await fs.writeFile(target, '');
 await fs.truncate(target, 10 * 1024 * 1024 + 1);
 await f.history([{path: target}]);
 const [file] = await f.access.list(f.scope);
 await assert.rejects(f.access.readBytes({...f.scope, id: file.id}), {code: 'DELIVERABLE_SIZE'});
 await fs.writeFile(target, 'small');
 let calls = 0;
 const changing = new DeliverableAccess({...f.callbacks, getWorkspace: () => {
  if (++calls === 2) f.state.chats[0].projectId = 'project-two';
  return f.state;
 }});
 await assert.rejects(changing.readBytes({...f.scope, id: file.id}), {code: 'DELIVERABLE_SCOPE'});
});

test('真实 Harness 在完全访问下 present 项目外文件后可用主机引用预览', {timeout: 45000}, async t => {
 const f = await fixture(t);
 const {RuntimeManager} = await import(moduleUrl('electron/runtime.mjs'));
 const target = path.join(f.outside, 'native-present.txt');
 await fs.writeFile(target, '真实内核的项目外交付。');
 let requests = 0;
 const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests++;
  const called = body.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'));
  const content = called ? [{type: 'text', text: '原生项目外交付已完成。'}]
   : [{type: 'tool_use', id: 'native-present-call', name: 'present', input: {files: [{path: target, description: '实际 present 文件'}]}}];
  response.writeHead(200, {'content-type': 'text/event-stream'});
  const send = (type, fields) => response.write(`event: ${type}\ndata: ${JSON.stringify({type, ...fields})}\n\n`);
  send('message_start', {message: {id: `present-${requests}`, type: 'message', role: 'assistant', model: body.model,
   content: [], stop_reason: null, usage: {input_tokens: 10, output_tokens: 0}}});
  for (const [index, block] of content.entries()) {
   send('content_block_start', {index, content_block: block.type === 'text' ? {type: 'text', text: ''} : {...block, input: {}}});
   send('content_block_delta', {index, delta: block.type === 'text' ? {type: 'text_delta', text: block.text}
    : {type: 'input_json_delta', partial_json: JSON.stringify(block.input)}});
   send('content_block_stop', {index});
  }
  send('message_delta', {delta: {stop_reason: called ? 'end_turn' : 'tool_use', stop_sequence: null}, usage: {output_tokens: 10}});
  send('message_stop', {});
  response.end();
 });
 server.listen(0, '127.0.0.1');
 await once(server, 'listening');
 f.vaults.delete(f.scope.sessionId);
 const manager = new RuntimeManager({root: path.join(f.root, 'harness'), readVault: async id => f.vaults.get(id),
  writeVault: async (id, value) => f.vaults.set(id, value)});
 try {
  const result = await manager.run({runId: 'native-present-run', sessionId: f.scope.sessionId, prompt: '交付合成文件。', privacyMode: 'redact'}, {
   baseUrl: `http://127.0.0.1:${server.address().port}/anthropic`, model: 'present-fixture', reasoning: 'off',
   permission: 'full', workspaceRoot: f.project, kernel: {webEnabled: false, workflowEnabled: false, subagentDepth: 0},
  }, 'synthetic-present-key');
  assert.equal(result.finishReason, 'completed');
  assert.equal(result.deliverables.length, 1);
  assert.equal(result.deliverables[0].path, target);
  const [file] = await f.access.list(f.scope);
  assert.equal(file.available, true);
  assert.equal(file.path, result.deliverables[0].path);
  assert.equal((await f.access.read({...f.scope, id: file.id})).text, '真实内核的项目外交付。');
  assert.equal(requests, 2);
  await manager.close();
  const {service,request} = sessionExportFixture(f);
  const transcript = await service.prepare(request());
  assert(!transcript.blocked);
  assert.match(transcript.text, /交付合成文件。/);
  assert.match(transcript.text, /Tool: `present`/);
  assert.match(transcript.text, /原生项目外交付已完成。/);
  assert(!transcript.text.includes(target)&&!transcript.text.includes('synthetic-present-key'));
  assert.equal(requests, 2, 'reading the committed native transcript creates no provider call');
 } finally {
  await manager.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
 }
});

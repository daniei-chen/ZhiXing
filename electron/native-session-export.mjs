import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {decodeBridge} from '../harness/privacy-bridge.mjs';
import {projectContext} from '../src/project-core.js';
import {validateHistoryRecord} from './session-history-record.mjs';

const require = createRequire(import.meta.url);
const harnessRequire = createRequire(require.resolve('@deepseek-ai/dsh/lib/bin.js'));
const {formatSessionMarkdown} = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-session-log-export')).href);
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const MAX_LOG_BYTES = 24 * 1024 * 1024;
const isId = value => typeof value === 'string' && ID.test(value);
const failure = (code, message) => Object.assign(new Error(message), {code, stage:'delivery'});
const missing = () => failure('SESSION_EXPORT_MISSING', '这个发送模式没有已保存的原生会话记录。可切换历史来源，或选择 TXT 等格式导出可见聊天。');
const corrupt = () => failure('SESSION_EXPORT_HISTORY', '无法验证本机原生会话记录。可选择 TXT 等格式导出可见聊天。');

export class NativeSessionExport {
 constructor({root, getWorkspace, readVault, isBusy, delivery}) {
  Object.assign(this, {root, getWorkspace, readVault, isBusy, delivery});
 }

 assertScope(options) {
  const {workspaceId, projectId = null, sessionId, mode} = options || {};
  if (!isId(sessionId) || !isId(workspaceId) || (projectId !== null && !isId(projectId)) || !['redact','raw'].includes(mode)) {
   throw failure('SESSION_EXPORT_SCOPE', '请从原会话选择有效的历史来源。');
  }
  const state = this.getWorkspace();
  if (!state.settings?.persist) throw failure('SESSION_EXPORT_DISABLED', '本地保存已关闭，无法导出原生会话。可用 TXT 等格式保存可见聊天。');
  const chat = state.chats?.find(row => row.id === sessionId);
  if (!chat || chat.workspaceId !== workspaceId || (chat.projectId || null) !== projectId) {
   throw failure('SESSION_EXPORT_SCOPE', '会话已删除或移到其他位置，请从所属会话重新审阅。');
  }
  projectContext(state, {workspaceId, projectId, sessionId});
  if (this.isBusy(sessionId)) throw failure('SESSION_EXPORT_BUSY', '请等当前会话执行及保存结束，再导出原生记录。');
  return {workspaceId, projectId, sessionId, mode};
 }

 async prepare({history, recipientScope, action, format} = {}) {
  if (format !== 'md' || action !== 'export') throw failure('SESSION_EXPORT_FORMAT', '原生会话仅支持保存为 Markdown。');
  const scope = this.assertScope(history);
  const {historyKey} = await this.readVault(scope.sessionId) || {};
  if (!historyKey) throw missing();
  if (typeof historyKey !== 'string' || !/^[a-f0-9]{64}$/i.test(historyKey)) throw corrupt();
  const record = await readCommittedRecord(this.root, scope, historyKey);
  let text;
  try {
   const {events, header, inheritedEventCount = 0} = record;
   if (header.origin === 'subagent' || !Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0 || inheritedEventCount > events.length ||
       Boolean(header.isSeeded) !== (inheritedEventCount > 0)) throw corrupt();
   if (!events.some(event => event.type === 'tool/call' || event.surfaceOp === 'append' && (
    event.type === 'assistant/message' || event.type === 'user/message' && event.data.source.kind === 'user'
   ))) throw missing();
   text = formatSessionMarkdown(events);
  } catch (error) {
   if (error.code === 'SESSION_EXPORT_MISSING') throw error;
   throw corrupt();
  }
  this.assertScope(scope);
  return this.delivery.prepare({original:text, recipientScope, action, format}, {history:scope});
 }
}

function sameFile(left, right) {
 return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readCommittedRecord(root, {sessionId, mode}, key) {
 try {
  let directory = await fs.realpath(root);
  for (const segment of ['harness', sessionId, `history-${mode}`]) {
   directory = path.join(directory, segment);
   const stat = await fs.lstat(directory);
   if (!stat.isDirectory() || stat.isSymbolicLink() || path.relative(directory, await fs.realpath(directory)) !== '') throw corrupt();
  }
  const file = path.join(directory, `${sessionId}.bin`);
  const expected = await fs.lstat(file);
  if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1) throw corrupt();
  if (expected.size > MAX_LOG_BYTES) throw failure('SESSION_EXPORT_TOO_LARGE', '原生会话记录超过 24 MiB，可选择 TXT 等格式导出可见聊天。');
  const handle = await fs.open(file, 'r');
  let bytes;
  try {
   if (!sameFile(expected, await handle.stat())) throw corrupt();
   bytes = Buffer.allocUnsafe(expected.size + 1);
   let offset = 0;
   while (offset < bytes.length) {
    const {bytesRead} = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
   }
   if (offset !== expected.size || !sameFile(expected, await handle.stat()) || !sameFile(expected, await fs.lstat(file)) ||
       path.relative(file, await fs.realpath(file)) !== '') throw corrupt();
  } finally {await handle.close();}
  const record = decodeBridge(bytes.subarray(0, expected.size), key);
  validateHistoryRecord(sessionId, record);
  return record;
 } catch (error) {
  if (error.code === 'ENOENT') throw missing();
  if (error.code === 'SESSION_EXPORT_TOO_LARGE') throw error;
  throw corrupt();
 }
}

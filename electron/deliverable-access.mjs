import fs from 'node:fs/promises';
import path from 'node:path';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readBridge} from '../harness/privacy-bridge.mjs';
import {within} from '../harness/file-policy.mjs';
import {projectContext} from '../src/project-core.js';

const require = createRequire(import.meta.url);
const harnessRequire = createRequire(require.resolve('@deepseek-ai/dsh/lib/bin.js'));
const {assertStoredId, assertVersion, validateStoredEvents, assertContiguous} = await import(
 pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-session-persistence')).href
);
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const PRIVATE = /(?:^|[\\/])(?:\.ssh|\.aws|\.azure|vaults|\.git)(?:[\\/]|$)|(?:^|[\\/])(?:\.env(?:\..*)?|.*\.(?:pem|key|pfx)|deepseek\.credential|workspace\.bin|automations\.bin|privacy-bridge\.bin)$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const isId = value => typeof value === 'string' && ID.test(value);

function failure(code, message) {
 return Object.assign(new Error(message), {code});
}

function sameFile(left, right) {
 return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Host-only access to files declared by native present events. root is the
 * application's zhixing data root, not a project directory. Both callbacks
 * must read host state. No renderer-supplied path grants filesystem access.
 */
export class DeliverableAccess {
 constructor({root, getWorkspace, readVault}) {
  if (!path.isAbsolute(root || '') || typeof getWorkspace !== 'function' || typeof readVault !== 'function') {
   throw new TypeError('Deliverable access requires an absolute data root and host state readers.');
  }
  this.root = path.resolve(root);
  this.getWorkspace = getWorkspace;
  this.readVault = readVault;
 }

 async scope(options) {
  if (!options || !isId(options.sessionId) || !isId(options.workspaceId)
   || (options.projectId != null && !isId(options.projectId))) {
   throw failure('DELIVERABLE_SCOPE', '请从所属会话打开交付文件。');
  }
  const state = await this.getWorkspace();
  const chat = state?.chats?.find(item => item.id === options.sessionId);
  if (!chat || chat.workspaceId !== options.workspaceId || (chat.projectId || null) !== (options.projectId || null)) {
   throw failure('DELIVERABLE_SCOPE', '交付文件不属于当前会话或项目。');
  }
  projectContext(state, options);
  return {workspaceId: options.workspaceId, projectId: options.projectId || null, sessionId: options.sessionId};
 }

 async history(scope, mode, key) {
  const directory = path.join(this.root, 'harness', scope.sessionId, `history-${mode}`);
  let files;
  try { files = await fs.readdir(directory, {withFileTypes: true}); }
  catch (error) {
   if (error.code === 'ENOENT') return [];
   throw error;
  }
  const root = await fs.realpath(this.root);
  const records = new Map();
  for (const file of files) {
   if (!file.name.endsWith('.bin') || !ID.test(file.name.slice(0, -4))) continue;
   if (!file.isFile() || file.isSymbolicLink()) throw failure('DELIVERABLE_HISTORY', '交付历史包含无效文件。');
   const target = await fs.realpath(path.join(directory, file.name));
   if (!within(root, target)) throw failure('DELIVERABLE_HISTORY', '交付历史不在本机应用目录内。');
   const id = file.name.slice(0, -4);
   let record;
   try {
    record = await readBridge(target, key);
    assertStoredId(id, record.header);
    assertVersion(record.header);
    validateStoredEvents(record.header, record.events);
    assertContiguous(id, record.events, 0);
   } catch {
    throw failure('DELIVERABLE_HISTORY', '原生交付历史无法验证，请重新交付文件。');
   }
   records.set(id, record);
  }
  if (!records.has(scope.sessionId)) return [];
  const belongs = record => {
   const seen = new Set();
   while (record && !seen.has(record.header.id)) {
    if (record.header.id === scope.sessionId) return true;
    seen.add(record.header.id);
    if (record.header.origin !== 'subagent') return false;
    record = records.get(record.header.parentSession);
   }
   return false;
  };
  return [...records.values()].filter(belongs);
 }

 async entries(options) {
  const scope = await this.scope(options);
  const vault = await this.readVault(scope.sessionId);
  if (!vault?.historyKey) return {scope, entries: []};
  if (!/^[a-f0-9]{64}$/i.test(vault.historyKey)) throw failure('DELIVERABLE_HISTORY', '本机会话密钥无效。');
  const entries = [];
  for (const mode of ['redact', 'raw']) {
   for (const record of await this.history(scope, mode, vault.historyKey)) {
    for (const event of record.events) {
     if (event.type !== 'deliverables/presented') continue;
     if (!Array.isArray(event.data?.files)) throw failure('DELIVERABLE_HISTORY', '原生交付记录格式无效。');
     event.data.files.forEach((file, index) => {
      entries.push({file, mode, sequence: event.seq, index, historySessionId: record.header.id, createdAt: record.header.createdAt});
     });
    }
   }
  }
  return {scope, key: vault.historyKey, entries};
 }

 async fileInfo(file) {
  if (typeof file?.path !== 'string' || file.path.includes('\0') || file.path.length > 32767 || !path.isAbsolute(file.path)) {
   throw failure('DELIVERABLE_PATH', '原生交付记录没有有效的绝对文件路径。');
  }
  if (PRIVATE.test(file.path) || path.parse(file.path).root.startsWith('\\\\')
   || path.relative(path.parse(file.path).root, file.path).includes(':') || within(this.root, path.resolve(file.path))) {
   throw failure('DELIVERABLE_PRIVATE', '此交付位置包含应用私密记录、凭证或不支持的文件地址。');
  }
  const stat = await fs.lstat(file.path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw failure('DELIVERABLE_FILE', '交付文件已变为链接或非普通文件，请重新交付。');
  const target = await fs.realpath(file.path);
  if (PRIVATE.test(file.path) || PRIVATE.test(target) || within(await fs.realpath(this.root), target)
   || path.parse(target).root.startsWith('\\\\') || path.relative(path.parse(target).root, target).includes(':')) {
   throw failure('DELIVERABLE_PRIVATE', '此交付位置包含应用私密记录、凭证或不支持的文件地址。');
  }
  return {target, stat};
 }

 reference(scope, key, entry, target) {
  const payload = JSON.stringify([scope.workspaceId, scope.projectId, scope.sessionId, entry.mode,
   entry.historySessionId, entry.createdAt, entry.sequence, entry.index, entry.file.path, target]);
  const signature = createHmac('sha256', Buffer.from(key, 'hex')).update(payload).digest('hex');
  return ['zx-delivery-v1', entry.mode, entry.historySessionId, entry.sequence, entry.index, signature].join('.');
 }

 async list(options) {
  const {scope, key, entries} = await this.entries(options);
  const files = [];
  for (const entry of entries) {
   const file = {name: path.basename(String(entry.file?.path || '')), path: typeof entry.file?.path === 'string' ? entry.file.path : '',
    description: String(entry.file?.description || '').slice(0, 300)};
   try {
    const {target, stat} = await this.fileInfo(entry.file);
    files.push({...file, id: this.reference(scope, key, entry, target), available: true, size: stat.size});
   } catch (error) {
    files.push({...file, id: null, available: false, reason: error.code === 'ENOENT' ? '交付文件已不存在。' : error.message});
   }
  }
  await this.scope(scope);
  return files;
 }

 async readBytes(options) {
  if (typeof options?.id !== 'string' || options.id.length > 300) throw failure('DELIVERABLE_REFERENCE', '交付引用无效，请刷新产出列表。');
  const parts = options.id.split('.');
  if (parts.length !== 6 || parts[0] !== 'zx-delivery-v1' || !['redact', 'raw'].includes(parts[1]) || !ID.test(parts[2])
   || !/^(0|[1-9]\d*)$/.test(parts[3]) || !/^(0|[1-9]\d*)$/.test(parts[4]) || !/^[a-f0-9]{64}$/.test(parts[5])) {
   throw failure('DELIVERABLE_REFERENCE', '交付引用无效，请刷新产出列表。');
  }
  const {scope, key, entries} = await this.entries(options);
  const entry = entries.find(item => item.mode === parts[1] && item.historySessionId === parts[2]
   && item.sequence === Number(parts[3]) && item.index === Number(parts[4]));
  if (!entry) throw failure('DELIVERABLE_REFERENCE', '此会话没有对应的原生交付记录。');
  const {target, stat: expected} = await this.fileInfo(entry.file);
  const expectedSignature = this.reference(scope, key, entry, target).split('.').at(-1);
  if (!timingSafeEqual(Buffer.from(parts[5], 'hex'), Buffer.from(expectedSignature, 'hex'))) {
   throw failure('DELIVERABLE_REFERENCE', '交付引用或文件位置已变化，请刷新产出列表。');
  }
  const handle = await fs.open(target, 'r');
  let bytes;
  try {
   const before = await handle.stat();
   if (!before.isFile() || !sameFile(expected, before)) throw failure('DELIVERABLE_CHANGED', '交付文件正在替换，请重试。');
   if (before.size > MAX_BYTES) throw failure('DELIVERABLE_SIZE', '交付预览支持不超过 10 MiB 的文件。');
   const buffer = Buffer.alloc(before.size + 1);
   let read = 0;
   while (read < buffer.length) {
    const {bytesRead} = await handle.read(buffer, read, buffer.length - read, read);
    if (!bytesRead) break;
    read += bytesRead;
   }
   const after = await handle.stat();
   const current = await this.fileInfo(entry.file);
   if (read !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
    || current.target !== target || !sameFile(before, current.stat)) {
    throw failure('DELIVERABLE_CHANGED', '交付文件读取期间发生变化，请重试。');
   }
   bytes = buffer.subarray(0, read);
  } finally {
   await handle.close();
  }
  await this.scope(scope);
  return {id: options.id, name: path.basename(target), path: target, bytes, sessionId: scope.sessionId};
 }

 async read(options) {
  const file = await this.readBytes(options);
  const {parseLocalMaterial} = await import('./office-files.mjs');
  const parsed = await parseLocalMaterial(file.name, file.bytes);
  await this.scope(options);
  return {...parsed, path: file.path, deliverableId: file.id, sessionId: file.sessionId};
 }
}

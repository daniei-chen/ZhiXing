import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { pid as processId } from 'node:process';

const WINDOWS_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
async function renameBridgeTemp(temp, file) {
  let delay = 20;
  for (let retries = 0; ; retries++) {
    try { await fs.rename(temp, file); return; }
    catch (error) {
      if (process.platform !== 'win32' || !WINDOWS_RENAME_ERRORS.has(error?.code) || retries >= 8) throw error;
    }
    // Retry only the commit of this already-encrypted temp; never rerun its producer.
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 200);
  }
}

export function createBridgeKey() { return randomBytes(32).toString('hex'); }
export async function writeBridge(file, key, value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, Buffer.concat([iv, cipher.getAuthTag(), body]),{mode:0o600});
    await renameBridgeTemp(temp, file);
  } finally { await fs.unlink(temp).catch(()=>{}); }
}

// Every read-modify-write holds the same OS-visible lock, including calls from
// sibling agents and the parent gateway. Never merge stale whole-map snapshots.
export async function updateBridge(file,key,update,{signal,timeoutMs=15000}={}) {
  const lock=`${file}.lock`,guard=`${lock}.guard`,deadline=Date.now()+timeoutMs;
  // A distinct name keeps anonymous legacy guards fail-closed. V2 guards are
  // published nonempty and contain only a token-addressed owner entry.
  const recoveryGuard=`${guard}.v2`;
  const owner={pid:processId,token:randomUUID()};
  let releaseGuard;
  for(;;) {
    signal?.throwIfAborted();
    if(Date.now()>=deadline)throw new Error('脱敏映射繁忙，操作已停止。');
    releaseGuard=await acquireLock(recoveryGuard,owner,{deadline,signal});
    try {
      if(await lockStat(guard)) {
        if(await recoverDeadLock(guard))continue;
      } else {
        if(await publishLock(lock,owner,'owner.json'))break;
        if(await recoverDeadLock(lock))continue;
      }
      if(Date.now()>=deadline)throw new Error('脱敏映射繁忙，操作已停止。');
    } finally { await releaseGuard(); }
    await waitForLock(signal,deadline);
  }
  try {
    signal?.throwIfAborted();
    const state=await readBridge(file,key);
    const {state:next,value}=await update(state);
    await writeBridge(file,key,next);
    return value;
  } finally { await releaseOwnedLock(lock,owner,recoveryGuard); }
}

async function acquireLock(lock,owner,{deadline,signal}) {
  for(;;) {
    signal?.throwIfAborted();
    if(Date.now()>=deadline)throw new Error('脱敏映射繁忙，操作已停止。');
    try {
      if(await publishLock(lock,owner,guardEntry(owner)))return () => releaseGuardLock(lock,owner);
      if(await recoverGuardLock(lock))continue;
    } catch(error) {
      // Windows also reports delete-pending guards as EPERM during lstat,
      // readdir or rename. Retry acquisition only, never the update callback.
      if(process.platform!=='win32'||!WINDOWS_RENAME_ERRORS.has(error.code))throw error;
    }
    if(Date.now()>=deadline)throw new Error('脱敏映射繁忙，操作已停止。');
    await waitForLock(signal,deadline);
  }
}

async function lockStat(lock) {
  try { return await fs.lstat(lock); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
}

async function publishLock(lock,owner,entry) {
  if(await lockStat(lock))return false;
  const pending=`${lock}.pending-${owner.pid}-${owner.token}`;
  await fs.mkdir(pending,{mode:0o700});
  let published=false;
  try {
    await fs.writeFile(`${pending}/${entry}`,JSON.stringify(owner),{flag:'wx',mode:0o600});
    try { await fs.rename(pending,lock); published=true; return true; }
    catch(error) {
      // A competing owner may release the directory before this catch runs.
      // The atomic rename already established contention; a later stat cannot
      // undo it. Permission errors still require an existing competing lock.
      if(['EEXIST','ENOTEMPTY'].includes(error.code))return false;
      if(['EPERM','EACCES'].includes(error.code)&&await lockStat(lock))return false;
      throw error;
    }
  } finally {
    // Only this call's unpublished directory; never recursively remove a
    // canonical guard, which could already belong to a different token.
    if(!published) {
      await fs.unlink(`${pending}/${entry}`).catch(error=>{if(error.code!=='ENOENT')throw error;});
      await fs.rmdir(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }
}

function guardEntry(owner) { return `${owner.pid}-${owner.token}.owner`; }

async function removeEmptyGuard(lock) {
  try { await fs.rmdir(lock); return true; }
  catch(error) {
    if(['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))return true;
    // Windows can report a concurrently removed/replaced directory as EPERM.
    // Leaving it for the next acquisition is safe; recursive deletion is not.
    if(process.platform==='win32'&&WINDOWS_RENAME_ERRORS.has(error.code))return false;
    throw error;
  }
}

async function recoverGuardLock(lock) {
  const stat=await lockStat(lock);
  if(!stat)return true;
  if(!stat.isDirectory()||stat.isSymbolicLink())return false;
  let entries;
  try { entries=await fs.readdir(lock); }
  catch(error) { if(error.code==='ENOENT')return true; throw error; }
  if(entries.length===0)return removeEmptyGuard(lock);
  if(entries.length!==1)return false;
  const match=/^([1-9]\d*)-([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\.owner$/.exec(entries[0]);
  if(!match||!Number.isSafeInteger(Number(match[1]))||isProcessAlive(Number(match[1])))return false;
  const entry=`${lock}/${entries[0]}`,entryStat=await lockStat(entry);
  if(!entryStat)return true;
  if(!entryStat.isFile()||entryStat.isSymbolicLink())return false;
  // A stale observer can unlink only the dead token it observed. If another
  // reaper already replaced the guard, its new nonempty directory survives.
  try { await fs.unlink(entry); }
  catch(error) { if(error.code==='ENOENT')return true; throw error; }
  return removeEmptyGuard(lock);
}

async function releaseGuardLock(lock,owner) {
  try { await fs.unlink(`${lock}/${guardEntry(owner)}`); }
  catch(error) { if(error.code==='ENOENT')return; throw error; }
  await removeEmptyGuard(lock);
}

async function recoverDeadLock(lock) {
  // Main/legacy directory renames are serialized by the V2 guard. Applying
  // this rename protocol to the guard itself would permit an ABA live-lock steal.
  const owner=await readLockOwner(lock);
  if(!owner||isProcessAlive(owner.pid))return false;
  const abandoned=`${lock}.abandoned-${randomUUID()}`;
  try { await fs.rename(lock,abandoned); }
  catch(error) { if(error.code==='ENOENT'||error.code==='EEXIST'||error.code==='ENOTEMPTY')return true; throw error; }
  const movedOwner=await readLockOwner(abandoned);
  if(movedOwner?.pid!==owner.pid||movedOwner?.token!==owner.token||isProcessAlive(movedOwner?.pid)) {
    try { await fs.rename(abandoned,lock); }
    catch(error) { if(error.code!=='EEXIST'&&error.code!=='ENOTEMPTY')throw error; }
    return false;
  }
  await fs.rm(abandoned,{recursive:true,force:true});
  return true;
}

async function readLockOwner(lock) {
  try {
    const stat=await fs.lstat(lock);
    if(!stat.isDirectory()||stat.isSymbolicLink())return null;
    const ownerStat=await fs.lstat(`${lock}/owner.json`);
    if(!ownerStat.isFile()||ownerStat.isSymbolicLink())return null;
    const owner=JSON.parse(await fs.readFile(`${lock}/owner.json`,'utf8'));
    if(!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string'||!owner.token)return null;
    return owner;
  } catch { return null; }
}

function isProcessAlive(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)return false;
  try { process.kill(pid,0); return true; }
  catch(error) { return error.code!=='ESRCH'; }
}

async function releaseOwnedLock(lock,owner,guard) {
  // Also serialize retirement with owner readers: on Windows an open owner.json
  // can prevent the directory rename. Cancellation must not skip lock release.
  const releaseGuard=await acquireLock(guard,owner,{deadline:Date.now()+15000});
  const released=`${lock}.released-${owner.token}`;
  try {
    const current=await readLockOwner(lock);
    if(current?.pid!==owner.pid||current.token!==owner.token)return;
    // Retire before deleting the owner, including crashes inside recursive rm.
    await fs.rename(lock,released);
  } finally { await releaseGuard(); }
  await fs.rm(released,{recursive:true,force:true});
}

async function waitForLock(signal,deadline) {
  if(Date.now()>=deadline)throw new Error('脱敏映射繁忙，操作已停止。');
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(done,15);
    function done() { signal?.removeEventListener('abort',abort); resolve(); }
    function abort() { clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason||new Error('操作已停止。')); }
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}
export async function readBridge(file, key) {
  return decodeBridge(await fs.readFile(file), key);
}

export function decodeBridge(raw, key) {
  if (raw.length < 28) throw new Error('工具脱敏映射无法读取。');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8'));
}

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
  const owner={pid:processId,token:randomUUID()};
  let releaseGuard;
  for(;;) {
    signal?.throwIfAborted();
    releaseGuard=await acquireLock(guard,owner,{deadline,signal});
    try {
      try {
        await fs.mkdir(lock);
        await fs.writeFile(`${lock}/owner.json`,JSON.stringify(owner),{flag:'wx',mode:0o600});
        break;
      } catch(error) {
        if(error.code!=='EEXIST')throw error;
        if(await recoverDeadLock(lock))continue;
        if(Date.now()>=deadline)throw new Error('脱敏映射繁忙，操作已停止。');
      }
    } finally { await releaseGuard(); }
    await waitForLock(signal,deadline);
  }
  try {
    signal?.throwIfAborted();
    const state=await readBridge(file,key);
    const {state:next,value}=await update(state);
    await writeBridge(file,key,next);
    return value;
  } finally { await releaseOwnedLock(lock,owner); }
}

async function acquireLock(lock,owner,{deadline,signal}) {
  for(;;) {
    signal?.throwIfAborted();
    try {
      await fs.mkdir(lock);
      try { await fs.writeFile(`${lock}/owner.json`,JSON.stringify(owner),{flag:'wx',mode:0o600}); }
      catch(error) { await fs.rm(lock,{recursive:true,force:true}); throw error; }
      return () => releaseOwnedLock(lock,owner);
    } catch(error) {
      if(error.code!=='EEXIST')throw error;
      if(await recoverDeadLock(lock))continue;
      if(Date.now()>=deadline)throw new Error('脱敏映射繁忙，操作已停止。');
      await waitForLock(signal,deadline);
    }
  }
}

async function recoverDeadLock(lock) {
  const owner=await readLockOwner(lock);
  if(!owner||isProcessAlive(owner.pid))return false;
  const abandoned=`${lock}.abandoned-${randomUUID()}`;
  try { await fs.rename(lock,abandoned); }
  catch(error) { if(error.code==='ENOENT'||error.code==='EEXIST'||error.code==='ENOTEMPTY')return true; throw error; }
  const movedOwner=await readLockOwner(abandoned);
  if(movedOwner?.token!==owner.token||isProcessAlive(movedOwner?.pid)) {
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
    const owner=JSON.parse(await fs.readFile(`${lock}/owner.json`,'utf8'));
    if(!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string')return null;
    return owner;
  } catch { return null; }
}

function isProcessAlive(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)return false;
  try { process.kill(pid,0); return true; }
  catch(error) { return error.code==='EPERM'; }
}

async function releaseOwnedLock(lock,owner) {
  const current=await readLockOwner(lock);
  if(current?.token===owner.token)await fs.rm(lock,{recursive:true,force:true});
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
  const raw = await fs.readFile(file);
  if (raw.length < 28) throw new Error('工具脱敏映射无法读取。');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8'));
}

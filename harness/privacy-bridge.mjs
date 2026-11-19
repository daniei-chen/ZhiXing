import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

export function createBridgeKey() { return randomBytes(32).toString('hex'); }
export async function writeBridge(file, key, value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, Buffer.concat([iv, cipher.getAuthTag(), body]),{mode:0o600});
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(()=>{}); }
}

// Every read-modify-write holds the same OS-visible lock, including calls from
// sibling agents and the parent gateway. Never merge stale whole-map snapshots.
export async function updateBridge(file,key,update,{signal,timeoutMs=15000}={}) {
  const lock=`${file}.lock`,deadline=Date.now()+timeoutMs;
  for(;;) {
    signal?.throwIfAborted();
    try { await fs.mkdir(lock); break; }
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      if(Date.now()>=deadline)throw new Error('脱敏映射繁忙，操作已停止。');
      await new Promise(resolve=>setTimeout(resolve,15));
    }
  }
  try {
    signal?.throwIfAborted();
    const state=await readBridge(file,key);
    const {state:next,value}=await update(state);
    await writeBridge(file,key,next);
    return value;
  } finally { await fs.rmdir(lock); }
}
export async function readBridge(file, key) {
  const raw = await fs.readFile(file);
  if (raw.length < 28) throw new Error('工具脱敏映射无法读取。');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8'));
}

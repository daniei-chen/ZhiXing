// NSIS 卸载器/安装器会在 %TEMP% 里留下临时目录：~nsu.tmp 是卸载器副本，
// 安装过程中的 nsXXXX.tmp 目录会在正常退出时删掉，但本机实测每次安装/升级都
// 留下一个，里面是 200 KB 的 old-uninstaller.exe。
//
// 只清**能证明是知行留下的**那一份：
//   1. 目录名必须是 NSIS 的形状（~nsu.tmp 或 nsXXXX.tmp）；
//   2. 里面的可执行文件字节里要含 UTF-16 的「知行」或 UTF-8 的 zhixing；
//   3. 目录至少 10 分钟没被写过，避免和正在进行的安装/卸载抢文件；
//   4. 删除失败（被占用）就原样留着，只记日志。
//
// 任何一条不满足就跳过，别家应用的 NSIS 临时目录同样叫这些名字。
import fs from 'node:fs/promises';
import path from 'node:path';

const STUCK = '~nsu.tmp';
const DEFAULT_MARKERS = ['知行', 'zhixing'];
const CANDIDATE = /^(?:~nsu\.tmp|ns[a-z0-9]{4,}\.tmp)$/i;

export function containsMarker(bytes, markers = DEFAULT_MARKERS) {
  for (const marker of markers) {
    if (bytes.includes(Buffer.from(marker, 'utf16le'))) return true;
    if (bytes.includes(Buffer.from(marker, 'utf8'))) return true;
  }
  return false;
}

/** NSIS 临时目录名是否是我们要看的形状。 */
export function isNsisTempName(name) {
  return typeof name === 'string' && CANDIDATE.test(name);
}

/**
 * 决定要不要清理；纯函数，便于在源码层把三种情况钉死。
 * entries: [{relativePath, size, bytes?}]，只把候选可执行文件的内容传进来。
 */
export function judgeStuckUninstaller({ exists, newestMtimeMs, now, minAgeMs = 10 * 60 * 1000, ours }) {
  if (!exists) return { remove: false, reason: 'missing' };
  if (!(now - newestMtimeMs >= minAgeMs)) return { remove: false, reason: 'recent' };
  if (!ours) return { remove: false, reason: 'not-ours' };
  return { remove: true, reason: 'stale-uninstaller-copy' };
}

async function readCandidates(directory) {
  const found = [];
  let items;
  try {
    items = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return found;
    throw error;
  }
  for (const item of items) {
    if (!item.isFile()) continue;
    if (!/\.exe$/i.test(item.name)) continue;
    found.push(path.join(directory, item.name));
  }
  return found;
}

// 判断一个候选目录：字节数、是否我们、最新写入时间、结论。
async function inspect(directory, { now, minAgeMs, markers, maxBytes }) {
  const stat = await fs.stat(directory).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));
  if (!stat || !stat.isDirectory()) return { name: path.basename(directory), reason: 'missing', bytes: 0 };
  let newestMtimeMs = stat.mtimeMs;
  let totalBytes = 0;
  const executables = await readCandidates(directory);
  for (const file of executables) {
    const info = await fs.stat(file).catch(() => null);
    if (!info) continue;
    newestMtimeMs = Math.max(newestMtimeMs, info.mtimeMs);
    totalBytes += info.size;
  }
  let ours = false;
  for (const file of executables) {
    if (ours) break;
    const info = await fs.stat(file).catch(() => null);
    if (!info || info.size > maxBytes) continue;
    const bytes = await fs.readFile(file).catch(() => null);
    if (bytes && containsMarker(bytes, markers)) ours = true;
  }
  const verdict = judgeStuckUninstaller({ exists: true, newestMtimeMs, now, minAgeMs, ours });
  return { name: path.basename(directory), remove: verdict.remove, reason: verdict.reason, bytes: totalBytes, files: executables.length };
}

/**
 * 清理 %TEMP% 里属于知行的 NSIS 临时目录。
 * 返回结构化结果，不抛异常给启动路径。
 */
export async function pruneStuckUninstaller({ tempDir, now = Date.now(), minAgeMs = 10 * 60 * 1000, markers = DEFAULT_MARKERS, maxBytes = 64 * 1024 * 1024 }) {
  if (!tempDir) return { removed: false, reason: 'no-temp-dir' };
  let items;
  try {
    items = await fs.readdir(tempDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { removed: false, reason: 'no-temp-dir' };
    throw error;
  }
  const names = items.filter(item => item.isDirectory() && isNsisTempName(item.name)).map(item => item.name);
  if (!names.length) return { removed: false, reason: 'missing', removedDirectories: [], skipped: [] };

  const removedDirectories = [];
  const skipped = [];
  for (const name of names) {
    const verdict = await inspect(path.join(tempDir, name), { now, minAgeMs, markers, maxBytes });
    if (!verdict.remove) {
      skipped.push({ name: verdict.name, reason: verdict.reason });
      continue;
    }
    try {
      await fs.rm(path.join(tempDir, name), { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
      removedDirectories.push({ name: verdict.name, bytes: verdict.bytes, files: verdict.files });
    } catch (error) {
      skipped.push({ name: verdict.name, reason: error.code === 'EPERM' || error.code === 'EBUSY' ? 'in-use' : 'delete-failed' });
    }
  }
  const bytes = removedDirectories.reduce((total, item) => total + item.bytes, 0);
  if (!removedDirectories.length) {
    return { removed: false, reason: skipped[0]?.reason ?? 'missing', removedDirectories, skipped };
  }
  return { removed: true, reason: 'stale-uninstaller-copy', bytes, files: removedDirectories.reduce((total, item) => total + item.files, 0), removedDirectories, skipped };
}

// NSIS 卸载器运行前会把自己复制到 %TEMP%\~nsu.tmp\Un_A.exe，正常退出时删掉。
// 本机 0.14.5 卸载完，这个目录连同 200 KB 的 Un_A.exe 一直留着（04:53 写入，
// 05:24 仍在）。启动时清掉**能证明是知行留下的**那一份：
//
//   1. 目录名必须是 NSIS 固定的 ~nsu.tmp；
//   2. 里面的可执行文件字节里要含 UTF-16 的「知行」，或其他 NSIS 卸载器不会有
//      的产品名标记——别的应用的 NSIS 卸载器也在用同一个目录名，不能凭名字删；
//   3. 目录至少 10 分钟没被写过，避免和正在进行的安装/卸载抢文件。
//
// 任何一条不满足就原样留着，只记日志。
import fs from 'node:fs/promises';
import path from 'node:path';

const STUCK = '~nsu.tmp';
const DEFAULT_MARKERS = ['知行', 'zhixing'];

export function containsMarker(bytes, markers = DEFAULT_MARKERS) {
  for (const marker of markers) {
    if (bytes.includes(Buffer.from(marker, 'utf16le'))) return true;
    if (bytes.includes(Buffer.from(marker, 'utf8'))) return true;
  }
  return false;
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

/**
 * 清理卡住的 ~nsu.tmp。返回结构化结果，不抛异常给启动路径。
 */
export async function pruneStuckUninstaller({ tempDir, now = Date.now(), minAgeMs = 10 * 60 * 1000, markers = DEFAULT_MARKERS, maxBytes = 64 * 1024 * 1024 }) {
  if (!tempDir) return { removed: false, reason: 'no-temp-dir' };
  const target = path.join(tempDir, STUCK);
  const stat = await fs.stat(target).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));
  if (!stat || !stat.isDirectory()) return { removed: false, reason: 'missing' };
  let newestMtimeMs = stat.mtimeMs;
  let totalBytes = 0;
  const executables = await readCandidates(target);
  for (const file of executables) {
    const info = await fs.stat(file).catch(() => null);
    if (info) { newestMtimeMs = Math.max(newestMtimeMs, info.mtimeMs); totalBytes += info.size; }
  }
  // 只读可执行文件的头部做标记判断：卸载器 stub 几百 KB，不需要整份读入。
  let ours = false;
  for (const file of executables) {
    if (ours) break;
    const info = await fs.stat(file).catch(() => null);
    if (!info || info.size > maxBytes) continue;
    const bytes = await fs.readFile(file).catch(() => null);
    if (bytes && containsMarker(bytes, markers)) ours = true;
  }
  const verdict = judgeStuckUninstaller({ exists: true, newestMtimeMs, now, minAgeMs, ours });
  if (!verdict.remove) return { removed: false, reason: verdict.reason, bytes: totalBytes };
  await fs.rm(target, { recursive: true, force: true });
  return { removed: true, reason: verdict.reason, bytes: totalBytes, files: executables.length };
}

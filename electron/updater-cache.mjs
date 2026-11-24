// 自动更新下载的安装包会留在 %LOCALAPPDATA%\<updaterCacheDirName>\pending 下，
// electron-updater 装完不清理。本机实测：一个 0.13.8 的 323 MB 安装包从上一个
// 版本一直留到 0.14.3。这里只做一件事——启动时删掉已经用不到的缓存：
//
//   1. 版本不高于当前正在运行的版本（已经装过了，再装一次没有意义）；
//   2. 或者超过保留期的陈旧下载（版本号解析不出来时唯一的判据）；
//   3. 没有留下任何待装安装包时，连同 update-info.json、current.blockmap 一起删。
//
// 正在下载的更新不会被误删：它比当前版本新，而且刚写入不到保留期。
import fs from 'node:fs/promises';
import path from 'node:path';

// 只取数字段：文件名里的预发布尾巴（-rc.5、-x64）与版本语义无关，
// 清理决策只需要「是不是已经装过的版本」，取数字段最不容易出错。
const VERSION = /(\d+)\.(\d+)\.(\d+)/;
const DAY = 24 * 60 * 60 * 1000;

export function versionInName(name) {
  const match = VERSION.exec(String(name ?? ''));
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '';
}

function parts(version) {
  const [core, pre = ''] = String(version).split('-');
  const numbers = core.split('.').map(value => Number.parseInt(value, 10) || 0);
  while (numbers.length < 3) numbers.push(0);
  return { numbers, pre };
}

// 预发布版低于同号正式版，与 semver 一致。
export function compareVersions(left, right) {
  const a = parts(left), b = parts(right);
  for (let index = 0; index < 3; index++) if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1;
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}

/**
 * 纯决策：给定缓存里的文件和当前版本，算出该删什么。
 * entries: [{relativePath, size, mtimeMs}]
 */
export function planCachePrune({ entries, currentVersion, now = Date.now(), keepDays = 7 }) {
  const horizon = now - keepDays * DAY;
  const remove = [], keep = [];
  for (const entry of entries) {
    const version = versionInName(path.basename(entry.relativePath));
    if (version) {
      if (compareVersions(version, currentVersion) <= 0) remove.push({ ...entry, reason: 'installed', version });
      else if (!(entry.mtimeMs >= horizon)) remove.push({ ...entry, reason: 'expired', version });
      else keep.push({ ...entry, version });
    } else {
      keep.push({ ...entry, version: '' });
    }
  }
  // 待装安装包全部删掉时，剩下的元数据没有意义；还有待装的就必须一起留着。
  const pendingLeft = keep.some(entry => entry.version);
  if (!pendingLeft) {
    for (const entry of keep.filter(item => !item.version)) remove.push({ ...entry, reason: 'orphaned-metadata' });
  }
  const removedPaths = new Set(remove.map(entry => entry.relativePath));
  const kept = keep.filter(entry => !removedPaths.has(entry.relativePath));
  const removedBytes = remove.reduce((total, entry) => total + (entry.size || 0), 0);
  return { remove, keep: kept, removedBytes };
}

async function collect(directory, prefix = '') {
  const entries = [];
  let items;
  try {
    items = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return entries;
    throw error;
  }
  for (const item of items) {
    const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
    const absolute = path.join(directory, item.name);
    // 不跟随符号链接：缓存目录里不该有，跟随就等于让清理越界。
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) {
      entries.push(...await collect(absolute, relativePath));
      continue;
    }
    const stat = await fs.stat(absolute);
    entries.push({ relativePath, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return entries;
}

/**
 * 执行清理。返回删除清单与释放的字节数，不抛异常给启动路径。
 */
export async function pruneUpdateCache({ cacheDir, currentVersion, now = Date.now(), keepDays = 7 }) {
  const entries = await collect(cacheDir);
  const plan = planCachePrune({ entries, currentVersion, now, keepDays });
  const removed = [];
  for (const entry of plan.remove) {
    const absolute = path.join(cacheDir, entry.relativePath);
    try {
      await fs.rm(absolute, { force: true });
      removed.push({ relativePath: entry.relativePath, reason: entry.reason, size: entry.size });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  // 空掉的 pending 目录一并收走；rmdir 只在空目录上成功，不会误删正在写入的目录。
  await fs.rmdir(path.join(cacheDir, 'pending')).catch(() => {});
  return { removed, removedBytes: removed.reduce((total, entry) => total + entry.size, 0), kept: plan.keep.map(entry => entry.relativePath) };
}

/**
 * 缓存目录名由打包时生成的 app-update.yml 决定（updaterCacheDirName），
 * 不能按应用名猜。读不到就返回 null，启动路径据此跳过清理。
 */
export async function updaterCacheDir({ resourcesPath, localAppData = process.env.LOCALAPPDATA } = {}) {
  if (!resourcesPath || !localAppData) return null;
  const text = await fs.readFile(path.join(resourcesPath, 'app-update.yml'), 'utf8').catch(() => '');
  const name = /^\s*updaterCacheDirName:\s*(\S+)\s*$/m.exec(text)?.[1];
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') return null;
  return path.join(localAppData, name);
}

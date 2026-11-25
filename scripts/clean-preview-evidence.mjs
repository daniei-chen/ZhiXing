// 清理 .preview 下的二进制证据副本：安装包、解包目录、语音模型。
// 文本证据（json/png/md/patch/log）一律保留——发布资产已经在 GitHub release 上，
// 仓库里不需要再放一份 338 MB 的安装器。
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.join(process.cwd(), '.preview');
const BINARY = /\.(exe|msi|blockmap|zip|7z|onnx|dmg|appx)$/i;
const dryRun = process.argv.includes('--dry-run');
// 当前版本的发布资产副本留着，删掉就没法本地复核远端 digest。
const keepReleaseAssets = process.argv.includes('--keep-release-assets');

async function walk(directory) {
  const files = [];
  let items;
  try { items = await fs.readdir(directory, { withFileTypes: true }); } catch { return files; }
  for (const item of items) {
    const full = path.join(directory, item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) { files.push(...await walk(full)); continue; }
    files.push(full);
  }
  return files;
}

const files = await walk(root);
const targets = [];
for (const file of files) {
  if (!BINARY.test(file)) continue;
  if (keepReleaseAssets && file.includes(`release-assets`)) continue;
  let stat;
  try { stat = await fs.stat(file); } catch { continue; }
  targets.push({ file, size: stat.size });
}
targets.sort((a, b) => b.size - a.size);
const totalBytes = targets.reduce((sum, item) => sum + item.size, 0);

const byExt = {};
for (const item of targets) {
  const ext = path.extname(item.file).toLowerCase();
  byExt[ext] = byExt[ext] || { files: 0, bytes: 0 };
  byExt[ext].files += 1;
  byExt[ext].bytes += item.size;
}

if (!dryRun) for (const item of targets) await fs.rm(item.file, { force: true });

// 删空的目录（只删空目录，非空说明还有文本证据）。
async function pruneEmpty(directory) {
  let items;
  try { items = await fs.readdir(directory, { withFileTypes: true }); } catch { return 0; }
  let removed = 0;
  for (const item of items) if (item.isDirectory()) removed += await pruneEmpty(path.join(directory, item.name));
  if (directory === root) return removed;
  const left = await fs.readdir(directory).catch(() => ['x']);
  if (!left.length) { await fs.rmdir(directory).catch(() => {}); return removed + 1; }
  return removed;
}
const removedDirs = dryRun ? 0 : await pruneEmpty(root);

console.log(JSON.stringify({
  dryRun,
  files: targets.length,
  reclaimedMB: Number((totalBytes / 1024 / 1024).toFixed(1)),
  byExt: Object.fromEntries(Object.entries(byExt).map(([ext, row]) => [ext, { files: row.files, MB: Number((row.bytes / 1024 / 1024).toFixed(1)) }])),
  removedDirs,
  biggest: targets.slice(0, 5).map(item => ({ file: item.file.replace(process.cwd() + path.sep, ''), MB: Number((item.size / 1024 / 1024).toFixed(1)) })),
}, null, 1));

// 开发机上历史遗留的更新缓存清理：改名前的构建用 updaterCacheDirName=office-agent-updater，
// 改名后实际写的是 app-update.yml 里的 zhixing-updater，旧目录再也不会被启动清理碰到。
//
// 只删能证明是本项目的：目录名必须是 office-agent-updater，并且目录里的可执行文件字节
// 含 UTF-16「知行」或 UTF-8「zhixing」标记。不满足就只报告，不动文件。
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const legacyName = 'office-agent-updater';
const localAppData = process.env.LOCALAPPDATA;
const dryRun = process.argv.includes('--dry-run');
const result = { legacyName, directory: null, marker: false, files: [], reclaimedMB: 0, action: 'skipped' };

if (!localAppData) {
  console.log(JSON.stringify({ ...result, action: 'no-localappdata' }, null, 1));
  process.exit(0);
}
const directory = path.join(localAppData, legacyName);
result.directory = directory;
if (!fsSync.existsSync(directory)) {
  console.log(JSON.stringify({ ...result, action: 'absent' }, null, 1));
  process.exit(0);
}

async function walk(current) {
  const out = [];
  for (const item of await fs.readdir(current, { withFileTypes: true })) {
    const full = path.join(current, item.name);
    if (item.isDirectory()) { out.push(...await walk(full)); continue; }
    out.push(full);
  }
  return out;
}

const files = await walk(directory);
for (const file of files) {
  const stat = fsSync.statSync(file);
  result.files.push({ file: path.relative(directory, file), MB: Number((stat.size / 1024 / 1024).toFixed(1)) });
  if (/\.exe$/i.test(file) && !result.marker) {
    // 只读头部与尾部各 8 MB：安装器体积大，全量读没必要，标记在文件头。
    const fd = fsSync.openSync(file, 'r');
    try {
      const head = Buffer.alloc(Math.min(8 * 1024 * 1024, stat.size));
      fsSync.readSync(fd, head, 0, head.length, 0);
      result.marker = head.includes(Buffer.from('知行', 'utf16le')) || head.includes(Buffer.from('zhixing'));
    } finally { fsSync.closeSync(fd); }
  }
}

if (!result.marker) {
  console.log(JSON.stringify({ ...result, action: 'unproven-left-alone' }, null, 1));
  process.exit(0);
}
if (dryRun) {
  console.log(JSON.stringify({ ...result, action: 'would-remove' }, null, 1));
  process.exit(0);
}
let bytes = 0;
for (const file of files) bytes += fsSync.statSync(file).size;
await fs.rm(directory, { recursive: true, force: true });
console.log(JSON.stringify({ ...result, action: 'removed', reclaimedMB: Number((bytes / 1024 / 1024).toFixed(1)) }, null, 1));

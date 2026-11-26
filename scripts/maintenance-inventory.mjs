#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAINTENANCE_TARGETS = Object.freeze(['release', '.preview', '.zhixing-pack-check']);

const repository = fileURLToPath(new URL('..', import.meta.url));
const BINARY = /\.(exe|msi|blockmap|dmg|appx)$/i;
const ARCHIVE = /\.(zip|7z|tar|gz)$/i;
const EVIDENCE = /\.(json|png|jpe?g|webp|log|md|patch|txt|ya?ml)$/i;

function retention(relative) {
  const parts = relative.toLowerCase().split('/');
  if (parts.some((part) => /(?:profile|backup|fixture|vault|user-shortcuts)/.test(part))) {
    return {
      category: 'protected-data',
      retainReason: '可能包含档案、备份或验收夹具，未确认可恢复前保留。',
    };
  }
  if (EVIDENCE.test(relative) || /(^|\/)sha256sums[^/]*$/i.test(relative)) {
    return { category: 'audit-evidence', retainReason: '验收、诊断或校验资料，保留以便复核。' };
  }
  if (/\.onnx$/i.test(relative)) {
    return {
      category: 'runtime-model',
      retainReason: '模型来源、校验值和重新下载能力尚未核对，保留。',
    };
  }
  if (BINARY.test(relative) || parts.includes('release-assets')) {
    return {
      category: 'release-asset',
      retainReason: '未核对版本、远端副本、哈希及使用状态，不据扩展名删除。',
    };
  }
  if (ARCHIVE.test(relative)) {
    return { category: 'archive', retainReason: '归档内容与可恢复性未读取、未验证，保留。' };
  }
  if (parts.includes('win-unpacked') || parts[0] === '.zhixing-pack-check') {
    return {
      category: 'unpacked-build',
      retainReason: '可能用于包内复核或正在被使用，未验证可重建前保留。',
    };
  }
  return { category: 'unclassified', retainReason: '归属与用途尚未核对，保留。' };
}

// This is a metadata inventory, not a deletion plan. The CLI always uses this
// script's repository; the explicit root and I/O adapter are for fixture tests.
export async function createMaintenanceInventory({ root = repository, io = fs } = {}) {
  const report = {
    schemaVersion: 1,
    mode: 'read-only',
    status: 'complete',
    generatedAt: new Date().toISOString(),
    repository: path.resolve(root),
    scope: [...MAINTENANCE_TARGETS],
    contentsRead: false,
    hashesComputed: false,
    measure: 'logical-regular-file-bytes',
    boundaries: [
      '仅统计固定目录中的普通文件；不跟随符号链接或 junction。',
      '大小为逻辑文件大小，不代表可回收的物理磁盘空间。',
      '不读取文件内容，不证明远端副本、可重建性或没有进程使用。',
      '元数据不是原子快照；发现读取失败或路径变化时明确报告。',
      '本清单不授权删除，所有条目均保留。',
    ],
    targets: [],
    files: [],
    skipped: [],
    errors: [],
    totals: { files: 0, bytes: 0, directories: 0, skipped: 0 },
  };
  const error = (relative, operation, cause) => {
    report.status = 'incomplete';
    report.errors.push({ path: relative, operation, code: cause?.code || 'UNKNOWN' });
  };
  const changed = () =>
    Object.assign(new Error('Path changed during inventory'), { code: 'PATH_CHANGED' });
  let canonical;
  try {
    const stat = await io.lstat(report.repository);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw Object.assign(new Error('Repository must be a real directory'), {
        code: 'ROOT_NOT_DIRECTORY',
      });
    }
    canonical = await io.realpath(report.repository);
    report.repository = canonical;
  } catch (cause) {
    error('.', 'validate-root', cause);
    return report;
  }

  async function inspect(relative, target) {
    const absolute = path.join(canonical, ...relative.split('/'));
    let info;
    try {
      info = await io.lstat(absolute);
    } catch (cause) {
      if (relative === target.path && cause?.code === 'ENOENT') target.status = 'absent';
      else error(relative, 'lstat', cause);
      return;
    }
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      report.skipped.push({
        path: relative,
        type: info.isSymbolicLink() ? 'symbolic-link' : 'non-regular',
        mtime: info.mtime.toISOString(),
        retainReason: '不跟随链接，不读取特殊文件，保持原样。',
      });
      if (relative === target.path) target.status = 'skipped';
      return;
    }
    // Check the canonical path and identity around each directory listing;
    // never knowingly traverse a link substituted after lstat.
    const samePath = async () => {
      const actual = await io.realpath(absolute);
      const current = await io.lstat(absolute);
      if (
        actual !== absolute ||
        current.isSymbolicLink() ||
        current.dev !== info.dev ||
        current.ino !== info.ino ||
        current.isDirectory() !== info.isDirectory() ||
        current.isFile() !== info.isFile()
      )
        throw changed();
    };
    try {
      await samePath();
    } catch (cause) {
      error(relative, 'validate-path', cause);
      return;
    }
    if (info.isFile()) {
      report.files.push({
        path: relative,
        sizeBytes: info.size,
        mtime: info.mtime.toISOString(),
        retain: true,
        ...retention(relative),
      });
      report.totals.bytes += info.size;
      if (relative === target.path) target.status = 'file';
      return;
    }
    let entries;
    try {
      entries = await io.readdir(absolute, { withFileTypes: true });
    } catch (cause) {
      error(relative, 'readdir', cause);
      return;
    }
    try {
      await samePath();
    } catch (cause) {
      error(relative, 'validate-path-after-readdir', cause);
      return;
    }
    report.totals.directories++;
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      await inspect(`${relative}/${entry.name}`, target);
    }
  }

  for (const relative of MAINTENANCE_TARGETS) {
    const target = { path: relative, status: 'scanned' };
    report.targets.push(target);
    const errorsBefore = report.errors.length;
    await inspect(relative, target);
    if (report.errors.length > errorsBefore) target.status = 'incomplete';
  }
  report.files.sort((a, b) => a.path.localeCompare(b.path));
  report.skipped.sort((a, b) => a.path.localeCompare(b.path));
  report.totals.files = report.files.length;
  report.totals.skipped = report.skipped.length;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    process.stderr.write(
      "Usage: node scripts/maintenance-inventory.mjs\nOnly this repository's fixed build/evidence directories are inspected; no files are changed.\n",
    );
    process.exitCode = 1;
  } else {
    const report = await createMaintenanceInventory();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'complete') process.exitCode = 1;
  }
}

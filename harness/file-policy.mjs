import fs from 'node:fs/promises';
import path from 'node:path';

export function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function resolveOfficePath(file, root, { write = false } = {}) {
  if (typeof file !== 'string' || !file.trim() || file.includes('\0') || file.length > 1024) throw new Error('文件路径无效。');
  const target = path.resolve(root, file);
  if (write) {
    const parent = await fs.realpath(path.dirname(target));
    const stat = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error('不能写入链接或非普通文件。');
    return { target: stat ? await fs.realpath(target) : path.join(parent, path.basename(target)), exists: !!stat, inside: within(await fs.realpath(root), parent) };
  }
  const canonical = await fs.realpath(target);
  return { target: canonical, exists: true, inside: within(await fs.realpath(root), canonical) };
}

export function needsApproval(mode, { inside, write, exists }) {
  if (mode === 'full') return false;
  if (!inside) return true;
  return write && (mode !== 'auto' || exists);
}

export async function writeOfficeFile(requestedPath, content) {
  let handle;
  try {
    handle = await fs.open(requestedPath, 'wx', 0o600);
    await handle.writeFile(content);
  } catch (error) {
    await handle?.close().catch(() => {});
    if (handle) await fs.unlink(requestedPath).catch(() => {});
    if (error.code === 'EEXIST') throw new Error('FILE_CHANGED: 保存位置已被占用，请重新审批新的文件名。');
    throw error;
  }
  await handle.close();
  return requestedPath;
}

export async function nextOfficePath(requestedPath) {
  const directory = path.dirname(requestedPath);
  const extension = path.extname(requestedPath);
  const stem = path.basename(requestedPath, extension);
  for (let version = 1; version <= 10000; version++) {
    const suffix = version === 1 ? '' : ` (${version})`;
    const target = path.join(directory, `${stem}${suffix}${extension}`);
    try { await fs.lstat(target); }
    catch (error) {
      if (error.code === 'ENOENT') return target;
      throw error;
    }
  }
  throw new Error('可用的文件名过多，请指定其他保存路径。');
}

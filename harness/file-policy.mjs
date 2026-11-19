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

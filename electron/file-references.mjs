import fs from 'node:fs/promises';
import path from 'node:path';
import { isPrivateRelative } from './workspace-files.mjs';

// 输入区 `@` 引用的候选索引：递归列出工作区里的目录与文件，只给相对路径。
// 私密清单复用 workspace-files.mjs 的同一份 isPrivateRelative，不另写一份过滤；
// 符号链接不跟随，因此候选不可能指向工作区之外。
export const referenceEntryLimit = 50000;

export async function listReferenceFiles(root, { limit = referenceEntryLimit } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    return { workspace: false, entries: [], truncated: false };
  }
  let canonical;
  try {
    canonical = await fs.realpath(root);
  } catch {
    return { workspace: false, entries: [], truncated: false };
  }
  const identity = await fs.stat(canonical).catch(() => null);
  if (!identity?.isDirectory()) return { workspace: false, entries: [], truncated: false };
  const entries = [],
    directories = [{ absolute: canonical, relative: '' }];
  let truncated = false;
  for (let cursor = 0; cursor < directories.length && !truncated; cursor += 1) {
    const directory = directories[cursor];
    let children;
    try {
      children = await fs.readdir(directory.absolute, { withFileTypes: true });
    } catch (error) {
      // 根目录读不到说明这次列目录什么也没学到，不能当成「工作区是空的」。
      if (cursor === 0) throw Object.assign(new Error('无法读取项目工作区。'), { cause: error });
      continue;
    }
    children.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const child of children) {
      if (entries.length >= limit) {
        truncated = true;
        break;
      }
      if (child.isSymbolicLink()) continue;
      const relative =
        directory.relative === '' ? child.name : `${directory.relative}/${child.name}`;
      if (relative.includes(':') || isPrivateRelative(relative)) continue;
      if (child.isDirectory()) {
        entries.push({ path: relative, kind: 'directory' });
        directories.push({ absolute: path.join(directory.absolute, child.name), relative });
      } else if (child.isFile()) entries.push({ path: relative, kind: 'file' });
    }
  }
  return { workspace: true, entries, truncated };
}

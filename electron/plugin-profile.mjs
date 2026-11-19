import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, symlink, realpath, rename, unlink } from 'node:fs/promises';

const builtin = '@deepseek-ai/dsh-sdk-minimal';

export async function applyRuntimeExtensions(home, selection) {
  const dir = path.join(home, 'profiles', 'sdk-minimal');
  const file = path.join(dir, 'package.json');
  const old = await readFile(file, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!selection?.bundles?.length && !old?.zhixingExtensions) return;
  await mkdir(dir, { recursive: true });
  const bundles = [builtin, ...new Set((selection?.bundles || []).filter(name => name !== builtin))];
  const dependencies = selection?.dependencies || {};
  if (Object.keys(dependencies).length) {
    const source = await realpath(selection.nodeModules);
    const link = path.join(dir, 'node_modules');
    const present = await lstat(link).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!present) await symlink(source, link, process.platform === 'win32' ? 'junction' : 'dir');
    else if (!present.isSymbolicLink() || (await realpath(link)) !== source) {
      throw new Error('内核插件目录与本机插件档案不一致。请新建聊天后再加载插件。');
    }
  }
  const manifest = {
    name: old?.name || 'zhixing-sdk', private: true,
    dsh: { profile: { bundles } }, dependencies, zhixingExtensions: true,
  };
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(manifest, null, 2));
    await rename(tmp, file);
  } finally { await unlink(tmp).catch(() => {}); }
}

import fs from 'node:fs/promises';
import path from 'node:path';

export function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

const changed = () => new Error('FILE_CHANGED: 保存位置已变化，请重新审批。');
const sameDirectory = (a, b) => a.path === b.path && a.device === b.device && a.inode === b.inode;
const sameFile = (a, b) => !a && !b || !!a && !!b && a.device === b.device && a.inode === b.inode;

async function directorySnapshot(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('NOT_DIRECTORY: 保存位置的上级必须是真实目录。');
  if (await fs.realpath(directory) !== directory) throw changed();
  return { path: directory, device: stat.dev, inode: stat.ino };
}

async function existingParent(directory) {
  const missing = [];
  for (let current = directory; ; current = path.dirname(current)) {
    // lstat distinguishes a genuinely missing directory from a dangling link.
    // Never treat ENOTDIR, permission errors or a broken link as permission to
    // construct a new path through it.
    const entry = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (entry) {
      const canonical = await fs.realpath(current);
      return { anchor: await directorySnapshot(canonical), missing };
    }
    if (path.dirname(current) === current) throw changed();
    missing.unshift(path.basename(current));
  }
}

export async function resolveOfficePath(file, root, { write = false } = {}) {
  if (typeof file !== 'string' || !file.trim() || file.includes('\0') || file.length > 1024) throw new Error('文件路径无效。');
  const target = path.resolve(root, file);
  if (write) {
    const rootPath = path.resolve(root);
    const rootSnapshot = await directorySnapshot(await fs.realpath(rootPath));
    const { anchor, missing } = await existingParent(path.dirname(target));
    const parent = path.join(anchor.path, ...missing);
    const stat = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error('不能写入链接或非普通文件。');
    let canonical = path.join(parent, path.basename(target));
    if (stat) {
      const existing = await fs.realpath(target);
      // Windows accepts case variants of an existing name; retain its actual
      // canonical spelling while still rejecting a different resolved path.
      if (path.relative(canonical, existing) !== '') throw changed();
      canonical = existing;
    }
    return {
      target: canonical, exists: !!stat, inside: within(rootSnapshot.path, parent),
      scope: { requested: target, rootPath, root: rootSnapshot, anchor, missing,
        file: stat ? { device: stat.dev, inode: stat.ino } : undefined },
    };
  }
  const canonical = await fs.realpath(target);
  return { target: canonical, exists: true, inside: within(await fs.realpath(root), canonical) };
}

export function sameOfficeWritePath(before, after) {
  return before.target === after.target && before.exists === after.exists && before.inside === after.inside
    && sameDirectory(before.scope.root, after.scope.root)
    && sameDirectory(before.scope.anchor, after.scope.anchor)
    && JSON.stringify(before.scope.missing) === JSON.stringify(after.scope.missing)
    && sameFile(before.scope.file, after.scope.file);
}

// Call only after host approval (or an existing policy grant). Resolution above
// is read-only; this is the sole step that creates the missing parent chain.
// Node's portable path API does not provide an atomic directory-relative create,
// so pin identities and revalidate at every mutation and again around file I/O.
export async function prepareOfficeWrite(approved, { signal } = {}) {
  const { scope } = approved;
  signal?.throwIfAborted();
  const current = await resolveOfficePath(scope.requested, scope.rootPath, { write: true });
  if (!sameOfficeWritePath(approved, current) || current.exists) throw changed();
  const directories = [scope.anchor];
  async function verify() {
    signal?.throwIfAborted();
    const latest = await resolveOfficePath(scope.requested, scope.rootPath, { write: true });
    if (latest.target !== approved.target || latest.inside !== approved.inside
      || !sameDirectory(scope.root, latest.scope.root)) throw changed();
    for (const pinned of directories) {
      if (!sameDirectory(pinned, await directorySnapshot(pinned.path))) throw changed();
    }
    signal?.throwIfAborted();
  }
  for (const component of scope.missing) {
    await verify();
    const next = path.join(directories.at(-1).path, component);
    // Do not adopt a directory (or link) that appeared while approval was open.
    await fs.mkdir(next, { mode: 0o700 }).catch(error => { if (error.code === 'EEXIST') throw changed(); throw error; });
    directories.push(await directorySnapshot(next));
    await verify();
  }
  await verify();
  if (await fs.lstat(approved.target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw changed();
  return { target: approved.target, verify };
}

export function needsApproval(mode, { inside, write, exists }) {
  if (mode === 'full') return false;
  if (!inside) return true;
  return write && (mode !== 'auto' || exists);
}

export async function writeOfficeFile(requestedPath, content, { signal, verify = async () => {} } = {}) {
  let handle, created;
  try {
    signal?.throwIfAborted();
    await verify();
    handle = await fs.open(requestedPath, 'wx', 0o600);
    created = await handle.stat();
    async function verifyCreatedFile() {
      await verify();
      const linked = await fs.lstat(requestedPath);
      if (linked.isSymbolicLink() || !linked.isFile() || linked.dev !== created.dev || linked.ino !== created.ino) throw changed();
    }
    await verifyCreatedFile();
    signal?.throwIfAborted();
    await handle.writeFile(content);
    await verifyCreatedFile();
    signal?.throwIfAborted();
  } catch (error) {
    await handle?.close().catch(() => {});
    // Only remove the file created by this call; a replacement belongs to
    // someone else and must survive even when our write failed or was cancelled.
    if (created) {
      const latest = await fs.lstat(requestedPath).catch(() => null);
      if (latest?.isFile() && !latest.isSymbolicLink() && latest.dev === created.dev && latest.ino === created.ino) {
        await fs.unlink(requestedPath).catch(() => {});
      }
    }
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

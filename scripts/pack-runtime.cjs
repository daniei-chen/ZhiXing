const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');

// Packages that only serve other platforms or type checking. OfficeKit resolves
// the win32-x64 sidecar below, so the WebAssembly fallback never loads here.
const UNUSED_PACKAGE_PATHS = [
  'node_modules/@deepseek-ai/libreoffice-kit-wasm',
  'node_modules/@types',
  'node_modules/node-pty/prebuilds/win32-arm64',
  'node_modules/node-pty/prebuilds/darwin-arm64',
  'node_modules/node-pty/prebuilds/darwin-x64',
  'node_modules/node-pty/prebuilds/linux-x64',
];
const PRUNABLE_FILE = /\.(?:map|ts|tsx|mts|cts)$/;

async function treeBytes(target) {
  let total = 0;
  for (const entry of await fs.readdir(target, {withFileTypes: true})) {
    const item = path.join(target, entry.name);
    total += entry.isDirectory() ? await treeBytes(item) : (await fs.lstat(item).catch(() => ({size: 0}))).size;
  }
  return total;
}

async function prunePackagedTree(target) {
  let files = 0, bytes = 0;
  for (const relative of UNUSED_PACKAGE_PATHS) {
    const dir = path.join(target, ...relative.split('/'));
    if (!await fs.lstat(dir).catch(() => null)) continue;
    bytes += await treeBytes(dir);
    await fs.rm(dir, {recursive: true, force: true});
    files++;
  }
  const walk = async current => {
    for (const entry of await fs.readdir(current, {withFileTypes: true})) {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(item); continue; }
      if (!PRUNABLE_FILE.test(entry.name)) continue;
      const info = await fs.lstat(item).catch(() => null);
      if (!info?.isFile()) continue;
      await fs.rm(item, {force: true});
      files++; bytes += info.size;
    }
  };
  await walk(path.join(target, 'node_modules'));
  return {files, bytes};
}

// Copy the installed production tree at its lockfile paths. Harness resolves
// plugins dynamically and depends on peers below several nested packages.
// Flattening the tree loses those peers and can leave a package that only
// works when launched inside the source checkout.
module.exports = async function packRuntime(context) {
  if (context.electronPlatformName !== 'win32') return;
  const source = context.packager.projectDir;
  const target = path.resolve(context.appOutDir, 'resources', 'app');
  const { packages } = JSON.parse(await fs.readFile(path.join(source, 'package-lock.json'), 'utf8'));
  let copied = 0;
  for (const [entry, record] of Object.entries(packages)) {
    if (!entry.startsWith('node_modules/') || record.dev || record.link) continue;
    const from = path.resolve(source, entry), to = path.resolve(target, entry);
    if (!from.startsWith(path.join(source, 'node_modules') + path.sep) || !to.startsWith(path.join(target, 'node_modules') + path.sep)) throw new Error(`Invalid lockfile entry: ${entry}`);
    const manifest = await fs.readFile(path.join(from, 'package.json'), 'utf8').catch(error => {
      if (record.optional && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!manifest) continue;
    if (JSON.parse(manifest).version !== record.version) throw new Error(`Reinstall the locked dependency ${entry} before packaging.`);
    await fs.cp(from, to, {
      recursive: true,
      filter: item => item === from || !path.relative(from, item).split(path.sep).includes('node_modules'),
    });
    copied++;
  }
  // This Windows target requires the matching native OfficeKit sidecar.
  await fs.access(path.join(target,'node_modules','@deepseek-ai','libreoffice-kit-win32-x64','package.json'));
  console.log(`  • copied locked production packages without flattening: ${copied}`);
  // The packaged runtime loads compiled JavaScript plus this platform's native
  // binaries. Drop TypeScript sources, source maps, type declarations and the
  // macOS/Linux/WASM fallbacks so the installer does not carry a second copy of
  // every dependency. The packaged regression and the desktop journeys cover
  // Office conversion, native files, OCR and the kernel on the pruned tree.
  const pruned = await prunePackagedTree(target);
  console.log(`  • pruned sources, maps and foreign binaries: ${pruned.files} files, ${Math.round(pruned.bytes / 1048576)} MB`);
  const runtime=path.join(target,'runtime');await fs.mkdir(runtime,{recursive:true});
  // PTC intentionally strips ELECTRON_RUN_AS_NODE. Give it a real bundled Node
  // runtime so workflows work after installation without a system Node install.
  await fs.copyFile(process.execPath,path.join(runtime,'node.exe'));
  await fs.copyFile(path.join(source,'resources','licenses',`NODE-${process.version}-LICENSE.txt`),path.join(runtime,'NODE-LICENSE.txt'));
  let sourceCommit = null, sourceDirty = null;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source, encoding: 'utf8', windowsHide: true}).trim();
    sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal', '--', 'src', 'electron', 'harness', 'scripts', 'package.json', 'package-lock.json', 'electron-builder.yml', 'installer.nsh', 'public', 'resources'], {cwd: source, encoding: 'utf8', windowsHide: true}).trim());
  } catch { /* A source archive can build, but cannot claim a Git commit. */ }
  const provenance = {schemaVersion: 1, version: JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8')).version,
    sourceCommit, sourceDirty, builtAt: new Date().toISOString(), nodeVersion: process.version,
    lockSha256: createHash('sha256').update(await fs.readFile(path.join(source,'package-lock.json'))).digest('hex')};
  await fs.writeFile(path.join(target,'build-provenance.json'),JSON.stringify(provenance,null,2));
};

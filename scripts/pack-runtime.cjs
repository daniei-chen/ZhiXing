const fs = require('node:fs/promises');
const path = require('node:path');

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
  const runtime=path.join(target,'runtime');await fs.mkdir(runtime,{recursive:true});
  // PTC intentionally strips ELECTRON_RUN_AS_NODE. Give it a real bundled Node
  // runtime so workflows work after installation without a system Node install.
  await fs.copyFile(process.execPath,path.join(runtime,'node.exe'));
  await fs.copyFile(path.join(source,'resources','licenses',`NODE-${process.version}-LICENSE.txt`),path.join(runtime,'NODE-LICENSE.txt'));
};

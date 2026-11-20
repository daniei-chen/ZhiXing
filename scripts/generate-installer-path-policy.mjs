import fs from 'node:fs/promises';
import path from 'node:path';

const appDirectory = path.resolve('release/win-unpacked');
const includePath = path.resolve('build/installer-path-policy.nsh');
let longestRelativePath = '';

async function inspect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(appDirectory, fullPath);
    if (relativePath.length > longestRelativePath.length) longestRelativePath = relativePath;
    if (entry.isDirectory()) await inspect(fullPath);
  }
}

await inspect(appDirectory);
if (!longestRelativePath) throw new Error('The packaged Windows application directory is empty.');

const safeWindowsPathLength = 259;
const pathSeparatorLength = 1;
const maxInstallRootLength = safeWindowsPathLength - pathSeparatorLength - longestRelativePath.length;
if (maxInstallRootLength < 1) throw new Error('The packaged files exceed the Windows installer path limit even at a drive root.');

await fs.mkdir(path.dirname(includePath), { recursive: true });
await fs.writeFile(includePath, [
  `; Generated from release/win-unpacked. Longest relative path is ${longestRelativePath.length} UTF-16 code units.`,
  `!define ZHIXING_PRODUCT_FOLDER "知行"`,
  `!define ZHIXING_MAX_INSTALL_ROOT_LENGTH ${maxInstallRootLength}`,
  '',
].join('\n'), 'utf8');

console.log(`Windows installer root limit: ${maxInstallRootLength} UTF-16 code units. Longest packaged relative path: ${longestRelativePath.length}.`);

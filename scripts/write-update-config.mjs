// electron-builder only writes app-update.yml for full package builds, so a
// directory build needs it written explicitly or autoUpdater has no feed.
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(await fs.readFile(path.join(root, 'electron-builder.yml'), 'utf8'));
const publish = config.publish;
if (!publish || !publish.provider) {
  console.log('no publish configuration; skipping app-update.yml');
  process.exit(0);
}
const target = path.join(root, 'release', 'win-unpacked', 'resources');
await fs.mkdir(target, {recursive: true});
const lines = [
  `provider: ${publish.provider}`,
  `owner: ${publish.owner}`,
  `repo: ${publish.repo}`,
];
if (publish.releaseType) lines.push(`releaseType: ${publish.releaseType}`);
lines.push('updaterCacheDirName: zhixing-updater');
await fs.writeFile(path.join(target, 'app-update.yml'), `${lines.join('\n')}\n`, 'utf8');
console.log(`wrote ${path.join(target, 'app-update.yml')}`);

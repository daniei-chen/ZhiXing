import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const repository = path.resolve(import.meta.dirname, '..');
const application = path.resolve(process.argv[2] || repository);
const destination = path.resolve(process.argv[3] || '.preview/qa-0.12.1-audit/dependencies');
await fs.mkdir(destination, {recursive: true});
const lock = JSON.parse(await fs.readFile(path.join(repository, 'package-lock.json'), 'utf8'));
const applicationPackage = JSON.parse(await fs.readFile(path.join(application, 'package.json'), 'utf8'));
// Keep in sync with UNUSED_PACKAGE_PATHS in scripts/pack-runtime.cjs: these
// packages are absent from the shipped tree by design, not by accident.
const prunedPrefixes = ['node_modules/@deepseek-ai/libreoffice-kit-wasm', 'node_modules/@types',
  'node_modules/node-pty/prebuilds/win32-arm64', 'node_modules/node-pty/prebuilds/darwin-arm64',
  'node_modules/node-pty/prebuilds/darwin-x64', 'node_modules/node-pty/prebuilds/linux-x64'];
const records = [], omittedOptional = [], pruned = [];
for (const [relative, expected] of Object.entries(lock.packages)) {
  if (!relative.startsWith('node_modules/') || expected.dev || expected.link) continue;
  let bytes;
  try {bytes = await fs.readFile(path.join(application, relative, 'package.json'));}
  catch (error) {
    if (error.code === 'ENOENT' && prunedPrefixes.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))) {pruned.push(relative); continue;}
    if (expected.optional && error.code === 'ENOENT') {omittedOptional.push(relative); continue;}
    throw error;
  }
  const actual = JSON.parse(bytes);
  if (actual.version !== expected.version) throw new Error(`Dependency differs from lock: ${relative}`);
  records.push({path: relative, name: actual.name, version: actual.version, license: actual.license || null,
    integrity: expected.integrity || null, manifestSha256: createHash('sha256').update(bytes).digest('hex')});
}
records.sort((left, right) => left.path.localeCompare(right.path, 'en'));
const inventory = {schemaVersion: 1, appVersion: applicationPackage.version, generatedAt: new Date().toISOString(),
  scope: 'Installed production package manifests at lockfile paths; not a full source/binary-license or bundled-JavaScript audit',
  lockSha256: createHash('sha256').update(await fs.readFile(path.join(repository, 'package-lock.json'))).digest('hex'),
  fingerprint: createHash('sha256').update(JSON.stringify(records)).digest('hex'), packages: records, omittedOptional, pruned};

// Electron is a devDependency but ships as the application runtime, so `npm audit
// --omit=dev` never sees its advisories. Record the version here and keep it
// inside the fingerprint of what actually ships: a 44.7.0 -> 44.11.5 upgrade
// (GHSA-jr5w-w6x2-84p9) was invisible to this file before.
try {
  const electronVersion = JSON.parse(await fs.readFile(path.join(repository, 'node_modules/electron/package.json'), 'utf8')).version;
  inventory.runtime = {
    electron: electronVersion,
    scopeNote: 'Electron ships as the application runtime although npm lists it as a devDependency; audit its advisories with `npm audit` (not --omit=dev) or the Electron security page.',
  };
} catch { inventory.runtime = {electron: null, scopeNote: 'Electron manifest missing; runtime advisories were not checked.'}; }
await fs.writeFile(path.join(destination, 'production-inventory.json'), JSON.stringify(inventory, null, 2));
const sbom = {bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${randomUUID()}`, version: 1,
  metadata: {timestamp: inventory.generatedAt, component: {type: 'application', name: applicationPackage.name, version: applicationPackage.version},
    properties: [{name: 'zhixing:scope', value: inventory.scope}, {name: 'zhixing:lockSha256', value: inventory.lockSha256}, {name: 'zhixing:inventoryFingerprint', value: inventory.fingerprint}]},
  components: records.map(record => ({type: 'library', 'bom-ref': record.path, name: record.name, version: record.version,
    purl: `pkg:npm/${record.name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(record.version)}`,
    ...(typeof record.license === 'string' ? {licenses: [{license: {name: record.license}}]} : {}),
    properties: [{name: 'zhixing:installedPath', value: record.path}, {name: 'zhixing:manifestSha256', value: record.manifestSha256},
      ...(record.integrity ? [{name: 'zhixing:registryIntegrity', value: record.integrity}] : [])]}))};
await fs.writeFile(path.join(destination, 'production-sbom.cdx.json'), JSON.stringify(sbom, null, 2));

// Audit a manifest lock projection made from the exact verified package paths.
// Keep the normal lock's dev records so npm can resolve its graph, and explicitly
// omit development packages. The accompanying inventory states what was shipped.
await fs.writeFile(path.join(destination, 'package-lock.json'), JSON.stringify(lock));
await fs.writeFile(path.join(destination, 'package.json'), JSON.stringify(applicationPackage));
const cli = path.join(application, 'node_modules/npm/bin/npm-cli.js');
const result = spawnSync(process.execPath, [cli, 'audit', '--omit=dev', '--json', '--ignore-scripts'], {
  cwd: destination, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 16 * 1024 * 1024,
});
if (result.error) throw result.error;
const audit = JSON.parse(result.stdout);
await fs.writeFile(path.join(destination, 'npm-audit.json'), JSON.stringify(audit, null, 2));
if (!audit.metadata?.vulnerabilities) throw new Error('npm audit did not return a vulnerability summary');
const advisories = new Map();
for (const [name, affected] of Object.entries(audit.vulnerabilities || {})) {
  for (const via of affected.via || []) if (via && typeof via === 'object') {
    const key = via.url || via.source;
    const row = advisories.get(key) || {id: key, title: via.title, severity: via.severity, affected: []};
    for (const relative of affected.nodes || []) {
      if (!records.some(record => record.path === relative)) continue;
      if (!row.affected.some(item => item.path === relative)) row.affected.push({name, path: relative, version: records.find(record => record.path === relative).version});
    }
    if (row.affected.length) advisories.set(key, row);
  }
}
await fs.writeFile(path.join(destination, 'advisories-by-path.json'), JSON.stringify([...advisories.values()], null, 2));
const summary = {appVersion: applicationPackage.version, packageCount: records.length, fingerprint: inventory.fingerprint,
  npmVersion: records.find(record => record.path === 'node_modules/npm')?.version,
  vulnerabilities: audit.metadata.vulnerabilities, uniqueDirectAdvisoriesOnInstalledPaths: advisories.size,
  auditedFromVerifiedLockProjection: true};
await fs.writeFile(path.join(destination, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (summary.vulnerabilities.high || summary.vulnerabilities.critical) process.exitCode = 1;

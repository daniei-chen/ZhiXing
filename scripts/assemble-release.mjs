import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  REPOSITORY,
  REQUIRED_GATES,
  assetNames,
  cleanLog,
  commitOf,
  digestFile,
  git,
  jsonFile,
  nodeTestCounts,
  requireGates,
  verifyBundle,
  versionOf,
} from './release-common.mjs';

async function soleReport(directory, depth = 0) {
  assert.ok(depth <= 3, 'Unexpectedly deep journey directory');
  const matches = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === 'result.json') matches.push(target);
    else if (entry.isDirectory() && /^(run-|phase[01][a-z]?-ui-)/.test(entry.name)) {
      matches.push(...(await soleReport(target, depth + 1)));
    }
  }
  return matches;
}

export function journeySummary(report, { version, sourceCommit, exeSha256 }) {
  assert.equal(report.status, 'passed', 'Packaged journey did not finish successfully');
  assert.equal(report.version, version, 'Journey tested a different app version');
  assert.equal(report.sourceCommit, sourceCommit, 'Journey tested a different source commit');
  assert.equal(report.exeSha256, exeSha256, 'Journey tested a different executable');
  if (report.sourceDirty !== undefined) assert.equal(report.sourceDirty, false);
  const cases = report.cases ?? report.records;
  assert.ok(Array.isArray(cases) && cases.length, 'Journey has no recorded cases');
  const counts = { passed: 0, observed: 0, skipped: 0, failed: 0 };
  for (const row of cases) {
    assert.ok(Object.hasOwn(counts, row.status), `Unrecognized journey result: ${row.status}`);
    counts[row.status] += 1;
  }
  assert.equal(counts.failed, 0);
  assert.ok(counts.passed > 0, 'Observations alone are not passing assertions');
  return {
    ...counts,
    cases: cases.map((row) => ({ name: row.name, status: row.status })),
    visualReview: report.visualReview ?? 'not_recorded',
    ...(report.dialogSelection ? { dialogSelection: report.dialogSelection } : {}),
  };
}

export function validateUpdateFeed(text, { version, installer, sha512, bytes }) {
  const rows = cleanLog(text).split(/\r?\n/);
  const scalar = (key) =>
    rows
      .filter((line) => line.startsWith(`${key}:`))
      .map((line) => line.slice(key.length + 1).trim());
  assert.deepEqual(scalar('version'), [version], 'Update feed version differs');
  assert.deepEqual(scalar('path'), [installer], 'Update feed path differs');
  const hashes = rows
    .map((line) => line.match(/^\s*(?:-\s*)?sha512:\s*(\S+)\s*$/)?.[1])
    .filter(Boolean);
  assert.equal(hashes.length, 2, 'Expected the generated global and file SHA512');
  assert.ok(
    hashes.every((value) => value === sha512),
    'Update feed hash does not match the installer',
  );
  const urls = rows.map((line) => line.match(/^\s*-\s*url:\s*(\S+)\s*$/)?.[1]).filter(Boolean);
  assert.deepEqual(urls, [installer]);
  const sizes = rows
    .map((line) => line.match(/^\s+size:\s*(\d+)\s*$/)?.[1])
    .filter(Boolean)
    .map(Number);
  assert.deepEqual(sizes, [bytes], 'Update feed installer size differs');
}

export function startupSummary(text) {
  const rows = cleanLog(text)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
  const runs = rows.filter((row) => Number.isSafeInteger(row.run));
  const summary = rows.findLast((row) => row.summary)?.summary;
  assert.equal(runs.length, 10, 'Release startup measurement must complete all 10 runs');
  assert.equal(summary?.runs, 10);
  assert.ok(
    runs.every(
      (row, index) =>
        row.run === index + 1 &&
        Number.isFinite(row.spawnToInteractiveMs) &&
        row.spawnToInteractiveMs > 0,
    ),
  );
  assert.ok(Number.isFinite(summary.spawnToInteractiveMs) && summary.spawnToInteractiveMs > 0);
  return {
    ...summary,
    layer: 'packaged EXE on hosted Windows runner with temporary profiles',
    runsDetail: runs,
  };
}

function qualitySummary(log) {
  const text = cleanLog(log);
  const scope = text.match(
    /ESLint (\d+)\/(\d+) JS files; Stylelint (\d+)\/(\d+) CSS files; Prettier (\d+)\/(\d+) text files\./,
  );
  assert.ok(scope, 'Missing quality scope counts');
  assert.match(text, /Errors: 0; warnings: 0\./);
  return {
    scope: 'adopted-and-changed-scope',
    eslint: { checked: +scope[1], total: +scope[2] },
    stylelint: { checked: +scope[3], total: +scope[4] },
    prettier: { checked: +scope[5], total: +scope[6] },
    errors: 0,
    warnings: 0,
    additionalDiagnostics: text.split(/\r?\n/).filter((line) => line.includes('[csstree-match]')),
  };
}

const boundaryText = [
  '安装器未签名时须按实际 Authenticode 状态标注，不能把文件哈希当作发布者签名。',
  '本轮未在用户 D:\\应用\\知行 环境执行安装、升级或恢复，也未复跑用户安装生命周期。',
  '真实云端模型、真实办公任务评测、跨 Windows 用户解密、签名与 SmartScreen 体验未覆盖。',
  'Windows 界面与真实内核用例使用临时档案及本地合成服务；错误文案用例另含真实网络探测。',
  '截图由本轮实包生成；自动化断言不代表人工视觉审阅。原生文件用例中的批准与保存选择为合成接管。',
  'test:packed 包含从源码读取的测试文件、夹具和部分辅助模块，其分类按测试文件而非断言数统计。',
];

export async function assembleRelease({ root, evidence, output, plan, steps, runId }) {
  assert.equal(plan.eligible, true);
  assert.equal(plan.repository, REPOSITORY);
  const version = versionOf(plan.version),
    sourceCommit = commitOf(plan.sourceCommit);
  assert.equal(git(root, ['rev-parse', 'HEAD']), sourceCommit);
  assert.equal(git(root, ['rev-parse', 'HEAD^{tree}']), plan.sourceTree);
  assert.equal((await jsonFile(path.join(root, 'package.json'))).version, version);
  assert.equal(git(root, ['rev-parse', `${plan.baseTag}^{commit}`]), plan.baseCommit);
  requireGates(steps);
  assert.match(String(runId), /^\d+$/);
  const names = assetNames(version, plan.baseTag);
  const assets = path.join(output, 'assets');
  await fs.mkdir(assets, { recursive: true });
  assert.equal(
    (await fs.readdir(assets)).length,
    0,
    'Refusing to mix release assets from different builds',
  );
  const packed = path.join(root, 'release/win-unpacked');
  const app = path.join(packed, 'resources/app');
  const provenance = await jsonFile(path.join(app, 'build-provenance.json'));
  assert.equal(provenance.sourceCommit, sourceCommit);
  assert.equal(provenance.sourceDirty, false);
  assert.equal(provenance.version, version);
  assert.equal(provenance.nodeVersion, 'v24.19.0');
  const exe = await digestFile(path.join(packed, '知行.exe'));
  const log = (name) => fs.readFile(path.join(evidence, 'logs', `${name}.log`), 'utf8');
  const checks = {};
  for (const name of ['unit', 'components', 'sites', 'packed'])
    checks[name] = nodeTestCounts(await log(name));
  checks.quality = qualitySummary(await log('quality'));
  const packedScope = cleanLog(await log('packed'))
    .split(/\r?\n/)
    .find((line) => line.startsWith('{') && line.includes('"type":"packed-test-scope"'));
  assert.ok(
    packedScope,
    'Packaged evidence must retain the package-aware / mixed-source / source-only distinction',
  );
  checks.packed.scope = JSON.parse(packedScope);
  assert.equal(checks.packed.scope.unit, 'test-files');
  const evidenceFiles = [];
  async function recordEvidence(file, name) {
    const digest = await digestFile(file);
    evidenceFiles.push({ name, bytes: digest.bytes, sha256: digest.digest });
  }
  for (const name of ['unit', 'components', 'sites', 'packed', 'quality', 'startup'])
    await recordEvidence(path.join(evidence, 'logs', `${name}.log`), `logs/${name}.log`);
  const journeys = {};
  for (const name of ['errors', 'native', 'tools', 'phase0a', 'phase1']) {
    const directory =
      name === 'tools'
        ? path.join(root, `.preview/qa-${version}/tool-timeline`)
        : path.join(evidence, 'journeys', name);
    const reports = await soleReport(directory);
    assert.equal(reports.length, 1, `Expected one actual ${name} journey report`);
    journeys[name] = journeySummary(await jsonFile(reports[0]), {
      version,
      sourceCommit,
      exeSha256: exe.digest,
    });
    await recordEvidence(reports[0], `journeys/${name}/result.json`);
  }
  const startup = startupSummary(await log('startup'));
  const dependencySummary = await jsonFile(path.join(evidence, 'dependencies/summary.json'));
  const inventory = await jsonFile(path.join(evidence, 'dependencies/production-inventory.json'));
  assert.equal(dependencySummary.appVersion, version);
  assert.equal(inventory.appVersion, version);
  assert.equal(inventory.lockSha256, provenance.lockSha256);
  assert.equal(dependencySummary.vulnerabilities?.high, 0);
  assert.equal(dependencySummary.vulnerabilities?.critical, 0);
  const signature = await jsonFile(path.join(evidence, 'signature-status.json'));
  assert.equal(signature.version, version);
  assert.equal(signature.sourceCommit, sourceCommit);
  for (const name of ['installer', 'executable'])
    assert.ok(
      ['NotSigned', 'Valid'].includes(signature[name]),
      `Unexpected Authenticode status for ${name}: ${signature[name]}`,
    );

  async function copy(source, name) {
    assert.ok(names.includes(name), `Not a prescribed release asset: ${name}`);
    await digestFile(source);
    await fs.copyFile(source, path.join(assets, name));
  }
  for (const name of [
    `ZhiXing-${version}-x64.exe`,
    `ZhiXing-${version}-x64.exe.blockmap`,
    'latest.yml',
  ])
    await copy(path.join(root, 'release', name), name);
  await copy(path.join(app, 'build-provenance.json'), 'build-provenance.json');
  await copy(path.join(packed, 'resources/app-update.yml'), 'app-update.yml');
  await copy(path.join(evidence, 'packed-source-manifest.json'), 'packed-source-manifest.json');
  const sourceManifest = await jsonFile(path.join(evidence, 'packed-source-manifest.json'));
  assert.equal(sourceManifest.version, version);
  assert.equal(sourceManifest.sourceCommit, sourceCommit);
  assert.equal(sourceManifest.lockSha256, provenance.lockSha256);
  for (const name of [
    'production-inventory.json',
    'production-sbom.cdx.json',
    'advisories-by-path.json',
  ])
    await copy(path.join(evidence, 'dependencies', name), name);
  await copy(path.join(root, 'docs/harness-capability-map.md'), 'harness-capability-map.md');
  const installerName = `ZhiXing-${version}-x64.exe`;
  const installer = await digestFile(path.join(assets, installerName));
  const sha512 = await digestFile(path.join(assets, installerName), 'sha512', 'base64');
  validateUpdateFeed(await fs.readFile(path.join(assets, 'latest.yml'), 'utf8'), {
    version,
    installer: installerName,
    bytes: installer.bytes,
    sha512: sha512.digest,
  });
  const runUrl = `https://github.com/${REPOSITORY}/actions/runs/${runId}`;
  const rows = [
    [
      '源码测试',
      `${checks.unit.pass}/${checks.unit.tests}；跳过 ${checks.unit.skipped}`,
      'Windows 源码',
    ],
    [
      '组件测试',
      `${checks.components.pass}/${checks.components.tests}；跳过 ${checks.components.skipped}`,
      '组件与隔离渲染',
    ],
    ['Sites 测试', `${checks.sites.pass}/${checks.sites.tests}`, '站点源码'],
    [
      '目录包模块与内核测试',
      `${checks.packed.pass}/${checks.packed.tests}；跳过 ${checks.packed.skipped}`,
      '实包进程，含源码夹具和辅助模块',
    ],
    ...Object.entries(journeys).map(([name, result]) => [
      name,
      `${result.passed} 通过；${result.observed} 观察；${result.skipped} 跳过`,
      'Windows 实包界面',
    ]),
  ];
  const table =
    '| 验证项 | 实际结果 | 证据层 |\n| --- | --- | --- |\n' +
    rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  const footer = `\n\n## 本轮构建与证据\n\n源码提交：\`${sourceCommit}\`；tree：\`${plan.sourceTree}\`。\n\n${table}\n\n[本轮工作流](${runUrl})。所有测试数字来自本轮日志或结果文件；观察项不计作通过。\n\n## 本轮未覆盖的范围\n\n${boundaryText.map((item) => `- ${item}`).join('\n')}\n`;
  for (const kind of ['iteration', 'audit-request', 'release-notes']) {
    const name = `${kind}-${version}.md`;
    const source = path.join(root, kind === 'release-notes' ? name : `docs/${name}`);
    const body = await fs.readFile(source, 'utf8');
    assert.ok(body.trim(), `Missing authored release document: ${name}`);
    await fs.writeFile(path.join(assets, name), `${body.trimEnd()}${footer}`);
  }
  await fs.appendFile(
    path.join(assets, `release-notes-${version}.md`),
    `\n## 安装包\n\n[下载 Windows x64 预发行](https://github.com/${REPOSITORY}/releases/download/v${version}/${installerName})\n\n- 大小：${installer.bytes} 字节\n- SHA256：\`${installer.digest}\`\n- Authenticode：\`${signature.installer}\`\n`,
  );
  await fs.writeFile(
    path.join(assets, `windows-acceptance-${version}.md`),
    `# 知行 ${version} Windows 托管环境验收\n${footer}\n## 构建与测量\n\n- 随包 Node：${provenance.nodeVersion}\n- 目录包源码：${sourceManifest.matchedFiles} 文件，指纹 \`${sourceManifest.sourceFingerprint}\`\n- 安装器签名状态：${signature.installer}；应用 EXE：${signature.executable}\n- 启动探针：10 次，可交互中位数 ${startup.spawnToInteractiveMs} ms\n- 依赖清单：${dependencySummary.packageCount} 包；high ${dependencySummary.vulnerabilities.high}、critical ${dependencySummary.vulnerabilities.critical}\n- 安装生命周期：本轮未运行；用户安装目录未访问\n`,
  );
  await fs.writeFile(
    path.join(assets, 'signing.md'),
    `# 本轮签名状态\n\n版本：${version}；源码：\`${sourceCommit}\`。\n\n- 安装器 Authenticode：\`${signature.installer}\`\n- 应用 EXE Authenticode：\`${signature.executable}\`\n\n状态由 Windows Get-AuthenticodeSignature 在本轮产物上读取。文件哈希核对只证明字节一致。代码签名、SmartScreen 信任体验、签名版本间升级本轮未验证。\n`,
  );
  const patch = execFileSync(
    'git',
    ['diff', '--binary', '--full-index', plan.baseCommit, sourceCommit, '--'],
    { cwd: root, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  assert.ok(patch.length > 0, 'Release patch is empty');
  await fs.writeFile(path.join(assets, `ZhiXing-${plan.baseTag}-to-v${version}.patch`), patch);
  const records = async () =>
    Promise.all(
      (await fs.readdir(assets)).sort().map(async (name) => {
        const file = await digestFile(path.join(assets, name));
        return { name, bytes: file.bytes, sha256: file.digest };
      }),
    );
  const summary = {
    schemaVersion: 1,
    version,
    sourceCommit,
    sourceTree: plan.sourceTree,
    baseTag: plan.baseTag,
    baseCommit: plan.baseCommit,
    workflowRunUrl: runUrl,
    generatedAt: new Date().toISOString(),
    runner: {
      os: process.platform,
      node: process.version,
      image: process.env.ImageOS ?? null,
      imageVersion: process.env.ImageVersion ?? null,
    },
    gates: Object.fromEntries(
      REQUIRED_GATES.map((name) => [name, { outcome: steps[name].outcome }]),
    ),
    checks,
    evidenceFiles,
    journeys,
    startup,
    dependencies: dependencySummary,
    signature,
    applicationExecutable: { bytes: exe.bytes, sha256: exe.digest },
    assetsBeforeSummaryAndChecksums: await records(),
    installationLifecycle: 'not_run',
    realCloud: 'not_run',
    userInstallationTouched: false,
    releasePublication: 'pending_separate_publish_job',
    boundaries: boundaryText,
    checksumScope:
      'SHA256SUMS-release.txt hashes the other 17 assets; the external bundle manifest also hashes the checksum file itself.',
  };
  await fs.writeFile(
    path.join(assets, `acceptance-summary-${version}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(assets, 'SHA256SUMS-release.txt'),
    (await records()).map((row) => `${row.sha256}  ${row.name}`).join('\n') + '\n',
  );
  const manifest = {
    schemaVersion: 1,
    repository: REPOSITORY,
    version,
    tag: `v${version}`,
    sourceCommit,
    sourceTree: plan.sourceTree,
    baseTag: plan.baseTag,
    files: await records(),
  };
  await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(output, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  await verifyBundle(output, sourceCommit);
  return { version, sourceCommit, assets: manifest.files.length, output };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { plan: { type: 'string' }, evidence: { type: 'string' }, output: { type: 'string' } },
  });
  assert.ok(values.plan && values.evidence && values.output);
  console.log(
    JSON.stringify(
      await assembleRelease({
        root: process.cwd(),
        evidence: path.resolve(values.evidence),
        output: path.resolve(values.output),
        plan: await jsonFile(values.plan),
        steps: JSON.parse(process.env.CI_STEP_RESULTS || '{}'),
        runId: process.env.GITHUB_RUN_ID,
      }),
    ),
  );
}

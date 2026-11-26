import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ESLint } from 'eslint';
import * as prettier from 'prettier';
import stylelint from 'stylelint';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const JS = /\.(?:js|jsx|mjs|cjs)$/i;
const CSS = /\.css$/i;
const FORMATTABLE = /\.(?:js|jsx|mjs|cjs|css|json|ya?ml|md|html)$/i;
const sorted = (values) => [...new Set(values)].sort();
const slash = (value) => value.split(path.sep).join('/');

function git(root, args, input) {
  return execFileSync('git', args, {
    cwd: root,
    input,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function gitFiles(root, args) {
  return git(root, args).split('\0').filter(Boolean);
}

export function selectFiles({
  inventory,
  changed,
  added,
  scope,
  all = false,
  changedOnly = false,
}) {
  const generated = (file) =>
    scope.generatedFiles.includes(file) ||
    scope.generatedDirectories.some((directory) => file.startsWith(directory));
  const available = new Set(inventory.filter((file) => !generated(file)));
  const keep = (files, pattern) =>
    sorted(files.filter((file) => available.has(file) && pattern.test(file)));
  const candidates = all ? [...available] : changed;
  const adopted = (key) => (all || changedOnly ? [] : scope[key]);
  return {
    eslint: keep([...candidates, ...adopted('eslintFiles')], JS),
    stylelint: keep([...candidates, ...adopted('stylelintFiles')], CSS),
    // A legacy edit does not force a whole-file formatting change. Adoption is
    // explicit; new files never inherit the old repository's formatting debt.
    prettier: keep(all ? [...available] : [...added, ...adopted('formatFiles')], FORMATTABLE),
    legacyFormatting: keep(
      changed.filter((file) => !added.includes(file) && !scope.formatFiles.includes(file)),
      FORMATTABLE,
    ),
    generated: inventory.filter(generated),
    inventory: {
      javascript: keep([...available], JS).length,
      css: keep([...available], CSS).length,
      formattable: keep([...available], FORMATTABLE).length,
    },
  };
}

export async function discoverFiles(root, scope, options = {}) {
  if (!/^[a-f0-9]{40}$/.test(scope.baselineCommit))
    throw new Error('Invalid quality baseline SHA.');
  const snapshot = JSON.parse(await fs.readFile(path.join(root, scope.baselineSnapshot), 'utf8'));
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.sourceCommit !== scope.baselineCommit ||
    snapshot.hashAlgorithm !== 'git-blob-sha1' ||
    !snapshot.files ||
    typeof snapshot.files !== 'object' ||
    Array.isArray(snapshot.files)
  ) {
    throw new Error('Quality baseline snapshot is invalid or has a different source commit.');
  }
  for (const [name, hash] of Object.entries(snapshot.files)) {
    if (
      path.posix.isAbsolute(name) ||
      name.split('/').includes('..') ||
      name.includes('\\') ||
      !/^[a-f0-9]{40}$/.test(hash)
    )
      throw new Error(`Invalid baseline entry: ${name}`);
  }
  const untracked = gitFiles(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const names = sorted([...gitFiles(root, ['ls-files', '-z']), ...untracked]);
  const inventory = [];
  for (const name of names) {
    const stat = await fs.lstat(path.join(root, name)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!stat) continue;
    if (FORMATTABLE.test(name) && stat.isSymbolicLink()) {
      throw new Error(`Quality checks do not follow source symlinks: ${name}`);
    }
    if (stat.isFile()) inventory.push(name);
  }
  for (const file of [...scope.eslintFiles, ...scope.stylelintFiles, ...scope.formatFiles]) {
    if (!inventory.includes(file)) throw new Error(`An adopted quality file is missing: ${file}`);
  }
  const candidates = inventory.filter(
    (file) =>
      FORMATTABLE.test(file) &&
      !scope.generatedFiles.includes(file) &&
      !scope.generatedDirectories.some((directory) => file.startsWith(directory)),
  );
  // --stdin-paths applies Git's text attributes, without storing objects (-w).
  // The committed snapshot survives squash merges and shallow checkouts.
  const hashes = candidates.length
    ? git(
        root,
        ['hash-object', '--stdin-paths'],
        candidates.map((file) => JSON.stringify(file)).join('\n') + '\n',
      )
        .trim()
        .split('\n')
    : [];
  if (hashes.length !== candidates.length || hashes.some((hash) => !/^[a-f0-9]{40}$/.test(hash))) {
    throw new Error('Git did not return a valid content hash for every quality candidate.');
  }
  const changed = candidates.filter((file, index) => snapshot.files[file] !== hashes[index]);
  const added = candidates.filter((file) => !Object.hasOwn(snapshot.files, file));
  return selectFiles({ inventory, changed, added, scope, ...options });
}

export async function verifyRuntimeProperties(root, properties) {
  for (const property of properties) {
    const source = await fs.readFile(path.join(root, property.source), 'utf8');
    const reference = await fs.readFile(path.join(root, property.reference), 'utf8');
    const quotedBinding =
      source.includes(`'${property.name}':`) || source.includes(`"${property.name}":`);
    if (!quotedBinding || !reference.includes(`${property.name}:`)) {
      throw new Error(
        `Runtime CSS reference must be reviewed: ${property.name} in ${property.source}`,
      );
    }
  }
}

export async function checkFiles(root, selected, { only = 'all', suppressed = [] } = {}) {
  const diagnostics = [];
  if (only !== 'format' && selected.eslint.length) {
    const results = await new ESLint({
      cwd: root,
      overrideConfigFile: path.join(root, 'eslint.config.mjs'),
    }).lintFiles(selected.eslint.map((file) => path.join(root, file)));
    for (const result of results) {
      for (const message of result.suppressedMessages) {
        suppressed.push({
          tool: 'eslint',
          file: slash(path.relative(root, result.filePath)),
          line: message.line,
          rule: message.ruleId,
          reasons: message.suppressions,
        });
      }
    }
    for (const result of results)
      for (const message of result.messages) {
        diagnostics.push({
          tool: 'eslint',
          file: slash(path.relative(root, result.filePath)),
          line: message.line,
          column: message.column,
          rule: message.ruleId || 'parse',
          severity: message.severity === 2 ? 'error' : 'warning',
          message: message.message,
        });
      }
  }
  if (only !== 'format' && selected.stylelint.length) {
    const result = await stylelint.lint({
      cwd: root,
      files: selected.stylelint.map((file) => path.join(root, file)),
      configFile: path.join(root, 'stylelint.config.mjs'),
      ignoreDisables: true,
    });
    for (const row of result.results) {
      for (const warning of [...row.warnings, ...row.parseErrors, ...row.invalidOptionWarnings]) {
        diagnostics.push({
          tool: 'stylelint',
          file: slash(path.relative(root, row.source)),
          line: warning.line,
          column: warning.column,
          rule: warning.rule || 'configuration',
          severity: warning.severity || 'error',
          message: warning.text,
        });
      }
    }
    if (result.errored && !diagnostics.some((row) => row.tool === 'stylelint')) {
      throw new Error('Stylelint failed without a per-file diagnostic.');
    }
  }
  if (only !== 'lint')
    for (const file of selected.prettier) {
      const absolute = path.join(root, file);
      const options = await prettier.resolveConfig(absolute);
      const source = await fs.readFile(absolute, 'utf8');
      if (!(await prettier.check(source, { ...options, filepath: absolute }))) {
        diagnostics.push({
          tool: 'prettier',
          file,
          severity: 'error',
          rule: 'format',
          message: 'Not formatted. Run prettier --write on this file explicitly.',
        });
      }
    }
  return diagnostics;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      all: { type: 'boolean', default: false },
      changed: { type: 'boolean', default: false },
      only: { type: 'string', default: 'all' },
      report: { type: 'string' },
    },
  });
  if (values.all && values.changed) throw new Error('Choose --all or --changed, not both.');
  if (!['all', 'lint', 'format'].includes(values.only)) throw new Error('Unknown --only value.');
  const scope = JSON.parse(await fs.readFile(path.join(ROOT, '.quality-scope.json'), 'utf8'));
  if (scope.schemaVersion !== 1) throw new Error('Unsupported quality scope version.');
  await verifyRuntimeProperties(ROOT, scope.runtimeCustomProperties);
  const selected = await discoverFiles(ROOT, scope, {
    all: values.all,
    changedOnly: values.changed,
  });
  const suppressed = [];
  const diagnostics = await checkFiles(ROOT, selected, { only: values.only, suppressed });
  const counts = { errors: 0, warnings: 0, byRule: {} };
  for (const row of diagnostics) {
    counts[row.severity === 'error' ? 'errors' : 'warnings']++;
    const key = `${row.tool}/${row.rule}`;
    counts.byRule[key] = (counts.byRule[key] || 0) + 1;
  }
  const report = {
    schemaVersion: 1,
    baselineCommit: scope.baselineCommit,
    mode: values.all
      ? 'repository-inventory'
      : values.changed
        ? 'changed-scope'
        : 'adopted-and-changed-scope',
    checks: values.only,
    passed: diagnostics.length === 0,
    scope: selected,
    counts,
    diagnostics,
    suppressed,
    limitation:
      'Scoped success is not whole-repository quality, runtime behavior, or Windows package acceptance.',
  };
  if (values.report) {
    const destination = path.resolve(values.report);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`Quality scope: ${report.mode}; baseline ${scope.baselineCommit.slice(0, 7)}.`);
  console.log(
    `ESLint ${values.only === 'format' ? 'not run' : `${selected.eslint.length}/${selected.inventory.javascript} JS files`}; Stylelint ${values.only === 'format' ? 'not run' : `${selected.stylelint.length}/${selected.inventory.css} CSS files`}; Prettier ${values.only === 'lint' ? 'not run' : `${selected.prettier.length}/${selected.inventory.formattable} text files`}.`,
  );
  if (selected.legacyFormatting.length && !values.all) {
    console.log(
      `Legacy formatting not adopted (${selected.legacyFormatting.length}): ${selected.legacyFormatting.join(', ')}`,
    );
  }
  if (selected.generated.length)
    console.log(`Generated evidence/lock files excluded: ${selected.generated.length}.`);
  if (suppressed.length)
    console.log(
      `Documented inline exceptions (${suppressed.length}): ${suppressed.map((row) => `${row.file}:${row.line} ${row.rule}`).join(', ')}`,
    );
  for (const row of diagnostics.slice(0, 60)) {
    console.error(
      `${row.file}:${row.line || 1}:${row.column || 1} ${row.tool} ${row.rule}: ${row.message}`,
    );
  }
  if (diagnostics.length > 60)
    console.error(
      `${diagnostics.length - 60} more diagnostics; use --report <path> for the complete inventory.`,
    );
  console.log(`Errors: ${counts.errors}; warnings: ${counts.warnings}. ${report.limitation}`);
  process.exitCode = diagnostics.length ? 1 : 0;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Quality check failed: ${error.message}`);
    process.exitCode = 1;
  });
}

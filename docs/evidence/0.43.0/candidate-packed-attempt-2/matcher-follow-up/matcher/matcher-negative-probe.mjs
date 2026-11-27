import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const repo = '/workspace/scratch/7464bebaff38/ZhiXing';
const require = createRequire(path.join(repo, 'package.json'));
const { parse } = require('acorn');
const file = path.join(repo, 'scripts/test-approval-recovery-ui.mjs');
const source = await fs.readFile(file, 'utf8');
const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const matcher = program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'matchingScenarios');
const cases = program.body.find(node => node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === 'cases'));
assert(matcher && cases);
const context = vm.createContext({ assert });
const actual = vm.runInContext(`${source.slice(cases.start, cases.end)}\n${source.slice(matcher.start, matcher.end)}\n({ matchingScenarios, cases: Object.values(cases) });`, context);
const scenarios = actual.cases;
const typed = scenarios.find(item => item.name === 'allow').prompt;
const second = scenarios.find(item => item.name === 'reject').prompt;
const matches = messages => structuredClone(actual.matchingScenarios(messages, scenarios));
const accept = messages => {
  const found = matches(messages);
  assert.equal(found.length, 1, 'Fixture needs exactly one genuine typed scenario prompt');
  return found[0];
};
const results = [];
function check(name, action) {
  action();
  results.push({ name, status: 'passed' });
}
check('original exact user line before native supplemental users is recognized', () => {
  const found = accept([
    { role: 'system', content: 'fixture system' },
    { role: 'user', content: `任务模式：办公\n\n【本次交办】\n${typed}` },
    { role: 'user', content: '<system-reminder>fixture</system-reminder>' },
    { role: 'user', content: 'fixture environment' },
  ]);
  assert.deepEqual(found, { scenario: 'allow', messageIndex: 1, blockIndex: 0, lineIndex: 3 });
});
check('a text block is recognized without accepting image content as user text', () => {
  const found = accept([{ role: 'user', content: [
    { type: 'image_url', text: second, image_url: { url: 'fixture-image' } },
    { type: 'text', text: `【本次交办】\r\n${typed}` },
  ] }]);
  assert.equal(found.blockIndex, 1);
  assert.equal(found.scenario, 'allow');
});
check('assistant and tool content cannot provide the scenario identity', () => {
  assert.throws(() => accept([{ role: 'assistant', content: typed }, { role: 'tool', content: typed }]), /exactly one/);
});
check('an unsupported block type cannot supply a scenario', () => {
  assert.throws(() => accept([{ role: 'user', content: [{ type: 'image_url', text: typed }] }]), /exactly one/);
});
check('prefixes suffixes and whitespace changes do not match the genuine typed line', () => {
  for (const content of [`prefix ${typed}`, `${typed} suffix`, `${typed} `, ` ${typed}`])
    assert.throws(() => accept([{ role: 'user', content }]), /exactly one/);
});
check('two different scenarios remain ambiguous and are rejected', () => {
  assert.throws(() => accept([{ role: 'user', content: typed }, { role: 'user', content: second }]), /exactly one/);
});
check('the same typed scenario appearing twice is rejected rather than guessed', () => {
  assert.throws(() => accept([{ role: 'user', content: typed }, { role: 'user', content: typed }]), /exactly one/);
});
check('partial text blocks are not concatenated to manufacture a matching prompt', () => {
  assert.throws(() => accept([{ role: 'user', content: [
    { type: 'text', text: typed.slice(0, 10) },
    { type: 'text', text: typed.slice(10) },
  ] }]), /exactly one/);
});
check('a non-array message list is rejected', () => {
  assert.throws(() => matches({ role: 'user', content: typed }), /real message list/);
});
check('duplicate matching lines inside a single user block are rejected', () => {
  assert.throws(() => accept([{ role: 'user', content: `${typed}\n${typed}` }]), /exactly one/);
});
const hash = value => createHash('sha256').update(value).digest('hex');
const report = {
  layer: 'local matcher regression using AST-extracted actual QA function and scenario definitions; no application or Windows run',
  script: 'scripts/test-approval-recovery-ui.mjs',
  scriptSha256: hash(source),
  matcherSha256: hash(source.slice(matcher.start, matcher.end)),
  results,
  passed: results.length,
  failed: 0,
  boundary: 'Synthetic protocol negatives complement the separate actual Harness payload and sequence probes; they do not establish the 13-case Windows journey.',
};
await fs.writeFile(path.join(import.meta.dirname, 'matcher-negative-probe.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

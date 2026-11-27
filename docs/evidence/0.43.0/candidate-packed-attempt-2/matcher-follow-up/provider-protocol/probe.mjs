import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repository = '/workspace/scratch/7464bebaff38/ZhiXing';
const evidence = import.meta.dirname;
const require = createRequire(path.join(repository, 'package.json'));
const { parse } = require('acorn');
const { RuntimeManager } = await import(pathToFileURL(path.join(repository, 'electron/runtime.mjs')));
const { RuntimeApprovals } = await import(pathToFileURL(path.join(repository, 'electron/runtime-approvals.mjs')));
const { resolveProvider } = await import(pathToFileURL(path.join(repository, 'electron/providers.mjs')));
const hash = (text) => createHash('sha256').update(text).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const script = await fs.readFile(path.join(repository, 'scripts/test-approval-recovery-ui.mjs'), 'utf8');
const ast = parse(script, { ecmaVersion: 'latest', sourceType: 'module' });
const serverDeclaration = ast.body.find((node) => node.type === 'VariableDeclaration' && node.declarations.some((item) => item.id.name === 'server'));
const callbackNode = serverDeclaration.declarations[0].init.arguments[0];
const originalCallback = script.slice(callbackNode.start, callbackNode.end);
const caseSource = script.slice(script.indexOf('const cases = Object.fromEntries('), script.indexOf('const report = {'));
assert(caseSource.startsWith('const cases = Object.fromEntries('));
const matcherNode = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === 'matchingScenarios');
assert(matcherNode, 'The current script must supply its actual matchingScenarios helper');
const matcherSource = script.slice(matcherNode.start, matcherNode.end);
const matchingScenarios = new Function('assert', matcherSource + '\nreturn matchingScenarios;')(assert);
let callbackSource = originalCallback;
const payloadAnchor = '    const payload = JSON.parse(body);';
assert.equal(callbackSource.split(payloadAnchor).length, 2);
callbackSource = callbackSource.replace(payloadAnchor, payloadAnchor + '\n    observePayload(payload);');
await fs.writeFile(path.join(evidence, 'extracted-provider.json'), JSON.stringify({
  sourceFile: 'scripts/test-approval-recovery-ui.mjs', sourceSha256: hash(script),
  originalCallbackSha256: hash(originalCallback), probeCallbackSha256: hash(callbackSource),
  originalCallback, callbackSource, caseSource, matcherSource,
  modifications: ['Observe structural request metadata immediately after JSON parsing. The real current callback, matcher and all protocol assertions are otherwise unchanged.'],
}, null, 2) + '\n');

const report = {
  schemaVersion: 1,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  sourceScriptSha256: hash(script),
  layer: 'Linux source RuntimeManager + real Harness + native approval bridge + extracted loopback provider; no Electron, Windows or UI',
  runner: { platform: process.platform, node: process.version, arch: process.arch },
  startedAt: new Date().toISOString(),
  status: 'running', cases: [],
  boundaries: [
    'The current fake provider callback and exact prompt matcher are extracted verbatim; only structural observation is inserted.',
    'Host broker decisions are made programmatically for synthetic files; no user or UI approval interaction is claimed.',
    'reload names the original two-tool fixture sequence; no renderer reload or handoff ACK is simulated here.',
    'Only bounded structural request metadata and synthetic result match booleans are retained; request bodies, credentials and live profile contents are not archived.',
  ],
};
const persist = () => fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');

async function scenario(name) {
  const parent = await fs.realpath(os.tmpdir());
  const temporary = await fs.mkdtemp(path.join(parent, 'zx-approval-provider-probe-'));
  const workspace = path.join(temporary, 'project');
  const outside = path.join(temporary, 'outside');
  await fs.mkdir(workspace); await fs.mkdir(outside);
  const { cases, outsideFiles } = new Function('path', 'outside', caseSource + '\nreturn {cases, outsideFiles};')(path, outside);
  for (const [index, file] of outsideFiles.entries()) await fs.writeFile(file.path, `SYNTHETIC_EXTERNAL_${index}`);
  const item = cases[name];
  const local = { providerRequests: [], receivedModelRequests:0, requestShapes:[] };
  const observations = [];
  let lastPayload;
  let replay = false;
  const factory = new Function('assert', 'model', 'cases', 'requestsFor', 'report', 'matchingScenarios', 'observePayload',
    `let fixtureError; return {callback: (${callbackSource}), error: () => fixtureError};`);
  const provider = factory(assert, 'qa-approval-model', cases,
    (scenarioName) => local.providerRequests.filter((row) => row.scenario === scenarioName), local, matchingScenarios,
    (payload) => {
      lastPayload = payload;
      observations.push({
        replayNegativeControl: replay,
        model: payload.model, stream: payload.stream,
        roles: payload.messages.map((message) => message.role),
        tools: payload.messages.filter((message) => message.role === 'tool').map((message) => ({
          callId: message.tool_call_id,
          contentShape: Array.isArray(message.content) ? 'array' : typeof message.content,
          contentBlockTypes: Array.isArray(message.content) ? message.content.map((block) => block?.type ?? typeof block) : [],
          contentBytes: Buffer.byteLength(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)),
          originalStringRejectionMatch: /未获批准|rejected|APPROVAL_REJECTED/.test(String(message.content)),
          jsonRejectionMatch: /未获批准|rejected|APPROVAL_REJECTED/.test(JSON.stringify(message.content)),
          unavailableMatch: /APPROVAL_UNAVAILABLE/.test(JSON.stringify(message.content)),
        })),
      });
    });
  let manager;
  const server = http.createServer(async (request, response) => {
    await provider.callback(request, response);
    if (provider.error() && !replay) void manager?.cancel(`probe-${name}`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const vaults = new Map();
  const approvals = new RuntimeApprovals();
  const decisions = [];
  const events = [];
  const row = { name, startedAt: new Date().toISOString(), status: 'running', decisions, providerRequests: local.providerRequests, observations };
  report.cases.push(row); await persist();
  manager = new RuntimeManager({
    root: path.join(temporary, 'harness'),
    readVault: async (id) => vaults.get(id), writeVault: async (id, value) => vaults.set(id, value),
    onEvent: (event) => { if (['run/terminal', 'run/exited'].includes(event.type)) events.push({type:event.type, status:event.status, finalization:event.finalization}); },
    onApproval: async (request) => {
      const pending = approvals.request(request);
      const snapshot = approvals.snapshot();
      assert.equal(snapshot.pending.length, 1);
      const current = snapshot.pending[0];
      assert.equal(current.rootSessionId, item.chatId);
      assert.equal(current.sourceSessionId, item.chatId);
      const outcome = name === 'reject' ? 'rejected' : 'allowed-once';
      if (name !== 'present') await assert.rejects(fs.access(path.join(workspace, item.file)), {code:'ENOENT'});
      else assert.equal(current.presentation.path, outsideFiles[decisions.length].path);
      await pause(50);
      const answer = {hostEpoch:snapshot.hostEpoch, requestId:current.requestId, runId:current.runId, rootSessionId:current.rootSessionId, outcome};
      assert.deepEqual(approvals.answer(answer), {accepted:true});
      assert.equal(approvals.answer({...answer, outcome:'allowed-once'}).accepted, false);
      decisions.push({requestId:current.requestId, callId:current.callId, toolName:current.toolName, outcome, staleRejected:true, target: path.basename(current.presentation.path)});
      return pending;
    },
  });
  try {
    const providerConfig = resolveProvider([{
      id:'qa-approval-model', name:'QA 审批服务', protocol:'openai', baseUrl:`http://127.0.0.1:${server.address().port}/v1`,
      reasoningStyle:'standard', contextWindow:128000, maxTokens:8192,
      models:[{id:'qa-approval-model',name:'QA 审批恢复模型',input_modalities:['text']}],
    }], {providerId:'qa-approval-model',modelId:'qa-approval-model',reasoning:'low'});
    const config = {
      ...providerConfig, manualControls:true,
      permission:'ask', workspaceRoot:workspace, persist:true, kernel:{taskTimeoutSeconds:30},
    };
    const result = await manager.run({runId:`probe-${name}`, sessionId:item.chatId, prompt:item.prompt, privacyMode:'redact'}, config, 'synthetic-approval-fixture-key');
    assert.equal(provider.error(), undefined);
    assert.equal(result.finishReason, 'completed');
    assert.equal(result.text, item.final);
    assert.equal(local.providerRequests.length, item.calls.length + 1);
    assert.equal(observations.length, local.providerRequests.length);
    assert.equal(local.receivedModelRequests, local.providerRequests.length);
    assert.equal(approvals.snapshot().pending.length, 0);
    assert.equal(decisions.length, name === 'present' ? 2 : 1);
    if (name === 'reject') await assert.rejects(fs.access(path.join(workspace, item.file)), {code:'ENOENT'});
    else if (name !== 'present') {
      assert.equal(await fs.readFile(path.join(workspace,item.file), 'utf8'), item.content);
      assert.deepEqual((await fs.readdir(workspace)).filter((file) => file.startsWith(name + '-result')), [item.file]);
    } else {
      assert.equal(decisions[0].callId, decisions[1].callId);
      assert.notEqual(decisions[0].requestId, decisions[1].requestId);
      assert.equal(result.deliverables.length, 2);
      for (const [index,file] of outsideFiles.entries()) assert.equal(await fs.readFile(file.path,'utf8'),`SYNTHETIC_EXTERNAL_${index}`);
    }
    if (name === 'reload') assert.equal(result.deliverables.length, 1);
    row.completeFinalMatched = true;
    row.deliverables = result.deliverables.length;
    row.businessRequestCount = observations.length;
    row.sideEffectsMatched = true;
    // Replay the exact final *real* Harness request to the extracted provider.
    // This is only a provider-guard negative control, never a second Agent run.
    replay = true;
    const response = await fetch(config.baseUrl + '/chat/completions', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(lastPayload)});
    await response.arrayBuffer();
    assert.equal(response.status, 500);
    assert.match(provider.error(), /must not replay after recovery/);
    assert.equal(local.providerRequests.length, item.calls.length + 1);
    row.replayGuard = {exactRealRequestReplayed:true, httpStatus:response.status, matchedError:true, noAcceptedReplay:true};
    row.status = 'passed';
  } catch (error) {
    row.status = 'failed';
    row.fixtureError = provider.error() || null;
    row.error = {name:error.name, code:error.code ?? null, message:error.message, stack:String(error.stack).replaceAll(temporary,'<temporary>').slice(0,5000)};
  } finally {
    approvals.close();
    server.closeAllConnections();
    const [shutdown] = await Promise.all([manager.close(), new Promise((resolve) => server.close(resolve))]);
    row.cleanup = {pending:shutdown.cleanupPending.length, activeRuns:manager.runs.size};
    row.runtimeEvents = events;
    assert.equal(shutdown.cleanupPending.length, 0);
    const resolved = await fs.realpath(temporary);
    assert.equal(path.dirname(resolved), parent);
    assert(path.basename(resolved).startsWith('zx-approval-provider-probe-'));
    await fs.rm(resolved, {recursive:true, force:true, maxRetries:6, retryDelay:150});
    row.cleanup.temporaryRemoved = true;
    row.receivedModelRequests = local.receivedModelRequests;
    row.requestShapes = local.requestShapes;
    row.finishedAt = new Date().toISOString();
    await persist();
    console.log(JSON.stringify({name:row.name,status:row.status,requests:row.businessRequestCount,fixtureError:row.fixtureError,error:row.error?.message,contentShapes:row.observations.flatMap((observation) => observation.tools.map((tool) => tool.contentShape))}));
  }
}

try {
  for (const name of ['allow','reject','present','reload']) await scenario(name);
  report.status = report.cases.every((row) => row.status === 'passed') ? 'passed' : 'failed';
} catch (error) {
  report.status = 'failed';
  report.error = {message:error.message, stack:String(error.stack).slice(0,4000)};
} finally {
  report.finishedAt = new Date().toISOString();
  await persist();
  if (report.status !== 'passed') process.exitCode = 1;
}

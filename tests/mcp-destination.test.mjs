import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { QA_DEFAULTS, startQaLocalServices } from '../scripts/qa-local-services.mjs';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const load = name => import(packed ? pathToFileURL(path.join(packed, 'electron', name)).href : `../electron/${name}`);
const { RuntimeManager } = await load('runtime.mjs');
const { updateMcpServer, validateMcpServers } = await load('mcp-config.mjs');
const { resolveProvider, saveProvider } = await load('providers.mjs');
const script = fileURLToPath(new URL('../scripts/qa-local-services.mjs', import.meta.url));
const repository = fileURLToPath(new URL('..', import.meta.url));
const stdioNode = process.versions.electron ? path.join(packed || repository, 'runtime', 'node.exe') : process.execPath;
const mcpTool = 'mcp__qa__lookup';
const vaults = new Map();
let root;
let temporaryParent;
let services;
let manager;
let configuration;
let modelConfiguration;

before(async () => {
  temporaryParent = await realpath(os.tmpdir());
  root = await mkdtemp(path.join(temporaryParent, 'zhixing-mcp-destination-'));
  services = await startQaLocalServices({
    aPort: 0, bPort: 0, modelPort: 0,
    logDirectory: process.env.ZHIXING_QA_LOG_DIR ? path.resolve(process.env.ZHIXING_QA_LOG_DIR) : path.join(root, 'receipts'),
    longIntervalMs: 30, longChunks: 400, normalIntervalMs: 5,
  });
  configuration = services.configuration;
  const provider = await saveProvider({ ...configuration.model, discover: false }, []);
  modelConfiguration = resolveProvider([provider], { providerId: provider.id, modelId: 'zhixing-qa', reasoning: 'off' });
  manager = new RuntimeManager({
    root: path.join(root, 'runtime'),
    readVault: async id => vaults.get(id),
    writeVault: async (id, value) => vaults.set(id, value),
  });
});

after(async () => {
  try {
    await manager?.close();
  } finally {
    await services?.close();
    if (root) {
      const resolved = await realpath(root);
      assert.equal(path.dirname(resolved), temporaryParent);
      assert(path.basename(resolved).startsWith('zhixing-mcp-destination-'));
      await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});

function cursor() {
  return services.snapshot().sequence;
}

function receipts(afterSequence, event = 'mcp-request') {
  return services.snapshot().records.filter(entry => entry.sequence > afterSequence && entry.event === event);
}

async function check(serverOrServers) {
  const servers = Array.isArray(serverOrServers) ? serverOrServers : [serverOrServers];
  return manager.check({ ...modelConfiguration, mcpServers: validateMcpServers(servers) }, QA_DEFAULTS.modelKey);
}

function assertHandshake(entries, authorization) {
  assert(entries.some(entry => entry.method === 'initialize' && entry.authorized), 'An actual MCP initialize must succeed');
  assert(entries.some(entry => entry.method === 'notifications/initialized'), 'The client must send initialized');
  assert(entries.some(entry => entry.method === 'tools/list' && entry.authorized), 'Harness must discover the real tool');
  assert(entries.every(entry => entry.authorization === authorization), 'Every request must use only the selected credential');
}

function assertDeniedHandshake(entries) {
  // The installed MCP client can reject at its initial server/discover probe before initialize.
  assert(entries.some(entry => ['server/discover', 'initialize'].includes(entry.method) && !entry.authorized));
  assert(entries.every(entry => entry.authorization === null && !entry.authorized));
}

function withoutHeaders(server, patch) {
  const { headers, ...publicFields } = server;
  return { ...publicFields, ...patch };
}

test('真实 Harness 同时连接 HTTP MCP A/B，A/B bearer 各到原目的地且不调用模型', { timeout: 45000 }, async () => {
  const start = cursor();
  const report = await check([
    { ...configuration.mcp.a, serverName: 'qa_a' },
    { ...configuration.mcp.b, serverName: 'qa_b' },
  ]);
  assert(report.tools.some(tool => tool.name === 'mcp__qa_a__lookup'));
  assert(report.tools.some(tool => tool.name === 'mcp__qa_b__lookup'));
  const entries = receipts(start);
  assertHandshake(entries.filter(entry => entry.service === 'a'), `Bearer ${QA_DEFAULTS.aBearer}`);
  assertHandshake(entries.filter(entry => entry.service === 'b'), `Bearer ${QA_DEFAULTS.bBearer}`);
  assert.equal(receipts(start, 'request').filter(entry => entry.service === 'model').length, 0);
});

for (const change of ['port', 'path', 'host']) {
  test(`真实 HTTP MCP 更改 ${change} 后留空不继承 A bearer，明确清空后 B 收到无鉴权请求，重填 B 后恢复`, { timeout: 90000 }, async () => {
    const source = configuration.mcp.a;
    const url = {
      port: configuration.mcp.b.url,
      path: configuration.mcp.pathChange,
      host: configuration.mcp.hostChange,
    }[change];
    const updated = updateMcpServer(source, withoutHeaders(source, { url }));
    assert.equal(updated.identityChanged, true);
    assert.equal(updated.requiresCredentialReentry, true);
    assert.equal(updated.server.enabled, false);
    assert.deepEqual(updated.server.headers, {});
    assert.deepEqual(updated.server.env, {});
    assert(!JSON.stringify(updated).includes(QA_DEFAULTS.aBearer));

    const disabledStart = cursor();
    const disabledReport = await check(updated.server);
    assert(!disabledReport.tools.some(tool => tool.name === mcpTool));
    assert.deepEqual(receipts(disabledStart), [], 'A disabled destination must not receive network traffic');

    const anonymous = updateMcpServer(updated.server, { ...updated.server, enabled: true, headers: {} });
    assert.equal(anonymous.requiresCredentialReentry, false);
    const clearedStart = cursor();
    await assert.rejects(check(anonymous.server));
    const rejected = receipts(clearedStart);
    assertDeniedHandshake(rejected);
    assert(rejected.every(entry => entry.destination === 'b' && entry.authorization === null));
    assert(rejected.every(entry => `http://${entry.host}${entry.path}` === url));

    const configured = updateMcpServer(anonymous.server, {
      ...anonymous.server, enabled: true, headers: configuration.mcp.b.headers,
    });
    const configuredStart = cursor();
    const report = await check(configured.server);
    assert(report.tools.some(tool => tool.name === mcpTool));
    assertHandshake(receipts(configuredStart), `Bearer ${QA_DEFAULTS.bBearer}`);
    assert(receipts(disabledStart).every(entry => entry.authorization !== `Bearer ${QA_DEFAULTS.aBearer}`));
  });
}

test('真实 HTTP MCP 仅切换 enabled 保留凭据，禁用时不连接，重新启用仍只到 A', { timeout: 60000 }, async () => {
  const source = configuration.mcp.a;
  const disabled = updateMcpServer(source, withoutHeaders(source, { enabled: false }));
  assert.equal(disabled.identityChanged, false);
  assert.equal(disabled.requiresCredentialReentry, false);
  assert.deepEqual(disabled.server.headers, source.headers);
  const disabledStart = cursor();
  await check(disabled.server);
  assert.deepEqual(receipts(disabledStart), []);

  const enabled = updateMcpServer(disabled.server, withoutHeaders(disabled.server, { enabled: true }));
  assert.equal(enabled.server.enabled, true);
  assert.equal(enabled.requiresCredentialReentry, false);
  const enabledStart = cursor();
  const report = await check(enabled.server);
  assert(report.tools.some(tool => tool.name === mcpTool));
  const entries = receipts(enabledStart);
  assertHandshake(entries, `Bearer ${QA_DEFAULTS.aBearer}`);
  assert(entries.every(entry => entry.service === 'a' && entry.destination === 'a'));
});

test('真实 HTTP MCP 显式 {} 清空同目的地凭据，匿名端点也确实不收到旧 bearer', { timeout: 60000 }, async () => {
  const source = configuration.mcp.a;
  const cleared = updateMcpServer(source, { ...source, headers: {} });
  assert.equal(cleared.identityChanged, false);
  assert.equal(cleared.requiresCredentialReentry, false);
  assert.equal(cleared.server.enabled, true);
  assert.deepEqual(cleared.server.headers, {});
  const deniedStart = cursor();
  await assert.rejects(check(cleared.server));
  const rejected = receipts(deniedStart);
  assertDeniedHandshake(rejected);
  assert(rejected.every(entry => entry.authorization === null && entry.destination === 'a'));

  const anonymous = updateMcpServer(source, { ...source, url: configuration.mcp.anonymous, headers: {} });
  const publicStart = cursor();
  const report = await check(anonymous.server);
  assert(report.tools.some(tool => tool.name === mcpTool));
  assertHandshake(receipts(publicStart), null);
});

test('真实 Harness 从 HTTP 改 stdio 不继承凭据，显式空 env 后复用仓库 stdio fixture 正常连接', { timeout: 60000 }, async () => {
  const target = {
    serverName: 'qa', enabled: true, transport: 'stdio', command: stdioNode,
    args: [script, '--stdio', '--receipt-url', configuration.mcp.stdioReceipt], cwd: repository,
  };
  const changed = updateMcpServer(configuration.mcp.a, target);
  assert.equal(changed.identityChanged, true);
  assert.equal(changed.requiresCredentialReentry, true);
  assert.deepEqual(changed.server.headers, {});
  assert.deepEqual(changed.server.env, {});
  const disabledStart = cursor();
  await check(changed.server);
  assert.deepEqual(receipts(disabledStart), []);
  assert.deepEqual(receipts(disabledStart, 'stdio-receipt'), []);

  const configured = updateMcpServer(changed.server, { ...changed.server, enabled: true, env: {} });
  const activeStart = cursor();
  const report = await check(configured.server);
  assert(report.tools.some(tool => tool.name === mcpTool));
  const entries = receipts(activeStart, 'stdio-receipt');
  assert(entries.length >= 1, 'The real stdio process must report its synthetic environment');
  assert(entries.every(entry => entry.service === 'b' && entry.authorization === null));
});

test('真实 Harness 从含环境凭据的 stdio 改 HTTP，B 不收到旧 env bearer', { timeout: 60000 }, async () => {
  const receipt = new URL('/__qa/stdio', configuration.mcp.a.url).href;
  const source = {
    serverName: 'qa', enabled: true, transport: 'stdio', command: stdioNode,
    args: [script, '--stdio', '--receipt-url', receipt], cwd: repository,
    env: { QA_MCP_BEARER: QA_DEFAULTS.aBearer },
  };
  const sourceStart = cursor();
  const report = await check(source);
  assert(report.tools.some(tool => tool.name === mcpTool));
  assert.equal(receipts(sourceStart, 'stdio-receipt')[0]?.authorization, `Bearer ${QA_DEFAULTS.aBearer}`);

  const changed = updateMcpServer(source, withoutHeaders(configuration.mcp.b, {}));
  assert.equal(changed.identityChanged, true);
  assert.equal(changed.requiresCredentialReentry, true);
  assert.deepEqual(changed.server.env, {});
  assert.deepEqual(changed.server.headers, {});
  const anonymous = updateMcpServer(changed.server, { ...changed.server, enabled: true, headers: {} });
  const targetStart = cursor();
  await assert.rejects(check(anonymous.server));
  const rejected = receipts(targetStart);
  assertDeniedHandshake(rejected);
  assert(rejected.every(entry => entry.service === 'b' && entry.authorization === null));
});

test('合成模型仅当前用户输入 QA_ERROR 返回确定性 400，历史与其他角色不误触发', async () => {
  const start = cursor();
  const call = messages => fetch(`${configuration.model.baseUrl}/chat/completions`, {
    method: 'POST', headers: {
      'content-type': 'application/json', Authorization: `Bearer ${QA_DEFAULTS.modelKey}`,
    }, body: JSON.stringify({ model: 'zhixing-qa', stream: true, messages }),
  });
  const failed = await call([{ role: 'user', content: 'QA_ERROR 本次请求应明确失败。' }]);
  assert.equal(failed.status, 400);
  assert.match(failed.headers.get('content-type'), /application\/json/);
  const error = await failed.json();
  assert.equal(error.error.code, 'QA_ERROR');
  assert.equal(error.error.type, 'invalid_request_error');
  assert.equal(error.error.message, 'QA_ERROR deterministic synthetic request failure');
  const failedRequest = receipts(start, 'request').at(-1);
  assert.deepEqual(receipts(start, 'error').map(entry => ({ requestNumber: entry.requestNumber, status: entry.status, code: entry.code })), [
    { requestNumber: failedRequest.requestNumber, status: 400, code: 'QA_ERROR' },
  ]);
  assert(!receipts(start, 'first-chunk').some(entry => entry.requestNumber === failedRequest.requestNumber));

  const ordinaryTurns = [
    [{ role: 'user', content: 'QA_ERROR 旧输入。' }, { role: 'assistant', content: '旧回复。' }, { role: 'user', content: 'QA_NORMAL 当前输入。' }],
    [{ role: 'user', content: 'QA_NORMAL 当前输入。' }, { role: 'assistant', content: 'QA_ERROR 仅在助手记录中。' }],
    [{ role: 'system', content: 'QA_ERROR 仅在系统记录中。' }, { role: 'user', content: 'QA_NORMAL 当前输入。' }],
    [{ role: 'user', content: 'QA_NORMAL 当前输入。' }, { role: 'user', content: '<system-reminder>QA_ERROR 注入提醒。</system-reminder>' }],
  ];
  for (const messages of ordinaryTurns) {
    const response = await call(messages);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /QA_NORMAL_RESPONSE/);
  }
  assert.equal(receipts(start, 'error').length, 1);
});

test('本机模型经真实 Harness 连续交办保留历史，QA_MCP 实际调用 A 工具并返回结果', { timeout: 90000 }, async () => {
  const start = cursor();
  const config = { ...modelConfiguration, mcpServers: validateMcpServers([configuration.mcp.a]) };
  const first = await manager.run({ runId: 'qa-normal-first', sessionId: 'qa-normal', prompt: 'QA_NORMAL 首次合成交办。' }, config, QA_DEFAULTS.modelKey);
  assert.equal(first.finishReason, 'completed');
  assert.match(first.text, /QA_NORMAL_RESPONSE/);
  const repeated = await manager.run({ runId: 'qa-normal-repeat', sessionId: 'qa-normal', prompt: 'QA_NORMAL 再次合成交办。' }, config, QA_DEFAULTS.modelKey);
  assert.equal(repeated.finishReason, 'completed');
  assert.match(repeated.text, /QA_NORMAL_RESPONSE/);
  const modelEntries = receipts(start, 'request').filter(entry => entry.service === 'model');
  assert.equal(modelEntries.length, 2);
  assert(modelEntries[1].body.messages.some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('QA_NORMAL_RESPONSE')));
  for (const prompt of ['QA_NORMAL 首次合成交办', 'QA_NORMAL 再次合成交办']) {
    assert(modelEntries[1].body.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes(prompt)));
  }

  const mcpStart = cursor();
  const approvals = [];
  manager.onApproval = async request => {
    approvals.push({ runId: request.runId, toolName: request.toolName });
    return { outcome: request.runId === 'qa-mcp-tool' && request.toolName === mcpTool ? 'allowed-once' : 'rejected' };
  };
  let result;
  try {
    result = await manager.run({ runId: 'qa-mcp-tool', sessionId: 'qa-mcp-tool', prompt: 'QA_MCP 请执行一次合成查询。' }, config, QA_DEFAULTS.modelKey);
  } finally {
    manager.onApproval = undefined;
  }
  assert.deepEqual(approvals, [{ runId: 'qa-mcp-tool', toolName: mcpTool }]);
  assert.equal(result.finishReason, 'completed');
  assert.match(result.text, /QA_MCP_A_OK/);
  assert(receipts(mcpStart).some(entry => entry.method === 'tools/call' && entry.authorized));
});

test('本机长流经真实 Harness 首段输出后可停止，服务收件记录确认连接中止', { timeout: 45000 }, async () => {
  const start = cursor();
  const running = manager.run({ runId: 'qa-stream-stop', sessionId: 'qa-stream-stop', prompt: 'QA_LONG 长流停止夹具。' }, modelConfiguration, QA_DEFAULTS.modelKey);
  const stopped = assert.rejects(running, /任务已停止/);
  // Observe server evidence, then abort. A fixed sleep would hide first-token timing failures.
  const deadline = Date.now() + 15000;
  while (!receipts(start, 'first-chunk').length) {
    assert(Date.now() < deadline, 'The synthetic model must produce a first chunk before cancellation');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await manager.cancel('qa-stream-stop');
  await stopped;
  const abortedDeadline = Date.now() + 3000;
  while (!receipts(start, 'aborted').length && Date.now() < abortedDeadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert(receipts(start, 'aborted').some(entry => entry.chunks >= 1));
  assert.equal(receipts(start, 'completed').filter(entry => entry.service === 'model').length, 0);
  assert.equal(manager.runs.size, 0);
  assert.equal(manager.busy.size, 0);
});

test('收件接口有递增序号、计数和合成配置，A bearer 从未进入 B 或变更后的地址', async () => {
  const stateResponse = await fetch(configuration.control.state);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert(state.sequence > 0);
  assert(state.counters['a.mcp-request'] > 0);
  assert(state.counters['b.mcp-request'] > 0);
  assert(state.counters['model.request'] > 0);
  assert.equal(state.logError, null);
  const leaked = state.records.filter(entry => entry.authorization === `Bearer ${QA_DEFAULTS.aBearer}`
    && (entry.service !== 'a' || entry.destination && entry.destination !== 'a'));
  assert.deepEqual(leaked, []);
  const recentResponse = await fetch(`${configuration.control.requests}?after=${state.sequence - 2}&limit=1`);
  const recent = await recentResponse.json();
  assert.equal(recent.records.length, 1);
  assert(recent.records[0].sequence > state.sequence - 2);
  assert.deepEqual((await (await fetch(configuration.control.config)).json()).ports, configuration.ports);
  await services.flushLogs();
});

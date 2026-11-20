import http from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const QA_DEFAULTS = Object.freeze({
  aPort: 43121,
  bPort: 43122,
  modelPort: 43123,
  aBearer: 'zhixing-qa-mcp-a',
  bBearer: 'zhixing-qa-mcp-b',
  modelKey: 'zhixing-qa-model',
});

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const maxBodyBytes = 8 * 1024 * 1024;
const mcpPaths = new Set(['/mcp', '/mcp-b', '/mcp-public']);

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('QA request exceeds 8 MiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safeAuthorization(value) {
  if (!value) return null;
  const known = [QA_DEFAULTS.aBearer, QA_DEFAULTS.bBearer, QA_DEFAULTS.modelKey];
  return known.some(token => value === `Bearer ${token}`) ? value : '[unrecognized credential]';
}

function mcpReply(message, destination) {
  let result;
  switch (message.method) {
    case 'initialize':
      result = {
        protocolVersion: message.params?.protocolVersion || '2025-03-26',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: `zhixing-qa-${destination}`, version: '0.11.0' },
      };
      break;
    case 'ping':
      result = {};
      break;
    case 'tools/list':
      result = {
        tools: [{
          name: 'lookup',
          description: `本机合成 MCP ${destination.toUpperCase()} 查询，不调用外网`,
          inputSchema: {
            type: 'object', properties: { query: { type: 'string' } }, required: ['query'],
          },
        }],
      };
      break;
    case 'tools/call':
      if (message.params?.name !== 'lookup') {
        return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Unknown QA tool' } };
      }
      result = { content: [{ type: 'text', text: `QA_MCP_${destination.toUpperCase()}_OK ${JSON.stringify(message.params.arguments || {})}` }] };
      break;
    case 'resources/list':
      result = { resources: [{ uri: `qa://${destination}/notes`, name: `合成资料 ${destination.toUpperCase()}`, mimeType: 'text/plain' }] };
      break;
    case 'resources/templates/list':
      result = { resourceTemplates: [] };
      break;
    case 'resources/read':
      result = { contents: [{ uri: message.params?.uri, mimeType: 'text/plain', text: `QA_RESOURCE_${destination.toUpperCase()}_OK` }] };
      break;
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  }
  return { jsonrpc: '2.0', id: message.id, result };
}

function userTurn(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const content = typeof message.content === 'string' ? message.content
      : Array.isArray(message.content) ? message.content.map(block => block.text || '').join('\n') : '';
    const text = content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (text) return { text, index };
  }
  return { text: '', index: -1 };
}

function conversationReply(body, requestNumber, prompt, following, sourceUrl) {
  const tools = body.tools || [];
  const results = new Set(following.filter(message => message.role === 'tool').map(message => message.tool_call_id));
  const completed = following.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls || [])
    .filter(call => results.has(call.id)).map(call => call.function?.name);
  function call(name, arguments_) {
    if (!tools.some(tool => tool.function?.name === name)) return { content: `QA_CONVERSATION_TOOL_UNAVAILABLE ${name}` };
    return { content: null, tool_calls: [{ id: `qa-conversation-${requestNumber}`, type: 'function', function: {
      name, arguments: JSON.stringify(arguments_),
    } }] };
  }
  if (prompt.includes('QA_CONVERSATION_PRESENT')) {
    const filename = prompt.match(/QA_OUTPUT=(qa-conversation-[a-z0-9-]+\.txt)\b/)?.[1];
    if (!filename) return { content: 'QA_CONVERSATION_INVALID_OUTPUT_NAME' };
    if (!completed.includes('office_write_file')) return call('office_write_file', {
      file_path: filename, content: 'QA_CONVERSATION_FILE_CONTENT\n合成产出，金额 123.45，编号 00123。',
    });
    if (!completed.includes('present')) return call('present', { files: [{ path: filename, description: '本机 Harness 生成并交付的合成成果' }] });
    return { content: `QA_CONVERSATION_PRESENT_RESPONSE\n已通过真实文件工具和 present 交付 ${filename}。` };
  }
  if (prompt.includes('QA_CONVERSATION_SEARCH')) {
    if (!completed.includes('web_search')) return call('web_search', { queries: ['知行合成来源验收'] });
    const searchResult = following.findLast(message => message.role === 'tool');
    if (JSON.stringify(searchResult?.content || '').includes('搜索暂不可用')) {
      return { content: 'QA_CONVERSATION_SEARCH_UNAVAILABLE_RESPONSE\n当前路由没有配置独立搜索服务，工具失败已记录。' };
    }
    return { content: 'QA_CONVERSATION_SEARCH_RESPONSE\n工具调用结果以执行轨迹为准。' };
  }
  if (prompt.includes('QA_CONVERSATION_LINK_UNMAPPED')) {
    return { content: `QA_CONVERSATION_LINK_RESPONSE\n[本机合成来源页面](${sourceUrl})` };
  }
  if (prompt.includes('QA_CONVERSATION_LINK')) {
    // Echo the model-visible address, including privacy tokens, just as a real
    // model must do. An address invented by this server has no input mapping.
    const requestedUrl = prompt.match(/QA_SOURCE_URL=(https?:\/\/[^\s]+)/u)?.[1];
    if (!requestedUrl) return { content: 'QA_CONVERSATION_SOURCE_URL_REQUIRED' };
    return { content: `QA_CONVERSATION_LINK_RESPONSE\n[本机合成来源页面](${requestedUrl})` };
  }
  return null;
}

function modelReply(body, requestNumber, sourceUrl) {
  const messages = body.messages || [];
  const { text: prompt, index: lastUser } = userTurn(messages);
  const toolResult = messages.slice(lastUser + 1).findLast(message => message.role === 'tool');
  const conversation = conversationReply(body, requestNumber, prompt, messages.slice(lastUser + 1), sourceUrl);
  if (conversation) return conversation;
  const mcpTool = body.tools?.find(tool => /^mcp__.+__lookup$/.test(tool.function?.name));
  if (prompt.includes('QA_MCP') && mcpTool && !toolResult) {
    return {
      content: null,
      tool_calls: [{ id: `qa-tool-${requestNumber}`, type: 'function', function: {
        name: mcpTool.function.name, arguments: JSON.stringify({ query: 'synthetic-ui-acceptance' }),
      } }],
    };
  }
  const detail = toolResult ? JSON.stringify(toolResult.content) : prompt.slice(-320);
  return { content: `QA_NORMAL_RESPONSE 请求 ${requestNumber}\n本机合成服务已完成本次交办。\n${detail}` };
}

/** Start loopback-only MCP A/B and a synthetic Chat Completions service. */
export async function startQaLocalServices({
  aPort = QA_DEFAULTS.aPort,
  bPort = QA_DEFAULTS.bPort,
  modelPort = QA_DEFAULTS.modelPort,
  logDirectory = path.resolve('.preview/qa-local-services'),
  longIntervalMs = 500,
  longChunks = 240,
  normalIntervalMs = 80,
} = {}) {
  const servers = [];
  const timers = new Set();
  const records = [];
  const counters = {};
  const startedAt = new Date().toISOString();
  let sequence = 0;
  let modelRequests = 0;
  let pendingLog = Promise.resolve();
  let logError = null;
  let closing = false;
  let configuration;
  if (logDirectory) await mkdir(logDirectory, { recursive: true });
  const logFile = logDirectory ? path.join(logDirectory, 'receipts.jsonl') : null;

  function record(event) {
    const entry = { sequence: ++sequence, time: new Date().toISOString(), ...event };
    records.push(entry);
    if (records.length > 5000) records.shift();
    const key = `${entry.service}.${entry.event}`;
    counters[key] = (counters[key] || 0) + 1;
    if (logFile) {
      pendingLog = pendingLog.then(() => appendFile(logFile, `${JSON.stringify(entry)}\n`, 'utf8'))
        .catch(error => { logError = error.message; });
    }
    return entry;
  }

  function snapshot() {
    return { startedAt, sequence, counters: { ...counters }, logFile, logError, records: [...records] };
  }

  async function handleControl(request, response, url, service) {
    if (request.method === 'GET' && url.pathname === '/__qa/conversation/page') {
      record({ service, event: 'conversation-page', path: url.pathname });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>知行合成来源页面</title><h1>知行合成来源页面</h1><p>QA_CONVERSATION_WEB_SOURCE</p><p>仅用于本机 UI 验收。合成金额 123.45，编号 00123。</p></html>');
    } else if (request.method === 'GET' && url.pathname === '/__qa/health') {
      json(response, 200, { ok: !closing, service, startedAt, pid: process.pid, logError });
    } else if (request.method === 'GET' && url.pathname === '/__qa/config') {
      json(response, 200, configuration);
    } else if (request.method === 'GET' && url.pathname === '/__qa/state') {
      json(response, 200, snapshot());
    } else if (request.method === 'GET' && url.pathname === '/__qa/requests') {
      const after = Number(url.searchParams.get('after') || 0);
      const requestedLimit = Number(url.searchParams.get('limit') || 1000);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(5000, requestedLimit)) : 1000;
      json(response, 200, { sequence, counters, records: records.filter(item => item.sequence > after).slice(0, limit) });
    } else if (request.method === 'POST' && url.pathname === '/__qa/stdio') {
      const body = await readJson(request);
      const authorization = safeAuthorization(body.authorization);
      record({ service, event: 'stdio-receipt', authorization, pid: body.pid });
      json(response, 200, { ok: true });
    } else if (request.method === 'POST' && url.pathname === '/__qa/reset') {
      records.length = 0;
      for (const key of Object.keys(counters)) delete counters[key];
      record({ service, event: 'reset' });
      json(response, 200, { ok: true, sequence });
    } else {
      json(response, 404, { error: 'Unknown QA control endpoint' });
    }
  }

  async function handleMcp(request, response, url, service) {
    const destination = service === 'b' || url.pathname === '/mcp-b' || url.hostname !== '127.0.0.1' ? 'b' : 'a';
    const expected = destination === 'a' ? QA_DEFAULTS.aBearer : QA_DEFAULTS.bBearer;
    const authorization = safeAuthorization(request.headers.authorization);
    const anonymous = url.pathname === '/mcp-public';
    const authorized = anonymous ? !request.headers.authorization : request.headers.authorization === `Bearer ${expected}`;
    let body;
    if (request.method === 'POST') body = await readJson(request);
    record({ service, destination, event: 'mcp-request', httpMethod: request.method,
      host: url.host, path: url.pathname, authorization, authorized,
      method: body?.method, id: body?.id, params: body?.params,
      protocolVersion: request.headers['mcp-protocol-version'] || null });
    if (!authorized) {
      // No WWW-Authenticate discovery URL. A rejected synthetic token never triggers external OAuth.
      json(response, 403, { error: 'Synthetic MCP bearer required for this destination' });
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' });
      response.end();
      return;
    }
    if (body?.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      json(response, 400, { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
    } else if (body.id === undefined) {
      response.writeHead(202).end();
    } else {
      json(response, 200, mcpReply(body, destination));
    }
  }

  async function handleModel(request, response, url) {
    const modelPath = url.pathname.replace(/^\/conversation-b(?=\/)/, '');
    const authorization = safeAuthorization(request.headers.authorization);
    const authorized = request.headers.authorization === `Bearer ${QA_DEFAULTS.modelKey}`;
    if (!authorized) {
      record({ service: 'model', event: 'rejected', path: url.pathname, authorization });
      json(response, 401, { error: { message: 'Synthetic model key required', type: 'authentication_error' } });
      return;
    }
    if (request.method === 'GET' && modelPath === '/v1/models') {
      record({ service: 'model', event: 'models', path: url.pathname, authorization });
      json(response, 200, { object: 'list', data: ['zhixing-qa', 'zhixing-qa-long'].map(id => ({ id, object: 'model', owned_by: 'local-qa' })) });
      return;
    }
    if (request.method !== 'POST' || modelPath !== '/v1/chat/completions') {
      json(response, 404, { error: { message: 'Unknown synthetic model endpoint' } });
      return;
    }
    const body = await readJson(request);
    const requestNumber = ++modelRequests;
    const entry = record({ service: 'model', event: 'request', path: url.pathname, authorization, requestNumber, body });
    if (userTurn(body.messages).text.includes('QA_ERROR')) {
      record({ service: 'model', event: 'error', requestNumber, status: 400, code: 'QA_ERROR' });
      json(response, 400, { error: {
        message: 'QA_ERROR deterministic synthetic request failure',
        type: 'invalid_request_error', code: 'QA_ERROR',
      } });
      return;
    }
    const message = modelReply(body, requestNumber, configuration.conversation.sourceUrl);
    if (message.tool_calls?.length) {
      record({ service: 'model', event: 'tool-call', requestNumber, path: url.pathname,
        model: body.model, calls: message.tool_calls.map(call => ({
          id: call.id,
          name: call.function?.name,
          arguments: call.function?.arguments,
        })) });
    }
    const long = body.model === 'zhixing-qa-long' || /QA_LONG|长时间输出|停止验收/.test(userTurn(body.messages).text);
    const id = `qa-completion-${entry.sequence}`;
    const created = Math.floor(Date.now() / 1000);
    const finishReason = message.tool_calls ? 'tool_calls' : 'stop';
    const usage = { prompt_tokens: 32, completion_tokens: 48, total_tokens: 80 };
    if (!body.stream) {
      json(response, 200, { id, created, object: 'chat.completion', model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }], usage });
      record({ service: 'model', event: 'completed', requestNumber, streaming: false });
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
      id, created, object: 'chat.completion.chunk', model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    let timer;
    let count = 0;
    let completed = false;
    const chunks = message.tool_calls ? [] : Array.from(message.content.matchAll(/[\s\S]{1,32}/gu), match => match[0]);
    const targetCount = long ? longChunks : chunks.length;
    response.once('close', () => {
      clearInterval(timer);
      timers.delete(timer);
      if (!completed) record({ service: 'model', event: 'aborted', requestNumber, chunks: count });
    });
    send({ role: 'assistant', content: '' });
    if (message.tool_calls) {
      send({ tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) });
      send({}, finishReason);
      completed = true;
      response.end('data: [DONE]\n\n');
      record({ service: 'model', event: 'completed', requestNumber, chunks: 1 });
      return;
    }
    function tick() {
      const content = long ? `QA_LONG_CHUNK_${String(count + 1).padStart(3, '0')} 本机持续输出，供停止与正文保留验收。\n` : chunks[count];
      send({ content });
      count += 1;
      if (count !== 1 && count < targetCount) return;
      record({ service: 'model', event: count === 1 ? 'first-chunk' : 'last-chunk', requestNumber, chunks: count });
      if (count < targetCount) return;
      clearInterval(timer);
      timers.delete(timer);
      send({}, 'stop');
      completed = true;
      response.end('data: [DONE]\n\n');
      record({ service: 'model', event: 'completed', requestNumber, chunks: count });
    }
    timer = setInterval(tick, long ? longIntervalMs : normalIntervalMs);
    timers.add(timer);
  }

  function handler(service) {
    return async (request, response) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        if (!loopbackHosts.has(url.hostname)) {
          json(response, 403, { error: 'QA services accept loopback hosts only' });
        } else if (url.pathname.startsWith('/__qa/')) {
          await handleControl(request, response, url, service);
        } else if (service === 'model') {
          await handleModel(request, response, url);
        } else if (mcpPaths.has(url.pathname)) {
          await handleMcp(request, response, url, service);
        } else {
          json(response, 404, { error: 'Unknown QA MCP endpoint' });
        }
      } catch (error) {
        record({ service, event: 'error', message: error.message });
        if (!response.headersSent) json(response, 400, { error: error.message });
        else response.end();
      }
    };
  }

  async function listen(service, port, host) {
    const server = http.createServer(handler(service));
    servers.push(server);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
    });
    return server.address().port;
  }

  async function bindService(service, port) {
    const actualPort = await listen(service, port, '127.0.0.1');
    await listen(service, actualPort, '::1');
    return actualPort;
  }

  async function close() {
    if (closing) return;
    closing = true;
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    await Promise.all(servers.map(server => new Promise(resolve => {
      server.closeAllConnections();
      server.close(resolve);
    })));
    await pendingLog;
  }

  try {
    const actualA = await bindService('a', aPort);
    const actualB = await bindService('b', bPort);
    const actualModel = await bindService('model', modelPort);
    const aBase = `http://127.0.0.1:${actualA}`;
    const bBase = `http://127.0.0.1:${actualB}`;
    const modelBase = `http://127.0.0.1:${actualModel}`;
    configuration = {
      syntheticOnly: true,
      mcp: {
        a: { serverName: 'qa', transport: 'streamable-http', enabled: true, url: `${aBase}/mcp`, headers: { Authorization: `Bearer ${QA_DEFAULTS.aBearer}` } },
        b: { serverName: 'qa', transport: 'streamable-http', enabled: true, url: `${bBase}/mcp`, headers: { Authorization: `Bearer ${QA_DEFAULTS.bBearer}` } },
        pathChange: `${aBase}/mcp-b`,
        hostChange: `http://localhost:${actualA}/mcp`,
        anonymous: `${aBase}/mcp-public`,
        stdioReceipt: `${bBase}/__qa/stdio`,
      },
      model: { name: '知行本机合成验收', protocol: 'openai', baseUrl: `${modelBase}/v1`, apiKey: QA_DEFAULTS.modelKey,
        reasoningStyle: 'standard', manualModels: 'zhixing-qa\nzhixing-qa-long', normalPrompt: 'QA_NORMAL 请输出一次正常合成回复。',
        longPrompt: 'QA_LONG 请持续输出供停止验收。', mcpPrompt: 'QA_MCP 请查询本机合成 MCP 工具。',
        errorPrompt: 'QA_ERROR 请验证发送失败后保留草稿。' },
      conversation: {
        sourceUrl: `${modelBase}/__qa/conversation/page`,
        providerBBaseUrl: `${modelBase}/conversation-b/v1`,
        presentPrompt: 'QA_CONVERSATION_PRESENT QA_OUTPUT=qa-conversation-example.txt',
        linkPrompt: `QA_CONVERSATION_LINK QA_SOURCE_URL=${modelBase}/__qa/conversation/page`,
        searchPrompt: 'QA_CONVERSATION_SEARCH 请记录一次实际搜索工具调用。',
      },
      control: { health: `${modelBase}/__qa/health`, state: `${modelBase}/__qa/state`, requests: `${modelBase}/__qa/requests`,
        config: `${modelBase}/__qa/config`, reset: `${modelBase}/__qa/reset` },
      ports: { a: actualA, b: actualB, model: actualModel }, logFile,
    };
    return { configuration, snapshot, close, flushLogs: () => pendingLog };
  } catch (error) {
    await close();
    throw error;
  }
}

async function runStdio(receiptUrl) {
  const url = new URL(receiptUrl);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname) || url.pathname !== '/__qa/stdio') {
    throw new Error('stdio receipt must use a loopback QA endpoint');
  }
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      pid: process.pid, authorization: process.env.QA_MCP_BEARER ? `Bearer ${process.env.QA_MCP_BEARER}` : null,
    }) });
  if (!response.ok) throw new Error(`stdio receipt failed with HTTP ${response.status}`);
  // Reuse the repository's real JSON-RPC stdio fixture after recording its synthetic environment.
  await import('../tests/fixtures/mcp-server.mjs');
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--stdio' && args[1] === '--receipt-url' && args.length === 3) {
    await runStdio(args[2]);
    return;
  }
  if (args.includes('--help')) {
    console.log('node scripts/qa-local-services.mjs [--log-dir DIRECTORY]');
    console.log('Loopback MCP A 43121, MCP B 43122, Chat Completions 43123. All credentials are synthetic.');
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--log-dir')) throw new Error('Use --help for QA service arguments');
  const services = await startQaLocalServices(args.length ? { logDirectory: path.resolve(args[1]) } : {});
  console.log(JSON.stringify(services.configuration, null, 2));
  console.log('QA services ready. Use Ctrl+C to stop. Receipts contain synthetic data only.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    services.close().then(() => { process.exitCode = 0; }).catch(error => { console.error(error); process.exitCode = 1; });
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

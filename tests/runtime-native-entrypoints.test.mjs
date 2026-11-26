import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packedRoot = process.env.ZHIXING_TEST_PACKED_APP;
const { composePrompt, workflows } = await import(packedRoot
  ? pathToFileURL(path.join(packedRoot, 'src/office-workflows.js')).href
  : '../src/office-workflows.js');
const { RuntimeManager } = await import(packedRoot
  ? pathToFileURL(path.join(packedRoot, 'electron/runtime.mjs')).href
  : '../electron/runtime.mjs');

function sendResponse(res, protocol, model, response) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (protocol === 'openai') {
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'native-entrypoint-response', object: 'chat.completion.chunk', created: 1, model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (response.tool) {
      send({ tool_calls: [{ index: 0, id: 'delegate-once', type: 'function', function: {
        name: response.tool.name, arguments: JSON.stringify(response.tool.input),
      } }] });
      send({}, 'tool_calls');
    } else {
      send({ content: response.text });
      send({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
    return;
  }
  const send = (type, value = {}) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  send('message_start', { message: {
    id: 'native-entrypoint-response', type: 'message', role: 'assistant', model,
    content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 },
  } });
  if (response.tool) {
    send('content_block_start', { index: 0, content_block: {
      type: 'tool_use', id: 'delegate-once', name: response.tool.name, input: {},
    } });
    send('content_block_delta', { index: 0, delta: {
      type: 'input_json_delta', partial_json: JSON.stringify(response.tool.input),
    } });
  } else {
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: response.text } });
  }
  send('content_block_stop', { index: 0 });
  send('message_delta', {
    delta: { stop_reason: response.tool ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: 10 },
  });
  send('message_stop');
  res.end();
}

async function fixture(t, protocol, respond) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'zhixing-native-entrypoints-'));
  const requests = [], errors = [], vaults = new Map(), events = [];
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, protocol === 'openai' ? '/v1/chat/completions' : '/v1/messages');
      const parts = [];
      for await (const part of req) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString());
      requests.push(body);
      sendResponse(res, protocol, body.model, respond(body));
    } catch (error) {
      errors.push(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const manager = new RuntimeManager({
    root, readVault: async id => vaults.get(id),
    writeVault: async (id, value) => vaults.set(id, value),
    onEvent: event => events.push(event),
  });
  t.after(async () => {
    try {
      await manager.close();
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      const resolved = await fs.realpath(root);
      assert.equal(path.dirname(resolved), parent);
      assert(path.basename(resolved).startsWith('zhixing-native-entrypoints-'));
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  });
  const config = {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    protocol, providerId: `fixture-${protocol}`, model: 'native-route-fixture',
    reasoning: 'off', reasoningMap: false, manualControls: true,
    kernel: { taskTimeoutSeconds: 60 },
  };
  return { manager, config, requests, errors, events, key: 'native-entrypoint-fixture-key' };
}

test('原生技能手势在界面组装与任务模式前缀后仍注入完整技能，无需模型调用 skill', { timeout: 40000 }, async t => {
  const f = await fixture(t, 'openai', () => ({ text: 'SKILL_ENTRYPOINT_COMPLETED' }));
  const prompt = composePrompt(`/zhixing-office-1\n${workflows.office[0][1]}会议于上午召开。`, []);
  const result = await f.manager.run({ runId: 'skill-entrypoint', sessionId: 'skill-entrypoint', prompt }, f.config, f.key);
  assert.equal(result.finishReason, 'completed');
  assert.equal(result.text, 'SKILL_ENTRYPOINT_COMPLETED');
  assert.deepEqual(f.errors, []);
  assert.equal(f.requests.length, 1);
  const messages = JSON.stringify(f.requests[0].messages);
  assert.match(messages, /任务模式：办公/);
  assert.match(messages, /【本次交办】/);
  assert.match(messages, /<skill_content name=\\"zhixing-office-1\\">/);
  assert.match(messages, /## 交付要求/);
  assert.equal(f.events.filter(event => event.type === 'tool/call').length, 0);
});

for (const protocol of ['openai', 'anthropic']) {
  test(`原生子 Agent 继承 ${protocol} 自定义路由，真实发出请求并保留独立会话输出`, { timeout: 50000 }, async t => {
    let requestedChild = false;
    const isChild = body => {
      const text = JSON.stringify(body.messages);
      return text.includes('CHILD_ROUTE_FIXTURE') && !text.includes('PARENT_ROUTE_FIXTURE');
    };
    const f = await fixture(t, protocol, body => {
      if (isChild(body)) return { text: 'CHILD_ROUTE_COMPLETED' };
      if (!requestedChild) {
        requestedChild = true;
        return { tool: { name: 'subagent', input: {
          description: '路由继承合成验收', prompt: 'CHILD_ROUTE_FIXTURE 只回复合成验收结果。',
        } } };
      }
      return { text: 'PARENT_ROUTE_COMPLETED' };
    });
    const sessionId = `child-route-${protocol}`;
    const result = await f.manager.run({ runId: sessionId, sessionId, prompt: 'PARENT_ROUTE_FIXTURE 请委派一个子任务。' }, f.config, f.key);
    assert.equal(result.finishReason, 'completed');
    assert.deepEqual(f.errors, []);
    assert.equal(f.requests.filter(isChild).length, 1, 'Must observe a child model request, not just a subagent tool result');
    assert(f.requests.every(body => body.model === f.config.model));
    assert(result.children.some(child => child.status === 'completed' && child.messages.some(message => message.text.includes('CHILD_ROUTE_COMPLETED'))));
    assert(f.events.some(event => event.type === 'subagents' && event.status === 'completed'));
    assert(!f.events.some(event => event.type === 'draft' && event.text?.includes('CHILD_ROUTE_COMPLETED')), 'Child output must not replace the main assistant stream');
  });
}

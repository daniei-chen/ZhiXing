import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fixture, name } from './fixtures/plugin-bundles.mjs';
import { mkdir, mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const packed = process.env.ZHIXING_TEST_PACKED_APP;
const load = name => import(packed ? pathToFileURL(path.join(packed, 'electron', name)).href : `../electron/${name}`);
const { PluginService } = await load('plugin-service.mjs');
const { RuntimeManager } = await load('runtime.mjs');

test('Harness 原生目录与 pnpm 隔离管理，可安装、启用、更新并移除插件', { timeout: 150000 }, async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, 'zhixing-plugin-test-'));
  const originalPath=process.env.PATH;
  // The installed product must work without a developer's external npm/node.
  if(process.platform==='win32')process.env.PATH=path.join(process.env.SystemRoot||'C:\\Windows','System32');
  const packages = {'0.1.0':fixture('0.1.0',{build:true}),'0.2.0':fixture('0.2.0')};
  const modelRequests = [];
  const server = createServer(async (req, res) => {
    if(req.url==='/market.json'){
      const registry=`http://127.0.0.1:${server.address().port}/`;
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({format:1,title:'合成插件目录',plugins:[{name,title:'办公测试插件',versions:[
        {version:'0.1.0',publishTimestamp:1700000000,source:{type:'npm',registry},engines:{dsh:'0.2.2-rc.5'}},
      ]}]}));
      return;
    }
    if (req.method === 'POST' && req.url?.endsWith('/messages')) {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const body = JSON.parse(Buffer.concat(chunks));
      modelRequests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      const first = modelRequests.length === 1;
      emit('message_start', { message: { id: 'fixture-response', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 2, output_tokens: 0 } } });
      emit('content_block_start', { index: 0, content_block: first
        ? { type: 'tool_use', id: 'addon-fixture', name: 'synthetic_addon_test_note', input: {} }
        : { type: 'text', text: '' } });
      emit('content_block_delta', { index: 0, delta: first
        ? { type: 'input_json_delta', partial_json: '{}' }
        : { type: 'text_delta', text: '合成插件调用完成。' } });
      emit('content_block_stop', { index: 0 });
      emit('message_delta', { delta: { stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } });
      emit('message_stop', {});
      res.end();
      return;
    }
    if (req.url === '/' + name) {
      res.setHeader('content-type', 'application/json');
      const versions = Object.fromEntries(Object.entries(packages).map(([version, value]) => [version, {
        ...value.manifest, dist: { integrity: value.integrity, tarball: `http://127.0.0.1:${server.address().port}/${name}/-/${version}.tgz` },
      }]));
      res.end(JSON.stringify({ name, versions, 'dist-tags': { latest: '0.2.0' }, time: { '0.1.0': '2025-01-01T00:00:00.000Z', '0.2.0': '2025-02-01T00:00:00.000Z' } }));
      return;
    }
    const version = req.url?.match(/\/(0\.[12]\.0)\.tgz$/)?.[1];
    if (version) { res.setHeader('content-type', 'application/octet-stream'); res.end(packages[version].archive); return; }
    res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const service = new PluginService({ directory: path.join(root, 'extensions'), registry: `http://127.0.0.1:${server.address().port}/` });
  const vaults = new Map();
  const manager = new RuntimeManager({ root: path.join(root, 'harness'), readVault: async id => vaults.get(id),
    writeVault: async (id, state) => vaults.set(id, state) });
  try {
    const loading = service.run({ action: 'list' });
    assert.deepEqual(await service.run({action:'market-list'}),[]);
    const catalog = await loading;
    assert(catalog.some(row => row.official && row.selectable));
    await assert.rejects(async () => service.run({ action: 'inspect', spec: 'git+https://example.com/project' }), /npm/);
    const inspected = await service.run({ action: 'inspect', spec: name + '@0.1.0' });
    assert.equal(inspected.version, '0.1.0', JSON.stringify(inspected));
    assert.equal(inspected.bundle, true);
    const url=`http://127.0.0.1:${server.address().port}/market.json`;
    await assert.rejects(async()=>service.run({action:'market-search',url}),/添加/);
    assert.deepEqual(await service.run({action:'market-add',url}),[url]);
    const market=await service.run({action:'market-search',url,query:'办公'});
    assert.equal(market.title,'合成插件目录');
    const [item]=market.plugins;
    assert.equal(item.defaultVersion,'0.1.0');
    const source=item.versions[0].source;
    await assert.rejects(service.run({action:'market-install',url,name,version:'0.1.0',source:'https://example.org/'}),/来源已变化/);
    const install={ action: 'market-install', url, name, version: '0.1.0', source };
    const blocked=await service.run(install);
    assert(blocked.approvalId,JSON.stringify(blocked));
    assert(blocked.pendingBuilds.some(key=>key===name||key===`${name}@0.1.0`));
    const proof=path.join(service.profileDirectory,'node_modules',name,'build-proof.txt');
    await assert.rejects(readFile(proof),/ENOENT/);
    assert.deepEqual(await service.run({action:'confirm-builds',approvalId:blocked.approvalId},async()=>false),{cancelled:true});
    await assert.rejects(async()=>service.run({action:'confirm-builds',approvalId:blocked.approvalId},async()=>true),/过期/);
    const pending=await service.run(install);
    assert(pending.approvalId,JSON.stringify(pending));
    const installed = await service.run({action:'confirm-builds',approvalId:pending.approvalId},async approval=>{
      assert.equal(approval.request.expectedName,name);
      assert.deepEqual(approval.builds,pending.pendingBuilds);
      return true;
    });
    assert.equal(await readFile(proof,'utf8'),'approved build');
    assert.equal(installed.version, '0.1.0', JSON.stringify(installed));
    assert.deepEqual(service.selection().bundles, []);
    await service.run({ action: 'enable', name, enabled: true });
    assert.deepEqual(service.selection().bundles, [name]);
    const workspaceRoot = path.join(root, 'project');
    await mkdir(workspaceRoot);
    const allowed = { extensions: service.selection(), workspaceRoot, permission: 'full',
      baseUrl: `http://127.0.0.1:${server.address().port}/anthropic` };
    const run = await manager.run({ runId: 'fixture-plugin-run', sessionId: 'fixture-plugin-chat', prompt: '调用合成插件。' }, allowed, 'fixture-only-key');
    assert.equal(run.finishReason, 'completed');
    assert.equal(modelRequests.length, 2);
    assert(modelRequests[0].tools.some(tool => tool.name === 'synthetic_addon_test_note'));
    const result = JSON.stringify(modelRequests[1].messages);
    assert.match(result, /0\.1\.0/);
    assert.doesNotMatch(result, /13800000000/);
    const available = await service.run({ action: 'versions', name });
    assert(available.versions.some(row => row.version === '0.2.0' && row.bundle && !row.incompatible));
    const updated = await service.run({ action: 'update', name, version: '0.2.0' });
    assert.equal(updated.version, '0.2.0', JSON.stringify(updated));
    assert.deepEqual(service.selection().bundles, []);
    assert(!(await manager.check({ extensions: allowed.extensions, workspaceRoot, permission: 'ask' }, 'fixture-check')).tools.some(tool => tool.name === 'synthetic_addon_test_note'));
    const removed = await service.run({ action: 'remove', name });
    assert(removed.changed, JSON.stringify(removed));
    assert(!(await service.run({ action: 'list' })).some(row => row.name === name));
  } finally {
    if(originalPath===undefined)delete process.env.PATH;else process.env.PATH=originalPath;
    await service.close();
    await manager.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    const resolved = await realpath(root);
    if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('zhixing-plugin-test-')) {
      await rm(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});

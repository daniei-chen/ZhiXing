import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpServerIdentity, publicMcpServers, updateMcpServer, validateMcpServers } from '../electron/mcp-config.mjs';

test('HTTP MCP 身份规范化并绑定 scheme、host、port、path 和 query',()=>{
 const canonical={serverName:'files',transport:'streamable-http',url:'HTTPS://Example.COM:443/mcp/?b=2&a=1'};
 const reordered={...canonical,url:'https://example.com/mcp?a=1&b=2'};
 assert.equal(mcpServerIdentity(canonical),mcpServerIdentity(reordered));
 for(const url of ['https://other.example/mcp?a=1&b=2','https://example.com/other?a=1&b=2','https://example.com:8443/mcp?a=1&b=2','http://example.com/mcp?a=1&b=2','https://example.com/mcp?a=2&b=2']){
  assert.notEqual(mcpServerIdentity(canonical),mcpServerIdentity({...canonical,url}),url);
 }
 assert.throws(()=>mcpServerIdentity({...canonical,url:'https://user:pass@example.com/mcp'}),/凭据/);
});

test('stdio MCP 身份绑定 transport、command、args 与 cwd',()=>{
 const original={serverName:'tools',transport:'stdio',command:'node',args:['server.mjs','--safe'],cwd:'C:/workspace'};
 assert.equal(mcpServerIdentity(original),mcpServerIdentity({...original,enabled:false}));
 for(const patch of [
  {transport:'streamable-http',url:'https://tools.example/mcp'},
  {command:'python'},
  {args:['server.mjs','--other']},
  {cwd:'C:/other'},
 ]) assert.notEqual(mcpServerIdentity(original),mcpServerIdentity({...original,...patch}));
});

test('同一 MCP 目标保留秘密，显式空映射清除秘密',()=>{
 const previous={serverName:'office',transport:'streamable-http',url:'https://mcp.example/api',enabled:true,headers:{Authorization:'fixture-secret'}};
 const disabled=updateMcpServer(previous,{...previous,enabled:false,headers:undefined});
 assert.equal(disabled.identityChanged,false);
 assert.equal(disabled.requiresCredentialReentry,false);
 assert.equal(disabled.server.headers.Authorization,'fixture-secret');
 const reenabled=updateMcpServer(disabled.server,{...disabled.server,enabled:true,headers:undefined});
 assert.equal(reenabled.server.headers.Authorization,'fixture-secret');
 const wrongTransport=updateMcpServer(reenabled.server,{serverName:'office',transport:'stdio',command:'node',args:['server.js'],cwd:'C:/workspace',headers:undefined,env:undefined});
 assert.deepEqual(wrongTransport.server.headers,{});
 assert.deepEqual(wrongTransport.server.env,{});
 assert.equal(wrongTransport.requiresCredentialReentry,true);
 const cleared=updateMcpServer(reenabled.server,{...reenabled.server,headers:{}});
 assert.deepEqual(cleared.server.headers,{});
 assert.equal(cleared.requiresCredentialReentry,false);
});

test('HTTP 目的地变化不继承旧 header，等待新凭据',()=>{
 const previous={serverName:'office',transport:'streamable-http',url:'https://mcp-a.example/api',headers:{Authorization:'fixture-secret'}};
 const updated=updateMcpServer(previous,{serverName:'office',transport:'streamable-http',url:'https://mcp-b.example/api',headers:undefined});
 assert.equal(updated.identityChanged,true);
 assert.equal(updated.requiresCredentialReentry,true);
 assert.deepEqual(updated.server.headers,{});
 assert.equal(updated.server.credentialReentryRequired,true);
 assert(!JSON.stringify(updated).includes('fixture-secret'));
 const withNewSecret=updateMcpServer(previous,{...updated.server,headers:{Authorization:'fixture-new-secret'}});
 assert.equal(withNewSecret.requiresCredentialReentry,false);
 assert.equal(withNewSecret.server.headers.Authorization,'fixture-new-secret');
 assert(!JSON.stringify(publicMcpServers([withNewSecret.server])).includes('fixture-new-secret'));
 assert.deepEqual(publicMcpServers([withNewSecret.server])[0].headerKeys,['Authorization']);
});

test('stdio 目标变化不继承旧环境秘密',()=>{
 const previous={serverName:'runner',transport:'stdio',command:'node',args:['server.mjs'],cwd:'C:/workspace',env:{SERVICE_TOKEN:'fixture-secret'}};
 const updated=updateMcpServer(previous,{...previous,args:['other.mjs'],env:undefined});
 assert.equal(updated.identityChanged,true);
 assert.equal(updated.requiresCredentialReentry,true);
 assert.deepEqual(updated.server.env,{});
 assert(!JSON.stringify(publicMcpServers(validateMcpServers([updated.server]))).includes('fixture-secret'));
 const explicitClear=updateMcpServer(previous,{...previous,args:['other.mjs'],env:{}});
 assert.deepEqual(explicitClear.server.env,{});
 assert.equal(explicitClear.requiresCredentialReentry,true);
});

test('无凭据公共视图和格式错误不得回显 secret',()=>{
 const secret='synthetic-never-log-this';
 const server={serverName:'safe',transport:'streamable-http',url:'https://mcp.example/api',headers:{Authorization:secret}};
 assert(!JSON.stringify(publicMcpServers(validateMcpServers([server]))).includes(secret));
 assert.throws(()=>validateMcpServers([{...server,headers:{Authorization:secret,'invalid header':'x'}}]),error=>{
  assert(!error.message.includes(secret));
  return true;
 });
});

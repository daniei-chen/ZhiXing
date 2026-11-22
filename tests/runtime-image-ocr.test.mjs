import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

const packed=process.env.ZHIXING_TEST_PACKED_APP;
const moduleUrl=name=>packed?pathToFileURL(path.join(packed,name)).href:new URL(`../${name}`,import.meta.url).href;
const {RuntimeManager}=await import(moduleUrl('electron/runtime.mjs'));

function response(res,content){
 const payload={id:'ocr-fixture',type:'message',role:'assistant',model:'ocr-fixture',content,stop_reason:content.some(block=>block.type==='tool_use')?'tool_use':'end_turn',usage:{input_tokens:10,output_tokens:10}};
 res.writeHead(200,{'content-type':'text/event-stream'});
 const emit=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
 emit('message_start',{type:'message_start',message:{...payload,content:[],stop_reason:null}});
 content.forEach((block,index)=>{
  emit('content_block_start',{type:'content_block_start',index,content_block:block.type==='text'?{type:'text',text:''}:{...block,input:{}}});
  emit('content_block_delta',{type:'content_block_delta',index,delta:block.type==='text'?{type:'text_delta',text:block.text}:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
  emit('content_block_stop',{type:'content_block_stop',index});
 });
 emit('message_delta',{type:'message_delta',delta:{stop_reason:payload.stop_reason},usage:{output_tokens:10}});
 emit('message_stop',{type:'message_stop'});res.end();
}

test('Windows OCR image is read by office_read_file, protected before wire, and restored locally',{skip:process.platform!=='win32',timeout:90000},async t=>{
 const fixture=path.join(import.meta.dirname,'fixtures','ocr-office-read.png');
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'zhixing-image-ocr-'));
 const workspace=path.join(root,'workspace');await fs.mkdir(workspace);await fs.copyFile(fixture,path.join(workspace,'source.png'));
 const vaults=new Map(),requests=[];let server,manager;
 try{
  server=http.createServer(async(req,res)=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push(body);
   const toolResult=body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).find(block=>block.type==='tool_result');
   if(!toolResult){response(res,[{type:'tool_use',id:'ocr-read',name:'office_read_file',input:{file_path:'source.png'}}]);return;}
   response(res,[{type:'text',text:JSON.stringify(toolResult.content)}]);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  manager=new RuntimeManager({root:root,readVault:async id=>vaults.get(id),writeVault:async(id,value)=>vaults.set(id,value),onEvent:()=>{}});
  const config={baseUrl:`http://127.0.0.1:${server.address().port}/anthropic`,model:'ocr-fixture',reasoning:'off',workspaceRoot:workspace,permission:'full'};
  const result=await manager.run({runId:'image-ocr-run',sessionId:'image-ocr-run',prompt:'读取 source.png 中的文字，并说明读取范围。',privacyMode:'redact'},config,'ocr-fixture-key');
  assert.equal(result.finishReason,'completed',result.text);
  assert.match(result.text,/13800000000/);
  assert.match(result.text,/ocr-text/);
  assert.match(result.text,/本机 OCR/);
  assert.equal(requests.length,2);
  const wire=JSON.stringify(requests);
  assert(!wire.includes('13800000000'),'raw phone reached model wire');
  assert(!wire.includes('iVBOR'),'raw image bytes reached model wire');
  assert(JSON.stringify(requests[1]).includes('ZX-'),'tool result was protected with a task token');
 }catch(error){
  if(error.message.includes('安装具有文字识别功能的语言'))return t.skip('Windows 未安装 OCR 语言');
  throw error;
 }finally{
  await manager?.close();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));
  const resolved=await fs.realpath(root);assert.equal(path.dirname(resolved),parent);await fs.rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:100});
 }
});

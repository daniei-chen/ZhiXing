import http from 'node:http';

const port = Number(process.argv[2] || 4197);
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/messages')) { res.writeHead(404).end(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { res.writeHead(400).end(); return; }
  const input = JSON.stringify(body.messages);
  if (/13800000000|张小明|test-contact@example\.test/.test(input)) {
    console.error('FAIL: raw fixture data reached the model boundary');
    res.writeHead(400, {'content-type':'application/json'}).end('{"error":{"message":"raw fixture data rejected"}}'); return;
  }
  const afterTool = input.includes('tool_result');
  const phone = input.match(/⟦ZX-[a-f0-9]{12}-PHONE-\d+⟧/)?.[0] || '未提供';
  const person = input.match(/⟦ZX-[a-f0-9]{12}-PERSON-\d+⟧/)?.[0] || '待确认';
  const content = afterTool ? [{type:'text',text:`# 验收文稿\n联系人：${person}\n电话：${phone}\n数字合计：6。\n\n本条由知行验收用的本机测试服务返回。`}] : [{type:'tool_use',id:'tool_smoke_1',name:'office_calculate',input:{numbers:[1,2,3],operation:'sum'}}];
  const message = {id:'msg_zhixing_qa',type:'message',role:'assistant',model:'zhixing-test',content,stop_reason:afterTool?'end_turn':'tool_use',stop_sequence:null,usage:{input_tokens:80,output_tokens:41}};
  console.log(`OK ${afterTool?'reply after tool result':'first model request'} · local fixture · ${body.model}`);
  if (!body.stream) { res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(message)); return; }
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
  emit('message_start',{message:{...message,content:[],stop_reason:null,usage:{input_tokens:80,output_tokens:0}}});
  for (const [index, block] of content.entries()) {
    emit('content_block_start',{index,content_block:block.type==='text'?{type:'text',text:''}:{...block,input:{}}});
    emit('content_block_delta',{index,delta:block.type==='text'?{type:'text_delta',text:block.text}:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
    emit('content_block_stop',{index});
  }
  emit('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:41}});
  emit('message_stop',{});res.end();
});
server.listen(port,'127.0.0.1',()=>console.log(`QA fixture listening on 127.0.0.1:${port}`));

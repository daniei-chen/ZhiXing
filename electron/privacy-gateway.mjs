import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {PrivacySession} from '../src/privacy-core.js';
import {containsCredential} from '../src/privacy-recognizers.js';
import {updateBridge} from '../harness/privacy-bridge.mjs';
import {goalWire} from './goal-wire.mjs';
import {createAssistantStreamDecoder} from './assistant-stream.mjs';

// A request-local loopback gateway is the serialization boundary. Harness loop
// messages are immutable; do not mutate its event-sourced request projection.
export async function startPrivacyGateway({baseUrl,protocol='deepseek',apiKey,bridgeFile,bridgeKey,privacyMode,customTerms=[],privacyPolicy,onAssistantText,mainSessionId}) {
  const openAI=protocol==='openai';
  const inbound=openAI?'/v1/chat/completions':protocol==='deepseek'?'/anthropic/v1/messages':'/v1/messages';
  const token=`zx-local-${randomBytes(24).toString('hex')}`;
  const controllers=new Set();let tail=Promise.resolve();
  const server=http.createServer(async(req,res)=>{
    const controller=new AbortController();controllers.add(controller);
    let stage='boundary',previewState;
    req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{
      if(req.method!=='POST'||req.url?.split('?')[0]!==inbound||(openAI?req.headers.authorization!==`Bearer ${token}`:req.headers['x-api-key']!==token)){res.writeHead(403).end();return;}
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw new Error('模型请求超过本机处理上限。');chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const job=tail.then(async()=>{
        await updateBridge(bridgeFile,bridgeKey,async saved=>{
        const vault=new PrivacySession(saved.id,saved);
        if(containsCredential(JSON.stringify(body),apiKey))throw new Error('请求内容含模型凭证，已阻止发送。');
        const protect=value=>{const checked=vault.protectValue(value,customTerms,privacyPolicy);if(checked.blocked)throw new Error('请求内容含被拦截的敏感值，已阻止发送。');return privacyMode==='raw'?value:checked.value;};
        const goal=goalWire(body.messages,protect);
        const content=(value,toolId)=>{
          if(typeof value==='string')return goal.result(toolId,value);
          if(!Array.isArray(value))throw new Error('消息结构无效。');
          return value.map(block=>{
            if(block.type==='text')return {...block,text:goal.result(toolId,block.text)};
            if(block.type==='tool_use')return {...block,input:goal.input(block.name,block.input)};
            if(block.type==='tool_result')return {...block,content:content(block.content,block.tool_use_id)};
            if(block.type==='thinking'){
              const checked=vault.protect(String(block.thinking||''),customTerms,privacyPolicy);
              if(checked.blocked||privacyMode!=='raw'&&checked.entities.length)throw new Error('带签名推理包含未保护内容，已停止重放。');
              return block;
            }
            if(block.type==='redacted_thinking')return block;
            throw new Error('消息包含尚未接入隐私边界的内容类型。');
          });
        };
        const toolDefinition=(tool, schema)=>({...tool,...(typeof tool.description==='string'?{description:protect(tool.description)}:{}),...(tool[schema]?{[schema]:protect(tool[schema])}:{})});
        if(openAI){
          body.messages=body.messages.map(message=>{
            const copy={...message};
            if(copy.content!=null)copy.content=content(copy.content,message.role==='tool'?message.tool_call_id:undefined);
            for(const field of ['reasoning_content','reasoning','refusal'])if(typeof copy[field]==='string')copy[field]=protect(copy[field]);
            if(Array.isArray(copy.tool_calls))copy.tool_calls=copy.tool_calls.map(call=>({...call,function:{...call.function,arguments:JSON.stringify(goal.input(call.function.name,JSON.parse(call.function.arguments||'{}')))}}));
            if(copy.function_call)throw new Error('不支持旧版函数调用。');
            return copy;
          });
          if(Array.isArray(body.tools))body.tools=body.tools.map(tool=>{
            if(tool.type!=='function')throw new Error('不支持服务端工具。');
            return {...tool,function:toolDefinition(tool.function,'parameters')};
          });
        }else{
          if(body.system!==undefined)body.system=content(body.system);
          body.messages=body.messages.map(message=>({...message,content:content(message.content)}));
          if(Array.isArray(body.tools))body.tools=body.tools.map(tool=>toolDefinition(tool,'input_schema'));
        }
        previewState=vault.exportState();
        return {state:previewState};
        },{signal:controller.signal});
      });tail=job.catch(()=>{});await job;
      const root=baseUrl.replace(/\/$/,'');
      const target=openAI?`${root}/chat/completions`:root.endsWith('/v1')?`${root}/messages`:`${root}/v1/messages`;
      const headers=openAI
        ?{'content-type':'application/json',authorization:`Bearer ${apiKey}`}
        :{'content-type':'application/json','x-api-key':apiKey,'anthropic-version':String(req.headers['anthropic-version']||'2023-06-01')};
      if(!openAI)for(const [name,value] of Object.entries(req.headers))if((name.startsWith('x-deepseek-')||['anthropic-beta','user-agent','accept'].includes(name))&&typeof value==='string')headers[name]=value;
      stage='upstream';
      const response=await fetch(target,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:controller.signal});
      res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'});
      const requestSessionId=req.headers['x-zhixing-session-id']||req.headers['x-deepseek-harness-session-id'];
      const streamAssistant=(!mainSessionId||requestSessionId===mainSessionId)&&response.ok&&response.headers.get('content-type')?.includes('text/event-stream')&&typeof onAssistantText==='function';
      const notifyAssistantText=event=>{try{onAssistantText(event);}catch{}};
      const assistantStream=streamAssistant?createAssistantStreamDecoder(text=>notifyAssistantText({type:'delta',text})):null;
      if(assistantStream)notifyAssistantText({type:'start',...(mainSessionId?{vaultState:previewState}:{})});
      try {
        if(response.body)for await(const chunk of response.body){
          const bytes=Buffer.from(chunk);
          assistantStream?.push(bytes);
          if(!res.write(bytes))await once(res,'drain',{signal:controller.signal});
        }
        const outcome=assistantStream?.finish();
        if(assistantStream)notifyAssistantText({type:outcome==='abort'?'abort':controller.signal.aborted?'cancel':outcome==='discard'?'discard':'end'});
      } catch(error) {
        if(assistantStream)notifyAssistantText({type:controller.signal.aborted?'cancel':'abort'});
        throw error;
      }
      res.end();
    }catch(error){
      const cancelled=controller.signal.aborted||error.name==='AbortError',upstream=stage==='upstream'&&!cancelled;
      if(!res.headersSent&&!res.destroyed)res.writeHead(upstream?502:400,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({type:'error',error:{type:upstream?'api_error':'invalid_request_error',code:cancelled?'REQUEST_CANCELLED':upstream?'UPSTREAM_UNAVAILABLE':'PRIVACY_BOUNDARY_REJECTED',message:cancelled?'任务已停止。':upstream?'模型服务暂时无法连接，请稍后重试。':'本机隐私边界未完成请求，请检查脱敏规则和连接。'}}));
      else res.destroy();
    }
    finally{controllers.delete(controller);}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const basePath=openAI?'/v1':protocol==='deepseek'?'/anthropic':'';
  return {baseUrl:`http://127.0.0.1:${server.address().port}${basePath}`,apiKey:token,async close(){for(const controller of controllers)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await tail;}};
}

import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {PrivacySession} from '../src/privacy-core.js';
import {containsCredentialValue,childPrivacyContext} from '../src/privacy-recognizers.js';
import {privacyPolicyForMode} from '../src/privacy-policy.js';
import {assertModelCredential} from '../src/provider-options.js';
import {updateBridge} from '../harness/privacy-bridge.mjs';
import {goalWire} from './goal-wire.mjs';
import {createAssistantStreamDecoder} from './assistant-stream.mjs';

// A request-local loopback gateway is the serialization boundary. Harness loop
// messages are immutable; do not mutate its event-sourced request projection.
export async function startPrivacyGateway({baseUrl,protocol='deepseek',apiKey,bridgeFile,bridgeKey,privacyMode,customTerms=[],privacyPolicy,onAssistantText,mainSessionId,visualAttachments=[]}) {
  assertModelCredential(apiKey);
  privacyPolicy=privacyPolicyForMode(privacyPolicy,privacyMode);
  const openAI=protocol==='openai';
  const inbound=openAI?'/v1/chat/completions':protocol==='deepseek'?'/anthropic/v1/messages':'/v1/messages';
  const token=`zx-local-${randomBytes(24).toString('hex')}`;
  const approvedImages=new Map(visualAttachments.map(image=>[image.sha256,image]));
  function requireApprovedImage(data,mediaType){
    if(typeof data!=='string'||!['image/png','image/jpeg'].includes(mediaType))throw new Error('图片内容未通过本机视觉附件边界。');
    const bytes=Buffer.from(data,'base64');
    if(!bytes.length||bytes.toString('base64')!==data)throw new Error('图片编码无效。');
    const approved=approvedImages.get(createHash('sha256').update(bytes).digest('hex'));
    if(!approved||approved.mediaType!==mediaType||approved.bytes!==bytes.length)throw new Error('图片未通过当前交办的本机副本校验。');
  }
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
        if(containsCredentialValue(body,apiKey))throw new Error('请求内容含模型凭证，已阻止发送。');
        vault.assertSafeKeys(body,customTerms,privacyPolicy,{context:openAI?'openai':'anthropic',privacyMode});
        const protect=(value,context='data')=>{const checked=vault.protectValue(value,customTerms,privacyPolicy,{context,privacyMode});if(checked.blocked)throw new Error('请求内容含被拦截的敏感值，已阻止发送。');return privacyMode==='raw'?value:checked.value;};
        const identity=value=>{if(typeof value==='string')vault.assertSafeKeys({[value]:null},customTerms,privacyPolicy,{privacyMode});else if(Array.isArray(value))value.forEach(identity);else if(value&&typeof value==='object')Object.values(value).forEach(identity);return value;};
        // Extra provider/plugin fields are data, not an uninspected escape
        // hatch. Only fields handled explicitly below retain protocol meaning.
        const extras=(value,handled,context='data')=>Object.fromEntries(Object.entries(value).map(([key,item])=>[key,handled.includes(key)?item:protect(item,childPrivacyContext(context,key))]));
        const goal=goalWire(body.messages,protect);
        const content=(value,toolId)=>{
          if(typeof value==='string')return goal.result(toolId,value);
          if(!Array.isArray(value))throw new Error('消息结构无效。');
          return value.map(block=>{
            if(block.type==='text')return {...extras(block,['type','text'],'block'),text:goal.result(toolId,block.text)};
            if(block.type==='tool_use')return {...extras(block,['type','input','name','id'],'block'),name:identity(block.name),id:identity(block.id),input:goal.input(block.name,block.input)};
            if(block.type==='tool_result')return {...extras(block,['type','content','tool_use_id'],'block'),tool_use_id:identity(block.tool_use_id),content:content(block.content,block.tool_use_id)};
            if(block.type==='image'){
              const source=block.source;
              if(source?.type!=='base64')throw new Error('图片内容未通过本机视觉附件边界。');
              requireApprovedImage(source.data,source.media_type);
              return {...extras(block,['type','source'],'block'),source:{type:'base64',media_type:source.media_type,data:source.data}};
            }
            if(block.type==='image_url'){
              const url=block.image_url?.url;
              const match=typeof url==='string'?url.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/):null;
              if(!match)throw new Error('图片内容未通过本机视觉附件边界。');
              requireApprovedImage(match[2],match[1]);
              return {...extras(block,['type','image_url'],'block'),image_url:{...extras(block.image_url,['url'],'data'),url}};
            }
            if(block.type==='thinking'){
              const checked=vault.protect(String(block.thinking||''),customTerms,privacyPolicy);
              if(checked.blocked||privacyMode!=='raw'&&checked.entities.length)throw new Error('带签名推理包含未保护内容，已停止重放。');
              identity(block.signature);return extras(block,['type','thinking','signature'],'block');
            }
            if(block.type==='redacted_thinking'){identity(block.data);return extras(block,['type','data'],'block');}
            throw new Error('消息包含尚未接入隐私边界的内容类型。');
          });
        };
        const toolDefinition=(tool, schema)=>({...extras(tool,['name','description',schema],'tool'),name:identity(tool.name),...(typeof tool.description==='string'?{description:protect(tool.description)}:{}),...(tool[schema]?{[schema]:protect(tool[schema],'schema')}:{})});
        if(openAI){
          body.messages=body.messages.map(message=>{
            const copy=extras(message,['role','content','name','tool_calls','tool_call_id','reasoning_content','reasoning','refusal','function_call']);
            if(copy.name!==undefined)identity(copy.name);if(copy.tool_call_id!==undefined)identity(copy.tool_call_id);
          if(copy.content!=null)copy.content=content(copy.content,message.role==='tool'?message.tool_call_id:undefined);
            for(const field of ['reasoning_content','reasoning','refusal'])if(typeof copy[field]==='string')copy[field]=protect(copy[field]);
            if(Array.isArray(copy.tool_calls))copy.tool_calls=copy.tool_calls.map(call=>({...extras(call,['type','id','function']),id:identity(call.id),function:{...extras(call.function,['name','arguments']),name:identity(call.function.name),arguments:JSON.stringify(goal.input(call.function.name,JSON.parse(call.function.arguments||'{}')))}}));
            if(copy.function_call)throw new Error('不支持旧版函数调用。');
            return copy;
          });
          if(Array.isArray(body.tools))body.tools=body.tools.map(tool=>{
            if(tool.type!=='function')throw new Error('不支持服务端工具。');
            return {...extras(tool,['type','function']),function:toolDefinition(tool.function,'parameters')};
          });
        }else{
          if(body.system!==undefined)body.system=content(body.system);
          body.messages=body.messages.map(message=>({...extras(message,['role','content']),content:content(message.content)}));
          if(Array.isArray(body.tools))body.tools=body.tools.map(tool=>toolDefinition(tool,'input_schema'));
        }
        identity(body.model);
        for(const key of Object.keys(body))if(!['model','messages','system','tools'].includes(key)){
          const context=childPrivacyContext(openAI?'openai':'anthropic',key);
          body[key]=['tool_choice','thinking','reasoning','reasoning_effort','output_config','stream_options','stop','stop_sequences'].includes(key)?identity(body[key]):protect(body[key],context);
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
      const structuredCode=['SENSITIVE_DYNAMIC_KEY','SENSITIVE_SCHEMA_VALUE'].includes(error.code)?error.code:null;
      if(!res.headersSent&&!res.destroyed)res.writeHead(upstream?502:400,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({type:'error',error:{type:upstream?'api_error':'invalid_request_error',code:cancelled?'REQUEST_CANCELLED':upstream?'UPSTREAM_UNAVAILABLE':structuredCode||'PRIVACY_BOUNDARY_REJECTED',message:cancelled?'任务已停止。':upstream?'模型服务暂时无法连接，请稍后重试。':structuredCode?'结构化字段或工具约束包含需保护的信息，请使用不含敏感值的字段和约束。':'本机隐私边界未完成请求，请检查脱敏规则和连接。'}}));
      else res.destroy();
    }
    finally{controllers.delete(controller);}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const basePath=openAI?'/v1':protocol==='deepseek'?'/anthropic':'';
  return {baseUrl:`http://127.0.0.1:${server.address().port}${basePath}`,apiKey:token,async close(){for(const controller of controllers)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await tail;}};
}

import {Context} from '@deepseek-ai/cordis';
import Importer from '@deepseek-ai/dsh-deepseek-chat-import';
import {LocalAttachmentStore} from '@deepseek-ai/dsh-attachment-local';

const maxUploadBytes = 32 * 1024 * 1024;
const maxEntryBytes = 8 * 1024 * 1024;
const maxMessages = 80;
const maxMessageLength = 10000;
const maxTranscriptLength = 50000;
const maxProjectionBytes = 5 * 1024 * 1024;
const maxImagesBytes = 1024 * 1024;
const errors = {
 'too-large':'导出文件或单条聊天超过导入上限。',
 'unreadable-archive':'无法读取 DeepSeek 导出 ZIP。',
 'missing-manifest':'导出 ZIP 缺少清单文件。',
 'missing-index':'导出 ZIP 缺少聊天索引。',
 'unsupported-version':'只支持 DeepSeek 官网导出的第 3 版 ZIP。',
 'no-conversations':'导出文件里没有可导入的聊天。',
};

function uiName(value){
 return String(value||'附件').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180)||'附件';
}
function projectTool(block,result){
 if(!['web_search','web_fetch'].includes(block.name))return null;
 const failure=Boolean(result?.message?.isError);
 let args;
 try{args=JSON.parse(block.arguments);}catch{args={};}
 const detail=(result?.message?.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n').slice(0,1400);
 return {name:block.name,failed:failure,detail,url:typeof args?.url==='string'?args.url.slice(0,1400):undefined};
}

try {
 let size = 0, route;
 const chunks = [];
 for await (const chunk of process.stdin) {
  size += chunk.length;
  if(size>maxUploadBytes)throw new Error(errors['too-large']);
  chunks.push(chunk);
 }
 const staged = new Map(), attached = new Set();
 const workspace = {id:'local',path:process.cwd(),async attachSession(id){attached.add(id);}};
 const context = new Context();
 const imageStore=new LocalAttachmentStore(new Context(),LocalAttachmentStore.Config({
  dshHome:process.argv[2],maxImageBytes:3*1024*1024,maxImagePixels:20000000,
  normalizedImageMaxDimension:1200,normalizedImageMaxBytes:256000,imageCompressionConcurrency:1,
 }));
 const images=new Map();
 let imageBytes=0;
 const saveImage=async input=>{
  if(imageBytes>=maxImagesBytes||images.size>=24)throw new Error('Imported image limit');
  const attachment=await imageStore.saveImage(input);
  if(!images.has(attachment.attachmentId)){
   const {data}=await imageStore.readImage(attachment);
   if(data.byteLength+imageBytes>maxImagesBytes)throw new Error('Imported image limit');
   imageBytes+=data.byteLength;
   images.set(attachment.attachmentId,Buffer.from(data).toString('base64'));
  }
  return attachment;
 };
 const services = {
  connection:{fetch:{register(value){route=value;return ()=>{};}}},
  workspaceRegistry:{get:id=>id===workspace.id?workspace:undefined},
  attachments:{saveImage},
  sessionPersistence:{
   async create(header) {
    return {
     async append(events) {
      let title,updatedAt=header.createdAt,trimmed=false,remaining=maxTranscriptLength;
      const messages=[],results=new Map();
      for(const event of events){
       if(event.type==='session/title')title=event.data.title;
       if(event.type==='tool/result')results.set(event.data.message.toolCallId,event.data);
       updatedAt=Math.max(updatedAt,event.time);
      }
      for(let index=events.length-1;index>=0;index--){
       const event=events[index];
       if(!['user/message','assistant/message'].includes(event.type))continue;
       const message=event.type==='user/message' ? event.data : event.data.message;
       const blocks=message?.content||[];
       const text=blocks.filter(block=>block.type==='text').map(block=>block.text).join('\n').trim();
       const reasoning=blocks.filter(block=>block.type==='reasoning').map(block=>block.text).join('\n').slice(0,4000);
       const tools=blocks.filter(block=>block.type==='tool-call').slice(0,6).map(block=>projectTool(block,results.get(block.id))).filter(Boolean);
       const files=blocks.filter(block=>['file','image'].includes(block.type)).slice(0,12).map(({attachment,type})=>({
        name:uiName(attachment.name),size:attachment.bytes,
        ...(type==='image'&&images.has(attachment.attachmentId)?{image:{format:attachment.mediaType,data:images.get(attachment.attachmentId)}}:{unavailable:true}),
       }));
       if(!text&&!reasoning&&!tools.length&&!files.length)continue;
       if(messages.length>=maxMessages||remaining<=0){trimmed=true;break;}
       const clipped=text.slice(0,Math.min(maxMessageLength,remaining));
       if(clipped.length<text.length)trimmed=true;
       remaining-=clipped.length;
       messages.push({id:message.id,role:event.type==='user/message'?'user':'assistant',text:clipped,imported:true,
        ...(reasoning?{importedThinking:reasoning}:{}),...(tools.length?{importedTools:tools}:{}),...(files.length?{files}:{})});
      }
      if(!messages.length)throw new Error('No text messages');
      staged.set(header.id,{id:header.id,title:title||'导入的 DeepSeek 聊天',createdAt:header.createdAt,updatedAt,messages:messages.reverse(),trimmed});
     },
     async flush(){},
     async close(){},
    };
   },
  },
  typert:{},
 };
 for(const [name,value] of Object.entries(services)){context.provide(name);context.set(name,value);}
 new Importer(context,Importer.Config({maxSessions:100,maxUploadBytes,maxEntryBytes}));
 // Invoke the official import handler directly in the worker. No HTTP listener is opened.
 const result=await route.fetch(new Request(`http://localhost${route.path}?workspaceId=local`,{
  method:'POST',headers:{'content-type':'application/octet-stream'},body:Buffer.concat(chunks),
 }));
 const outcome=(await result.text()).trim().split('\n').map(line=>JSON.parse(line)).findLast(line=>line.type==='outcome')?.outcome;
 if(!outcome?.ok)throw new Error(errors[outcome?.error?.reason]||'DeepSeek 导入未完成。');
 const {conversationCount,sessionIds,skipped}=outcome.value;
 const chats=[];
 let used=0;
 for(const id of sessionIds){
  const chat=attached.has(id)&&staged.get(id);
  if(!chat)continue;
  const length=Buffer.byteLength(JSON.stringify(chat));
  if(used+length>maxProjectionBytes)break;
  chats.push(chat);
  used+=length;
 }
 process.stdout.write(JSON.stringify({value:{chats, skipped:skipped.length, omitted:Math.max(0,conversationCount-chats.length-skipped.length),trimmed:chats.filter(chat=>chat.trimmed).length}}));
} catch (error) {
 process.stdout.write(JSON.stringify({error:Object.values(errors).includes(error.message)?error.message:'无法导入此 DeepSeek 导出文件。'}));
 process.exitCode=1;
}

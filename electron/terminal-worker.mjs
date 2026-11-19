import {Context} from '@deepseek-ai/cordis';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),h=createRequire(require.resolve('@deepseek-ai/dsh/lib/bin.js')),b=createRequire(h.resolve('@deepseek-ai/dsh-base'));
const {Terminal}=require('@xterm/headless'),{SerializeAddon}=require('@xterm/addon-serialize');
const provider=await import(pathToFileURL(b.resolve('@deepseek-ai/dsh-subprocess-local')).href);
const ctx=new Context(),fiber=ctx.plugin(provider.default);await fiber;
const terminals=new Map();let closing=false;
const send=value=>{if(process.connected)process.send(value);};
const publicInfo=entry=>({id:entry.id,scope:entry.scope,shell:entry.shell,cwd:entry.cwd,status:entry.status,exitCode:entry.exitCode,cols:entry.screen.cols,rows:entry.screen.rows});
async function create({scope,cwd,shell='powershell',cols=80,rows=26}){
 if(terminals.size>=12)throw new Error('最多同时保留 12 个终端，请关闭不用的标签。');
 const executable=await ctx.subprocess.resolveExecutable(shell==='cmd'?'cmd.exe':shell==='pwsh'?'pwsh.exe':'powershell.exe');
 const handle=await ctx.subprocess.spawnTerminal({argv:[executable,...(shell==='cmd'?[]:['-NoLogo','-NoProfile'])],cwd,cols,rows,terminalType:'xterm-256color',graceMs:800,shellActivity:true,env:{ELECTRON_RUN_AS_NODE:'',DEEPSEEK_API_KEY:'',ZHIXING_BRIDGE_KEY:'',ZHIXING_HISTORY_KEY:''}});
 const screen=new Terminal({cols,rows,scrollback:1200,allowProposedApi:true}),serializer=new SerializeAddon();screen.loadAddon(serializer);
 const entry={id:randomUUID(),scope,cwd,shell,handle,screen,serializer,status:'running',exitCode:null,sequence:0};terminals.set(entry.id,entry);
 entry.drained=(async()=>{const decoder=new TextDecoder('utf-8');try{
  for await(const chunk of handle.output){const data=decoder.decode(chunk,{stream:true});await new Promise(resolve=>screen.write(data,resolve));send({event:'data',id:entry.id,scope,sequence:++entry.sequence,data});}
  const final=decoder.decode();if(final)await new Promise(resolve=>screen.write(final,resolve));
  const outcome=await handle.done;entry.status='exited';entry.exitCode=outcome.exitCode;
 }catch{entry.status='error';}send({event:'status',...publicInfo(entry)});})();
 return publicInfo(entry);
}
function terminal(id,scope){const entry=terminals.get(id);if(!entry||entry.scope!==scope)throw new Error('终端不在当前项目或已关闭。');return entry;}
async function shutdown(){if(closing)return;closing=true;await Promise.allSettled([...terminals.values()].map(async entry=>{await entry.handle.terminate();await entry.drained;entry.screen.dispose();}));await fiber.dispose();process.exit(0);}
process.on('disconnect',()=>void shutdown());
process.on('message',async message=>{
 if(closing)return;try{
  const {action,scope,id}=message;let value;
  if(action==='create')value=await create(message);
  else if(action==='list')value=[...terminals.values()].filter(entry=>entry.scope===scope).map(publicInfo);
  else if(action==='shutdown'){await shutdown();return;}
  else{const entry=terminal(id,scope);
   if(action==='write'){if(entry.status!=='running')throw new Error('此终端已经退出。');await entry.handle.write(message.data);value=true;}
   else if(action==='resize'){await entry.handle.resize(message.cols,message.rows);entry.screen.resize(message.cols,message.rows);value=true;}
   else if(action==='snapshot'){await new Promise(resolve=>entry.screen.write('',resolve));value={...publicInfo(entry),screen:entry.serializer.serialize(),sequence:entry.sequence};}
   else if(action==='close'){await entry.handle.terminate();await entry.drained;entry.screen.dispose();terminals.delete(id);value=true;}
   else throw new Error('终端操作无效。');
  }
  send({requestId:message.requestId,value});
 }catch(error){send({requestId:message.requestId,error:String(error.message).slice(0,400)});}
});
send({event:'ready'});

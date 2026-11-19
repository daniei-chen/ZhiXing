import {startToolBridge} from '../electron/tool-bridge.mjs';
import {writeBridge} from './privacy-bridge.mjs';

export const name='zhixing-project-worktree';
export const inject=['agents','worktrees'];

export function apply(ctx,{request,file}){
 const key=process.env.ZHIXING_WORKTREE_KEY;
 if(!key)throw new Error('工作树服务缺少本机密钥。');
 delete process.env.ZHIXING_WORKTREE_KEY;
 const controller=new AbortController();
 let started=false;
 const server=startToolBridge({route:'/worktree',signal:controller.signal,async invoke(_input,signal){
  const agent=ctx.agents.get('local-worktree');
  if(started||!agent)throw new Error('此工作树操作已失效。');
  started=true;
  return request.record
   ? ctx.worktrees.restore(agent,request.record,signal)
   : ctx.worktrees.create(agent,{name:request.name},signal);
 }});
 const ready=server.then(({url,token})=>writeBridge(file,key,{url,token}));
 ready.catch(()=>ctx.logger.warn('无法启动工作树服务。'));
 ctx.on('dispose',async()=>{
  controller.abort();
  await ready.catch(()=>{});
  await (await server.catch(()=>null))?.close();
 });
}

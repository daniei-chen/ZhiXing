import {startToolBridge} from '../electron/tool-bridge.mjs';
import {writeBridge} from './privacy-bridge.mjs';

export const name = 'zhixing-execution-controls';
export const inject = ['agents','subagents'];

export function apply(ctx) {
 const {ZHIXING_CONTROL_PATH:file, ZHIXING_CONTROL_KEY:key, ZHIXING_CONTROL_SESSION:session} = process.env;
 if (!file || !key || !session) return;
 delete process.env.ZHIXING_CONTROL_PATH;
 delete process.env.ZHIXING_CONTROL_KEY;
 delete process.env.ZHIXING_CONTROL_SESSION;
 const controller = new AbortController();
 const server = startToolBridge({
  route:'/execution',
  signal:controller.signal,
  async invoke(input, signal) {
   signal.throwIfAborted();
   const root = ctx.agents.get(session);
   if (!root) throw new Error('此交办已结束。');
   const {action, target, owner} = input;
   if (action === 'interrupt-agent' && target !== session) {
    ctx.subagents.interrupt(target, {kind:'ancestor',agent:root});
    return 'requested';
   }
   if (action === 'send-agent' && target !== session) {
    await ctx.subagents.sendMessage(root,target,[{type:'text',text:input.text}],{signal});
    return 'accepted';
   }
   if (action === 'stop-job' || action === 'read-job') {
    const agent = owner===session ? root : ctx.agents.get(owner);
    if (!agent || ctx.subagents.rootOf(agent) !== root) throw new Error('后台作业不属于当前交办。');
    const jobs = ctx.get('jobs');
    if (!jobs) throw new Error('本次交办未启用后台作业。');
    if (action==='read-job') {
     const output=jobs.readAt(target,input.offset,owner);
     const text=output.chunks.map(chunk=>chunk.text).join('');
     const view=jobs.get(target,owner);
     return {text:text.slice(-16000),offset:output.next,lossy:output.lossy||text.length>16000,status:view.status};
    }
    return jobs.kill(target, owner, '用户从执行面板请求停止');
   }
   throw new Error('执行控制参数无效。');
  },
 });
 const ready = server.then(({url,token})=>writeBridge(file,key,{url,token}));
 ready.catch(()=>ctx.logger.warn('知行执行控制未能启动。'));
 ctx.on('dispose',async()=>{
  controller.abort();
  await ready.catch(()=>{});
  const handle = await server.catch(()=>null);
  await handle?.close();
 });
 // Cordis tracks this plugin's readiness. The SDK may initialize concurrently,
 // so RuntimeManager also waits for this record before admitting any turn.
 return ready;
}

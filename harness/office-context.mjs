import {writeBridge} from './privacy-bridge.mjs';
export const name='zhixing-context';
export const inject=['tools','tokenMeter','agents','goals','planMode','sessionProjections','skills'];
export function apply(ctx){
 let tail=Promise.resolve();const reports={};let skillCatalog;
 ctx.on('session/event',(session,event)=>{
  if(!['turn/end','command/done','assistant/message','goal/change','plan/mode'].includes(event.type))return;
  const agent=ctx.agents.get(session.id);
  reports[session.id]={measurement:ctx.tokenMeter.measure(session),pressure:ctx.tokenMeter.contextPressure(session),stats:ctx.sessionProjections.snapshot(session,['sessionStats']).values.sessionStats,planning:agent?(ctx.planMode.get(agent).pending??ctx.planMode.get(agent).active):false,goal:agent?ctx.goals.get(agent)||null:null,tools:ctx.tools.definitions().map(tool=>({name:tool.name,description:tool.description?.slice(0,300)||''}))};
  const snapshot=JSON.parse(JSON.stringify(reports));
  skillCatalog??=ctx.skills.list({cwd:process.env.ZHIXING_WORKSPACE_ROOT||undefined}).then(skills=>skills.map(({name,description,source,provider})=>({name,description,source,provider})));
  tail=tail.then(async()=>{snapshot[session.id].skills=await skillCatalog;await writeBridge(process.env.ZHIXING_CONTEXT_FILE,process.env.ZHIXING_BRIDGE_KEY,snapshot);});
  tail.catch(error=>ctx.logger.error('上下文状态保存失败',error));
 });
 ctx.on('dispose',()=>tail);
}

import {writeBridge} from './privacy-bridge.mjs';
import {projectTeamBoard} from '../src/team-board.js';
import {normaliseKernel} from '../src/kernel-config.js';
import {createCapabilityManifest} from './capability-manifest.mjs';

export const name = 'zhixing-context';
export const inject = ['tools', 'systemPrompt', 'tokenMeter', 'agents', 'goals', 'planMode', 'sessionProjections', 'skills', 'agentTeams'];

export function apply(ctx) {
 let tail = Promise.resolve();
 const reports = {};
 let skillCatalog;
 const modelCatalogs=new Map();
 const manifestInputs=new Map();
 ctx.on('tools/change',()=>modelCatalogs.clear());
 const kernel=normaliseKernel(JSON.parse(process.env.ZHIXING_KERNEL||'{}'));
 ctx.on('agent/created',async({agent,source,signal})=>{
  if(source==='startup'&&agent.session.header.origin!=='subagent')await ctx.agentTeams.setEnabled(agent,kernel.teamEnabled&&kernel.subagentDepth>0,signal);
 });
 ctx.on('session/event', (session, event) => {
  if (!['turn/end', 'command/done', 'assistant/message', 'goal/change', 'plan/mode', 'team/task', 'team/mode'].includes(event.type)) return;
  const agent = ctx.agents.get(session.id);
  const projection=ctx.sessionProjections.snapshot(session,['sessionStats','agentTeam']).values;
  const tools=ctx.tools.definitions(agent).map(tool=>({name:tool.name,description:tool.description?.slice(0,300)||''}));
  const planning=agent?(ctx.planMode.get(agent).pending??ctx.planMode.get(agent).active):false;
  reports[session.id] = {
   measurement: ctx.tokenMeter.measure(session),
   pressure: ctx.tokenMeter.contextPressure(session),
   stats: projection.sessionStats,
   team: projectTeamBoard(projection.agentTeam,JSON.parse(process.env.ZHIXING_CUSTOM_TERMS||'[]'),JSON.parse(process.env.ZHIXING_PRIVACY_POLICY||'{}')),
   capabilities:[{id:'team',configured:kernel.teamEnabled,active:projection.agentTeam?.enabled===true&&kernel.teamEnabled&&kernel.subagentDepth>0},{id:'ptc',configured:kernel.ptcEnabled,active:kernel.ptcEnabled&&process.env.ZHIXING_PERMISSION_MODE==='full'&&Boolean(process.env.ZHIXING_WORKSPACE_ROOT)}],
   planning,
   goal: agent ? ctx.goals.get(agent) || null : null,
   tools,
  };
  let modelCatalog=modelCatalogs.get(session.id);
  if(!modelCatalog){modelCatalog=ctx.systemPrompt.assemble({scope:agent}).then(value=>value.tools.map(tool=>tool.name));modelCatalogs.set(session.id,modelCatalog);modelCatalog.catch(()=>modelCatalogs.delete(session.id));}
  manifestInputs.set(session.id,{modelCatalog,options:{kernel,tools,scope:process.env.ZHIXING_CAPABILITY_SCOPE,hasWorkspace:Boolean(process.env.ZHIXING_WORKSPACE_ROOT),permission:process.env.ZHIXING_PERMISSION_MODE,protocol:process.env.ZHIXING_MODEL_PROTOCOL,allowNetwork:process.env.ZHIXING_ALLOW_NETWORK!=='false',browserBridge:Boolean(process.env.ZHIXING_BROWSER_BRIDGE),automationBridge:Boolean(process.env.ZHIXING_AUTOMATION_BRIDGE),teamActive:projection.agentTeam?.enabled===true,planning:planning===true}});
  const snapshot = JSON.parse(JSON.stringify(reports)),manifestSnapshot=[...manifestInputs];
  skillCatalog ??= ctx.skills.list({cwd: process.env.ZHIXING_WORKSPACE_ROOT || undefined})
   .then(skills => skills.map(({name, description, source, provider}) => ({name, description, source, provider})));
  tail = tail.catch(() => {}).then(async () => {
   const skills = await skillCatalog;
   for(const [id,input] of manifestSnapshot)snapshot[id].capabilityManifest=createCapabilityManifest({...input.options,modelTools:await input.modelCatalog});
   // In-process children share this reporter. Every whole-file snapshot must
   // keep the catalog for its parent and all earlier sessions as well.
   for (const report of Object.values(snapshot)) report.skills = skills;
   await writeBridge(process.env.ZHIXING_CONTEXT_FILE, process.env.ZHIXING_BRIDGE_KEY, snapshot);
  });
  tail.catch(error => ctx.logger.error('上下文状态保存失败', error));
 });
 ctx.on('session/flush', () => tail);
 ctx.on('dispose', () => tail);
}

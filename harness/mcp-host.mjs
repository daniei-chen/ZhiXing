import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readBridge,writeBridge} from './privacy-bridge.mjs';
const require=createRequire(import.meta.url),h=createRequire(require.resolve('@deepseek-ai/dsh/lib/bin.js'));
export const name='zhixing-mcp-host';
export const inject=['tools'];
export async function apply(ctx){
 if(!process.env.ZHIXING_MCP_FILE)return;
 const servers=await readBridge(process.env.ZHIXING_MCP_FILE,process.env.ZHIXING_BRIDGE_KEY);
 const plugin=await import(pathToFileURL(h.resolve('@deepseek-ai/dsh-mcp-client')).href);
 const status=[];
 for(const server of servers.filter(server=>server.enabled)){
  const {enabled,...config}=server;
  if(config.transport==='stdio')config.env={...Object.fromEntries(Object.keys(process.env).filter(key=>/^(ZHIXING_|DSH_|DEEPSEEK_API_KEY|ELECTRON_RUN_AS_NODE)/i.test(key)).map(key=>[key,''])),...config.env};
  try{await ctx.plugin(plugin,config);status.push({server:config.serverName,connected:true});}
  catch{status.push({server:config.serverName,connected:false});}
 }
 await writeBridge(`${process.env.ZHIXING_MCP_FILE}.status`,process.env.ZHIXING_BRIDGE_KEY,status);
}

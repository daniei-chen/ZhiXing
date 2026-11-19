const SERVER=/^[A-Za-z0-9_-]{1,32}$/;
const RESERVED=/^(?:DEEPSEEK_API_KEY|ZHIXING_|DSH_|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)/i;
function stringMap(value,label){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>40)throw new Error(`${label}格式无效。`);
 for(const [key,text]of Object.entries(value))if(!/^[A-Za-z_][\w-]{0,79}$/.test(key)||typeof text!=='string'||text.length>8000||RESERVED.test(key))throw new Error(`${label}含无效或保留字段。`);
 return {...value};
}
export function validateMcpServers(value){
 if(!Array.isArray(value)||value.length>12)throw new Error('最多配置 12 个 MCP 服务。');
 const names=new Set();return value.map(server=>{
  if(!server||!SERVER.test(server.serverName)||names.has(server.serverName))throw new Error('MCP 服务名需为 1–32 位字母、数字、下划线或连字符，且不能重复。');
  names.add(server.serverName);
  const common={serverName:server.serverName,enabled:server.enabled!==false,toolCallTimeoutMs:60000,maxInstructionBytes:16000,failOnStartupError:true,reconnect:{enabled:false}};
  if(server.transport==='stdio'){
   if(typeof server.command!=='string'||!server.command.trim()||server.command.length>1000||!Array.isArray(server.args)||server.args.length>60||server.args.some(arg=>typeof arg!=='string'||arg.length>4000)||server.cwd!==undefined&&(typeof server.cwd!=='string'||server.cwd.length>1000))throw new Error('MCP 本机命令、参数或目录无效。');
   return {...common,transport:'stdio',command:server.command.trim(),args:server.args,env:stringMap(server.env,'环境变量'),cwd:server.cwd||''};
  }
  if(server.transport!=='streamable-http')throw new Error('MCP 仅支持 stdio 或 streamable-http。');
  let url;try{url=new URL(server.url);}catch{throw new Error('MCP 服务地址无效。');}
  if(url.username||url.password||url.hash||url.search||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('MCP 使用 HTTPS；本机服务可用 HTTP。凭据请放入请求头。');
  return {...common,transport:'streamable-http',url:url.href,headers:stringMap(server.headers,'请求头')};
 });
}
export function publicMcpServers(value){return value.map(({env,headers,...server})=>({...server,envKeys:Object.keys(env||{}),headerKeys:Object.keys(headers||{})}));}

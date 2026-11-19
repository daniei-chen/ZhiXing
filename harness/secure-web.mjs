import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import dns from 'node:dns/promises';
import {Agent,fetch} from 'undici';
import ipaddr from 'ipaddr.js';
const r=createRequire(import.meta.url),h=createRequire(r.resolve('@deepseek-ai/dsh/lib/bin.js')),b=createRequire(h.resolve('@deepseek-ai/dsh-base'));
const {HttpFetchProvider}=await import(pathToFileURL(b.resolve('@deepseek-ai/dsh-web-fetch-http')).href);
export const name='zhixing-secure-web';
export const inject=['web'];
export function isPublicAddress(address){try{let ip=ipaddr.parse(address);if(ip.kind()==='ipv6'&&ip.isIPv4MappedAddress())ip=ip.toIPv4Address();return ip.range()==='unicast';}catch{return false;}}
export function apply(ctx){
 const limits={maxResponseBytes:2000000,maxBodyChars:60000,timeoutMs:30000,maxRedirects:5,userAgent:'zhixing-office/0.3 DeepSeek-Harness'};
 class PinnedFetch extends HttpFetchProvider {
  dispatchers=[];
  async requestOnce(url,signal){
   const hostname=url.hostname.replace(/^\[|\]$/g,''),addresses=await dns.lookup(hostname,{all:true});
   signal.throwIfAborted();if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))throw new Error('Private/local network addresses are blocked for web_fetch.');
   const chosen=addresses[0],dispatcher=new Agent({connect:{lookup:(_host,options,callback)=>options.all?callback(null,[chosen]):callback(null,chosen.address,chosen.family)}});this.dispatchers.push(dispatcher);
   return fetch(url,{method:'GET',redirect:'manual',headers:{'user-agent':limits.userAgent,accept:'text/html,application/xhtml+xml,text/*,application/json'},signal,dispatcher});
  }
 }
 ctx.web.registerFetchProvider({id:'http',available:()=>true,async fetch(request,signal){const provider=new PinnedFetch(limits);try{return await provider.fetch(request,signal);}finally{await Promise.all(provider.dispatchers.map(dispatcher=>dispatcher.close()));}}});
}

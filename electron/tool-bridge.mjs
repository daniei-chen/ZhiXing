import http from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
export async function startToolBridge({invoke,signal,route='/browser',drain=false,maxBodyBytes=50000}){
 const token=randomBytes(32).toString('hex');
 const pending=new Set();
 async function handle(req,res){try{
  if(signal.aborted||req.method!=='POST'||req.url!==route||req.headers.authorization!==`Bearer ${token}`){res.writeHead(403).end();return;}
  const connection=new AbortController();
  res.once('close',()=>{if(!res.writableEnded)connection.abort();});
  const requestSignal=AbortSignal.any([signal,connection.signal]);
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBodyBytes)throw new Error('工具请求过长。');chunks.push(chunk);}
  requestSignal.throwIfAborted();
  const input=JSON.parse(Buffer.concat(chunks).toString());const result=await invoke(input,requestSignal);
  requestSignal.throwIfAborted();
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({value:result}));
 }catch(error){if(!res.destroyed&&!res.headersSent)res.writeHead(400,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({error:String(error.message).slice(0,300)}));}}
 const server=http.createServer((req,res)=>{
  const job=handle(req,res);
  pending.add(job);
  void job.then(()=>pending.delete(job),()=>pending.delete(job));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');return {url:`http://127.0.0.1:${server.address().port}${route}`,token,close:async()=>{
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  if(drain)await Promise.allSettled(pending);
 }};
}

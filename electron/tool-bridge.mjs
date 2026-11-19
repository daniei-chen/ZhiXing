import http from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
export async function startToolBridge({invoke,signal,route='/browser'}){
 const token=randomBytes(32).toString('hex');
 const server=http.createServer(async(req,res)=>{try{
  if(signal.aborted||req.method!=='POST'||req.url!==route||req.headers.authorization!==`Bearer ${token}`){res.writeHead(403).end();return;}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>50000)throw new Error('浏览器请求过长。');chunks.push(chunk);}
  const input=JSON.parse(Buffer.concat(chunks).toString());const result=await invoke(input,signal);
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({value:result}));
 }catch(error){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:String(error.message).slice(0,300)}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');return {url:`http://127.0.0.1:${server.address().port}${route}`,token,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

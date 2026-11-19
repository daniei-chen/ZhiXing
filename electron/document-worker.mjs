import {parseOfficeFile} from './document-text.mjs';
try{let size=0;const chunks=[];for await(const chunk of process.stdin){if((size+=chunk.length)>10*1024*1024)throw new Error('文件超过 10 MB。');chunks.push(chunk);}const value=await parseOfficeFile(process.argv[2],Buffer.concat(chunks));process.stdout.write(JSON.stringify({value}));}
catch(error){process.stdout.write(JSON.stringify({error:String(error.message||'资料读取失败。').slice(0,400)}));process.exitCode=1;}

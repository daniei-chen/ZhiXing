import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runDocumentWorker} from './document-service.mjs';

const limit = 32 * 1024 * 1024;
export async function importDeepSeekChats(file) {
 const handle = await fs.open(file,'r');
 let archive;
 try {
  const stat = await handle.stat();
  if(!stat.isFile()||stat.size>limit)throw new Error('请选择不超过 32 MB 的 DeepSeek 导出 ZIP。');
  const bytes = Buffer.alloc(stat.size+1);
  let size = 0;
  while(size<bytes.length){
   const {bytesRead}=await handle.read(bytes,size,bytes.length-size,size);
   if(!bytesRead)break;
   size+=bytesRead;
  }
  if(size!==stat.size)throw new Error('导出文件正在变更，请重试。');
  archive=bytes.subarray(0,size);
 } finally {await handle.close();}
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-import-'));
 try{return await runDocumentWorker('chat-import-worker.mjs',[directory],archive,{timeoutMs:50000,maxBytes:7*1024*1024});}
 finally{await fs.rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
}

import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readBridge,writeBridge} from './privacy-bridge.mjs';
const r=createRequire(import.meta.url),h=createRequire(r.resolve('@deepseek-ai/dsh/lib/bin.js'));
const {SessionPersistence,SessionPersistenceNotFoundError,SessionAlreadyExistsError,SessionAlreadyOwnedError,SessionReadOnlyError,SessionHandleClosedError,materializeCreateHeader,materializeAppendBatch,assertContiguous,assertStoredId,assertVersion,validateStoredEvents}=await import(pathToFileURL(h.resolve('@deepseek-ai/dsh-session-persistence')).href);
export const name='zhixing-encrypted-history';
export function apply(ctx){
 const root=process.env.ZHIXING_HISTORY_DIR,key=process.env.ZHIXING_HISTORY_KEY;
 if(!root||!key)throw new Error('加密会话目录未配置。');
 class EncryptedHistory extends SessionPersistence {
  constructor(context){super(context);this.records=new Map();this.owners=new Map();
   ctx.on('session/event',(session,event)=>{this.owners.get(session.id)?.append([event]).catch(error=>ctx.logger.error('加密会话写入失败',error));});
   ctx.on('session/flush',session=>this.owners.get(session.id)?.flush());
   ctx.on('session/disposed',session=>this.owners.get(session.id)?.close());
   ctx.on('dispose',()=>Promise.all([...this.owners.values()].map(handle=>handle.close())));
  }
  file(id){if(!/^[\w-]{1,150}$/.test(id))throw new Error('会话记录编号无效。');return path.join(root,`${id}.bin`);}
  async record(id){if(this.records.has(id))return this.records.get(id);let value;try{value=await readBridge(this.file(id),key);}catch(error){if(error.code==='ENOENT')return;throw error;}assertStoredId(id,value.header);assertVersion(value.header);validateStoredEvents(value.header,value.events);this.records.set(id,value);return value;}
  async save(record){await fs.mkdir(root,{recursive:true});await writeBridge(this.file(record.header.id),key,record);}
  async create(header,options={}){options.signal?.throwIfAborted();const next=materializeCreateHeader(header);if(await this.record(next.id))throw new SessionAlreadyExistsError(next.id);if(!!next.isSeeded!==((options.inheritedEventCount||0)>0))throw new Error('会话继承记录无效。');const record={header:next,events:[],inheritedEventCount:options.inheritedEventCount||0};this.records.set(next.id,record);return this.handle(record,'write');}
  async open(id,access,options={}){options.signal?.throwIfAborted();const record=await this.record(id);if(!record)throw new SessionPersistenceNotFoundError(id);return this.handle(record,access);}
  handle(record,access){
   const service=this,id=record.header.id;if(access==='write'&&this.owners.has(id))throw new SessionAlreadyOwnedError(id);
   let closed=false,tail=Promise.resolve();const ensure=write=>{if(closed)throw new SessionHandleClosedError(id,'read/write');if(write&&access!=='write')throw new SessionReadOnlyError(id,'write');};
   const handle={id,header:structuredClone(record.header),inheritedEventCount:record.inheritedEventCount,access,
    async read(offset=0,length=record.events.length,options={}){ensure(false);options.signal?.throwIfAborted();await tail;return {eventState:'detached',events:structuredClone(record.events.slice(offset,offset+length))};},
    async append(events,options={}){ensure(true);options.signal?.throwIfAborted();const batch=materializeAppendBatch(events);tail=tail.then(()=>{assertContiguous(id,batch,record.events.length);record.events.push(...batch);});await tail;},
    async flush(options={}){ensure(true);options.signal?.throwIfAborted();tail=tail.then(()=>service.save(record));await tail;},
    async close(){if(closed)return;try{await tail;if(access==='write')await service.save(record);}finally{closed=true;if(service.owners.get(id)===handle)service.owners.delete(id);}},
    async [Symbol.asyncDispose](){await this.close();}
   };if(access==='write')this.owners.set(id,handle);return handle;
  }
  async flush(){await Promise.all([...this.owners.values()].map(handle=>handle.flush()));}
  async stat(id,options={}){options.signal?.throwIfAborted();const record=await this.record(id);return record?{header:structuredClone(record.header),revision:String(record.events.length),eventCount:record.events.length}:undefined;}
  async list(options={}){let files=[];try{files=await fs.readdir(root);}catch(error){if(error.code!=='ENOENT')throw error;}return (await Promise.all([...new Set([...this.records.keys(),...files.filter(file=>/^[\w-]+\.bin$/.test(file)).map(file=>file.slice(0,-4))])].map(id=>this.stat(id,options)))).filter(Boolean);}
 }
 new EncryptedHistory(ctx);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSaveQueue} from '../electron/workspace-save-queue.mjs';

const deferred=()=>{
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
};

test('concurrent workspace snapshots coalesce and flush the newest revision',async()=>{
 const first=deferred(),writes=[],states=[];
 const queue=new WorkspaceSaveQueue({write:async snapshot=>{writes.push(snapshot);if(writes.length===1)await first.promise;},onState:state=>states.push(state)});
 const savedFirst=queue.save(1,{content:'first'});
 const savedSecond=queue.save(2,{content:'second'});
 const savedLatest=queue.save(3,{content:'latest'});
 assert.equal(queue.state().requestedRevision,3);
 first.resolve();
 await Promise.all([savedFirst,savedSecond,savedLatest]);
 assert.deepEqual(writes,[{content:'first'},{content:'latest'}]);
 assert.equal(queue.state().persistedRevision,3);
 assert.equal(queue.state().status,'saved');
 assert(states.some(state=>state.status==='saving'));
});

test('write failures remain visible and retry the same revision',async()=>{
 let attempts=0;
 const queue=new WorkspaceSaveQueue({write:async()=>{attempts++;if(attempts===1)throw Object.assign(new Error('disk full'),{code:'ENOSPC'});}});
 await assert.rejects(queue.save(1,{content:'keep'}),/disk full/);
 assert.deepEqual(queue.state(),{status:'failed',requestedRevision:1,persistedRevision:0,errorCode:'ENOSPC'});
 await queue.retry();
 assert.equal(attempts,2);
 assert.equal(queue.state().status,'saved');
 assert.equal(queue.state().persistedRevision,1);
});

test('shutdown flush waits for an active write and propagates persistent failure',async()=>{
 const first=deferred(),queue=new WorkspaceSaveQueue({write:()=>first.promise});
 const writing=queue.save(1,{content:'final'});
 const flush=queue.flush();
 let finished=false;
 void flush.then(()=>{finished=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(finished,false);
 first.resolve();
 await Promise.all([writing,flush]);
 assert.equal(finished,true);

 const failed=new WorkspaceSaveQueue({write:async()=>{throw new Error('read-only');}});
 await assert.rejects(failed.save(1,{content:'final'}),/read-only/);
 await assert.rejects(failed.flush(),/保存失败/);
});

test('older out-of-order snapshots cannot overwrite the newest persisted state',async()=>{
 const writes=[],queue=new WorkspaceSaveQueue({write:async snapshot=>writes.push(snapshot)});
 await queue.save(2,{content:'latest'});
 await queue.save(1,{content:'stale'});
 assert.deepEqual(writes,[{content:'latest'}]);
 assert.equal(queue.state().persistedRevision,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSaveQueue} from '../electron/workspace-save-queue.mjs';

const deferred=()=>{
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
};

async function within(promise, timeoutMs = 1000) {
 let timer;
 try {
  return await Promise.race([
   promise,
   new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Workspace save did not settle within the test deadline.')), timeoutMs);
   }),
  ]);
 } finally {
  clearTimeout(timer);
 }
}

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

test('concurrent flush calls reject when the active write fails', async () => {
 const write = deferred();
 const queue = new WorkspaceSaveQueue({write: () => write.promise});
 const saving = assert.rejects(within(queue.save(1, {content: 'retain after failure'})), {code: 'ENOSPC'});
 const flushing = Array.from({length: 3}, () => assert.rejects(within(queue.flush()), {code: 'ENOSPC'}));

 write.reject(Object.assign(new Error('synthetic disk full'), {code: 'ENOSPC'}));
 await Promise.all([saving, ...flushing]);

 assert.deepEqual(queue.state(), {status: 'failed', requestedRevision: 1, persistedRevision: 0, errorCode: 'ENOSPC'});
 await assert.rejects(within(queue.flush()), {code: 'ENOSPC'});
});

test('retry after an active-write failure lets new flush calls await durable recovery', async () => {
 const first = deferred();
 const retry = deferred();
 const writes = [];
 const queue = new WorkspaceSaveQueue({write: snapshot => {
  writes.push(snapshot);
  return writes.length === 1 ? first.promise : retry.promise;
 }});
 const saving = assert.rejects(within(queue.save(1, {content: 'recover this snapshot'})), /synthetic read-only/);
 const failedFlush = assert.rejects(within(queue.flush()), {code: 'EACCES'});
 first.reject(Object.assign(new Error('synthetic read-only'), {code: 'EACCES'}));
 await Promise.all([saving, failedFlush]);

 const retrying = queue.retry();
 let flushed = false;
 const recoveredFlush = Promise.all([queue.flush(), queue.flush()]).then(states => {
  flushed = true;
  return states;
 });
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(flushed, false);
 assert.deepEqual(queue.state(), {status: 'saving', requestedRevision: 1, persistedRevision: 0});

 retry.resolve();
 const [saved, states] = await within(Promise.all([retrying, recoveredFlush]));
 assert.deepEqual(saved, {status: 'saved', requestedRevision: 1, persistedRevision: 1});
 assert(states.every(state => state.status === 'saved' && state.persistedRevision === 1));
 assert.deepEqual(writes, [{content: 'recover this snapshot'}, {content: 'recover this snapshot'}]);
});

test('failure of an older active write keeps flush waiting for the coalesced newer revision', async () => {
 const first = deferred();
 const latest = deferred();
 const latestStarted = deferred();
 const writes = [];
 const queue = new WorkspaceSaveQueue({write: snapshot => {
  writes.push(snapshot);
  if (writes.length === 1) return first.promise;
  latestStarted.resolve();
  return latest.promise;
 }});
 const saving = [
  queue.save(1, {content: 'first'}),
  queue.save(2, {content: 'superseded'}),
  queue.save(3, {content: 'latest'}),
 ];
 let flushed = false;
 const flushing = queue.flush().then(state => {
  flushed = true;
  return state;
 });
 first.reject(Object.assign(new Error('synthetic transient failure'), {code: 'EIO'}));
 await within(latestStarted.promise);
 assert.equal(flushed, false);
 assert.deepEqual(queue.state(), {status: 'saving', requestedRevision: 3, persistedRevision: 0});

 latest.resolve();
 await within(Promise.all([...saving, flushing]));
 assert.deepEqual(writes, [{content: 'first'}, {content: 'latest'}]);
 assert.deepEqual(queue.state(), {status: 'saved', requestedRevision: 3, persistedRevision: 3});
});

test('flush rejects if the newest revision fails after an older revision is persisted', async () => {
 const first = deferred();
 const latest = deferred();
 const latestStarted = deferred();
 const writes = [];
 const queue = new WorkspaceSaveQueue({write: snapshot => {
  writes.push(snapshot);
  if (writes.length === 1) return first.promise;
  latestStarted.resolve();
  return latest.promise;
 }});
 const savingFirst = queue.save(1, {content: 'first'});
 const savingSecond = assert.rejects(within(queue.save(2, {content: 'superseded'})), {code: 'ENOSPC'});
 const savingLatest = assert.rejects(within(queue.save(3, {content: 'latest'})), {code: 'ENOSPC'});
 const flushing = [
  assert.rejects(within(queue.flush()), {code: 'ENOSPC'}),
  assert.rejects(within(queue.flush()), {code: 'ENOSPC'}),
 ];
 first.resolve();
 await within(latestStarted.promise);
 await within(savingFirst);
 latest.reject(Object.assign(new Error('synthetic disk full'), {code: 'ENOSPC'}));
 await Promise.all([savingSecond, savingLatest, ...flushing]);

 assert.deepEqual(writes, [{content: 'first'}, {content: 'latest'}]);
 assert.deepEqual(queue.state(), {status: 'failed', requestedRevision: 3, persistedRevision: 1, errorCode: 'ENOSPC'});
});

test('a newer save replaces the failed snapshot and older acknowledgements cannot overwrite it', async () => {
 const first = deferred();
 const latest = deferred();
 const writes = [];
 const queue = new WorkspaceSaveQueue({write: snapshot => {
  writes.push(snapshot);
  return writes.length === 1 ? first.promise : latest.promise;
 }});
 const failedSave = assert.rejects(within(queue.save(1, {content: 'failed old snapshot'})), /synthetic failure/);
 const failedFlush = assert.rejects(within(queue.flush()), {code: 'WORKSPACE_WRITE_FAILED'});
 first.reject(new Error('synthetic failure'));
 await Promise.all([failedSave, failedFlush]);

 const savingLatest = queue.save(3, {content: 'newer snapshot'});
 const flushing = queue.flush();
 await assert.rejects(queue.save(2, {content: 'stale snapshot'}), /已过期/);
 latest.resolve();
 await within(Promise.all([savingLatest, flushing]));
 await queue.save(1, {content: 'late old snapshot'});

 assert.deepEqual(writes, [{content: 'failed old snapshot'}, {content: 'newer snapshot'}]);
 assert.deepEqual(queue.state(), {status: 'saved', requestedRevision: 3, persistedRevision: 3});
});

test('a state listener retry cannot hide failure from flush callers already waiting', async () => {
 const first = deferred();
 const retryWrite = deferred();
 const retryStarted = deferred();
 let attempts = 0;
 let retrying;
 const queue = new WorkspaceSaveQueue({
  write: () => ++attempts === 1 ? first.promise : retryWrite.promise,
  onState: state => {
   if (state.status === 'failed') {
    retrying = queue.retry();
    retryStarted.resolve();
   }
  },
 });
 const saving = assert.rejects(within(queue.save(1, {content: 'listener retry'})), {code: 'EIO'});
 const flushing = assert.rejects(within(queue.flush()), {code: 'EIO'});
 first.reject(Object.assign(new Error('synthetic write failure'), {code: 'EIO'}));
 await within(Promise.all([saving, flushing, retryStarted.promise]));
 assert.deepEqual(queue.state(), {status: 'saving', requestedRevision: 1, persistedRevision: 0});

 const recoveryFlush = queue.flush();
 retryWrite.resolve();
 await within(Promise.all([retrying, recoveryFlush]));
 assert.equal(attempts, 2);
 assert.deepEqual(queue.state(), {status: 'saved', requestedRevision: 1, persistedRevision: 1});
});

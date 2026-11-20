/**
 * Serialize workspace snapshots while coalescing snapshots that have not yet
 * started writing. Every acknowledged revision has reached the injected durable
 * writer, and a failed newest revision remains available for an explicit retry.
 */
export class WorkspaceSaveQueue {
 constructor({write,onState=()=>{}}){
  if(typeof write!=='function')throw new TypeError('Workspace save writer is required.');
  this.write=write;
  this.onState=onState;
  this.requestedRevision=0;
  this.persistedRevision=0;
  this.status='saved';
  this.errorCode=undefined;
  this.pending=null;
  this.active=null;
  this.running=false;
  this.waiters=[];
 }

 state(){
  return {status:this.status,requestedRevision:this.requestedRevision,persistedRevision:this.persistedRevision,...(this.errorCode?{errorCode:this.errorCode}:{})};
 }

 publish(){try{this.onState(this.state());}catch{}}

 save(revision,snapshot){
  if(!Number.isSafeInteger(revision)||revision<1) return Promise.reject(new Error('工作空间保存版本无效。'));
  if(revision<=this.persistedRevision)return Promise.resolve(this.state());
  if(revision<this.requestedRevision)return Promise.reject(new Error('工作空间保存版本已过期。'));
  if(revision===this.requestedRevision&&revision!==this.pending?.revision&&revision!==this.active?.revision)return Promise.reject(new Error('工作空间保存版本已提交。'));
  this.requestedRevision=Math.max(this.requestedRevision,revision);
  if(revision!==this.active?.revision)this.pending={revision,snapshot};
  this.errorCode=undefined;
  this.status='saving';
  const promise=new Promise((resolve,reject)=>this.waiters.push({revision,resolve,reject}));
  this.publish();
  void this.drain();
  return promise;
 }

 retry(){
  if(this.running)return Promise.resolve(this.state());
  if(!this.pending)return Promise.resolve(this.state());
  this.errorCode=undefined;
  this.status='saving';
  const promise=new Promise((resolve,reject)=>this.waiters.push({revision:this.pending.revision,resolve,reject}));
  this.publish();
  void this.drain();
  return promise;
 }

 async drain(){
  if(this.running||!this.pending)return;
  this.running=true;
  const current=this.pending;
  this.active=current;
  this.pending=null;
  try{
   await this.write(current.snapshot);
   this.persistedRevision=Math.max(this.persistedRevision,current.revision);
   this.status=this.pending?'saving':'saved';
   this.errorCode=undefined;
   for(const waiter of this.waiters.filter(item=>item.revision<=this.persistedRevision)){
    waiter.resolve(this.state());
   }
   this.waiters=this.waiters.filter(item=>item.revision>this.persistedRevision);
  }catch(error){
   const newer=this.pending;
   if(newer){
    this.status='saving';
    this.errorCode=undefined;
   }else{
    this.pending=current;
    this.status='failed';
    this.errorCode=error?.code||'WORKSPACE_WRITE_FAILED';
    for(const waiter of this.waiters)waiter.reject(error);
    this.waiters=[];
   }
  }finally{
   this.running=false;
   this.active=null;
   // A failed snapshot stays pending for retry, but current flush callers must
   // receive the failure before state listeners can start another save.
   if(!this.pending||this.status==='failed')this.resolveIdle();
   this.publish();
   if(this.pending&&this.status==='saving')void this.drain();
  }
 }

 resolveIdle(){
  const waiting=this.idleWaiters||[];
  this.idleWaiters=[];
  if(this.status==='failed'){
   const error=Object.assign(new Error('工作空间保存失败，仍有更改尚未写入。'),{code:this.errorCode});
   for(const settle of waiting)settle.reject(error);
  }else for(const settle of waiting)settle.resolve(this.state());
 }

 async flush(){
  if(this.status==='failed')throw Object.assign(new Error('工作空间保存失败，仍有更改尚未写入。'),{code:this.errorCode});
  if(this.running||this.pending)await new Promise((resolve,reject)=>{
   this.idleWaiters||=[];
   this.idleWaiters.push({resolve,reject});
  });
  if(this.status==='failed')throw Object.assign(new Error('工作空间保存失败，仍有更改尚未写入。'),{code:this.errorCode});
  return this.state();
 }
}

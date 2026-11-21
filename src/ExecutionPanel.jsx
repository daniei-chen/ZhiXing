import {useEffect,useRef,useState} from 'react';
import {CircleNotch} from '@phosphor-icons/react';

const categories = [
 ['all','全部'], ['tools','工具'], ['agents','子任务'], ['workflow','工作流'],
 ['jobs','后台作业'], ['team','共享任务'], ['session','会话'],
];
const statusLabels = {
 running:'运行中', completed:'已完成', cancelled:'已取消', interrupted:'已中断',
 failed:'失败', error:'失败', killed:'已停止', blocked:'被阻止', aborted:'已中断',
 'max-tokens':'达到输出上限', stop:'已结束',
};
const formatTime = time => new Date(time).toLocaleTimeString('zh-CN',{hour12:false});
const duration = ms => ms >= 1000 ? `${(ms/1000).toFixed(2)} 秒` : `${ms} 毫秒`;

export function ExecutionPanel({messages, liveTrace, liveRun, traceTruncated, sessionId, liveTeam}) {
 const [selected,setSelected] = useState('');
 const [filter,setFilter] = useState('all');
 const [limit,setLimit] = useState(30);
 const [controls,setControls] = useState({});
 const [error,setError] = useState('');
 const [selectedItem,setSelectedItem] = useState(null);
 const runs = messages.filter(message=>message.trace?.length || message.children?.length).slice(-40).reverse();
 const archived = runs.find(run=>run.id===selected) ?? (!liveRun ? runs[0] : undefined);
 const reply = selected==='live'&&liveRun ? undefined : archived;
 const live = !reply && !!liveRun;
 const entries = (live ? liveTrace : reply?.trace || []).filter(event=>event.label);
 const children = live ? liveTrace.findLast(event=>event.type==='subagents')?.children || [] : reply?.children || [];
 const recent = entries.filter(event=>filter==='all'||(event.category || 'session')===filter).slice().reverse();
 const childRows = new Map(children.map((child,index)=>[child.id,index+1]));
 const jobs = [...new Map(entries.filter(event=>event.category==='jobs'&&event.itemId).map(event=>[event.itemId,event])).values()];
 const controlKey = (action,target) => `${liveRun}:${action}:${target}`;
 async function stop(action,target) {
  const key = controlKey(action,target);
  setControls(old=>({...old,[key]:'pending'}));
  setError('');
  try {
   const result = await window.zhixing.controlExecution({runId:liveRun,sessionId,action,target});
   setControls(old=>({...old,[key]:result.requested?'requested':'finished'}));
  } catch (cause) {
   setControls(old=>({...old,[key]:undefined}));
   setError(cause.message.replace(/^Error invoking remote method '[^']+': Error: /,''));
  }
 }
 function stopButton(action,target,status,label) {
  if(!live||status!=='running'||!window.zhixing?.controlExecution)return null;
  const state = controls[controlKey(action,target)];
  return <button type="button" className="secondary-button" disabled={!!state} onClick={()=>stop(action,target)}>
   {state==='pending'?'正在发送…':state==='requested'?'已请求停止':state==='finished'?'已结束':label}
  </button>;
 }
 return <div className="execution-panel">
  <div className="execution-head"><h3>执行轨迹</h3>{live && <span><CircleNotch size={13}/>正在执行</span>}</div>
  <TeamBoard board={live?liveTeam:reply?.context?.team}/>
  {(live || runs.length>0) && <div className="execution-filters">
   <label>交办
    <select value={live?'live':reply?.id||''} onChange={event=>{setSelected(event.target.value);setSelectedItem(null);setLimit(30);}}>
     {liveRun&&<option value="live">当前交办</option>}
     {runs.map(run=><option key={run.id} value={run.id}>{run.trace?.[0]?.time ? new Date(run.trace[0].time).toLocaleString('zh-CN',{hour12:false}) : '协作记录'}{run.error?' · 失败':run.stopped?' · 已停止':''}</option>)}
    </select>
   </label>
   <label>事件
    <select value={filter} onChange={event=>{setFilter(event.target.value);setLimit(30);}}>
     {categories.map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select>
   </label>
  </div>}
  {!!children.length && (filter==='all'||filter==='agents') && <div className="execution-children">
   <h4>协作子任务</h4>
   {children.map(child=><div key={child.id}>
    <span>子任务 {childRows.get(child.id)}{childRows.has(child.parentId) && <small>由子任务 {childRows.get(child.parentId)} 委派</small>}</span>
    <span>{!live&&child.status==='running' ? '已中断' : statusLabels[child.status] || '已结束'}
     {(live||child.messages?.length>0)&&<button className="text-button" onClick={()=>setSelectedItem({type:'agent',id:child.id})}>查看对话</button>}
     {stopButton('interrupt-agent',child.id,child.status,'停止子任务')}</span>
   </div>)}
  </div>}
  {!!jobs.length && (filter==='all'||filter==='jobs') && <div className="execution-children">
   <h4>后台作业</h4>
   {jobs.map((job,index)=><div key={job.itemId}>
    <span>作业 {index+1}{childRows.has(job.childSessionId) && <small>子任务 {childRows.get(job.childSessionId)}</small>}</span>
    <span>{!live&&job.status==='running'?'运行已结束':statusLabels[job.status]||'已结束'}
     {live&&<button className="text-button" onClick={()=>setSelectedItem({type:'job',id:job.itemId})}>查看输出</button>}
     {stopButton('stop-job',job.itemId,job.status,'停止作业')}</span>
   </div>)}
  </div>}
  {selectedItem&&<ExecutionDetail key={`${selectedItem.type}:${selectedItem.id}`} item={selectedItem} runId={live?liveRun:null}
    sessionId={sessionId} saved={children.find(child=>child.id===selectedItem.id)?.messages} onClose={()=>setSelectedItem(null)}/>}
  {error && <p className="workbench-error" role="alert">{error}</p>}
  {(live?traceTruncated:reply?.traceTruncated) && <p className="settings-note">较早的事件已达到记录上限。</p>}
  {recent.length ? <>
   <div className="execution-list">
    {recent.slice(0,limit).map((event,index)=><details className="execution-entry" key={`${event.runId}-${event.childSessionId||'root'}-${event.sequence??event.time}-${recent.length-index}`}>
     <summary><span>{event.label}</span><time dateTime={new Date(event.time).toISOString()}>{formatTime(event.time)}</time></summary>
     <dl>
      <div><dt>来源</dt><dd>{event.childSessionId?(childRows.has(event.childSessionId)?`子任务 ${childRows.get(event.childSessionId)}`:'子任务'):'当前会话'}</dd></div>
      {statusLabels[event.status]&&<div><dt>状态</dt><dd>{statusLabels[event.status]}</dd></div>}
      {event.turn!==undefined&&<div><dt>轮次</dt><dd>{event.turn}</dd></div>}
      {event.step!==undefined&&<div><dt>步骤</dt><dd>{event.step}</dd></div>}
      {event.durationMs!==undefined&&<div><dt>耗时</dt><dd>{duration(event.durationMs)}</dd></div>}
     </dl>
    </details>)}
   </div>
   {recent.length>limit && <button className="secondary-button execution-more" onClick={()=>setLimit(value=>value+30)}>显示更早的事件</button>}
  </> : <p className="empty-note">{live||reply?'这次交办暂无这一类事件。':'交办开始后，这里会显示工具调用、子任务、工作流和后台作业。'}</p>}
 </div>;
}

function TeamBoard({board}) {
 if(!board?.enabled)return null;
 const labels={pending:'待开始',in_progress:'进行中',completed:'已完成'};
 return <section className="team-board" aria-label="共享任务板"><div className="team-board-heading"><h4>共享任务板</h4><span>{board.tasks.filter(task=>task.status==='completed').length} / {board.tasks.length}</span></div>
  {board.failure&&<p role="alert">{board.failure}</p>}
  {!board.tasks.length&&<p className="muted">多 Agent 协作时，在这里查看共享任务、负责人和依赖。</p>}
  <ol>{board.tasks.map(task=><li key={task.id}><details><summary><span>{task.subject||`任务 ${task.id}`}</span><small>{labels[task.status]}</small></summary><p>{task.description}</p><dl><div><dt>负责人</dt><dd>{task.owner||'尚未领取'}</dd></div><div><dt>版本</dt><dd>{task.revision}</dd></div>{task.blockedBy.length>0&&<div><dt>依赖</dt><dd>{task.blockedBy.join('、')}</dd></div>}{task.writeScopes.length>0&&<div><dt>预期文件范围</dt><dd>{task.writeScopes.join('、')}</dd></div>}</dl>{task.warnings.map((warning,index)=><p className="settings-note" key={index}>{warning}</p>)}</details></li>)}</ol>
  {board.truncated&&<p className="settings-note">仅显示前 100 项，完整状态保存在加密会话中。</p>}
 </section>;
}

function ExecutionDetail({item,runId,sessionId,saved,onClose}){
 const [messages,setMessages]=useState([]);
 const [log,setLog]=useState('');
 const [lossy,setLossy]=useState(false);
 const [status,setStatus]=useState('');
 const [loadError,setLoadError]=useState('');
 const [draft,setDraft]=useState('');
 const [sending,setSending]=useState(false);
 const [sendNotice,setSendNotice]=useState('');
 const scroll=useRef(null);
 const isAgent=item.type==='agent';
 const action=isAgent?'read-agent':'read-job';
 useEffect(()=>{
  if(!runId||!window.zhixing?.controlExecution)return;
  let active=true,timer,offset=0;
  async function refresh(){
   try{
    const result=await window.zhixing.controlExecution({runId,sessionId,action,target:item.id,offset});
    if(!active)return;
    setLoadError('');
    if(isAgent)setMessages(result.messages);
    else{
     offset=result.offset;
     setStatus(result.status);
     if(result.lossy)setLossy(true);
     if(result.text)setLog(old=>{
      return (old+result.text).slice(-50000);
     });
     if(!['running','stopping'].includes(result.status))return;
    }
   }catch(cause){
    if(!active)return;
    setLoadError(cause.message.replace(/^Error invoking remote method '[^']+': Error: /,''));
   }
   timer=setTimeout(refresh,1000);
  }
  void refresh();
  return()=>{active=false;clearTimeout(timer);};
 },[runId,sessionId,action,item.id,isAgent]);
 useEffect(()=>{
  if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;
 },[log]);
 async function send(event){
  event.preventDefault();
  const text=draft.trim();
  if(!text||!runId||sending)return;
  setSending(true);
  setSendNotice('');
  try{
   const result=await window.zhixing.controlExecution({runId,sessionId,action:'send-agent',target:item.id,text});
   if(!result.accepted)throw new Error('子任务未接收补充。');
   setDraft('');
   setSendNotice('内核已接收补充。');
  }catch(cause){setSendNotice(cause.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
  finally{setSending(false);}
 }
 const transcript=saved?.length?saved:messages;
 return <section className="execution-detail" aria-label={isAgent?'子任务对话':'后台作业输出'}>
  <div className="execution-head"><h4>{isAgent?'子任务对话':'后台作业输出'}</h4><button className="text-button" onClick={onClose}>收起详情</button></div>
  {loadError&&runId&&<p className="workbench-error" role="alert">{loadError}</p>}
  {isAgent ? <>
   {transcript.length?<div className="execution-transcript">{transcript.map((row,index)=><article key={index}><strong>{row.role==='assistant'?'子任务':'交办输入'}</strong><p>{row.text}{row.truncated?'…':''}</p></article>)}</div>:<p className="settings-note">暂无对话内容。</p>}
   {!!runId&&<form onSubmit={send}><textarea aria-label="补充子任务" value={draft} maxLength={4000} onChange={event=>setDraft(event.target.value)} placeholder="给这个子任务补充要求"/><button className="secondary-button" disabled={sending||!draft.trim()}>{sending?'正在发送…':'发送补充'}</button></form>}
   {sendNotice&&<p className="settings-note" role="status">{sendNotice}</p>}
  </> : <>
   {(status||lossy)&&<p className="settings-note">{statusLabels[status]||'正在停止'}{lossy?' · 部分较早输出已超出保留范围':''}</p>}
   <pre ref={scroll}>{log||'暂无输出。'}</pre>
  </>}
 </section>;
}

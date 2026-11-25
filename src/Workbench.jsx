import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Archive,ArrowClockwise,ArrowLeft,ArrowRight,ArrowSquareOut,ArrowUp,ArrowsInSimple,ArrowsOutSimple,Camera,ChartBar,ChatCircle,CaretDown,CaretRight,CircleNotch,FileCode,FileText,Files,FolderOpen,Globe,MagnifyingGlass,Plus,SidebarSimple,Stop,TerminalWindow,X} from '@phosphor-icons/react';
import {IconButton} from './ui.jsx';
import {browserUrl} from '../electron/browser-policy.mjs';
import {FileCoverage} from './FileCoverage.jsx';
import {FileLayout,supportsLayout} from './FileLayout.jsx';
import {ExecutionPanel} from './ExecutionPanel.jsx';
import {AnswerText} from './AnswerText.jsx';
import {ReviewPanel} from './ReviewPanel.jsx';

const pages=[['browser','浏览器',Globe],['files','文件',FolderOpen],['terminal','终端',TerminalWindow],['chat','侧边聊天',ChatCircle],['activity','执行',CircleNotch],['review','改动',FileCode],['deliverables','产出',Files],['stats','统计',ChartBar],['details','详情',FileText]];
function ViewPicker({page,setPage}) {
 return <label className="resource-switcher" title="切换工作面板视图"><CaretDown size={12}/><select aria-label="工作面板视图" value={page} onChange={event=>setPage(event.target.value)}>{pages.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>;
}
export function Workbench({visible,suspended,onClose,page,setPage,context,scopeKey,scopeReady,scopeError,project,files,fileRequest,messages,chatTitle,liveTrace,liveRun,changes,changeDiffs,reviewPath,onReviewSelect,traceTruncated,statsContext,statsLive,attach,openProject,openDeliverable,mode,privacyMode,...sideProps}){
 const [wide,setWide]=useState(false);
 const [,label,PageIcon]=pages.find(([id])=>page===id)||pages[0];
 const panelProps=id=>({hidden:page!==id,'aria-label':pages.find(([key])=>id===key)[1]});
 const syncing=scopeError?<p className="workbench-error" role="alert">{scopeError}</p>:<p className="workbench-loading" role="status"><CircleNotch size={14}/>正在同步项目工作区…</p>;
 return <aside className={`workbench ${wide?'workbench-wide':''}`} hidden={!visible} aria-label="工作面板">
  <div className="workbench-controls" aria-label="工作面板工具">
   <IconButton icon={wide?ArrowsInSimple:ArrowsOutSimple} label={wide?'还原面板宽度':'加宽工作面板'} onClick={()=>setWide(value=>!value)}/><IconButton icon={SidebarSimple} label="收起工作面板" onClick={onClose}/>
  </div>
  {(page!=='browser'||!scopeReady)&&<div className="workbench-heading"><span className="workbench-heading-tab"><PageIcon size={15}/>{label}<ViewPicker page={page} setPage={setPage}/></span></div>}
  <section className="workbench-view" {...panelProps('browser')}>{scopeReady?<BrowserPanel context={context} scopeKey={scopeKey} shown={visible&&page==='browser'&&!suspended} attach={attach} openPanel={setPage} closePanel={onClose} viewPicker={page==='browser'?<ViewPicker page={page} setPage={setPage}/>:null}/>:syncing}</section>
  <section className="workbench-view" {...panelProps('files')}>{scopeReady?<WorkspaceFiles key={project?.directory} context={context} project={project} attach={attach} openProject={openProject} fileRequest={fileRequest}/>:syncing}</section>
  <section className="workbench-view" {...panelProps('terminal')}>{scopeReady?<TerminalPanel context={context} scopeKey={scopeKey} project={project} shown={visible&&page==='terminal'&&!suspended} openProject={openProject}/>:syncing}</section>
  <section className="workbench-view" {...panelProps('chat')}><SideChatPanel {...sideProps}/></section>
  <section className="workbench-view" {...panelProps('activity')}><ExecutionPanel key={context.sessionId} sessionId={context.sessionId} title={chatTitle} messages={messages} liveTrace={liveTrace} liveRun={liveRun} traceTruncated={traceTruncated} liveTeam={statsLive?statsContext?.team:null}/></section>
  <section className="workbench-view" {...panelProps('review')}><ReviewPanel files={changes} diffs={changeDiffs} selected={reviewPath} onSelect={onReviewSelect}/></section>
  <section className="workbench-view" {...panelProps('deliverables')}><DeliverablesPanel messages={messages} project={project} openDeliverable={openDeliverable}/></section>
  <section className="workbench-view" {...panelProps('stats')}><StatsPanel context={statsContext} live={statsLive}/></section>
  <section className="workbench-view workbench-details" {...panelProps('details')}><h3>交办详情</h3><dl><div><dt>工作模式</dt><dd>{mode==='government'?'政务':'办公'}</dd></div><div><dt>项目</dt><dd>{project?.name||'个人聊天'}</dd></div><div><dt>工作区</dt><dd>{project?.directory||'尚未关联'}</dd></div><div><dt>发送方式</dt><dd>{privacyMode==='raw'?'非脱敏模式':'自动脱敏'}</dd></div></dl><h3>已选资料 · {files.length}</h3>{files.map(file=><p key={file.id}><FileText size={15}/>{file.name}</p>)}{!files.length&&<p className="muted">从网页或文件面板添加资料。</p>}</section>
 </aside>;
}
function DeliverablesPanel({messages,project,openDeliverable}){
 const files=messages.flatMap((message,messageIndex)=>(message.deliverables||[]).map((file,fileIndex)=>({file,message,messageIndex,fileIndex}))).reverse();
 return <div className="deliverables-panel"><h3>本对话产出{files.length?` · ${files.length}`:''}</h3>{files.length?<div className="deliverables-list">{files.map(({file,message,messageIndex,fileIndex})=>{
  const name=String(file.path||'成果文件').split(/[\\/]/).at(-1);
  return <article className="deliverables-card" key={`${message.id||messageIndex}:${file.path||fileIndex}`}><span className="deliverables-icon"><FileText size={17}/></span><div className="deliverables-copy"><strong title={name}>{name}</strong><small>{file.description||'知行生成的文件'}</small><code title={file.path}>{file.path}</code></div><button type="button" className="secondary-button" disabled={!window.zhixing?.readDeliverable} onClick={()=>openDeliverable(file)}>打开</button></article>;
 })}</div>:<div className="deliverables-empty"><Files size={29} weight="light"/><strong>本对话还没有文件产出</strong><span>任务生成的文件会显示在这里。</span></div>}</div>;
}
function PanelEmpty({icon:Icon,title,children,action}){return <div className="workbench-empty"><Icon size={30} weight="light"/><h3>{title}</h3><p>{children}</p>{action}</div>;}
function BrowserPanel({context,scopeKey,shown,attach,openPanel,closePanel,viewPicker}){
 const api=window.zhixing,host=useRef(null),startInput=useRef(null),[state,setState]=useState({tabs:[],activeId:null,recent:[]}),[address,setAddress]=useState(''),[error,setError]=useState(''),[adding,setAdding]=useState(false);
 const [capturing,setCapturing]=useState(false),[savedImage,setSavedImage]=useState('');
 const active=state.tabs.find(tab=>tab.id===state.activeId);
 useEffect(()=>{if(!api)return;let live=true;api.browserState(context).then(value=>{if(live)setState(value);}).catch(error=>setError(error.message));const off=api.onBrowserChange(value=>{if(live&&value.scope===scopeKey)setState(value);});return()=>{live=false;off();};},[api,scopeKey]);
 useEffect(()=>{setAddress(active?.url||'');setError('');setSavedImage('');},[active?.id,active?.url]);
 useLayoutEffect(()=>{
  if(!api||!host.current)return;const update=()=>{const bounds=host.current.getBoundingClientRect();void api.browserLayout({...context,visible:shown&&!!active?.url&&!active.error,bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}}).catch(()=>{});};
  update();const observer=new ResizeObserver(update);observer.observe(host.current);window.addEventListener('resize',update);const layout=new MutationObserver(update);layout.observe(document.querySelector('.main-columns'),{attributes:true,subtree:false});
  return()=>{observer.disconnect();layout.disconnect();window.removeEventListener('resize',update);void api.browserLayout({...context,visible:false}).catch(()=>{});};
 },[api,scopeKey,shown,active?.id,active?.url,active?.error]);
 async function action(action,extra={}){setError('');try{
  if(!api){
   const target=extra.url?new URL(browserUrl(extra.url)):null;
   if(target?.origin===location.origin)throw new Error('请打开工作台以外的网页。');
   setState(old=>{
    if(action==='select')return {...old,activeId:extra.id};
    if(action==='close')return {...old,tabs:old.tabs.filter(tab=>tab.id!==extra.id),activeId:old.activeId===extra.id?old.tabs.find(tab=>tab.id!==extra.id)?.id||null:old.activeId};
    const recent=target?[{url:target.origin,host:target.host},...old.recent.filter(site=>site.url!==target.origin)].slice(0,4):old.recent;
    if(action==='new'){const tab={id:crypto.randomUUID(),url:target?.href||'',title:target?.host||'新标签页'};return {tabs:[...old.tabs,tab],activeId:tab.id,recent};}
    if(action==='navigate')return {...old,recent,tabs:old.tabs.map(tab=>tab.id===old.activeId?{...tab,url:target.href,title:target.host}:tab)};
    return old;
   });
   return;
  }
  setState(await api.browserAction({...context,action,id:active?.id,...extra}));
 }catch(cause){setError(cause.message);}}
 function openUrl(url){void action(active?'navigate':'new',{url});}
 function go(event){event.preventDefault();try{openUrl(browserUrl(address));}catch(cause){setError(cause.message);}}
 async function newTab(){await action('new');requestAnimationFrame(()=>startInput.current?.focus());}
 async function addPage(){setAdding(true);setError('');try{const file=await api.browserRead({...context,id:active.id});attach(file);}catch(cause){setError(cause.message);}finally{setAdding(false);}}
 async function capturePage(){
  setCapturing(true);setSavedImage('');setError('');
  try{const result=await api.browserCapture({...context,id:active.id});if(result.name)setSavedImage(`已保存 ${result.name}`);}
  catch(cause){setError(cause.message);}finally{setCapturing(false);}
 }
 return <>
  <div className="resource-tab-strip browser-tabs" aria-label="浏览器标签">
   {state.tabs.length?state.tabs.map(tab=><div key={tab.id} className={tab.id===state.activeId?'selected':''}><button title={tab.url||'新标签页'} aria-pressed={tab.id===state.activeId} onClick={()=>action('select',{id:tab.id})}><Globe size={14}/><span>{tab.title||'新标签页'}</span></button>{tab.id===state.activeId&&viewPicker}<IconButton icon={X} label={`关闭网页 ${tab.title}`} onClick={()=>action('close',{id:tab.id})}/></div>):<div className="selected"><button aria-pressed="true" onClick={()=>startInput.current?.focus()}><Globe size={14}/><span>新标签页</span></button>{viewPicker}<IconButton icon={X} label="关闭新标签页" onClick={closePanel}/></div>}
   <IconButton icon={Plus} label="新建浏览器标签" onClick={newTab}/>
  </div>
  {active?.url&&<form className="browser-toolbar" onSubmit={go}><IconButton icon={ArrowLeft} label="网页后退" disabled={!active.canGoBack} onClick={()=>action('back')}/><IconButton icon={ArrowRight} label="网页前进" disabled={!active.canGoForward} onClick={()=>action('forward')}/><IconButton icon={active.loading?X:ArrowClockwise} label={active.loading?'停止加载网页':'刷新网页'} disabled={!api} onClick={()=>action(active.loading?'stop':'reload')}/><input aria-label="网页地址" value={address} onChange={event=>setAddress(event.target.value)} autoComplete="off" spellCheck={false}/><button type="submit" className="browser-go" aria-label="打开网页"><ArrowRight size={16}/></button></form>}
  {!!(error||active?.error)&&<p role="alert" className="workbench-error">{error||active.error}</p>}
  {active?.url&&<div className="browser-document-actions"><span>{active.loading?'正在加载…':active.title||'网页'}</span>{savedImage&&<small role="status">{savedImage}</small>}<button disabled={!api||adding||active.loading||!!active.error} onClick={addPage}><Plus size={13}/>{adding?'正在读取…':'加入交办'}</button><IconButton icon={Camera} label="保存网页截图" disabled={!api||capturing||active.loading||!!active.error} onClick={capturePage}/><IconButton icon={ArrowSquareOut} label="用系统浏览器打开" disabled={!api} onClick={()=>api.browserExternal({...context,id:active.id}).catch(cause=>setError(cause.message))}/></div>}
  <div className="browser-viewport" ref={host}>
   {active?.url?(api?<div className="browser-native-placeholder">{active.error?'网页加载失败':active.loading?'正在打开网页…':''}</div>:<><iframe title="网页预览" src={active.url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer"/><p className="browser-preview-note">浏览器预览受网站嵌入策略限制；桌面版使用独立网页视图。</p></>):<div className="browser-start">
    <form onSubmit={go}><MagnifyingGlass size={16}/><input ref={startInput} className="browser-start-input" aria-label="新标签页网址" placeholder="输入网址或本机服务地址" value={address} autoComplete="off" spellCheck={false} onChange={event=>setAddress(event.target.value)}/>{address.trim()&&<button type="submit" aria-label="前往网址"><ArrowRight size={16}/></button>}</form>
    <h3>新建</h3>
    <div className="browser-start-actions"><button onClick={()=>openPanel('terminal')}><TerminalWindow size={18}/>终端</button><button onClick={newTab}><FileText size={18}/>新标签页</button><button onClick={()=>openPanel('files')}><FolderOpen size={18}/>文件</button><button onClick={()=>openPanel('chat')}><ChatCircle size={18}/>侧边聊天</button></div>
    {!!state.recent.length&&<><h3>本次打开的网站</h3><div className="browser-recent">{state.recent.map(site=><button key={site.url} title={site.host} onClick={()=>openUrl(site.url)}><span><Globe size={29}/></span><strong>{site.host}</strong></button>)}</div></>}
   </div>}
  </div>
 </>;
}
function SideChatPanel({sideChat,sideChatId,sideChats,sideDraft,sideFiles,onOpenUrl,onSideText,onSideSelect,onSideNew,onSideSubmit,sideRunning,sendDisabled,onStop}) {
 const transcript=useRef(null),nearBottom=useRef(true);
 const messages=sideChat?.messages||[];
 useLayoutEffect(()=>{if(transcript.current&&nearBottom.current)transcript.current.scrollTop=transcript.current.scrollHeight;},[sideChatId,messages.length,messages.at(-1)?.text,messages.at(-1)?.progressText]);
 useEffect(()=>{nearBottom.current=true;},[sideChatId]);
 const hasAttachments=sideFiles.length>0;
 function send(event) { event.preventDefault(); if(sideChatId&&(sideDraft.trim()||hasAttachments)&&!sendDisabled)onSideSubmit(); }
 return <div className="side-chat-panel">
  <div className="side-chat-toolbar"><select aria-label="选择侧边聊天" value={sideChatId||''} onChange={event=>onSideSelect(event.target.value)}><option value="" disabled>选择聊天</option>{sideChatId&&!sideChat&&<option value={sideChatId}>新聊天</option>}{sideChats.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><IconButton icon={Plus} label="新建侧边聊天" onClick={onSideNew}/></div>
  <div className="side-chat-transcript" aria-label="侧边聊天记录" ref={transcript} onScroll={()=>{const element=transcript.current;nearBottom.current=element.scrollHeight-element.scrollTop-element.clientHeight<72;}}>
   {messages.length?messages.map((message,index)=><article key={message.id||index} className={message.role==='user'?'side-chat-user':'side-chat-assistant'}><strong>{message.role==='user'?'你':'知行'}{message.stopped?' · 已停止':message.error?' · 未完成':''}</strong><AnswerText text={message.pending?message.progressText||'正在处理…':message.text} onOpenUrl={onOpenUrl}/>{message.errorMessage&&<p role="alert" className="workbench-error">{message.errorMessage}</p>}</article>):<div className="side-chat-empty"><ChatCircle size={28} weight="light"/><p>{sideChatId?'在这里开始一段独立聊天。':'选择已有聊天，或新建一段侧边聊天。'}</p>{!sideChatId&&<button type="button" className="secondary-button" onClick={onSideNew}>新建侧边聊天</button>}</div>}
  </div>
  {hasAttachments&&<div className="side-chat-attachments" aria-label="侧边聊天草稿附件">{sideFiles.map((file,index)=><span key={file.id||index} title={file.reason||file.name}><FileText size={13}/>{file.name}{file.status!=='ready'?' · 尚未就绪':''}</span>)}</div>}
  {sideChatId&&<form className="side-chat-composer" onSubmit={send}><textarea aria-label="侧边聊天输入框" rows={2} value={sideDraft} disabled={sendDisabled&&!sideRunning} placeholder="交代一件事…" onChange={event=>onSideText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&!event.isComposing){event.preventDefault();send(event);}}}/><IconButton icon={sideRunning?Stop:ArrowUp} label={sideRunning?'停止侧边聊天':'发送侧边聊天'} disabled={!sideRunning&&(sendDisabled||(!sideDraft.trim()&&!hasAttachments))} onClick={sideRunning?onStop:send}/></form>}
 </div>;
}
function WorkspaceFiles({context,project,attach,openProject,fileRequest}){
 const api=window.zhixing,[tree,setTree]=useState(null),[path,setPath]=useState(''),[preview,setPreview]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);const generation=useRef(0),scopeRef=useRef(''),watchTimer=useRef(null),loadRef=useRef(null),pathRef=useRef('');
 async function load(next=''){if(!api||!project?.directory)return;const token=++generation.current;setBusy(true);setError('');try{const result=await api.listWorkspaceFiles({...context,path:next});if(token===generation.current){setTree(result);setPath(next);setPreview(null);}}catch(cause){if(token===generation.current)setError(cause.message);}finally{if(token===generation.current)setBusy(false);}}
 loadRef.current=load;pathRef.current=path;
 useEffect(()=>{void load();return()=>{generation.current++;};},[project?.id,project?.directory]);
 useEffect(()=>{
  if(!api||!project?.directory)return;
  let live=true;const off=api.onWorkspaceFsChange(value=>{
   if(!live||value?.scope!==scopeRef.current)return;
   clearTimeout(watchTimer.current);
   watchTimer.current=setTimeout(()=>{if(live)void loadRef.current(pathRef.current);},300);
  });
  api.watchWorkspace({...context}).then(value=>{if(live)scopeRef.current=value?.scope||'';}).catch(()=>{});
  return()=>{live=false;off();clearTimeout(watchTimer.current);scopeRef.current='';void api.unwatchWorkspace({...context}).catch(()=>{});};
 },[api,project?.id,project?.directory]);
 useEffect(()=>{if(fileRequest&&api&&project?.directory)void open({path:fileRequest.path});},[fileRequest?.revision]);
 async function open(item){
  if(item.kind==='directory'){await load(item.path);return;}
  const token=++generation.current, name=item.name||item.path.split(/[\\/]/).at(-1);
  setBusy(true);setError('');
  try{
   const value=await api.readWorkspaceFile({...context,path:item.path});
   if(token===generation.current)setPreview({name,path:value.path,text:{...value,id:crypto.randomUUID(),status:'ready'}});
  }catch(cause){
   if(token!==generation.current)return;
   if(supportsLayout(name))setPreview({name,path:item.path,textError:cause.message.replace(/^Error invoking remote method '[^']+': Error: /,'')});
   else setError(cause.message);
  }finally{if(token===generation.current)setBusy(false);}
 }
 async function zipFolder(){
  setBusy(true);setError('');setNotice('');
  try{const result=await api.exportProjectZip({...context,path});if(result?.cancelled)return;setNotice(`已打包 ${result.entries} 个文件 → ${result.path}`);}
  catch(cause){setError(cause.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
  finally{setBusy(false);}
 }
 if(!project?.directory)return <PanelEmpty icon={FolderOpen} title="选择项目工作区" action={<button className="secondary-button" onClick={openProject}>{project?'项目设置':'新建项目'}</button>}>工作区在项目里选择，文件内容只在添加到交办后交给模型。</PanelEmpty>;
 if(!api)return <PanelEmpty icon={FolderOpen} title="本机文件在桌面版中浏览">当前项目已绑定工作区。请在 Windows 桌面版查看真实目录和文件。</PanelEmpty>;
 return <><div className="workspace-file-toolbar"><IconButton icon={ArrowLeft} label="返回上级文件夹" disabled={!path||busy} onClick={()=>load(path.split(/[\\/]/).slice(0,-1).join('/'))}/><span title={project.directory+(path?` / ${path}`:'')}>{path||project.name}</span><IconButton icon={ArrowClockwise} label="刷新工作区文件" disabled={busy} onClick={()=>load(path)}/><IconButton icon={ArrowSquareOut} label="在文件资源管理器中显示" onClick={()=>api.revealWorkspaceFile({...context,path}).catch(cause=>setError(cause.message))}/><IconButton icon={Archive} label="打包为 ZIP" disabled={busy||!tree} onClick={zipFolder}/></div>
 {error&&<p className="workbench-error" role="alert">{error}</p>}{notice&&<p className="workbench-note" role="status">{notice}</p>}{busy&&<p className="workbench-loading"><CircleNotch size={14}/>正在读取…</p>}
 {preview?<div className="file-preview" key={preview.path}>
  <div className="file-preview-heading"><IconButton icon={ArrowLeft} label="返回文件列表" onClick={()=>setPreview(null)}/><strong title={preview.name}>{preview.name}</strong>{preview.text&&<button className="secondary-button" onClick={()=>attach(preview.text)}><Plus size={13}/>将文字加入交办</button>}</div>
  {supportsLayout(preview.name)?<FileLayout context={context} file={preview} text={preview.text} textError={preview.textError} attach={attach}/>:<><FileCoverage file={preview.text}/><pre>{preview.text.text}</pre></>}
 </div>:<div className="workspace-file-list">{tree?.items.map(item=><button key={item.path} onClick={()=>open(item)}><span>{item.kind==='directory'?<FolderOpen size={17}/>:<FileText size={17}/>}</span><span>{item.name}</span>{item.kind==='directory'&&<CaretRight size={12}/>}</button>)}{tree&&!tree.items.length&&<p className="empty-note">这个文件夹里没有可显示的文件。</p>}{tree?.truncated&&<p className="empty-note">只显示前 600 项，请进入子文件夹查看。</p>}</div>}
 </>;
}
function TerminalPanel({context,scopeKey,project,shown,openProject}){
 const api=window.zhixing,[tabs,setTabs]=useState([]),[active,setActive]=useState(null),[shell,setShell]=useState('powershell'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!api||!project?.directory)return;let live=true;api.terminalAction({...context,action:'list'}).then(values=>{if(live){setTabs(values);setActive(values[0]?.id||null);}}).catch(cause=>{if(live)setError(cause.message);});const off=api.onTerminalEvent(value=>{if(value.event==='unavailable'){setTabs(old=>old.map(tab=>({...tab,status:'error'})));setError('终端服务已退出，请关闭旧标签后新建终端。');}else if(value.scope===scopeKey&&value.event==='status')setTabs(old=>old.map(tab=>tab.id===value.id?{...tab,...value}:tab));});return()=>{live=false;off();};},[api,scopeKey,project?.directory]);
 async function create(){setBusy(true);setError('');try{const value=await api.terminalAction({...context,action:'create',shell,cols:80,rows:26});setTabs(old=>[...old,value]);setActive(value.id);}catch(cause){setError(cause.message);}finally{setBusy(false);}}
 async function close(id){setBusy(true);setError('');try{await api.terminalAction({...context,action:'close',id});setTabs(old=>old.filter(tab=>tab.id!==id));if(active===id)setActive(tabs.find(tab=>tab.id!==id)?.id||null);}catch(cause){setError(cause.message);}finally{setBusy(false);}}
 if(!project?.directory)return <PanelEmpty icon={TerminalWindow} title="在项目中打开终端" action={<button className="secondary-button" onClick={openProject}>{project?'选择工作区':'新建项目'}</button>}>终端保持独立会话，输出不会自动进入模型上下文。</PanelEmpty>;
 return <><div className="resource-tab-strip">{tabs.map((tab,index)=><div className={tab.id===active?'selected':''} key={tab.id}><button onClick={()=>setActive(tab.id)}><TerminalWindow size={13}/><span>{tab.shell} {index+1}</span></button><IconButton icon={X} label={`关闭终端 ${index+1}`} disabled={busy} onClick={()=>close(tab.id)}/></div>)}<IconButton icon={Plus} label="新建终端" disabled={!api||busy} onClick={create}/></div>
  {error&&<p className="workbench-error" role="alert">{error}</p>}
  {!tabs.length?<PanelEmpty icon={TerminalWindow} title="交互终端" action={<div className="terminal-start"><select aria-label="选择终端 Shell" value={shell} onChange={event=>setShell(event.target.value)}><option value="powershell">Windows PowerShell</option><option value="pwsh">PowerShell 7</option><option value="cmd">命令提示符</option></select><button className="secondary-button" disabled={!api||busy} onClick={create}>{busy?'正在启动…':'打开终端'}</button></div>}>{api?'手动输入的命令使用当前 Windows 用户权限，独立于 Agent 的批准设置。':'交互终端仅在桌面版可用。'}</PanelEmpty>:tabs.map(tab=><div key={tab.id} hidden={tab.id!==active} className="terminal-tab-body"><XtermView context={context} terminalId={tab.id} shown={shown&&active===tab.id} onError={setError}/><div className="terminal-status"><span>{tab.cwd}</span><span>{tab.status==='running'?'运行中':tab.status==='error'?'连接中断':`已退出 ${tab.exitCode??''}`}</span></div></div>)}
 </>;
}
function XtermView({context,terminalId,shown,onError}){
 const host=useRef(null),instance=useRef(null),scope=useRef(context);scope.current=context;
 useEffect(()=>{let ended=false,terminal,fit,ready=false,sequence=0,queue=[],off;const api=window.zhixing;let writeTail=Promise.resolve();
  async function mount(){try{
   const [{Terminal},{FitAddon}]=await Promise.all([import('@xterm/xterm'),import('@xterm/addon-fit'),import('@xterm/xterm/css/xterm.css')]);if(ended)return;
   const dark=document.querySelector('.app-shell')?.classList.contains('dark');terminal=new Terminal({cursorBlink:true,fontFamily:'Cascadia Mono, Consolas, monospace',fontSize:12,scrollback:1200,theme:dark?{background:'#212121',foreground:'#ececec',cursor:'#ececec'}:{background:'#ffffff',foreground:'#1a1c1f',cursor:'#1a1c1f'}});fit=new FitAddon();terminal.loadAddon(fit);terminal.open(host.current);instance.current={terminal,fit};
   off=api.onTerminalEvent(value=>{if(value.id!==terminalId||value.event!=='data')return;if(!ready)queue.push(value);else if(value.sequence>sequence){sequence=value.sequence;terminal.write(value.data);}});
   const snapshot=await api.terminalAction({...scope.current,action:'snapshot',id:terminalId});if(ended)return;sequence=snapshot.sequence;terminal.write(snapshot.screen);ready=true;for(const value of queue)if(value.sequence>sequence){sequence=value.sequence;terminal.write(value.data);}queue=[];
   terminal.onData(data=>{writeTail=writeTail.then(()=>api.terminalAction({...scope.current,action:'write',id:terminalId,data})).catch(error=>onError(error.message));});
   terminal.onResize(({cols,rows})=>{void api.terminalAction({...scope.current,action:'resize',id:terminalId,cols,rows}).catch(error=>onError(error.message));});
   if(host.current.getBoundingClientRect().width>10)fit.fit();
  }catch(error){if(!ended)onError(error.message);}}
  void mount();const observer=new ResizeObserver(()=>{if(instance.current&&host.current?.getBoundingClientRect().width>10)try{instance.current.fit.fit();}catch{}});observer.observe(host.current);
  return()=>{ended=true;off?.();observer.disconnect();instance.current=null;terminal?.dispose();};
 },[terminalId]);
 useEffect(()=>{if(shown&&instance.current){instance.current.fit.fit();instance.current.terminal.focus();}},[shown]);
 return <div ref={host} className="xterm-host" aria-label="终端屏幕"/>;
}
function StatsPanel({context,live}){const stats=context?.stats;if(!stats)return <PanelEmpty icon={ChartBar} title="运行统计">完成一次交办后，显示内核记录的轮次、步骤和耗时。</PanelEmpty>;const seconds=value=>`${(value/1000).toFixed(2)} 秒`;return <div className="stats-panel"><h3>会话统计</h3><p className="muted">{live?'当前交办 · 随内核事件更新':'截至最近一次已完成交办'}</p><dl>{[['交互轮数',stats.turns],['模型步骤',stats.steps],['模型耗时',seconds(stats.llmMs)],['工具累计耗时',seconds(stats.toolMs)],['平均首字耗时',stats.ttftSteps?seconds(stats.ttftMs/stats.ttftSteps):'暂无数据'],['生成速度',stats.decodeMs?`${(stats.decodeTokens*1000/stats.decodeMs).toFixed(1)} token / 秒`:'暂无数据'],['当前上下文',`${context.measurement?.totalTokens?.toLocaleString()||0} tokens`]].map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><p className="settings-note">并行工具累计耗时可能超过任务总时长。未包含计费价格。</p></div>;}

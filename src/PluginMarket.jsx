import {useEffect,useState} from 'react';
import {MagnifyingGlass,Package,Plus,Trash} from '@phosphor-icons/react';
import {IconButton,Modal} from './ui.jsx';
import {PluginBuildApproval} from './PluginBuildApproval.jsx';
import { errorText } from './error-copy.js';

const installLabels={'not-installed':'可安装',installed:'已安装','update-available':'有更新','different-version':'已安装其他版本',provided:'随内核提供'};


export function PluginMarket(){
 const api=window.zhixing?.manageHarnessPlugins;
 const [sources,setSources]=useState([]);
 const [selected,setSelected]=useState('');
 const [newSource,setNewSource]=useState('');
 const [query,setQuery]=useState('');
 const [result,setResult]=useState(null);
 const [activeQuery,setActiveQuery]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const [detail,setDetail]=useState(null);
 const [version,setVersion]=useState('');
 const [buildApproval,setBuildApproval]=useState(null);
 useEffect(()=>{
  if(!api)return;
  let active=true;
  api({action:'market-list'}).then(items=>{if(active){setSources(items);setSelected(items[0]||'');}}).catch(cause=>{if(active)setError(errorText(cause));});
  return()=>{active=false;};
 },[api]);

 async function perform(operation){
  setBusy(true);
  setError('');
  setNotice('');
  try{await operation();}
  catch(cause){setError(errorText(cause));}
  finally{setBusy(false);}
 }
 async function changeSource(action,url){
  await perform(async()=>{
   const list=await api({action,url});
   setSources(list);
   setSelected(action==='market-add'?list.at(-1)||'':list[0]||'');
   setNewSource('');
   setResult(null);
  });
 }
 async function search(offset=0,term=query){
  await perform(async()=>{
   const page=await api({action:'market-search',url:selected,query:term,offset});
   setResult(offset?{...page,plugins:[...result.plugins,...page.plugins.filter(plugin=>!result.plugins.some(item=>item.name===plugin.name))]}:page);
   setActiveQuery(term);
  });
 }
 async function install(approvalId){
  setBuildApproval(null);
  await perform(async()=>{
   const source=detail.versions.find(item=>item.version===version);
   const value=await api(approvalId?{action:'confirm-builds',approvalId}:{action:'market-install',url:selected,name:detail.name,version,source:source.source});
   if(value.cancelled)return;
   if(value.approvalId){setBuildApproval(value);return;}
   if(['failed','cancelled','overridden'].includes(value.application)){
    if(value.buildScripts)throw new Error('安装需要额外的构建脚本批准。');
    throw new Error(value.error||'插件安装未完成。');
   }
   setNotice(`${detail.title} ${version} 已安装，可在插件页信任并启用。`);
   setDetail(null);
   setResult(null);
  });
 }
 const candidate=detail?.versions.find(item=>item.version===version);
 return <div className="connections-page market-page">
  <header className="connections-heading"><div><h1>插件市场</h1><p>从添加的 Harness 目录浏览并安装指定版本。</p></div></header>
  {api?<div className="settings-card market-sources">
   <form onSubmit={event=>{event.preventDefault();void changeSource('market-add',newSource);}}>
    <input aria-label="插件目录地址" type="url" placeholder="https://example.org/plugins.json" maxLength={1200} value={newSource} disabled={busy} onChange={event=>setNewSource(event.target.value)}/>
    <button className="secondary-button" disabled={busy||!newSource.trim()}><Plus size={15}/>添加目录</button>
   </form>
   {!!sources.length&&<form onSubmit={event=>{event.preventDefault();void search();}}>
    <select aria-label="已保存的插件目录" value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setResult(null);setNotice('');}}>
     {sources.map(url=><option key={url} value={url}>{url}</option>)}
    </select>
    <IconButton icon={Trash} label="移除目录" disabled={busy} onClick={()=>changeSource('market-remove',selected)}/>
    <input aria-label="搜索目录中的插件" placeholder="搜索名称或描述" value={query} maxLength={160} disabled={busy} onChange={event=>setQuery(event.target.value)}/>
    <button className="primary-button" disabled={busy||!selected}><MagnifyingGlass size={15}/>{busy?'正在读取…':'读取目录'}</button>
   </form>}
  </div>:<p className="empty-note">在 Windows 桌面版添加插件目录。</p>}
  {!detail&&error&&<p className="setting-notice bad" role="alert">{error}</p>}
  {notice&&<p className="setting-notice" role="status">{notice}</p>}
  {result&&<>
   <h3>{result.title||'目录'} · {result.total} 个插件</h3>
   <div className="connection-grid">{result.plugins.map(plugin=><button className="connection-card" key={plugin.name} disabled={busy} onClick={()=>{
    setError('');setBuildApproval(null);setDetail(plugin);setVersion(plugin.defaultVersion||plugin.versions[0]?.version||'');
   }}><span className="connection-icon"><Package size={20}/></span><span><strong>{plugin.title}</strong><small>{plugin.name} · {installLabels[plugin.installation.status]||''}</small></span></button>)}</div>
   {!result.plugins.length&&<p className="empty-note">目录没有匹配的插件。</p>}
   {result.nextOffset!=null&&<button className="secondary-button" disabled={busy} onClick={()=>search(result.nextOffset,activeQuery)}>加载更多</button>}
  </>}
  {detail&&<Modal title={detail.title} onClose={busy?()=>{}:()=>setDetail(null)}>
   <p className="muted">{detail.name}</p>
   {detail.description&&<p className="modal-copy">{detail.description}</p>}
   <label className="form-label">版本<select value={version} disabled={busy} onChange={event=>{setVersion(event.target.value);setBuildApproval(null);}}>
    {detail.versions.map(item=><option key={item.version} value={item.version}>{item.version}{item.compatible?'':' · 内核版本不兼容'}</option>)}
   </select></label>
   {candidate&&<p className="market-install-source"><strong>{candidate.kind==='git'?'Git 安装来源':'npm 仓库'}</strong><br/>{candidate.source}</p>}
   {error&&<p className="setting-notice bad" role="alert">{error}</p>}
   <PluginBuildApproval approval={buildApproval} busy={busy} onReview={install}/>
   <div className="form-actions">
    <button className="secondary-button" disabled={busy} onClick={()=>setDetail(null)}>返回</button>
    <button className="primary-button" disabled={busy||!candidate?.compatible||detail.installation.status==='provided'||(detail.installation.installedVersion&&!candidate.update)} onClick={()=>install()}>{candidate?.update?'下载更新':'安装此版本'}</button>
   </div>
  </Modal>}
 </div>;
}



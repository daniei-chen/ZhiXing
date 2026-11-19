import {useEffect,useState} from 'react';
import {Plus,Trash,Plugs,Check,X,PencilSimple} from '@phosphor-icons/react';
import {IconButton,Switch} from './ui.jsx';

export default function McpSettings(){
 const api=window.zhixing;
 const [servers,setServers]=useState([]),[draft,setDraft]=useState(null),[tools,setTools]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;api?.listMcp().then(value=>{if(live)setServers(value);}).catch(error=>{if(live)setNotice(error.message);});return()=>{live=false;};},[api]);
 async function save(next){if(busy)return;setBusy(true);setNotice('');try{setServers(await api.saveMcp(next));setDraft(null);setTools(null);setNotice('连接已保存，下次任务生效。');}catch(error){setNotice(error.message);}finally{setBusy(false);}}
 async function check(){setBusy(true);setNotice('');try{const result=await api.checkMcp();setTools(result.tools.filter(tool=>tool.name.startsWith('mcp__')));setNotice('MCP 连接和工具发现完成，没有调用模型。');}catch(error){setNotice(error.message);}finally{setBusy(false);}}
 return <>
  <p className="settings-lead">将本机或远程业务工具连接到知行。工具调用遵循权限设置；返回文本在脱敏模式下自动保护。</p>
  {!api&&<p className="callout">MCP 在 Windows 桌面版中配置与执行。</p>}
  <div className="settings-card">{servers.length?servers.map(server=><div className="setting-row" key={server.serverName}><span><strong><Plugs size={16}/> {server.serverName}</strong><small>{server.transport==='stdio'?server.command:server.url}</small><small>{server.envKeys?.length?`加密环境变量 ${server.envKeys.length} 项`:server.headerKeys?.length?`加密请求头 ${server.headerKeys.length} 项`:server.transport}</small></span><div className="mcp-row-actions"><Switch label={`启用 ${server.serverName}`} value={server.enabled} disabled={busy} onChange={enabled=>save(servers.map(item=>item.serverName===server.serverName?{...item,enabled}:item))}/><IconButton icon={PencilSimple} label={`编辑 MCP ${server.serverName}`} disabled={busy} onClick={()=>setDraft({...server,editing:true})}/><IconButton icon={Trash} label={`移除 MCP ${server.serverName}`} disabled={busy} onClick={()=>save(servers.filter(item=>item.serverName!==server.serverName))}/></div></div>):<p className="empty-note">还没有连接 MCP 服务</p>}</div>
  {draft?<McpForm key={draft.serverName} value={draft} onSave={value=>save(draft.editing?servers.map(item=>item.serverName===draft.serverName?value:item):[...servers,value])} close={()=>setDraft(null)} busy={busy}/>:<div className="form-actions"><button className="secondary-button" disabled={!api||busy||servers.length>=12} onClick={()=>setDraft({serverName:'',transport:'stdio'})}><Plus size={16}/>添加 MCP 服务</button><button className="secondary-button" disabled={!api||busy||!servers.some(server=>server.enabled)} onClick={check}>{busy?'正在连接…':'检查连接与工具'}</button></div>}
  {notice&&<p className="setting-notice" role="status">{notice}</p>}
  {tools&&<div className="mcp-tools"><h3>已发现工具 · {tools.length}</h3>{tools.map(tool=><details key={tool.name}><summary><Check size={14}/>{tool.name}</summary><p>{tool.description||'服务未提供说明'}</p></details>)}</div>}
  <p className="settings-note">只添加你信任的服务。本机 stdio 会启动所填程序，远程服务会收到工具参数。脱敏模式不向外部工具自动还原原值；需原文操作时，请明确切换发送方式。定时任务目前不加载 MCP。</p>
 </>;
}
function McpForm({value,onSave,close,busy}){
 const [form,setForm]=useState({command:'',cwd:'',url:'',...value,args:value.args?.join('\n')||'',secrets:''}),[error,setError]=useState('');
 const field=(key,value)=>setForm(old=>({...old,[key]:value}));
 function submit(event){event.preventDefault();try{const secrets=form.secrets.trim()?JSON.parse(form.secrets):undefined;onSave({serverName:form.serverName.trim(),transport:form.transport,enabled:form.enabled!==false,...(form.transport==='stdio'?{command:form.command.trim(),args:form.args.split('\n').filter(Boolean),cwd:form.cwd.trim(),...(secrets?{env:secrets}:{})}:{url:form.url.trim(),...(secrets?{headers:secrets}:{})})});}catch{setError('凭据请填写 JSON 对象，例如 {"Authorization":"Bearer …"}。');}}
 return <form className="mcp-form connection-form" onSubmit={submit}>
  <div className="mcp-form-heading"><h3>{value.editing?'编辑':'添加'} MCP 服务</h3><IconButton icon={X} label="取消编辑 MCP" onClick={close}/></div>
  <label className="form-label">服务名称<input aria-label="MCP 服务名称" value={form.serverName} disabled={value.editing} onChange={event=>field('serverName',event.target.value)} placeholder="例如，office-tools" pattern="[A-Za-z0-9_-]{1,32}" required/></label>
  <label className="form-label">连接方式<select value={form.transport} onChange={event=>field('transport',event.target.value)}><option value="stdio">本机程序 · stdio</option><option value="streamable-http">远程服务 · Streamable HTTP</option></select></label>
  {form.transport==='stdio'?<><label className="form-label">程序或绝对路径<input aria-label="MCP 程序" value={form.command} onChange={event=>field('command',event.target.value)} placeholder="例如 npx.cmd" required/></label><label className="form-label">启动参数 · 每行一项<textarea aria-label="MCP 启动参数" rows={3} value={form.args} onChange={event=>field('args',event.target.value)}/></label><label className="form-label">工作目录 · 可选<input value={form.cwd} onChange={event=>field('cwd',event.target.value)}/></label></>:<label className="form-label">服务地址<input aria-label="MCP 服务地址" type="url" value={form.url} onChange={event=>field('url',event.target.value)} placeholder="https://example.com/mcp" required/></label>}
  <label className="form-label">{form.transport==='stdio'?'环境变量':'请求头'} · JSON<textarea aria-label="MCP 凭据" className="mcp-secrets" rows={3} autoComplete="off" spellCheck={false} value={form.secrets} onChange={event=>field('secrets',event.target.value)}/></label>
  <p className="settings-note">凭据交给主进程加密保存，保存后不回显。留空保留原凭据；填写 {'{}'} 清空。</p>
  {error&&<p role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary-button" onClick={close}>取消</button><button className="primary-button" disabled={busy}>{busy?'正在保存…':'保存连接'}</button></div>
 </form>;
}

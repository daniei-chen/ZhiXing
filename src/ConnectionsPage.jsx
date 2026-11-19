import {useEffect,useState} from 'react';
import {ArrowClockwise,CaretDown,Check,Globe,MagnifyingGlass,Plugs,Plus,ShieldCheck,TerminalWindow} from '@phosphor-icons/react';
import {IconButton} from './ui.jsx';
import {HarnessPlugins} from './HarnessPlugins.jsx';
import {PluginMarket} from './PluginMarket.jsx';

export function ConnectionsPage({openModal, tab}) {
  if(tab==='mcp')return <McpConnections openModal={openModal}/>;
  if(tab==='market')return <PluginMarket/>;
  return <HarnessPlugins/>;
}

function McpConnections({openModal}) {
  const [servers,setServers]=useState([]),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh(){if(!window.zhixing)return;setBusy(true);setError('');try{setServers(await window.zhixing.listMcp());}catch{setError('工具连接读取失败。');}finally{setBusy(false);}}
  useEffect(()=>{void refresh();},[]);
  return <div className="connections-page"><header className="connections-heading"><div><h1>MCP 连接</h1><p>连接你的业务工具和资料来源。</p></div><div><label className="connections-search"><MagnifyingGlass size={15}/><input aria-label="搜索连接" placeholder="搜索连接" value={query} onChange={event=>setQuery(event.target.value)}/></label><IconButton icon={ArrowClockwise} label="刷新插件连接" disabled={busy||!window.zhixing} onClick={refresh}/><button className="primary-button" onClick={()=>openModal({type:'settings',tab:'MCP 连接'})}>添加<CaretDown size={12}/></button></div></header>
    <span className="catalog-scope">本机</span><h3>已配置的连接</h3>
    <div className="connection-grid">{servers.filter(server=>`${server.serverName} ${server.transport}`.toLowerCase().includes(query.toLowerCase())).map(server=><button className="connection-card" key={server.serverName} onClick={()=>openModal({type:'settings',tab:'MCP 连接'})}><span className="connection-icon"><Plugs size={23}/></span><span><strong>{server.serverName}</strong><small>MCP · {server.transport==='stdio'?'本机程序':'远程服务'}</small></span>{server.enabled?<Check size={16}/>:<span className="muted">暂停</span>}</button>)}</div>
    {!servers.length&&<div className="connections-empty"><Plugs size={24}/><div><strong>连接你的业务工具</strong><p>添加 MCP 服务后，将在这里和输入框的「添加」菜单中显示。</p></div><button className="secondary-button" onClick={()=>openModal({type:'settings',tab:'MCP 连接'})}><Plus size={14}/>添加连接</button></div>}
    {error&&<p role="status" className="setting-notice">{error}</p>}
    <h3>内置能力</h3><div className="connection-grid">{[['内置浏览器','网页检索、页面浏览与读取',Globe,'Agent 内核'],['交互终端','项目内运行命令与查看输出',TerminalWindow,'权限与工具'],['自动脱敏','请求保护、工具结果保护与本机还原',ShieldCheck,'隐私与数据']].filter(row=>`${row[0]} ${row[1]}`.includes(query)).map(([label,description,Icon,tab])=><button key={label} className="connection-card" onClick={()=>openModal({type:'settings',tab})}><span className="connection-icon"><Icon size={23}/></span><span><strong>{label}</strong><small>{description}</small></span><Check size={15}/></button>)}</div><p className="settings-note">连接依赖各自的服务、凭据和权限。本页显示实际配置；不会将第三方账号显示为已连接。</p>
  </div>;
}

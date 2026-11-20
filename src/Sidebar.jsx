import { useId, useState } from 'react';
import { Archive, BellSimple, Briefcase, Buildings, CaretDown, CaretRight, Check, CircleNotch, Clock, DotsThree, FileText, FolderOpen, FunnelSimple, GearSix, GitBranch, House, MagnifyingGlass, Minus, NotePencil, PencilSimple, Plugs, Plus, PushPin, SidebarSimple, Square, SquaresFour, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { BrandMark, IconButton, MenuItem } from './ui.jsx';

export function Titlebar({ desktop, sidebarOpen, setSidebar, workspace, settingsMode = false }) {
  return <header className="titlebar">
    {!settingsMode && <IconButton icon={SidebarSimple} label={sidebarOpen ? '收起侧栏' : '展开侧栏'} aria-expanded={sidebarOpen} onClick={() => setSidebar(open => !open)}/>}
    <span className="window-brand"><BrandMark className="brand-titlebar"/>知行</span><span className="window-divider"/><span className="window-name">{workspace.name}</span>
    <div className="titlebar-drag"/>
    {desktop ? <div className="window-actions">
      <button aria-label="最小化窗口" onClick={() => desktop.windowControl('minimize')}><Minus size={14}/></button>
      <button aria-label="最大化或还原" onClick={() => desktop.windowControl('maximize')}><Square size={11}/></button>
      <button aria-label="关闭窗口" onClick={() => desktop.windowControl('close')}><X size={15}/></button>
    </div> : <span className="window-preview">浏览器预览</span>}
  </header>;
}

const navItems = [
  ['files', '资料空间', FolderOpen],
  ['automations', '定时任务', Clock],
  ['skills', '自定义', SquaresFour],
];

export function AppRail({section,navigate,openModal,settings=false}) {
  return <nav className="app-rail" aria-label="应用导航"><div>{[['home','首页',House],...navItems].map(([id,label,Icon])=><button type="button" key={id} title={label} aria-label={label} aria-current={!settings&&(section===id||(id==='home'&&section==='project'))?'page':undefined} onClick={()=>navigate(id)}><Icon size={19} weight={!settings&&(section===id||(id==='home'&&section==='project'))?'fill':'regular'}/></button>)}</div><div className="rail-bottom"><button type="button" title="设置" aria-label="打开设置" aria-current={settings?'page':undefined} onClick={()=>openModal({type:'settings'})}><GearSix size={20}/></button><button type="button" title="关于知行" aria-label="关于知行" onClick={()=>openModal({type:'settings',tab:'关于知行'})}><BrandMark className="brand-rail"/></button></div></nav>;
}

export function WorkspaceIcon({ type, size = 18 }) {
  return type === 'government' ? <Buildings size={size}/> : <Briefcase size={size}/>;
}

export function Sidebar({ state, workspace, projects, chats, activeChat, activeProject, runningChatId, section, newChat, openChat, selectProject, navigate, changeWorkspace, updateChat, expandProject, menu, toggleMenu, closeMenu, openModal, unread, automations=[],documents=[],chooseFiles,customTab,setCustomTab }) {
  const [showRecent, setShowRecent] = useState(true);
  const [chatFilter, setChatFilter] = useState('all');
  const recentId = useId();
  const pinned = chats.filter(chat => chat.pinned);
  const recent = chats.filter(chat => !chat.pinned);
  const visibleRecent = recent.filter(chat => chatFilter === 'project' ? !!chat.projectId : chatFilter === 'running' ? runningChatId === chat.id : true);

  function chatRow(chat, group) {
    const id = `chat-${group}-${chat.id}`;
    const running = runningChatId === chat.id;
    return <div className={`chat-row ${activeChat === chat.id ? 'selected' : ''}`} key={chat.id}>
      <button className="chat-link" title={chat.title} aria-current={activeChat === chat.id ? 'page' : undefined} onClick={() => openChat(chat.id)}>{chat.pinned && <PushPin size={13}/>}<span>{chat.title}</span></button>
      {running && <span className="sidebar-chat-running" role="status" aria-label="正在运行" title="正在运行"><CircleNotch size={13}/></span>}
      <div className="menu-anchor"><IconButton icon={DotsThree} label={`${chat.title} 的菜单`} aria-expanded={menu?.name === id} className="row-more" onClick={event => toggleMenu(id, event)}/>
        {menu?.name === id && <div className="dropdown row-dropdown">
          <MenuItem icon={PushPin} onClick={() => updateChat(chat.id, { pinned: !chat.pinned })}>{chat.pinned ? '取消置顶' : '置顶'}</MenuItem>
          <MenuItem icon={PencilSimple} onClick={() => openModal({ type: 'rename-chat', id: chat.id, value: chat.title })}>重命名</MenuItem>
          <MenuItem icon={Archive} onClick={() => updateChat(chat.id, { archived: true })}>归档</MenuItem>
          <MenuItem icon={Trash} danger onClick={() => openModal({ type: 'delete-chat', id: chat.id, name: chat.title })}>删除聊天</MenuItem>
        </div>}
      </div>
    </div>;
  }

  const home=section==='home'||section==='project';
  return <aside className="sidebar" aria-label="工作台侧栏"><AppRail section={section} navigate={navigate} openModal={openModal}/><div className="sidebar-main">
    {home?<>
    <div className="menu-anchor workspace-anchor">
      <button className="mode-trigger" aria-label={`切换工作模式，当前${workspace.type==='government'?'政务':'办公'}`} aria-expanded={menu?.name === 'workspaces'} onClick={event => toggleMenu('workspaces', event)}>
        <strong>{workspace.type==='government'?'政务':'办公'}</strong><CaretDown size={13}/>
      </button>
      {menu?.name === 'workspaces' && <div className="dropdown mode-dropdown" role="menu" aria-label="工作模式">
        {[['office','办公','文稿、会议、表格与日常协作'],['government','政务','来文、拟办、督办与汇报材料']].map(([type,label,description])=><button type="button" className="mode-option" role="menuitemradio" aria-checked={workspace.type===type} key={type} onClick={()=>{const target=state.workspaces.find(space=>space.type===type);if(target)changeWorkspace(target.id);closeMenu();}}><WorkspaceIcon type={type} size={20}/><span><strong>{label}</strong><small>{description}</small></span>{workspace.type===type&&<Check size={15}/>}</button>)}
      </div>}
      <div className="sidebar-heading-actions"><IconButton icon={BellSimple} label="任务活动" className={unread?'has-unread':''} onClick={()=>openModal({type:'notifications'})}/><div className="menu-anchor"><IconButton icon={FunnelSimple} label="筛选最近聊天" aria-expanded={menu?.name==='chat-filter'} onClick={event=>toggleMenu('chat-filter',event)}/>{menu?.name==='chat-filter'&&<div className="dropdown chat-filter-dropdown" role="menu" aria-label="最近聊天筛选">{[['all','全部聊天'],['project','项目聊天'],['running','正在运行']].map(([id,label])=><button type="button" role="menuitemradio" aria-checked={chatFilter===id} className="menu-item" key={id} onClick={()=>{setChatFilter(id);closeMenu();}}><span>{label}</span>{chatFilter===id&&<Check size={15}/>}</button>)}</div>}</div><IconButton icon={MagnifyingGlass} label="搜索聊天" onClick={()=>openModal({type:'search'})}/></div>
    </div>

    <nav className="workspace-nav chat-navigation" aria-label="工作台导航">
      <button className="new-chat" onClick={() => newChat()}><NotePencil size={16}/><span>新聊天</span></button>
      {window.zhixing&&<IconButton icon={UploadSimple} className="import-chat" label="导入 DeepSeek 聊天" onClick={()=>openModal({type:'import-deepseek'})}/>}
    </nav>

    <div className="sidebar-scroll">
      {!!pinned.length && <div className="pinned-chats" role="group" aria-label="置顶聊天">{pinned.map(chat => chatRow(chat,'pinned'))}</div>}
      <div className="sidebar-projects">
        <div className="section-label"><span>项目</span><IconButton icon={Plus} label="新建项目" onClick={() => openModal({ type: 'new-project' })}/></div>
        {projects.map(project => {
          const id = `project-${project.id}`, children = chats.filter(chat => chat.projectId === project.id);
          return <div className="project-group" key={project.id}>
            <div className={`project-row ${section === 'project' && activeProject?.id === project.id ? 'selected' : ''}`}>
              <button className="project-expand" aria-label={`${project.expanded ? '收起' : '展开'} ${project.name}`} aria-expanded={project.expanded} onClick={() => expandProject(project.id)}><CaretRight size={11}/></button>
              <button className="project-name" onClick={() => selectProject(project.id)}>{project.worktree?<GitBranch size={17}/>:<FolderOpen size={17}/>}<span>{project.name}</span></button>
              <div className="menu-anchor"><IconButton icon={DotsThree} label={`${project.name} 的项目菜单`} className="row-more" aria-expanded={menu?.name === id} onClick={event => toggleMenu(id, event)}/>
                {menu?.name === id && <div className="dropdown row-dropdown">
                  <MenuItem icon={NotePencil} onClick={() => newChat(project.id)}>在项目中聊天</MenuItem>
                  <MenuItem icon={PencilSimple} onClick={() => openModal({ type: 'rename-project', id: project.id, value: project.name })}>重命名</MenuItem>
                  <MenuItem icon={GearSix} onClick={() => openModal({ type: 'project-settings', value: project })}>项目设置</MenuItem>
                  {window.zhixing?.worktree&&project.directory&&<MenuItem icon={GitBranch} onClick={()=>openModal({type:'project-worktree',value:project})}>{project.worktree?'恢复缺失的工作树':'新建 Git 工作树'}</MenuItem>}
                  <MenuItem icon={Trash} danger onClick={() => openModal({ type: 'delete-project', id: project.id, name: project.name })}>删除项目</MenuItem>
                </div>}
              </div>
            </div>
            {project.expanded && children.length > 0 && <div className="project-chats">{children.map(chat => chatRow(chat,'project'))}</div>}
          </div>;
        })}
      </div>
      <div className="section-label"><button type="button" className="sidebar-section-toggle" aria-expanded={showRecent} aria-controls={recentId} onClick={() => { setShowRecent(value => !value); closeMenu(); }}><span>最近聊天</span><CaretRight size={11}/></button><IconButton icon={Archive} label="已归档聊天" onClick={() => openModal({ type: 'archive' })}/></div>
      <div id={recentId} hidden={!showRecent}>{visibleRecent.length ? visibleRecent.map(chat => chatRow(chat,'recent')) : <p className="sidebar-empty">{recent.length ? '没有符合条件的聊天' : chats.length ? '没有其他聊天' : '还没有聊天'}</p>}</div>
    </div>

    </>:<><header className="utility-sidebar-heading"><h2>{section==='files'?'资料空间':section==='automations'?'定时任务':'自定义'}</h2><IconButton icon={MagnifyingGlass} label="搜索" onClick={()=>openModal({type:'search'})}/></header><nav className="workspace-nav" aria-label="当前页面导航">{section==='automations'?<button onClick={()=>openModal({type:'automation'})}><Plus size={16}/><span>新建任务</span></button>:section==='files'?<button onClick={()=>chooseFiles('library')}><Plus size={16}/><span>添加资料</span></button>:<>{[['plugins','插件',Plugs],['market','插件市场',SquaresFour],['mcp','MCP 连接',Plugs],['skills','技能',SquaresFour]].map(([id,label,Icon])=><button key={id} aria-current={customTab===id?'page':undefined} onClick={()=>setCustomTab(id)}><Icon size={16}/><span>{label}</span></button>)}</>}</nav><div className="sidebar-scroll">{section==='automations'?(automations.length?automations.map(task=><button className="sidebar-resource-link" key={task.id} onClick={()=>openModal({type:'automation',id:task.id,value:task})}><Clock size={15}/><span>{task.name}</span></button>):<p className="sidebar-empty">没有已安排的任务</p>):section==='files'?(documents.length?documents.map(file=><button className="sidebar-resource-link" key={file.id} onClick={()=>openModal({type:'document',value:file})}><FileText size={15}/><span>{file.name}</span></button>):<p className="sidebar-empty">还没有工作资料</p>):<><p className="section-label">工作方式</p><button className="sidebar-resource-link" onClick={()=>openModal({type:'settings',tab:'Agent 内核'})}><GearSix size={15}/><span>DeepSeek Harness</span></button></>}</div></>}
    </div>
  </aside>;
}

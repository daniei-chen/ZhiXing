import { useEffect, useState } from 'react';
import { ArrowUpRight, CalendarBlank, CheckCircle, Clock, ClockCounterClockwise, FileText, FolderOpen, MagnifyingGlass, NotePencil, Play, Plus, ShieldCheck, Stop, Trash } from '@phosphor-icons/react';
import { IconButton, Switch } from './ui.jsx';
import { workflows } from './office-workflows.js';
import { scheduleLabel } from './scheduler.js';
import { taskRunStatusLabels } from './AutomationDialog.jsx';
import {fileReadLabel} from './FileCoverage.jsx';
import {ConnectionsPage} from './ConnectionsPage.jsx';

const taskTemplates = {
  office: [
    ['周报准备', '收齐周报材料，核对本周进度及下周安排。', '每周'],
    ['月度台账复核', '核对本月台账、缺项和交付日期。', '每月'],
    ['年度归档', '核对年度总结、归档材料和交接清单。', '每年'],
  ],
  government: [
    ['来文办理检查', '复核收文登记、承办单位与办理时限。', '每天'],
    ['周度督办', '核对本周督办事项的进展、回执和待核实问题。', '每周'],
    ['年度归档交接', '核对归档目录、办理材料和交接清单。', '每年'],
  ],
};

const customization = [['plugins', '插件'], ['market', '插件市场'], ['mcp', 'MCP 连接'], ['skills', '技能']];

export function UtilityPage({ section, scope, chooseFiles, attach, toggleTask, runTask,taskAction, openRun, openModal, openChat, useTemplate, events, customTab,setCustomTab,sidebarOpen }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState('plans');
  const [nativeSkills,setNativeSkills]=useState(null),[skillsError,setSkillsError]=useState('');
  const isFiles = section === 'files';
  const isTasks = section === 'automations';
  const isCustom = !isFiles && !isTasks;
  const title = isFiles ? '资料空间' : isTasks ? '定时任务' : customization.find(([id]) => id === customTab)?.[1] || '插件';
  const matches = value => value.toLowerCase().includes(query.trim().toLowerCase());
  useEffect(()=>{if(!isCustom||customTab!=='skills'||!window.zhixing)return;let live=true;setNativeSkills(null);setSkillsError('');window.zhixing.listSkills({workspaceId:scope.workspace.id,projectId:scope.project?.id||null}).then(value=>{if(live)setNativeSkills(value);}).catch(error=>{if(live)setSkillsError(error.message);});return()=>{live=false;};},[isCustom,customTab,scope.workspace.id,scope.project?.id]);

  return <section className={`utility-page ${isCustom?'custom-utility':''} ${isTasks&&!scope.automations.length&&tab==='plans'?'tasks-empty':''}`} aria-label={title}>
    <div className="utility-inner">
      {isCustom && !sidebarOpen && <div className="task-page-tabs" role="tablist" aria-label="自定义内容">{customization.map(([id,label])=><button type="button" key={id} role="tab" aria-selected={customTab===id} onClick={()=>setCustomTab(id)}>{label}</button>)}</div>}
      {(!isCustom || customTab==='skills') && <header className="page-heading"><div>{!isCustom&&<span className="page-context">{scope.workspace.name}</span>}<h1>{title}</h1></div>
        {isFiles && <button className="primary-button" onClick={() => chooseFiles('library')}><Plus size={17}/>添加资料</button>}
        {isTasks && <button className="primary-button" onClick={() => openModal({ type: 'automation' })}><Plus size={17}/>新建任务</button>}
      </header>}

      {isTasks && <div className="task-page-tabs" role="tablist" aria-label="自动化视图"><button role="tab" aria-selected={tab === 'plans'} onClick={() => setTab('plans')}>计划 <small>{scope.automations.length}</small></button><button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>执行记录 <small>{scope.taskRuns.length}</small></button></div>}
      {(isFiles || (isTasks && tab === 'plans')) && <div className="page-controls">
        <label className="search-field"><MagnifyingGlass size={17}/><input aria-label={isFiles ? '搜索资料' : '搜索任务'} value={query} onChange={event => setQuery(event.target.value)} placeholder={isFiles ? '搜索资料' : '搜索任务'}/></label>
        {isTasks && <select aria-label="筛选任务状态" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部任务</option><option value="enabled">已启用</option><option value="paused">已暂停</option></select>}
      </div>}

      {isFiles && <>
        {scope.documents.filter(file => matches(file.name)).length ? <div className="file-list">
          {scope.documents.filter(file => matches(file.name)).map(file => <article key={file.id} className="resource-row">
            <span className="resource-icon"><FileText size={20}/></span><button className="resource-name" onClick={() => openModal({ type: 'document', value: file })}><strong>{file.name}</strong><small>{fileReadLabel(file)} · {(file.size / 1024).toFixed(1)} KB</small></button>
            <button className="secondary-button" disabled={file.status !== 'ready'} onClick={() => attach(file)}>添加到交办</button>
            <IconButton icon={Trash} label={`移除资料 ${file.name}`} onClick={() => openModal({ type: 'remove-document', value: file })}/>
          </article>)}
        </div> : <div className="page-empty"><FolderOpen size={37} weight="light"/><h2>{query ? '没有匹配的资料' : '添加本机工作资料'}</h2><p>{query ? '试试另一个文件名。' : '本机提取 Office、PDF 和图片里的文字。'}</p>{!query && <button className="secondary-button" onClick={() => chooseFiles('library')}>选择文件</button>}</div>}
      </>}

      {isTasks && <>
        {!scope.automations.length&&tab==='plans'&&!query&&<div className="schedule-welcome"><Clock size={45} weight="duotone"/><h2>安排任务</h2><p>把需要持续跟进的工作交给知行。</p></div>}
        <p className="muted task-lead">{window.zhixing ? '桌面主进程调度 · 本机时间 · 退出后停止，重开补执行一次' : '浏览器只保存草稿；在桌面端审阅后启用执行。'}</p>
        {tab === 'plans' ? <>
        <div className="task-list">{scope.automations.filter(task => matches(task.name) && (filter === 'all' || task.enabled === (filter === 'enabled'))).map(task => {
          const live = task.status === '运行中';
          return <article className="resource-row task-row" key={task.id}>
            <span className="resource-icon"><Clock size={20}/></span><div className="resource-name"><strong>{task.name}</strong><small>{task.kind === 'reminder' ? '本机提醒' : 'AI 任务'} · {scheduleLabel(task)} · {task.status || '待执行'}</small>{task.enabled && task.nextRun && <small>下次 · {new Date(task.nextRun).toLocaleString('zh-CN')}</small>}{!!task.documentIds?.length && <small>已关联 {task.documentIds.length} 份工作资料</small>}</div>
            <div className="task-actions">
              {task.resultChatId && scope.chats.some(chat => chat.id === task.resultChatId) && <button className="text-button" onClick={() => openChat(task.resultChatId)}>查看结果</button>}
              <IconButton icon={ClockCounterClockwise} label={`执行记录 ${task.name}`} onClick={() => openModal({ type: 'task-history', value: task })}/>
              {live ? <IconButton icon={Stop} label={`停止运行 ${task.name}`} onClick={() => taskAction(() => window.zhixing.cancelAutomation(task.id))}/> : <IconButton icon={Play} label={`立即运行 ${task.name}`} onClick={() => runTask(task)}/>}
              <IconButton icon={NotePencil} disabled={live} label={`编辑 ${task.name}`} onClick={() => openModal({ type: 'automation', id: task.id, value: task })}/>
              <IconButton icon={Trash} disabled={live} label={`删除 ${task.name}`} onClick={() => openModal({ type: 'delete-task', value: task })}/>
              <Switch label={`启用 ${task.name}`} value={!!task.enabled} onChange={value => toggleTask(task, value)}/>
            </div>
          </article>;
        })}</div>
        {(query || filter !== 'all') && !scope.automations.some(task => matches(task.name) && (filter === 'all' || task.enabled === (filter === 'enabled'))) && <p className="empty-note">没有匹配的任务。</p>}
        {!query && filter === 'all' && <div className="task-templates"><h2>从模板开始</h2><div className="utility-cards">{taskTemplates[scope.mode].map(([name, description, frequency]) => <button key={name} onClick={() => openModal({ type: 'automation', value: { name, description, frequency, time: '09:00', kind: 'agent' } })}><CalendarBlank size={23}/><span><strong>{name}</strong><small>{description}</small></span><ArrowUpRight size={15}/></button>)}</div></div>}
        </> : <div className="execution-list">{scope.taskRuns.length ? scope.taskRuns.slice().reverse().map(run => <article key={run.id} className="resource-row"><span className="resource-icon"><ClockCounterClockwise size={20}/></span><div className="resource-name"><strong>{run.name}</strong><small>{new Date(run.startedAt).toLocaleString('zh-CN')} · {run.manual ? '手动运行' : '计划触发'} · {taskRunStatusLabels[run.status] || run.status}</small><small>{run.message || '正在执行…'}</small></div>{run.result && <button className="secondary-button" onClick={() => openRun(run)}>打开结果</button>}<IconButton icon={ClockCounterClockwise} label={`查看 ${run.name} 的执行记录`} onClick={() => openModal({ type: 'task-history', value: { id: run.taskId, name: run.name } })}/></article>) : <div className="page-empty"><ClockCounterClockwise size={34}/><h2>每次执行都有记录</h2><p>手动运行或计划到时后，在这里查看进度和结果。</p></div>}</div>}
      </>}

      {isCustom && <>{customTab!=='skills'?<ConnectionsPage openModal={openModal} tab={customTab}/>:<>
        <h2 className="recent-runs-title">Harness 技能库</h2>{nativeSkills?<div className="native-skill-list">{nativeSkills.filter(skill=>!skill.name.startsWith('zhixing-')).map(skill=><button key={skill.name} onClick={()=>useTemplate(`/${skill.name}\n`)}><FileText size={18}/><span><strong>{skill.name}</strong><small>{skill.description}</small></span><ArrowUpRight size={14}/></button>)}</div>:<p className="empty-note">{skillsError|| (window.zhixing?'正在读取内核技能目录…':'原生技能目录在桌面版中读取。')}</p>}
        <h2 className="recent-runs-title">知行办公流程</h2>
        <div className="utility-cards">{workflows[scope.mode].map(([label, prompt],index) => <button key={label} onClick={() => useTemplate(`/zhixing-${scope.mode}-${index+1}\n${prompt}`)}><FileText size={21}/><span><strong>{label}</strong><small>Harness 原生技能</small></span><ArrowUpRight size={15}/></button>)}</div>
        <div className="settings-shortcuts"><button className="secondary-button" onClick={() => openModal({ type: 'settings', tab: '隐私与数据' })}><ShieldCheck size={16}/>发送方式与词表</button><button className="secondary-button" onClick={() => openModal({ type: 'settings', tab: '供应商' })}>供应商</button></div>
        <h2 className="recent-runs-title">最近运行</h2>
        {events.length ? <div className="record-list">{events.slice(-12).reverse().map((event, index) => <article key={`${event.runId}-${index}`}><CheckCircle size={16}/><span>{event.label}<small>{new Date(event.time).toLocaleTimeString('zh-CN')}</small></span>{scope.chats.some(chat => chat.id === event.sessionId) && <button className="text-button" onClick={() => openChat(event.sessionId)}>查看聊天</button>}</article>)}</div> : <p className="empty-note">此空间暂无本次打开后的运行记录。</p>}
      </>}</>}
    </div>
  </section>;
}

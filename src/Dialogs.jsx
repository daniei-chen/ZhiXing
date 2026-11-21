import { useState } from 'react';
import { Archive, ArrowRight, ChatsCircle, Clock, FileText, FolderOpen, MagnifyingGlass, X } from '@phosphor-icons/react';
import { Modal } from './ui.jsx';
import { Settings, WorkspaceEditor } from './Settings.jsx';
import { AutomationDialog } from './AutomationDialog.jsx';
import { workflows } from './office-workflows.js';
import { taskRunStatusLabels } from './AutomationDialog.jsx';
import {FileCoverage} from './FileCoverage.jsx';

export function Dialogs(props) {
  const { modal, setModal, state, setState, scope, openChat, updateChat, createProject, updateProject, saveWorkspace, attach, useTemplate, removeItem, setSetting, markRead } = props;
  const close = () => setModal(null);
  const [value, setValue] = useState(typeof modal.value === 'string' ? modal.value : modal.value?.name || '');
  const [instructions, setInstructions] = useState(modal.value?.instructions || '');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [directory,setDirectory]=useState(modal.value?.directory||null);
  const [choosing,setChoosing]=useState(false);
  async function chooseDirectory(){if(!window.zhixing||choosing)return;setChoosing(true);setError('');try{const folder=await window.zhixing.chooseWorkspaceFolder();if(folder)setDirectory(folder);}catch(cause){setError(cause.message);}finally{setChoosing(false);}}

  if (modal.type === 'settings') return <Settings {...props} close={close}/>;
  if (['new-workspace','edit-workspace'].includes(modal.type)) return <WorkspaceEditor item={modal.value} close={close} onSave={saveWorkspace}/>;
  if (['automation','enable-task','run-task','delete-task','task-history'].includes(modal.type)) return <AutomationDialog {...props} close={close}/>;
  if (modal.type === 'import-deepseek') return <ImportDeepSeek scope={scope} close={close} onImport={props.importDeepSeek}/>;
  if(modal.type==='project-worktree')return <ProjectWorktree project={modal.value} close={close} createProject={createProject} notify={props.notify}/>;
  if (modal.type === 'full-access') return <Modal title="允许完全访问？" onClose={close}><p className="modal-copy">文件、PowerShell、网页和已配置的 MCP 工具将无需逐项批准。终端命令可以读写项目外文件、使用网络和调用本机程序；MCP 可能对外部业务系统执行操作，请仅在信任任务与服务时启用。</p><p className="settings-note">脱敏继续保护模型请求。终端是实际本机执行，不能保证限制在项目目录内。</p><div className="form-actions"><button className="secondary-button" onClick={close}>取消</button><button className="primary-button" onClick={() => { setSetting('permission','full'); close(); }}>启用完全访问</button></div></Modal>;

  const titles = {
    search: '搜索聊天', 'new-project': '新建项目', 'rename-project': '重命名项目', 'project-settings': '项目设置',
    'rename-chat': '重命名聊天', 'delete-chat': '删除聊天', 'delete-project': '删除项目', archive: '已归档聊天',
    notifications: '任务活动', templates: '办公模板', shortcuts: '键盘快捷键', 'attach-library': '选择工作资料',
    document: modal.value?.name || '资料预览', 'remove-document': '移除资料', 'disable-history': '关闭本地保存',
    'orphan-drafts': '处理旧草稿',
  };
  const naming = ['new-project','rename-project','project-settings','rename-chat'].includes(modal.type);
  const deleting = ['delete-chat','delete-project'].includes(modal.type);
  const find = text => text.toLowerCase().includes(query.trim().toLowerCase());
  const found = modal.type === 'search' ? scope.chats.filter(chat => find(`${chat.title} ${chat.messages.map(message => message.text).join(' ')}`)) : [];

  function saveName(event) {
    event.preventDefault();
    const name = value.trim();
    if (!name) return;
    if (modal.type === 'new-project') createProject(name, instructions.trim(),directory);
    else if (modal.type === 'rename-chat') updateChat(modal.id, { title: name });
    else {
      const id = modal.id || modal.value?.id;
      updateProject(id, { name, ...(modal.type === 'project-settings' ? { instructions: instructions.trim(),directory } : {}) });
    }
    close();
  }

  return <Modal title={titles[modal.type] || '知行'} onClose={close} className={modal.type === 'search' ? 'search-modal' : ''}>
    {modal.type === 'search' && <>
      <div className="search-field"><MagnifyingGlass size={18}/><input aria-label="搜索聊天内容" value={query} onChange={event => setQuery(event.target.value)} placeholder={`在「${scope.workspace.name}」中搜索`} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && found.length) openChat(found[0].id); }}/><kbd>Esc</kbd></div>
      <div className="dialog-list">{found.map(chat => <button key={chat.id} onClick={() => openChat(chat.id)}><ChatsCircle size={18}/><span><strong>{chat.title}</strong>{chat.projectId && <small>{scope.projects.find(project => project.id === chat.projectId)?.name}</small>}</span><ArrowRight size={15}/></button>)}{!found.length && <p className="empty-note">{query ? '没有匹配的聊天。' : '此工作空间还没有聊天。'}</p>}</div>
    </>}
    {naming && <form onSubmit={saveName}>
      <label className="form-label">名称<input value={value} placeholder="输入名称" maxLength={80} required onChange={event => setValue(event.target.value)}/></label>
      {['new-project','project-settings'].includes(modal.type)&&<><div className="form-label"><span>工作区</span><div className="folder-field"><span><FolderOpen size={17}/><span title={directory||''}>{directory||'选择这个项目的本机文件夹'}</span></span>{directory&&<button type="button" className="icon-button" aria-label="取消项目工作区" onClick={()=>setDirectory(null)}><X size={15}/></button>}<button type="button" className="secondary-button" disabled={!window.zhixing||choosing} onClick={chooseDirectory}>选择文件夹</button></div><small>项目中的文件操作使用此目录，并遵循输入框的权限设置。</small></div>{error&&<p className="callout bad" role="alert">{error}</p>}</>}
      {['new-project','project-settings'].includes(modal.type) && <label className="form-label">项目说明（可选）<textarea rows={4} maxLength={4000} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="例如，每份拟稿都要标明材料来源和待核实事项"/><small>项目说明将随本项目的新请求发送，发送前可以审阅。</small></label>}
      <div className="form-actions"><button type="button" className="secondary-button" onClick={close}>取消</button><button className="primary-button" disabled={!value.trim()||choosing}>保存</button></div>
    </form>}
    {deleting && <><p className="modal-copy">确定删除「{modal.name}」{modal.type === 'delete-project' ? '及其聊天和定时任务' : ''}？独立资料空间中的资料与磁盘原文件保留。</p>{error && <p role="alert" className="callout bad">{error}</p>}<div className="form-actions"><button className="secondary-button" onClick={close}>取消</button><button className="danger-button" disabled={saving} onClick={async () => { setSaving(true); try { await removeItem(modal); } catch (e) { setError(e.message); } finally { setSaving(false); } }}>删除</button></div></>}
    {modal.type === 'archive' && <div className="record-list">{scope.spaceChats.filter(chat => chat.archived).map(chat => <article key={chat.id}><Archive size={16}/><span>{chat.title}</span><button className="secondary-button" onClick={() => updateChat(chat.id, { archived: false })}>取消归档</button><button className="text-button" onClick={() => setModal({ type: 'delete-chat', id: chat.id, name: chat.title })}>删除聊天</button></article>)}{!scope.spaceChats.some(chat => chat.archived) && <p className="empty-note">此工作空间没有归档聊天。</p>}</div>}
    {modal.type === 'orphan-drafts' && <><p className="modal-copy">这些草稿的原聊天或项目已不存在。请选择恢复到当前空间，或明确删除正文与附件副本；磁盘原文件不受影响。</p><div className="record-list">{scope.orphanDrafts.map(draft => <article key={draft.key} data-draft-key={draft.key}><FileText size={16}/><span><strong>旧草稿 · {new Date(draft.updatedAt).toLocaleString('zh-CN')}</strong><small>{draft.text.length} 字 · {draft.files.length} 个附件</small></span><button className="secondary-button" onClick={() => props.recoverDraft(draft.key)}>恢复到当前空间</button><button className="text-button" onClick={() => { if (value === draft.key) { props.discardDraft(draft.key); setValue(''); } else setValue(draft.key); }}>{value === draft.key ? '确认删除这份草稿' : '删除草稿'}</button></article>)}{!scope.orphanDrafts.length && <p className="empty-note">旧草稿已处理。</p>}</div></>}
    {modal.type === 'notifications' && <><div className="record-list">{scope.taskRuns.length ? scope.taskRuns.slice().reverse().slice(0,30).map(run => <article key={run.id}><Clock size={17}/><span><strong>{run.name}</strong><small>{taskRunStatusLabels[run.status] || run.status} · {new Date(run.startedAt).toLocaleString('zh-CN')}</small></span>{run.result && <button className="secondary-button" onClick={() => { markRead(); props.openRun(run); }}>查看结果</button>}</article>) : <p className="empty-note">此工作空间暂无任务活动。</p>}</div><div className="form-actions"><button className="secondary-button" onClick={() => { markRead(); close(); }}>标记已读</button></div></>}
    {modal.type === 'templates' && <div className="dialog-list">{workflows[scope.mode].map(([label, text]) => <button key={label} onClick={() => useTemplate(text)}><FileText size={18}/><span>{label}</span><ArrowRight size={15}/></button>)}</div>}
    {modal.type === 'attach-library' && <div className="dialog-list">{scope.documents.filter(item => item.status === 'ready').map(item => <button key={item.id} onClick={() => attach(item)}><FileText size={18}/><span>{item.name}</span><ArrowRight size={15}/></button>)}{!scope.documents.some(item => item.status === 'ready') && <p className="empty-note">当前工作空间还没有可用资料。</p>}</div>}
    {modal.type === 'shortcuts' && <div className="shortcuts">{[['新建聊天','Ctrl + N'],['搜索聊天','Ctrl + K'],['打开设置','Ctrl + ,'],['添加本机文件','Ctrl + O'],['发送或打开审阅','Enter'],['输入换行','Shift + Enter'],['关闭弹窗','Esc']].map(([title, key]) => <div key={title}><span>{title}</span><kbd>{key}</kbd></div>)}</div>}
    {modal.type === 'document' && (modal.value?.status === 'ready' ? <><p className="muted">本机读取 · {(modal.value.size / 1024).toFixed(1)} KB</p><FileCoverage file={modal.value}/><div className="privacy-text"><pre>{modal.value.text.slice(0, 12000)}</pre></div>{modal.value.text.length > 12000 && <p className="muted">仅预览前 12,000 字符。</p>}</> : <p className="callout bad">{modal.value?.reason || '无法解析此文件。'}</p>)}
    {modal.type === 'remove-document' && <><p className="modal-copy">移除资料空间中的「{modal.value.name}」？磁盘上的原文件会保留。</p><div className="form-actions"><button className="secondary-button" onClick={close}>取消</button><button className="danger-button" onClick={() => { setState(current => ({ ...current, documents: current.documents.filter(item => item.id !== modal.value.id) })); close(); }}>移除</button></div></>}
    {modal.type === 'disable-history' && <><p className="modal-copy">关闭后，此设备已保存的聊天、资料副本和定时任务会从本地记录中移除，本次打开的内容会保留至退出。</p><div className="form-actions"><button className="secondary-button" onClick={close}>取消</button><button className="danger-button" onClick={() => { setSetting('persist', false); setModal({ type: 'settings', tab: '隐私与数据' }); }}>关闭保存</button></div></>}
  </Modal>;
}

function ProjectWorktree({project,close,createProject,notify}){
 const [name,setName]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const restoring=!!project.worktree;
 async function submit(event){
  event.preventDefault();setBusy(true);setError('');
  try{
   const result=await window.zhixing.worktree({action:restoring?'restore':'create',workspaceId:project.workspaceId,projectId:project.id,name:name.trim()});
   if(!restoring)createProject(result.branch,project.instructions,result.path,{...result,sourceWorkspaceId:project.workspaceId,sourceProjectId:project.id});
   notify(restoring?'已恢复工作树。':'已创建独立工作树项目。');close();
  }catch(cause){setError(cause.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
  finally{setBusy(false);}
 }
 return <Modal title={restoring?'恢复缺失的工作树':'新建 Git 工作树'} onClose={()=>{if(!busy)close();}}>
  <form onSubmit={submit}>
   <p className="modal-copy">{restoring?`重新检出 ${project.worktree.branch}。可恢复分支中已提交的内容。`:`以「${project.name}」当前提交创建分支和独立项目。`}</p>
   {!restoring&&<label className="form-label">分支名<input value={name} onChange={event=>setName(event.target.value)} maxLength={60} pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,59}" placeholder="例如 weekly-report" required disabled={busy}/></label>}
   {busy&&<p className="settings-note" role="status">DeepSeek Harness 正在检出工作树…</p>}
   {error&&<p className="callout bad" role="alert">{error}</p>}
   <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={close}>取消</button><button className="primary-button" disabled={busy||(!restoring&&!name.trim())}>{restoring?'恢复工作树':'创建工作树'}</button></div>
  </form>
 </Modal>;
}

function ImportDeepSeek({scope,close,onImport}) {
  const [pending,setPending] = useState(false);
  const [result,setResult] = useState(null);
  const [error,setError] = useState('');
  async function choose() {
    setPending(true);
    setError('');
    try {setResult(await onImport());}
    catch(cause){setError(cause.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
    finally{setPending(false);}
  }
  return <Modal title="导入 DeepSeek 聊天" onClose={()=>{if(!pending)close();}}>
    <p className="modal-copy">导入到「{scope.project?.name||scope.workspace.name}」。支持 DeepSeek 官网第 3 版 ZIP，最多 32 MB。</p>
    <p className="settings-note">导入正文、随包图片、导出中的思考记录和网页工具记录。只有文件名的附件会显示为文件记录。</p>
    {pending&&<p className="settings-note" role="status">正在读取导出文件…</p>}
    {result&&<p className="callout" role="status">已导入 {result.chats.length} 段聊天。{result.skipped>0&&`跳过 ${result.skipped} 段无法读取的聊天。`}{result.omitted>0&&`有 ${result.omitted} 段超出本次导入上限。`}{result.trimmed>0&&`${result.trimmed} 段聊天只保留了部分正文。`}</p>}
    {error&&<p className="callout bad" role="alert">{error}</p>}
    <div className="form-actions">
      <button className="secondary-button" disabled={pending} onClick={close}>{result?'关闭':'取消'}</button>
      {!result&&<button className="primary-button" disabled={pending} onClick={choose}>选择 ZIP 并导入</button>}
    </div>
  </Modal>;
}

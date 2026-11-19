import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, BellSimple, Briefcase, Check, Desktop, Eye, FolderOpen, GearSix, Info, Keyboard, LockKey, MagnifyingGlass, Microphone, Moon, Palette, PencilSimple, Plugs, Plus, ShieldCheck, SlidersHorizontal, Sun, Trash, X } from '@phosphor-icons/react';
import { BrandMark, Modal, Switch, IconButton } from './ui.jsx';
import { WorkspaceIcon } from './Sidebar.jsx';
import { PERMISSION_MODES } from './permissions.js';
import {PRIVACY_TYPES,normalisePrivacyPolicy} from './privacy-policy.js';
import {PrivacySession} from './privacy-core.js';
import McpSettings from './McpSettings.jsx';
import KernelSettings from './KernelSettings.jsx';

import { ProviderSettings } from './ProviderSettings.jsx';

const tabs = [
  ['常规', GearSix], ['通知', BellSimple], ['外观', Palette], ['已归档的聊天', Archive], ['语音', Microphone], ['个性化', SlidersHorizontal], ['键盘快捷键', Keyboard], ['隐私与数据', ShieldCheck], ['项目与工作区', Briefcase], ['供应商', Plugs], ['MCP 连接', Plugs], ['Agent 内核', GearSix], ['权限与工具', LockKey], ['关于知行', Info],
];

export function Settings({ modal, close, setModal, state, scope, setSetting, runtime, setRuntime, changeWorkspace, notify }) {
  const [tab, setTab] = useState(tabs.some(([name]) => name === modal.tab) ? modal.tab : '常规');
  const [query, setQuery] = useState('');
  const page = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    page.current?.focus({preventScroll:true});
    return () => previous?.focus?.({preventScroll:true});
  }, []);
  const desktop = !!window.zhixing;
  const filteredTabs = tabs.filter(([label]) => !query.trim() || `${label} ${label === '隐私与数据' ? '脱敏 原文 词表 保存 归档' : label === '权限与工具' ? '请求批准 帮我批准 完全访问 文件' : label === '供应商' ? 'DeepSeek API Key 服务地址 推理 内核' : label === '外观' ? '主题 深色 浅色 系统' : label === '常规' ? '语言 快捷键 演示' : ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section ref={page} tabIndex={-1} className="settings-page" aria-label="设置">
      <nav className="settings-nav" aria-label="设置分类">
        <div className="settings-page-heading"><IconButton icon={ArrowLeft} label="返回工作台" onClick={close}/><h1>设置</h1></div>
        <div className="settings-search-field"><MagnifyingGlass size={15}/><input className="settings-search" aria-label="搜索设置" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)}/>{query && <IconButton icon={X} label="清除设置搜索" onClick={() => setQuery('')}/>}</div>
        <div className="settings-nav-items">{filteredTabs.map(([label, Icon]) => <div key={label}>{!query && label === '常规' && <p className="settings-nav-group">个人</p>}{!query && label === '项目与工作区' && <p className="settings-nav-group">工作</p>}{!query && label === '供应商' && <p className="settings-nav-group">集成</p>}{!query && label === 'Agent 内核' && <p className="settings-nav-group">Agent</p>}<button aria-current={tab === label ? 'page' : undefined} onClick={() => setTab(label)}><Icon size={17}/><span>{label}</span></button></div>)}{!filteredTabs.length && <p className="settings-empty-search">没有匹配的设置</p>}</div>
        <p className="settings-nav-footer">知行{runtime.appVersion ? ` ${runtime.appVersion}` : ''}</p>
      </nav>
      <section className="settings-content" aria-label={tab} key={tab}><div className="settings-content-inner">
        <h2>{tab}</h2>
        {tab === '常规' && <>
          <h3 className="settings-section-title">权限</h3><div className="settings-card"><div className="setting-row"><span><strong>默认权限</strong><small>设置文件、终端和联网操作的批准方式</small></span><select aria-label="默认执行权限" value={state.settings.permission} onChange={event => event.target.value === 'full' && state.settings.permission !== 'full' ? setModal({type:'full-access'}) : setSetting('permission',event.target.value)}>{PERMISSION_MODES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></div><div className="setting-row"><span><strong>发送方式</strong><small>自动脱敏和输出还原独立于执行权限</small></span><button className="secondary-button" onClick={()=>setTab('隐私与数据')}>{state.settings.privacyMode==='raw'?'非脱敏模式':'脱敏模式'}</button></div></div>
          <h3 className="settings-section-title">常规</h3><div className="settings-card">
          <div className="setting-row"><span><strong>界面语言</strong></span><span className="setting-value">简体中文</span></div>
          <div className="setting-row"><span><strong>演示模式</strong><small>使用标明来源的示例回复，不向模型发送内容</small></span><Switch label="演示模式" value={state.settings.demo} onChange={value => setSetting('demo', value)}/></div>
          <div className="setting-row"><span><strong>项目工作区</strong><small>新建项目时选择文件夹，每个项目分别保存</small></span><button className="secondary-button" onClick={() => setTab('项目与工作区')}>管理</button></div>
          </div><h3 className="settings-section-title">编辑器</h3><div className="settings-card"><div className="setting-row"><span><strong>发送快捷键</strong><small>Enter 直接发送；脱敏模式在本机自动处理</small></span><kbd>Enter</kbd></div><div className="setting-row"><span><strong>键盘快捷键</strong></span><button className="secondary-button" onClick={() => setTab('键盘快捷键')}>查看</button></div></div>
        </>}
        {tab === '外观' && <><h3 className="settings-section-title">视觉风格</h3><div className="settings-card"><div className="setting-row appearance-mode-row"><span><strong>模式</strong></span><div className="theme-choices" role="radiogroup" aria-label="外观模式">{[['system','跟随系统',Desktop],['light','浅色',Sun],['dark','深色',Moon]].map(([id,label,Icon])=><button type="button" role="radio" aria-checked={state.settings.theme===id} key={id} onClick={()=>setSetting('theme',id)}><Icon size={22} weight="light"/><span>{label}</span>{state.settings.theme===id&&<Check size={12}/>}</button>)}</div></div></div><div className="settings-card"><div className="setting-row"><strong>主题</strong><span className="setting-token">知行 · 经典</span></div><div className="setting-row"><strong>强调色</strong><span className="setting-token">中性黑白</span></div><div className="setting-row"><strong>字体</strong><span className="setting-token">系统</span></div></div></>}
        {tab === '语音' && <VoiceSettings settings={state.settings} setSetting={setSetting}/>}
        {tab === '个性化' && <><h3 className="settings-section-title">办公偏好</h3><div className="settings-card"><div className="setting-row"><span><strong>使用我的办公偏好</strong><small>新交办携带下方说明，发送时自动遵循脱敏设置</small></span><Switch label="使用我的办公偏好" value={state.settings.personalizationEnabled} onChange={value=>setSetting('personalizationEnabled',value)}/></div><label className="form-label personal-instructions">你希望知行了解哪些工作习惯？<textarea aria-label="个人办公偏好" rows={6} maxLength={4000} value={state.settings.personalInstructions} onChange={event=>setSetting('personalInstructions',event.target.value)} placeholder="例如：先给结论，表格注明单位；正式文稿保留待核实事项。"/><small>{state.settings.personalInstructions.length} / 4000 · 仅保存你主动填写的说明</small></label></div><p className="settings-note">项目专用要求可在项目设置中填写。知行目前不会自动从聊天中提取长期记忆。定时任务使用其已审阅的内容与资料。</p></>}
        {tab === '键盘快捷键' && <div className="settings-card shortcuts">{[['新建聊天','Ctrl + N'],['搜索聊天','Ctrl + K'],['打开设置','Ctrl + ,'],['添加本机文件','Ctrl + O'],['打开浏览器','Ctrl + T'],['项目文件面板','Ctrl + P'],['交互终端','Ctrl + `'],['发送消息','Enter'],['输入换行','Shift + Enter'],['压缩当前上下文','/compact'],['进入／退出规划模式','/plan · /plan off'],['持续目标及控制','/goal · /goal pause · /goal resume'],['关闭弹窗或返回工作台','Esc']].map(([title,key]) => <div key={title}><span>{title}</span><kbd>{key}</kbd></div>)}</div>}
        {tab === '已归档的聊天' && <div className="record-list">{scope.spaceChats.filter(chat => chat.archived).length ? <><p className="settings-lead">当前空间已归档 {scope.spaceChats.filter(chat => chat.archived).length} 段聊天。</p><button className="secondary-button" onClick={() => setModal({type:'archive'})}>管理已归档聊天</button></> : <p className="empty-note">此工作空间没有归档聊天。</p>}</div>}
        {tab === '隐私与数据' && <PrivacySettings settings={state.settings} setSetting={setSetting} setModal={setModal} desktop={desktop}/>}
        {tab === '权限与工具' && <>
          <p className="settings-lead">设置文件、终端与外部工具的批准方式。发送前脱敏另在「隐私与数据」选择。</p>
          <div className="mode-options">{PERMISSION_MODES.map(item => <label className={state.settings.permission === item.id ? 'selected' : ''} key={item.id}><span><strong>{item.label}</strong><small>{item.description}</small></span><input type="radio" name="execution-permission" checked={state.settings.permission === item.id} onChange={() => item.id === 'full' && state.settings.permission !== 'full' ? setModal({ type: 'full-access' }) : setSetting('permission', item.id)}/></label>)}</div>
          <div className="setting-section"><h3>DeepSeek Harness 工具</h3><div className="tool-capability-row"><span>数字、日期与表格核对</span><small>已接入</small></div><div className="tool-capability-row"><span>本机目录与办公文件</span><small>{scope.project?.directory ? '使用当前项目工作区' : '新建项目时选择工作区'}</small></div><div className="tool-capability-row"><span>原生计划、技能、交互提问</span><small>已接入</small></div><div className="tool-capability-row"><span>PowerShell 终端</span><small>项目内可用 · 按权限审批</small></div><div className="tool-capability-row"><span>MCP、子任务、网页检索</span><small>已接入</small></div></div>
          <p className="settings-note">权限变更作用于下一次请求。定时任务启用时授权计划与资料，手动运行自动执行脱敏。终端命令本身可以访问项目外和网络。</p>
        </>}
        {tab === '项目与工作区' && <>
          <p className="settings-lead">办公、政务在左上角切换。每个项目单独选择本机工作区。</p>
          <div className="settings-spaces">{state.projects.map(project => <article className="settings-space" key={project.id}>
            <span className="space-icon"><FolderOpen size={18}/></span>
            <div><strong>{project.name}</strong><small title={project.directory || ''}>{project.directory || '未选择本机工作区'}</small></div>
            <span className="current-space-label">{state.workspaces.find(space=>space.id===project.workspaceId)?.type==='government'?'政务':'办公'}</span>
            <IconButton icon={PencilSimple} label={`编辑项目 ${project.name}`} onClick={() => setModal({ type: 'project-settings', value:project })}/>
          </article>)}</div>
          <button className="secondary-button" onClick={() => setModal({ type: 'new-project' })}><Plus size={16}/>新建项目</button>
        </>}
        {tab === '供应商' && <ProviderSettings runtime={runtime} setRuntime={setRuntime} desktop={window.zhixing}/>}
        {tab === 'MCP 连接' && <McpSettings/>}
        {tab === 'Agent 内核' && <KernelSettings runtime={runtime} setRuntime={setRuntime}/>}
        {tab === '通知' && <>
          <div className="setting-row"><span><strong>系统通知</strong><small>提醒到时或 AI 任务完成时通知</small></span><Switch label="系统通知" value={state.settings.notifications} onChange={value => setSetting('notifications', value)}/></div>
          <div className="setting-row"><span><strong>最近任务活动</strong></span><button className="secondary-button" onClick={() => setModal({ type: 'notifications' })}>查看</button></div>
        </>}
        {tab === '关于知行' && <div className="about-settings"><BrandMark className="brand-about"/><strong>知行 · AI 办公助手</strong><p className="muted">{runtime.appVersion ? `版本 ${runtime.appVersion} · ` : ''}Windows 桌面端</p><p className="muted">{runtime.version||'DeepSeek Harness · 请在桌面版查看版本'}</p><p>知你所需，行你所托。</p></div>}
      </div></section>
  </section>;
}

function VoiceSettings({settings,setSetting}) {
  const [status,setStatus]=useState(null),[checking,setChecking]=useState(false);
  async function check(){setChecking(true);try{setStatus(await window.zhixing.speechStatus());}catch{setStatus({supported:false,languages:[]});}finally{setChecking(false);}}
  return <><h3 className="settings-section-title">听写</h3><div className="settings-card"><label className="setting-row"><span><strong>主要语言</strong><small>使用 Windows 已安装的本机识别器</small></span><select aria-label="听写语言" value={settings.voiceLanguage} onChange={event=>setSetting('voiceLanguage',event.target.value)}><option value="zh-CN">简体中文</option><option value="en-US">English (US)</option></select></label><div className="setting-row"><span><strong>语音组件</strong><small>{status?(status.languages?.map(item=>item.language).join('、')||'未找到可用语言'):'检查本机可用语言，不打开麦克风'}</small></span><button className="secondary-button" disabled={!window.zhixing||checking} onClick={check}>{checking?'正在检查…':'检查'}</button></div><div className="setting-row"><span><strong>识别后插入输入框</strong><small>结束听写后，选择「插入文字」，再自行发送</small></span><Check size={17}/></div></div><p className="settings-lead">点击输入框旁的麦克风开始听写，最长两分钟。关闭听写或离开当前聊天会停止麦克风。</p><div className="settings-card"><div className="setting-row"><span><strong>音频留在本机</strong><small>由 Windows 本机语音组件处理，不保存录音，不向模型发送音频。</small></span><ShieldCheck size={18}/></div><div className="setting-row"><span><strong>发送文字的隐私设置</strong><small>脱敏模式下，听写文字与键盘输入使用相同保护流程。</small></span></div></div>{!window.zhixing&&<p className="settings-note">浏览器预览可以查看界面；本机听写需使用 Windows 桌面版。</p>}</>;
}

function PrivacySettings({ settings, setSetting, setModal, desktop }) {
  const [term, setTerm] = useState('');
  const [exclusions,setExclusions]=useState(()=>normalisePrivacyPolicy(settings.privacyPolicy).neverMask.join('\n'));
  const [prefixes,setPrefixes]=useState(()=>normalisePrivacyPolicy(settings.privacyPolicy).secretPrefixes.join('\n'));
  const [sample,setSample]=useState('');
  const policy=normalisePrivacyPolicy(settings.privacyPolicy);
  const [sampleResult,setSampleResult]=useState(null);
  const updatePolicy=patch=>{setSetting('privacyPolicy',normalisePrivacyPolicy({...policy,...patch}));setSampleResult(null);};
  const options = [
    ['redact', '脱敏模式', '发送前替换识别到的敏感值，回复按本次会话的映射在本机还原。', ShieldCheck],
    ['raw', '非脱敏模式', '输入、所选资料与相关聊天上下文按原文发送，回复不经过还原。', Eye],
  ];
  function addTerm(event) {
    event.preventDefault();
    const word = term.trim();
    if (!word || settings.customTerms.length >= 100) return;
    setSetting('customTerms', [...new Set([...settings.customTerms, word])]);
    setTerm('');
  }
  return <>
    <fieldset className="privacy-setting">
      <legend>发送方式</legend>
      <div className="mode-options">{options.map(([id, title, detail, Icon]) => <label key={id} className={settings.privacyMode === id ? 'selected' : ''}>
        <Icon size={21}/><span><strong>{title}</strong><small>{detail}</small></span><input type="radio" name="privacy-mode" value={id} checked={settings.privacyMode === id} onChange={() => setSetting('privacyMode', id)}/>
      </label>)}</div>
    </fieldset>
    <p className="settings-note"><LockKey size={15}/>脱敏模式自动处理后直接发送，回复在本机还原。可在回复旁按需查看发送详情。</p>
    <details className="privacy-rules" open><summary>识别与处理规则 · {PRIVACY_TYPES.length} 类</summary><p className="muted">按类型选择替换、原样或拦截。规则识别有边界，姓名和地址并不保证全量识别。</p>{PRIVACY_TYPES.map(([id,label,detail])=><label className="privacy-rule-row" key={id}><span><strong>{label}</strong><small>{detail}</small></span><select aria-label={`${label}处理方式`} value={policy.actions[id]} onChange={event=>updatePolicy({actions:{...policy.actions,[id]:event.target.value}})}><option value="mask">替换</option>{id!=='SECRET'&&<option value="allow">原样</option>}<option value="block">拦截</option></select></label>)}</details>
    <div className="setting-section"><h3>敏感词表</h3><p className="muted">添加客户名、机构名或项目代号，用于自动脱敏和导出审阅。</p>
      <form className="term-form" onSubmit={addTerm}><input aria-label="自定义敏感词" maxLength={120} value={term} onChange={event => setTerm(event.target.value)} placeholder="例如，项目代号"/><button className="secondary-button" disabled={!term.trim() || settings.customTerms.length >= 100}>添加</button></form>
      {!!settings.customTerms.length && <div className="term-chips">{settings.customTerms.map(word => <span key={word}>{word}<IconButton icon={X} label={`移除词条 ${word}`} onClick={() => setSetting('customTerms', settings.customTerms.filter(item => item !== word))}/></span>)}</div>}
      <div className="setting-row"><span><strong>词条不区分大小写</strong></span><Switch label="词条不区分大小写" value={policy.caseInsensitive} onChange={value=>updatePolicy({caseInsensitive:value})}/></div>
      <label className="form-label">从不脱敏<textarea aria-label="从不脱敏" rows={2} value={exclusions} onChange={event=>setExclusions(event.target.value)} onBlur={()=>updatePolicy({neverMask:exclusions.split(/[\n,，]/)})} placeholder="每行一个完整值，凭证不受此项豁免"/></label>
      <label className="form-label">自定义密钥前缀<textarea aria-label="自定义密钥前缀" rows={2} value={prefixes} onChange={event=>setPrefixes(event.target.value)} onBlur={()=>updatePolicy({secretPrefixes:prefixes.split(/[\n,，]/)})} placeholder="每行一个，至少 4 个字符"/></label>
    </div>
    <div className="setting-section"><h3>在本机试一试</h3><p>测试内容仅在当前页面内存中处理，不保存、不发送。</p><textarea className="privacy-sample" aria-label="脱敏测试原文" rows={4} value={sample} onChange={event=>{setSample(event.target.value);setSampleResult(null);}} placeholder="粘贴一段合成测试文字"/><button className="secondary-button" disabled={!sample} onClick={()=>setSampleResult(new PrivacySession('local-sample').protect(sample,settings.customTerms,policy))}>测试脱敏</button>{sampleResult&&<><p className="settings-note" role="status">{sampleResult.blocked?'将被拦截':'可以发送'} · 替换 {sampleResult.entities.length} 个值</p><pre className="privacy-sample-result">{sampleResult.text}</pre></>}</div>
    <div className="setting-row"><span><strong>保存聊天与资料</strong><small>{desktop ? '保存在本机，使用 Windows 用户加密' : '保存在当前浏览器'}</small></span><Switch label="保存聊天与资料" value={settings.persist} onChange={value => value ? setSetting('persist', true) : setModal({ type: 'disable-history' })}/></div>
    <div className="setting-row"><span><strong>已归档聊天</strong></span><button className="secondary-button" onClick={() => setModal({ type: 'archive' })}><Archive size={15}/>管理</button></div>
  </>;
}

export function WorkspaceEditor({ item, close, onSave }) {
  const [name, setName] = useState(item?.name || '');
  const [type, setType] = useState(item?.type || 'office');
  const [directory, setDirectory] = useState(item?.directory || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function chooseDirectory() {
    if (!window.zhixing?.chooseWorkspaceFolder || busy) return;
    setBusy(true); setError('');
    try { const path = await window.zhixing.chooseWorkspaceFolder(); if (path) setDirectory(path); }
    catch { setError('无法打开目录选择窗口。'); }
    finally { setBusy(false); }
  }
  return <Modal title={item ? '编辑工作空间' : '创建工作空间'} onClose={close}>
    <form onSubmit={event => { event.preventDefault(); if (name.trim() && !busy) onSave({ id: item?.id, name: name.trim(), type, directory }); }}>
      <label className="form-label">名称<input value={name} maxLength={48} required placeholder="例如，综合部" onChange={event => setName(event.target.value)}/></label>
      <label className="form-label">模板类型<select value={type} onChange={event => setType(event.target.value)}><option value="office">办公</option><option value="government">政务</option></select></label>
      <div className="form-label"><span>本机目录（可选）</span><div className="folder-field"><span><FolderOpen size={17}/><span title={directory || ''}>{directory || '未选择目录'}</span></span>{directory && <IconButton icon={Trash} label="取消关联目录" onClick={() => setDirectory(null)}/>}<button type="button" className="secondary-button" disabled={!window.zhixing || busy} onClick={chooseDirectory}>选择目录</button></div></div>
      <p className="muted">文件选择从此目录打开。关联后，Agent 可按当前权限读取和生成办公文件。</p>
      {error && <p className="callout bad" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="secondary-button" onClick={close}>取消</button><button className="primary-button" disabled={!name.trim() || busy}>{item ? '保存' : '创建'}</button></div>
    </form>
  </Modal>;
}

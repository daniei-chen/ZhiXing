import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, BellSimple, Briefcase, Check, CircleNotch, Desktop, Eye, FolderOpen, GearSix, Info, Keyboard, LockKey, MagnifyingGlass, Microphone, Moon, Palette, PencilSimple, Plugs, Plus, ShieldCheck, SlidersHorizontal, Sun, Trash, X } from '@phosphor-icons/react';
import { BrandMark, Modal, Switch, IconButton } from './ui.jsx';
import { WorkspaceIcon } from './Sidebar.jsx';
import { PERMISSION_MODES } from './permissions.js';
import {PRIVACY_TYPES,normalisePrivacyPolicy} from './privacy-policy.js';
import PrivacyTest from './PrivacyTest.jsx';
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
  function moveThemeFocus(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('[role="radio"]')];
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].click();
    buttons[next].focus();
  }
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
        {tab === '外观' && <><h3 className="settings-section-title">视觉风格</h3><div className="settings-card"><div className="setting-row appearance-mode-row"><span><strong>模式</strong></span><div className="theme-choices" role="radiogroup" aria-label="外观模式" onKeyDown={moveThemeFocus}>{[['system','跟随系统',Desktop],['light','浅色',Sun],['dark','深色',Moon]].map(([id,label,Icon])=><button type="button" role="radio" tabIndex={state.settings.theme===id?0:-1} aria-checked={state.settings.theme===id} key={id} onClick={()=>setSetting('theme',id)}><Icon size={22} weight="light"/><span>{label}</span>{state.settings.theme===id&&<Check size={12}/>}</button>)}</div></div></div><div className="settings-card"><div className="setting-row"><strong>主题</strong><span className="setting-token">知行 · 经典</span></div><div className="setting-row"><strong>强调色</strong><span className="setting-token">中性黑白</span></div><div className="setting-row"><strong>字体</strong><span className="setting-token">系统</span></div></div></>}
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
        {tab === '供应商' && <ProviderSettings runtime={runtime} setRuntime={setRuntime} desktop={window.zhixing} settings={state.settings} setSetting={setSetting}/>}
        {tab === 'MCP 连接' && <McpSettings/>}
        {tab === 'Agent 内核' && <KernelSettings runtime={runtime} setRuntime={setRuntime} inspectionScope={{workspaceId:scope.workspace.id,projectId:scope.project?.id||null,permission:state.settings.permission,...(state.settings.modelProviderId?{providerId:state.settings.modelProviderId,modelId:state.settings.model,reasoning:state.settings.reasoning}:{})}}/>}
        {tab === '通知' && <>
          <div className="setting-row"><span><strong>系统通知</strong><small>提醒到时或 AI 任务完成时通知</small></span><Switch label="系统通知" value={state.settings.notifications} onChange={value => setSetting('notifications', value)}/></div>
          <div className="setting-row"><span><strong>最近任务活动</strong></span><button className="secondary-button" onClick={() => setModal({ type: 'notifications' })}>查看</button></div>
        </>}
        {tab === '关于知行' && <AboutSettings runtime={runtime}/>}
      </div></section>
  </section>;
}

function AboutSettings({runtime}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [update, setUpdate] = useState({status:'idle'});
  const [diagnostic, setDiagnostic] = useState('');
  const desktop = window.zhixing;
  async function exportDiagnostics() {
    if (!desktop) return;
    try {
      const result = await desktop.exportDiagnostics();
      setDiagnostic(result.canceled ? '已取消。' : `已导出到 ${result.directory}`);
    } catch (failure) { setDiagnostic(failure.message || '导出失败。'); }
  }
  useEffect(() => {
    if (!desktop) return undefined;
    let live = true;
    desktop.desktopUpdateState().then(value => { if (live) setUpdate(value); }).catch(() => {});
    const off = desktop.onDesktopUpdate(value => { if (live) setUpdate(value); });
    return () => { live = false; off?.(); };
  }, [desktop]);
  async function runUpdate(action) {
    if (!desktop) return;
    try { setUpdate(await action()); } catch (failure) { setError(failure.message || '更新操作失败。'); }
  }

  async function checkForUpdates() {
    if (!desktop || checking) return;
    setChecking(true);
    setError('');
    setResult(null);
    try {
      setResult(await desktop.checkDesktopRelease());
    } catch (failure) {
      setError(failure.message || '无法读取 GitHub 发行信息。');
    } finally {
      setChecking(false);
    }
  }

  async function openRelease(tag) {
    try {
      await desktop.openOfficialRelease(tag);
    } catch (failure) {
      setError(failure.message || '无法打开官方发行页。');
    }
  }

  return <div className="about-settings">
    <BrandMark className="brand-about"/>
    <strong>知行 · AI 办公助手</strong>
    <p className="muted">{runtime.appVersion ? `版本 ${runtime.appVersion} · ` : ''}Windows 桌面端</p>
    <p className="muted">{runtime.version||'DeepSeek Harness · 请在桌面版查看版本'}</p>
    <p>知你所需，行你所托。</p>
    {desktop ? <>
      <div className="desktop-update" role="status">
        <strong>应用更新</strong>
        {update.status === 'unavailable' && <p className="settings-note">{update.message || '自动更新只在安装版可用。'}</p>}
        {update.status === 'idle' && <p className="settings-note">尚未检查。</p>}
        {update.status === 'checking' && <p className="settings-note">正在检查更新…</p>}
        {update.status === 'current' && <p className="settings-note">已是最新版本。</p>}
        {update.status === 'available' && <><p className="settings-note">发现新版本 {update.version}。</p><button className="secondary-button" type="button" onClick={() => runUpdate(desktop.downloadDesktopUpdate)}>下载更新</button></>}
        {update.status === 'downloading' && <p className="settings-note">正在下载 {update.percent ?? 0}%…</p>}
        {update.status === 'downloaded' && <><p className="settings-note">更新 {update.version} 已下载，重启后安装。</p><button className="secondary-button" type="button" onClick={() => runUpdate(desktop.installDesktopUpdate)}>重启并安装</button></>}
        {update.status === 'error' && <p className="setting-notice bad" role="alert">{update.message}</p>}
        <button className="secondary-button" type="button" onClick={() => runUpdate(desktop.checkDesktopUpdate)}>检查更新</button>
      </div>
      <div className="desktop-update" role="status">
        <strong>诊断信息</strong>
        <p className="settings-note">导出版本、系统信息与运行日志，便于远程排查。不包含聊天内容、密钥或文件内容。</p>
        <button className="secondary-button" type="button" onClick={exportDiagnostics}>导出诊断信息</button>
        {diagnostic && <p className="settings-note">{diagnostic}</p>}
      </div>
      <button className="secondary-button" type="button" disabled={checking} onClick={checkForUpdates}>{checking ? '正在查询…' : '在 GitHub 上查看发行记录'}</button>
      {error && <p className="setting-notice bad" role="alert">{error}</p>}
      {result && <div className="desktop-release-result" role="status">
        {!result.latest ? <p>GitHub 尚未发布知行桌面版本。</p> : <>
          <p><strong>{result.updateAvailable ? '发现新版本' : '未发现较新版本'}</strong></p>
          <p>{result.latest.name} · {result.latest.version}{result.latest.prerelease ? ' · 预发布' : ''}</p>
          <p>{result.latest.hasWindowsInstaller ? 'Windows 安装包可下载。安装时会保留当前用户数据。' : '发行页暂未附带 Windows 安装包。'}</p>
          <button className="secondary-button" type="button" onClick={() => openRelease(result.latest.tag)}>查看官方发行页</button>
        </>}
        <small>检查时间 {new Date(result.checkedAt).toLocaleString()}</small>
      </div>}
      <p className="settings-note">检查只读取 GitHub 发行记录，不会自动下载或安装。</p>
    </> : <p className="settings-note">桌面版更新检查需在 Windows 应用中使用。</p>}
  </div>;
}

function VoiceSettings({settings,setSetting}) {
  const [status,setStatus]=useState(null),[checking,setChecking]=useState(false),[source,setSource]=useState('');
  const api=window.zhixing;
  useEffect(()=>{
    if(!api)return undefined;
    let live=true;
    const update=async()=>{try{const value=await api.speechStatus();if(live){setStatus(value);setSource('');}}catch(error){if(live)setStatus({supported:false,message:error.message});}};
    void update();
    const off=api.onSpeechEvent(event=>{if(!live||event.type!=='snapshot')return;const provider=event.snapshot.providers?.find(item=>item.id==='sensevoice-local');if(provider)setStatus({...provider,supported:true});});
    return()=>{live=false;off?.();};
  },[api]);
  async function check(){setChecking(true);try{setStatus(await api.speechStatus());}catch(error){setStatus({supported:false,message:error.message});}finally{setChecking(false);}}
  async function prepare(){setChecking(true);setStatus(previous=>({...previous,preparation:{...previous?.preparation,phase:'checking'}}));try{const result=await api.prepareSpeech(source||undefined);setStatus(previous=>{const phase=result.preparation?.phase;return {...previous,...result,preparation:['ready','standby','failed'].includes(phase)?result.preparation:previous.preparation};});}catch(error){setStatus(previous=>({...previous,preparation:{phase:'failed',message:error.message}}));}finally{setChecking(false);}}
  async function cancel(){setChecking(true);try{setStatus(await api.cancelSpeechPreparation());}catch(error){setStatus(previous=>({...previous,preparation:{phase:'failed',message:error.message}}));}finally{setChecking(false);}}
  const preparation=status?.preparation,preparing=['checking','downloading','loading','waking','cancelling'].includes(preparation?.phase);
  const estimate=status?.setupEstimate;
  const size=value=>value?`${(value/1024/1024).toFixed(0)} MB`:'—';
  const statusText=!status?'正在检查本机缓存…':!status.supported?status.message||'本机语音服务不可用。':preparation?.phase==='ready'?'已准备 · 本机识别器空闲':preparation?.phase==='standby'?'已准备 · 首次听写时加载识别器':preparation?.phase==='failed'?preparation.message:preparation?.phase==='cancelled'?'准备已取消':preparing&&preparation?.phase==='downloading'?`下载 ${preparation.resource||'模型'} · ${size(preparation.completedBytes)}${preparation.totalBytes?` / ${size(preparation.totalBytes)}`:''}`:preparing?'正在准备本机语音模型…':'首次使用需要下载本机模型。';
  return <><h3 className="settings-section-title">听写</h3><div className="settings-card"><label className="setting-row"><span><strong>主要语言</strong><small>SenseVoice 本机识别支持自动识别、中文、英语、粤语、日语和韩语</small></span><select aria-label="听写语言" value={settings.voiceLanguage} onChange={event=>setSetting('voiceLanguage',event.target.value)}><option value="auto">自动识别</option><option value="zh-CN">简体中文</option><option value="en-US">English</option><option value="yue">粤语</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label><div className="setting-row"><span><strong>本机语音模型</strong><small>{statusText}</small></span>{preparing?<CircleNotch className="spinning" size={17}/>:<button className="secondary-button" disabled={!api||checking} onClick={check}>{checking?'正在检查…':'重新检查'}</button>}</div>
    {estimate&&preparation?.phase!=='ready'&&<p className="speech-estimate">首次准备约需 {size(estimate.recommendedDiskBytes)} 磁盘空间；内存需求约 {size(estimate.expectedMemoryBytes)}。资源下载后留在本机。</p>}
    {status?.downloadSources?.length>1&&preparation?.phase!=='ready'&&<label className="setting-row"><span><strong>模型下载源</strong><small>仅用于下载校验通过的 SenseVoice 模型</small></span><select aria-label="语音模型下载源" value={source} onChange={event=>setSource(event.target.value)}><option value="">自动选择</option>{status.downloadSources.map(value=><option key={value} value={value}>{new URL(value).host}</option>)}</select></label>}
    {status?.supported&&['unprepared','cancelled','failed'].includes(preparation?.phase)&&<div className="setting-row"><span><strong>{preparation.phase==='failed'?'准备未完成':'准备识别器'}</strong><small>{preparation.phase==='failed'?'检查网络或存储空间后重试。':'下载并验证本机 INT8 模型，只在你点击麦克风后录音。'}</small></span><button className="secondary-button" disabled={checking} onClick={prepare}>{checking?'正在启动…':preparation.phase==='failed'?'重试准备':'下载并准备'}</button></div>}
    {preparing&&<div className="setting-row"><span><strong>模型准备</strong><small>完成后可断网听写；当前不会启用麦克风</small></span><button className="secondary-button" disabled={checking||preparation.phase==='cancelling'} onClick={cancel}>取消准备</button></div>}
    <div className="setting-row"><span><strong>识别后插入输入框</strong><small>停止听写后先检查转写内容，再自行发送</small></span><Check size={17}/></div></div><p className="settings-lead">点击输入框旁的麦克风开始录音，最长两分钟。关闭听写或离开当前聊天会停止录音。</p><div className="settings-card"><div className="setting-row"><span><strong>音频留在本机</strong><small>录音由 SenseVoice 本机处理，不保存在会话历史，也不发送给聊天模型。</small></span><ShieldCheck size={18}/></div><div className="setting-row"><span><strong>发送文字的隐私设置</strong><small>确认后的转写内容与键盘输入使用同一保护流程。</small></span></div></div>{!api&&<p className="settings-note">本机语音识别需使用 Windows x64 桌面包。</p>}</>;
}

function PrivacySettings({ settings, setSetting, setModal, desktop }) {
  const [term, setTerm] = useState('');
  const [exclusions,setExclusions]=useState(()=>normalisePrivacyPolicy(settings.privacyPolicy).neverMask.join('\n'));
  const [prefixes,setPrefixes]=useState(()=>normalisePrivacyPolicy(settings.privacyPolicy).secretPrefixes.join('\n'));
  const policy=normalisePrivacyPolicy(settings.privacyPolicy);
  const updatePolicy=patch=>{setSetting('privacyPolicy',normalisePrivacyPolicy({...policy,...patch}));};
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
    <p className="settings-note"><LockKey size={15}/>脱敏模式自动处理后直接发送，回复在本机还原。非脱敏模式仍拦截识别到的凭证；凭证的「替换」选项仅在脱敏模式生效。</p>
    <details className="privacy-rules" open><summary>识别与处理规则 · {PRIVACY_TYPES.length} 类</summary><p className="muted">按类型选择替换、原样或拦截。规则识别有边界，姓名和地址并不保证全量识别。</p>{PRIVACY_TYPES.map(([id,label,detail])=><label className="privacy-rule-row" key={id}><span><strong>{label}</strong><small>{detail}</small></span><select aria-label={`${label}处理方式`} disabled={id==='SECRET'&&settings.privacyMode==='raw'} value={id==='SECRET'&&settings.privacyMode==='raw'?'block':policy.actions[id]} onChange={event=>updatePolicy({actions:{...policy.actions,[id]:event.target.value}})}><option value="mask">替换</option>{id!=='SECRET'&&<option value="allow">原样</option>}<option value="block">拦截</option></select></label>)}</details>
    <div className="setting-section"><h3>敏感词表</h3><p className="muted">添加客户名、机构名或项目代号，用于自动脱敏和导出审阅。</p>
      <form className="term-form" onSubmit={addTerm}><input aria-label="自定义敏感词" maxLength={120} value={term} onChange={event => setTerm(event.target.value)} placeholder="例如，项目代号"/><button className="secondary-button" disabled={!term.trim() || settings.customTerms.length >= 100}>添加</button></form>
      {!!settings.customTerms.length && <div className="term-chips">{settings.customTerms.map(word => <span key={word}>{word}<IconButton icon={X} label={`移除词条 ${word}`} onClick={() => setSetting('customTerms', settings.customTerms.filter(item => item !== word))}/></span>)}</div>}
      <div className="setting-row"><span><strong>词条不区分大小写</strong></span><Switch label="词条不区分大小写" value={policy.caseInsensitive} onChange={value=>updatePolicy({caseInsensitive:value})}/></div>
      <label className="form-label">从不脱敏<textarea aria-label="从不脱敏" rows={2} value={exclusions} onChange={event=>setExclusions(event.target.value)} onBlur={()=>updatePolicy({neverMask:exclusions.split(/[\n,，]/)})} placeholder="每行一个完整值，凭证不受此项豁免"/></label>
      <label className="form-label">自定义密钥前缀<textarea aria-label="自定义密钥前缀" rows={2} value={prefixes} onChange={event=>setPrefixes(event.target.value)} onBlur={()=>updatePolicy({secretPrefixes:prefixes.split(/[\n,，]/)})} placeholder="每行一个，至少 4 个字符"/></label>
    </div>
    <PrivacyTest terms={settings.customTerms} policy={policy} privacyMode={settings.privacyMode}/>
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

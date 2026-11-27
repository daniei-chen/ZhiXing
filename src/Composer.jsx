import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Brain, CaretRight, Check, CircleNotch, FileText, Files, FolderOpen, Globe, Hand, Lightbulb, Paperclip, Plugs, Plus, ShieldCheck, ShieldWarning, Stop, Target, X } from '@phosphor-icons/react';
import { IconButton } from './ui.jsx';
import { PERMISSION_MODES, permissionMode } from './permissions.js';
import {fileReadLabel} from './FileCoverage.jsx';
import { VoiceInput } from './VoiceInput.jsx';
import { ModelControls } from './ModelControls.jsx';
import { matchesSessionCommandPrefix, parseSessionCommand } from './session-commands.js';
import { queuePreview } from './message-queue.js';
import { errorText } from './error-copy.js';
import { activeMention, applyMention, mentionNote, mentionState } from './file-mentions.js';
import { useKeyedValue } from './use-keyed-value.js';

const COMMANDS = [
  ['/plan', '计划模式', '先讨论方案，再批准执行', Lightbulb],
  ['/goal', '持续目标', '为当前聊天设置目标', Target],
  ['/compact', '压缩上下文', '整理当前会话，继续处理较长任务', CircleNotch],
  ['/model', '模型与思考强度', '更换本次交办使用的模型', Brain],
  ['/settings', '设置', '打开知行设置', Plugs],
  ['/skills', '技能', '查看内核技能与办公流程', FileText],
];

function markMoreBelow(field) {
  field.toggleAttribute('data-more-below', field.scrollHeight - field.clientHeight - field.scrollTop > 1);
}

export function Composer({ settings, files: initialFiles, input: initialInput, draftStore, draftKey, setInput, setFiles, setSetting, onSubmit, onStop, running, disabled, busy, chooseFiles, addFiles, openModal, menu, toggleMenu, closeMenu, composer, runtime, setRuntime, openWorkbench, scopeKey, onLocalCommand, suspended, takeover = null, queue = [], onRemoveQueued, onRetryQueued, onEditQueued, referenceScope = null }) {
  const draft = useKeyedValue(draftStore, draftKey);
  const input = draft?.text ?? initialInput;
  const files = draft?.files ?? initialFiles;
  const [voiceActive, setVoiceActive] = useState(false);
  const [connections, setConnections] = useState([]);
  const [commandIndex,setCommandIndex]=useState(0),[dismissedInput,setDismissedInput]=useState(null);
  const takenOver = Boolean(takeover);
  // 运行中仍可提交：消息进入排队，等本轮结束后按顺序发送（对齐 Harness 的 queue）。
  const ready = (input.trim() || files.length) && !disabled && !busy && !voiceActive && !takenOver;
  const redacted = settings.privacyMode === 'redact';
  const PrivacyIcon = redacted ? ShieldCheck : ShieldWarning;
  const selectedPermission = permissionMode(settings.permission);
  const commandOptions = /^\/[a-z\p{Script=Han}]*$/u.test(input) && dismissedInput !== input && !menu && !voiceActive && !takenOver
    ? COMMANDS.filter(([command]) => command.startsWith(input) || matchesSessionCommandPrefix(command.slice(1), input))
    : [];
  const [mention,setMention]=useState(null),[mentionIndex,setMentionIndex]=useState(0);
  const mentionCache=useRef(null),mentionDismissed=useRef(''),mentionLoading=useRef(false),mentionEpoch=useRef(0),mentionFailure=useRef('');
  const mentionSignature=token=>token?`${token.start}:${token.prefix}`:'';
  // 索引只服务当前这一个 @ 记号：记号结束时缓存一起失效，下一个 @ 会重新列一遍工作区，
  // 这样新写或删掉的文件、以及换过的项目目录都能反映到候选里。
  function invalidateMention(){mentionEpoch.current+=1;mentionCache.current=null;mentionFailure.current='';mentionLoading.current=false;}
  function updateMention(value,caret){
    if(disabled||voiceActive||takenOver||menu){setMention(null);return;}
    const token=activeMention(value,caret);
    if(!token){mentionDismissed.current='';invalidateMention();setMention(null);return;}
    const signature=mentionSignature(token);
    if(mentionDismissed.current===signature){setMention(null);return;}
    const cached=mentionCache.current;
    if(cached){setMention(previous=>previous&&mentionSignature(previous.token)===signature?previous:{token,status:'ready',...cached});return;}
    setMentionIndex(0);
    if(mentionFailure.current){
      setMention({token,status:'error',workspace:false,entries:[],truncated:false,error:mentionFailure.current});
      return;
    }
    setMention(previous=>previous?{...previous,token,status:'loading'}:{token,status:'loading',workspace:true,entries:[],truncated:false,error:''});
    // 同一次 @ 只留一个在途请求：索引与查询无关，先发的那次回来就能给当前记号用。
    if(mentionLoading.current)return;
    mentionLoading.current=true;
    const epoch=mentionEpoch.current;
    Promise.resolve(window.zhixing?.listWorkspaceReferences?.(referenceScope ?? {})).then(result=>{
      if(mentionEpoch.current!==epoch)return;
      const source=result&&typeof result==='object'?result:{workspace:false,entries:[],truncated:false};
      mentionCache.current=source;
      setMention(previous=>previous?{...previous,status:'ready',error:'',workspace:source.workspace!==false,entries:Array.isArray(source.entries)?source.entries:[],truncated:source.truncated===true}:previous);
    }).catch(cause=>{
      if(mentionEpoch.current!==epoch)return;
      mentionFailure.current=errorText(cause)||'无法读取项目工作区。';
      setMention(previous=>previous?{...previous,status:'error',error:mentionFailure.current}:previous);
    }).finally(()=>{if(mentionEpoch.current===epoch)mentionLoading.current=false;});
  }
  function pickMention(candidate){
    if(!mention)return;
    const applied=applyMention(input,mention.token,candidate,(mention.entries||[]).map(item=>item.path));
    mentionDismissed.current='';
    invalidateMention();
    setMention(null);
    setInput(applied.text);
    requestAnimationFrame(()=>{const field=composer.current;if(!field)return;field.focus();field.setSelectionRange(applied.caret,applied.caret);});
  }
  useEffect(()=>{invalidateMention();mentionDismissed.current='';setMention(null);setMentionIndex(0);},[scopeKey,draftKey]);
  const mentionView=mention&&mention.status==='ready'?mentionState(mention,mention.token.query):null;
  const mentionItems=mentionView?.items??[];
  const mentionOpen=!!mention&&!menu;
  function chooseCommand(command) {
    if (['/model', '/settings', '/skills'].includes(command)) {
      onLocalCommand(command);
    } else {
      setInput(`${command} `);
      requestAnimationFrame(() => composer.current?.focus());
    }
    setCommandIndex(0);
  }

  useLayoutEffect(() => { markMoreBelow(composer.current); }, [composer, input]);
  useEffect(() => {
    if (takenOver) closeMenu();
  }, [takenOver]);
  useEffect(() => {
    const field = composer.current;
    const observer = new ResizeObserver(() => markMoreBelow(field));
    observer.observe(field);
    return () => observer.disconnect();
  }, [composer]);
  useEffect(() => {
    if (takenOver || menu?.name !== 'attach') return;
    let live = true;
    window.zhixing?.listMcp().then(rows => { if (live) setConnections(rows); }).catch(() => {});
    return () => { live = false; };
  }, [menu?.name, takenOver]);
  function menuKeys(event) {
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || event.target.matches('input,textarea,select')) return;
    const items = [...event.currentTarget.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
    const at = items.indexOf(document.activeElement);
    if (!items.length) return;
    event.preventDefault();
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
  function insertCommand(command) {
    setInput(previous => {
      const parsed = parseSessionCommand(previous);
      const body = parsed && ['plan', 'goal'].includes(parsed.name) ? parsed.argument : previous.trimStart();
      if (!command) return body;
      if (command === '/plan') return body ? `/plan\n${body}` : '/plan ';
      return `${command} ${body}`;
    });
    closeMenu();
    requestAnimationFrame(() => composer.current?.focus());
  }

  return <div className="composer-area">
    {!!queue.length && <section className="queued-messages" aria-label={`${queue.length} 条排队消息`}>
      <div className="queued-heading"><span>{queue.length} 条排队消息</span><small>本轮结束后按顺序发送</small></div>
      <ol>{queue.map((item, index) => <li key={item.id} className={item.error ? 'failed' : item.sending ? 'sending' : ''}>
        <span className="queued-index">{index + 1}</span>
        <span className="queued-body"><span className="queued-text">{queuePreview(item)}</span>{!!item.files?.length && <small>{item.files.length} 个附件</small>}{item.error && <small className="queued-error" role="alert">{item.error}</small>}</span>
        {item.error ? <button type="button" className="text-button" disabled={item.sending} onClick={() => onRetryQueued(item.id)}>重试</button>
          : item.sending ? <span className="queued-state">发送中…</span>
          : <button type="button" className="text-button" onClick={() => onEditQueued(item)}>编辑</button>}
        <IconButton icon={X} label="删除排队消息" disabled={item.sending} onClick={() => onRemoveQueued(item.id)}/>
      </li>)}</ol>
    </section>}
    {takeover}
    <form className="composer" hidden={takenOver} inert={takenOver} onSubmit={event => { event.preventDefault(); if (ready) onSubmit(); }} onDragOver={event => event.preventDefault()} onDrop={event => {
      event.preventDefault();
      if (!disabled && !busy && !running && !takenOver) void addFiles(event.dataTransfer.files, 'draft');
    }}>
      {mentionOpen && <div className="dropdown composer-dropdown mention-palette" role="listbox" aria-label="文件引用候选">
        <div className="dropdown-label">文件</div>
        {mention.status==='loading' && <p className="mention-empty" role="status">正在读取项目文件…</p>}
        {mention.status==='error' && <p className="mention-empty" role="alert">{mention.error}</p>}
        {mentionItems.map((item,index)=><button type="button" role="option" key={item.path} aria-selected={index===mentionIndex%mentionItems.length} onMouseDown={event=>{event.preventDefault();pickMention(item);}}>{item.kind==='directory'?<FolderOpen size={15}/>:<FileText size={15}/>}<span>{item.path}{item.kind==='directory'?'/':''}</span></button>)}
        {mention.status==='ready' && !!mentionNote(mentionView) && <p className="mention-empty">{mentionNote(mentionView)}</p>}
        {mention.status==='ready' && !!mentionItems.length && <div className="mention-hint">↑↓ 选择 · Enter 插入 · Esc 关闭</div>}
      </div>}
      {!!commandOptions.length && <div className="dropdown composer-dropdown command-palette" role="listbox" aria-label="内核与界面命令"><div className="dropdown-label">命令</div>{commandOptions.map(([command,label,description,Icon],index)=><button type="button" role="option" aria-selected={index===commandIndex%commandOptions.length} key={command} onClick={()=>chooseCommand(command)}><Icon size={16}/><span><strong>{command}<small>{label}</small></strong><small>{description}</small></span></button>)}</div>}
      {!!files.length && <div className="attachment-chips">{files.map(file => <div className={`attachment-chip ${file.status !== 'ready' ? 'invalid' : ''}`} key={file.id}>
        <FileText size={19}/><button type="button" className="attachment-name" title={file.name} onClick={() => openModal({ type: 'document', value: file })}><strong>{file.name}</strong><small>{fileReadLabel(file)}</small></button>
        <IconButton icon={X} label={`移除附件 ${file.name}`} onClick={() => setFiles(previous => previous.filter(item => item.id !== file.id))}/>
      </div>)}</div>}
      <div className="composer-input">
        <textarea ref={composer} aria-label="聊天输入框" aria-describedby="composer-shortcuts" placeholder={running ? '再交代一件，本轮结束后自动发送…' : '交代一件事，或添加要处理的资料…'} value={input} rows={2} maxLength={60000} disabled={disabled || voiceActive || takenOver} onPaste={event => { if (event.clipboardData.files.length && !disabled && !busy && !running && !takenOver) { event.preventDefault(); void addFiles(event.clipboardData.files, 'draft'); } }} onChange={event => {setCommandIndex(0);setInput(event.target.value);updateMention(event.target.value,event.target.selectionStart);}} onSelect={event => updateMention(event.target.value,event.target.selectionStart??event.target.value.length)} onKeyUp={event => updateMention(event.target.value,event.target.selectionStart??event.target.value.length)} onClick={event => updateMention(event.target.value,event.target.selectionStart??event.target.value.length)} onScroll={event => markMoreBelow(event.currentTarget)} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (mentionOpen && event.key === 'Escape') { event.preventDefault();event.stopPropagation();mentionDismissed.current=mentionSignature(mention.token);invalidateMention();setMention(null);return; }
          if (mentionOpen && mentionItems.length && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault();setMentionIndex(previous=>(previous+(event.key==='ArrowDown'?1:-1)+mentionItems.length)%mentionItems.length);return; }
          if (mentionOpen && mentionItems.length && (event.key==='Enter'||event.key==='Tab') && !event.shiftKey) { event.preventDefault();pickMention(mentionItems[mentionIndex%mentionItems.length]);return; }
          if (event.key === 'Escape' && commandOptions.length) { event.preventDefault();event.stopPropagation();setDismissedInput(input);return; }
          if (commandOptions.length && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault();setCommandIndex(previous=>(previous+(event.key==='ArrowDown'?1:-1)+commandOptions.length)%commandOptions.length);return; }
          if (commandOptions.length && (event.key==='Tab'&&!event.shiftKey || event.key==='Enter'&&!event.shiftKey&&!parseSessionCommand(input)&&!commandOptions.some(row=>row[0]===input))) { event.preventDefault();chooseCommand(commandOptions[commandIndex%commandOptions.length][0]);return; }
          if (event.key === 'Tab' && event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); insertCommand(parseSessionCommand(input)?.name === 'plan' ? '' : '/plan'); return; }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            if (ready) onSubmit();
          }
        }}/>
      </div>
      <div className="composer-toolbar">
        <div className="composer-tools">
          <div className="menu-anchor attachment-menu-anchor">
            <IconButton icon={Plus} label="添加内容" aria-expanded={menu?.name === 'attach'} className="add-attachment" disabled={disabled || running || busy} onClick={event => toggleMenu('attach', event)}/>
            {!takenOver && menu?.name === 'attach' && <div className="dropdown composer-dropdown attachment-menu" role="menu" aria-label="添加内容" onKeyDown={menuKeys}>
              <div className="dropdown-label">添加</div>
              <button type="button" role="menuitem" className="attachment-action" onClick={() => chooseFiles()}><Paperclip size={16}/><span>文件<small>从本机添加资料</small></span><kbd>Ctrl O</kbd></button>
              <button type="button" role="menuitem" className="attachment-action" onClick={() => { closeMenu(); openWorkbench('files'); }}><FolderOpen size={16}/><span>项目文件夹<small>浏览当前工作区文件</small></span><CaretRight size={13}/></button>
              <button type="button" role="menuitem" className="attachment-action" onClick={() => openModal({ type: 'attach-library' })}><Files size={16}/><span>资料空间<small>选择已读取的工作材料</small></span></button>
              <button type="button" role="menuitem" className="attachment-action" onClick={() => { closeMenu(); openWorkbench('browser'); }}><Globe size={16}/><span>附加网页<small>打开内置浏览器并选择页面</small></span></button>
              <button type="button" role="menuitem" className="attachment-action" onClick={() => insertCommand('/goal')}><Target size={16}/><span>目标<small>设置要持续追求的目标</small></span></button>
              <button type="button" role="menuitem" className="attachment-action" onClick={() => insertCommand('/plan')}><Lightbulb size={16}/><span>计划模式<small>先完善计划，再批准执行</small></span><kbd>Shift Tab</kbd></button>
              <div className="dropdown-label">办公</div>
              <button type="button" role="menuitem" className="attachment-action" onClick={() => openModal({ type: 'templates' })}><FileText size={16}/><span>办公模板<small>纪要、周报和文稿</small></span></button>
              <div className="dropdown-label">工具连接</div>
              {connections.filter(server => server.enabled).map(server => <button type="button" role="menuitem" className="attachment-action" key={server.serverName} onClick={() => openModal({type:'settings',tab:'MCP 连接'})}><Plugs size={16}/><span>{server.serverName}<small>已配置 · MCP {server.transport === 'stdio' ? '本机程序' : '远程服务'}</small></span><CaretRight size={13}/></button>)}
              <button type="button" role="menuitem" className="attachment-action" onClick={() => openModal({type:'settings',tab:'MCP 连接'})}><Plus size={16}/><span>连接工具<small>通过 MCP 添加你的业务系统</small></span></button>
            </div>}
          </div>
          <div className="menu-anchor">
            <button type="button" className={`permission-trigger ${selectedPermission.id === 'full' ? 'full' : ''}`} aria-label="更改权限" aria-expanded={menu?.name === 'permissions'} title="选择文件操作的批准方式" onClick={event => toggleMenu('permissions', event)}>{selectedPermission.id === 'full' ? <ShieldWarning size={14}/> : selectedPermission.id === 'ask' ? <Hand size={14}/> : <ShieldCheck size={14}/>}<span>{selectedPermission.short}</span></button>
            {!takenOver && menu?.name === 'permissions' && <div className="dropdown composer-dropdown permission-dropdown" role="menu" aria-label="更改权限" onKeyDown={event => {
              const buttons=[...event.currentTarget.querySelectorAll('[role="menuitemradio"]')];
              const index=buttons.indexOf(document.activeElement);
              if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
              if(event.key==='Home'){event.preventDefault();buttons[0]?.focus();}
              if(event.key==='End'){event.preventDefault();buttons.at(-1)?.focus();}
            }}>
              <div className="permission-menu-heading"><span>应如何推进操作？</span><button type="button" onClick={() => openModal({ type: 'settings', tab: '权限与工具' })}>了解更多</button></div>
              {PERMISSION_MODES.map(item => { const Icon = item.id === 'ask' ? Hand : item.id === 'auto' ? ShieldCheck : ShieldWarning; return <button type="button" key={item.id} role="menuitemradio" aria-checked={selectedPermission.id === item.id} className={`permission-option ${item.id === 'full' ? 'full' : ''}`} onClick={() => { closeMenu(); if (item.id === 'full' && selectedPermission.id !== 'full') openModal({ type: 'full-access' }); else setSetting('permission', item.id); }}><Icon size={16}/><span><strong>{item.label}</strong><small>{item.description}</small></span>{selectedPermission.id === item.id && <Check size={15}/>}</button>; })}
            </div>}
          </div>
          <button type="button" className={`privacy-indicator ${redacted ? '' : 'raw'}`} aria-label={`发送方式：${redacted ? '脱敏模式' : '非脱敏模式'}`} title="在设置中选择发送方式" onClick={() => openModal({ type: 'settings', tab: '隐私与数据' })}><PrivacyIcon size={13}/><span>{redacted ? '脱敏' : '原文'}</span></button>
        </div>
        <div className="composer-tools">
          {busy && <span className="composer-status" role="status" title="正在读取资料或准备发送"><CircleNotch size={14}/><span className="screen-reader-only">正在读取资料或准备发送</span></span>}
          <ModelControls settings={settings} runtime={runtime} setRuntime={setRuntime} setSetting={setSetting}
            disabled={disabled || busy || voiceActive || takenOver} menu={takenOver ? null : menu?.name} toggleMenu={toggleMenu} closeMenu={closeMenu}
            openConnection={() => openModal({ type: 'settings', tab: '供应商' })}/>
          <VoiceInput key={scopeKey} scopeKey={scopeKey} language={settings.voiceLanguage} disabled={disabled || running || busy || suspended || takenOver} onActiveChange={setVoiceActive} onAccept={text => { setInput(previous => (previous + (previous && !/\s$/.test(previous) ? '\n' : '') + text).slice(0, 60000)); requestAnimationFrame(() => composer.current?.focus()); }} openSettings={() => openModal({type:'settings',tab:'语音'})}/>
          {running && <button type="button" className="send-button stop-generating" aria-label="停止生成" title="停止生成" onClick={onStop}><Stop size={14} weight="fill"/></button>}
          <button type="submit" className="send-button" aria-label={running ? '排队发送' : '发送消息'} title={running ? '排队发送（本轮结束后自动发出）' : '发送消息（Enter）'} disabled={!ready}><ArrowUp size={15} weight="regular"/></button>
        </div>
      </div>
    </form>
    <span className="screen-reader-only" id="composer-shortcuts">Enter 发送，Shift + Enter 换行</span>
  </div>;
}

const {app,BrowserWindow,ipcMain,safeStorage,dialog,Notification,protocol,net,session,shell,clipboard}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
protocol.registerSchemesAsPrivileged([{scheme:'zhixing',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setName('知行');
const APP_ID = app.isPackaged ? 'cn.zhixing.office' : 'cn.zhixing.office.development';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
const userDataOverride=app.commandLine.getSwitchValue('user-data-dir');
if(userDataOverride&&path.isAbsolute(userDataOverride))app.setPath('userData',userDataOverride);
const ROOT=path.join(app.getPath('userData'),'zhixing'),VAULTS=path.join(ROOT,'vaults');
const firstInstance=app.requestSingleInstanceLock();
let windowRef,manager,automations,automationsReady,browserService,terminalService,speechService,servicesReady,fileWatcher,autoUpdater,appLog,updateState={status:'idle'},installingUpdate=false,deliverableAccess,deliveryService,nativeSessionExport,quitting=false,workspaceSaveQueue,workspaceContext,resolveProjectContext;
let quitAckResolver;
let mcpServers=[],providers=[],providerTail=Promise.resolve(),providerApi,pluginService;
const runtimeEventSequences=new Map();
let worktreeOperation;
let configuration={model:'deepseek-flash',reasoning:'high',baseUrl:'https://api.deepseek.com/anthropic',credentialRevision:0,contextWindow:128000,maxTokens:8192};
let normaliseKernel,validateKernel,projectCoreApi,containsCredential;
const SAFE_ID=/^[a-zA-Z0-9_-]{1,100}$/;
// Launch timing stays available for diagnosis: set ZHIXING_STARTUP_TRACE=1 to
// print each stage on stderr. Unset, the helper does nothing.
const STARTUP_TRACE=process.env.ZHIXING_STARTUP_TRACE==='1';
const startupMark=label=>{if(STARTUP_TRACE)process.stderr.write(`[startup] ${label} +${Math.round(process.uptime()*1000)}ms\n`);};
startupMark('main:module');
const WORKSPACE_FILE=path.join(ROOT,'workspace.bin');
const DRAFTS_FILE=path.join(ROOT,'drafts.bin');
const FEEDBACK_FILE=path.join(ROOT,'feedback.bin');
// 反馈失败码沿用桌面版词汇，界面按这里的中文句子显示，不把码直接丢给用户。
const FEEDBACK_ERRORS={'rating-invalid':'请先选择赞或踩。','category-invalid':'分类不在可选范围内。','note-blank':'备注只有空格，请填写内容或留空。','note-too-large':'备注超过 8192 字节，请精简后重试。','message-missing':'这条消息还没有可用的定位，无法记录反馈。'};
const VISUAL_ROOT=path.join(ROOT,'visual');
const VOLATILE_TERMS=Symbol('volatileTerms');
const stagedVisuals=new Map();
const pendingVisualDeletes=new Set();
let visualApi,volatileTerms=[];
async function writeEncrypted(target,text){
 if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 用户加密不可用，数据没有写入磁盘。');
 const temp=`${target}.${randomUUID()}.tmp`;
 try{await fs.writeFile(temp,safeStorage.encryptString(text));await fs.rename(temp,target);}finally{await fs.unlink(temp).catch(()=>{});}
}
async function readEncrypted(target){
 try{return safeStorage.decryptString(await fs.readFile(target));}catch(e){
  if(e.code==='ENOENT')return null;
  // eslint-disable-next-line preserve-caught-error -- Keep private file paths and crypto internals out of the public IPC error.
  throw new Error('本机加密文件无法读取。');
 }
}
async function readWorkspaceState(){
 const {loadWorkspacePersistence}=await import('./workspace-persistence.mjs');
 return loadWorkspacePersistence({readWorkspace:()=>readEncrypted(WORKSPACE_FILE),readDrafts:()=>readEncrypted(DRAFTS_FILE)});
}
function visualReferences(state){
 const records=[...(state.documents||[]),...Object.values(state.drafts||{}).flatMap(draft=>draft?.files||[]),
  ...(state.chats||[]).flatMap(chat=>(chat?.messages||[]).flatMap(message=>message?.files||[]))];
 return new Set(records.map(record=>record?.visual?.visualId).filter(id=>typeof id==='string'&&visualApi.VISUAL_ID.test(id)));
}
const visualFile=id=>path.join(VISUAL_ROOT,id+'.bin');
function currentVisionPrivacy(){
 const settings=workspaceContext.settings;
 return visualApi.visionPrivacy(settings.persist===false?{...settings,customTerms:volatileTerms}:settings,deliverySecrets());
}
function stageVisual(record){
 if(stagedVisuals.has(record.id))return;
 while(stagedVisuals.size>=32)stagedVisuals.delete(stagedVisuals.keys().next().value);
 stagedVisuals.set(record.id,record);
}
async function parseAttachedMaterial(name,bytes){
 if(!visualApi.supportsVisualImage(name))return (await import('./office-files.mjs')).parseLocalMaterial(name,bytes);
 await workspaceSaveQueue.flush();
 const {parsed,record}=await visualApi.prepareVisualAttachment({name,bytes,privacy:currentVisionPrivacy()});
 // Drafts that are removed or superseded while reading never create a disk image.
 stageVisual(record);
 return parsed;
}
async function initialise(){
 await fs.mkdir(VAULTS,{recursive:true});
 ({normaliseKernel,validateKernel}=await import('../src/kernel-config.js'));
 ({containsCredential}=await import('../src/privacy-recognizers.js'));
 configuration.kernel=normaliseKernel();
 try{const saved=JSON.parse(await fs.readFile(path.join(ROOT,'config.json'),'utf8'));for(const key of ['model','reasoning'])if(typeof saved[key]==='string')configuration[key]=saved[key];for(const key of ['contextWindow','maxTokens'])if(Number.isSafeInteger(saved[key])&&saved[key]>=1024&&saved[key]<=2000000)configuration[key]=saved[key];if(saved.baseUrl)configuration.baseUrl=validEndpoint(saved.baseUrl);if(Number.isSafeInteger(saved.credentialRevision))configuration.credentialRevision=saved.credentialRevision;configuration.kernel=normaliseKernel(saved.kernel);}catch{/* Keep the existing defaults when optional configuration cannot be read. */}
 providerApi=await import('./providers.mjs');
 const {PluginService}=await import('./plugin-service.mjs');
 pluginService=new PluginService({directory:path.join(ROOT,'extensions')});
 startupMark('init:imports');
 const registry=await readEncrypted(path.join(ROOT,'providers.bin'));
 if(registry!==null)providers=JSON.parse(registry);
 else {
  const legacy=providerApi.legacyProvider(configuration,await readEncrypted(path.join(ROOT,'deepseek.credential')));
  if(legacy)await persistProviders([legacy]);
 }
 const {RuntimeManager}=await import('./runtime.mjs');
 visualApi=await import('./visual-attachments.mjs');
 const {validateMcpServers}=await import('./mcp-config.mjs');
 mcpServers=validateMcpServers(JSON.parse(await readEncrypted(path.join(ROOT,'mcp.bin')))||[]);
 const {mergeState}=await import('../src/store.js');
 projectCoreApi=await import('../src/project-core.js');
 resolveProjectContext=projectCoreApi.projectContext;
 const persistedWorkspace=await readWorkspaceState();
 workspaceContext=mergeState(persistedWorkspace.state);
 startupMark('init:state');
 const {DeliveryService}=await import('./delivery-service.mjs');
 deliveryService=new DeliveryService({getSettings:()=>workspaceContext.settings,getSecrets:deliverySecrets});
 const {WorkspacePersistence}=await import('./workspace-persistence.mjs');
 workspaceSaveQueue=new WorkspacePersistence({
  initialState:workspaceContext,initialEpoch:persistedWorkspace.epoch,
  write:async({kind,state,body,revision})=>{
   if(!state.settings?.persist&&manager.runs.size)throw Object.assign(new Error('请先停止正在运行的任务，再关闭本地保存。'),{code:'WORKSPACE_BUSY'});
   const previousVisuals=visualReferences(workspaceContext);
   const nextVisuals=state.settings?.persist?visualReferences(state):new Set();
   if(workspaceContext.settings.persist!==false&&state.settings?.persist===false){
    for(const id of [...previousVisuals].slice(-32)){
     const record=JSON.parse(await readEncrypted(visualFile(id)));
     if(record?.id===id)stageVisual(record);
    }
   }
   for(const id of nextVisuals){
    const record=stagedVisuals.get(id);
    if(!record)continue;
    await fs.mkdir(VISUAL_ROOT,{recursive:true});
    await writeEncrypted(visualFile(id),JSON.stringify(record));
   }
   await writeEncrypted(kind==='workspace'?WORKSPACE_FILE:DRAFTS_FILE,body);
   workspaceContext=kind==='workspace'?JSON.parse(body):{...workspaceContext,drafts:JSON.parse(body).drafts};
   delete workspaceContext.draftEpoch;
   volatileTerms=state.settings?.persist?[]:state[VOLATILE_TERMS]??volatileTerms;
   for(const id of previousVisuals)if(!nextVisuals.has(id))pendingVisualDeletes.add(id);
   for(const id of nextVisuals){stagedVisuals.delete(id);pendingVisualDeletes.delete(id);}
   // The new baseline already invalidates the old epoch. Remove obsolete
   // encrypted content too; a failed cleanup remains visible and retryable.
   if(kind==='workspace')await fs.unlink(DRAFTS_FILE).catch(error=>{if(error.code!=='ENOENT')throw error;});
   for(const id of pendingVisualDeletes){
    await fs.unlink(visualFile(id)).catch(error=>{if(error.code!=='ENOENT')throw error;});
    pendingVisualDeletes.delete(id);
   }
   if(!workspaceContext.settings?.persist){
    await automations.clearSavedData();
    await manager.clearSavedHistory();
    for(const file of await fs.readdir(VAULTS))if(/^[\w-]+\.bin$/.test(file)&&!manager.busy.has(file.slice(0,-4)))await fs.unlink(path.join(VAULTS,file));
   }
   logEvent('info','workspace.persisted',{kind,bytes:Buffer.byteLength(body,'utf8'),revision});
  },
  onState:state=>{if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('workspace:save-state',state);},
 });
 manager=new RuntimeManager({root:path.join(ROOT,'harness'),readVault:async id=>JSON.parse(await readEncrypted(path.join(VAULTS,`${id}.bin`))),writeVault:(id,value)=>writeEncrypted(path.join(VAULTS,`${id}.bin`),JSON.stringify(value)),onApproval:async request=>{
  let detail;try{detail=JSON.parse(request.reason);}catch{return {outcome:'rejected'};}
  if(!request.toolName.startsWith('mcp__')&&!['office_read_file','office_write_file','office_list_files','office_convert','office_recalculate','write','edit','apply_patch','office_execute','web_search','web_fetch','list_mcp_resources','list_mcp_resource_templates','read_mcp_resource','office_browser','workflow','office_schedule','present'].includes(request.toolName)||typeof detail?.path!=='string')return {outcome:'rejected'};
  if(request.signal?.aborted)return {outcome:'rejected'};
  const answer=await dialog.showMessageBox(windowRef,{type:'question',title:detail.command?'批准本次命令':detail.network?'批准本次联网':'批准本次文件操作',message:detail.operation||'操作需要批准',detail:`${detail.path}\n\n${detail.command?`${detail.command}\n\n命令可访问项目外文件和网络，请核对后批准。`:detail.network?`${JSON.stringify(detail.network)}\n\n仅批准本次联网操作。`:detail.overwrite?'此操作会覆盖已有文件。':'只批准本次操作，不改变权限模式。'}`,buttons:['拒绝','仅允许本次'],defaultId:0,cancelId:0,noLink:true,signal:request.signal});
  return {outcome:answer.response===1?'allowed-once':'rejected'};
 },onEvent:e=>{
  const sequence=(runtimeEventSequences.get(e.runId)||0)+1;
  runtimeEventSequences.set(e.runId,sequence);
  const event={...e,sequence,time:e.time??Date.now()};
  if(event.type==='run/terminal'&&event.finalization?.processStatus!=='cleanup_pending'){runtimeEventSequences.delete(event.runId);}
  if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('agent:event',event);
  void automations?.recordEvent(event).catch(()=>{});
 }});
 const {DeliverableAccess}=await import('./deliverable-access.mjs');
 startupMark('init:kernel');
 deliverableAccess=new DeliverableAccess({root:ROOT,getWorkspace:()=>workspaceContext,readVault:async id=>manager.volatileVaults.get(id)??JSON.parse(await readEncrypted(path.join(VAULTS,`${id}.bin`)))});
 const {NativeSessionExport}=await import('./native-session-export.mjs');
 nativeSessionExport=new NativeSessionExport({root:ROOT,getWorkspace:()=>workspaceContext,readVault:id=>manager.readVault(id),isBusy:id=>manager.busy.has(id),delivery:deliveryService});
 const {AutomationService}=await import('./automation-service.mjs');
 automations=new AutomationService({read:async()=>JSON.parse(await readEncrypted(path.join(ROOT,'automations.bin'))),write:value=>writeEncrypted(path.join(ROOT,'automations.bin'),JSON.stringify(value)),getContext:()=>workspaceContext,getConfiguration:settings=>({kernel:configuration.kernel,...providerApi.resolveProvider(providers,settings)}),getKey:config=>currentCredential(config).key,runtime:manager,onChange:value=>{if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('automation:change',value);},notify:notifyTask});
 // Automation state and the panel services do not gate the first window: they
 // start here or on first use, and every handler that needs them waits.
 automationsReady=automations.initialise(workspaceContext.automations);
 startupMark('init:automations');
 const {automationTool}=await import('./automation-tools.mjs'); manager.automationAction=(scope,input,signal)=>{signal.throwIfAborted();return automationTool(automations,scope,input);};

}
function ensureServices(){
 servicesReady??=(async()=>{
  const {BrowserService}=await import('./browser-service.mjs'),{TerminalService}=await import('./terminal-service.mjs');
  browserService=new BrowserService({electron:require('electron'),getWindow:()=>windowRef,onChange:value=>{if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('browser:change',value);}});
  manager.browserAction=(scope,input,signal)=>{signal.throwIfAborted();return browserService.agentAction(scope,input);};
  terminalService=new TerminalService({onEvent:value=>{if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('terminal:event',value);}});
  const {SpeechService}=await import('./speech-service.mjs');
  speechService=new SpeechService(value=>{if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('speech:event',value);},{dataRoot:path.join(ROOT,'speech','sensevoice-int8')});
  const {FileWatcher}=await import('./file-watcher.mjs');
  fileWatcher=new FileWatcher({onChange:(key,change)=>{if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('workspace:fs-change',{scope:key,...change});}});
  startupMark('init:services');
 })();
 return servicesReady;
}

// Auto-update stays opt-in: it only reports, never installs without a click.
// 自动更新装完不清理下载缓存：本机实测一个 0.13.8 的 323 MB 安装包从上一版
// 一直留到 0.14.3。启动时删掉已经装过的和过期的下载；正在等的更新比当前版本
// 新，会留下。失败只记日志，不影响启动。
async function pruneUpdaterCache(){
 if(!app.isPackaged)return;
 try{
  const {pruneUpdateCache,updaterCacheDir}=await import('./updater-cache.mjs');
  const cacheDir=await updaterCacheDir({resourcesPath:process.resourcesPath});
  if(!cacheDir)return;
  const report=await pruneUpdateCache({cacheDir,currentVersion:app.getVersion()});
  if(report.removed.length)logEvent('info','updater.cache-pruned',{files:report.removed.length,bytes:report.removedBytes,removed:report.removed.slice(0,8)});
 }catch(error){logEvent('error','updater.cache-prune-failed',{message:String(error?.message||error)});}
}
function logEvent(level,event,detail){void appLog?.write(level,event,detail);}
// NSIS 卸载器把自己复制到 %TEMP%\~nsu.tmp 再运行，正常退出会删掉；本机 0.14.5
// 卸载后留下了 200 KB 的 Un_A.exe。启动时只清能证明是知行留下的那一份。
async function pruneStuckUninstallerCopy(){
 if(!app.isPackaged)return;
 try{
  const {pruneStuckUninstaller}=await import('./temp-hygiene.mjs');
  const report=await pruneStuckUninstaller({tempDir:app.getPath('temp')});
  // 只删能证明是自己的目录；被占用、删除失败或还没到时间的要留痕，纯粹「别家的目录」不记事件。
  const noticed=(report.skipped||[]).filter(item=>['in-use','delete-failed','recent'].includes(item.reason));
  if(report.removed||noticed.length)logEvent('info','temp.hygiene',{targets:(report.removedDirectories||[]).map(item=>item.name),bytes:report.bytes,files:report.files,reason:report.reason,skipped:noticed});
 }catch(error){logEvent('error','temp.hygiene-failed',{message:String(error?.message||error)});}
}
function publishUpdate(next){
 updateState={...next,at:new Date().toISOString()};
 logEvent(next.status==='error'?'error':'info','update.state',{status:next.status,version:next.version,percent:next.percent,message:next.message});
 if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('update:state',updateState);
}
async function ensureUpdater(){
 if(autoUpdater)return autoUpdater;
 const loaded=await import('electron-updater');
 const updater=loaded.autoUpdater||loaded.default?.autoUpdater;
 if(!updater)throw new Error('无法加载自动更新模块。');
 updater.autoDownload=false;
 updater.autoInstallOnAppQuit=false;
 updater.allowPrerelease=true;
 if(process.env.ZHIXING_UPDATE_FEED)updater.setFeedURL({provider:'generic',url:process.env.ZHIXING_UPDATE_FEED});
 updater.on('checking-for-update',()=>publishUpdate({status:'checking'}));
 updater.on('update-available',info=>publishUpdate({status:'available',version:info.version}));
 updater.on('update-not-available',()=>publishUpdate({status:'current'}));
 updater.on('download-progress',progress=>publishUpdate({status:'downloading',percent:Math.round(progress.percent),transferred:progress.transferred,total:progress.total}));
 updater.on('update-downloaded',info=>publishUpdate({status:'downloaded',version:info.version}));
 updater.on('error',error=>publishUpdate({status:'error',message:String(error?.message||error)}));
 autoUpdater=updater;
 return updater;
}
function workScope(options={}){const {workspace,project,workspaceRoot}=resolveProjectContext(workspaceContext,options);return {key:`${workspace.id}:${project?.id||options.sessionId||'home'}`,workspaceRoot};}
function deliverySecrets(){return [
 ...providers.map(provider=>provider.key),
 ...mcpServers.flatMap(server=>[
  ...Object.values(server.headers||{}).flatMap(value=>typeof value==='string'&&/^\s*(?:Bearer|Basic)\s+\S+\s*$/i.test(value)?[value,value.trim().replace(/^(?:Bearer|Basic)\s+/i,'')]:[value]),
  ...Object.entries(server.env||{}).filter(([name])=>/key|token|secret|password|credential|authorization/i.test(name)).map(([,value])=>value),
 ]),
];}
function notifyTask(payload){if(Notification.isSupported())new Notification({title:'知行 · 定时任务',body:String(payload?.label||'任务状态已更新').slice(0,160)}).show();}
async function persistProviders(next){
 await writeEncrypted(path.join(ROOT,'providers.bin'),JSON.stringify(next));providers=next;
}
function changeProviders(update){
 const job=providerTail.then(async()=>{
  const next=await update(providers);
  await persistProviders(next);
  return runtimeStatus();
 });
 providerTail=job.catch(()=>{});
 return job;
}
function currentCredential(config){
 const provider=providers.find(row=>row.id===config.providerId);
 if(!provider||provider.credentialRevision!==config.credentialRevision||provider.baseUrl!==config.baseUrl||provider.protocol!==config.protocol)throw new Error('供应商连接已更新，请重新选择模型或审阅。');
 providerApi.assertModelCredential(provider.key);
 const current=providerApi.resolveProvider(providers,{providerId:config.providerId,modelId:config.model,reasoning:config.requestedReasoning||config.reasoning});
 if(['model','reasoning','requestedReasoning','effectiveReasoning','wireReasoning','maxTokens','contextWindow','compat','reasoningMap','inputModalities'].some(field=>JSON.stringify(current[field])!==JSON.stringify(config[field])))throw new Error('模型目录或推理设置已更新，请重新交办。');
 if(config.extensions&&(pluginService.operation||JSON.stringify(config.extensions)!==JSON.stringify(pluginService.selection())))throw new Error('已启用的插件有变化，请重新交办。');
 return {config,key:provider.key};
}
async function runtimeStatus(){return {configured:providers.length>0,providers:providerApi.publicProviders(providers),models:providerApi.providerModels(providers),version:`DeepSeek Harness ${require('@deepseek-ai/dsh/package.json').version}`,tools:['数字计算','日期计算','表格检查','读取办公文件','生成办公文件','列出目录','PowerShell 终端','原生计划','原生技能','交互提问',...(configuration.kernel.webEnabled?['网页读取','内置浏览器']:[]),...(configuration.kernel.subagentDepth?['原生子任务']:[]),...(configuration.kernel.workflowEnabled?['多 Agent 工作流','后台作业']:[]),'加密上下文恢复','上下文压缩'],capability:'harness-office',kernel:configuration.kernel,appVersion:require('../package.json').version};}
function trusted(event){if(!windowRef||event.sender!==windowRef.webContents||event.senderFrame!==windowRef.webContents.mainFrame||event.senderFrame.url!=='zhixing://app/index.html')throw new Error('请求来源无效。');}
function handle(channel,fn,ready){
 // Panel services and automation state finish after the window is shown, so any
 // channel that touches them waits for the matching readiness promise first.
 const gate=ready||(/^(?:browser|terminal|speech):/.test(channel)?ensureServices:/^automation:/.test(channel)?()=>automationsReady:null);
 ipcMain.handle(channel,async(event,...args)=>{trusted(event);try{if(gate)await gate();return await fn(...args);}catch(e){
 const message=String(e.message||'操作未完成');
 if(/dsh profile|ERR_MODULE_NOT_FOUND|stderr tail/i.test(message)){
  // eslint-disable-next-line preserve-caught-error -- Harness stderr and startup internals must not cross the renderer boundary through cause.
  throw new Error('DeepSeek 内核启动失败。请打开设置检查内核，或使用最新安装包重新安装。');
 }
 // eslint-disable-next-line preserve-caught-error -- The original cause could contain credentials removed from this bounded public message.
 throw new Error(message.replace(/sk-[A-Za-z0-9_-]{12,}/g,'[已隐藏凭据]').slice(0,600));
}});}
function requestRendererFlush(){
 if(!windowRef||windowRef.isDestroyed()||windowRef.webContents.isDestroyed())return workspaceSaveQueue.flush();
 if(quitAckResolver)return Promise.reject(new Error('工作空间退出保存正在进行。'));
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(new Error('等待窗口保存确认超时。')),15000);
  function finish(error){clearTimeout(timer);quitAckResolver=null;error?reject(error):resolve();}
  quitAckResolver=finish;
  windowRef.webContents.send('app:prepare-to-quit');
 });
}
function validEndpoint(value){let url;try{url=new URL(value);}catch{throw new Error('请输入完整的模型服务地址。');}if(url.username||url.password||url.search||url.hash)throw new Error('服务地址不能包含凭据、查询参数或片段。');if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('服务地址需要 HTTPS；本机测试服务可用 HTTP。');if(url.hostname==='api.deepseek.com'&&url.pathname==='/')url.pathname='/anthropic';return url.href.replace(/\/$/,'');}
function route(options={}){
 const {workspaceRoot}=resolveProjectContext(workspaceContext,options);
 const permission=['ask','auto','full'].includes(options.permission)?options.permission:workspaceContext.settings.permission||'ask';
 if(workspaceRoot&&permission==='full'&&pluginService.operation)throw new Error('插件正在变更，请完成后再交办。');
 const extensions=workspaceRoot&&permission==='full'?pluginService.selection():null;
 const selected=options.model!==undefined||options.modelId!==undefined||options.modelProviderId!==undefined||options.providerId!==undefined;
 const resolved=providerApi.resolveProvider(providers,selected?{providerId:options.providerId??options.modelProviderId,modelId:options.modelId??options.model,reasoning:options.requestedReasoning??options.reasoning??configuration.reasoning}:{providerId:'deepseek',modelId:configuration.model,reasoning:configuration.reasoning});
 const blockedServer=mcpServers.find(server=>server.enabled&&server.credentialReentryRequired);
 if(blockedServer)throw new Error(`MCP「${blockedServer.serverName}」连接地址或程序已变化，请重新填写凭据。`);
 return {...configuration,...resolved,mcpServers,persist:workspaceContext.settings.persist,automationScope:{workspaceId:options.workspaceId||workspaceContext.workspaceId,projectId:options.projectId||null},browserScope:workScope(options).key,permission,workspaceRoot,extensions,privacyPolicy:workspaceContext.settings.privacyPolicy};
}
function registerHandlers(){
 handle('plugins:manage',async input=>{
  const mutates=['install','enable','remove','update','market-install','confirm-builds'].includes(input?.action);
  if(mutates&&manager.runs.size)throw new Error('请等当前交办结束，再修改插件。');
  if(input?.action==='enable'&&input.enabled===true){
   const reply=await dialog.showMessageBox(windowRef,{type:'question',title:'启用 Harness 插件',message:`启用 ${String(input.name||'').slice(0,200)}？`,detail:'此插件将在选择「完全访问」的项目交办中运行。插件代码以你的 Windows 账户运行，可读取本机文件或联网。知行会保护模型请求；插件自行发出的请求由插件负责。',buttons:['取消','信任并启用'],defaultId:0,cancelId:0,noLink:true});
   if(reply.response!==1)return {cancelled:true};
   if(manager.runs.size)throw new Error('请等当前交办结束，再修改插件。');
  }
  return pluginService.run(input,async({request,builds})=>{
   const result=await dialog.showMessageBox(windowRef,{
    type:'warning',title:'批准插件构建脚本',message:`允许 ${request.expectedName||request.name} ${request.version} 的依赖运行构建脚本？`,
    detail:`依赖：\n${builds.join('\n')}\n\n脚本使用当前 Windows 用户权限。批准会记录在知行插件档案中。`,
    buttons:['拒绝','允许并继续'],defaultId:0,cancelId:0,noLink:true,
   });
   return result.response===1&&!manager.runs.size;
  });
 });
 handle('browser:state',options=>browserService.snapshot(workScope(options).key));
 handle('browser:action',options=>browserService.action(workScope(options).key,options));
 handle('browser:layout',options=>browserService.layout(workScope(options).key,options));
 handle('browser:read',async options=>{const value=await browserService.read(workScope(options).key,options.id);return {id:randomUUID(),name:value.title||new URL(value.url).hostname,size:Buffer.byteLength(value.text),text:`网页来源：${value.url}\n页面标题：${value.title}\n\n${value.text}`,status:'ready',sourceUrl:value.url};});
 handle('browser:external',options=>browserService.external(workScope(options).key,options.id));
 handle('browser:capture',async options=>{
  const scope=workScope(options);
  const image=await browserService.capture(scope.key,options.id);
  const filename='网页截图.png';
  const target=await dialog.showSaveDialog(windowRef,{title:'保存网页截图',defaultPath:scope.workspaceRoot?path.join(scope.workspaceRoot,filename):filename,filters:[{name:'PNG 图片',extensions:['png']}]});
  if(target.canceled||!target.filePath)return {cancelled:true};
  await fs.writeFile(target.filePath,image);
  return {name:path.basename(target.filePath)};
 });
 handle('terminal:action',async options=>{await workspaceSaveQueue.flush();const scope=workScope(options);if(!scope.workspaceRoot)throw new Error('请先在项目设置中选择工作区，再打开终端。');return terminalService.request({...options,scope:scope.key,cwd:await fs.realpath(scope.workspaceRoot)});});
 handle('workspace:list-files',async options=>{await workspaceSaveQueue.flush();const {listWorkspaceFiles}=await import('./workspace-files.mjs');return listWorkspaceFiles(workScope(options).workspaceRoot,options.path||'');});
 handle('workspace:watch',async options=>{await ensureServices();const scope=workScope(options);
  if(!scope.workspaceRoot)return {watching:false,scope:scope.key};
  return {watching:fileWatcher.watch(scope.key,scope.workspaceRoot),scope:scope.key};});
 handle('workspace:unwatch',options=>{const scope=workScope(options);return {watching:!(fileWatcher?.unwatch(scope.key)??true),scope:scope.key};});
 handle('workspace:worktree',async({action,name,workspaceId,projectId}={})=>{
  await workspaceSaveQueue.flush();
  if(worktreeOperation)throw new Error('正在处理另一项工作树操作。');
  const {workspace,project,workspaceRoot}=resolveProjectContext(workspaceContext,{workspaceId,projectId});
  if(!project||!['create','restore'].includes(action))throw new Error('请选择工作树所属的项目。');
  const record=action==='restore'?project.worktree:null;
  if(action==='restore'&&!record||action==='create'&&project.worktree)throw new Error('请在原 Git 项目创建工作树，或选择已有的工作树项目恢复。');
  const repository=record?projectCoreApi.projectWorktreeSourceContext(workspaceContext,record,workspace.id).workspaceRoot:workspaceRoot;
  if(record&&project.directory!==record.path)throw new Error('项目目录已变化，无法恢复原工作树。');
  const controller=new AbortController();
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);
  const job=(async()=>{const {runProjectWorktree}=await import('./project-worktree.mjs');return runProjectWorktree(path.join(ROOT,'worktrees'),repository,{name,record},signal);})();
  worktreeOperation={job,controller};
  try{return await job;}finally{worktreeOperation=null;}
 });
 handle('workspace:read-file',async options=>{await workspaceSaveQueue.flush();const {readWorkspaceFile}=await import('./workspace-files.mjs');return readWorkspaceFile(workScope(options).workspaceRoot,options.path);});
 handle('deliverables:list',async options=>{await workspaceSaveQueue.flush();return deliverableAccess.list(options);});
 handle('deliverables:action',async options=>{
  const action=options?.action;
  if(action!=='open'&&action!=='reveal')throw Object.assign(new Error('未知的交付文件操作。'),{code:'DELIVERABLE_ACTION'});
  const file=await deliverableAccess.locate(options);
  if(action==='reveal'){shell.showItemInFolder(file.path);return {kind:'revealed',name:file.name};}
  const failureMessage=await shell.openPath(file.path);
  if(failureMessage)throw Object.assign(new Error('系统没有可用的默认应用：'+failureMessage),{code:'DELIVERABLE_OPEN'});
  return {kind:'opened',name:file.name};
});
handle('deliverables:read',async options=>{await workspaceSaveQueue.flush();return deliverableAccess.read(options);});
 handle('workspace:office-layout',async options=>{
  await workspaceSaveQueue.flush();
  const {runOfficeLayout,recognizeOfficePage}=await import('./office-layout.mjs');
  const {workspaceRoot}=workScope(options);
  if(options.action==='ocr')return recognizeOfficePage(workspaceRoot,options);
  if(!['preview','convert','recalculate'].includes(options.action))throw new Error('未知的 Office 操作。');
  const result=await runOfficeLayout(workspaceRoot,options);
  if(options.action==='preview')return result;
  const format=options.format;
  const stem=path.parse(result.name).name;
  const name=`${stem}${options.action==='recalculate'?'-重算':''}.${format}`;
  const selected=await dialog.showSaveDialog(windowRef,{defaultPath:path.join(workspaceRoot,name),filters:[{name:format.toUpperCase(),extensions:[format]}]});
  if(selected.canceled||!selected.filePath)return {saved:false};
  if(path.extname(selected.filePath).toLowerCase()!==`.${format}`)throw new Error('保存文件的扩展名必须与所选格式一致。');
  try {await fs.writeFile(selected.filePath,Buffer.from(result.bytes,'base64'),{flag:'wx'});}
  catch(error){
   if(error.code==='EEXIST'){
    // eslint-disable-next-line preserve-caught-error -- The user-facing conflict message intentionally omits the private native target path.
    throw new Error('已有同名文件，请另选文件名。');
   }
   throw error;
  }
  return {saved:true,name:path.basename(selected.filePath),missingFonts:result.missingFonts};
 });
 handle('workspace:reveal-file',async options=>{const {workspaceTarget}=await import('./workspace-files.mjs');const {target}=await workspaceTarget(workScope(options).workspaceRoot,options.path||'');require('electron').shell.showItemInFolder(target);return true;});
 handle('workspace:zip',async options=>{
  await workspaceSaveQueue.flush();
  const scope=workScope(options);
  if(!scope.workspaceRoot)throw new Error('请先在项目设置中选择工作区。');
  const {workspaceTarget,isPrivateRelative}=await import('./workspace-files.mjs');
  const {target}=await workspaceTarget(scope.workspaceRoot,options.path||'');
  const info=await fs.stat(target).catch(()=>null);
  if(!info?.isDirectory())throw new Error('只能把文件夹打包成 ZIP。');
  const {collectDirectory,buildZip}=await import('./zip-writer.mjs');
  const {entries,skipped}=await collectDirectory({root:target,skip:name=>isPrivateRelative(name)});
  if(!entries.length)throw new Error('这个文件夹里没有可打包的文件。');
  const suggested=path.join(scope.workspaceRoot,`${path.basename(target)||'workspace'}.zip`);
  const result=await dialog.showSaveDialog(windowRef,{title:'打包为 ZIP',defaultPath:suggested,filters:[{name:'ZIP',extensions:['zip']}]});
  if(result.canceled||!result.filePath)return {cancelled:true};
  const targetFile=path.extname(result.filePath).toLowerCase()==='.zip'?result.filePath:`${result.filePath}.zip`;
  const bytes=buildZip(entries);
  await workspaceSaveQueue.flush();
  await fs.writeFile(targetFile,bytes);
  logEvent('info','workspace.zip',{entries:entries.length,skipped,bytes:bytes.length});
  return {cancelled:false,path:targetFile,entries:entries.length,skipped,bytes:bytes.length};
 });
 handle('subagent:archive',async options=>{
  const text=typeof options?.text==='string'?options.text:'';
  if(!text.trim())throw new Error('没有可归档的子会话内容。');
  const bytes=Buffer.byteLength(text);
  if(bytes>2*1024*1024)throw new Error('子会话内容超过 2 MB，无法归档。');
 const {archiveFileName,numberedName}=await import('./archive-name.mjs');
  let folder;
  try{const scope=workScope(options);folder=scope.workspaceRoot&&path.isAbsolute(scope.workspaceRoot)?scope.workspaceRoot:undefined;}catch{folder=undefined;}
  const filename=archiveFileName({title:options.name,index:Number.isInteger(options.index)?options.index:undefined});
  const result=await dialog.showSaveDialog(windowRef,{title:'归档子会话',defaultPath:folder?path.join(folder,filename):filename,filters:[{name:'Markdown',extensions:['md']}]});
  if(result.canceled||!result.filePath)return {cancelled:true};
  const chosen=path.extname(result.filePath).toLowerCase()==='.md'?result.filePath:`${result.filePath}.md`;
  let target=chosen;
  for(let attempt=1;attempt<=20;attempt+=1){
   try{await fs.writeFile(target,text,{encoding:'utf8',flag:'wx'});break;}
   catch(error){
    if(error.code!=='EEXIST')throw error;
    if(attempt===20){
     // eslint-disable-next-line preserve-caught-error -- Report the exhausted safe-name choice without returning the private archive path via cause.
     throw new Error('同名归档已存在，且无法再命名，请换一个文件名。');
    }
    target=path.join(path.dirname(chosen),numberedName(path.basename(chosen),attempt+1));
   }
  }
  logEvent('info','subagent.archive',{bytes,messages:Number.isInteger(options.messageCount)?options.messageCount:null});
  return {cancelled:false,path:target,bytes};
 });
 handle('app:runtime-status',runtimeStatus);
 handle('providers:save',input=>changeProviders(async rows=>{
  if(!input||typeof input!=='object')throw new Error('供应商格式无效。');
  const provider=await providerApi.saveProvider(input,rows);
  if(rows.length>=32&&!rows.some(row=>row.id===provider.id))throw new Error('最多可连接 32 个供应商。');
  return rows.some(row=>row.id===provider.id)?rows.map(row=>row.id===provider.id?provider:row):[...rows,provider];
 }));
 handle('providers:remove',id=>changeProviders(rows=>rows.filter(row=>row.id!==id)));
 handle('providers:hidden-model',options=>changeProviders(rows=>providerApi.setModelHidden(rows,options||{})));
 handle('providers:restore-models',id=>changeProviders(rows=>providerApi.restoreProviderModels(rows,id)));
 handle('providers:refresh',id=>changeProviders(async rows=>{
  const provider=rows.find(row=>row.id===id);
  if(!provider)throw new Error('所选供应商已移除。');
  const refreshed=await providerApi.saveProvider({...provider,manualModels:provider.models.filter(row=>row.source==='configured').map(row=>row.id).join('\n'),discover:true},rows);
  return rows.map(row=>row.id===id?refreshed:row);
 }));
 handle('speech:status',()=>speechService.status());
 handle('speech:prepare',({downloadSource}={})=>speechService.prepare(downloadSource));
 handle('speech:cancel-preparation',()=>speechService.cancelPreparation());
 handle('speech:start',({language,id})=>speechService.start(language,id));
 handle('speech:transcribe',({id,audioBase64})=>speechService.transcribe(id,audioBase64));
 handle('speech:cancel',id=>speechService.cancel(id));
 handle('app:check-desktop-release',async()=>{const {checkDesktopRelease}=await import('./desktop-release.mjs');return checkDesktopRelease(require('../package.json').version);});
 handle('app:open-official-release',async({tag})=>{const {officialReleaseUrl}=await import('./desktop-release.mjs');await shell.openExternal(officialReleaseUrl(tag));return true;});
 handle('app:check-kernel-version',async()=>{const {checkOfficialKernel}=await import('./kernel-version.mjs');return checkOfficialKernel();});
 handle('app:configure-kernel',async value=>{const kernel=validateKernel(value),next={...configuration,kernel};await fs.writeFile(path.join(ROOT,'config.json'),JSON.stringify(next,null,2));configuration=next;return runtimeStatus();});
 handle('app:inspect-kernel',async(options={})=>{
  await workspaceSaveQueue.flush();
  const {workspaceRoot}=resolveProjectContext(workspaceContext,options);
  const selected=options.providerId!==undefined||options.modelId!==undefined;
  const resolved=selected?providerApi.resolveProvider(providers,{providerId:options.providerId,modelId:options.modelId,reasoning:options.reasoning}):null;
  const permission=['ask','auto','full'].includes(options.permission)?options.permission:workspaceContext.settings.permission||'ask';
  const report=await manager.check({...configuration,...resolved,permission,workspaceRoot,mcpServers:[]},'zhixing-local-inspection');
  return {...report,inspection:{selectedRoute:selected,projectBound:Boolean(workspaceRoot),externalConnections:false}};
 });
 handle('skills:list',async options=>manager.check({...configuration,workspaceRoot:workScope(options).workspaceRoot,mcpServers:[]},'zhixing-local-inspection').then(value=>value.skills));
 handle('mcp:list',async()=>{const {publicMcpServers}=await import('./mcp-config.mjs');return publicMcpServers(mcpServers);});
 handle('mcp:save',async value=>{
  const {validateMcpServers,publicMcpServers,updateMcpServer}=await import('./mcp-config.mjs');
  if(!Array.isArray(value))throw new Error('MCP 配置格式无效。');
  const next=validateMcpServers(value.map(server=>{
   const old=mcpServers.find(item=>item.serverName===server.serverName);
   return old?updateMcpServer(old,server).server:server;
  }));
  await writeEncrypted(path.join(ROOT,'mcp.bin'),JSON.stringify(next));mcpServers=next;return publicMcpServers(next);
 });
 handle('mcp:check',async()=>{if(mcpServers.some(server=>server.enabled&&server.credentialReentryRequired))throw new Error('有 MCP 服务的目标已变化，请在连接设置中重新填写凭据。');try{return await manager.check({...configuration,mcpServers},'zhixing-startup-check');}catch{throw new Error('MCP 连接失败，请检查程序路径、地址、凭据和服务状态。');}});
 handle('data:load',async()=>{
  await workspaceSaveQueue.flush();
  return (await readWorkspaceState()).state;
 });
 handle('data:import-deepseek',async options=>{
  await workspaceSaveQueue.flush();
  resolveProjectContext(workspaceContext,options);
  const selected=await dialog.showOpenDialog(windowRef,{title:'选择 DeepSeek 聊天导出',properties:['openFile'],filters:[{name:'DeepSeek 导出 ZIP',extensions:['zip']}]});
  if(selected.canceled||!selected.filePaths.length)return null;
  const {importDeepSeekChats}=await import('./chat-import.mjs');
  const result=await importDeepSeekChats(selected.filePaths[0]);
  await workspaceSaveQueue.flush();
  const {workspace,project}=resolveProjectContext(workspaceContext,options);
  const chats=result.chats.map(chat=>({...chat,workspaceId:workspace.id,projectId:project?.id||null,mode:workspace.type,importedFrom:'deepseek'}));
  if(workspaceContext.settings.persist&&Buffer.byteLength(JSON.stringify({...workspaceContext,chats:[...workspaceContext.chats,...chats]}),'utf8')>12*1024*1024)throw Object.assign(new Error('导入后本地工作空间会超过 12 MiB。请先导出部分资料后再导入。'),{code:'WORKSPACE_LIMIT'});
  return {...result,chats};
 });
 handle('data:save',async (state,terms)=>{
  if(![1,2].includes(state?.version)||!Array.isArray(state.projects)||!Array.isArray(state.chats)||!Array.isArray(state.automations))throw new Error('本地工作空间格式不正确。');
  if(state.settings?.persist===false&&Array.isArray(terms))state[VOLATILE_TERMS]=terms.filter(term=>typeof term==='string'&&term.length<=120).slice(0,100);
  const result=workspaceSaveQueue.saveWorkspace(state);
  await result;
  void automationsReady.then(()=>automations.tick()).catch(()=>{});
  return true;
 });
 handle('data:save-drafts',async drafts=>{
  await workspaceSaveQueue.saveDrafts(drafts);
  return true;
 });
 // 消息反馈：与 Harness 桌面版 dsh-message-feedback 同口径——只写本机 Session 之外的独立文件，
 // 不进模型历史，也不随工作空间导出。
 handle('feedback:load',async()=>{
  const text=await readEncrypted(FEEDBACK_FILE);
  if(!text)return {entries:[]};
  try{const data=JSON.parse(text);return {entries:Array.isArray(data?.entries)?data.entries:[]};}catch{throw new Error('本机反馈记录无法读取。');}
 });
 handle('feedback:save',async input=>{
  const {feedbackEntry,mergeFeedback}=await import('./message-feedback.mjs');
  const result=feedbackEntry(input);
  if(!result.ok)throw new Error(FEEDBACK_ERRORS[result.code]||'反馈格式不正确。');
  const current=await readEncrypted(FEEDBACK_FILE);
  let entries=[];
  if(current){try{const data=JSON.parse(current);entries=Array.isArray(data?.entries)?data.entries:[];}catch{throw new Error('本机反馈记录无法读取。');}}
  const merged=mergeFeedback(entries,result.value).slice(-2000);
  await writeEncrypted(FEEDBACK_FILE,JSON.stringify({version:1,entries:merged}));
  return result.value;
 });
 handle('feedback:clear',async ({conversationId,messageId}={})=>{
  const {removeFeedback}=await import('./message-feedback.mjs');
  const current=await readEncrypted(FEEDBACK_FILE);
  if(!current)return true;
  let entries;
  try{const data=JSON.parse(current);entries=Array.isArray(data?.entries)?data.entries:[];}catch{throw new Error('本机反馈记录无法读取。');}
  await writeEncrypted(FEEDBACK_FILE,JSON.stringify({version:1,entries:removeFeedback(entries,String(conversationId||''),String(messageId||''))}));
  return true;
 });
 handle('data:save-status',()=>workspaceSaveQueue.state());
 handle('data:save-retry',()=>workspaceSaveQueue.retry());
 handle('update:state',()=>app.isPackaged?updateState:{status:'unavailable',message:'自动更新只在安装版可用。'});
 handle('update:check',async()=>{
  if(!app.isPackaged)return {status:'unavailable',message:'自动更新只在安装版可用。'};
  const updater=await ensureUpdater();
  publishUpdate({status:'checking'});
  try{await updater.checkForUpdates();}catch(error){publishUpdate({status:'error',message:String(error?.message||error)});}
  return updateState;});
 handle('update:download',async()=>{
  const updater=await ensureUpdater();
  if(updateState.status!=='available')throw new Error('当前没有可下载的更新。');
  void updater.downloadUpdate().catch(error=>publishUpdate({status:'error',message:String(error?.message||error)}));
  return updateState;});
 handle('update:install',async()=>{
  if(updateState.status!=='downloaded')throw new Error('更新尚未下载完成。');
  await ensureUpdater();
  await requestRendererFlush();
  await workspaceSaveQueue.flush();
  installingUpdate=true;
  logEvent('info','update.install',{version:updateState.version,from:app.getVersion()});
  setImmediate(()=>autoUpdater.quitAndInstall(true,true));
  return true;});
 handle('diagnostics:export',async()=>{
  let destination=process.env.ZHIXING_DIAGNOSTICS_DIR;
  if(!destination){
   const chosen=await dialog.showOpenDialog(windowRef,{title:'选择诊断信息保存目录',properties:['openDirectory','createDirectory']});
   if(chosen.canceled||!chosen.filePaths[0])return {canceled:true};
   destination=chosen.filePaths[0];
  }
  const {default:nodeOs}=await import('node:os');
  const target=path.join(destination,`zhixing-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  await fs.mkdir(target,{recursive:true});
  const stats=async file=>{try{const value=await fs.stat(file);return {bytes:value.size,modifiedAt:value.mtime.toISOString()};}catch{return null;}};
  const counts={projects:(workspaceContext?.projects||[]).length,chats:(workspaceContext?.chats||[]).length,automations:(workspaceContext?.automations||[]).length};
  const summary={
   generatedAt:new Date().toISOString(),
   app:{version:app.getVersion(),packaged:app.isPackaged,electron:process.versions.electron,node:process.versions.node,chrome:process.versions.chrome},
   system:{platform:process.platform,arch:process.arch,release:nodeOs.release(),cpus:nodeOs.cpus().length,totalMemoryMB:Math.round(nodeOs.totalmem()/1048576),freeMemoryMB:Math.round(nodeOs.freemem()/1048576),processUptimeMinutes:Math.round(process.uptime()/60)},
   data:{workspace:await stats(WORKSPACE_FILE),mcp:await stats(path.join(ROOT,'mcp.bin')),automations:await stats(path.join(ROOT,'automations.bin')),counts},
   update:updateState,
   save:workspaceSaveQueue.state()};
  await fs.writeFile(path.join(target,'diagnostics.json'),JSON.stringify(summary,null,1),'utf8');
  const copied=await appLog.copyTo(target);
  logEvent('info','diagnostics.export',{files:copied.length});
  return {canceled:false,directory:target,files:['diagnostics.json',...copied],summary};});
 ipcMain.on('app:quit-prepared',(event,result)=>{
  try{trusted(event);}catch{return;}
  if(!quitAckResolver)return;
  const finish=quitAckResolver;
  finish(result?.saved===true?null:new Error(String(result?.error||'本机工作空间没有完成保存。').slice(0,300)));
 });
 handle('agent:prepare',async options=>{
  await workspaceSaveQueue.flush();
  const config=route(options);
  currentCredential(config);
  if([options?.prompt,options?.bootstrapPrompt,options?.command].some(prompt=>typeof prompt==='string'&&providers.some(({key})=>containsCredential(prompt,key))))throw new Error('检测到已配置的模型凭证，请从输入中移除。');
  const visualIds=options.visualIds??[];
  if(!Array.isArray(visualIds)||visualIds.length>visualApi.VISUAL_MAX_PER_REQUEST||visualIds.some(id=>typeof id!=='string'||!visualApi.VISUAL_ID.test(id)))throw new Error('每次可添加最多 4 张已准备的视觉图片。');
  const vision=currentVisionPrivacy(),visualAttachments=[];
  if(visualIds.length){
   if(options.privacyMode!==vision.privacyMode)throw new Error('图片发送方式已变化，请重新添加图片。');
   for(const id of new Set(visualIds)){
    const record=stagedVisuals.get(id)??JSON.parse(await readEncrypted(visualFile(id)));
    visualAttachments.push(visualApi.readVisualAttachment(record,id,vision.key));
   }
  }
  const visualPolicyKey=options.privacyMode===vision.privacyMode?vision.key:null;
  const visualPrivacy=visualPolicyKey&&config.workspaceRoot&&config.inputModalities?.includes('image')?vision:undefined;
  return manager.preview({...options,visualAttachments,...(visualAttachments.length||visualPrivacy?{customTerms:vision.terms}:{})},{...config,visualPolicyKey,visualPrivacy,manualControls:true});
 });
 handle('agent:run-prepared',async options=>{
  await workspaceSaveQueue.flush();
  return manager.runPrepared(options,config=>{
   if(config.visualPolicyKey&&config.visualPolicyKey!==currentVisionPrivacy().key)throw new Error('隐私规则或凭证已变化，请重新交办。');
   return currentCredential(config);
  });
 });
 handle('agent:cancel',async({runId})=>manager.cancel(runId));
 handle('agent:cleanup-status',()=>manager.getCleanupStatus());
 handle('agent:retry-cleanup',({runId})=>manager.retryCleanup(runId));
 handle('agent:control-execution',value=>manager.controlExecution(value));
 handle('agent:answer-question',value=>manager.answerQuestion(value));
 handle('automation:list',()=>automations.snapshot());
 handle('automation:preview-timing',value=>automations.previewTiming(value));
 handle('automation:save',async value=>{await workspaceSaveQueue.flush();return automations.save(value);});
 handle('automation:prepare',async({id,action})=>{await workspaceSaveQueue.flush();return automations.prepare(id,action);});
 handle('automation:confirm',async({approvalId})=>{await workspaceSaveQueue.flush();return automations.confirm(approvalId);});
 handle('automation:toggle',async({id,enabled})=>{await workspaceSaveQueue.flush();return automations.toggle(id,enabled);});
 handle('automation:remove',({id})=>automations.remove(id));
 handle('automation:remind',({id})=>automations.runReminder(id));
 handle('automation:cancel',({id})=>automations.cancel(id));
 handle('automation:retry-save',({runId})=>automations.retrySave(runId));
 handle('agent:forget',async({sessionId})=>{
  if(typeof sessionId!=='string'||!SAFE_ID.test(sessionId))throw new Error('会话编号无效。');
  await manager.forgetSessionState(sessionId,async()=>{
  const parent=path.join(ROOT,'harness'),target=path.resolve(parent,sessionId);
  if(path.dirname(target)!==parent)throw new Error('会话目录不在应用工作区内。');
  const stat=await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(stat){if(stat.isSymbolicLink()||path.dirname(await fs.realpath(target))!==path.join(await fs.realpath(ROOT),'harness'))throw new Error('会话目录不在应用工作区内。');await fs.rm(target,{recursive:true,force:true});}
  await fs.unlink(path.join(VAULTS,`${sessionId}.bin`)).catch(e=>{if(e.code!=='ENOENT')throw e;});
  });
  deliveryService.invalidateAll();
  return true;
 });
 handle('files:parse',async({name,bytes})=>{
  if(typeof name!=='string'||!ArrayBuffer.isView(bytes)||bytes.byteLength>10*1024*1024)throw new Error('文件超过 10 MB 或参数无效。');
  return parseAttachedMaterial(name,Buffer.from(bytes));
 });
 handle('space:choose-folder',async()=>{
  const chosen=await dialog.showOpenDialog(windowRef,{title:'选择工作空间目录',properties:['openDirectory']});
  if(chosen.canceled)return null;
  return fs.realpath(chosen.filePaths[0]);
 });
 handle('files:pick',async(input)=>{
  const directory=typeof input==='string'?input:input?.directory;
  let defaultPath;
  if(typeof directory==='string'&&path.isAbsolute(directory)){
   const stat=await fs.stat(directory).catch(()=>null);
   if(stat?.isDirectory())defaultPath=directory;
  }
  const result=await dialog.showOpenDialog(windowRef,{title:'添加工作资料',defaultPath,properties:['openFile','multiSelections'],filters:[{name:'办公文档、文本和图片',extensions:['txt','md','csv','tsv','json','docx','xlsx','pptx','pdf','png','jpg','jpeg','webp','gif','bmp','tif','tiff']}]});
  if(result.canceled)return [];
  const files=[];
  for(const filePath of result.filePaths.slice(0,12)){
   const name=path.basename(filePath),id=randomUUID();let size=0;
   try{const stat=await fs.stat(filePath);size=stat.size;if(!stat.isFile()||size>10*1024*1024)throw new Error('请选用不超过 10 MB 的文件。');
   const parsed=await parseAttachedMaterial(name,await fs.readFile(filePath));
   files.push({...parsed,id});}
   catch(error){files.push({id,name,size,status:'error',reason:error.message,text:''});}
  }
  return files;
 });
 handle('delivery:prepare',async options=>{await workspaceSaveQueue.flush();return options?.format==='md'?nativeSessionExport.prepare(options):deliveryService.prepare(options);});
 handle('file:export',async(options={})=>{
  await workspaceSaveQueue.flush();
  return deliveryService.execute(options,'export',async(snapshot,validate)=>{
  const {name,format,history}=snapshot,{directory}=options;
  if(history)nativeSessionExport.assertScope(history);
  const filename=`${name}.${format}`;
  const folder=typeof directory==='string'&&path.isAbsolute(directory)&&(await fs.stat(directory).catch(()=>null))?.isDirectory()?directory:undefined;
  const result=await dialog.showSaveDialog(windowRef,{defaultPath:folder?path.join(folder,filename):filename,filters:[{name:format.toUpperCase(),extensions:[format]}]});
  if(result.canceled||!result.filePath)return {cancelled:true};
  await workspaceSaveQueue.flush();
  let bytes;
  if(history){
   if(path.extname(result.filePath).toLowerCase()!=='.md')throw new Error('请选择 .md 文件名。');
   bytes=Buffer.from(validate().text,'utf8');
  }else{
   const {exportOfficeFile}=await import('./office-files.mjs');
   bytes=await exportOfficeFile(validate().text,format);
  }
  await workspaceSaveQueue.flush();validate();
  if(history)nativeSessionExport.assertScope(history);
  await fs.writeFile(result.filePath,bytes);return {cancelled:false,path:result.filePath,reviewId:snapshot.reviewId,contentHash:snapshot.contentHash};
  });
 });
 handle('delivery:share',async options=>{await workspaceSaveQueue.flush();return deliveryService.execute(options,'share',async(snapshot,validate)=>{validate();clipboard.writeText(snapshot.text);return {copied:true,reviewId:snapshot.reviewId,contentHash:snapshot.contentHash};});});
 handle('app:clipboard-write',async({text}={})=>{
  await workspaceSaveQueue.flush();
  const snapshot=deliveryService.prepare({original:text,recipientScope:'self',action:'share'});
  const {reviewId,contentHash,policyRevision,recipientScope,format}=snapshot;
  return deliveryService.execute({reviewId,contentHash,policyRevision,recipientScope,format},'share',async reviewed=>{clipboard.writeText(reviewed.text);return true;});
 });
 handle('app:window-control',action=>{if(action==='minimize')windowRef.minimize();else if(action==='maximize')windowRef.isMaximized()?windowRef.unmaximize():windowRef.maximize();else if(action==='close')windowRef.close();return true;});
 handle('schedule:notify',payload=>{notifyTask(payload);return true;});
}
async function createWindow(){
 const appIcon=path.join(__dirname,'..','dist','client','brand','zhixing.ico');
 windowRef=new BrowserWindow({width:1255,height:912,minWidth:850,minHeight:600,show:false,frame:false,backgroundColor:'#f0f3f9',title:'知行 · AI 办公助手',icon:appIcon,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 windowRef.on('close',event=>{if(!quitting){event.preventDefault();app.quit();}});
 if (process.platform === 'win32') {
  windowRef.setAppDetails({
   appId: APP_ID,
   appIconPath: app.isPackaged ? process.execPath : appIcon,
   appIconIndex: 0,
   relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${path.join(__dirname,'main.cjs')}"`,
   relaunchDisplayName: '知行 · AI 办公助手',
  });
 }
 windowRef.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 windowRef.webContents.on('render-process-gone',()=>{if(speechService?.active)void speechService.cancel(speechService.active.id);});
 windowRef.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame&&speechService?.active)void speechService.cancel(speechService.active.id);});
 windowRef.webContents.on('will-navigate',(event,url)=>{if(url!=='zhixing://app/index.html')event.preventDefault();});
 // Reveal on the first paint instead of waiting for the whole document to
 // finish loading; the window background covers the remaining frames.
 let revealed=false;
 const reveal=()=>{if(revealed||!windowRef||windowRef.isDestroyed())return;revealed=true;windowRef.show();};
 windowRef.once('ready-to-show',reveal);
 await windowRef.loadURL('zhixing://app/index.html');
 reveal();
}
if(!firstInstance)app.quit();
else app.whenReady().then(async()=>{
 const {AppLog}=await import('./app-log.mjs');
 appLog=new AppLog({directory:path.join(ROOT,'logs')});
 // Record the version we ran last time: after an update the difference tells us
 // whether this start came from the updater rather than a manual launch.
 const versionFile=path.join(ROOT,'last-version.txt');
 const previousVersion=(await fs.readFile(versionFile,'utf8').catch(()=>'')).trim()||null;
 logEvent('info','app.start',{version:app.getVersion(),previousVersion,updated:Boolean(previousVersion&&previousVersion!==app.getVersion()),packaged:app.isPackaged,platform:process.platform,arch:process.arch,electron:process.versions.electron});
 await fs.mkdir(ROOT,{recursive:true}).catch(()=>{});
 await fs.writeFile(versionFile,app.getVersion()).catch(()=>{});
 void pruneUpdaterCache();
 void pruneStuckUninstallerCopy();
 process.on('uncaughtException',error=>logEvent('error','uncaughtException',{message:String(error?.message||error),stack:String(error?.stack||'').slice(0,2000)}));
 process.on('unhandledRejection',reason=>logEvent('error','unhandledRejection',{message:String(reason?.message||reason),stack:String(reason?.stack||'').slice(0,2000)}));
 app.on('child-process-gone',(_event,details)=>logEvent('error','child-process-gone',{type:details.type,reason:details.reason,exitCode:details.exitCode}));
 app.on('render-process-gone',(_event,_contents,details)=>logEvent('error','render-process-gone',{reason:details.reason,exitCode:details.exitCode}));
 protocol.handle('zhixing',request=>{
  const url=new URL(request.url);if(url.hostname!=='app')return new Response('Not found',{status:404});
  const root=path.join(__dirname,'..','dist','client'),file=path.resolve(root,`.${decodeURIComponent(url.pathname)}`);
  if(!file.startsWith(root+path.sep))return new Response('Forbidden',{status:403});return net.fetch(pathToFileURL(file).href);
 });
 const {permitsSpeechCapture}=await import('./speech-policy.mjs');
 const speechPermission=(webContents,permission,details)=>permitsSpeechCapture({permission,details,isMainWindow:!!windowRef&&!windowRef.isDestroyed()&&webContents===windowRef.webContents,armed:speechService?.canCapture()===true});
 session.defaultSession.setPermissionRequestHandler((webContents,permission,callback,details)=>callback(speechPermission(webContents,permission,details)));
 session.defaultSession.setPermissionCheckHandler((webContents,permission,_origin,details)=>speechPermission(webContents,permission,details));
 session.defaultSession.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"]}}));
 await initialise();startupMark('initialise:done');registerHandlers();await createWindow();startupMark('window:shown');
  void ensureServices();
  try{await automationsReady;}catch(error){dialog.showErrorBox('知行启动失败',error.message);app.quit();return;}
  automations.start();
if(app.isPackaged)setTimeout(()=>{void ensureUpdater().then(updater=>updater.checkForUpdates()).catch(()=>{});},45000).unref();
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
}).catch(e=>{dialog.showErrorBox('知行启动失败',e.message);app.quit();});
app.on('before-quit',event=>{
 if(!firstInstance){quitting=true;return;}
 if(!windowRef||!workspaceSaveQueue||!manager){quitting=true;return;}
 if(installingUpdate){quitting=true;return;}
 if(quitting)return;
 event.preventDefault();
 quitting=true;
 const pendingWorktree=worktreeOperation;
 pendingWorktree?.controller.abort();
 (async()=>{
  if(speechService?.active){
   const id=speechService.active.id;
   if(windowRef&&!windowRef.isDestroyed())windowRef.webContents.send('speech:event',{id,type:'cancelled'});
   await speechService.cancel(id);
  }
  if(speechService?.speech)await speechService.cancelPreparation();
  if(automationsReady)await automationsReady.catch(()=>{});
  await automations?.close();
  const shutdown=await manager?.close();
  if(shutdown?.cleanupPending?.length)throw new Error('任务已结束，但仍有内核退出未确认。请返回执行详情重试停止，确认退出前知行会保留会话隔离和恢复资料。');
  for(;;){
   try{await requestRendererFlush();await workspaceSaveQueue?.flush();break;}
   catch(error){
    if(!windowRef||windowRef.isDestroyed())throw error;
    const choice=await dialog.showMessageBox(windowRef,{
     type:'warning',title:'工作空间尚未保存',message:'知行无法确认最新更改已写入。',
     detail:`${error.message}\n\n任务已结束，当前运行内容会保留在窗口中。返回可检查保存状态，重试会重新保存当前工作区。`,
     buttons:['返回知行','重试保存','退出并放弃未保存更改'],defaultId:0,cancelId:0,noLink:true,
    });
    if(choice.response===0){quitting=false;automations?.start();windowRef.show();windowRef.focus();return;}
    if(choice.response===2)break;
   }
  }
  await Promise.allSettled([browserService?.close(),terminalService?.close(),speechService?.close(),pluginService?.close(),pendingWorktree?.job]);
  fileWatcher?.closeAll();
  app.quit();
 })().catch(error=>{
  if(windowRef&&!windowRef.isDestroyed())dialog.showErrorBox('知行仍在运行',`退出准备未完成，工作空间仍在窗口中。\n${error.message}`);
  quitting=false;automations?.start();windowRef?.show();windowRef?.focus();
 });
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('second-instance',()=>{if(windowRef?.isMinimized())windowRef.restore();windowRef?.show();windowRef?.focus();});




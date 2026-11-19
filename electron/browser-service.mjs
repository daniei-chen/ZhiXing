import {randomUUID,createHash} from 'node:crypto';
import {browserUrl,browserBounds} from './browser-policy.mjs';
const READ_PAGE=`(()=>({title:document.title,url:location.href,text:(document.body?.innerText||'').slice(0,100000)}))()`;
export class BrowserService{
 constructor({electron,getWindow,onChange}){this.electron=electron;this.getWindow=getWindow;this.onChange=onChange;this.scopes=new Map();this.sessions=new WeakSet();this.visible=null;this.bounds=null;}
 scope(key){if(typeof key!=='string'||key.length>180)throw new Error('浏览器所属范围无效。');if(!this.scopes.has(key))this.scopes.set(key,{tabs:new Map(),activeId:null,recent:[]});return this.scopes.get(key);}
 snapshot(key){const scope=this.scope(key);return {scope:key,activeId:scope.activeId,recent:scope.recent,tabs:[...scope.tabs.values()].map(({id,url,title,loading,error,view})=>({id,url,title,loading,error,canGoBack:view.webContents.navigationHistory.canGoBack(),canGoForward:view.webContents.navigationHistory.canGoForward()}))};}
 emit(key){this.onChange?.(this.snapshot(key));}
 create(key,url){
  const scope=this.scope(key);if(scope.tabs.size>=12)throw new Error('每个项目最多保留 12 个浏览器标签。');
  const {WebContentsView,session}=this.electron;
  const partition=`zhixing-browser-${createHash('sha256').update(key).digest('hex').slice(0,24)}`;
  const ses=session.fromPartition(partition,{cache:false});
  ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);
  if(!this.sessions.has(ses)){this.sessions.add(ses);ses.on('will-download',(_event,item)=>{item.cancel();});}
  const view=new WebContentsView({webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:true,devTools:false}});
  const tab={id:randomUUID(),view,url:'',title:'新标签页',loading:false,error:null};scope.tabs.set(tab.id,tab);scope.activeId=tab.id;
  const wc=view.webContents;
  const reject=(event,target)=>{try{browserUrl(typeof target==='string'?target:target.url);}catch{event.preventDefault();}};
  wc.on('will-navigate',reject);wc.on('will-redirect',reject);
  wc.setWindowOpenHandler(({url:target})=>{try{this.create(key,browserUrl(target));}catch{}return {action:'deny'};});
  wc.on('page-title-updated',(_event,title)=>{tab.title=title.slice(0,160);this.emit(key);});
  for(const event of ['did-navigate','did-navigate-in-page'])wc.on(event,()=>{tab.url=wc.getURL();tab.error=null;this.emit(key);});
  wc.on('did-finish-load',()=>{
   if(!tab.url||tab.error)return;
   const url=new URL(tab.url);
   scope.recent=[{url:url.origin,host:url.host},...scope.recent.filter(site=>site.url!==url.origin)].slice(0,4);
   this.emit(key);
  });
  wc.on('did-start-loading',()=>{tab.loading=true;tab.error=null;this.emit(key);});
  wc.on('did-stop-loading',()=>{tab.loading=false;this.emit(key);this.present();});
  wc.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3){tab.loading=false;tab.error='网页未能加载，请检查地址或重新加载。';this.emit(key);this.present();}});
  wc.on('render-process-gone',()=>{tab.loading=false;tab.error='网页进程已结束，请重新加载。';this.emit(key);});
  if(url)this.navigate(key,tab.id,url);this.present();this.emit(key);return this.snapshot(key);
 }
 tab(key,id){const tab=this.scope(key).tabs.get(id);if(!tab||tab.view.webContents.isDestroyed())throw new Error('浏览器标签已关闭。');return tab;}
 navigate(key,id,input){const tab=this.tab(key,id);tab.url=browserUrl(input);tab.error=null;void tab.view.webContents.loadURL(tab.url).catch(()=>{});this.emit(key);return this.snapshot(key);}
 action(key,{action,id,url}){
  if(action==='new')return this.create(key,url);
  const scope=this.scope(key),tab=this.tab(key,id);
  if(action==='select')scope.activeId=id;
  else if(action==='navigate')return this.navigate(key,id,url);
  else if(action==='back'){if(tab.view.webContents.navigationHistory.canGoBack())tab.view.webContents.navigationHistory.goBack();}
  else if(action==='forward'){if(tab.view.webContents.navigationHistory.canGoForward())tab.view.webContents.navigationHistory.goForward();}
  else if(action==='reload'){if(tab.url)tab.view.webContents.reload();}
  else if(action==='stop')tab.view.webContents.stop();
  else if(action==='close'){this.detach(tab);tab.view.webContents.close({waitForBeforeUnload:false});scope.tabs.delete(id);if(scope.activeId===id)scope.activeId=[...scope.tabs.keys()].at(-1)||null;}
  else throw new Error('浏览器操作无效。');
  this.present();this.emit(key);return this.snapshot(key);
 }
 detach(tab){const window=this.getWindow();try{window?.contentView.removeChildView(tab.view);}catch{}}
 layout(key,{visible,bounds}){if(!visible&&this.visible!==key)return true;this.visible=visible?key:null;this.bounds=bounds?browserBounds(bounds,this.getWindow().getContentSize()):null;this.present();return true;}
 present(){
  const content=this.getWindow()?.contentView;
  if(!content)return;
  for(const[key,scope]of this.scopes)for(const tab of scope.tabs.values()){
   const attached=content.children.includes(tab.view);
   const show=key===this.visible&&tab.id===scope.activeId&&tab.url&&!tab.error&&this.bounds&&this.bounds.width>=30&&this.bounds.height>=30;
   if(!show){if(attached)this.detach(tab);continue;}
   if(!attached)content.addChildView(tab.view);
   tab.view.setBounds(this.bounds);
  }
 }
 async read(key,id){const tab=this.tab(key,id);if(!tab.url||tab.loading)throw new Error('请等待网页加载后再添加。');return tab.view.webContents.executeJavaScript(READ_PAGE);}
 async capture(key,id){
  const tab=this.tab(key,id);
  if(this.visible!==key||this.scope(key).activeId!==id||!tab.url||tab.loading||tab.error)throw new Error('请等待当前网页加载后再截图。');
  const image=await tab.view.webContents.capturePage();
  if(image.isEmpty())throw new Error('当前网页没有可截图的内容。');
  return image.toPNG();
 }
 async agentAction(key,{operation,tab_id,url,element_id,text}){
  if(operation==='list')return this.snapshot(key);
  if(operation==='open'){const state=this.create(key,browserUrl(url));return {tab_id:state.activeId,url:state.tabs.find(tab=>tab.id===state.activeId)?.url};}
  const tab=this.tab(key,tab_id),wc=tab.view.webContents;
  if(operation==='snapshot')return wc.executeJavaScriptInIsolatedWorld(998,[{code:`(()=>{
   const nodes=[...document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"]')].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').slice(0,160);
   globalThis.__zhixingBrowserNodes=nodes;globalThis.__zhixingBrowserUrl=location.href;
   return {tab_id:${JSON.stringify(tab_id)},url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,70000),elements:nodes.map((node,index)=>({id:index,tag:node.tagName.toLowerCase(),type:node.type||'',label:(node.getAttribute('aria-label')||node.labels?.[0]?.innerText||node.innerText||node.placeholder||'').slice(0,180),disabled:!!node.disabled}))};
  })()`}]);
  if(operation==='click'||operation==='fill'){
   if(!Number.isInteger(element_id)||element_id<0||element_id>159)throw new Error('请先查看网页快照，再使用其中的元素编号。');
   if(operation==='fill'&&(typeof text!=='string'||text.length>8000))throw new Error('网页输入过长或无效。');
   const code=`(()=>{const node=globalThis.__zhixingBrowserNodes?.[${element_id}];if(!node||!node.isConnected||globalThis.__zhixingBrowserUrl!==location.href)throw new Error('页面已变化，请重新读取快照。');if(node.disabled)throw new Error('控件不可用。');${operation==='click'?"node.click();":"if(!['INPUT','TEXTAREA'].includes(node.tagName)||['password','file','hidden'].includes(node.type))throw new Error('此输入框不允许 Agent 填写。');const setter=Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(node,"+JSON.stringify(text)+");node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));"}return {performed:true,url:location.href};})()`;
   return wc.executeJavaScriptInIsolatedWorld(998,[{code}],true);
  }
  if(['back','forward','reload','close'].includes(operation)){this.action(key,{action:operation,id:tab_id});return {performed:true};}
  throw new Error('浏览器动作无效。');
 }
 async external(key,id){const url=browserUrl(this.tab(key,id).url);await this.electron.shell.openExternal(url);return true;}
 async close(){for(const scope of this.scopes.values())for(const tab of scope.tabs.values()){this.detach(tab);if(!tab.view.webContents.isDestroyed())tab.view.webContents.close({waitForBeforeUnload:false});}this.scopes.clear();}
}

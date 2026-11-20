const {app,BrowserWindow,WebContentsView,session,shell}=require('electron');
const assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events'),path=require('node:path'),{pathToFileURL}=require('node:url');
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html;charset=utf-8'}).end(`<title>${req.url==='/two'?'第二页':'浏览器验收'}</title><h1>真实网页视图</h1><p>合成工作资料 ${req.url}</p><a href="/two">下一页</a><label>备注<input aria-label="备注"></label><input type="password" aria-label="密码"><script>document.body.dataset.isolated=String(typeof require==='undefined'&&typeof process==='undefined');</script>`);});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const host=new BrowserWindow({show:false,width:1255,height:912,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await host.loadURL('data:text/html,<title>host</title>');
 const source=process.env.ZHIXING_TEST_PACKED_APP||path.resolve(__dirname,'..');const {BrowserService}=await import(pathToFileURL(path.join(source,'electron','browser-service.mjs')).href);const changes=[];
 const service=new BrowserService({electron:{WebContentsView,session,shell},getWindow:()=>host,onChange:value=>changes.push(value)});
 try{
  const url=`http://127.0.0.1:${server.address().port}/one`;const state=service.create('project',url),id=state.activeId;
  const wait=async expected=>{const deadline=Date.now()+12000;while(Date.now()<deadline){const tab=service.snapshot('project').tabs.find(item=>item.id===id);if(!tab.loading&&tab.title===expected)return;await new Promise(resolve=>setTimeout(resolve,40));}throw new Error('浏览器页面没有完成加载 '+JSON.stringify(service.snapshot('project')));};
  await wait('浏览器验收');service.layout('project',{visible:true,bounds:{x:600,y:130,width:600,height:700}});
  host.show();host.focus();await new Promise(resolve=>setTimeout(resolve,100));
  if(!host.isVisible())throw new Error('Browser acceptance host did not become visible');
  assert.deepEqual(service.snapshot('project').recent,[{url:new URL(url).origin,host:new URL(url).host}]);
  assert.deepEqual(service.snapshot('another-project').recent,[]);
  assert((await service.read('project',id)).text.includes('合成工作资料 /one'));
  assert.equal(await service.tab('project',id).view.webContents.executeJavaScript('document.body.dataset.isolated'),'true');
  const snapshot=await service.agentAction('project',{operation:'snapshot',tab_id:id});assert(snapshot.text.includes('合成工作资料'));const field=snapshot.elements.find(item=>item.label==='备注');
  await service.agentAction('project',{operation:'fill',tab_id:id,element_id:field.id,text:'AGENT_FILLED_OK'});
  assert.equal(await service.tab('project',id).view.webContents.executeJavaScript('document.querySelector("input").value'),'AGENT_FILLED_OK');
  await assert.rejects(service.agentAction('project',{operation:'fill',tab_id:id,element_id:snapshot.elements.find(item=>item.type==='password').id,text:'forbidden'}));
  assert.equal(await service.tab('project',id).view.webContents.executeJavaScript('document.querySelector("input[type=password]").value'),'');
  await service.agentAction('project',{operation:'click',tab_id:id,element_id:snapshot.elements.find(item=>item.tag==='a').id});await wait('第二页');
  await assert.rejects(service.agentAction('project',{operation:'fill',tab_id:id,element_id:field.id,text:'stale'}));
  service.action('project',{action:'back',id});await wait('浏览器验收');
  try {
   await new Promise(resolve=>setTimeout(resolve,300));
   const screenshot=await service.capture('project',id);
   assert.equal(screenshot.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  }catch(error){
   console.error('Browser capture diagnostic',JSON.stringify({error:error?.message||String(error),runtime:process.versions.electron,packed:process.env.ZHIXING_TEST_PACKED_APP||null,url:service.snapshot('project').tabs[0]?.url,windowSize:host.getContentSize(),visible:host.isVisible(),webContentsDestroyed:service.tab('project',id).view.webContents.isDestroyed()}));
   throw error;
  }
  service.action('project',{action:'navigate',id,url:url.replace('/one','/two')});await wait('第二页');assert(service.snapshot('project').tabs[0].canGoBack);
  assert.equal(service.snapshot('project').recent.length,1);
  service.action('project',{action:'back',id});await wait('浏览器验收');
  assert.throws(()=>service.action('project',{action:'navigate',id,url:'file:///C:/Windows/win.ini'}));
  await assert.rejects(service.read('another-project',id));
  service.layout('project',{visible:false});assert.equal(host.contentView.children.length,0);
  await assert.rejects(service.capture('project',id));
  service.action('project',{action:'close',id});assert.equal(service.snapshot('project').tabs.length,0);assert(changes.length>3);
  console.log('PASS native browser: navigation, history, read, isolation, scope, visibility, close');
 }finally{await service.close();host.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 app.quit();
}).catch(error=>{console.error(error);app.exit(1);});

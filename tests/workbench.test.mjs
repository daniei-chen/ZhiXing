import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import ExcelJS from 'exceljs';
import {strToU8,zipSync} from 'fflate';
const packed=process.env.ZHIXING_TEST_PACKED_APP;
const {browserUrl,browserBounds}=await import(packed?pathToFileURL(path.join(packed,'electron/browser-policy.mjs')).href:'../electron/browser-policy.mjs');
const {listWorkspaceFiles,readWorkspaceFile}=await import(packed?pathToFileURL(path.join(packed,'electron','workspace-files.mjs')).href:'../electron/workspace-files.mjs');
const {TerminalService}=await import(packed?pathToFileURL(path.join(packed,'electron','terminal-service.mjs')).href:'../electron/terminal-service.mjs');
const {runOfficeLayout,recognizeOfficePage}=await import(packed?pathToFileURL(path.join(packed,'electron','office-layout.mjs')).href:'../electron/office-layout.mjs');
const {exportOfficeFile}=await import(packed?pathToFileURL(path.join(packed,'electron','office-files.mjs')).href:'../electron/office-files.mjs');
const {importDeepSeekChats}=await import(packed?pathToFileURL(path.join(packed,'electron','chat-import.mjs')).href:'../electron/chat-import.mjs');
const {runProjectWorktree}=await import(packed?pathToFileURL(path.join(packed,'electron','project-worktree.mjs')).href:'../electron/project-worktree.mjs');

test('原生 Harness 从本地提交创建和恢复独立工作树', {timeout:60000},async()=>{
 const parent=await fs.realpath(os.tmpdir());
 const fixture=await fs.mkdtemp(path.join(parent,'zhixing-worktree-test-'));
 const repo=path.join(fixture,'repository'),data=path.join(fixture,'runtime');
 await fs.mkdir(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 try{
  git('init','-q');
  await fs.writeFile(path.join(repo,'fixture.txt'),'committed');
  git('add','fixture.txt');
  git('-c','user.name=Fixture','-c','user.email=qa@example.invalid','commit','-qm','initial');
  await fs.writeFile(path.join(repo,'fixture.txt'),'uncommitted');
  const originalBranch=git('branch','--show-current');
  await assert.rejects(runProjectWorktree(data,repo,{name:'../outside'}),/分支名称/);
  const record=await runProjectWorktree(data,repo,{name:'office-checkout'});
  assert.equal(record.baseCommit,git('rev-parse','HEAD'));
  assert.equal(await fs.readFile(path.join(record.path,'fixture.txt'),'utf8'),'committed');
  assert.equal(await fs.readFile(path.join(repo,'fixture.txt'),'utf8'),'uncommitted');
  assert.equal(git('branch','--show-current'),originalBranch);
  await assert.rejects(runProjectWorktree(data,repo,{record:{...record,path:fixture}}),/不匹配/);
  git('worktree','remove','--',record.path);
  const restored=await runProjectWorktree(data,repo,{record});
  assert.equal(restored.branchRecreated,false);
  assert.equal(await fs.readFile(path.join(record.path,'fixture.txt'),'utf8'),'committed');
 }finally{
  if(path.dirname(fixture)===parent&&path.basename(fixture).startsWith('zhixing-worktree-test-'))await fs.rm(fixture,{force:true,recursive:true,maxRetries:6,retryDelay:150});
 }
});

test('浏览器仅允许网页协议，排除凭据并限制视图范围',()=>{
 assert.equal(browserUrl('example.com/path'),'https://example.com/path');assert.equal(browserUrl('http://localhost:4198'),'http://localhost:4198/');
 assert.equal(browserUrl('localhost:4198'),'http://localhost:4198/');
 assert.equal(browserUrl('127.0.0.1:4198/one'),'http://127.0.0.1:4198/one');
 assert.equal(browserUrl('[::1]:4198'),'http://[::1]:4198/');
 for(const input of ['file:///C:/secret','javascript:alert(1)','data:text/html,hello','zhixing://app/index.html','https://user:pass@example.com'])assert.throws(()=>browserUrl(input));
 assert.deepEqual(browserBounds({x:-5,y:0,width:5000,height:10000},[1255,912]),{x:0,y:42,width:1255,height:870});
});
test('项目文件浏览与预览限制在工作区，私密文件不展示',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'zhixing-files-'));
 try{await fs.mkdir(path.join(root,'materials'));await fs.mkdir(path.join(root,'.ssh'));await fs.writeFile(path.join(root,'report.txt'),'合成办公资料');await fs.writeFile(path.join(root,'.env'),'synthetic');
  const tree=await listWorkspaceFiles(root);assert.deepEqual(tree.items.map(item=>item.name),['materials','report.txt']);assert.equal((await readWorkspaceFile(root,'report.txt')).text,'合成办公资料');
  await assert.rejects(listWorkspaceFiles(root,'..'),/范围/);await assert.rejects(readWorkspaceFile(root,'.env'),/范围/);
 }finally{const target=await fs.realpath(root);if(path.dirname(target)===await fs.realpath(os.tmpdir())&&path.basename(target).startsWith('zhixing-files-'))await fs.rm(target,{recursive:true,force:true});}
});
test('原生 OfficeKit 生成版面和 PDF，重算另存且保留原公式缓存',async()=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'zhixing-office-test-'));
 try{
  const file=path.join(root,'memo.docx');
  await fs.writeFile(file,await exportOfficeFile('# 版面验收\nOfficeKit 测试文档','docx'));
  const options={action:'preview',path:'memo.docx',page:1};
  const page=await runOfficeLayout(root,options);
  assert(page.pageCount>=1);
  assert.equal(Buffer.from(page.png,'base64').subarray(1,4).toString(),'PNG');
  const pdf=await runOfficeLayout(root,{action:'convert',path:options.path,format:'pdf'});
  assert.equal(Buffer.from(pdf.bytes,'base64').subarray(0,5).toString(),'%PDF-');
  await fs.writeFile(file,await exportOfficeFile('第二份文档','docx'));
  await assert.rejects(runOfficeLayout(root,{...options,version:page.version}),/文件已更新/);
  await assert.rejects(runOfficeLayout(root,{...options,path:'../private.docx'}),/项目范围/);
  const workbook=new ExcelJS.Workbook();
  workbook.addWorksheet('数据').getCell('A1').value={formula:'1+2',result:99};
  const source=await workbook.xlsx.writeBuffer();
  await fs.writeFile(path.join(root,'calc.xlsx'),source);
  const recalculated=await runOfficeLayout(root,{action:'recalculate',path:'calc.xlsx',format:'xlsx'});
  const result=new ExcelJS.Workbook();
  await result.xlsx.load(Buffer.from(recalculated.bytes,'base64'));
  assert.deepEqual(result.getWorksheet(1).getCell('A1').value,{formula:'1+2',result:3});
  assert.deepEqual(await fs.readFile(path.join(root,'calc.xlsx')),Buffer.from(source));
 }finally{
  await fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
},{timeout:45000});
test('官方 DeepSeek 导入识别当前分支，保留附件记录、图片和历史思考',async()=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'zhixing-chat-import-'));
 const file=path.join(root,'deepseek_data-fixture.zip'),time='2026-11-19T10:00:00Z',replyTime='2026-11-19T10:00:12Z';
 const conversation={id:'sample',title:'导入验收 · 示例',current_message_id:2,inserted_at:time,messages:[
  {id:1,parent_id:null,role:'USER',status:'FINISHED',inserted_at:time,fragments:[{type:'REQUEST',content:'合成提问'},{type:'FILE',files:[
   {id:'notes',file_name:'notes.txt',file_size:42,is_image:false,export_path:null},
   {id:'preview',file_name:'preview.png',is_image:true,export_path:'chat_sessions/sample_files/preview.png'},
  ]}]},
  {id:2,parent_id:1,role:'ASSISTANT',status:'FINISHED',inserted_at:replyTime,fragments:[{type:'THINK',content:'内部思考'},{type:'RESPONSE',content:'合成回复'}]},
  {id:3,parent_id:1,role:'ASSISTANT',status:'FINISHED',inserted_at:replyTime,fragments:[{type:'RESPONSE',content:'旧分支'}]},
 ]};
 const archive=version=>zipSync({...Object.fromEntries(Object.entries({
  'manifest.json':{export_format_version:version},
  'chat_session_index.json':[{id:'sample',inserted_at:time,updated_at:replyTime}],
  'chat_sessions/sample.json':conversation,
 }).map(([name,value])=>[name,strToU8(JSON.stringify(value))])),
 'chat_sessions/sample_files/preview.png':Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
 try{
  await fs.writeFile(file,archive(3));
  const result=await importDeepSeekChats(file);
  assert.equal(result.chats.length,1);
  assert.equal(result.chats[0].title,conversation.title);
  assert.deepEqual(result.chats[0].messages.map(({role,text})=>[role,text]),[['user','合成提问'],['assistant','合成回复']]);
  assert.equal(result.chats[0].messages[1].importedThinking,'内部思考');
  const [notes,preview]=result.chats[0].messages[0].files;
  assert.deepEqual(notes,{name:'notes.txt',size:42,unavailable:true});
  assert.equal(preview.image.format,'image/webp');
  const image=Buffer.from(preview.image.data,'base64');
  assert.equal(image.toString('ascii',0,4),'RIFF');
  assert.equal(image.toString('ascii',8,12),'WEBP');
  await fs.writeFile(file,archive(2));
  await assert.rejects(importDeepSeekChats(file),/第 3 版/);
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
},{timeout:15000});
test('真实 Windows OCR 读取 Office 版面的文字，并记录页面范围',{skip:process.platform!=='win32',timeout:35000},async t=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'zhixing-ocr-test-'));
 try{
  await fs.writeFile(path.join(root,'memo.docx'),await exportOfficeFile('# 验收编号 2718\n本机识别测试','docx'));
  let result;
  try{result=await recognizeOfficePage(root,{path:'memo.docx',page:1});}
  catch(error){
   if(error.message.includes('安装具有文字识别功能的语言'))return t.skip('Windows 未安装 OCR 语言');
   throw error;
  }
  assert.match(result.text.replace(/\s/g,''),/2718/);
  assert.equal(result.coverage.kind,'ocr-text');
  assert.equal(result.coverage.page,1);
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
test('真实 Harness PTY：输入、屏幕恢复、范围校验与退出',async()=>{
 const events=[],service=new TerminalService({onEvent:event=>events.push(event)});let terminal;
 try{
  terminal=await service.request({action:'create',scope:'fixture-project',cwd:process.cwd(),shell:'powershell',cols:90,rows:24});
  await service.request({action:'write',scope:'fixture-project',id:terminal.id,data:"[Console]::WriteLine('ZHIXING_INTERACTIVE_OK'); [Console]::WriteLine([string]::IsNullOrEmpty($env:ZHIXING_HISTORY_KEY))\r"});
  const deadline=Date.now()+15000;let snapshot;
  do{await new Promise(resolve=>setTimeout(resolve,80));snapshot=await service.request({action:'snapshot',scope:'fixture-project',id:terminal.id});}while((!snapshot.screen.includes('True')||!snapshot.screen.includes('ZHIXING_INTERACTIVE_OK'))&&Date.now()<deadline);
  assert(snapshot.screen.includes('True'));assert(snapshot.screen.includes('ZHIXING_INTERACTIVE_OK'));assert(events.some(event=>event.event==='data'));
  await service.request({action:'resize',scope:'fixture-project',id:terminal.id,cols:100,rows:28});assert.equal((await service.request({action:'snapshot',scope:'fixture-project',id:terminal.id})).cols,100);
  await assert.rejects(service.request({action:'write',scope:'other-project',id:terminal.id,data:'bad'}),/当前项目/);
  await service.request({action:'close',scope:'fixture-project',id:terminal.id});assert.deepEqual(await service.request({action:'list',scope:'fixture-project'}),[]);
 }finally{await service.close();}
},{timeout:45000});

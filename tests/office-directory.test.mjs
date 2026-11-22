import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleUrl = name => process.env.ZHIXING_TEST_PACKED_APP
  ? pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP, name)).href
  : new URL(`../${name}`, import.meta.url).href;
const {apply} = await import(moduleUrl('harness/office-tools.mjs'));
const {PrivacySession} = await import(moduleUrl('src/privacy-core.js'));
const {createBridgeKey,readBridge,writeBridge} = await import(moduleUrl('harness/privacy-bridge.mjs'));

async function fixture(t,{permissionMode='ask',privacyMode='redact',privacyPolicy={},customTerms=[],approval=async()=> 'allowed-once',apiKey=''}={}){
 const parent=await fs.realpath(os.tmpdir()),base=await fs.mkdtemp(path.join(parent,'zhixing-directory-'));
 const root=path.join(base,'workspace'),outside=path.join(base,'outside'),bridgeFile=path.join(base,'privacy-bridge.bin'),bridgeKey=createBridgeKey();
 const environment={ZHIXING_WORKSPACE_ROOT:root,ZHIXING_PERMISSION_MODE:permissionMode,ZHIXING_PRIVACY_MODE:privacyMode,ZHIXING_PRIVACY_POLICY:JSON.stringify(privacyPolicy),ZHIXING_CUSTOM_TERMS:JSON.stringify(customTerms),ZHIXING_BRIDGE_FILE:bridgeFile,ZHIXING_BRIDGE_KEY:bridgeKey,ZHIXING_KERNEL:'{}',ZHIXING_AUTOMATION_BRIDGE:'',ZHIXING_BROWSER_BRIDGE:'',DEEPSEEK_API_KEY:apiKey};
 const previous=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]]));
 t.after(async()=>{
  for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  const resolved=await fs.realpath(base);assert.equal(path.dirname(resolved),parent);assert(path.basename(resolved).startsWith('zhixing-directory-'));
  await fs.rm(resolved,{recursive:true,force:true,maxRetries:6,retryDelay:100});
 });
 await fs.mkdir(root);await fs.mkdir(outside);
 await writeBridge(bridgeFile,bridgeKey,new PrivacySession('directory-test').exportState());
 Object.assign(process.env,environment);
 const registered=new Map(),approvals=[];
 apply({tools:{register:tool=>registered.set(tool.name,tool),guard(){}},on(){},approval:{async request(request){approvals.push(request);return approval(request);}}});
 const tool=registered.get('office_list_files');assert(tool);
 return {base,root,outside,bridgeFile,bridgeKey,tool,approvals,
  run:(args={},signal=new AbortController().signal)=>tool.execute({directory:root,...args},{name:'office_list_files',callId:'directory-call',agent:{id:'directory-agent'},signal}),
  async vault(){const saved=await readBridge(bridgeFile,bridgeKey);return new PrivacySession(saved.id,saved);},
 };
}
const fileNames=count=>Array.from({length:count},(_,i)=>`item-${String(i).padStart(5,'0')}.txt`);
async function files(directory,names){
 for(let i=0;i<names.length;i+=50)await Promise.all(names.slice(i,i+50).map(name=>fs.writeFile(path.join(directory,name),'')));
}
function pageInfo(result){
 const {offset,limit,total_entries,next_offset,truncated}=result;return {offset,limit,total_entries,next_offset,truncated};
}
function entry(name,type='file'){
 return {name,isFile:()=>type==='file',isDirectory:()=>type==='directory',isSymbolicLink:()=>type==='link'};
}
function fakeDirectory(t,count,{hidden=false,onEntry=()=>{},onClose=()=>{}}={}){
 let opened=0,read=0,closed=0;
 t.mock.method(fs,'opendir',async()=>{
  opened++;
  return {async *[Symbol.asyncIterator](){try{for(let i=0;i<count;i++){read++;await onEntry(i);yield entry(`${hidden?'.':''}item-${String(i).padStart(5,'0')}.txt`);}}finally{closed++;await onClose();}}};
 });
 return ()=>({opened,read,closed});
}

for(const count of [0,1,119,120,121])test(`R10 真实目录 ${count} 项：旧调用保持兼容并明确完整性`,async t=>{
 const fx=await fixture(t),names=fileNames(count);await files(fx.root,[...names].reverse());
 const first=await fx.run();
 assert.deepEqual(first.entries,names.slice(0,120).map(name=>({name,type:'file'})));
 assert.deepEqual(pageInfo(first),{offset:0,limit:120,total_entries:count,next_offset:count>120?120:null,truncated:count>120});
 assert.equal((await fx.vault()).restore(first.directory).text,fx.root);
 assert.equal(fx.approvals.length,0);
 if(first.next_offset!==null){
  const last=await fx.run({directory:first.directory,offset:first.next_offset});
  assert.deepEqual(last.entries,names.slice(120).map(name=>({name,type:'file'})));
  assert.deepEqual(pageInfo(last),{offset:120,limit:120,total_entries:count,next_offset:null,truncated:false});
 }
 const end=await fx.run({offset:count,limit:1});assert.deepEqual(end.entries,[]);assert.equal(end.next_offset,null);assert.equal(end.truncated,false);
 await assert.rejects(fx.run({offset:count+1}),/INVALID_DIRECTORY_PAGE/);
});

test('R10 真实 1000 项目录逐页完整、稳定、无重漏，末页不伪称截断',async t=>{
 const fx=await fixture(t),names=fileNames(1000);await files(fx.root,[...names].reverse());
 const found=[];let offset=0,pages=0;
 do{
  const result=await fx.run({offset});pages++;assert.equal(result.total_entries,1000);assert.equal(result.offset,offset);
  assert.equal(result.truncated,result.next_offset!==null);assert(result.entries.length<=120);
  if(result.next_offset!==null)assert.equal(result.next_offset,offset+result.entries.length);
  found.push(...result.entries.map(item=>item.name));offset=result.next_offset;
 }while(offset!==null);
 assert.equal(pages,9);assert.deepEqual(found,names);assert.equal(new Set(found).size,1000);
 assert.deepEqual((await fx.run()).entries,names.slice(0,120).map(name=>({name,type:'file'})));
});

test('R10 UTF-16 顺序独立于创建顺序、语言与文件类型；自定义页大小可连续遍历',async t=>{
 const fx=await fixture(t),names=['中文.txt','zeta.txt','äther.txt','Zulu','alpha.txt','Aardvark.txt','😀.txt','a10.txt','a2.txt'];
 await fs.mkdir(path.join(fx.root,'Zulu'));await files(fx.root,names.filter(name=>name!=='Zulu'));
 const sorted=[...names].sort(),found=[];
 for(let offset=0;offset<names.length;offset+=2){
  const result=await fx.run({offset,limit:2});assert.equal(result.limit,2);found.push(...result.entries.map(item=>item.name));
  for(const item of result.entries)assert.equal(item.type,item.name==='Zulu'?'directory':'file');
 }
 assert.deepEqual(found,sorted);
});

test('R10 页参数严格校验，拒绝时不读映射、不扫描、不发起审批',async t=>{
 const fx=await fixture(t),reads=t.mock.method(fs,'readFile',async()=>{throw new Error('unexpected read');}),opens=t.mock.method(fs,'opendir',async()=>{throw new Error('unexpected open');});
 assert.equal(fx.tool.parameters.properties.offset.type,'integer');assert.equal(fx.tool.parameters.properties.limit.type,'integer');
 assert.deepEqual(fx.tool.parameters.required,['directory']);
 for(const offset of [-1,0.5,'1',null,NaN,Infinity,10001,Number.MAX_SAFE_INTEGER+1])await assert.rejects(fx.run({directory:fx.outside,offset}));
 for(const limit of [0,-1,0.5,'2',null,NaN,Infinity,121,Number.MAX_SAFE_INTEGER+1])await assert.rejects(fx.run({directory:fx.outside,limit}));
 assert.equal(reads.mock.callCount(),0);assert.equal(opens.mock.callCount(),0);assert.equal(fx.approvals.length,0);
});

test('R10 10000 个直接条目可完整统计；最后偏移量 10000 返回空终页',async t=>{
 const fx=await fixture(t),stats=fakeDirectory(t,10000);
 const first=await fx.run();assert.deepEqual(pageInfo(first),{offset:0,limit:120,total_entries:10000,next_offset:120,truncated:true});
 const last=await fx.run({offset:9960});assert.equal(last.entries.length,40);assert.equal(last.entries.at(-1).name,'item-09999.txt');assert.equal(last.next_offset,null);
 const end=await fx.run({offset:10000,limit:1});assert.equal(end.entries.length,0);assert.equal(end.truncated,false);
 assert.deepEqual(stats(),{opened:3,read:30000,closed:3});
});

for(const hidden of [false,true])test(`R10 超大${hidden?'隐藏':'可见'}目录显式拒绝，最多探测 10001 项且关闭句柄`,async t=>{
 const fx=await fixture(t),stats=fakeDirectory(t,1000000,{hidden});
 await assert.rejects(fx.run(),/DIRECTORY_SCAN_LIMIT.*10000/);
 assert.deepEqual(stats(),{opened:1,read:10001,closed:1});
 assert.equal((await fx.vault()).exportState().entries.length,0);
});

test('R10 真实 10001 项目录达到扫描上限，明确报错且不返回截断页',async t=>{
 const fx=await fixture(t);await files(fx.root,fileNames(10001));
 await assert.rejects(fx.run(),/DIRECTORY_SCAN_LIMIT.*10000/);
 assert.equal((await fx.vault()).exportState().entries.length,0);
});

test('R10 排除隐藏项、禁止位置与链接；不递归且不读取文件内容',async t=>{
 const fx=await fixture(t),visible=['ordinary.txt','nested'];
 await files(fx.root,['ordinary.txt','.hidden','.env','.env.production','private.pem','private.key','private.pfx','deepseek.credential','workspace.bin','automations.bin','privacy-bridge.bin']);
 await fs.mkdir(path.join(fx.root,'nested'));await files(path.join(fx.root,'nested'),['must-not-be-read.txt']);
 await fs.mkdir(path.join(fx.root,'vaults'));await fs.mkdir(path.join(fx.root,'.ssh'));
 await fs.symlink(fx.outside,path.join(fx.root,'linked-outside'),'junction');
 const nativeRead=fs.readFile,nativeOpen=fs.opendir,opened=[];
 t.mock.method(fs,'readFile',async(file,...args)=>{assert.equal(file,fx.bridgeFile,'only the privacy bridge may be read');return nativeRead(file,...args);});
 t.mock.method(fs,'opendir',async(directory,...args)=>{opened.push(directory);return nativeOpen(directory,...args);});
 const result=await fx.run();assert.deepEqual(result.entries.map(item=>item.name),visible.sort());assert.equal(result.total_entries,2);assert.equal(result.truncated,false);
 assert.deepEqual(opened,[fx.root]);assert.equal(fx.approvals.length,0);
 await assert.rejects(fx.run({directory:path.join(fx.root,'vaults')}),/私密记录/);
});

test('R10 非普通目录项不伪装成文件',async t=>{
 const fx=await fixture(t);
 t.mock.method(fs,'opendir',async()=>({async *[Symbol.asyncIterator](){yield entry('pipe','special');yield entry('socket','special');yield entry('linked','link');yield entry('normal.txt');}}));
 const result=await fx.run();assert.deepEqual(result.entries,[{name:'normal.txt',type:'file'}]);assert.equal(result.total_entries,1);
});

test('R10 只接受目录，路径错误不回显原始绝对路径或敏感文件名',async t=>{
 const fx=await fixture(t);await files(fx.root,['ordinary.txt']);
 await assert.rejects(fx.run({directory:path.join(fx.root,'ordinary.txt')}),/NOT_DIRECTORY/);
 await assert.rejects(fx.run({directory:path.join(fx.root,'audit.person@example.test')}),error=>{
  assert.match(error.message,/DIRECTORY_READ_FAILED.*ENOENT/);assert(!error.message.includes(fx.root));assert(!error.message.includes('audit.person@example.test'));return true;
 });
});

for(const permissionMode of ['ask','auto','full'])test(`R10 ${permissionMode} 模式保留外部真实目录主机审批`,async t=>{
 const fx=await fixture(t,{permissionMode});await files(fx.outside,['outside.txt']);
 const result=await fx.run({directory:fx.outside,limit:1});assert.equal(result.entries[0].name,'outside.txt');
 assert.equal(fx.approvals.length,permissionMode==='full'?0:1);
 if(permissionMode!=='full'){
  const request=fx.approvals[0];assert.equal(request.toolName,'office_list_files');assert.equal(request.callId,'directory-call');
  assert.deepEqual(JSON.parse(request.reason),{operation:'列出目录',path:fx.outside,overwrite:false});assert(request.signal instanceof AbortSignal);
 }
});

test('R10 拒绝审批后不打开外部目录',async t=>{
 const fx=await fixture(t,{approval:async()=> 'denied'}),opens=t.mock.method(fs,'opendir',async()=>{throw new Error('unexpected open');});
 await assert.rejects(fx.run({directory:fx.outside}),/未获批准/);assert.equal(fx.approvals.length,1);assert.equal(opens.mock.callCount(),0);
});

test('R10 工作区内的外链按真实外部路径审批；脱敏目录可用于续页',async t=>{
 const fx=await fixture(t);await files(fx.outside,['one.txt','two.txt']);
 const link=path.join(fx.root,'external-link');await fs.symlink(fx.outside,link,'junction');
 const first=await fx.run({directory:link,limit:1});assert.equal(JSON.parse(fx.approvals[0].reason).path,fx.outside);
 const second=await fx.run({directory:first.directory,offset:first.next_offset,limit:1});
 assert.equal(second.entries[0].name,'two.txt');assert.equal(fx.approvals.length,2);assert.equal(second.next_offset,null);
});

test('R10 审批等待时目录改成外链，拒绝使用旧批准位置',async t=>{
 let target,replacement;
 const fx=await fixture(t,{approval:async()=>{await fs.rmdir(target);await fs.symlink(replacement,target,'junction');return 'allowed-once';}});
 target=fx.outside;replacement=path.join(fx.base,'replacement');await fs.mkdir(replacement);
 const opens=t.mock.method(fs,'opendir',async()=>{throw new Error('unexpected open');});
 await assert.rejects(fx.run({directory:target}),/NOT_DIRECTORY|DIRECTORY_CHANGED/);assert.equal(opens.mock.callCount(),0);
});

test('R10 扫描期间目录变化则拒绝声称得到完整页',async t=>{
 const fx=await fixture(t);await fs.utimes(fx.root,new Date(0),new Date(0));
 const stats=fakeDirectory(t,1,{onClose:()=>fs.mkdir(path.join(fx.root,'arrived-during-scan'))});
 await assert.rejects(fx.run(),/DIRECTORY_CHANGED/);assert.deepEqual(stats(),{opened:1,read:1,closed:1});
});

test('R10 调用前取消不读映射、不请求审批或扫描',async t=>{
 const fx=await fixture(t),controller=new AbortController();controller.abort(new Error('fixture cancelled'));
 const reads=t.mock.method(fs,'readFile',async()=>{throw new Error('unexpected read');}),opens=t.mock.method(fs,'opendir',async()=>{throw new Error('unexpected open');});
 await assert.rejects(fx.run({directory:fx.outside},controller.signal),/fixture cancelled/);
 assert.equal(reads.mock.callCount(),0);assert.equal(opens.mock.callCount(),0);assert.equal(fx.approvals.length,0);
});

test('R10 等待主机审批时取消，获批后也不会扫描',async t=>{
 const controller=new AbortController(),fx=await fixture(t,{approval:async()=>{controller.abort(new Error('fixture approval cancelled'));return 'allowed-once';}});
 const opens=t.mock.method(fs,'opendir',async()=>{throw new Error('unexpected open');});
 await assert.rejects(fx.run({directory:fx.outside},controller.signal),/fixture approval cancelled/);
 assert.equal(fx.approvals.length,1);assert.equal(opens.mock.callCount(),0);
});

test('R10 扫描中取消立即停止，关闭目录句柄且不发布局部页',async t=>{
 const fx=await fixture(t),controller=new AbortController();
 const stats=fakeDirectory(t,1000,{onEntry:i=>{if(i===5)controller.abort(new Error('fixture scan cancelled'));}});
 await assert.rejects(fx.run({},controller.signal),/fixture scan cancelled/);assert.deepEqual(stats(),{opened:1,read:6,closed:1});
 assert.equal((await fx.vault()).exportState().entries.length,0);
});

test('R10 扫描读取错误关闭句柄，保留安全错误码并隐藏路径',async t=>{
 const fx=await fixture(t),stats=fakeDirectory(t,1000,{onEntry:i=>{if(i===3)throw Object.assign(new Error(`EACCES ${fx.root} audit.person@example.test`),{code:'EACCES'});}});
 await assert.rejects(fx.run(),error=>{assert.match(error.message,/DIRECTORY_READ_FAILED.*EACCES/);assert(!error.message.includes(fx.root));assert(!error.message.includes('audit.person@example.test'));return true;});
 assert.deepEqual(stats(),{opened:1,read:4,closed:1});
});

test('R10 结果隐私处理期间取消，不向调用方返回已取消的页',async t=>{
 const fx=await fixture(t),controller=new AbortController(),nativeRead=fs.readFile;let bridgeReads=0;
 t.mock.method(fs,'readFile',async(file,...args)=>{
  if(file===fx.bridgeFile&&++bridgeReads===2)controller.abort(new Error('fixture protection cancelled'));
  return nativeRead(file,...args);
 });
 await assert.rejects(fx.run({},controller.signal),/fixture protection cancelled/);assert.equal(bridgeReads,2);
});

test('R10 文件名与目录经现有隐私桥保护；分页按原名排序并可还原',async t=>{
 const fx=await fixture(t,{customTerms:['ProjectZeta']}),names=['13800000000.txt','ProjectZeta.txt','audit.person@example.test.txt','ordinary.txt'];await files(fx.root,names);
 const first=await fx.run({limit:2}),second=await fx.run({directory:first.directory,offset:first.next_offset,limit:2});
 const wire=JSON.stringify([first,second]);for(const name of names.slice(0,3))assert(!wire.includes(name));assert(wire.includes('⟦ZX-'));
 const vault=await fx.vault();assert.deepEqual([...first.entries,...second.entries].map(item=>vault.restore(item.name).text),[...names].sort());
 assert.equal(vault.restore(first.directory).text,fx.root);assert.equal(first.total_entries,4);assert.equal(second.total_entries,4);assert.equal(second.next_offset,null);
});

test('R10 raw 允许普通个人信息原文，仍保留精确分页',async t=>{
 const fx=await fixture(t,{privacyMode:'raw'});await files(fx.root,['13800000000.txt','audit.person@example.test.txt']);
 const result=await fx.run();assert.equal(result.directory,fx.root);assert.deepEqual(result.entries.map(item=>item.name),['13800000000.txt','audit.person@example.test.txt']);assert.equal(result.total_entries,2);
});

for(const privacyMode of ['redact','raw'])test(`R10 ${privacyMode} 拒绝文件名中的凭据，不因分页或审批放行`,async t=>{
 const apiKey='directory-fixture-credential',fx=await fixture(t,{privacyMode,apiKey});await files(fx.root,['ordinary.txt',`zz-${apiKey}.txt`]);
 const first=await fx.run({limit:1});assert.equal(first.entries[0].name,'ordinary.txt');assert.equal(first.truncated,true);assert.equal(first.total_entries,2);
 await assert.rejects(fx.run({offset:first.next_offset,limit:1}),/疑似凭证/);
 await fs.unlink(path.join(fx.root,`zz-${apiKey}.txt`));await files(fx.root,['sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ.txt']);
 await assert.rejects(fx.run(),/疑似凭证/);
});

test('R10 显式 block 隐私策略仍阻止敏感文件名返回',async t=>{
 const fx=await fixture(t,{privacyPolicy:{actions:{PHONE:'block'}}});await files(fx.root,['13800000000.txt']);
 await assert.rejects(fx.run(),/疑似凭证/);
});

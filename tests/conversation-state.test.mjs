import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleUrl=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {mergeState,workspaceDeletion,orphanDrafts,appendDraftFiles,recoverSubmittedDraft}=await import(moduleUrl('src/store.js'));
const {finalizeConversationRun}=await import(moduleUrl('src/conversation-state.js'));

const draft = (chatId, projectId, text) => ({draftId:chatId,kind:'chat',chatId,projectId,workspaceId:'office-home',revision:3,filesRevision:2,text,files:[{id:`${chatId}-file`,text:`${text}_ATTACHMENT`}],updatedAt:1});
async function roundtrip(state, verify) {
  const root = await mkdtemp(path.join(os.tmpdir(),'zhixing-state-contract-'));
  try {
    const file=path.join(root,'synthetic-workspace.json');
    await writeFile(file,JSON.stringify(state));
    const bytes=await readFile(file,'utf8');
    await verify(mergeState(JSON.parse(bytes)),bytes);
  } finally {await rm(root,{recursive:true,force:true});}
}

test('R05 删除单聊及归档聊天后正文和解析附件从持久字节消失，共享资料及其他草稿保留',async()=>{
  for (const archived of [false,true]) {
    const state=mergeState(null);
    state.chats=[{id:'target',archived,projectId:'office-general',workspaceId:'office-home',messages:[{text:'DELETE_MESSAGE_MARKER'}]},{id:'keep',workspaceId:'office-home',messages:[]}];
    state.drafts={'chat:target':draft('target','office-general','DELETE_DRAFT_MARKER'),'chat:keep':draft('keep',null,'KEEP_DRAFT_MARKER')};
    state.documents=[{id:'shared',workspaceId:'office-home',text:'SHARED_LIBRARY_MARKER'}];
    const next=workspaceDeletion(state,{type:'delete-chat',id:'target'});
    assert.equal(next.drafts['chat:target'],undefined);
    await roundtrip(next,(restored,bytes)=>{
      assert.doesNotMatch(bytes,/DELETE_MESSAGE_MARKER|DELETE_DRAFT_MARKER/);
      assert.match(bytes,/KEEP_DRAFT_MARKER_ATTACHMENT|SHARED_LIBRARY_MARKER/);
      assert.equal(restored.drafts['chat:keep'].files.length,1);
    });
    assert.equal(state.drafts['chat:target'].text,'DELETE_DRAFT_MARKER');
  }
});

test('R05 项目删除按最新聊天归属级联，已移出的聊天和过时归属草稿不误删',async()=>{
  const state=mergeState(null);
  state.projects.push({id:'keep-project',workspaceId:'government-home'});
  state.chats=[{id:'target',workspaceId:'office-home',projectId:'office-general',messages:[]},{id:'moved',workspaceId:'government-home',projectId:'keep-project',messages:[]}];
  state.drafts={
    'chat:target':draft('target','office-general','TARGET_PROJECT_MARKER'),
    'chat:moved':draft('moved','office-general','MOVED_CHAT_MARKER'),
    'new:office-home:office-general:new-one':{...draft(null,'office-general','TARGET_NEW_MARKER'),draftId:'new-one',kind:'new'},
  };
  state.documents=[{id:'shared',projectId:'office-general',workspaceId:'office-home',text:'KEEP_SHARED_MARKER'}];
  const next=workspaceDeletion(state,{type:'delete-project',id:'office-general'});
  assert.deepEqual(next.chats.map(chat=>chat.id),['moved']);
  assert.deepEqual(Object.keys(next.drafts),['chat:moved']);
  assert.equal(next.drafts['chat:moved'].projectId,'keep-project');
  assert.equal(next.drafts['chat:moved'].workspaceId,'government-home');
  assert.equal(next.documents[0].projectId,null);
  await roundtrip(next,(restored,bytes)=>{
    assert.doesNotMatch(bytes,/TARGET_PROJECT_MARKER|TARGET_NEW_MARKER/);
    assert.match(bytes,/MOVED_CHAT_MARKER_ATTACHMENT|KEEP_SHARED_MARKER/);
    assert.equal(restored.drafts['chat:moved'].projectId,'keep-project');
    assert.equal(restored.drafts['chat:moved'].workspaceId,'government-home');
  });
});

test('R05 历史孤儿草稿保持原字节且有可列举恢复/删除入口，正常归档草稿不误分类',async()=>{
  const state=mergeState(null);
  state.chats=[{id:'archive',archived:true,workspaceId:'office-home',messages:[]}];
  state.drafts={'chat:missing':draft('missing',null,'ORPHAN_MARKER'),'chat:archive':draft('archive',null,'ARCHIVED_VALID_MARKER')};
  state.pendingWorkspaceDeletes=[{id:'cleanup',chatIds:['gone'],taskIds:['gone-task'],projectId:null}];
  await roundtrip(state,restored=>{
    assert.deepEqual(orphanDrafts(restored).map(item=>item.key),['chat:missing']);
    assert.equal(restored.drafts['chat:missing'].files[0].text,'ORPHAN_MARKER_ATTACHMENT');
    assert.deepEqual(restored.pendingWorkspaceDeletes,state.pendingWorkspaceDeletes);
  });
});

test('R08 去重追加保留原附件，Windows路径忽略大小写，超过12个明确返回未加入数量',()=>{
  const first={id:'one',path:'D:\\Synthetic\\A.txt'},second={id:'two'};
  const added=appendDraftFiles([first,second],[{id:'three'},{id:'one'},{id:'new-id',path:'d:/synthetic/a.txt'}]);
  assert.deepEqual(added.files.map(file=>file.id),['one','two','three']);
  assert.equal(added.files[0],first);assert.equal(added.duplicates,2);assert.equal(added.rejected,0);
  const full=appendDraftFiles(Array.from({length:11},(_,i)=>({id:String(i)})),[{id:'last'},{id:'overflow'},{id:'last'}]);
  assert.equal(full.files.length,12);assert.equal(full.added,1);assert.equal(full.rejected,1);assert.equal(full.duplicates,1);
});

test('R08 失败恢复须匹配提交revision和空正文/空附件，不能覆盖新输入或用户清空后的新版',()=>{
  const submission={submittedRevision:7,text:'sent',restoreText:'  exact original  ',attachments:[{id:'a'}]};
  assert.deepEqual(recoverSubmittedDraft({revision:8,text:'',files:[]},submission),{text:'  exact original  ',files:submission.attachments});
  for(const current of [undefined,{revision:9,text:'',files:[]},{revision:8,text:'new input',files:[]},{revision:8,text:'',files:[{id:'new'}]}]) assert.equal(recoverSubmittedDraft(current,submission),null);
});

for (const [status,code] of [['failed','NETWORK_DISCONNECTED'],['failed','QUOTA_EXCEEDED'],['failed','PERMISSION_DENIED'],['cancelled','RUNTIME_CANCELLED']]) {
  test(`R07 ${code} terminal先到仍归档受保护正文/轨迹/成果/子任务，并可重启恢复`,async()=>{
    const state=mergeState(null);
    state.chats=[{id:'chat',workspaceId:'office-home',messages:[{id:'reply',runId:'run',role:'assistant',pending:true,progressText:'PROTECTED_PARTIAL_MARKER'}]}];
    const finalization={runId:'run',executionStatus:status,persistenceStatus:'saved',processStatus:'cleanup_pending',eventWatermark:8,error:{code,stage:'query',message:'保护后的合成原因'},deliverables:[{id:'verified',path:'D:/synthetic/verified.txt'}],children:[{id:'child',status:'completed'}]};
    const job={chatId:'chat',replyId:'reply',runId:'run',terminalStatus:status,finalization,trace:[{label:'工具调用',time:1},{label:'工具完成',time:2}]};
    const terminal=finalizeConversationRun(state,job,{status,finalization});
    const afterCatch=finalizeConversationRun(terminal,job,{error:{message:'late IPC rejection'}});
    await roundtrip(afterCatch,restored=>{
      const message=restored.chats[0].messages[0];
      assert.equal(message.trace.length,3);assert.equal(message.trace.at(-1).type,'run/terminal');
      assert.equal(message.text,'PROTECTED_PARTIAL_MARKER');assert.equal(message.pending,false);
      assert.equal(message.finalization.error.code,code);assert.equal(message.errorMessage,'保护后的合成原因');
      assert.equal(message.deliverables[0].id,'verified');assert.equal(message.children[0].id,'child');
      assert.equal(message.stopped,status==='cancelled');assert.equal(message.error,status==='failed');
    });
    job.finalization={...finalization,processStatus:'exited'};
    const updated=finalizeConversationRun(afterCatch,job,{status});
    assert.equal(updated.chats[0].messages[0].trace.length,3);
    assert.equal(updated.chats[0].messages[0].finalization.processStatus,'exited');
  });
}

test('R07 已验证输出完成但close失败时归档terminal.result，不将completed误标成执行失败',()=>{
  const state=mergeState(null);
  state.chats=[{id:'chat',messages:[{id:'reply',runId:'run',role:'assistant',pending:true}]}];
  const job={chatId:'chat',replyId:'reply',runId:'run',terminalStatus:'failed',progressText:'EARLIER_PARTIAL',trace:[]};
  const finalization={runId:'run',executionStatus:'completed',persistenceStatus:'saved',processStatus:'cleanup_pending',eventWatermark:2,error:{code:'RUNTIME_CLEANUP_PENDING',stage:'cleanup',message:'内核退出未确认'}};
  const archived=finalizeConversationRun(state,job,{status:'failed',finalization,result:{text:'VERIFIED_FINAL_BODY',masked:'VERIFIED_MASKED'}}).chats[0].messages[0];
  assert.equal(archived.text,'VERIFIED_FINAL_BODY');assert.equal(archived.masked,'VERIFIED_MASKED');
  assert.equal(archived.error,false);assert.equal(archived.finalization.executionStatus,'completed');assert.equal(archived.finalization.processStatus,'cleanup_pending');
  const cleanupUpdate=finalizeConversationRun({...state,chats:[{id:'chat',messages:[archived]}]}, {...job,finalization:{...finalization,processStatus:'exited'}}, {status:'failed'}).chats[0].messages[0];
  assert.equal(cleanupUpdate.text,'VERIFIED_FINAL_BODY');
  assert.equal(cleanupUpdate.finalization.processStatus,'exited');
});

test('R07 displayRedacted终态摘要不能覆盖validated-result draft正文，仅无正文时用保护后摘要',()=>{
  const state=mergeState(null);
  state.chats=[{id:'chat',messages:[{id:'reply',runId:'run',role:'assistant',pending:true,progressText:'VALIDATED_DISPLAY_BODY'}]}];
  const job={chatId:'chat',replyId:'reply',runId:'run',trace:[]};
  const event={status:'succeeded',displayRedacted:true,result:{displayRedacted:true,text:'MASKED_EVENT_SUMMARY'}};
  assert.equal(finalizeConversationRun(state,job,event).chats[0].messages[0].text,'VALIDATED_DISPLAY_BODY');
  state.chats[0].messages[0].progressText='';
  assert.equal(finalizeConversationRun(state,job,event).chats[0].messages[0].text,'MASKED_EVENT_SUMMARY');
});

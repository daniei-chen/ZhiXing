import test from 'node:test';
import assert from 'node:assert/strict';
import { chatText, mergeState, restoredDraftView, workspaceDeletion } from '../src/store.js';
import { nextQueued } from '../src/message-queue.js';
import {projectContext,projectWorktreeSourceContext} from '../src/project-core.js';

test('会话副本保留停止和失败后的部分正文及其状态', () => {
 const chat={messages:[{role:'user',text:'合成任务'},{role:'assistant',text:'停止前的正文',masked:'已保护正文',stopped:true},{role:'assistant',text:'失败前的正文',error:true},{role:'assistant',text:'尚未完成流式',pending:true}]};
 assert.match(chatText(chat),/已停止，部分内容.*\n停止前的正文/);
 assert.match(chatText(chat),/未完成，部分内容.*\n失败前的正文/);
 assert.doesNotMatch(chatText(chat),/尚未完成流式/);
 assert.match(chatText(chat,{protectedView:true}),/已保护正文/);
 assert.doesNotMatch(chatText(chat,{protectedView:true}),/合成任务/);
});

test('旧政务空间迁移保留用户资料与真实聊天，关闭旧 AI 调度', () => {
  const migrated = mergeState({
    version: 1,
    mode: 'government',
    projectId: 'p1',
    settings: { privacy: false, theme: 'dark' },
    projects: [{ id: 'p1', name: 'codex1' }, { id: 'p2', name: 'codex2' }],
    chats: [
      { id: 'c2', title: '构思全新萌物IP', projectId: 'p2', messages: [] },
      { id: 'c1', title: '核算年度目标考核奖并编制总表', projectId: 'p1', messages: [{ role: 'user', text: '保留我写的内容' }, { role: 'assistant', pending: true }] },
      { id: 'conversation', title: '未归档交办', messages: [] },
    ],
    documents: [{ id: 'd1', text: '一份现存资料' }],
    automations: [{ id: 'a1', projectId: 'p1', kind: 'agent', enabled: true }, { id: 'a2', kind: 'reminder', enabled: true }],
  });
  assert.equal(migrated.workspaceId, 'government-home');
  assert.equal(migrated.workspaces.find(space => space.id === 'government-home').projectId, 'p1');
  assert.equal(migrated.settings.privacyMode, 'redact');
  assert.equal(migrated.settings.theme, 'dark');
  assert.deepEqual(migrated.chats.map(chat => chat.id), ['c1', 'conversation']);
  assert.equal(migrated.chats[0].messages[0].text, '保留我写的内容');
  assert.equal(migrated.chats[0].messages[1].stopped, true);
  assert(!migrated.projects.some(project => project.id === 'p2'));
  for (const item of [...migrated.chats, ...migrated.documents, ...migrated.automations]) assert.equal(item.workspaceId, 'government-home');
  assert.deepEqual(migrated.automations.map(task => task.enabled), [false, true]);
});

test('项目独立绑定工作区，旧目录迁移而模式切换不授予文件访问',()=>{
  const saved=mergeState(null);saved.workspaces[0].directory='D:\\legacy';
  saved.projects=[{id:'p1',workspaceId:'office-home',name:'旧项目'},{id:'p2',workspaceId:'office-home',name:'新项目',directory:'D:\\new'},{id:'g',workspaceId:'government-home',directory:'D:\\gov'}];
  saved.chats=[{id:'chat',workspaceId:'office-home',projectId:'p2',messages:[]}];
  const state=mergeState(saved);
  assert.equal(state.projects[0].directory,'D:\\legacy');
  assert.equal(projectContext(state,{projectId:'p2'}).workspaceRoot,'D:\\new');
  assert.equal(projectContext(state).workspaceRoot,undefined);
  assert.throws(()=>projectContext(state,{projectId:'g'}),/不匹配/);
  assert.throws(()=>projectContext(state,{sessionId:'chat',projectId:'p1'}),/范围已变化/);
  assert.equal(projectWorktreeSourceContext(state,{sourceProjectId:'g'},'office-home').workspaceRoot,'D:\\gov');
  assert.equal(projectWorktreeSourceContext(state,{sourceProjectId:'g',sourceWorkspaceId:'government-home'},'office-home').workspaceRoot,'D:\\gov');
  state.projects[0].directory=null;assert.equal(mergeState(state).projects[0].directory,null);
});

test('重启后保留各自空间和已明确选择的发送模式', () => {
  const saved = mergeState(null);
  saved.workspaceId = 'government-home';
  saved.settings.privacyMode = 'raw';
  saved.chats.push({id:'conversation',projectId:'office-general',workspaceId:'office-home',messages:[]});
  saved.automations.push({id:'weekly',workspaceId:'office-home'});
  saved.documents.push({id:'agenda',workspaceId:'office-home'});
  const restored = mergeState(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.workspaceId, 'government-home');
  assert.equal(restored.settings.privacyMode, 'raw');
  for (const item of [...restored.chats, ...restored.automations, ...restored.documents]) assert.equal(item.workspaceId, 'office-home');
});

test('工作区恢复保留作用域草稿版本与附件引用',()=>{
 const saved=mergeState(null);
 saved.drafts={
  'new:office-home:p1:draft-one':{draftId:'draft-one',kind:'new',workspaceId:'office-home',projectId:'p1',revision:7,text:'待提交的中文内容',files:[{id:'file-one',name:'材料.png',status:'ready'}],updatedAt:123},
  'chat:chat-one':{draftId:'chat-one',kind:'chat',workspaceId:'government-home',projectId:'p2',chatId:'chat-one',revision:2,text:'政务草稿',files:[],updatedAt:456},
 };
 const restored=mergeState(JSON.parse(JSON.stringify(saved)));
 assert.equal(restored.drafts['new:office-home:p1:draft-one'].revision,7);
 assert.equal(restored.drafts['new:office-home:p1:draft-one'].draftId,'draft-one');
 assert.equal(restored.drafts['new:office-home:p1:draft-one'].text,'待提交的中文内容');
 assert.equal(restored.drafts['new:office-home:p1:draft-one'].files[0].id,'file-one');
 assert.equal(restored.drafts['chat:chat-one'].workspaceId,'government-home');
 restored.settings.persist=false;
 assert.deepEqual(mergeState(restored).drafts,{});
});

test('启动恢复最近的有效草稿作用域并保留中断输出',()=>{
 const saved=mergeState(null);
 saved.chats=[{id:'unfinished',workspaceId:'office-home',projectId:'office-general',messages:[{role:'assistant',pending:true,text:'已完成第一段',progressText:'已完成第一段和第二段'}]}];
 saved.drafts={
  home:{kind:'new',draftId:'home-draft',workspaceId:'office-home',text:'首页草稿',files:[],updatedAt:1},
  project:{kind:'new',draftId:'project-draft',workspaceId:'office-home',projectId:'office-general',text:'项目草稿',files:[],updatedAt:2},
  other:{kind:'new',draftId:'other',workspaceId:'government-home',text:'其他模式',files:[],updatedAt:8},
  removed:{kind:'new',draftId:'removed',workspaceId:'office-home',projectId:'missing',text:'已移除项目',files:[],updatedAt:9},
 };
 const restored=mergeState(saved);
 assert.deepEqual(restoredDraftView(restored),{section:'project',chatId:null,projectId:'office-general',newDraftId:'project-draft'});
 assert.equal(restored.chats[0].messages[0].text,'已完成第一段和第二段');
 assert.equal(restored.chats[0].messages[0].status,'interrupted');
 assert.equal(restored.chats[0].messages[0].pending,false);
 assert.equal(restored.chats[0].messages[0].progressText,'');
 restored.drafts.project={...restored.drafts.project,kind:'chat',draftId:'unfinished',chatId:'unfinished',updatedAt:10};
 assert.equal(restoredDraftView(restored).chatId,'unfinished');
 restored.chats[0].archived=true;
 assert.equal(restoredDraftView(restored).newDraftId,'home-draft');
 restored.drafts={};assert.equal(restoredDraftView(restored),null);
});

test('旧版本存档缺少新增字段时补默认且不丢用户数据', () => {
 // A 0.12-era payload: version 2, no voice/personalisation fields, no documents
 // array, no appliedAutomationRuns. Loading it must not throw and must keep the
 // user's own project and chat intact.
 const legacy = {
  version: 2,
  workspaces: [{ id: 'office-home', name: '办公', type: 'office', directory: 'D:/work' }],
  workspaceId: 'office-home',
  projects: [{ id: 'p-user', name: '季度复盘', workspaceId: 'office-home' }],
  chats: [{ id: 'c-user', title: '周报', projectId: 'p-user', messages: [{ id: 'm1', role: 'user', text: '帮我写周报' }] }],
  settings: { persist: true, privacyMode: 'redact', permission: 'ask' },
 };
 const merged = mergeState(legacy);
 assert.equal(merged.version, 2);
 assert.equal(merged.projects.find(project => project.id === 'p-user')?.name, '季度复盘');
 assert.equal(merged.chats.find(chat => chat.id === 'c-user')?.messages[0].text, '帮我写周报');
 assert.deepEqual(merged.automations, []);
 assert.deepEqual(merged.documents, []);
 assert.deepEqual(merged.appliedAutomationRuns, []);
 assert.equal(merged.settings.voiceLanguage, 'zh-CN');
 assert.equal(merged.settings.personalizationEnabled, false);
 assert.equal(merged.settings.personalInstructions, '');
 assert.ok(merged.settings.privacyPolicy, 'privacy policy must fall back to a valid default');
 // Old projects have no directory of their own: they inherit the workspace one.\n assert.equal(merged.projects.find(project => project.id === 'p-user')?.directory, 'D:/work');
});

test('未知的多余字段被忽略而不是让启动失败', () => {
 const future = {
  version: 2,
  workspaces: [{ id: 'office-home', name: '办公', type: 'office', directory: null }],
  workspaceId: 'office-home',
  projects: [], chats: [],
  settings: {},
  someFutureArray: [{ id: 'x' }],
  someFutureObject: { anything: true },
 };
 const merged = mergeState(future);
 assert.equal(merged.version, 2);
 assert.equal(Object.hasOwn(merged, 'someFutureArray'), false);
 assert.equal(Object.hasOwn(merged, 'someFutureObject'), false);
 assert.equal(merged.workspaceId, 'office-home');
});

test('损坏的存档回退到默认状态而不是抛错', () => {
 for (const broken of [null, undefined, {}, { version: 99 }, { version: 2, projects: 'nope', chats: [] }]) {
  const merged = mergeState(broken);
  assert.equal(merged.version, 2);
  assert.ok(Array.isArray(merged.projects) && merged.projects.length > 0);
  assert.ok(Array.isArray(merged.chats));
  assert.equal(merged.workspaceId, merged.workspaces[0].id);
 }
});

test('旧版草稿引用已删除会话时不会凭空恢复', () => {
 const legacy = {
  version: 2,
  workspaces: [{ id: 'office-home', name: '办公', type: 'office', directory: null }],
  workspaceId: 'office-home',
  projects: [], chats: [],
  settings: { persist: true },
  drafts: { 'chat:ghost': { text: '残留草稿', files: [] } },
 };
 const merged = mergeState(legacy);
 const draft = merged.drafts['chat:ghost'];
 assert.ok(draft, 'draft entry is retained for inspection');
 assert.equal(draft.chatId, null);
 assert.equal(draft.kind, undefined);
});


test('renderer reload preserves only the exact host-owned live run and reply binding', () => {
  const saved = mergeState(null);
  saved.chats = [{ id: 'chat-a', workspaceId: 'office-home', messages: [
    { id: 'reply-a', runId: 'run-a', role: 'assistant', pending: true, text: '' },
    { id: 'reply-old', runId: 'run-old', role: 'assistant', pending: true, text: '旧的部分输出' },
  ] }];
  const liveRuns = [{ sessionId: 'chat-a', replyId: 'reply-a', runId: 'run-a' }];
  const restored = mergeState(saved, { liveRuns });
  assert.equal(restored.chats[0].messages[0].pending, true);
  assert.equal(restored.chats[0].messages[1].status, 'interrupted');
  assert.equal(restored.chats[0].messages[1].text, '旧的部分输出');
  assert.equal(mergeState(saved).chats[0].messages[0].status, 'interrupted');
});

test('a live run from another session or another reply cannot revive a saved pending message', () => {
  const saved = mergeState(null);
  saved.chats = [{ id: 'chat-a', workspaceId: 'office-home', messages: [{ id: 'reply-a', runId: 'run-a', role: 'assistant', pending: true }] }];
  for (const run of [
    { sessionId: 'chat-b', replyId: 'reply-a', runId: 'run-a' },
    { sessionId: 'chat-a', replyId: 'reply-b', runId: 'run-a' },
    { sessionId: 'chat-a', replyId: 'reply-a', runId: 'run-b' },
  ]) assert.equal(mergeState(saved, { liveRuns: [run] }).chats[0].messages[0].status, 'interrupted');
});

test('排队消息随加密工作空间恢复，但不复活已删除聊天或关闭保存的会话', () => {
  const saved = mergeState(null);
  saved.chats = [{ id: 'chat-a', workspaceId: 'office-home', projectId: null, messages: [] }];
  saved.queuedMessages = [
    { id: 'q1', chatId: 'chat-a', workspaceId: 'office-home', text: '排队的交办', files: [{ id: 'f1', name: '附件.txt' }], createdAt: 1 },
    { id: 'q2', chatId: 'ghost', text: '已删除聊天', files: [], createdAt: 2 },
    { id: 'q3', chatId: 'chat-a', text: '坏附件', files: [null], createdAt: 3 },
    { id: 'q4', chatId: 'chat-a', text: '  ', files: [], createdAt: 4 },
  ];
  const restored = mergeState(saved);
  assert.deepEqual(restored.queuedMessages.map(item => item.id), ['q1', 'q3']);
  assert.equal(restored.queuedMessages[0].workspaceId, 'office-home');
  assert.match(restored.queuedMessages[0].error, /上次退出时未发送/);
  assert.deepEqual(restored.queuedMessages[1].files, [], 'invalid attachment entries are dropped, the text stays');
  assert.equal(mergeState({ ...saved, settings: { ...saved.settings, persist: false } }).queuedMessages.length, 0);
});

test('删除聊天或项目同时清掉它的排队消息', () => {
  const state = mergeState(null);
  state.chats = [{ id: 'chat-a', workspaceId: 'office-home', projectId: null, messages: [] }];
  state.queuedMessages = [
    { id: 'q1', chatId: 'chat-a', projectId: null, text: '一', files: [] },
    { id: 'q2', chatId: 'chat-b', projectId: 'p9', text: '二', files: [] },
  ];
  const afterChat = workspaceDeletion(state, { type: 'delete-chat', id: 'chat-a' });
  assert.deepEqual(afterChat.queuedMessages.map(item => item.id), ['q2']);
  const afterProject = workspaceDeletion(afterChat, { type: 'delete-project', id: 'p9' });
  assert.deepEqual(afterProject.queuedMessages, []);
});

test('强杀重启：已经交给内核的排队交办不回到队列，未发出的可重试且不停在发送中', () => {
  const saved = mergeState(null);
  saved.chats = [
    {
      id: 'chat-a', workspaceId: 'office-home', projectId: null,
      messages: [
        { id: 'm1', role: 'user', text: '已经发出的一件', queueId: 'q1' },
        { id: 'm2', role: 'assistant', text: '', pending: true, runId: 'run-1', progressText: '写到一半' },
      ],
    },
    {
      id: 'chat-b', workspaceId: 'office-home', projectId: null,
      messages: [{ id: 'm3', role: 'user', text: '另开的一段', queueId: 'q9' }],
    },
  ];
  saved.queuedMessages = [
    { id: 'q1', chatId: 'chat-a', workspaceId: 'office-home', text: '已经发出的一件', files: [], createdAt: 5, sending: true },
    { id: 'q2', chatId: 'chat-a', workspaceId: 'office-home', text: '还没发出的那件', files: [{ id: 'f1', name: '附件.txt' }], createdAt: 6, sending: true },
    { id: 'q9', chatId: 'chat-b', workspaceId: 'office-home', text: '另开的一段', files: [], createdAt: 7, sending: true },
  ];

  const restored = mergeState(saved);
  assert.deepEqual(restored.queuedMessages.map(item => item.id), ['q2'], '已受理的交办只留在聊天记录里，不回队列');
  const [retryable] = restored.queuedMessages;
  assert.equal(retryable.sending, undefined, '重启后不能停在「发送中」');
  assert.match(retryable.error, /上次退出时未发送/);
  assert.deepEqual(retryable.files.map(file => file.name), ['附件.txt'], '排队附件的归属随条目保留');
  assert.equal(
    nextQueued(restored.queuedMessages, { chatId: 'chat-a', workspaceId: 'office-home' }),
    null,
    '恢复出来的条目必须等用户确认，不能自动重放',
  );
  assert.ok(!restored.chats[0].messages.some(message => message.queueId === 'q9'), '匹配只看同一条聊天');
  assert.equal(restored.chats[0].messages[1].pending, false);
  assert.equal(restored.chats[0].messages[1].status, 'interrupted');
});

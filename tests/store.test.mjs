import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeState } from '../src/store.js';
import {projectContext} from '../src/project-core.js';

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

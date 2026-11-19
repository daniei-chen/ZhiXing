export function projectContext(state,{workspaceId=state.workspaceId,projectId=null,sessionId=null}={}) {
  const workspace=state.workspaces?.find(space=>space.id===workspaceId);
  if(!workspace)throw new Error('工作模式已不存在，请重新打开项目。');
  const project=projectId?state.projects?.find(item=>item.id===projectId&&item.workspaceId===workspace.id):null;
  if(projectId&&!project)throw new Error('项目与当前工作模式不匹配。');
  const chat=sessionId?state.chats?.find(item=>item.id===sessionId):null;
  if(chat&&(chat.workspaceId!==workspace.id||(chat.projectId||null)!==(projectId||null)))throw new Error('会话的项目范围已变化，请重新打开会话。');
  return {workspace,project,workspaceRoot:project?.directory||undefined};
}

export function projectWorktreeSourceContext(state,record,fallbackWorkspaceId) {
  const source=state.projects?.find(project=>project.id===record?.sourceProjectId);
  const workspaceId=record?.sourceWorkspaceId||source?.workspaceId||fallbackWorkspaceId;
  return projectContext(state,{workspaceId,projectId:record?.sourceProjectId});
}

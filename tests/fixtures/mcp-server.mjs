import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
for await(const line of lines){
 let request;try{request=JSON.parse(line);}catch{continue;}
 if(request.id===undefined)continue;
 let result;
 if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{},resources:{}},serverInfo:{name:'zhixing-test',version:'1.0.0'}};
 else if(request.method==='tools/list')result={tools:[{name:'lookup',description:'合成联系人查询',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}]};
 else if(request.method==='tools/call')result={content:[{type:'text',text:'MCP_SYNTHETIC_OK 联系人：李四，电话 13911112222。'}]};
 else if(request.method==='resources/list')result={resources:[{uri:'fixture://notes',name:'合成会议记录',mimeType:'text/plain'}]};
 else if(request.method==='resources/templates/list')result={resourceTemplates:[]};
 else if(request.method==='resources/read')result={contents:[{uri:request.params.uri,mimeType:'text/plain',text:'MCP_RESOURCE_OK 电话 13611112222。'}]};
 else if(request.method==='ping')result={};
 else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Method not found'}})+'\n');continue;}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
}

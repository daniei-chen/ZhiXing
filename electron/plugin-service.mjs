import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const worker = fileURLToPath(new URL('./plugin-worker.mjs', import.meta.url));
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const packageVersion = /^\d+\.\d+\.\d+(?:-[\dA-Za-z.-]+)?(?:\+[\dA-Za-z.-]+)?$/;
const defaultRegistry = 'https://registry.npmjs.org/';

function validName(name) {
  if (typeof name !== 'string' || name.length > 200 || !packageName.test(name)) throw new Error('请输入有效的 npm 插件包名。');
  return name;
}

function validVersion(version) {
  if (typeof version !== 'string' || version.length > 70 || !packageVersion.test(version)) throw new Error('请选择明确的插件版本。');
  return version;
}
function validIndex(value){
  if(typeof value!=='string'||value.length>1200)throw new Error('请填写有效的插件目录地址。');
  let url;
  try{url=new URL(value.trim());}catch{throw new Error('请填写完整的插件目录地址。');}
  if(url.username||url.password||url.hash)throw new Error('插件目录地址不能包含凭据或片段。');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('插件目录需要 HTTPS，本机测试目录可使用 HTTP。');
  return url.href;
}

export class PluginService {
  constructor({ directory, registry = defaultRegistry }) {
    this.directory = directory;
    this.registry = registry;
    this.profileDirectory = path.join(directory, 'profiles', 'zhixing-extensions');
    this.operation = null;
    this.buildApprovals = new Map();
  }
  indexes(){
    try{
      const records=JSON.parse(readFileSync(path.join(this.directory,'market-indexes.json'),'utf8'));
      if(!Array.isArray(records)||records.length>8)throw new Error('插件目录配置无效。');
      return records.map(validIndex);
    }catch(error){if(error.code==='ENOENT')return [];throw error;}
  }
  async saveIndexes(indexes){
    await mkdir(this.directory,{recursive:true});
    const file=path.join(this.directory,'market-indexes.json'),temp=`${file}.${randomUUID()}.tmp`;
    try{await writeFile(temp,JSON.stringify(indexes),{mode:0o600});await rename(temp,file);}
    finally{await unlink(temp).catch(()=>{});}
    return indexes;
  }

  selection() {
    try {
      const manifest = JSON.parse(readFileSync(path.join(this.profileDirectory, 'package.json'), 'utf8'));
      const bundles = manifest.dsh?.profile?.bundles || [];
      if (!Array.isArray(bundles)) throw new Error('插件配置无效。');
      const selected = bundles.map(validName);
      return {
        bundles: selected,
        dependencies: Object.fromEntries(selected.filter(name => manifest.dependencies?.[name]).map(name => [name, manifest.dependencies[name]])),
        nodeModules: path.join(this.profileDirectory, 'node_modules'),
      };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  run(input,reviewBuilds) {
    const action = input?.action;
    if(action==='market-list')return Promise.resolve(this.indexes());
    if (this.operation) throw new Error('正在处理另一项插件操作，请稍候。');
    if(action==='confirm-builds'){
      const approval=this.buildApprovals.get(input.approvalId);
      if(!approval||approval.expires<=Date.now()||!reviewBuilds)throw new Error('这次脚本审阅已过期，请重新发起安装。');
      this.buildApprovals.delete(input.approvalId);
      const job=(async()=>{
        const accepted=await reviewBuilds(approval);
        if(!accepted)return {cancelled:true};
        return this.launch({...approval.request,approvedBuilds:approval.builds});
      })();
      this.operation=job;
      return this.finish(job,approval.request);
    }
    const request = { action };
    if(action==='market-add'||action==='market-remove'){
      const url=validIndex(input.url);
      const current=this.indexes();
      if(action==='market-add'&&current.includes(url))throw new Error('此目录已经添加。');
      const next=action==='market-add'?[...current,url]:current.filter(item=>item!==url);
      if(next.length>8)throw new Error('最多保存 8 个插件目录。');
      const job=this.saveIndexes(next);
      this.operation=job;
      return job.finally(()=>{if(this.operation===job)this.operation=null;});
    }
    if(action==='market-search'||action==='market-install'){
      request.url=validIndex(input.url);
      if(!this.indexes().includes(request.url))throw new Error('请先添加插件目录。');
      if(action==='market-search'){
        request.query=typeof input.query==='string'?input.query.slice(0,160):'';
        request.offset=Number.isSafeInteger(input.offset)&&input.offset>=0?input.offset:0;
      }else{
        request.expectedName=validName(input.name);
        request.version=validVersion(input.version);
        if(typeof input.source!=='string'||input.source.length>2048)throw new Error('请确认插件的安装来源。');
        request.source=input.source;
      }
    }
    else if (action === 'inspect') {
      const spec = String(input.spec || '').trim();
      const at = spec.lastIndexOf('@');
      const withVersion = at > 0;
      request.spec = withVersion ? `${validName(spec.slice(0, at))}@${validVersion(spec.slice(at + 1))}` : validName(spec);
    } else if (['versions', 'enable', 'remove', 'update'].includes(action)) {
      request.name = validName(input.name);
      if (action === 'enable') request.enabled = input.enabled === true;
      if (action === 'update') request.version = validVersion(input.version);
    } else if (action === 'install') {
      const name = validName(input.name);
      request.expectedName = name;
      request.version = validVersion(input.version);
      if (input.official === true) request.name = name;
      else request.spec = `${name}@${request.version}`;
    } else if (action !== 'list') throw new Error('插件操作无效。');

    const job=this.launch(request);
    this.operation=job;
    return this.finish(job,request);
  }

  async finish(job,request){
    try{
      const result=await job;
      if(!['install','market-install','update'].includes(request.action)||!result?.pendingBuilds?.length)return result;
      const now=Date.now();
      for(const [id,approval] of this.buildApprovals)if(approval.expires<=now)this.buildApprovals.delete(id);
      if(this.buildApprovals.size>=8)this.buildApprovals.delete(this.buildApprovals.keys().next().value);
      const builds=result.pendingBuilds.filter(name=>typeof name==='string'&&name.length<=260&&!/[\u0000-\u001f\u007f]/.test(name)).slice(0,24);
      if(builds.length!==result.pendingBuilds.length)return result;
      const approvalId=randomUUID();
      this.buildApprovals.set(approvalId,{request,builds,expires:now+10*60*1000});
      return {...result,approvalId};
    }finally{
      this.operation=null;
      this.abort=null;
    }
  }

  launch(request){
    const bundled = path.join(root, 'runtime', 'node.exe');
    const exe = existsSync(bundled) ? bundled : process.execPath;
    const env = {};
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC', 'PATHEXT']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    if (exe === process.execPath && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    return new Promise((resolve, reject) => {
      const child = spawn(exe, [worker], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
      let reply, errorText = '';
      let abortTimer;
      const cancel = () => {
        if (abortTimer) return;
        if (child.connected) child.send({ cancel: true }, () => {});
        abortTimer = setTimeout(() => child.kill(), 7000);
      };
      const timer = setTimeout(cancel, 150000);
      this.abort = cancel;
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-1400); });
      child.once('error', () => { clearTimeout(timer); clearTimeout(abortTimer); reject(new Error('插件管理进程无法启动。')); });
      child.once('message', result => { reply = result; });
      child.once('close', () => {
        clearTimeout(timer);
        clearTimeout(abortTimer);
        if (reply?.error) reject(new Error(reply.error));
        else if (reply) resolve(reply.value);
        else reject(new Error(errorText || '插件管理进程提前结束。'));
      });
      child.send({ root: this.directory, request, registry: this.registry }, error => { if (error) reject(error); });
    });
  }

  async close() {
    const job = this.operation;
    this.abort?.();
    await job?.catch(() => {});
  }
}

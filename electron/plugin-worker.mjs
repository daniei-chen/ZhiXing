import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { INSTALL_ANCHOR, runProfile } from '@deepseek-ai/dsh/profile-boot';
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment';

const require = createRequire(import.meta.url);
const { root, request, registry } = await new Promise(resolve => process.once('message', resolve));
const profileName = 'zhixing-extensions';
const dir = path.join(root, 'profiles', profileName);
const patchFile = path.join(root, 'manager.patch.json');
process.env.DSH_HOME = root;
process.env.DSH_TELEMETRY_DISABLED = '1';

await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'package.json'), JSON.stringify({
  name: 'zhixing-extensions', private: true, dsh: { profile: { bundles: [] } },
}, null, 2), { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });

const npmrc = path.join(root, 'registry.npmrc');
await writeFile(npmrc, 'strict-ssl=true\n', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
// pnpm delegates `view` to npm and lifecycle scripts may invoke `node`. Use
// shipped CLIs even on a Windows machine without either command on PATH.
// The shim is ASCII; Unicode installation paths travel in the environment.
if(process.platform==='win32'){
  const bin=path.join(root,'bin');await mkdir(bin,{recursive:true});
  process.env.ZHIXING_PLUGIN_NODE=process.execPath;
  process.env.ZHIXING_NPM_CLI=path.join(path.dirname(require.resolve('npm/package.json')),'bin','npm-cli.js');
  await writeFile(path.join(bin,'npm.cmd'),'@echo off\r\n"%ZHIXING_PLUGIN_NODE%" "%ZHIXING_NPM_CLI%" %*\r\n');
  process.env.PATH=[bin,path.dirname(process.execPath),process.env.PATH||''].join(path.delimiter);
}
const modules=[{
  id: 'plugin-manager', name: require.resolve('@deepseek-ai/dsh-plugin-manager'),
  config: { registry, fallbackRegistries: [], inspectTimeoutMs: 15000, idleTimeoutMs: 40000, outputBytes: 28000 },
}];
if(['market-search','market-install'].includes(request.action))modules.push({
  id:'plugin-market',name:require.resolve('@deepseek-ai/dsh-plugin-market'),
  config:{indexes:[request.url],fetchTimeoutMs:12000,maxBytes:2*1024*1024},
});
await writeFile(patchFile,JSON.stringify([{insert:modules}]));

const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]);
let host;
const requestId = randomUUID();
const controller = new AbortController();
process.on('message', message => {
  if (message?.cancel !== true) return;
  controller.abort();
  void host?.ctx.pluginManager?.cancelInstall(requestId).catch(() => {});
});
function title(value) {
  return typeof value === 'string' ? value : value?.['zh-CN'] || value?.zh || value?.en || '';
}
function catalogRow(row) {
  return {
    name: row.name, title: title(row.meta?.title) || row.name,
    description: title(row.meta?.description) || row.description || '',
    official: row.official, available: row.availability, installed: row.installed,
    offeredVersion: row.installTarget?.version, selectable: row.official || row.installed || row.enabled,
    enabled: row.enabled, version: row.version, update: row.update === 'registry',
    removable: row.removable, readOnly: row.readOnlyReason, error: row.error?.code,
    entries: row.rows.map(entry => ({ name: entry.moduleName, id: entry.rowId, title: title(entry.meta?.title) })),
  };
}

function summarize(result) {
  return {
    changed: result.changed, application: result.application, bundle: result.bundle || result.target,
    version: result.version, error: result.error?.code || result.error?.message,
    buildScripts: Boolean(result.pendingBuilds?.length),
    pendingBuilds: result.pendingBuilds,
  };
}

function sourceLabel(version){
  return version.source.type==='git'?version.install.spec:(version.install.registry||registry);
}

async function perform(manager,market) {
  const { action, name, spec, version, enabled } = request;
  const buildOptions=request.approvedBuilds?{approvedBuilds:request.approvedBuilds}:{};
  if(action==='market-search'){
    const result=await market.search(request.url,{text:request.query,sort:{kind:request.query?'relevance':'index'},offset:request.offset,limit:24});
    return {title:title(result.title),total:result.total,nextOffset:result.nextOffset,plugins:result.entries.map(item=>({
      name:item.name,title:title(item.title)||item.name,description:title(item.description),defaultVersion:item.defaultVersion,
      installation:item.installation,
      versions:item.versions.slice(0,60).map(version=>({
        version:version.version,compatible:version.compatibility.compatible,source:sourceLabel(version),kind:version.source.type,update:version.update,
      })),
    }))};
  }
  if(action==='market-install'){
    const entry=await market.entry(request.url,request.expectedName);
    const item=entry?.versions.find(candidate=>candidate.version===version);
    if(!item?.compatibility.compatible)throw new Error('此插件版本不可用或与当前 Harness 不兼容。');
    if(sourceLabel(item)!==request.source)throw new Error('安装来源已变化，请刷新目录并重新核对。');
    if(item.update){
      const stopped=await manager.setBundleEnabled(request.expectedName,false);
      if(stopped.application==='failed')return summarize(stopped);
      return summarize((await manager.updateBundle(request.expectedName,item.install.spec,{registry:item.install.registry||registry,requestId,...buildOptions})).result);
    }
    return summarize(await manager.installBundle(item.install.spec,{
      enabled:false,saveExact:true,registry:item.install.registry||registry,requestId,expected:{name:request.expectedName,version},...buildOptions,
    }));
  }
  if (action === 'list') return (await manager.listBundles()).map(catalogRow);
  if (action === 'inspect') {
    const result = await manager.inspect(spec, { registry }, controller.signal);
    return { name: result.name, version: result.version, description: result.description, bundle: result.bundle, problem: result.problem, ...(result.status==='refused'?{reason:String(result.reason||'插件版本探测被拒绝。').slice(0,360)}:{}) };
  }
  if (action === 'versions') {
    const result = await manager.listVersions(name, { registry }, controller.signal);
    return { problem: result.problem, versions: (result.versions || []).map(v => ({
      version: v.version, bundle: v.bundle, incompatible: Boolean(v.incompatible), deprecated: Boolean(v.deprecated),
    })) };
  }
  if (action === 'install') {
    let target = spec;
    if (name) {
      const candidate = (await manager.listBundles()).find(row => row.name === name && row.official);
      if (!candidate?.installTarget || candidate.installTarget.version !== version) throw new Error('目录中的版本已变化，请刷新插件目录。');
      target = candidate.installTarget.spec;
    }
    return summarize(await manager.installBundle(target, {
      enabled: false, saveExact: true, registry, requestId, expected: { name: request.expectedName, version },...buildOptions,
    }));
  }
  if (action === 'enable') return summarize(await manager.setBundleEnabled(name, enabled));
  if (action === 'remove') return summarize(await manager.removeBundle(name));
  if (action === 'update') {
    const bundle = (await manager.listBundles()).find(row => row.name === name);
    if (bundle?.enabled) {
      const stopped = await manager.setBundleEnabled(name, false);
      if (stopped.application === 'failed') return summarize(stopped);
    }
    return summarize((await manager.updateBundle(name, version, { registry, requestId,...buildOptions })).result);
  }
  throw new Error('插件操作无效。');
}

let reply;
try {
  host = await runProfile({
    environment, profile: profileName, patchFiles: [patchFile], args: [],
    resolvedProfile: { installAnchor: INSTALL_ANCHOR, profile: {
      name: profileName, dir, layers: [], patchPath: path.join(dir, 'cordis.patch.yml'), patches: [], skippedBundles: [],
    } },
    packageManager: {
      command: process.execPath, args: [path.resolve(import.meta.dirname, '../node_modules/pnpm/bin/pnpm.cjs')],
      env: { ...process.env, npm_config_userconfig: npmrc, npm_config_store_dir: path.join(root, 'store'),
        npm_config_ignore_scripts: 'false', npm_config_strict_dep_builds: 'true',
        npm_config_force: 'true', npm_config_side_effects_cache: 'false',
        npm_config_manage_package_manager_versions: 'false', GIT_TERMINAL_PROMPT: '0' },
    },
  });
  controller.signal.throwIfAborted();
  reply = { value: await perform(host.ctx.pluginManager,request.action.startsWith('market-')?host.ctx.pluginMarket:null) };
} catch (cause) {
  reply = { error: String(cause.message || '插件管理器未能完成操作。').slice(0, 360) };
} finally {
  await host?.shutdown.shutdown(reply?.error ? 1 : 0);
  await new Promise(resolve => process.send(reply, resolve));
  process.disconnect();
}

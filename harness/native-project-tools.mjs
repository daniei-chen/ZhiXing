import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {NATIVE_PROJECT_SEARCH_TOOLS,prepareNativeImage,prepareNativePatch,prepareNativeSearch,protectNativeSearch} from './native-project-fs.mjs';
import {privateSearchGlobs} from '../electron/workspace-files.mjs';
import {shellEnvironment} from './shell-policy.mjs';

const require=createRequire(import.meta.url);
const harnessRequire=createRequire(require.resolve('@deepseek-ai/dsh/lib/bin.js'));
const native=await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-tool-fs')).href);
const baseRequire=createRequire(harnessRequire.resolve('@deepseek-ai/dsh-base'));
const search=await import(pathToFileURL(baseRequire.resolve('@deepseek-ai/dsh-tool-fs-search')).href);
export const name='zhixing-native-project-tools';
export const Config=native.Config;
export const inject=[...native.inject,'subprocess'];

export async function apply(ctx,config) {
 // The upstream plugins own the tool contracts and prompt sections. Restrict
 // their operation inputs and results before registering them with Harness.
 function adapter(context,overrides={}){
  const registry={
   get:(...args)=>context.tools.get(...args),
   register(definition,options){return context.tools.register(adaptDefinition(definition),options);},
  };
  return new Proxy({}, {get(_target,key){
   if(key==='tools')return registry;
   if(key==='inject')return (services,callback)=>context.inject(services,scoped=>callback(adapter(scoped,overrides)));
   if(Object.hasOwn(overrides,key))return overrides[key];
   const value=context[key];return typeof value==='function'?value.bind(context):value;
  }});
 }
 native.apply(adapter(ctx),config);
 const subprocess={spawn(spec){
  const separator=spec.argv.indexOf('--');
  const end=separator===-1?spec.argv.length:separator;
  const argv=[...spec.argv.slice(0,end),'--no-follow',...privateSearchGlobs,...spec.argv.slice(end)];
  return ctx.subprocess.spawn({...spec,argv,env:shellEnvironment()});
 }};
 // The upstream spill hook cannot publish a second copy outside the current protected tool result.
 await search.apply(adapter(ctx,{subprocess,get:key=>key==='spillStore'?undefined:ctx.get(key)}),
  search.Config({sampleOverCapGlobResults:false,globMaxResults:100,grepMaxMatches:150,rawOutputMaxBytes:768*1024}));
}

function adaptDefinition(definition){
 if(definition.name==='apply_patch')return {...definition,async execute(args,exec){
  return definition.execute({...args,input:await prepareNativePatch(args.input)},exec);
 }};
 if(definition.name==='read_image')return {...definition,
  description:'读取项目中的单帧 PNG/JPEG。知行在本机依当前隐私规则处理像素，由当前视觉模型查看。',
  async execute(args,exec){return definition.execute({...args,file_path:await prepareNativeImage(args.file_path)},exec);},
 };
 if(NATIVE_PROJECT_SEARCH_TOOLS.includes(definition.name))return {...definition,
  description:definition.name==='glob'?'在绑定项目内按 glob 模式查找文件，排除凭证与私密路径。':'在绑定项目内使用 ripgrep 正则查找匹配行，排除凭证与私密路径。',
  async execute(args,exec){return protectNativeSearch(await definition.execute(await prepareNativeSearch(args,exec),exec),exec);},
 };
 return definition;
}

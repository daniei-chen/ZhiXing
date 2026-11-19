import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export function installedKernel(){const harness=require('@deepseek-ai/dsh/package.json').version,sdk=require('@deepseek-ai/dsh-sdk-client/package.json').version,tools=require('@deepseek-ai/dsh-tools/package.json').version;return {harness,sdk,tools,aligned:harness===sdk&&sdk===tools,channel:/-/.test(harness)?'候选版':'正式版'};}
export async function checkOfficialKernel(){
 const response=await fetch('https://registry.npmjs.org/@deepseek-ai%2fdsh/latest',{signal:AbortSignal.timeout(15000),headers:{accept:'application/json'}});
 if(!response.ok)throw new Error('暂时无法读取 npm 官方版本信息。');
 const manifest=await response.json();if(manifest.name!=='@deepseek-ai/dsh'||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version))throw new Error('官方版本信息格式无效。');
 const installed=installedKernel();return {...installed,officialLatest:manifest.version,isCurrent:installed.harness===manifest.version,checkedAt:new Date().toISOString()};
}

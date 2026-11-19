import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),names=['@deepseek-ai/dsh','@deepseek-ai/dsh-sdk-client','@deepseek-ai/dsh-tools'];
const packages=await Promise.all(names.map(async name=>{
 const installed=require(`${name}/package.json`).version;
 const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`无法查询 ${name}`);
 const metadata=await response.json(),tags=metadata['dist-tags'];
 return {name,installed,officialTags:tags,publishedAt:metadata.time[installed],registry:'https://registry.npmjs.org/'};
}));
const lock=JSON.parse(await fs.readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
const graph=Object.entries(lock.packages).filter(([location])=>/^@deepseek-ai\/dsh(?:-|$)/.test(location.replace(/^.*node_modules\//,''))).map(([location,entry])=>({location,version:entry.version}));
const versions=[...new Set(graph.map(item=>item.version))];
assert(packages.every(item=>item.installed===packages[0].installed));assert.deepEqual(versions,[packages[0].installed]);
const report={checkedAt:new Date().toISOString(),currentOfficialLatest:packages[0].officialTags.latest,upToDate:packages[0].installed===packages[0].officialTags.latest,releaseChannel:packages[0].installed.includes('-')?'release-candidate':'stable',packages,lockedHarnessPackageCount:graph.length,lockedHarnessVersions:versions};
await fs.writeFile(new URL('../docs/kernel-version-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));

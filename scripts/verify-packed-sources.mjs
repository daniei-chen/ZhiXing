import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const repository=path.resolve(import.meta.dirname,'..');
const application=path.resolve(process.argv[2]||'release/win-unpacked/resources/app');
const output=path.resolve(process.argv[3]||'.preview/qa-0.12.0/packed-source-manifest.json');
const config=JSON.parse(await fs.readFile(path.join(repository,'electron-builder.yml'),'utf8'));
const files=[];
async function walk(relative){
 for(const item of await fs.readdir(path.join(repository,relative),{withFileTypes:true})){
  assert(!item.isSymbolicLink(),'Source package must not follow symlinks');
  const file=path.posix.join(relative,item.name);
  if(item.isDirectory())await walk(file);else if(item.isFile())files.push(file);
 }
}
for(const pattern of config.files){
 if(pattern.startsWith('!'))continue;
 if(pattern.endsWith('/**/*'))await walk(pattern.slice(0,-5));
 else if(!pattern.startsWith('!')&&pattern!=='package.json')files.push(pattern);
}
const digest=data=>createHash('sha256').update(data).digest('hex');
const manifest=[];
for(const file of files.sort()){
 const [source,packed]=await Promise.all([fs.readFile(path.join(repository,file)),fs.readFile(path.join(application,file))]);
 assert.equal(digest(packed),digest(source),`Packaged file differs from tested source: ${file}`);
 manifest.push({file,sha256:digest(source)});
}
const sourcePackage=JSON.parse(await fs.readFile(path.join(repository,'package.json'),'utf8'));
const packedPackage=JSON.parse(await fs.readFile(path.join(application,'package.json'),'utf8'));
for(const key of ['version','main','dependencies'])assert.deepEqual(packedPackage[key],sourcePackage[key],`Packaged ${key} differs`);
const result={version:packedPackage.version,matchedFiles:manifest.length,sourceFingerprint:digest(JSON.stringify(manifest)),files:manifest};
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({version:result.version,matchedFiles:result.matchedFiles,sourceFingerprint:result.sourceFingerprint}));

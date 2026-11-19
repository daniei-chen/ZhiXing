import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NtExecutable,NtExecutableResource} from 'pe-library';
import {Data,Resource} from 'resedit';
const digest=value=>createHash('sha256').update(Buffer.from(value)).digest('hex');
const brand=await fs.readFile(new URL('../public/brand/zhixing.ico',import.meta.url));
const source=Data.IconFile.from(brand).icons.map(icon=>icon.data);
const bytes=icon=>icon.isRaw()?icon.bin:icon.generate();
const expected=new Set(source.map(icon=>digest(bytes(icon))));
for(const file of process.argv.slice(2)){
 const entries=NtExecutableResource.from(NtExecutable.from(await fs.readFile(file),{ignoreCert:true})).entries;
 const groups=Resource.IconGroupEntry.fromEntries(entries);
 const icons = groups[0]?.getIconItemsFromEntries(entries) || [];
 const actual = new Set(icons.map(icon => digest(bytes(icon))));
 assert(icons.length === source.length && actual.size === expected.size && [...expected].every(hash => actual.has(hash)),
  `Windows 默认图标组与墨竹 ICO 不一致 ${file}`);
 console.log(`PASS bamboo icon resources: ${path.basename(file)} (${source.length} sizes)`);
}
assert.equal(digest(await fs.readFile(new URL('../public/brand/zhixing-bamboo.png',import.meta.url))),'c123f438263f01d27d61c0f354e4ff377b9ce985e292ecfac7ab00bf6d529daa');
console.log('PASS original bamboo artwork SHA-256 unchanged');

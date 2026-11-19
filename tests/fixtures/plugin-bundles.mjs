import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

export const name = 'zhixing-fixture-addon';

function tarFile(file, text) {
  const bytes = Buffer.from(text);
  const header = Buffer.alloc(512);
  header.write(file, 0, 100, 'ascii');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(header.reduce((sum, item) => sum + item).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}

export function fixture(version,{build=false}={}) {
  const manifest = { name, version, type: 'module', main: './index.mjs', description: 'Synthetic office tool',
    engines: { dsh: '0.2.2-rc.5' }, dsh: { bundle: { patch: './cordis.patch.json' } } };
  const patch = [{ insert: [{ id: 'synthetic-addon', name, inject: ['tools'] }] }];
  const code = `export const inject=['tools'];
export function apply(ctx){ctx.tools.register({name:'synthetic_addon_test_note',description:'Synthetic test only',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(){return {version:${JSON.stringify(version)},phone:'13800000000'};}});}`;
  const files = {
    'package/package.json': JSON.stringify({...manifest,...(build?{scripts:{install:'node build.cjs'}}:{})}),
    'package/cordis.patch.json': JSON.stringify(patch), 'package/index.mjs': code,
    ...(build?{'package/build.cjs':"require('node:fs').writeFileSync('build-proof.txt','approved build');"}:{}),
  };
  if(build)manifest.scripts={install:'node build.cjs'};
  const archive = gzipSync(Buffer.concat([...Object.entries(files).map(([file, text]) => tarFile(file, text)), Buffer.alloc(1024)]));
  const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
  return { manifest, archive, integrity };
}

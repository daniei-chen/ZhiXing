import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
// A packaged Electron executable always starts its own main script.
// Use the development desktop host and explicitly load the browser service from the requested package.
const desktopHost=path.resolve('node_modules/electron/dist/electron.exe');
if(process.argv[2]){
 const exe=path.resolve(process.argv[2]);
 const packagedApp=path.join(path.dirname(exe),'resources','app');
 await Promise.all([access(exe),access(path.join(packagedApp,'electron','browser-service.mjs'))]);
 env.ZHIXING_TEST_PACKED_APP=packagedApp;
}
const userData=await mkdtemp(path.join(os.tmpdir(),'zhixing-browser-profile-'));
try{
 const child=spawn(desktopHost,[`--user-data-dir=${userData}`,path.resolve('tests/browser-desktop.cjs')],{env,stdio:'inherit',windowsHide:false});
 child.on('error',error=>{console.error(error.message);process.exitCode=1;});
 const[code]=await once(child,'exit');process.exitCode=code??1;
}finally{
 await rm(userData,{recursive:true,force:true,maxRetries:6,retryDelay:150});
}

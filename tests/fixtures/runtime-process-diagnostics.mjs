import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {appendFileSync} from 'node:fs';
import path from 'node:path';

// Opt-in diagnostics for synthetic runtime tests. Never record child env or
// provider traffic. This module is loaded only with the test --import flag.
const file = process.env.ZHIXING_RUNTIME_PROCESS_TRACE;
if (file) {
 const record = (type, fields = {}) => appendFileSync(file, `${JSON.stringify({
  time: new Date().toISOString(), host: process.pid, type, ...fields,
 })}\n`);
 const original = childProcess.spawn;
 childProcess.spawn = function (...args) {
  const child = original.apply(this, args);
  const state = () => ({pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, killed: child.killed});
  record('spawn', {...state(), executable: path.basename(args[0]), entry: path.basename(args[1]?.[0] || ''), cwd: args[2]?.cwd});
  for (const event of ['spawn', 'exit', 'close', 'disconnect']) child.on(event, (code, signal) => record(`child/${event}`, {...state(), code, signal}));
  child.on('error', error => record('child/error', {...state(), code: error.code, message: error.message}));
  for (const [name, stream] of [['stdin', child.stdin], ['stdout', child.stdout], ['stderr', child.stderr]]) {
   stream?.on('close', () => record(`child/${name}/close`, state()));
   stream?.on('end', () => record(`child/${name}/end`, state()));
   stream?.on('finish', () => record(`child/${name}/finish`, state()));
  }
  const kill = child.kill;
  child.kill = function (signal) {
   record('child/kill/request', {...state(), signal});
   try {
    const accepted = kill.call(this, signal);
    record('child/kill/result', {...state(), signal, accepted});
    return accepted;
   } catch (error) {
    record('child/kill/error', {...state(), code: error.code, message: error.message});
    throw error;
   }
  };
  return child;
 };
 syncBuiltinESMExports();
 record('test/start', {executable: process.execPath, node: process.versions.node, electron: process.versions.electron});
 process.on('exit', code => record('test/exit', {code}));
}

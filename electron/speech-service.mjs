import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const worker = fileURLToPath(new URL('./speech-worker.ps1', import.meta.url));
const executable = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', worker];
function speechEnv() { return Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATH'].filter(key => process.env[key]).map(key => [key, process.env[key]])); }

export class SpeechService {
  constructor(onEvent) { this.onEvent = onEvent; this.active = null; }
  async status() {
    if (process.platform !== 'win32') return { supported: false, languages: [] };
    try { const {stdout} = await promisify(execFile)(executable, [...args, '-List'], { windowsHide: true, env: speechEnv(), timeout: 12000, maxBuffer: 65536 }); return { supported: true, languages: JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) }; }
    catch { return { supported: false, languages: [], message: '未找到 Windows 本机语音识别组件。' }; }
  }
  async start(language = 'zh-CN', id = randomUUID()) {
    if (!['zh-CN','en-US'].includes(language)) throw new Error('不支持的听写语言。');
    if (typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) throw new Error('听写编号无效。');
    if (this.active) throw new Error('听写正在进行。');
    if (process.platform !== 'win32') throw new Error('本机听写需要 Windows 桌面版。');
    const child = spawn(executable, [...args, '-Language', language], { windowsHide: true, env: speechEnv(), stdio: ['pipe','pipe','ignore'] });
    const entry = { id, child, text: '', pending: '', cancelled: false, settled: false, stopping: false, promise: null, settle: null };
    entry.promise = new Promise(resolve => { entry.settle = resolve; });
    this.active = entry;
    const emit = value => { if (!entry.cancelled) this.onEvent?.({ id, ...value }); };
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      entry.pending += chunk;
      if (entry.pending.length > 128000) { this.cancel(id); return; }
      let at;
      while ((at = entry.pending.indexOf('\n')) >= 0) {
        const line = entry.pending.slice(0, at).trim(); entry.pending = entry.pending.slice(at + 1);
        const match = /^(ready|partial|text|level|error|done):([A-Za-z0-9+/=]*)$/.exec(line); if (!match) continue;
        const [,type,payload] = match, text = Buffer.from(payload, 'base64').toString('utf8').slice(0, 16000);
        if (type === 'ready') clearTimeout(entry.startTimer);
        if (type === 'text') {
          const separator = entry.text && !/\s$/.test(entry.text) && !/^\s/.test(text) && language === 'en-US' ? ' ' : '';
          entry.text = (entry.text + separator + text).slice(0, 60000);
        }
        if (type === 'error') entry.error = '本机听写未能启动或已中断。请检查麦克风权限与已安装的语音语言。';
        emit({ type, text: type === 'error' ? entry.error : type === 'text' ? entry.text : text });
      }
    });
    const finish = error => {
      if (entry.settled) return; entry.settled = true; clearTimeout(entry.startTimer); clearTimeout(entry.timer); clearTimeout(entry.killTimer);
      if (this.active === entry) this.active = null;
      const result = { id, text: entry.cancelled ? '' : entry.text, cancelled: entry.cancelled, error: entry.error || (error ? '本机听写进程未能运行。' : undefined) };
      emit({ type: 'ended', ...result }); entry.settle(result);
    };
    child.on('error', finish); child.on('close', code => finish(code !== 0));
    entry.startTimer = setTimeout(() => {
      entry.error = '打开本机语音识别超时。请检查麦克风后重试。';
      child.kill();
    }, 12000);
    entry.startTimer.unref();
    entry.timer = setTimeout(() => { emit({type:'limit',text:'已达到两分钟上限。'}); void this.stop(id); }, 120000);
    entry.timer.unref();
    return { id };
  }
  async stop(id) {
    const entry = this.active; if (!entry || entry.id !== id) throw new Error('这次听写已结束。');
    if (!entry.stopping) { entry.stopping = true; entry.child.stdin.end('finish\n'); entry.killTimer = setTimeout(() => entry.child.kill(), 6500); entry.killTimer.unref(); }
    return entry.promise;
  }
  cancel(id) {
    const entry = this.active; if (!entry || entry.id !== id) return true;
    entry.cancelled = true; entry.child.stdin.end('cancel\n'); entry.child.kill(); return true;
  }
  async close() { if (this.active) { const entry = this.active; this.cancel(entry.id); await entry.promise; } }
}

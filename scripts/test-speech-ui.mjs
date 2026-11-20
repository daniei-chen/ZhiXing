import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { connectUi } from './qa-cdp.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const executable = process.argv[2] ? path.resolve(process.argv[2]) : null;
const mode = executable ? 'packed' : 'source';
const previewRoot = path.join(repository, '.preview', 'qa-0.11.0');
const profile = path.resolve(process.env.ZHIXING_SPEECH_PROFILE || path.join(previewRoot,
  mode === 'source' ? 'speech-full-profile' : 'speech-full-packed-profile', `run-${Date.now()}`));
const evidenceDirectory = path.resolve(process.env.ZHIXING_SPEECH_EVIDENCE || path.join(previewRoot, `speech-full-${mode}-${Date.now()}`));
const rendererPort = Number(process.env.ZHIXING_SPEECH_PORT || 9353);
const mainPort = Number(process.env.ZHIXING_SPEECH_MAIN_PORT || 9354);
const wave = path.join(repository, '.preview', 'sensevoice-e2e', 'tts-huihui-pcm16.wav');
const cacheSource = path.join(previewRoot, 'voice-source-profile', 'zhixing', 'speech', 'sensevoice-int8');
const cache = path.join(profile, 'zhixing', 'speech', 'sensevoice-int8');
const appRoot = executable ? path.join(path.dirname(executable), 'resources', 'app') : repository;
const inputSelector = 'textarea[aria-label="聊天输入框"]';
const records = [];
const protocolRecords = [];
const observationGroup = 'speech-ui-observed-native-objects';
let ui, main, debuggerTap, child;
let identity;
let phase = 'startup';
let failure;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function persist() {
  await fs.writeFile(path.join(evidenceDirectory, 'result.json'), JSON.stringify({
    mode, profile, executable, syntheticDevice: true, rendererPort, mainPort,
    records, protocolRecords, failure: failure?.stack || null,
  }, null, 2));
}

async function record(name, details = {}) {
  records.push({ name, status: 'passed', time: new Date().toISOString(), details });
  await persist();
  console.log(`PASS ${name}`);
}

async function ensurePortFree(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}

async function runNode(args, logName) {
  const log = createWriteStream(path.join(evidenceDirectory, logName));
  const process = spawn(globalThis.process.execPath, args, { cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.pipe(log, { end: false });
  process.stderr.pipe(log, { end: false });
  const [code] = await once(process, 'close');
  await new Promise(resolve => log.end(resolve));
  assert.equal(code, 0, `${logName} failed`);
}

async function terminateOwnedApplication() {
  const command = `
    $launcherId = [int]$env:ZHIXING_SPEECH_CLEANUP_LAUNCHER
    $ownedProfile = $env:ZHIXING_SPEECH_CLEANUP_PROFILE
    $ownedExecutable = $env:ZHIXING_SPEECH_CLEANUP_EXECUTABLE
    $candidates = Get-CimInstance Win32_Process -Filter "ProcessId=$launcherId OR ParentProcessId=$launcherId"
    foreach($candidate in $candidates) {
      if($candidate.ExecutablePath -eq $ownedExecutable -and
         $candidate.CommandLine.Contains("--user-data-dir=$ownedProfile") -and
         $candidate.CommandLine.Contains('--remote-debugging-port=9353')) {
        Stop-Process -Id $candidate.ProcessId -ErrorAction Stop
        Write-Output $candidate.ProcessId
      }
    }
  `;
  const result = await promisify(execFile)('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], { windowsHide: true, timeout: 10000, env: { ...process.env,
    ZHIXING_SPEECH_CLEANUP_LAUNCHER: String(child.pid), ZHIXING_SPEECH_CLEANUP_PROFILE: profile,
    ZHIXING_SPEECH_CLEANUP_EXECUTABLE: executable || path.join(repository, 'node_modules', 'electron', 'dist', '知行.exe'),
  } });
  protocolRecords.push({ kind: 'forced-cleanup', pids: result.stdout.trim() });
  if (child.exitCode === null) child.kill();
}

async function copyVerifiedCache() {
  assert(profile.startsWith(`${previewRoot}${path.sep}`), 'Only an isolated QA profile under .preview/qa-0.11.0 is permitted');
  const marker = path.join(profile, 'speech-ui-owned.json');
  const prior = await fs.readFile(marker, 'utf8').then(JSON.parse, error => { if (error.code !== 'ENOENT') throw error; });
  if (prior) assert.equal(prior.repository, repository);
  else {
    assert.equal(await fs.stat(path.join(profile, 'zhixing', 'workspace.bin')).catch(() => null), null, 'Preserving an unmarked existing profile');
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(marker, JSON.stringify({ repository, syntheticOnly: true }, null, 2), { flag: 'wx' });
  }
  const manifest = JSON.parse(await fs.readFile(path.join(repository, 'node_modules', '@deepseek-ai', 'dsh-experimental-speech-to-text-sensevoice', 'runtime', 'assets.json'), 'utf8'));
  const assets = [
    [manifest.models.int8, path.join('models', 'sensevoice-onnx')],
    [manifest.tokens, path.join('models', 'sensevoice-onnx')],
    [manifest.vad, path.join('models', 'silero')],
  ];
  const verified = [];
  for (const [asset, directory] of assets) {
    const source = path.join(cacheSource, directory, asset.name);
    const destination = path.join(cache, directory, asset.name);
    assert.equal((await fs.stat(source)).size, asset.bytes);
    assert.equal(await hash(source), asset.sha256);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const existing = await fs.stat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!existing) await fs.copyFile(source, destination, 1);
    assert.equal((await fs.stat(destination)).size, asset.bytes);
    assert.equal(await hash(destination), asset.sha256);
    verified.push({ name: asset.name, bytes: asset.bytes, sha256: asset.sha256 });
  }
  await record('Official pinned model cache copied and verified', { assets: verified, wave, wavSha256: await hash(wave) });
}

async function waitForTargets() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Isolated application exited during startup');
    try {
      // Chromium may advertise its port before its target handler is ready.
      // A fetch without a deadline can otherwise exceed the entire startup bound.
      const targets = await Promise.all([rendererPort, mainPort].map(async port => {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
        return await response.json();
      }));
      assert(targets[0].some(target => target.type === 'page' && target.url === 'zhixing://app/index.html'));
      assert(targets[1].some(target => target.type === 'node'));
      ui = await connectUi(rendererPort);
      main = await connectUi(mainPort, true);
      return;
    } catch {
      ui?.close();
      main?.close();
      ui = main = null;
      await sleep(200);
    }
  }
  throw new Error('Isolated application debugging endpoints did not become ready');
}

/** Read real instances through the debugger without replacing product methods. */
async function instances(connection, prototypeExpression, projector) {
  // Retain observed native wrappers until cleanup so GC cannot make a resource
  // assertion pass by removing the object from subsequent debugger queries.
  const prototype = await connection.send('Runtime.evaluate', { expression: prototypeExpression, awaitPromise: true, returnByValue: false, objectGroup: observationGroup });
  if (prototype.exceptionDetails) throw new Error(prototype.exceptionDetails.text);
  const objects = await connection.send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId, objectGroup: observationGroup });
  const response = await connection.send('Runtime.callFunctionOn', { objectId: objects.objects.objectId, functionDeclaration: projector, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function speechState() {
  const file = path.join(appRoot, 'electron', 'speech-service.mjs');
  const values = await instances(main, `process.mainModule.require(${JSON.stringify(file)}).SpeechService.prototype`, `function(){return this.filter(item=>item.dataRoot===${JSON.stringify(cache)}).map(item=>({active:item.active?{id:item.active.id,transcribing:item.active.transcribing}:null,canCapture:item.canCapture(),closed:item.closed,preparation:item.speech?.snapshot().providers.find(provider=>provider.id==='sensevoice-local')?.preparation}));}`);
  assert.equal(values.length, 1, 'Expected the isolated application speech service');
  return values[0];
}

async function captureState() {
  const tracks = await instances(ui, 'MediaStreamTrack.prototype', 'function(){return this.filter(track=>track.kind==="audio").map(track=>({kind:track.kind,state:track.readyState,settings:track.getSettings()}));}');
  const recorders = await instances(ui, 'MediaRecorder.prototype', 'function(){return this.map(item=>({state:item.state,mimeType:item.mimeType,tracks:item.stream.getAudioTracks().map(track=>track.readyState)}));}');
  const contexts = await instances(ui, 'AudioContext.prototype', 'function(){return this.map(context=>({state:context.state,sampleRate:context.sampleRate}));}');
  return { tracks, recorders, contexts, host: await speechState() };
}

async function assertReleased(name) {
  const state = await captureState();
  assert.equal(state.host.canCapture, false, name);
  assert.equal(state.host.active, null, name);
  assert(state.tracks.every(track => track.state === 'ended'), `${name} left a live track`);
  assert(state.recorders.every(recorder => recorder.state === 'inactive'), `${name} left an active MediaRecorder`);
  assert(state.contexts.every(context => context.state === 'closed'), `${name} left a live AudioContext`);
  assert.equal(await ui.evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).disabled`), false);
  return state;
}

/** Function breakpoints collect permission inputs and WAV headers, then immediately resume. */
async function observeProtocol() {
  const targets = await fetch(`http://127.0.0.1:${mainPort}/json/list`).then(response => response.json());
  const socket = new WebSocket(targets.find(target => target.type === 'node').webSocketDebuggerUrl);
  await once(socket, 'open');
  let sequence = 0;
  const pending = new Map();
  const breakpoints = new Map();
  const errors = [];
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Debugger timeout ${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    if (message.method !== 'Debugger.paused') return;
    void (async () => {
      try {
        const kind = message.params.hitBreakpoints.map(id => breakpoints.get(id)).find(Boolean);
        if (!kind) throw new Error('Unexpected debugger pause');
        const expression = kind === 'permission'
          ? '({permission:arguments[0].permission,isMainWindow:arguments[0].isMainWindow,armed:arguments[0].armed,details:arguments[0].details})'
          : '(()=>{const b=Buffer.from(arguments[0],"base64");return {bytes:b.length,riff:b.toString("ascii",0,4),wave:b.toString("ascii",8,12),channels:b.readUInt16LE(22),sampleRate:b.readUInt32LE(24),bits:b.readUInt16LE(34),audioSeconds:b.readUInt32LE(40)/32000};})()';
        const result = await send('Debugger.evaluateOnCallFrame', { callFrameId: message.params.callFrames[0].callFrameId, expression, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        protocolRecords.push({ time: new Date().toISOString(), phase, kind, ...result.result.value });
      } catch (error) { errors.push(error.message); }
      finally { await send('Debugger.resume').catch(error => errors.push(error.message)); }
    })();
  });
  try {
    await send('Debugger.enable');
    for (const [file, exported, kind] of [['speech-policy.mjs', 'permitsSpeechCapture', 'permission'], ['speech-service.mjs', 'decodeSpeechRecording', 'wav']]) {
      const filePath = path.join(appRoot, 'electron', file);
      const url = pathToFileURL(filePath).href;
      const lines = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/);
      const declaration = lines.findIndex(line => line.startsWith(`export function ${exported}(`));
      assert(declaration >= 0, `Missing observation target ${exported}`);
      const breakpoint = await send('Debugger.setBreakpointByUrl', { url, lineNumber: declaration + 1 });
      assert(breakpoint.locations.length > 0, `Observation target was not loaded ${exported}`);
      breakpoints.set(breakpoint.breakpointId, kind);
    }
  } catch (error) {
    await send('Debugger.disable').catch(() => {});
    socket.close();
    throw error;
  }
  return { errors, close: async () => { await send('Debugger.disable'); socket.close(); } };
}

async function sessionFiles() {
  const result = {};
  for (const area of ['harness', 'vaults']) {
    const directory = path.join(profile, 'zhixing', area);
    async function visit(current) {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const entry of entries) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) await visit(file);
        else result[path.relative(path.join(profile, 'zhixing'), file)] = { bytes: (await fs.stat(file)).size, sha256: await hash(file) };
      }
    }
    await visit(directory);
  }
  return result;
}

async function deniedMedia(constraints) {
  return ui.evaluate(`(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia(${JSON.stringify(constraints)});stream.getTracks().forEach(track=>track.stop());return {granted:true};}catch(error){return {granted:false,name:error.name,message:error.message};}})()`);
}

async function startRecording() {
  await ui.click('本机语音听写');
  await ui.waitFor('document.querySelector(".dictation-panel")?.innerText.includes("正在听写") || document.querySelector(".dictation-panel")?.innerText.includes("开始听写") || !!document.querySelector(".dictation-error")', 20000);
  if (await ui.evaluate('[...document.querySelectorAll(".dictation-panel button")].some(button=>button.textContent==="开始听写")')) {
    await ui.click('开始听写', '.dictation-panel button');
    await ui.waitFor('document.querySelector(".dictation-panel")?.innerText.includes("正在听写") || !!document.querySelector(".dictation-error")', 20000);
  }
  const error = await ui.evaluate('document.querySelector(".dictation-error")?.innerText');
  assert(!error, error);
  const state = await captureState();
  assert.equal(state.host.canCapture, true);
  assert(state.tracks.some(track => track.state === 'live'));
  assert(state.recorders.some(recorder => recorder.state === 'recording'));
  return state;
}

async function seedEmptyChats() {
  // Only setup data is seeded through the real encrypted save IPC. Speech APIs remain native.
  await ui.evaluate(`(async()=>{const state=await window.zhixing.loadWorkspace();for(const title of ['语音验收甲','语音验收乙'])if(!state.chats.some(chat=>chat.title===title))state.chats.push({id:crypto.randomUUID(),title,workspaceId:'office-home',projectId:null,mode:'office',createdAt:Date.now(),updatedAt:Date.now(),messages:[]});await window.zhixing.saveWorkspace(state);})()`);
  await ui.send('Page.reload');
  await ui.waitFor('document.querySelector("textarea[aria-label=聊天输入框]") && !!document.querySelector(".chat-link[title=语音验收甲]")');
  await ui.click('语音验收乙', '.chat-link');
  await ui.fill(inputSelector, '目标聊天原有草稿');
  await ui.click('语音验收甲', '.chat-link');
  await ui.fill(inputSelector, '录音前原有草稿');
}

await fs.mkdir(evidenceDirectory, { recursive: true });
try {
  assert.equal(rendererPort, 9353, 'Speech acceptance is restricted to renderer port 9353');
  assert.equal(mainPort, 9354, 'Speech acceptance is restricted to main inspector port 9354');
  if (executable) assert.equal(await hash(path.join(appRoot, 'electron', 'speech-service.mjs')),
    await hash(path.join(repository, 'electron', 'speech-service.mjs')), 'Rebuild the package with the current speech fix before acceptance');
  await Promise.all([ensurePortFree(rendererPort), ensurePortFree(mainPort)]);
  await copyVerifiedCache();
  if (!executable) {
    await runNode([path.join(repository, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], 'build.log');
    await runNode([path.join(repository, 'scripts', 'prepare-sites-build.mjs')], 'sites-build.log');
    console.log('Source renderer built');
  }
  const args = [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${rendererPort}`, '--remote-debugging-address=127.0.0.1',
    `--inspect=127.0.0.1:${mainPort}`, '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wave}`,
  ];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const applicationLog = createWriteStream(path.join(evidenceDirectory, 'application.log'));
  child = spawn(executable || process.execPath, executable ? args : [path.join(repository, 'scripts', 'run-desktop.mjs'), ...args], {
    cwd: repository, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(applicationLog, { end: false });
  child.stderr.pipe(applicationLog, { end: false });
  child.once('close', () => applicationLog.end());
  console.log(`Starting isolated application, launcher PID ${child.pid}, ports ${rendererPort}/${mainPort}`);
  await waitForTargets();
  identity = await main.evaluate('(()=>{const {app}=process.mainModule.require("electron");return {profile:app.getPath("userData"),isPackaged:app.isPackaged,appPath:app.getAppPath(),pid:process.pid,version:app.getVersion(),fakeDevice:app.commandLine.hasSwitch("use-fake-device-for-media-stream"),captureFile:app.commandLine.getSwitchValue("use-file-for-fake-audio-capture"),fakePermissionUi:app.commandLine.hasSwitch("use-fake-ui-for-media-stream"),runAsNode:process.env.ELECTRON_RUN_AS_NODE??null};})()');
  assert.equal(identity.profile, profile);
  assert.equal(identity.fakeDevice, true);
  assert.equal(identity.captureFile, wave);
  assert.equal(identity.fakePermissionUi, false);
  await record('Owned application uses a synthetic microphone and real permission handlers', { ...identity, head: (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim() });
  await ui.waitFor('!!document.querySelector("textarea[aria-label=聊天输入框]") && !document.querySelector("textarea[aria-label=聊天输入框]").disabled');
  await seedEmptyChats();
  debuggerTap = await observeProtocol();
  await record('Read-only debugger observers are installed on the real permission policy and WAV decoder');
  await ui.evaluate('window.speechUiEvents=[];window.speechUiStopObserving=window.zhixing.onSpeechEvent(event=>window.speechUiEvents.push({time:Date.now(),type:event.type,id:event.id,text:event.text,preparation:event.snapshot?.providers.find(provider=>provider.id==="sensevoice-local")?.preparation}));');
  const sessionBaseline = await sessionFiles();

  phase = 'unarmed';
  const unarmed = await deniedMedia({ audio: true });
  assert.equal(unarmed.granted, false);
  await record('Microphone denied before a user recording is armed', unarmed);

  phase = 'transcription';
  const recording = await startRecording();
  await ui.screenshot(path.join(evidenceDirectory, 'recording.png'));
  await record('UI click starts real getUserMedia and MediaRecorder', recording);
  const video = await deniedMedia({ video: true });
  const mixed = await deniedMedia({ audio: true, video: true });
  assert.equal(video.granted, false);
  assert.equal(mixed.granted, false);
  await record('Camera and combined audio/video remain denied while audio is armed', { video, mixed });
  await sleep(10500);
  await ui.click('结束听写');
  await ui.waitFor('!!document.querySelector(".dictation-panel button.primary-button") && document.querySelector(".dictation-panel button.primary-button").textContent.includes("插入文字") || !!document.querySelector(".dictation-panel .dictation-error")', 45000);
  const transcript = await ui.evaluate('document.querySelector(".dictation-panel .dictation-transcript")?.innerText');
  assert(transcript?.includes('会议纪要'), `Unexpected transcription ${transcript || await ui.evaluate('document.querySelector(".dictation-panel")?.innerText')}`);
  assert(transcript.includes('星期五'), transcript);
  const recognized = await assertReleased('Completed transcription');
  assert.equal(await ui.evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).value`), '录音前原有草稿');
  await ui.screenshot(path.join(evidenceDirectory, 'transcribed.png'));
  await record('Official SenseVoice transcribes the native resampled recording before insertion', { transcript, resources: recognized });
  await ui.click('插入文字', '.dictation-panel button');
  await ui.waitFor('!document.querySelector(".dictation-panel")');
  const inserted = await ui.evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).value`);
  assert.equal(inserted, `录音前原有草稿\n${transcript}`);
  await record('Confirmed transcript is inserted into the original draft', { inserted });
  await ui.screenshot(path.join(evidenceDirectory, 'draft-inserted.png'));

  phase = 'cancel';
  const textEvents = await ui.evaluate('window.speechUiEvents.filter(event=>event.type==="text").length');
  await startRecording();
  await ui.click('关闭语音听写');
  await ui.waitFor('!document.querySelector(".dictation-panel")');
  await record('Explicit cancellation releases native recording and leaves the draft intact', await assertReleased('Cancelled recording'));
  assert.equal(await ui.evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).value`), inserted);

  phase = 'chat-change';
  await startRecording();
  await ui.click('语音验收乙', '.chat-link');
  await ui.waitFor('!document.querySelector(".dictation-panel")');
  assert.equal(await ui.evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).value`), '目标聊天原有草稿');
  await record('Changing chats cancels the microphone without inserting into the destination', await assertReleased('Changed chat'));
  await ui.click('语音验收甲', '.chat-link');
  assert.equal(await ui.evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).value`), inserted);

  phase = 'modal-suspension';
  await startRecording();
  await ui.click('新建项目');
  await ui.waitFor('!!document.querySelector(".modal") && !document.querySelector(".dictation-panel")');
  await record('Opening an application modal suspends and releases recording', await assertReleased('Modal suspension'));
  await ui.screenshot(path.join(evidenceDirectory, 'modal-cancelled-recording.png'));
  await ui.click('关闭对话框');
  await ui.waitFor('!document.querySelector(".modal")');

  phase = 'settings-suspension';
  await startRecording();
  await ui.click('打开设置');
  await ui.waitFor('!!document.querySelector(".settings-page") && !document.querySelector(".dictation-panel")');
  const settingsState = await captureState();
  assert.equal(settingsState.host.canCapture, false);
  assert.equal(settingsState.host.active, null);
  assert(settingsState.tracks.every(track => track.state === 'ended'));
  await ui.click('返回工作台');
  await record('Opening settings releases capture and restores the original draft on return', await assertReleased('Settings suspension'));
  assert.equal(await ui.evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).value`), inserted);
  assert.equal(await ui.evaluate('window.speechUiEvents.filter(event=>event.type==="text").length'), textEvents);

  phase = 'final-boundaries';
  assert.equal((await deniedMedia({ audio: true })).granted, false);
  assert.deepEqual(await sessionFiles(), sessionBaseline);
  await ui.waitFor('document.querySelector(".workspace-save-banner")?.dataset.saveStatus==="saved"');
  const workspace = await ui.evaluate('window.zhixing.loadWorkspace()');
  const sourceChat = workspace.chats.find(chat => chat.title === '语音验收甲');
  const targetChat = workspace.chats.find(chat => chat.title === '语音验收乙');
  assert.equal(workspace.drafts[`chat:${sourceChat.id}`].text, inserted);
  assert.equal(workspace.drafts[`chat:${targetChat.id}`].text, '目标聊天原有草稿');
  assert.doesNotMatch(JSON.stringify(workspace), /audioBase64|data:audio|audio\/webm|UklGR/);
  assert(workspace.chats.every(chat => chat.messages.length === 0));
  const wavs = protocolRecords.filter(entry => entry.kind === 'wav');
  assert.equal(wavs.length, 1, 'Only the explicitly stopped recording may enter recognition');
  assert.equal(wavs[0].sampleRate, 16000);
  assert.equal(wavs[0].channels, 1);
  assert.equal(wavs[0].bits, 16);
  assert.equal(wavs[0].riff, 'RIFF');
  assert.equal(wavs[0].wave, 'WAVE');
  assert(protocolRecords.some(entry => entry.kind === 'permission' && entry.armed && entry.isMainWindow));
  assert.equal(await main.evaluate('process.env.ELECTRON_RUN_AS_NODE??null'), identity.runAsNode);
  assert.deepEqual(debuggerTap.errors, []);
  await record('Recording boundaries hold and audio never enters Harness sessions or saved workspace', { wavs, sessionBaseline, speechEvents: await ui.evaluate('window.speechUiEvents'), permissions: protocolRecords.filter(entry => entry.kind === 'permission') });
} catch (error) {
  failure = error;
  if (ui) {
    await ui.screenshot(path.join(evidenceDirectory, 'failure.png')).catch(() => {});
    await fs.writeFile(path.join(evidenceDirectory, 'failure-ui.json'), JSON.stringify(await ui.evaluate('({text:document.body.innerText,events:window.speechUiEvents})').catch(() => null), null, 2));
  }
  await persist();
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await debuggerTap?.close().catch(error => console.error(error.message));
  await ui?.send('Runtime.releaseObjectGroup', { objectGroup: observationGroup }).catch(() => {});
  await main?.send('Runtime.releaseObjectGroup', { objectGroup: observationGroup }).catch(() => {});
  if (main && !process.env.ZHIXING_SPEECH_KEEP_OPEN) {
    await main.evaluate('process.mainModule.require("electron").app.quit();true').catch(() => {});
  }
  ui?.close();
  main?.close();
  if (child && !process.env.ZHIXING_SPEECH_KEEP_OPEN && child.exitCode === null) {
    await Promise.race([once(child, 'exit'), sleep(15000)]);
    if (child.exitCode === null) {
      failure ||= new Error('Owned application did not exit after speech cleanup');
      process.exitCode = 1;
      await terminateOwnedApplication().catch(error => { protocolRecords.push({ kind: 'cleanup-error', message: error.message }); });
    } else if (!failure) {
      assert.equal(child.exitCode, 0, 'Owned application exited with an error');
      await Promise.all([ensurePortFree(rendererPort), ensurePortFree(mainPort)]);
      await record('Application exit joins the official local provider and releases both QA ports');
    }
  }
  await persist();
  console.log(JSON.stringify({ result: failure ? 'failed' : 'passed', mode, evidence: evidenceDirectory, profile }));
}

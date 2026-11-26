import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 25_000;
const BASE_COMMIT = 'fcba550b0ac56af16c1de571e2f55bcf8f54b55a';
const STAGES = [
  'initialize', 'consoleEncoding', 'runtimeAssembly', 'storageFileType',
  'randomAccessStreamType', 'bitmapDecoderType', 'softwareBitmapType',
  'ocrResultType', 'ocrEngineType', 'asTaskReflection',
  'engine', 'file', 'open', 'decode', 'bitmap', 'recognize', 'serialize',
];
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');

// Exact, unique anchors fail closed if the production worker changes. Only a
// temporary copy is instrumented; no OCR output or exception message is logged.
export function instrumentWorker(source) {
  let body = source.replaceAll('\r\n', '\n');
  const insert = (name, anchor, code, after = false) => {
    assert.equal(body.split(anchor).length - 1, 1, `Worker anchor missing or duplicated: ${name}`);
    body = body.replace(anchor, after ? `${anchor}\n${code}` : `${code}\n${anchor}`);
  };
  const marker = (stage, phase) => `[Console]::Error.WriteLine('ZX_OCR_STAGE:${stage}:${phase}')`;
  insert('initialize-start', 'param([Parameter(Mandatory=$true)][string]$Image)',
    `${marker('initialize', 'before')}\n[Console]::Error.WriteLine('ZX_OCR_APARTMENT:' + [System.Threading.Thread]::CurrentThread.GetApartmentState())`, true);
  insert('initialize-end', '$stream=$null', marker('initialize', 'after'));
  const anchors = [
    ['consoleEncoding', '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)'],
    ['runtimeAssembly', 'Add-Type -AssemblyName System.Runtime.WindowsRuntime'],
    ['storageFileType', '$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]'],
    ['randomAccessStreamType', '$null=[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]'],
    ['bitmapDecoderType', '$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]'],
    ['softwareBitmapType', '$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]'],
    ['ocrResultType', '$null=[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]'],
    ['ocrEngineType', '$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]'],
    ['asTaskReflection', [
      '$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {',
      " $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and",
      " $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'",
      '} | Select-Object -First 1',
    ].join('\n')],
    ['engine', ' $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()'],
    ['file', ' $file=Wait-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Image)) ([Windows.Storage.StorageFile])'],
    ['open', ' $stream=Wait-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])'],
    ['decode', ' $decoder=Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])'],
    ['bitmap', ' $bitmap=Wait-WinRt ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])'],
    ['recognize', ' $ocr=Wait-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])'],
    ['serialize', ' @{language=$engine.RecognizerLanguage.LanguageTag; width=[int]$decoder.PixelWidth; height=[int]$decoder.PixelHeight; text=$text; lines=$lines} | ConvertTo-Json -Compress -Depth 8'],
  ];
  for (const [stage, anchor] of anchors) {
    insert(stage, anchor, marker(stage, 'before'));
    insert(stage, anchor, marker(stage, 'after'), true);
  }
  insert('exception-code', " @{error='failed'} | ConvertTo-Json -Compress",
    "[Console]::Error.WriteLine('ZX_OCR_HRESULT:' + $_.Exception.HResult)");
  return body;
}

async function main() {
  assert.equal(process.platform, 'win32', 'This diagnostic requires Windows; no Windows result was produced.');
  const destination = process.argv[2];
  assert(destination && path.isAbsolute(destination) && destination.endsWith('.json'), 'Provide an absolute JSON output path.');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const report = {
    schemaVersion: 1,
    purpose: 'Second diagnostic: locate slow initialization in default PowerShell. This is not product acceptance or the existing source gate. All samples are retained; any unsuccessful attempt still exits nonzero.',
    baseCommit: BASE_COMMIT,
    commit: process.env.GITHUB_SHA || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runner: {
      platform: process.platform, release: os.release(), arch: process.arch,
      node: process.version, image: process.env.ImageOS || null,
      imageVersion: process.env.ImageVersion || null,
      availableParallelism: os.availableParallelism(), totalMemoryBytes: os.totalmem(),
    },
    timeoutMs: TIMEOUT_MS,
    samplePlan: 'Default PowerShell only: two sequential attempts, then one pair with concurrency two. Four samples, three waves, at most 75 seconds of child-process waiting; no retries.',
    environment: 'Same eight-variable allowlist and PowerShell executable as electron/ocr-service.mjs',
    stages: STAGES,
    scope: 'Each attempt starts a new PowerShell process. First/repeat describe job order; Windows caches are not reset. Only synthetic fixture data is used; text and pixels are never saved in this report.',
    diagnosticCompleted: false,
    productAcceptance: 'not assessed',
    runs: [],
  };
  const save = async () => {
    const json = JSON.stringify(report, null, 2);
    assert(Buffer.byteLength(json) <= 128 * 1024, 'Diagnostic JSON exceeded its size limit.');
    await fs.writeFile(destination, json);
  };
  let directory;
  try {
    await save();
    const source = await fs.readFile(path.join(ROOT, 'electron/ocr-worker.ps1'), 'utf8');
    const instrumented = instrumentWorker(source);
    const fixture = await fs.readFile(path.join(ROOT, 'tests/fixtures/ocr-office-read.png'));
    report.workerSha256 = hash(source.replaceAll('\r\n', '\n'));
    report.instrumentedWorkerSha256 = hash(instrumented);
    report.fixtureSha256 = hash(fixture);
    report.probeSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-ocr-diagnostics-'));
    const worker = path.join(directory, 'ocr-worker.ps1');
    await fs.writeFile(worker, instrumented);
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH']
      .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    let sequence = 0;
    const launches = { default: 0 };

    async function probe(mode, group, concurrency) {
      const id = ++sequence;
      const modeLaunch = ++launches[mode];
      const image = path.join(directory, `fixture-${id}.png`);
      await fs.writeFile(image, fixture);
      const started = performance.now();
      const stages = [];
      let apartment = null, hresult = null, stderrTail = '';
      const readMarkers = chunk => {
        const lines = (stderrTail + chunk.toString()).split(/\r?\n/);
        stderrTail = lines.pop().slice(-4096);
        for (const line of lines) {
          let match = /^ZX_OCR_STAGE:([A-Za-z][A-Za-z0-9]*):(before|after)$/.exec(line);
          if (match && STAGES.includes(match[1])) stages.push({ name: match[1], phase: match[2], elapsedMs: Math.round(performance.now() - started) });
          match = /^ZX_OCR_APARTMENT:(STA|MTA|Unknown)$/.exec(line);
          if (match) apartment = match[1];
          match = /^ZX_OCR_HRESULT:(-?\d+)$/.exec(line);
          if (match) hresult = Number(match[1]);
        }
      };
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', worker, '-Image', image];
      return new Promise(resolve => {
        const child = execFile(executable, args, {
          windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 750_000, env,
        }, (error, stdout, stderr) => {
          readMarkers('\n');
          let parsed, jsonParsed = false;
          try { parsed = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); jsonParsed = true; } catch { /* Record the boolean, never the output. */ }
          const expectedTextMatch = typeof parsed?.text === 'string' && parsed.text.includes('13800000000');
          const success = !error && jsonParsed && !parsed?.error && expectedTextMatch;
          resolve({
            sequence: id, mode, group, concurrency, modeLaunch, firstInJob: id === 1,
            firstForMode: modeLaunch === 1, elapsedMs: Math.round(performance.now() - started),
            code: error ? error.code ?? null : 0, signal: error?.signal ?? null,
            killed: Boolean(error?.killed), apartment, hresult, success,
            stages, lastStage: stages.at(-1)?.name ?? null, lastStagePhase: stages.at(-1)?.phase ?? null,
            waitingStage: stages.at(-1)?.phase === 'before' ? stages.at(-1).name : null,
            stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr),
            jsonParsed, workerError: ['no-language', 'dimensions', 'failed'].includes(parsed?.error) ? parsed.error : parsed?.error ? 'unclassified' : null,
            expectedTextMatch,
          });
        });
        child.stderr?.on('data', readMarkers);
      });
    }

    // Four default-mode samples in three 25-second waves (75 seconds).
    // Keep the initial attempts and both concurrent outcomes, without retries.
    for (let index = 1; index <= 2; index++) {
      report.runs.push(await probe('default', `sequential-${index}`, 1));
      await save();
    }
    report.runs.push(...await Promise.all([probe('default', 'pair-1', 2), probe('default', 'pair-1', 2)]));
    await save();
    report.diagnosticCompleted = true;
    report.successfulAttempts = report.runs.filter(run => run.success).length;
    report.unsuccessfulAttempts = report.runs.length - report.successfulAttempts;
    process.exitCode = report.unsuccessfulAttempts ? 1 : 0;
  } catch (error) {
    report.probeError = { name: error.name, code: error.code || null };
    process.exitCode = 1;
  } finally {
    try { if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (error) { report.cleanupError = { code: error.code || null }; process.exitCode = 1; }
    await save();
  }
  console.log(`ZX_OCR_REPORT ${JSON.stringify(report)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`OCR diagnostic could not start (${error.code || error.name}); no Windows success is implied.`);
    process.exitCode = 1;
  });
}

const { app } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.whenReady().then(async () => {
  const { SpeechService } = await import(pathToFileURL(process.argv.at(-2)).href);
  const directory = process.argv.at(-1);
  const voice = new SpeechService(null, { dataRoot: path.join(directory, 'speech') });
  const guard = setTimeout(() => app.exit(1), 20000);
  try {
    assert.equal(process.type, 'browser');
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
    process.env.ZHIXING_SPEECH_TEST_API_KEY = 'synthetic-regression-only';
    await voice.initialise();
    const subprocess = voice.context.get('subprocess');
    const job = subprocess.spawn({
      argv: [process.execPath, '-e', 'console.log(JSON.stringify({runAsNode:process.env.ELECTRON_RUN_AS_NODE,type:process.type,secret:process.env.ZHIXING_SPEECH_TEST_API_KEY}))'],
      cwd: directory, env: { ELECTRON_RUN_AS_NODE: '1' }, graceMs: 1000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
    });
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
    const result = await job.done;
    assert.equal(result.exitCode, 0, job.collected.stderr.readFrom(0).text);
    assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true);
    const output = JSON.parse(job.collected.stdout.readFrom(0).text);
    assert.equal(output.runAsNode, '1');
    assert.notEqual(output.type, 'browser');
    assert.equal(output.secret, undefined);
    assert.throws(() => subprocess.spawn({ argv: [] }));
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
    await voice.close();
    console.log(JSON.stringify({ speechElectronSubprocess: {
      workerRunAsNode: output.runAsNode, hostRestored: true, credentialScrubbed: true,
    } }));
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error.message);
    await voice.close();
    app.exit(1);
  } finally {
    clearTimeout(guard);
    delete process.env.ZHIXING_SPEECH_TEST_API_KEY;
  }
}).catch(error => { console.error(error.stack || error.message); app.exit(1); });

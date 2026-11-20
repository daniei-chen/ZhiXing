const { app, BrowserWindow } = require('electron');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  try {
    await window.loadFile(path.join(path.dirname(process.argv.at(-1)), 'index.html'));
    const bundle = await readFile(process.argv.at(-1), 'utf8');
    await window.webContents.executeJavaScript(bundle);
    const results = await window.webContents.executeJavaScript('window.runSpeechInputTests()');
    console.log(JSON.stringify({ speechComponentResults: results }));
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error.message);
    window.destroy();
    app.exit(1);
  }
});

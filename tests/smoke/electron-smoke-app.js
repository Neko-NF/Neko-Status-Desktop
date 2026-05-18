const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { IPC_CHANNELS } = require('../../src/shared/ipc-contracts');

app.disableHardwareAcceleration();

const timeout = setTimeout(() => {
  console.error('[smoke] timed out waiting for renderer');
  app.exit(1);
}, 15000);

function finish(code, message) {
  clearTimeout(timeout);
  if (message) {
    const writer = code === 0 ? console.log : console.error;
    writer(message);
  }
  app.exit(code);
}

ipcMain.handle(IPC_CHANNELS.CONFIG_GET_ALL, () => ({ ok: true, data: { smoke: true } }));
ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => ({ ok: true, data: app.getVersion() }));

app.whenReady().then(async () => {
  const preload = path.resolve(__dirname, '../../src/preload/index.js');
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload,
    },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <meta charset="utf-8">
    <title>Neko Smoke</title>
  `)}`);

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const checks = [
        !!window.nekoIPC,
        typeof window.nekoIPC.getAllConfig === 'function',
        typeof window.nekoIPC.on === 'function',
        !!window.__NEKO_IPC_CONTRACTS__?.IPC_CHANNELS,
        window.nekoRuntime?.versions?.electron,
      ];
      if (checks.some((value) => !value)) return { type: 'smoke:fail', message: 'preload bridge is incomplete' };
      const config = await window.nekoIPC.getAllConfig();
      if (!config || config.smoke !== true) return { type: 'smoke:fail', message: 'config IPC did not round-trip through preload' };
      window.nekoIPC.on('__smoke_unused__', () => {});
      return { type: 'smoke:pass' };
    })()
  `);

  finish(result?.type === 'smoke:pass' ? 0 : 1, result?.message || '[smoke] preload bridge ok');
});

app.on('window-all-closed', () => {});

const { promisify } = require('util');
const fs = require('fs/promises');
const { execFile, execSync } = require('child_process');
const { IPC_CHANNELS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');

function registerSystemIpc(deps) {
  const {
    ipcMain,
    app,
    dialog,
    shell,
    os,
    systemUtils,
    statusService,
    metricsHistory,
    getMainWindow,
    showWindow,
    setIsQuitting,
    pickPrivacyWindow,
    showNotification,
    getCacheDiskSize,
    removeCacheTargets,
  } = deps;

  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_CAPTURE, async () => {
    try {
      const buf = await systemUtils.captureScreen();
      if (!buf) return createIpcError('CAPTURE_FAILED', '截图获取为空');
      return createIpcSuccess({ data: Array.from(buf), type: 'image/png' });
    } catch (err) {
      return createIpcError('CAPTURE_EXCEPTION', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_ACTIVE_WINDOW, async () => createIpcSuccess(await systemUtils.getActiveWindow()));
  ipcMain.handle(IPC_CHANNELS.SYSTEM_LIST_WINDOWS, async () => createIpcSuccess(await systemUtils.listVisibleWindows()));
  ipcMain.handle(IPC_CHANNELS.PRIVACY_PICK_WINDOW, async () => createIpcSuccess(await pickPrivacyWindow()));

  ipcMain.handle(IPC_CHANNELS.SYSTEM_INFO, async () => {
    const battery = await systemUtils.getBatteryInfo().catch(() => ({}));
    return createIpcSuccess({
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      osType: os.type(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      battery,
    });
  });
  ipcMain.handle(IPC_CHANNELS.SYSTEM_BATTERY, async () => createIpcSuccess(await systemUtils.getBatteryInfo()));
  ipcMain.handle(IPC_CHANNELS.SYSTEM_METRICS, async () => createIpcSuccess(await systemUtils.getSystemMetrics()));
  ipcMain.handle(IPC_CHANNELS.SYSTEM_METRICS_HISTORY, () => createIpcSuccess([...metricsHistory]));
  ipcMain.handle(IPC_CHANNELS.SYSTEM_FINGERPRINT, () => createIpcSuccess(statusService.getDeviceFingerprint()));

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => createIpcSuccess(app.getVersion()));
  ipcMain.handle(IPC_CHANNELS.APP_GET_DEVICE_NAME, () => createIpcSuccess(os.hostname()));
  ipcMain.handle(IPC_CHANNELS.APP_QUIT, () => {
    setIsQuitting(true);
    app.quit();
    return createIpcSuccess();
  });
  ipcMain.handle(IPC_CHANNELS.APP_HIDE, () => {
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.hide();
    return createIpcSuccess();
  });
  ipcMain.handle(IPC_CHANNELS.APP_SHOW, () => {
    showWindow();
    return createIpcSuccess();
  });
  ipcMain.handle(IPC_CHANNELS.APP_MINIMIZE, () => {
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.minimize();
    return createIpcSuccess();
  });
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, (_, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return createIpcSuccess();
  });

  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SHOW, (_, { title, body }) => {
    return createIpcSuccess(showNotification(title, body));
  });

  const focusAssistRegPath = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';
  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_FOCUS_ASSIST, async () => {
    if (os.platform() !== 'win32') return createIpcError('NOT_WINDOWS', '非 Windows 系统');
    try {
      let dndEnabled = false;
      try {
        const out1 = execSync(
          `reg query "${focusAssistRegPath}" /v NOC_GLOBAL_SETTING_TOASTS_ENABLED`,
          { windowsHide: true, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const m1 = out1.match(/0x([0-9a-fA-F]+)/);
        if (m1) dndEnabled = parseInt(m1[1], 16) === 0;
      } catch {
        try {
          const out2 = execSync(
            `reg query "${focusAssistRegPath}" /v NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK`,
            { windowsHide: true, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          );
          const m2 = out2.match(/0x([0-9a-fA-F]+)/);
          if (m2) dndEnabled = parseInt(m2[1], 16) === 0;
        } catch { /* key missing means DND is off */ }
      }
      return createIpcSuccess({ ok: true, enabled: dndEnabled });
    } catch {
      return createIpcSuccess({ ok: true, enabled: false });
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_SET_FOCUS_ASSIST, async (_, enabled) => {
    if (os.platform() !== 'win32') return createIpcError('NOT_WINDOWS', '非 Windows 系统');
    try {
      try {
        execSync(
          `reg add "${focusAssistRegPath}" /v NOC_GLOBAL_SETTING_TOASTS_ENABLED /t REG_DWORD /d ${enabled ? 0 : 1} /f`,
          { windowsHide: true }
        );
      } catch { /* Win10 may not have this key */ }
      try {
        execSync(
          `reg add "${focusAssistRegPath}" /v NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK /t REG_DWORD /d ${enabled ? 0 : 1} /f`,
          { windowsHide: true }
        );
        execSync(
          `reg add "${focusAssistRegPath}" /v NOC_GLOBAL_SETTING_ALLOW_CRITICAL_TOASTS_ABOVE_LOCK /t REG_DWORD /d ${enabled ? 0 : 1} /f`,
          { windowsHide: true }
        );
      } catch { /* ignore */ }
      console.log(`[FocusAssist] ${enabled ? '已开启' : '已关闭'}`);
      return createIpcSuccess({ ok: true, enabled });
    } catch (err) {
      console.warn('[FocusAssist] 设置失败:', err.message);
      return createIpcError('SET_FOCUS_ASSIST_FAILED', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_FILE, async (_, options) => {
    const mainWindow = getMainWindow();
    const filters = options?.filters || [{ name: '安装包', extensions: ['exe', 'zip', '7z'] }];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || '选择文件',
      filters,
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return createIpcSuccess(null);
    return createIpcSuccess(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_SAVE_TEXT_FILE, async (_, payload = {}) => {
    const mainWindow = getMainWindow();
    const content = String(payload.content || '');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: payload.title || '保存日志',
      defaultPath: payload.defaultPath || 'neko-console.log',
      filters: payload.filters || [{ name: '日志文件', extensions: ['log', 'txt'] }],
    });
    if (result.canceled || !result.filePath) {
      return createIpcSuccess({ success: false, canceled: true });
    }
    await fs.writeFile(result.filePath, content, 'utf8');
    return createIpcSuccess({ success: true, canceled: false, path: result.filePath });
  });

  ipcMain.handle(IPC_CHANNELS.CACHE_CLEAR, async () => {
    try {
      const mainWindow = getMainWindow();
      const ses = mainWindow?.webContents?.session;
      if (!ses) return createIpcError('NO_SESSION', 'Unable to access session');
      const beforeBytes = await getCacheDiskSize(ses);
      await ses.clearCache();
      await ses.clearStorageData({
        storages: ['cachestorage', 'shadercache', 'serviceworkers'],
        quotas: ['temporary', 'syncable'],
      });
      const { removed, failed } = await removeCacheTargets(ses);
      const afterBytes = await getCacheDiskSize(ses);
      if (failed.length) {
        return createIpcError('CACHE_CLEAR_PARTIAL', failed.map(item => item.error).join('; '));
      }
      return createIpcSuccess({
        success: true,
        beforeBytes,
        afterBytes,
        clearedBytes: Math.max(0, beforeBytes - afterBytes),
        removedCount: removed.length,
      });
    } catch (e) {
      return createIpcError('CACHE_CLEAR_EXCEPTION', e.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CACHE_GET_SIZE, async () => {
    try {
      const mainWindow = getMainWindow();
      const ses = mainWindow?.webContents?.session;
      if (!ses) return createIpcSuccess(0);
      return createIpcSuccess(await getCacheDiskSize(ses));
    } catch {
      return createIpcSuccess(0);
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_SET_ZOOM, (_, factor) => {
    const mainWindow = getMainWindow();
    if (mainWindow?.webContents) {
      mainWindow.webContents.setZoomFactor(Math.max(0.5, Math.min(3.0, factor)));
    }
    return createIpcSuccess();
  });

  ipcMain.on(IPC_CHANNELS.DEV_RENDERER_ERROR, (_event, payload) => {
    if (app.isPackaged) return;
    const kind = payload?.kind || 'error';
    const message = payload?.message || 'unknown renderer error';
    const source = payload?.source || 'renderer';
    const line = payload?.line ?? '-';
    const column = payload?.column ?? '-';
    console.error(`[Renderer:${kind}] ${message} (${source}:${line}:${column})`);
    if (payload?.stack) {
      console.error(payload.stack);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_FONTS, async () => {
    try {
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('powershell', [
        '-NonInteractive', '-NoProfile', '-Command',
        '$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);' +
        '[System.Reflection.Assembly]::LoadWithPartialName("System.Drawing") | Out-Null;' +
        '[System.Drawing.FontFamily]::Families | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'
      ], { timeout: 8000, windowsHide: true, encoding: 'buffer' });
      const text = stdout.toString('utf8').trim();
      const list = JSON.parse(text);
      return createIpcSuccess(Array.isArray(list) ? list : [list]);
    } catch {
      return createIpcSuccess([]);
    }
  });
}

module.exports = {
  registerSystemIpc,
};

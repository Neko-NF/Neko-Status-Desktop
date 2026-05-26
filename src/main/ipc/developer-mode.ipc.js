const { IPC_CHANNELS, IPC_EVENTS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');
const {
  validateDeveloperModeCommandPayload,
  validateDeveloperModePanelStatePayload,
} = require('../../shared/schemas');

const MAIN_WINDOW_COMMANDS = new Set([
  'open-main-devtools',
  'reload-main-window',
  'focus-main-window',
]);

const PANEL_WINDOW_COMMANDS = new Set([
  'open-panel-devtools',
  'reload-panel-window',
]);

function isUsableWindow(win) {
  return !!win && typeof win.isDestroyed === 'function' && !win.isDestroyed();
}

function openDevTools(win, title) {
  win.webContents.openDevTools({
    mode: 'detach',
    activate: true,
    title,
  });
}

function reloadWindow(win) {
  if (typeof win.webContents.reloadIgnoringCache === 'function') {
    win.webContents.reloadIgnoringCache();
    return;
  }
  if (typeof win.reload === 'function') win.reload();
}

function registerDeveloperModeIpc({
  ipcMain,
  getMainWindow,
  getDeveloperModeWindow,
  openDeveloperModeWindow,
  closeDeveloperModeWindow,
}) {
  ipcMain.handle(IPC_CHANNELS.DEV_MODE_PANEL_OPEN, () => {
    const panel = openDeveloperModeWindow();
    return createIpcSuccess({ opened: !!panel });
  });

  ipcMain.handle(IPC_CHANNELS.DEV_MODE_PANEL_CLOSE, () => {
    closeDeveloperModeWindow();
    return createIpcSuccess({ closed: true });
  });

  ipcMain.handle(IPC_CHANNELS.DEV_MODE_PANEL_COMMAND, (_event, payload = {}) => {
    const validation = validateDeveloperModeCommandPayload(payload);
    if (!validation.ok) {
      return createIpcError('INVALID_DEVELOPER_MODE_COMMAND', validation.reason);
    }
    const mainWindow = getMainWindow();
    if (MAIN_WINDOW_COMMANDS.has(payload.action)) {
      if (!isUsableWindow(mainWindow)) {
        return createIpcError('MAIN_WINDOW_MISSING', 'Main window is not available');
      }
      if (payload.action === 'open-main-devtools') {
        openDevTools(mainWindow, 'Neko Status - 主窗口 DevTools');
      } else if (payload.action === 'reload-main-window') {
        reloadWindow(mainWindow);
      } else if (payload.action === 'focus-main-window') {
        if (typeof mainWindow.show === 'function') mainWindow.show();
        if (typeof mainWindow.focus === 'function') mainWindow.focus();
      }
      return createIpcSuccess({ handled: payload.action });
    }

    if (PANEL_WINDOW_COMMANDS.has(payload.action)) {
      const panel = getDeveloperModeWindow();
      if (!isUsableWindow(panel)) {
        return createIpcError('DEVELOPER_MODE_PANEL_MISSING', 'Developer Mode panel is not available');
      }
      if (payload.action === 'open-panel-devtools') {
        openDevTools(panel, 'Neko Status - 开发者模式 DevTools');
      } else if (payload.action === 'reload-panel-window') {
        reloadWindow(panel);
      }
      return createIpcSuccess({ handled: payload.action });
    }

    if (!isUsableWindow(mainWindow)) {
      return createIpcError('MAIN_WINDOW_MISSING', 'Main window is not available');
    }
    mainWindow.webContents.send(IPC_EVENTS.DEV_MODE_PANEL_COMMAND, payload);
    return createIpcSuccess({ sent: true });
  });

  ipcMain.handle(IPC_CHANNELS.DEV_MODE_PANEL_STATE, (_event, payload = {}) => {
    const validation = validateDeveloperModePanelStatePayload(payload);
    if (!validation.ok) {
      return createIpcError('INVALID_DEVELOPER_MODE_STATE', validation.reason);
    }
    const panel = getDeveloperModeWindow();
    if (panel && !panel.isDestroyed()) {
      panel.webContents.send(IPC_EVENTS.DEV_MODE_PANEL_STATE, payload);
    }
    return createIpcSuccess({ sent: !!panel && !panel.isDestroyed() });
  });
}

module.exports = {
  registerDeveloperModeIpc,
};

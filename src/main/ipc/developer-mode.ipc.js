const { IPC_CHANNELS, IPC_EVENTS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');

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
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return createIpcError('MAIN_WINDOW_MISSING', 'Main window is not available');
    }
    mainWindow.webContents.send(IPC_EVENTS.DEV_MODE_PANEL_COMMAND, payload);
    return createIpcSuccess({ sent: true });
  });

  ipcMain.handle(IPC_CHANNELS.DEV_MODE_PANEL_STATE, (_event, payload = {}) => {
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

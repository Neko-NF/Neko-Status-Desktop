const { IPC_CHANNELS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');

function registerConfigIpc({ ipcMain, configStore }) {
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (_, key) => configStore.get(key));
  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, (_, key, value) => {
    try {
      configStore.set(key, value);
      return createIpcSuccess(true);
    } catch (e) {
      return createIpcError('CONFIG_SET_FAILED', e.message);
    }
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_SET_MANY, (_, values) => {
    try {
      configStore.setMany(values);
      return createIpcSuccess(true);
    } catch (e) {
      return createIpcError('CONFIG_SET_MANY_FAILED', e.message);
    }
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET_ALL, () => configStore.getAll());
}

module.exports = {
  registerConfigIpc,
};

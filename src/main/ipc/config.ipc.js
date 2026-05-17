const { IPC_CHANNELS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');
const {
  validateConfigKeyPayload,
  validateConfigValuesPayload,
} = require('../../shared/schemas');

function registerConfigIpc({ ipcMain, configStore }) {
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (_, key) => {
    const validation = validateConfigKeyPayload(key);
    if (!validation.ok) return createIpcError('INVALID_CONFIG_KEY', validation.reason);
    return createIpcSuccess(configStore.get(key));
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, (_, key, value) => {
    const validation = validateConfigKeyPayload(key);
    if (!validation.ok) return createIpcError('INVALID_CONFIG_KEY', validation.reason);
    try {
      configStore.set(key, value);
      return createIpcSuccess(true);
    } catch (e) {
      return createIpcError('CONFIG_SET_FAILED', e.message);
    }
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_SET_MANY, (_, values) => {
    const validation = validateConfigValuesPayload(values);
    if (!validation.ok) return createIpcError('INVALID_CONFIG_VALUES', validation.reason);
    try {
      configStore.setMany(values);
      return createIpcSuccess(true);
    } catch (e) {
      return createIpcError('CONFIG_SET_MANY_FAILED', e.message);
    }
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET_ALL, () => createIpcSuccess(configStore.getAll()));
}

module.exports = {
  registerConfigIpc,
};

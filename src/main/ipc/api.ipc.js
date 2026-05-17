const { IPC_CHANNELS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');

function registerApiIpc({ ipcMain, os, configStore, statusService, apiService }) {
  ipcMain.handle(IPC_CHANNELS.PAIRING_HANDSHAKE, async (_, { token, model }) => {
    try {
      const result = await apiService.performHandshake({ token, model: model || os.hostname() });
      if (result.success && result.key) {
        configStore.setMany({ deviceKey: result.key, deviceId: result.deviceId });
        return createIpcSuccess({ key: result.key, deviceId: result.deviceId });
      }
      return createIpcError('HANDSHAKE_FAILED', result.error || '握手失败');
    } catch (err) {
      return createIpcError('HANDSHAKE_EXCEPTION', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.API_TEST_CONNECTION, async (_, serverUrl) => {
    try {
      const result = await apiService.testConnection(serverUrl);
      if (result.success) {
        return createIpcSuccess({ latency: result.latency, version: result.version });
      }
      return createIpcError('TEST_CONNECTION_FAILED', result.error || '连接测试失败');
    } catch (err) {
      return createIpcError('TEST_CONNECTION_EXCEPTION', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.API_VALIDATE_KEY, async () => {
    const deviceKey = configStore.get('deviceKey');
    if (!deviceKey) return createIpcError('NO_DEVICE_KEY', '未配置设备密钥');
    try {
      const fingerprint = Buffer.from(
        `${os.hostname()}-${os.platform()}-${os.arch()}`
      ).toString('base64');
      const result = await apiService.validateDeviceKey(deviceKey, fingerprint);
      if (result.valid) return createIpcSuccess(result);
      return createIpcError(result.errorCode || 'VALIDATION_FAILED', result.error || '密钥校验失败');
    } catch (err) {
      return createIpcError('VALIDATION_EXCEPTION', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.API_PREVALIDATE_KEY, async (_, key, serverUrl) => {
    if (!key) return createIpcError('NO_KEY_PROVIDED', '密钥为空');
    try {
      const url = serverUrl || configStore.getServerUrl();
      const result = await apiService.validateDeviceKeyAt(key, url);
      if (result.valid) return createIpcSuccess(result);
      return createIpcError(result.errorCode || 'PREVALIDATION_FAILED', result.error || '密钥校验失败');
    } catch (err) {
      return createIpcError('PREVALIDATION_EXCEPTION', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_SYNC_META, async () => {
    const deviceKey = configStore.get('deviceKey');
    if (!deviceKey) return createIpcError('NO_DEVICE_KEY', '设备密钥未配置');
    const serverUrl = configStore.getServerUrl();
    try {
      const res = await fetch(`${serverUrl}/api/device/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceKey,
          reportEnabled: statusService.isRunning,
          captureEnabled: configStore.get('enableScreenshot') === true,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.warn(`[Meta] 元数据同步失败: HTTP ${res.status}`);
        return createIpcError('SYNC_HTTP_ERROR', `HTTP ${res.status}`);
      }
      console.log(`[Meta] 元数据已同步: reportEnabled=${statusService.isRunning}, captureEnabled=${configStore.get('enableScreenshot') === true}`);
      return createIpcSuccess({});
    } catch (err) {
      return createIpcError('SYNC_EXCEPTION', err.message);
    }
  });
}

module.exports = {
  registerApiIpc,
};

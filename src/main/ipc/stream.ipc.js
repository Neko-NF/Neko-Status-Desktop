const { IPC_CHANNELS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');
const { validateStreamConfigPayload } = require('../../shared/schemas');

function registerStreamIpc({ ipcMain, streamService }) {
  ipcMain.handle(IPC_CHANNELS.STREAM_GET_CONFIG, async () => {
    try {
      const config = await streamService.getStreamConfig();
      return createIpcSuccess(config);
    } catch (err) {
      return createIpcError('GET_CONFIG_ERROR', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STREAM_SAVE_CONFIG, async (_, config) => {
    const validation = validateStreamConfigPayload(config);
    if (!validation.ok) return createIpcError('INVALID_STREAM_CONFIG', validation.reason);
    try {
      const result = await streamService.saveStreamConfig(config);
      if (result.ok) return createIpcSuccess({ ok: true, success: true, ...result.config });
      return createIpcError('SAVE_CONFIG_ERROR', result.error || '保存配置失败');
    } catch (err) {
      return createIpcError('SAVE_CONFIG_EXCEPTION', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STREAM_GET_KEY, async () => {
    try {
      const keyInfo = await streamService.getOrInitStreamKey();
      return createIpcSuccess({
        ...keyInfo,
        streamKey: keyInfo.streamKey || keyInfo.stream_key || '',
      });
    } catch (err) {
      return createIpcError('GET_KEY_ERROR', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STREAM_RESET_KEY, async () => {
    try {
      const keyInfo = await streamService.resetStreamKey();
      return createIpcSuccess({
        ...keyInfo,
        streamKey: keyInfo.streamKey || keyInfo.stream_key || '',
      });
    } catch (err) {
      return createIpcError('RESET_KEY_ERROR', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STREAM_GET_LIVE_STATUS, async () => {
    try {
      const status = await streamService.getStreamLiveStatus();
      return createIpcSuccess({ status });
    } catch (err) {
      return createIpcError('GET_LIVE_STATUS_ERROR', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STREAM_TEST_SRS, async (_, config) => {
    const validation = validateStreamConfigPayload(config);
    if (!validation.ok) return createIpcError('INVALID_STREAM_CONFIG', validation.reason);
    try {
      const result = await streamService.testSrsConnection(config);
      if (result.ok) return createIpcSuccess(result);
      return createIpcError('SRS_TEST_FAILED', result.reason || 'SRS 连接测试失败', result);
    } catch (err) {
      return createIpcError('SRS_TEST_EXCEPTION', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STREAM_TEST_OBS_WS, async (_, config) => {
    const validation = validateStreamConfigPayload(config);
    if (!validation.ok) return createIpcError('INVALID_STREAM_CONFIG', validation.reason);
    try {
      const result = await streamService.testObsWebSocket(config);
      if (result.connected) return createIpcSuccess(result);
      return createIpcError('OBS_TEST_FAILED', result.reason || 'OBS 连接测试失败');
    } catch (err) {
      return createIpcError('OBS_TEST_EXCEPTION', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STREAM_APPLY_TO_OBS, async (_, config) => {
    const validation = validateStreamConfigPayload(config);
    if (!validation.ok) return createIpcError('INVALID_STREAM_CONFIG', validation.reason);
    try {
      const result = await streamService.applyStreamConfigToObs(config);
      if (result.ok) return createIpcSuccess({ ok: true, success: true });
      return createIpcError('APPLY_OBS_FAILED', result.error || '应用至 OBS 失败');
    } catch (err) {
      return createIpcError('APPLY_OBS_EXCEPTION', err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STREAM_EXPORT_CONFIG, async () => {
    try {
      const savedPath = await streamService.exportObsServiceConfig();
      return createIpcSuccess({ ok: true, success: true, path: savedPath });
    } catch (err) {
      return createIpcError('EXPORT_CONFIG_ERROR', err.message);
    }
  });
}

module.exports = {
  registerStreamIpc,
};

const { contextBridge, ipcRenderer } = require('electron');
const { IPC_CHANNELS, IPC_EVENTS } = require('../shared/ipc-contracts');

function createRendererBridge() {
  return {
    getConfig: (key) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET, key),
    setConfig: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, key, value),
    setManyConfig: (obj) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET_MANY, obj),
    getAllConfig: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET_ALL),

    startService: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_START),
    stopService: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_STOP),
    isRunning: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_IS_RUNNING),
    restartService: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_RESTART),
    getLastResult: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_LAST_RESULT),

    enableAutoStart: () => ipcRenderer.invoke(IPC_CHANNELS.AUTOSTART_ENABLE),
    disableAutoStart: () => ipcRenderer.invoke(IPC_CHANNELS.AUTOSTART_DISABLE),
    isAutoStartEnabled: () => ipcRenderer.invoke(IPC_CHANNELS.AUTOSTART_IS_ENABLED),

    getProcessInfo: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_GET_PROCESS_INFO),
    checkPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_CHECK_PERMISSIONS),
    runHealthCheck: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_HEALTH_CHECK),

    captureScreen: () => ipcRenderer.invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE),

    getActiveWindow: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_ACTIVE_WINDOW),
    listWindows: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_LIST_WINDOWS),
    pickPrivacyWindow: () => ipcRenderer.invoke(IPC_CHANNELS.PRIVACY_PICK_WINDOW),

    getSystemInfo: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_INFO),
    getBattery: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_BATTERY),
    getMetrics: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_METRICS),
    getMetricsHistory: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_METRICS_HISTORY),
    getFingerprint: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_FINGERPRINT),

    handshake: (token, model) => ipcRenderer.invoke(IPC_CHANNELS.PAIRING_HANDSHAKE, { token, model }),
    testConnection: (serverUrl) => ipcRenderer.invoke(IPC_CHANNELS.API_TEST_CONNECTION, serverUrl),
    validateKey: () => ipcRenderer.invoke(IPC_CHANNELS.API_VALIDATE_KEY),
    preValidateKey: (key, serverUrl) => ipcRenderer.invoke(IPC_CHANNELS.API_PREVALIDATE_KEY, key, serverUrl),

    getStreamConfig: () => ipcRenderer.invoke(IPC_CHANNELS.STREAM_GET_CONFIG),
    saveStreamConfig: (cfg) => ipcRenderer.invoke(IPC_CHANNELS.STREAM_SAVE_CONFIG, cfg),
    getStreamKey: () => ipcRenderer.invoke(IPC_CHANNELS.STREAM_GET_KEY),
    resetStreamKey: () => ipcRenderer.invoke(IPC_CHANNELS.STREAM_RESET_KEY),
    getStreamLiveStatus: () => ipcRenderer.invoke(IPC_CHANNELS.STREAM_GET_LIVE_STATUS),
    testSrsConnection: (cfg) => ipcRenderer.invoke(IPC_CHANNELS.STREAM_TEST_SRS, cfg),
    testObsWebSocket: (cfg) => ipcRenderer.invoke(IPC_CHANNELS.STREAM_TEST_OBS_WS, cfg),
    applyStreamConfigToObs: (cfg) => ipcRenderer.invoke(IPC_CHANNELS.STREAM_APPLY_TO_OBS, cfg),
    exportObsServiceConfig: () => ipcRenderer.invoke(IPC_CHANNELS.STREAM_EXPORT_CONFIG),

    authLogin: (username, password) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, { username, password }),
    authRegister: (username, password) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_REGISTER, { username, password }),
    authGetMe: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_ME),
    authUpdateProfile: (data) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_UPDATE_PROFILE, data),
    authLogout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
    authGenerateDeviceKey: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GENERATE_DEVICE_KEY),
    authGetState: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_STATE),
    authDismissPrompt: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_DISMISS_PROMPT),

    checkUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
    getChangelog: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_GET_CHANGELOG),
    checkIntegrity: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INTEGRITY),
    rollbackInfo: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_ROLLBACK),
    getUpdateChannel: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_GET_CHANNEL),
    setUpdateChannel: (channel) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SET_CHANNEL, channel),
    downloadUpdate: (url) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD, { url }),
    installUpdate: (filePath, expectedSha256) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL, { filePath, expectedSha256 }),
    getPendingInstall: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_GET_PENDING_INSTALL),
    installPendingUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL_PENDING),

    selectFile: (options) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FILE, options),
    clearCache: () => ipcRenderer.invoke(IPC_CHANNELS.CACHE_CLEAR),
    getCacheSize: () => ipcRenderer.invoke(IPC_CHANNELS.CACHE_GET_SIZE),
    setZoom: (factor) => ipcRenderer.invoke(IPC_CHANNELS.APP_SET_ZOOM, factor),
    getSystemFonts: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_FONTS),

    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    getDeviceName: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_DEVICE_NAME),
    quit: () => ipcRenderer.invoke(IPC_CHANNELS.APP_QUIT),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.APP_HIDE),
    show: () => ipcRenderer.invoke(IPC_CHANNELS.APP_SHOW),
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.APP_MINIMIZE),
    openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
    notify: (title, body) => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SHOW, { title, body }),
    getFocusAssist: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_FOCUS_ASSIST),
    setFocusAssist: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SET_FOCUS_ASSIST, enabled),
    syncMeta: () => ipcRenderer.invoke(IPC_CHANNELS.DEVICE_SYNC_META),

    on(channel, callback) {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },

    once(channel, callback) {
      ipcRenderer.once(channel, (_event, data) => callback(data));
    },

    emitRendererError(payload) {
      ipcRenderer.send(IPC_CHANNELS.DEV_RENDERER_ERROR, payload);
    },
  };
}

contextBridge.exposeInMainWorld('nekoIPC', createRendererBridge());
contextBridge.exposeInMainWorld('__NEKO_IPC_CONTRACTS__', {
  IPC_CHANNELS,
  IPC_EVENTS,
});

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { IPC_CHANNELS, IPC_EVENTS } = require(path.join(__dirname, '../shared/ipc-contracts'));

async function invokeCompat(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result, 'ok')) {
    return result;
  }

  if (result.ok) return result.data;

  const message = result.error?.message || result.error || 'IPC request failed';
  return {
    ok: false,
    success: false,
    error: message,
    message,
    code: result.error?.code,
    details: result.error?.details,
  };
}

function createRendererBridge() {
  return {
    getConfig: (key) => invokeCompat(IPC_CHANNELS.CONFIG_GET, key),
    setConfig: (key, value) => invokeCompat(IPC_CHANNELS.CONFIG_SET, key, value),
    setManyConfig: (obj) => invokeCompat(IPC_CHANNELS.CONFIG_SET_MANY, obj),
    getAllConfig: () => invokeCompat(IPC_CHANNELS.CONFIG_GET_ALL),

    startService: () => invokeCompat(IPC_CHANNELS.SERVICE_START),
    stopService: () => invokeCompat(IPC_CHANNELS.SERVICE_STOP),
    isRunning: () => invokeCompat(IPC_CHANNELS.SERVICE_IS_RUNNING),
    restartService: () => invokeCompat(IPC_CHANNELS.SERVICE_RESTART),
    getLastResult: () => invokeCompat(IPC_CHANNELS.SERVICE_LAST_RESULT),

    enableAutoStart: () => invokeCompat(IPC_CHANNELS.AUTOSTART_ENABLE),
    disableAutoStart: () => invokeCompat(IPC_CHANNELS.AUTOSTART_DISABLE),
    isAutoStartEnabled: () => invokeCompat(IPC_CHANNELS.AUTOSTART_IS_ENABLED),

    getProcessInfo: () => invokeCompat(IPC_CHANNELS.SERVICE_GET_PROCESS_INFO),
    checkPermissions: () => invokeCompat(IPC_CHANNELS.SERVICE_CHECK_PERMISSIONS),
    runHealthCheck: () => invokeCompat(IPC_CHANNELS.SERVICE_HEALTH_CHECK),

    captureScreen: () => invokeCompat(IPC_CHANNELS.SCREENSHOT_CAPTURE),

    getActiveWindow: () => invokeCompat(IPC_CHANNELS.SYSTEM_ACTIVE_WINDOW),
    listWindows: () => invokeCompat(IPC_CHANNELS.SYSTEM_LIST_WINDOWS),
    pickPrivacyWindow: () => invokeCompat(IPC_CHANNELS.PRIVACY_PICK_WINDOW),

    getSystemInfo: () => invokeCompat(IPC_CHANNELS.SYSTEM_INFO),
    getBattery: () => invokeCompat(IPC_CHANNELS.SYSTEM_BATTERY),
    getMetrics: () => invokeCompat(IPC_CHANNELS.SYSTEM_METRICS),
    getMetricsHistory: () => invokeCompat(IPC_CHANNELS.SYSTEM_METRICS_HISTORY),
    getFingerprint: () => invokeCompat(IPC_CHANNELS.SYSTEM_FINGERPRINT),

    handshake: (token, model) => invokeCompat(IPC_CHANNELS.PAIRING_HANDSHAKE, { token, model }),
    testConnection: (serverUrl) => invokeCompat(IPC_CHANNELS.API_TEST_CONNECTION, serverUrl),
    validateKey: () => invokeCompat(IPC_CHANNELS.API_VALIDATE_KEY),
    preValidateKey: (key, serverUrl) => invokeCompat(IPC_CHANNELS.API_PREVALIDATE_KEY, key, serverUrl),

    getStreamConfig: () => invokeCompat(IPC_CHANNELS.STREAM_GET_CONFIG),
    saveStreamConfig: (cfg) => invokeCompat(IPC_CHANNELS.STREAM_SAVE_CONFIG, cfg),
    getStreamKey: () => invokeCompat(IPC_CHANNELS.STREAM_GET_KEY),
    resetStreamKey: () => invokeCompat(IPC_CHANNELS.STREAM_RESET_KEY),
    getStreamLiveStatus: () => invokeCompat(IPC_CHANNELS.STREAM_GET_LIVE_STATUS),
    testSrsConnection: (cfg) => invokeCompat(IPC_CHANNELS.STREAM_TEST_SRS, cfg),
    testSrs: (cfg) => invokeCompat(IPC_CHANNELS.STREAM_TEST_SRS, cfg),
    testObsWebSocket: (cfg) => invokeCompat(IPC_CHANNELS.STREAM_TEST_OBS_WS, cfg),
    applyStreamConfigToObs: (cfg) => invokeCompat(IPC_CHANNELS.STREAM_APPLY_TO_OBS, cfg),
    exportObsServiceConfig: () => invokeCompat(IPC_CHANNELS.STREAM_EXPORT_CONFIG),
    getLiveStatus: () => invokeCompat(IPC_CHANNELS.STREAM_GET_LIVE_STATUS),

    authLogin: (username, password) => invokeCompat(IPC_CHANNELS.AUTH_LOGIN, { username, password }),
    authRegister: (username, password) => invokeCompat(IPC_CHANNELS.AUTH_REGISTER, { username, password }),
    authGetMe: () => invokeCompat(IPC_CHANNELS.AUTH_ME),
    authUpdateProfile: (data) => invokeCompat(IPC_CHANNELS.AUTH_UPDATE_PROFILE, data),
    authLogout: () => invokeCompat(IPC_CHANNELS.AUTH_LOGOUT),
    authGenerateDeviceKey: () => invokeCompat(IPC_CHANNELS.AUTH_GENERATE_DEVICE_KEY),
    authGetState: () => invokeCompat(IPC_CHANNELS.AUTH_GET_STATE),
    authDismissPrompt: () => invokeCompat(IPC_CHANNELS.AUTH_DISMISS_PROMPT),

    checkUpdate: () => invokeCompat(IPC_CHANNELS.UPDATE_CHECK),
    getChangelog: () => invokeCompat(IPC_CHANNELS.UPDATE_GET_CHANGELOG),
    checkIntegrity: () => invokeCompat(IPC_CHANNELS.UPDATE_INTEGRITY),
    rollbackInfo: () => invokeCompat(IPC_CHANNELS.UPDATE_ROLLBACK),
    getUpdateChannel: () => invokeCompat(IPC_CHANNELS.UPDATE_GET_CHANNEL),
    setUpdateChannel: (channel) => invokeCompat(IPC_CHANNELS.UPDATE_SET_CHANNEL, channel),
    downloadUpdate: (url) => invokeCompat(IPC_CHANNELS.UPDATE_DOWNLOAD, { url }),
    installUpdate: (filePath, expectedSha256, options = {}) => invokeCompat(IPC_CHANNELS.UPDATE_INSTALL, { filePath, expectedSha256, ...options }),
    getPendingInstall: () => invokeCompat(IPC_CHANNELS.UPDATE_GET_PENDING_INSTALL),
    installPendingUpdate: () => invokeCompat(IPC_CHANNELS.UPDATE_INSTALL_PENDING),

    selectFile: (options) => invokeCompat(IPC_CHANNELS.DIALOG_SELECT_FILE, options),
    saveTextFile: (options) => invokeCompat(IPC_CHANNELS.DIALOG_SAVE_TEXT_FILE, options),
    clearCache: () => invokeCompat(IPC_CHANNELS.CACHE_CLEAR),
    getCacheSize: () => invokeCompat(IPC_CHANNELS.CACHE_GET_SIZE),
    setZoom: (factor) => invokeCompat(IPC_CHANNELS.APP_SET_ZOOM, factor),
    getSystemFonts: () => invokeCompat(IPC_CHANNELS.SYSTEM_FONTS),

    getVersion: () => invokeCompat(IPC_CHANNELS.APP_GET_VERSION),
    getDeviceName: () => invokeCompat(IPC_CHANNELS.APP_GET_DEVICE_NAME),
    quit: () => invokeCompat(IPC_CHANNELS.APP_QUIT),
    hide: () => invokeCompat(IPC_CHANNELS.APP_HIDE),
    show: () => invokeCompat(IPC_CHANNELS.APP_SHOW),
    minimize: () => invokeCompat(IPC_CHANNELS.APP_MINIMIZE),
    openExternal: (url) => invokeCompat(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
    notify: (title, body) => invokeCompat(IPC_CHANNELS.NOTIFICATION_SHOW, { title, body }),
    getFocusAssist: () => invokeCompat(IPC_CHANNELS.SYSTEM_GET_FOCUS_ASSIST),
    setFocusAssist: (enabled) => invokeCompat(IPC_CHANNELS.SYSTEM_SET_FOCUS_ASSIST, enabled),
    syncMeta: () => invokeCompat(IPC_CHANNELS.DEVICE_SYNC_META),

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

    fetchAnnouncements: (options) => invokeCompat(IPC_CHANNELS.ANNOUNCEMENT_FETCH, options || {}),
    createAnnouncement: (payload) => invokeCompat(IPC_CHANNELS.ANNOUNCEMENT_CREATE, payload),
    updateAnnouncement: (id, payload) => invokeCompat(IPC_CHANNELS.ANNOUNCEMENT_UPDATE, id, payload),
    deleteAnnouncement: (id) => invokeCompat(IPC_CHANNELS.ANNOUNCEMENT_DELETE, id),
    recordAnnouncementReceipt: (id, action) => invokeCompat(IPC_CHANNELS.ANNOUNCEMENT_RECEIPT, id, action),

    openDeveloperModePanel: () => invokeCompat(IPC_CHANNELS.DEV_MODE_PANEL_OPEN),
    closeDeveloperModePanel: () => invokeCompat(IPC_CHANNELS.DEV_MODE_PANEL_CLOSE),
    sendDeveloperModePanelCommand: (payload) => invokeCompat(IPC_CHANNELS.DEV_MODE_PANEL_COMMAND, payload),
    updateDeveloperModePanel: (payload) => invokeCompat(IPC_CHANNELS.DEV_MODE_PANEL_STATE, payload),
  };
}

contextBridge.exposeInMainWorld('nekoIPC', createRendererBridge());
contextBridge.exposeInMainWorld('__NEKO_IPC_CONTRACTS__', {
  IPC_CHANNELS,
  IPC_EVENTS,
});
contextBridge.exposeInMainWorld('nekoRuntime', {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});

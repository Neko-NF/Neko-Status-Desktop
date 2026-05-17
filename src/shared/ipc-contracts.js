const IPC_CHANNELS = Object.freeze({
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_SET_MANY: 'config:setMany',
  CONFIG_GET_ALL: 'config:getAll',

  SERVICE_START: 'service:start',
  SERVICE_STOP: 'service:stop',
  SERVICE_IS_RUNNING: 'service:isRunning',
  SERVICE_RESTART: 'service:restart',
  SERVICE_LAST_RESULT: 'service:lastResult',
  SERVICE_GET_PROCESS_INFO: 'service:getProcessInfo',
  SERVICE_CHECK_PERMISSIONS: 'service:checkPermissions',
  SERVICE_HEALTH_CHECK: 'service:healthCheck',

  AUTOSTART_ENABLE: 'autostart:enable',
  AUTOSTART_DISABLE: 'autostart:disable',
  AUTOSTART_IS_ENABLED: 'autostart:isEnabled',

  SCREENSHOT_CAPTURE: 'screenshot:capture',

  SYSTEM_ACTIVE_WINDOW: 'system:activeWindow',
  SYSTEM_LIST_WINDOWS: 'system:listWindows',
  SYSTEM_INFO: 'system:info',
  SYSTEM_BATTERY: 'system:battery',
  SYSTEM_METRICS: 'system:metrics',
  SYSTEM_METRICS_HISTORY: 'system:metricsHistory',
  SYSTEM_FINGERPRINT: 'system:fingerprint',
  SYSTEM_GET_FOCUS_ASSIST: 'system:getFocusAssist',
  SYSTEM_SET_FOCUS_ASSIST: 'system:setFocusAssist',
  SYSTEM_FONTS: 'system:fonts',

  PRIVACY_PICK_WINDOW: 'privacy:pickWindow',

  PAIRING_HANDSHAKE: 'pairing:handshake',

  API_TEST_CONNECTION: 'api:testConnection',
  API_VALIDATE_KEY: 'api:validateKey',
  API_PREVALIDATE_KEY: 'api:preValidateKey',

  STREAM_GET_CONFIG: 'stream:getConfig',
  STREAM_SAVE_CONFIG: 'stream:saveConfig',
  STREAM_GET_KEY: 'stream:getKey',
  STREAM_RESET_KEY: 'stream:resetKey',
  STREAM_GET_LIVE_STATUS: 'stream:getLiveStatus',
  STREAM_TEST_SRS: 'stream:testSrs',
  STREAM_TEST_OBS_WS: 'stream:testObsWs',
  STREAM_APPLY_TO_OBS: 'stream:applyToObs',
  STREAM_EXPORT_CONFIG: 'stream:exportConfig',

  AUTH_LOGIN: 'auth:login',
  AUTH_REGISTER: 'auth:register',
  AUTH_ME: 'auth:me',
  AUTH_UPDATE_PROFILE: 'auth:updateProfile',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GENERATE_DEVICE_KEY: 'auth:generateDeviceKey',
  AUTH_GET_STATE: 'auth:getState',
  AUTH_DISMISS_PROMPT: 'auth:dismissPrompt',

  UPDATE_CHECK: 'update:check',
  UPDATE_GET_CHANGELOG: 'update:getChangelog',
  UPDATE_INTEGRITY: 'update:integrity',
  UPDATE_ROLLBACK: 'update:rollback',
  UPDATE_GET_CHANNEL: 'update:getChannel',
  UPDATE_SET_CHANNEL: 'update:setChannel',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_GET_PENDING_INSTALL: 'update:getPendingInstall',
  UPDATE_INSTALL_PENDING: 'update:installPending',

  DEVICE_SYNC_META: 'device:syncMeta',

  APP_GET_VERSION: 'app:getVersion',
  APP_GET_DEVICE_NAME: 'app:getDeviceName',
  APP_QUIT: 'app:quit',
  APP_HIDE: 'app:hide',
  APP_SHOW: 'app:show',
  APP_MINIMIZE: 'app:minimize',
  APP_OPEN_EXTERNAL: 'app:openExternal',
  APP_SET_ZOOM: 'app:setZoom',

  NOTIFICATION_SHOW: 'notification:show',
  DIALOG_SELECT_FILE: 'dialog:selectFile',
  DIALOG_SAVE_TEXT_FILE: 'dialog:saveTextFile',

  CACHE_CLEAR: 'cache:clear',
  CACHE_GET_SIZE: 'cache:getSize',

  DEV_RENDERER_ERROR: 'dev:rendererError',
});

const IPC_EVENTS = Object.freeze({
  APP_INIT: 'app:init',
  LOG_ENTRY: 'log:entry',
  SERVICE_TICK: 'service:tick',
  SERVICE_STATUS_CHANGED: 'service:statusChanged',
  SERVICE_KEY_STATUS: 'service:keyStatus',
  UPDATE_PROGRESS: 'update:progress',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_FORCE_INSTALL_STARTED: 'update:forceInstallStarted',
  UPDATE_AUTO_DOWNLOADED: 'update:autoDownloaded',
  UPDATE_AUTO_DOWNLOAD_FAILED: 'update:autoDownloadFailed',
  STARTUP_UPDATE_STATUS: 'startup-update:status',
  SYSTEM_METRICS_UPDATE: 'system:metricsUpdate',
});

function createIpcSuccess(data) {
  return { ok: true, data };
}

function createIpcError(code, message, details) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

module.exports = {
  IPC_CHANNELS,
  IPC_EVENTS,
  createIpcSuccess,
  createIpcError,
};

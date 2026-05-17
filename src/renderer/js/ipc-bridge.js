/**
 * Compatibility layer for older renderer code.
 * The actual IPC bridge now comes from `src/preload/index.js`.
 *
 * When the preload fails (e.g. packaged build path issues), this fallback
 * provides stub implementations for ALL expected IPC methods so the renderer
 * never crashes with "X is not a function".
 */
(function attachPreloadedIpcBridge() {
  if (window.nekoIPC && typeof window.nekoIPC === 'object' && Object.keys(window.nekoIPC).length > 5) {
    // Preload bridge looks healthy — keep it.
    return;
  }

  console.error('[ipc-bridge] preload bridge missing or incomplete; renderer is running in degraded mode');

  // Safe default for async invoke methods: returns null/empty.
  function stubInvoke() {
    return Promise.resolve(null);
  }

  // Stub for on(): logs warning and returns an unsubscribe function.
  function stubOn(channel) {
    console.warn('[ipc-bridge] event subscription skipped (channel: ' + String(channel) + ')');
    return function () {};
  }

  function stubOnce(channel) {
    console.warn('[ipc-bridge] one-time event subscription skipped (channel: ' + String(channel) + ')');
  }

  // Full set of IPC methods that the renderer may call.
  // When the preload is missing, every method is a safe no-op that
  // returns null — callers already guard against falsy returns.
  const fallback = {
    // Event listeners
    on: stubOn,
    once: stubOnce,

    // Config
    getConfig: stubInvoke,
    setConfig: stubInvoke,
    setManyConfig: stubInvoke,
    getAllConfig: stubInvoke,

    // Service
    startService: stubInvoke,
    stopService: stubInvoke,
    isRunning: stubInvoke,
    restartService: stubInvoke,
    getLastResult: stubInvoke,
    getProcessInfo: stubInvoke,
    checkPermissions: stubInvoke,
    runHealthCheck: stubInvoke,

    // Autostart
    enableAutoStart: stubInvoke,
    disableAutoStart: stubInvoke,
    isAutoStartEnabled: stubInvoke,

    // Screenshot
    captureScreen: stubInvoke,

    // System
    getActiveWindow: stubInvoke,
    listWindows: stubInvoke,
    pickPrivacyWindow: stubInvoke,
    getSystemInfo: stubInvoke,
    getBattery: stubInvoke,
    getMetrics: stubInvoke,
    getMetricsHistory: stubInvoke,
    getFingerprint: stubInvoke,
    getFocusAssist: stubInvoke,
    setFocusAssist: stubInvoke,
    getSystemFonts: stubInvoke,
    syncMeta: stubInvoke,

    // API / pairing
    handshake: stubInvoke,
    testConnection: stubInvoke,
    validateKey: stubInvoke,
    preValidateKey: stubInvoke,

    // Stream
    getStreamConfig: stubInvoke,
    saveStreamConfig: stubInvoke,
    getStreamKey: stubInvoke,
    resetStreamKey: stubInvoke,
    getStreamLiveStatus: stubInvoke,
    getLiveStatus: stubInvoke,
    testSrsConnection: stubInvoke,
    testSrs: stubInvoke,
    testObsWebSocket: stubInvoke,
    applyStreamConfigToObs: stubInvoke,
    exportObsServiceConfig: stubInvoke,

    // Auth
    authLogin: stubInvoke,
    authRegister: stubInvoke,
    authGetMe: stubInvoke,
    authUpdateProfile: stubInvoke,
    authLogout: stubInvoke,
    authGenerateDeviceKey: stubInvoke,
    authGetState: function () {
      // Return a safe default so checkFirstTimeAuthPrompt doesn't crash.
      // promptDismissed: true prevents the first-time prompt from showing
      // when the bridge is degraded.
      return Promise.resolve({
        isLoggedIn: false,
        user: null,
        promptDismissed: true,
        serverConfigured: false,
        serverMode: 'production',
      });
    },
    authDismissPrompt: stubInvoke,

    // Update
    checkUpdate: stubInvoke,
    getChangelog: stubInvoke,
    checkIntegrity: stubInvoke,
    rollbackInfo: stubInvoke,
    getUpdateChannel: stubInvoke,
    setUpdateChannel: stubInvoke,
    downloadUpdate: stubInvoke,
    installUpdate: stubInvoke,
    getPendingInstall: stubInvoke,
    installPendingUpdate: stubInvoke,

    // App
    selectFile: stubInvoke,
    saveTextFile: stubInvoke,
    clearCache: stubInvoke,
    getCacheSize: stubInvoke,
    setZoom: stubInvoke,
    getVersion: stubInvoke,
    getDeviceName: stubInvoke,
    quit: stubInvoke,
    hide: stubInvoke,
    show: stubInvoke,
    minimize: stubInvoke,
    openExternal: stubInvoke,
    notify: stubInvoke,

    // Dev
    emitRendererError: stubInvoke,
  };

  window.nekoIPC = fallback;
})();

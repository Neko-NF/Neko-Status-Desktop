(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.services = window._nekoModules.services || {};

  const ipcClient = () => window._nekoModules?.services?.IpcClient;

  function isReady() {
    return !!ipcClient()?.isReady?.();
  }

  function invoke(methodName, ...args) {
    return ipcClient().invoke(methodName, ...args);
  }

  const SystemClient = {
    isReady,
    captureScreen: () => invoke('captureScreen'),
    getActiveWindow: () => invoke('getActiveWindow'),
    listWindows: () => invoke('listWindows'),
    pickPrivacyWindow: () => invoke('pickPrivacyWindow'),
    pickActivityAppWindow: () => invoke('pickActivityAppWindow'),
    selectFile: (options) => invoke('selectFile', options),
    saveTextFile: (options) => invoke('saveTextFile', options),
    notify: (title, body) => invoke('notify', title, body),
    getVersion: () => invoke('getVersion'),
    getDeviceName: () => invoke('getDeviceName'),
    checkPermissions: () => invoke('checkPermissions'),
    getCacheSize: () => invoke('getCacheSize'),
    clearCache: () => invoke('clearCache'),
    getMetrics: () => invoke('getMetrics'),
    getMetricsHistory: () => invoke('getMetricsHistory'),
    getBattery: () => invoke('getBattery'),
    getFingerprint: () => invoke('getFingerprint'),
    getFonts: () => invoke('getSystemFonts'),
    getFocusAssist: () => invoke('getFocusAssist'),
    setFocusAssist: (enabled) => invoke('setFocusAssist', enabled),
    setZoom: (zoomFactor) => invoke('setZoom', zoomFactor),
    openExternal: (url) => invoke('openExternal', url),
  };

  window._nekoModules.services.SystemClient = SystemClient;
})();

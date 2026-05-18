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

  const ServiceClient = {
    isReady,
    isRunning: () => invoke('isRunning'),
    start: () => invoke('startService'),
    stop: () => invoke('stopService'),
    restart: () => invoke('restartService'),
    getLastResult: () => invoke('getLastResult'),
    getProcessInfo: () => invoke('getProcessInfo'),
    checkPermissions: () => invoke('checkPermissions'),
    runHealthCheck: () => invoke('runHealthCheck'),
    isAutoStartEnabled: () => invoke('isAutoStartEnabled'),
    enableAutoStart: () => invoke('enableAutoStart'),
    disableAutoStart: () => invoke('disableAutoStart'),
    syncMeta: () => invoke('syncMeta'),
  };

  window._nekoModules.services.ServiceClient = ServiceClient;
})();

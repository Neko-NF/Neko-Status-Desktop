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

  const ConfigClient = {
    isReady,
    getAll: () => invoke('getAllConfig'),
    get: (key) => invoke('getConfig', key),
    set: (key, value) => invoke('setConfig', key, value),
    setMany: (config) => invoke('setManyConfig', config),
    setDashboardLayout: (layout) => invoke('setConfig', 'dashboardLayout', layout),
    testConnection: (serverUrl) => invoke('testConnection', serverUrl),
    preValidateKey: (deviceKey, serverUrl) => invoke('preValidateKey', deviceKey, serverUrl),
  };

  window._nekoModules.services.ConfigClient = ConfigClient;
})();

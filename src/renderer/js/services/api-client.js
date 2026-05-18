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

  const ApiClient = {
    isReady,
    handshake: (token, model) => invoke('handshake', token, model),
    testConnection: (serverUrl) => invoke('testConnection', serverUrl),
    validateKey: () => invoke('validateKey'),
    preValidateKey: (deviceKey, serverUrl) => invoke('preValidateKey', deviceKey, serverUrl),
  };

  window._nekoModules.services.ApiClient = ApiClient;
})();

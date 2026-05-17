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

  const StreamClient = {
    isReady,
    getConfig: () => invoke('getStreamConfig'),
    saveConfig: (cfg) => invoke('saveStreamConfig', cfg),
    getStreamKey: () => invoke('getStreamKey'),
    resetStreamKey: () => invoke('resetStreamKey'),
    getLiveStatus: () => invoke('getStreamLiveStatus'),
    testSrsConnection: (cfg) => invoke('testSrsConnection', cfg),
    testObsWebSocket: (cfg) => invoke('testObsWebSocket', cfg),
    applyConfigToObs: (cfg) => invoke('applyStreamConfigToObs', cfg),
    exportObsServiceConfig: () => invoke('exportObsServiceConfig'),
  };

  window._nekoModules.services.StreamClient = StreamClient;
})();

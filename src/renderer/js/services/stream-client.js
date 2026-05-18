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

  function installMock() {
    const bridge = window.nekoIPC;
    if (window.__NEKO_ENABLE_STREAM_MOCK__ !== true || !bridge || window._mockStreamConfig) return;
    window._mockStreamConfig = {
      srsHost: '',
      srsRtmpPort: 1935,
      srsApp: 'live',
      srsApiPort: 1985,
      streamKey: '',
      obsWsHost: '127.0.0.1',
      obsWsPort: 4455,
      obsWsPassword: '',
    };

    bridge.getStreamConfig = async () => ({ ...window._mockStreamConfig });
    bridge.saveStreamConfig = async (cfg) => {
      Object.assign(window._mockStreamConfig, cfg);
      return { ok: true };
    };
    bridge.getStreamKey = async () => ({ stream_key: window._mockStreamConfig.streamKey || '' });
    bridge.resetStreamKey = async () => {
      const newKey = `nk_mock_${Math.random().toString(36).slice(2, 10)}`;
      window._mockStreamConfig.streamKey = newKey;
      return { stream_key: newKey };
    };
    bridge.getStreamLiveStatus = async () => 'idle';
    bridge.testSrsConnection = async () => ({
      ok: false,
      reason: 'Mock mode: no real SRS service is attached.',
      rtmp_reachable: false,
      api_reachable: false,
    });
    bridge.testObsWebSocket = async () => ({
      connected: false,
      reason: 'Mock mode: no real OBS process is attached.',
    });
    bridge.applyStreamConfigToObs = async () => ({
      ok: false,
      error: 'Mock mode: no real OBS process is attached.',
    });
    bridge.exportObsServiceConfig = async () => 'C:\\Users\\Demo\\Desktop\\neko-obs-stream-config.json';
  }

  const StreamClient = {
    isReady,
    installMock,
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

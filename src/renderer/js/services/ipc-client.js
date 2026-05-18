(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.services = window._nekoModules.services || {};

  function getBridge() {
    return window.nekoIPC || null;
  }

  const IpcClient = {
    isReady() {
      return !!getBridge();
    },

    has(methodName) {
      return typeof getBridge()?.[methodName] === 'function';
    },

    async invoke(methodName, ...args) {
      const bridge = getBridge();
      const method = bridge?.[methodName];
      if (typeof method !== 'function') {
        throw new Error(`IPC bridge method missing: ${methodName}`);
      }
      return method(...args);
    },

    on(channel, callback) {
      const bridge = getBridge();
      if (typeof bridge?.on !== 'function') {
        console.warn(`[IpcClient] event bridge missing: ${channel}`);
        return () => {};
      }
      return bridge.on(channel, callback);
    },

    once(channel, callback) {
      const bridge = getBridge();
      if (typeof bridge?.once !== 'function') {
        console.warn(`[IpcClient] one-time event bridge missing: ${channel}`);
        return;
      }
      bridge.once(channel, callback);
    },
  };

  window._nekoModules.services.IpcClient = IpcClient;
})();

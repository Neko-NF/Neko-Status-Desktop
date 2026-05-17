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
  };

  window._nekoModules.services.IpcClient = IpcClient;
})();

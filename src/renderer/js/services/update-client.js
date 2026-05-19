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

  const UpdateClient = {
    isReady,
    check: () => invoke('checkUpdate'),
    download: (downloadUrl) => invoke('downloadUpdate', downloadUrl),
    install: (filePath, sha256, options) => invoke('installUpdate', filePath, sha256, options),
    installPending: () => invoke('installPendingUpdate'),
    getPendingInstall: () => invoke('getPendingInstall'),
    checkIntegrity: () => invoke('checkIntegrity'),
    rollbackInfo: () => invoke('rollbackInfo'),
    rollback: (version) => invoke('rollbackVersion', version),
    getChangelog: () => invoke('getChangelog'),
    setChannel: (channel) => invoke('setUpdateChannel', channel),
    setSkippedVersion: (version) => invoke('setConfig', 'skippedVersion', version || ''),
    saveSource: (source) => invoke('setManyConfig', source),
  };

  window._nekoModules.services.UpdateClient = UpdateClient;
})();

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

  const AuthClient = {
    isReady,
    getState: () => invoke('authGetState'),
    login: (username, password) => invoke('authLogin', username, password),
    register: (username, password) => invoke('authRegister', username, password),
    logout: () => invoke('authLogout'),
    getMe: () => invoke('authGetMe'),
    updateProfile: (profile) => invoke('authUpdateProfile', profile),
    dismissPrompt: () => invoke('authDismissPrompt'),
    generateDeviceKey: () => invoke('authGenerateDeviceKey'),
  };

  window._nekoModules.services.AuthClient = AuthClient;
})();

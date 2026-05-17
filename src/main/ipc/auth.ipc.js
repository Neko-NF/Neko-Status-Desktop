const { IPC_CHANNELS } = require('../../shared/ipc-contracts');

function registerAuthIpc({ ipcMain, os, configStore, statusService, apiService }) {
  // Renderer expects { success, ... } format (not { ok, data }).
  // Return API responses directly — they already carry .success.
  function authOk(data) { return { success: true, ...data }; }
  function authFail(message) { return { success: false, error: message }; }

  function localLogin(username, password) {
    const accounts = configStore.get('localTestAccounts') || [];
    const found = accounts.find(a => a.username === username && a.password === password);
    if (!found) return authFail('用户名或密码错误（本地测试模式）');
    const user = { id: `local-${username}`, username, email: '', avatar: '', role: 'user' };
    configStore.setMany({ authToken: 'local-test-token', authUser: user });
    return authOk({ token: 'local-test-token', user, isLocal: true });
  }

  function localRegister(username, password) {
    const accounts = configStore.get('localTestAccounts') || [];
    if (accounts.some(a => a.username === username)) {
      return authFail('用户名已存在（本地测试模式）');
    }
    accounts.push({ username, password, createdAt: new Date().toISOString() });
    configStore.set('localTestAccounts', accounts);
    const user = { id: `local-${username}`, username, email: '', avatar: '', role: 'user' };
    configStore.setMany({ authToken: 'local-test-token', authUser: user });
    return authOk({ token: 'local-test-token', user, isLocal: true });
  }

  function getFriendlyNetworkMessage(err, fallback) {
    const isNetworkError = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|abort/i.test(err.message);
    return isNetworkError
      ? `无法连接到服务器 (${configStore.getServerUrl()})，请检查网络或服务器地址配置`
      : (err.message || fallback);
  }

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_, { username, password }) => {
    const serverMode = configStore.get('serverMode');
    const serverConfigured = configStore.get('serverConfigured');
    if (serverMode === 'local' && !serverConfigured) {
      return localLogin(username, password);
    }
    try {
      const result = await apiService.authLogin(username, password);
      if (result.success && result.token) {
        configStore.setMany({ authToken: result.token, authUser: result.user });
        return result;
      }
      return authFail(result.message || '登录失败');
    } catch (err) {
      console.error('[Auth] 登录请求失败:', err.message);
      if (serverMode === 'local') {
        return localLogin(username, password);
      }
      return authFail(getFriendlyNetworkMessage(err, '登录失败'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_REGISTER, async (_, { username, password }) => {
    const serverMode = configStore.get('serverMode');
    const serverConfigured = configStore.get('serverConfigured');
    if (serverMode === 'local' && !serverConfigured) {
      return localRegister(username, password);
    }
    try {
      const result = await apiService.authRegister(username, password);
      if (result.success && result.token) {
        configStore.setMany({ authToken: result.token, authUser: result.user });
        return result;
      }
      return authFail(result.message || '注册失败');
    } catch (err) {
      console.error('[Auth] 注册请求失败:', err.message);
      if (serverMode === 'local') {
        return localRegister(username, password);
      }
      return authFail(getFriendlyNetworkMessage(err, '注册失败'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_ME, async () => {
    const token = configStore.get('authToken');
    if (!token) return authFail('未登录');
    try {
      const result = await apiService.authGetMe(token);
      if (result.success && result.user) {
        configStore.set('authUser', result.user);
        return result;
      }
      return authFail(result.message || '获取用户信息失败');
    } catch (err) {
      if (err.status === 401) {
        configStore.setMany({ authToken: '', authUser: null });
      }
      return authFail(err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_UPDATE_PROFILE, async (_, data) => {
    const token = configStore.get('authToken');
    if (!token) return authFail('未登录');
    try {
      const result = await apiService.authUpdateProfile(token, data);
      if (result.success && result.user) {
        configStore.set('authUser', result.user);
        return result;
      }
      return authFail(result.message || '更新用户信息失败');
    } catch (err) {
      if (err.status === 401) {
        configStore.setMany({ authToken: '', authUser: null });
      }
      return authFail(err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, () => {
    configStore.setMany({ authToken: '', authUser: null });
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GENERATE_DEVICE_KEY, async () => {
    const token = configStore.get('authToken');
    if (!token) return authFail('未登录');
    try {
      const fingerprint = statusService.getDeviceFingerprint
        ? statusService.getDeviceFingerprint()
        : Buffer.from(`${os.hostname()}-${os.platform()}-${os.arch()}`).toString('base64');
      const result = await apiService.authGenerateDeviceKey(token, {
        deviceName: os.hostname(),
        platform: 'Windows',
        deviceFingerprint: fingerprint,
      });
      if (result.success && result.deviceKey) {
        configStore.setMany({ deviceKey: result.deviceKey, deviceId: result.deviceId });
        return result;
      }
      return authFail(result.message || '生成设备密钥失败');
    } catch (err) {
      if (err.status === 401) {
        configStore.setMany({ authToken: '', authUser: null });
      }
      return authFail(err.message);
    }
  });

  // Renderer expects the raw state object (not wrapped in { ok, data }).
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATE, () => ({
    isLoggedIn: !!configStore.get('authToken'),
    user: configStore.get('authUser'),
    promptDismissed: configStore.get('authPromptDismissed'),
    serverConfigured: configStore.get('serverConfigured'),
    serverMode: configStore.get('serverMode'),
  }));

  ipcMain.handle(IPC_CHANNELS.AUTH_DISMISS_PROMPT, () => {
    configStore.set('authPromptDismissed', true);
    return true;
  });
}

module.exports = {
  registerAuthIpc,
};

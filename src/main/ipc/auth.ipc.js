const { IPC_CHANNELS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');
const {
  validateAuthCredentialsPayload,
  validateAuthUpdateProfilePayload,
} = require('../../shared/schemas');

function registerAuthIpc({ ipcMain, os, configStore, statusService, apiService, activityAgent }) {
  // Keep renderer compatibility in data while preserving the shared IPC envelope.
  function authOk(data = {}) { return createIpcSuccess({ success: true, ...data }); }
  function authFail(message, code = 'AUTH_FAILED') { return createIpcError(code, message); }

  function sameUser(left, right) {
    return left !== undefined && left !== null && right !== undefined && right !== null
      && String(left) === String(right);
  }

  async function syncActivityAfterAuth({ isLocal = false } = {}) {
    if (!activityAgent || isLocal || !activityAgent.isEnabled?.()) return;
    try {
      // A completed logout/app-release intentionally leaves the controller in a
      // stopped state. A successful authentication may resume it, while the
      // controller itself still refuses this override during an active revoke.
      const ready = await activityAgent.ensureRunning({ allowAfterShutdown: true });
      if (!ready.ok) return;
      const status = await activityAgent.getStatus();
      if (status.provisioned === true || status.health?.provision?.state === 'ready') {
        await activityAgent.syncProfile();
      } else {
        await activityAgent.provision();
      }
      await activityAgent.claimTray?.();
    } catch (error) {
      console.warn('[Auth] Activity 会话同步失败:', error.message);
    }
  }

  async function commitAuthSession(token, user, { isLocal = false } = {}) {
    const previousUser = configStore.get('authUser');
    const previousToken = configStore.get('authToken');
    const boundUserId = previousUser?.id ?? configStore.get('activityBoundUserId');
    const nextUserId = user?.id;
    const switchedUser = boundUserId !== undefined && boundUserId !== null
      && nextUserId !== undefined && nextUserId !== null
      && !sameUser(boundUserId, nextUserId);

    if (activityAgent && previousToken && previousUser?.id && !sameUser(previousUser.id, nextUserId)) {
      try { await activityAgent.revoke('account_change'); }
      catch (error) { console.warn('[Auth] 清理旧 Activity 会话失败:', error.message); }
    }
    if (activityAgent && sameUser(previousUser?.id, nextUserId) && previousToken && previousToken !== token) {
      activityAgent.invalidateProvisionGeneration?.();
    }
    if (!sameUser(previousUser?.id, nextUserId)) activityAgent?.resetActivitySessionCache?.();

    const next = {
      authToken: token,
      authUser: user,
      activityBoundUserId: nextUserId ?? null,
      activityDeviceId: switchedUser ? null : configStore.get('activityDeviceId'),
      activityDeviceName: switchedUser ? '' : (configStore.get('activityDeviceName') || ''),
    };
    if (switchedUser) {
      next.enableActivityFeature = false;
      next.enableActivityPublishing = false;
      next.enableActivitySnapshots = false;
    }
    configStore.setMany(next);
    if (switchedUser) activityAgent?.refreshSnapshot?.();
    else await syncActivityAfterAuth({ isLocal });
  }

  async function invalidateAuthSession(reason = 'credential_invalid') {
    const previousUser = configStore.get('authUser');
    if (activityAgent) {
      try { await activityAgent.revoke(reason); }
      catch (error) { console.warn('[Auth] Activity 会话撤销失败:', error.message); }
    }
    activityAgent?.resetActivitySessionCache?.();
    configStore.setMany({
      authToken: '',
      authUser: null,
      activityBoundUserId: previousUser?.id ?? configStore.get('activityBoundUserId') ?? null,
      activityDeviceId: null,
      activityDeviceName: '',
    });
    activityAgent?.refreshSnapshot?.();
  }

  async function localLogin(username, password) {
    const accounts = configStore.get('localTestAccounts') || [];
    const found = accounts.find(a => a.username === username && a.password === password);
    if (!found) return authFail('用户名或密码错误');
    const user = { id: `local-${username}`, username, email: '', avatar: '', role: 'user' };
    await commitAuthSession('local-test-token', user, { isLocal: true });
    return authOk({ token: 'local-test-token', user, isLocal: true });
  }

  async function localRegister(username, password) {
    const accounts = configStore.get('localTestAccounts') || [];
    if (accounts.some(a => a.username === username)) {
      return authFail('用户名已存在');
    }
    accounts.push({ username, password, createdAt: new Date().toISOString() });
    configStore.set('localTestAccounts', accounts);
    const user = { id: `local-${username}`, username, email: '', avatar: '', role: 'user' };
    await commitAuthSession('local-test-token', user, { isLocal: true });
    return authOk({ token: 'local-test-token', user, isLocal: true });
  }

  function isLocalAuthSession() {
    const user = configStore.get('authUser');
    return configStore.get('authToken') === 'local-test-token'
      || String(user?.id || '').startsWith('local-');
  }

  function localUpdateProfile(data = {}) {
    const currentUser = configStore.get('authUser');
    if (!currentUser?.username) return authFail('未找到本地测试账号');

    const accounts = configStore.get('localTestAccounts') || [];
    const accountIndex = accounts.findIndex(a => a.username === currentUser.username);
    if (accountIndex < 0) return authFail('未找到本地测试账号');

    if (data.newPassword) {
      if (!data.currentPassword) return authFail('请输入当前密码');
      if (accounts[accountIndex].password !== data.currentPassword) {
        return authFail('当前密码不正确');
      }
      accounts[accountIndex] = { ...accounts[accountIndex], password: data.newPassword };
      configStore.set('localTestAccounts', accounts);
    }

    const nextUsername = data.username || currentUser.username;
    if (nextUsername !== currentUser.username) {
      accounts[accountIndex] = { ...accounts[accountIndex], username: nextUsername };
      configStore.set('localTestAccounts', accounts);
    }

    const user = {
      ...currentUser,
      id: String(currentUser.id || '').startsWith('local-') ? `local-${nextUsername}` : currentUser.id,
      username: nextUsername,
      email: data.email ?? currentUser.email ?? '',
      avatar: data.avatar || currentUser.avatar || '',
    };
    configStore.set('authUser', user);
    return authOk({ user, isLocal: true });
  }

  function getFriendlyNetworkMessage(err, fallback) {
    const isNetworkError = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|abort/i.test(err.message);
    return isNetworkError
      ? `无法连接到服务器 (${configStore.getServerUrl()})，请检查网络或服务器地址配置`
      : (err.message || fallback);
  }

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_, payload) => {
    const validation = validateAuthCredentialsPayload(payload);
    if (!validation.ok) return createIpcError('INVALID_AUTH_PAYLOAD', validation.reason);
    const { username, password } = payload;
    const serverMode = configStore.get('serverMode');
    const serverConfigured = configStore.get('serverConfigured');
    if (serverMode === 'local' && !serverConfigured) {
      return localLogin(username, password);
    }
    try {
      const result = await apiService.authLogin(username, password);
      if (result.success && result.token) {
        await commitAuthSession(result.token, result.user);
        return authOk(result);
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

  ipcMain.handle(IPC_CHANNELS.AUTH_REGISTER, async (_, payload) => {
    const validation = validateAuthCredentialsPayload(payload);
    if (!validation.ok) return createIpcError('INVALID_AUTH_PAYLOAD', validation.reason);
    const { username, password } = payload;
    const serverMode = configStore.get('serverMode');
    const serverConfigured = configStore.get('serverConfigured');
    if (serverMode === 'local' && !serverConfigured) {
      return localRegister(username, password);
    }
    try {
      const result = await apiService.authRegister(username, password);
      if (result.success && result.token) {
        await commitAuthSession(result.token, result.user);
        return authOk(result);
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
    if (isLocalAuthSession()) return authOk({ user: configStore.get('authUser'), isLocal: true });
    try {
      const result = await apiService.authGetMe(token);
      if (result.success && result.user) {
        configStore.set('authUser', result.user);
        return authOk(result);
      }
      return authFail(result.message || '获取用户信息失败');
    } catch (err) {
      if (err.status === 401) {
        await invalidateAuthSession();
      }
      return authFail(err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_UPDATE_PROFILE, async (_, data = {}) => {
    const validation = validateAuthUpdateProfilePayload(data);
    if (!validation.ok) return createIpcError('INVALID_AUTH_PROFILE_PAYLOAD', validation.reason);
    const token = configStore.get('authToken');
    if (!token) return authFail('未登录');
    if (isLocalAuthSession()) {
      return localUpdateProfile(data);
    }
    try {
      if (data.newPassword) {
        if (!data.currentPassword) return authFail('请输入当前密码');
        const currentUser = configStore.get('authUser') || {};
        const username = currentUser.username || data.username;
        if (!username) return authFail('无法确认当前账号，请重新登录后再修改密码');
        try {
          const verifyResult = await apiService.authLogin(username, data.currentPassword);
          if (!verifyResult?.success) return authFail(verifyResult?.message || '当前密码不正确');
        } catch (verifyErr) {
          return authFail(verifyErr.status === 401 ? '当前密码不正确' : (verifyErr.message || '当前密码校验失败'));
        }
      }

      const result = await apiService.authUpdateProfile(token, data);
      if (result.success && result.user) {
        configStore.set('authUser', result.user);
        return authOk(result);
      }
      return authFail(result.message || '更新用户信息失败');
    } catch (err) {
      if (err.status === 401 && !data.newPassword) {
        await invalidateAuthSession();
      }
      return authFail(err.status === 401 ? '当前登录状态已失效，请重新登录' : err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    await invalidateAuthSession('logout');
    return authOk();
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
        return authOk(result);
      }
      return authFail(result.message || '生成设备密钥失败');
    } catch (err) {
      if (err.status === 401) {
        await invalidateAuthSession();
      }
      return authFail(err.message);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATE, () => createIpcSuccess({
    isLoggedIn: !!configStore.get('authToken'),
    user: configStore.get('authUser'),
    promptDismissed: configStore.get('authPromptDismissed'),
    serverConfigured: configStore.get('serverConfigured'),
    serverMode: configStore.get('serverMode'),
  }));

  ipcMain.handle(IPC_CHANNELS.AUTH_DISMISS_PROMPT, () => {
    configStore.set('authPromptDismissed', true);
    return createIpcSuccess(true);
  });
}

module.exports = {
  registerAuthIpc,
};

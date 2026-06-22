(function attachActivityClient() {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.services = window._nekoModules.services || {};
  const ipc = () => window._nekoModules?.services?.IpcClient;
  const ActivityClient = {
    getState: () => ipc()?.invoke?.('getActivityState'),
    updateSettings: (payload) => ipc()?.invoke?.('updateActivitySettings', payload),
    provisionAgent: () => ipc()?.invoke?.('provisionActivityAgent'),
    pauseAgent: () => ipc()?.invoke?.('pauseActivityAgent'),
    resumeAgent: () => ipc()?.invoke?.('resumeActivityAgent'),
    manage: (action, data = {}) => ipc()?.invoke?.('manageActivity', action, data),
    bootstrap: () => ActivityClient.manage('bootstrap'),
    searchUsers: (query) => ActivityClient.manage('searchUsers', { query }),
    follow: (targetUserId) => ActivityClient.manage('follow', { targetUserId }),
    unfollow: (followId) => ActivityClient.manage('unfollow', { followId }),
    createRule: (data) => ActivityClient.manage('createRule', data),
    updateRule: (ruleId, data) => ActivityClient.manage('updateRule', { ruleId, ...data }),
    deleteRule: (ruleId) => ActivityClient.manage('deleteRule', { ruleId }),
    setPrivacy: (visibility) => ActivityClient.manage('setPrivacy', { visibility }),
    getApps: (targetUserId) => ActivityClient.manage('getApps', { targetUserId }),
    upsertApp: (data) => ActivityClient.manage('upsertApp', data),
    setAppHidden: (appKey, isHidden, displayName) => ActivityClient.manage('setAppHidden', { appKey, isHidden, displayName }),
    block: (userId) => ActivityClient.manage('block', { userId }),
    unblock: (userId) => ActivityClient.manage('unblock', { userId }),
  };
  window._nekoModules.services.ActivityClient = ActivityClient;
})();

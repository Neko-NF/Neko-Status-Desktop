const { IPC_CHANNELS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');
const {
  validateActivitySettingsPayload,
  validateActivityManagePayload,
} = require('../../shared/schemas');
const {
  normalizeActivityAppKey,
  activityDisplayName,
} = require('../activity-agent-controller');

function activityFailure(error) {
  return createIpcError(error.code || 'ACTIVITY_FAILED', error.message || '活动功能操作失败', {
    status: error.status || error.httpStatus,
    transient: error.transient === true,
  });
}

function activityPartialFailure(section, error) {
  return {
    section,
    code: error?.code || 'ACTIVITY_FAILED',
    message: error?.message || '活动数据加载失败',
    ...(error?.status ? { status: error.status } : {}),
  };
}

function readActivitySettings(configStore) {
  return {
    enabled: configStore.get('enableActivityFeature') === true,
    publishing: configStore.get('enableActivityPublishing') === true,
    snapshots: configStore.get('enableActivitySnapshots') === true,
    background: configStore.get('enableActivityBackground') === true,
    autoStart: configStore.get('enableActivityAutoStart') !== false,
  };
}

function legacySnapshot(configStore, agent = {}) {
  const settings = readActivitySettings(configStore);
  const enabled = settings.enabled && configStore.get('enableExperimentalFeatures') === true;
  const state = agent.state || (enabled ? 'starting' : 'disabled');
  const connection = agent.connection || (enabled ? 'reconnecting' : 'offline');
  const receiverState = connection === 'online' ? 'connected'
    : (connection === 'polling' ? 'polling'
      : (connection === 'unprovisioned' ? 'credential_error' : (enabled ? 'retrying' : 'disabled')));
  return {
    ...agent,
    schemaVersion: 2,
    revision: Number(agent.revision) || 0,
    identityRevision: Number(agent.identityRevision) || 0,
    observedAtMs: Date.now(),
    settings,
    effectiveSettings: {
      enabled,
      publishing: enabled && settings.publishing,
      snapshots: enabled && settings.publishing && settings.snapshots,
      background: enabled && settings.background,
      autoStart: enabled && settings.background && settings.autoStart,
    },
    health: {
      overall: !enabled ? 'disabled' : (agent.provisioned === false ? 'needs_enroll' : (receiverState === 'connected' ? 'healthy' : 'recovering')),
      lifecycle: state,
      localIpc: { state: state === 'reconnecting' ? 'reconnecting' : 'connected', attempt: 0, sinceMs: null, nextRetryAtMs: null, lastError: null },
      provision: {
        state: agent.provisioned === false ? 'needs_enroll' : 'ready',
        deviceConfigured: !!agent.deviceId,
        boundToCurrentUser: agent.provisioned !== false,
        everConfigured: configStore.get('activityOnboardingSeen') === true || !!agent.deviceId,
      },
      receiver: { state: receiverState, transport: receiverState === 'polling' ? 'polling' : null, lastConnectedAtMs: null, lastHeartbeatAtMs: null, lastEventAtMs: null, consecutiveFailures: 0, nextRetryAtMs: null, lastError: null },
      publisher: { state: settings.publishing ? (connection === 'online' ? 'online' : 'idle') : 'disabled', lastSuccessAtMs: null, currentApp: agent.latestDetectedApp || null, lastError: null },
    },
    agent: { ...agent },
    state,
    connection,
  };
}

function registerActivityIpc({ ipcMain, configStore, activityAgent }) {
  let settingsUpdateTail = Promise.resolve();
  const sectionCaches = new Map();

  const currentSessionIdentity = () => {
    const token = configStore.get('authToken');
    const userId = configStore.get('authUser')?.id;
    const serverUrl = String(configStore.getServerUrl?.() || '').replace(/\/+$/, '');
    if (!token || userId === undefined || userId === null || !serverUrl) return null;
    return `${serverUrl}::${String(userId)}`;
  };
  const cacheForIdentity = (identity, { create = false } = {}) => {
    if (!identity) return null;
    let cache = sectionCaches.get(identity);
    if (!cache && create) {
      cache = new Map();
      sectionCaches.set(identity, cache);
    }
    return cache || null;
  };
  const resetActivitySessionCache = ({ identity } = {}) => {
    if (identity) sectionCaches.delete(String(identity));
    else sectionCaches.clear();
  };
  activityAgent.setActivitySessionCacheResetHandler?.(resetActivitySessionCache);

  const canonicalSnapshot = async ({ refresh = true } = {}) => {
    let status = null;
    if (refresh) status = await activityAgent.getStatus();
    if (status?.schemaVersion === 2 && status?.health) return status;
    if (typeof activityAgent.getSnapshot === 'function') return activityAgent.getSnapshot();
    return legacySnapshot(configStore, status || activityAgent.lastStatus || {});
  };

  const snapshotFromResult = (result) => {
    if (result?.schemaVersion === 2 && result?.health) return result;
    if (typeof activityAgent.getSnapshot === 'function') return activityAgent.getSnapshot();
    return legacySnapshot(configStore, result || activityAgent.lastStatus || {});
  };

  const isRemoteAvailabilityError = (error) => [
    'API_REDIRECTED',
    'API_NOT_DEPLOYED',
    'API_INCOMPATIBLE',
    'FEATURE_DISABLED',
    'API_TRANSIENT',
  ].includes(error?.code);

  const captureSettingsSession = () => ({
    identity: currentSessionIdentity(),
    authToken: configStore.get('authToken') || '',
    identityRevision: Number(activityAgent.identityRevision) || 0,
  });

  const settingsSessionIsCurrent = (session) => session.identity === currentSessionIdentity()
    && session.authToken === (configStore.get('authToken') || '')
    && session.identityRevision === (Number(activityAgent.identityRevision) || 0);

  const settingsSessionChanged = () => createIpcError(
    'ACTIVITY_SESSION_CHANGED',
    '登录账号或服务器已变更，已取消旧会话的设置保存',
  );

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_GET_STATE, async () => {
    try {
      return createIpcSuccess(await canonicalSnapshot());
    } catch (error) {
      return activityFailure(error);
    }
  });

  const updateSettings = async (payload = {}, requestSession = captureSettingsSession()) => {
    const validation = validateActivitySettingsPayload(payload);
    if (!validation.ok) return createIpcError('INVALID_ACTIVITY_SETTINGS', validation.reason);
    if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
    const updates = {};
    const previous = {
      enableActivityFeature: configStore.get('enableActivityFeature') === true,
      enableActivityPublishing: configStore.get('enableActivityPublishing') === true,
      enableActivitySnapshots: configStore.get('enableActivitySnapshots') === true,
      enableActivityBackground: configStore.get('enableActivityBackground') === true,
      enableActivityAutoStart: configStore.get('enableActivityAutoStart') !== false,
      enableExperimentalFeatures: configStore.get('enableExperimentalFeatures') === true,
    };
    if (payload.enabled !== undefined) updates.enableActivityFeature = payload.enabled;
    if (payload.publishing !== undefined) updates.enableActivityPublishing = payload.publishing;
    if (payload.snapshots !== undefined) updates.enableActivitySnapshots = payload.snapshots;
    if (payload.background !== undefined) updates.enableActivityBackground = payload.background;
    if (payload.autoStart !== undefined) updates.enableActivityAutoStart = payload.autoStart;
    if (payload.enabled === true) updates.enableExperimentalFeatures = true;
    configStore.setMany(updates);
    let snapshotPrivacyUpdated = false;
    let snapshotPrivacyPending = false;
    const snapshotsChanged = payload.snapshots !== undefined
      && payload.snapshots !== previous.enableActivitySnapshots;
    const rollbackSnapshotPrivacy = async () => {
      if (!settingsSessionIsCurrent(requestSession)) return;
      if (snapshotPrivacyPending) {
        activityAgent.markSnapshotPrivacyPending?.(previous.enableActivitySnapshots);
        return;
      }
      if (!snapshotPrivacyUpdated) return;
      try {
        await activityAgent.activityRequest('/api/activity/me/privacy', {
          method: 'PUT',
          body: { shareSnapshots: previous.enableActivitySnapshots },
        });
        if (!settingsSessionIsCurrent(requestSession)) return;
        activityAgent.clearSnapshotPrivacyPending?.();
      } catch (error) {
        if (!settingsSessionIsCurrent(requestSession)) return;
        if (isRemoteAvailabilityError(error)) {
          activityAgent.markSnapshotPrivacyPending?.(previous.enableActivitySnapshots);
        }
      }
    };
    try {
      if (configStore.get('enableActivityFeature') !== true) {
        await activityAgent.revoke();
        requestSession.identityRevision = Number(activityAgent.identityRevision) || 0;
        if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
        const snapshot = await canonicalSnapshot({ refresh: false });
        if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
        return createIpcSuccess(snapshot);
      }
      if (snapshotsChanged) {
        try {
          await activityAgent.activityRequest('/api/activity/me/privacy', {
            method: 'PUT',
            body: { shareSnapshots: payload.snapshots === true },
          });
          if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
          snapshotPrivacyUpdated = true;
          activityAgent.clearSnapshotPrivacyPending?.();
        } catch (error) {
          if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
          if (!isRemoteAvailabilityError(error)) throw error;
          snapshotPrivacyPending = true;
          activityAgent.markSnapshotPrivacyPending?.(payload.snapshots === true);
        }
      }
      const ready = await activityAgent.ensureRunning?.({ allowAfterShutdown: true });
      if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
      if (ready && !ready.ok) {
        throw Object.assign(new Error(ready.message || '后台代理启动失败'), { code: ready.code || 'AGENT_START_FAILED' });
      }
      const current = await activityAgent.getStatus();
      if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
      const alreadyProvisioned = current.provisioned === true
        || current.health?.provision?.state === 'ready';
      const result = alreadyProvisioned ? await activityAgent.syncProfile() : await activityAgent.provision();
      if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
      if (!result.ok) {
        if (isRemoteAvailabilityError(result)) {
          const snapshot = await canonicalSnapshot({ refresh: false });
          if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
          return createIpcSuccess(snapshot);
        }
        configStore.setMany(previous);
        await rollbackSnapshotPrivacy();
        if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
        if (!previous.enableActivityFeature) {
          await activityAgent.revoke();
          requestSession.identityRevision = Number(activityAgent.identityRevision) || 0;
        }
        if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
        return createIpcError(result.code || 'AGENT_SYNC_FAILED', result.message || '后台代理配置失败');
      }
      return createIpcSuccess(snapshotFromResult(result.data));
    } catch (error) {
      if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
      configStore.setMany(previous);
      await rollbackSnapshotPrivacy();
      if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
      if (!previous.enableActivityFeature) {
        await activityAgent.revoke();
        requestSession.identityRevision = Number(activityAgent.identityRevision) || 0;
      }
      if (!settingsSessionIsCurrent(requestSession)) return settingsSessionChanged();
      return activityFailure(error);
    }
  };

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_UPDATE_SETTINGS, (_, payload = {}) => {
    const requestSession = captureSettingsSession();
    const operation = settingsUpdateTail
      .catch(() => undefined)
      .then(() => updateSettings(payload, requestSession));
    settingsUpdateTail = operation.catch(() => undefined);
    return operation;
  });

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_PROVISION_AGENT, async () => {
    const result = typeof activityAgent.repair === 'function'
      ? await activityAgent.repair()
      : await activityAgent.provision();
    return result.ok
      ? createIpcSuccess(result.data?.schemaVersion === 2 ? result.data : await canonicalSnapshot({ refresh: false }))
      : createIpcError(result.code || 'PROVISION_FAILED', result.message || '代理配置失败');
  });
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_PAUSE_AGENT, async () => {
    try {
      const result = await activityAgent.pause();
      return result.ok === false
        ? createIpcError(result.data?.code || 'AGENT_PAUSE_FAILED', result.data?.message || '暂停提醒服务失败')
        : createIpcSuccess(await canonicalSnapshot({ refresh: false }));
    }
    catch (error) { return activityFailure(error); }
  });
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_RESUME_AGENT, async () => {
    try {
      const result = await activityAgent.resume();
      return result.ok === false
        ? createIpcError(result.data?.code || 'AGENT_RESUME_FAILED', result.data?.message || '恢复提醒服务失败')
        : createIpcSuccess(await canonicalSnapshot({ refresh: false }));
    }
    catch (error) { return activityFailure(error); }
  });

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_MANAGE, async (_, payload = {}) => {
    const validation = validateActivityManagePayload(payload);
    if (!validation.ok) return createIpcError('INVALID_ACTIVITY_ACTION', validation.reason);
    const data = payload.data || {};
    const requestIdentity = currentSessionIdentity();
    const sessionUnchanged = () => requestIdentity !== null && requestIdentity === currentSessionIdentity();
    try {
      let result;
      switch (payload.action) {
        case 'bootstrap': {
          const sectionCache = cacheForIdentity(requestIdentity, { create: true });
          const sections = [
            ['follows', '/api/activity/follows', { follows: [] }],
            ['privacy', '/api/activity/me/privacy', { visibility: 'private' }],
            ['apps', '/api/activity/me/apps', { apps: [] }],
            ['followers', '/api/activity/me/followers', { followers: [] }],
            ['blocks', '/api/activity/blocks', { blocks: [] }],
          ];
          const settled = await Promise.allSettled(
            sections.map(([, pathname]) => activityAgent.activityRequest(pathname)),
          );
          if (!sessionUnchanged()) {
            return createIpcError('ACTIVITY_SESSION_CHANGED', '登录账号或服务器已变更，请重新加载 Activity 数据');
          }
          const loaded = {};
          const sectionResults = {};
          const partialFailures = [];
          settled.forEach((entry, index) => {
            const [section, , fallback] = sections[index];
            if (entry.status === 'fulfilled') {
              loaded[section] = entry.value || fallback;
              sectionCache?.set(section, loaded[section]);
              sectionResults[section] = { status: 'fresh', data: loaded[section], error: null };
              return;
            }
            const failure = activityPartialFailure(section, entry.reason);
            const cached = sectionCache?.get(section);
            loaded[section] = cached || fallback;
            sectionResults[section] = {
              status: cached ? 'stale' : 'error',
              data: loaded[section],
              error: failure,
            };
            partialFailures.push(failure);
          });
          try { await activityAgent.getStatus(); } catch {}
          const mergedApps = {
            ...(loaded.apps || {}),
            apps: activityAgent.mergeDetectedApps(loaded.apps?.apps),
          };
          sectionResults.apps = {
            ...sectionResults.apps,
            data: mergedApps,
          };
          result = {
            follows: loaded.follows,
            privacy: loaded.privacy,
            apps: mergedApps,
            followers: loaded.followers,
            blocks: loaded.blocks,
            sections: sectionResults,
            partialFailures,
          };
          if (settled.some((entry) => entry.status === 'fulfilled')) {
            await activityAgent.reconcileSnapshotPrivacy?.();
          }
          break;
        }
        case 'getFollows':
          result = await activityAgent.activityRequest('/api/activity/follows');
          if (sessionUnchanged()) cacheForIdentity(requestIdentity, { create: true })?.set('follows', result);
          break;
        case 'searchUsers':
          result = await activityAgent.activityRequest('/api/activity/users/search', {
            query: /^#?\d+$/.test(String(data.query || '').trim())
              ? { uid: String(data.query).replace(/^#/, '') }
              : { q: data.query },
          });
          break;
        case 'follow':
          result = await activityAgent.activityRequest('/api/activity/follows', { method: 'POST', body: { targetUserId: data.targetUserId } });
          break;
        case 'unfollow':
          result = await activityAgent.activityRequest(`/api/activity/follows/${encodeURIComponent(data.followId)}`, { method: 'DELETE' });
          break;
        case 'createRule':
          result = await activityAgent.activityRequest('/api/activity/rules', { method: 'POST', body: data });
          break;
        case 'updateRule':
          result = await activityAgent.activityRequest(`/api/activity/rules/${encodeURIComponent(data.ruleId)}`, { method: 'PATCH', body: data });
          break;
        case 'deleteRule':
          result = await activityAgent.activityRequest(`/api/activity/rules/${encodeURIComponent(data.ruleId)}`, { method: 'DELETE' });
          break;
        case 'getPrivacy':
          result = await activityAgent.activityRequest('/api/activity/me/privacy');
          break;
        case 'setPrivacy':
          result = await activityAgent.activityRequest('/api/activity/me/privacy', { method: 'PUT', body: { visibility: data.visibility } });
          break;
        case 'getApps':
          result = await activityAgent.activityRequest('/api/activity/me/apps', { query: { targetUserId: data.targetUserId } });
          if (data.targetUserId === undefined || data.targetUserId === null || data.targetUserId === '') {
            try { await activityAgent.getStatus(); } catch {}
            result = {
              ...(result || {}),
              apps: activityAgent.mergeDetectedApps(result?.apps),
            };
          }
          break;
        case 'upsertApp': {
          const appKey = normalizeActivityAppKey(data.appKey);
          result = await activityAgent.activityRequest('/api/activity/me/apps', {
            method: 'POST',
            body: {
              appKey,
              displayName: String(data.displayName || activityDisplayName(appKey)).trim(),
            },
          });
          break;
        }
        case 'setAppHidden': {
          const appKey = normalizeActivityAppKey(data.appKey);
          result = await activityAgent.activityRequest('/api/activity/me/apps', {
            method: 'PATCH',
            body: {
              appKey,
              displayName: String(data.displayName || activityDisplayName(appKey)).trim(),
              isHidden: data.isHidden,
            },
          });
          break;
        }
        case 'getFollowers':
          result = await activityAgent.activityRequest('/api/activity/me/followers');
          break;
        case 'getBlocks':
          result = await activityAgent.activityRequest('/api/activity/blocks');
          break;
        case 'block':
          result = await activityAgent.activityRequest('/api/activity/blocks', { method: 'POST', body: { blockedUserId: data.userId } });
          break;
        case 'unblock':
          result = await activityAgent.activityRequest('/api/activity/blocks', { method: 'DELETE', body: { blockedUserId: data.userId } });
          break;
        default:
          return createIpcError('UNSUPPORTED_ACTIVITY_ACTION', '不支持的活动操作');
      }
      if (!sessionUnchanged()) {
        return createIpcError('ACTIVITY_SESSION_CHANGED', '登录账号或服务器已变更，请重新加载 Activity 数据');
      }
      if (payload.action !== 'bootstrap') await activityAgent.reconcileSnapshotPrivacy?.();
      return createIpcSuccess(result);
    } catch (error) {
      return activityFailure(error);
    }
  });
}

module.exports = { registerActivityIpc };

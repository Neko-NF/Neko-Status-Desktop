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
    status: error.status,
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

function registerActivityIpc({ ipcMain, configStore, activityAgent }) {
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_GET_STATE, async () => {
    try {
      const agent = await activityAgent.getStatus();
      return createIpcSuccess({
        settings: {
          enabled: configStore.get('enableActivityFeature') === true,
          publishing: configStore.get('enableActivityPublishing') === true,
          snapshots: configStore.get('enableActivitySnapshots') === true,
          background: configStore.get('enableActivityBackground') === true,
          autoStart: configStore.get('enableActivityAutoStart') !== false,
        },
        agent,
      });
    } catch (error) {
      return activityFailure(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_UPDATE_SETTINGS, async (_, payload = {}) => {
    const validation = validateActivitySettingsPayload(payload);
    if (!validation.ok) return createIpcError('INVALID_ACTIVITY_SETTINGS', validation.reason);
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
    const rollbackSnapshotPrivacy = async () => {
      if (!snapshotPrivacyUpdated) return;
      try {
        await activityAgent.activityRequest('/api/activity/me/privacy', {
          method: 'PUT',
          body: { shareSnapshots: previous.enableActivitySnapshots },
        });
      } catch {}
    };
    try {
      if (configStore.get('enableActivityFeature') !== true) {
        await activityAgent.revoke();
        return createIpcSuccess({ settings: payload, agent: { state: 'disabled' } });
      }
      if (payload.snapshots !== undefined) {
        await activityAgent.activityRequest('/api/activity/me/privacy', {
          method: 'PUT',
          body: { shareSnapshots: payload.snapshots === true },
        });
        snapshotPrivacyUpdated = true;
      }
      const current = await activityAgent.getStatus();
      const result = current.provisioned ? await activityAgent.syncProfile() : await activityAgent.provision();
      if (!result.ok) {
        configStore.setMany(previous);
        await rollbackSnapshotPrivacy();
        if (!previous.enableActivityFeature) await activityAgent.revoke();
        return createIpcError(result.code || 'AGENT_SYNC_FAILED', result.message || '后台代理配置失败');
      }
      return createIpcSuccess({ settings: payload, agent: result.data });
    } catch (error) {
      configStore.setMany(previous);
      await rollbackSnapshotPrivacy();
      if (!previous.enableActivityFeature) await activityAgent.revoke();
      return activityFailure(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_PROVISION_AGENT, async () => {
    const result = await activityAgent.provision();
    return result.ok ? createIpcSuccess(result.data) : createIpcError(result.code || 'PROVISION_FAILED', result.message || '代理配置失败');
  });
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_PAUSE_AGENT, async () => {
    try { return createIpcSuccess(await activityAgent.pause()); }
    catch (error) { return activityFailure(error); }
  });
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_RESUME_AGENT, async () => {
    try { return createIpcSuccess(await activityAgent.resume()); }
    catch (error) { return activityFailure(error); }
  });

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_MANAGE, async (_, payload = {}) => {
    const validation = validateActivityManagePayload(payload);
    if (!validation.ok) return createIpcError('INVALID_ACTIVITY_ACTION', validation.reason);
    const data = payload.data || {};
    try {
      let result;
      switch (payload.action) {
        case 'bootstrap': {
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
          const loaded = {};
          const partialFailures = [];
          settled.forEach((entry, index) => {
            const [section, , fallback] = sections[index];
            if (entry.status === 'fulfilled') {
              loaded[section] = entry.value || fallback;
              return;
            }
            loaded[section] = fallback;
            partialFailures.push(activityPartialFailure(section, entry.reason));
          });
          try { await activityAgent.getStatus(); } catch {}
          result = {
            follows: loaded.follows,
            privacy: loaded.privacy,
            apps: {
              ...(loaded.apps || {}),
              apps: activityAgent.mergeDetectedApps(loaded.apps?.apps),
            },
            followers: loaded.followers,
            blocks: loaded.blocks,
            partialFailures,
          };
          break;
        }
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
      return createIpcSuccess(result);
    } catch (error) {
      return activityFailure(error);
    }
  });
}

module.exports = { registerActivityIpc };

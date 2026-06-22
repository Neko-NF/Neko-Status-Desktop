const { IPC_CHANNELS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');
const {
  validateConfigKeyPayload,
  validateConfigValuesPayload,
} = require('../../shared/schemas');

const ACTIVITY_BINDING_KEYS = new Set(['serverMode', 'serverUrlProd', 'serverUrlLocal']);
const ACTIVITY_RUNTIME_KEYS = new Set(['enableNotification', 'doNotDisturb']);

function registerConfigIpc({ ipcMain, configStore, activityAgent }) {
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (_, key) => {
    const validation = validateConfigKeyPayload(key);
    if (!validation.ok) return createIpcError('INVALID_CONFIG_KEY', validation.reason);
    return createIpcSuccess(configStore.get(key));
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, async (_, key, value) => {
    const validation = validateConfigKeyPayload(key);
    if (!validation.ok) return createIpcError('INVALID_CONFIG_KEY', validation.reason);
    try {
      if (key === 'enableExperimentalFeatures' && value === false) {
        if (activityAgent && configStore.get('enableActivityFeature') === true) {
          await activityAgent.revoke('disable');
        }
        configStore.setMany({
          enableExperimentalFeatures: false,
          enableExperimentalActivityEntry: false,
          enableExperimentalStreamEntry: false,
          enableExperimentalUiLabEntry: false,
          enableExperimentalCurveLoaders: false,
          enableActivityFeature: false,
          enableActivityPublishing: false,
          enableActivityBackground: false,
        });
        return createIpcSuccess(true);
      }
      if (key === 'enableExperimentalActivityEntry' && value === false) {
        if (activityAgent && configStore.get('enableActivityFeature') === true) {
          await activityAgent.revoke('disable');
        }
        configStore.setMany({
          enableExperimentalActivityEntry: false,
          enableActivityFeature: false,
          enableActivityPublishing: false,
          enableActivityBackground: false,
        });
        return createIpcSuccess(true);
      }
      if (activityAgent && ACTIVITY_BINDING_KEYS.has(key) && configStore.get(key) !== value) {
        await activityAgent.revoke('disable');
        configStore.set('enableActivityFeature', false);
      }
      configStore.set(key, value);
      if (activityAgent?.isEnabled?.() && ACTIVITY_RUNTIME_KEYS.has(key)) {
        await activityAgent.syncProfile();
      }
      return createIpcSuccess(true);
    } catch (e) {
      return createIpcError('CONFIG_SET_FAILED', e.message);
    }
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_SET_MANY, async (_, values) => {
    const validation = validateConfigValuesPayload(values);
    if (!validation.ok) return createIpcError('INVALID_CONFIG_VALUES', validation.reason);
    try {
      const bindingChanged = activityAgent && Object.keys(values).some((key) => (
        ACTIVITY_BINDING_KEYS.has(key) && configStore.get(key) !== values[key]
      ));
      if (bindingChanged) {
        await activityAgent.revoke('disable');
        values = { ...values, enableActivityFeature: false };
      }
      if (activityAgent
        && (values.enableExperimentalFeatures === false || values.enableExperimentalActivityEntry === false)
        && configStore.get('enableActivityFeature') === true) {
        await activityAgent.revoke('disable');
        values = { ...values, enableActivityFeature: false };
      }
      if (values.enableExperimentalFeatures === false) {
        values = {
          ...values,
          enableExperimentalActivityEntry: false,
          enableExperimentalStreamEntry: false,
          enableExperimentalUiLabEntry: false,
          enableExperimentalCurveLoaders: false,
          enableActivityFeature: false,
          enableActivityPublishing: false,
          enableActivityBackground: false,
        };
      }
      if (values.enableExperimentalActivityEntry === false) {
        values = {
          ...values,
          enableActivityFeature: false,
          enableActivityPublishing: false,
          enableActivityBackground: false,
        };
      }
      configStore.setMany(values);
      if (activityAgent?.isEnabled?.()
        && Object.keys(values).some((key) => ACTIVITY_RUNTIME_KEYS.has(key))) {
        await activityAgent.syncProfile();
      }
      return createIpcSuccess(true);
    } catch (e) {
      return createIpcError('CONFIG_SET_MANY_FAILED', e.message);
    }
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET_ALL, () => createIpcSuccess(configStore.getAll()));
}

module.exports = {
  registerConfigIpc,
};

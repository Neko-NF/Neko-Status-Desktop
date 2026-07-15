const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SRS_API_PORT,
  DEFAULT_SRS_HOST,
  DEFAULT_SRS_RTMP_PORT,
  mergeDefaults,
} = require('../../src/main/config-store.helpers');

test('mergeDefaults fills missing nested stream config keys', () => {
  const merged = mergeDefaults({
    streamConfig: {
      srsHost: 'example.com',
      streamKey: 'abc123',
    },
  });

  assert.equal(merged.streamConfig.srsHost, 'example.com');
  assert.equal(merged.streamConfig.streamKey, 'abc123');
  assert.equal(merged.streamConfig.srsApp, 'live');
  assert.equal(merged.streamConfig.obsWsPort, 4455);
});

test('activity snapshots are private by default', () => {
  assert.equal(mergeDefaults({}).enableActivitySnapshots, false);
  assert.equal(mergeDefaults({ enableActivitySnapshots: true }).enableActivitySnapshots, true);
});

test('activity installation identity and per-account bindings have isolated defaults', () => {
  const first = mergeDefaults({});
  const second = mergeDefaults({});
  assert.equal(first.activityInstallationId, '');
  assert.equal(first.activityBoundUserId, null);
  assert.deepEqual(first.activityDeviceBindings, { version: 1, entries: {} });
  first.activityDeviceBindings.entries.test = { deviceId: 1 };
  assert.deepEqual(second.activityDeviceBindings, { version: 1, entries: {} });

  const restored = mergeDefaults({
    activityDeviceBindings: {
      version: 99,
      entries: { remembered: { deviceId: 31 } },
    },
  });
  assert.deepEqual(restored.activityDeviceBindings, {
    version: 1,
    entries: { remembered: { deviceId: 31 } },
  });
});

test('mergeDefaults repairs legacy API port copied from RTMP port', () => {
  const merged = mergeDefaults({
    streamConfig: {
      srsHost: DEFAULT_SRS_HOST,
      srsRtmpPort: DEFAULT_SRS_RTMP_PORT,
      srsApiPort: DEFAULT_SRS_RTMP_PORT,
    },
  });

  assert.equal(merged.streamConfig.srsApiPort, DEFAULT_SRS_API_PORT);
});

test('mergeDefaults disables legacy incognito mode on startup', () => {
  const merged = mergeDefaults({
    enableIncognito: true,
    incognitoScope: 'both',
    privacyRules: ['Code.exe'],
  });

  assert.equal(merged.enableIncognito, false);
  assert.equal(merged.incognitoScope, 'both');
  assert.deepEqual(merged.privacyRules, ['Code.exe']);
});

test('enabling experimental features does not implicitly expose the activity entry', () => {
  const merged = mergeDefaults({
    enableExperimentalFeatures: true,
  });

  assert.equal(merged.enableExperimentalActivityEntry, false);
  assert.equal(merged.enableExperimentalStreamEntry, true);
  assert.equal(merged.enableExperimentalUiLabEntry, false);
  assert.equal(merged.enableExperimentalCurveLoaders, false);
  assert.equal(merged.loadingCurveStyle, 'auto');
});

test('loading curve preference preserves future ids and repairs non-string legacy values', () => {
  assert.equal(mergeDefaults({ loadingCurveStyle: 'future-curve' }).loadingCurveStyle, 'future-curve');
  assert.equal(mergeDefaults({ loadingCurveStyle: null }).loadingCurveStyle, 'auto');
});

test('disabled global experiments close UI lab and curve loader flags but retain style', () => {
  const merged = mergeDefaults({
    enableExperimentalFeatures: false,
    enableExperimentalUiLabEntry: true,
    enableExperimentalCurveLoaders: true,
    loadingCurveStyle: 'rose-seven',
  });
  assert.equal(merged.enableExperimentalUiLabEntry, false);
  assert.equal(merged.enableExperimentalCurveLoaders, false);
  assert.equal(merged.loadingCurveStyle, 'rose-seven');
});

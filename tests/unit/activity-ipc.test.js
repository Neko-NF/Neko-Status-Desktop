const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ActivityAgentController,
  normalizeActivityAppKey,
} = require('../../src/main/activity-agent-controller');
const { registerActivityIpc } = require('../../src/main/ipc/activity.ipc');
const { IPC_CHANNELS } = require('../../src/shared/ipc-contracts');

function createActivityAgent({ serverApps = [], detectedApp, failPaths = [] } = {}) {
  const agent = new ActivityAgentController({
    app: {
      getAppPath: () => process.cwd(),
      getPath: () => 'C:\\Program Files\\NekoStatus\\NekoStatus.exe',
    },
    configStore: {
      get: () => undefined,
      getServerUrl: () => 'https://example.test',
    },
  });
  agent.activityRequest = async (pathname, options = {}) => {
    if (failPaths.includes(pathname)) {
      throw Object.assign(new Error(`Failed to load ${pathname}`), {
        code: 'ACTIVITY_API_ERROR',
        status: 500,
      });
    }
    if (pathname === '/api/activity/follows') return { follows: [] };
    if (pathname === '/api/activity/me/privacy') return { visibility: 'private' };
    if (pathname === '/api/activity/me/followers') return { followers: [] };
    if (pathname === '/api/activity/blocks') return { blocks: [] };
    if (pathname === '/api/activity/me/apps' && (!options.method || options.method === 'GET')) {
      return { apps: serverApps };
    }
    return { ok: true, request: { pathname, options } };
  };
  agent.getStatus = async () => agent.publishStatus({
    state: 'embedded',
    latestDetectedApp: detectedApp,
  });
  return agent;
}

function registerWithAgent(activityAgent) {
  const handlers = {};
  registerActivityIpc({
    ipcMain: {
      handle(channel, handler) {
        handlers[channel] = handler;
      },
    },
    configStore: {
      get: () => false,
      setMany: () => {},
    },
    activityAgent,
  });
  return handlers;
}

function createSettingsHarness({
  initial = {},
  privacyError = null,
  provisioned = true,
  syncResult = { ok: true },
} = {}) {
  const values = {
    enableActivityFeature: true,
    enableActivityPublishing: true,
    enableActivitySnapshots: false,
    enableActivityBackground: true,
    enableActivityAutoStart: true,
    enableExperimentalFeatures: true,
    ...initial,
  };
  const writes = [];
  const requests = [];
  const agent = {
    async getStatus() {
      return { state: 'embedded', provisioned };
    },
    async activityRequest(pathname, options) {
      requests.push([pathname, options]);
      if (privacyError) throw privacyError;
      return { shareSnapshots: options?.body?.shareSnapshots === true };
    },
    async syncProfile() {
      if (!syncResult.ok) return syncResult;
      return { ok: true, data: { state: 'embedded', snapshotEnabled: values.enableActivitySnapshots } };
    },
    async provision() {
      if (!syncResult.ok) return syncResult;
      return { ok: true, data: { state: 'embedded', snapshotEnabled: values.enableActivitySnapshots } };
    },
    async revoke() {},
  };
  const handlers = {};
  registerActivityIpc({
    ipcMain: {
      handle(channel, handler) {
        handlers[channel] = handler;
      },
    },
    configStore: {
      get(key) {
        return values[key];
      },
      setMany(next) {
        writes.push({ ...next });
        Object.assign(values, next);
      },
    },
    activityAgent: agent,
  });
  return { handlers, values, writes, requests };
}

test('activity app keys normalize to the win32 process contract', () => {
  assert.equal(normalizeActivityAppKey('Code.exe'), 'win32:code.exe');
  assert.equal(normalizeActivityAppKey('code.exe'), 'win32:code.exe');
  assert.equal(normalizeActivityAppKey('win32:Code.exe'), 'win32:code.exe');
  assert.equal(normalizeActivityAppKey('C:\\Apps\\Code'), 'win32:code.exe');
});

test('activity bootstrap includes a locally detected app as hidden', async () => {
  const agent = createActivityAgent({
    detectedApp: {
      appKey: 'win32:Code.exe',
      processName: 'Code.exe',
      displayName: 'Visual Studio Code',
      stableSinceMs: 1234,
      detectorKind: 'interactive',
    },
  });
  const handlers = registerWithAgent(agent);

  const result = await handlers['activity:manage'](null, { action: 'bootstrap', data: {} });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.apps.apps, [{
    appKey: 'win32:code.exe',
    processName: 'code.exe',
    displayName: 'Visual Studio Code',
    stableSinceMs: 1234,
    detectorKind: 'interactive',
    detected: true,
    source: 'local-detected',
    isHidden: true,
  }]);
});

test('activity bootstrap prefers the server app when a detected key already exists', async () => {
  const agent = createActivityAgent({
    serverApps: [{
      id: 9,
      appKey: 'win32:code.exe',
      displayName: 'Code',
      isHidden: false,
    }],
    detectedApp: {
      appKey: 'Code.exe',
      displayName: 'Local Code',
      stableSinceMs: 1234,
      detectorKind: 'interactive',
    },
  });
  const handlers = registerWithAgent(agent);

  const result = await handlers['activity:manage'](null, { action: 'bootstrap', data: {} });

  assert.equal(result.ok, true);
  assert.equal(result.data.apps.apps.length, 1);
  assert.deepEqual(result.data.apps.apps[0], {
    id: 9,
    appKey: 'win32:code.exe',
    displayName: 'Code',
    isHidden: false,
  });
});

test('activity bootstrap keeps detected apps when another section fails', async () => {
  const agent = createActivityAgent({
    failPaths: ['/api/activity/follows'],
    detectedApp: {
      appKey: 'Code.exe',
      processName: 'Code.exe',
      displayName: 'Visual Studio Code',
      stableSinceMs: 1234,
      detectorKind: 'interactive',
    },
  });
  const handlers = registerWithAgent(agent);

  const result = await handlers['activity:manage'](null, { action: 'bootstrap', data: {} });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.follows, { follows: [] });
  assert.deepEqual(result.data.partialFailures, [{
    section: 'follows',
    code: 'ACTIVITY_API_ERROR',
    message: 'Failed to load /api/activity/follows',
    status: 500,
  }]);
  assert.equal(result.data.apps.apps.length, 1);
  assert.equal(result.data.apps.apps[0].appKey, 'win32:code.exe');
  assert.equal(result.data.apps.apps[0].source, 'local-detected');
});

test('activity app mutations normalize keys before sending them to the server', async () => {
  const requests = [];
  const agent = createActivityAgent();
  agent.activityRequest = async (pathname, options = {}) => {
    requests.push([pathname, options]);
    return { ok: true };
  };
  const handlers = registerWithAgent(agent);

  await handlers['activity:manage'](null, {
    action: 'upsertApp',
    data: { appKey: 'Code.exe', displayName: '' },
  });
  await handlers['activity:manage'](null, {
    action: 'setAppHidden',
    data: { appKey: 'win32:Code.exe', displayName: 'Code', isHidden: true },
  });

  assert.deepEqual(requests, [
    ['/api/activity/me/apps', {
      method: 'POST',
      body: { appKey: 'win32:code.exe', displayName: 'code' },
    }],
    ['/api/activity/me/apps', {
      method: 'PATCH',
      body: { appKey: 'win32:code.exe', displayName: 'Code', isHidden: true },
    }],
  ]);
});

test('activity settings expose and persist the snapshot switch', async () => {
  const harness = createSettingsHarness();
  const state = await harness.handlers[IPC_CHANNELS.ACTIVITY_GET_STATE]();
  assert.equal(state.ok, true);
  assert.equal(state.data.settings.snapshots, false);

  const updated = await harness.handlers[IPC_CHANNELS.ACTIVITY_UPDATE_SETTINGS](null, { snapshots: true });
  assert.equal(updated.ok, true);
  assert.equal(harness.values.enableActivitySnapshots, true);
  assert.deepEqual(harness.requests, [[
    '/api/activity/me/privacy',
    { method: 'PUT', body: { shareSnapshots: true } },
  ]]);
  assert.equal(updated.data.agent.snapshotEnabled, true);
});

test('snapshot setting rolls back when privacy persistence fails', async () => {
  const error = Object.assign(new Error('privacy rejected'), {
    code: 'ACTIVITY_API_ERROR',
    status: 500,
  });
  const harness = createSettingsHarness({ privacyError: error });

  const updated = await harness.handlers[IPC_CHANNELS.ACTIVITY_UPDATE_SETTINGS](null, { snapshots: true });

  assert.equal(updated.ok, false);
  assert.equal(harness.values.enableActivitySnapshots, false);
  assert.equal(harness.writes.length, 2);
  assert.equal(harness.writes[1].enableActivitySnapshots, false);
});

test('agent sync failure compensates the server snapshot privacy setting', async () => {
  const harness = createSettingsHarness({
    syncResult: { ok: false, code: 'AGENT_SYNC_FAILED', message: 'sync failed' },
  });

  const updated = await harness.handlers[IPC_CHANNELS.ACTIVITY_UPDATE_SETTINGS](null, { snapshots: true });

  assert.equal(updated.ok, false);
  assert.equal(harness.values.enableActivitySnapshots, false);
  assert.deepEqual(harness.requests, [
    ['/api/activity/me/privacy', { method: 'PUT', body: { shareSnapshots: true } }],
    ['/api/activity/me/privacy', { method: 'PUT', body: { shareSnapshots: false } }],
  ]);
});

test('agent profile sync carries snapshot limits and screenshot privacy rules', async () => {
  const values = {
    enableExperimentalFeatures: true,
    enableActivityFeature: true,
    enableActivityPublishing: true,
    enableActivitySnapshots: true,
    enableActivityBackground: true,
    enableActivityAutoStart: true,
    enableNotification: true,
    doNotDisturb: false,
    enableIncognito: true,
    incognitoScope: 'both',
    blurAllScreenshots: false,
    privacyRules: ['Code.exe', 'win32:KeePass.exe'],
    authUser: { id: 7 },
    activityDeviceId: 11,
    activityDeviceName: '测试设备',
  };
  const agent = new ActivityAgentController({
    app: {
      getAppPath: () => process.cwd(),
      getPath: (name) => (name === 'userData' ? 'C:\\NekoData' : 'C:\\NekoStatus.exe'),
    },
    configStore: {
      get: (key) => values[key],
      getServerUrl: () => 'https://example.test',
    },
  });
  agent.ensureRunning = async () => ({ ok: true });
  let commandPayload = null;
  agent.command = async (command, payload) => {
    assert.equal(command, 'reload_config');
    commandPayload = payload;
    return { ok: true, data: {} };
  };

  const result = await agent.syncProfile();

  assert.equal(result.ok, true);
  assert.equal(commandPayload.snapshotEnabled, true);
  assert.equal(commandPayload.snapshotMaxBytes, 512 * 1024);
  assert.equal(commandPayload.snapshotMaxWidth, 640);
  assert.equal(commandPayload.snapshotMaxHeight, 360);
  assert.equal(commandPayload.snapshotCacheDir, 'C:\\NekoData\\activity-snapshots');
  assert.deepEqual(commandPayload.snapshotBlockedProcesses, ['code.exe', 'keepass.exe']);
});

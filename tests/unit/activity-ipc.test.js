const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

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
  const values = {
    authToken: 'jwt',
    authUser: { id: 7 },
  };
  registerActivityIpc({
    ipcMain: {
      handle(channel, handler) {
        handlers[channel] = handler;
      },
    },
    configStore: {
      get: (key) => values[key] ?? false,
      setMany: (next) => { Object.assign(values, next); },
      getServerUrl: () => 'https://example.test',
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
  const pendingPrivacy = [];
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
    markSnapshotPrivacyPending(value) { pendingPrivacy.push(value === true); },
    clearSnapshotPrivacyPending() { pendingPrivacy.length = 0; },
    async reconcileSnapshotPrivacy() { return { ok: true, skipped: true }; },
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
  return { handlers, values, writes, requests, pendingPrivacy, agent };
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

test('a settings transaction from an old auth session cannot overwrite the next account', async () => {
  const harness = createSettingsHarness({
    initial: { authToken: 'token-a', authUser: { id: 1 } },
  });
  harness.agent.identityRevision = 1;
  let releasePrivacy;
  const privacyGate = new Promise((resolve) => { releasePrivacy = resolve; });
  let syncCalls = 0;
  harness.agent.activityRequest = async () => {
    await privacyGate;
    return { shareSnapshots: true };
  };
  harness.agent.syncProfile = async () => {
    syncCalls += 1;
    return { ok: true };
  };

  const oldSave = harness.handlers[IPC_CHANNELS.ACTIVITY_UPDATE_SETTINGS](null, { snapshots: true });
  await new Promise((resolve) => setImmediate(resolve));
  harness.values.authToken = 'token-b';
  harness.values.authUser = { id: 2 };
  harness.values.enableActivityFeature = false;
  harness.values.enableActivitySnapshots = false;
  harness.agent.identityRevision = 2;
  releasePrivacy();

  const result = await oldSave;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ACTIVITY_SESSION_CHANGED');
  assert.equal(harness.values.enableActivityFeature, false);
  assert.equal(harness.values.enableActivitySnapshots, false);
  assert.equal(syncCalls, 0);
});

test('activity bootstrap never returns another account\'s stale section cache', async () => {
  const values = {
    authToken: 'token-a',
    authUser: { id: 1 },
  };
  let failRequests = false;
  const handlers = {};
  const activityAgent = {
    async activityRequest(pathname) {
      if (failRequests) throw Object.assign(new Error('offline'), { code: 'API_TRANSIENT' });
      if (pathname === '/api/activity/follows') return { follows: [{ id: 'a-follow' }] };
      if (pathname === '/api/activity/me/privacy') return { visibility: 'friends' };
      if (pathname === '/api/activity/me/apps') return { apps: [{ appKey: 'win32:a.exe' }] };
      if (pathname === '/api/activity/me/followers') return { followers: [{ id: 'a-follower' }] };
      return { blocks: [{ id: 'a-block' }] };
    },
    async getStatus() {},
    mergeDetectedApps(apps) { return apps || []; },
  };
  registerActivityIpc({
    ipcMain: { handle(channel, handler) { handlers[channel] = handler; } },
    configStore: {
      get(key) { return values[key]; },
      getServerUrl() { return 'https://example.test'; },
      setMany(next) { Object.assign(values, next); },
    },
    activityAgent,
  });

  const accountA = await handlers[IPC_CHANNELS.ACTIVITY_MANAGE](null, { action: 'bootstrap', data: {} });
  assert.equal(accountA.ok, true);
  assert.equal(accountA.data.follows.follows[0].id, 'a-follow');

  values.authToken = 'token-b';
  values.authUser = { id: 2 };
  failRequests = true;
  const accountB = await handlers[IPC_CHANNELS.ACTIVITY_MANAGE](null, { action: 'bootstrap', data: {} });

  assert.equal(accountB.ok, true);
  assert.deepEqual(accountB.data.follows, { follows: [] });
  assert.deepEqual(accountB.data.apps.apps, []);
  assert.equal(accountB.data.sections.follows.status, 'error');
  assert.equal(JSON.stringify(accountB.data).includes('a-follow'), false);
  assert.equal(JSON.stringify(accountB.data).includes('win32:a.exe'), false);
});

test('a bootstrap response arriving after logout cannot repopulate the cleared session cache', async () => {
  const values = { authToken: 'token-a', authUser: { id: 1 } };
  const handlers = {};
  let releaseRequests;
  const requestGate = new Promise((resolve) => { releaseRequests = resolve; });
  let failRequests = false;
  let resetCache = () => {};
  const activityAgent = {
    setActivitySessionCacheResetHandler(handler) { resetCache = handler; },
    async activityRequest(pathname) {
      await requestGate;
      if (failRequests) throw Object.assign(new Error('offline'), { code: 'API_TRANSIENT' });
      if (pathname === '/api/activity/follows') return { follows: [{ id: 'old-follow' }] };
      if (pathname === '/api/activity/me/privacy') return { visibility: 'friends' };
      if (pathname === '/api/activity/me/apps') return { apps: [] };
      if (pathname === '/api/activity/me/followers') return { followers: [] };
      return { blocks: [] };
    },
    async getStatus() {},
    mergeDetectedApps(apps) { return apps || []; },
  };
  registerActivityIpc({
    ipcMain: { handle(channel, handler) { handlers[channel] = handler; } },
    configStore: {
      get(key) { return values[key]; },
      getServerUrl() { return 'https://example.test'; },
      setMany(next) { Object.assign(values, next); },
    },
    activityAgent,
  });

  const lateBootstrap = handlers[IPC_CHANNELS.ACTIVITY_MANAGE](null, { action: 'bootstrap', data: {} });
  await Promise.resolve();
  values.authToken = '';
  values.authUser = null;
  resetCache();
  releaseRequests();
  const lateResult = await lateBootstrap;
  assert.equal(lateResult.ok, false);
  assert.equal(lateResult.error.code, 'ACTIVITY_SESSION_CHANGED');

  values.authToken = 'token-a-new';
  values.authUser = { id: 1 };
  failRequests = true;
  const reloaded = await handlers[IPC_CHANNELS.ACTIVITY_MANAGE](null, { action: 'bootstrap', data: {} });
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.data.sections.follows.status, 'error');
  assert.deepEqual(reloaded.data.follows, { follows: [] });
});

test('revoke falls back to channel-scoped offline identity cleanup when the pipe command fails', async () => {
  const calls = [];
  const agent = new ActivityAgentController({
    app: {
      // Renamed Electron development binaries may look packaged to Electron.
      isPackaged: true,
      getAppPath: () => process.cwd(),
      getPath: () => process.cwd(),
    },
    isDevRuntime: true,
    configStore: {
      get: () => undefined,
      setMany: () => {},
      getServerUrl: () => 'https://example.test',
    },
    logger: { warn: () => {} },
    spawnSyncImpl(executable, args, options) {
      calls.push({ executable, args, options });
      return { status: 0 };
    },
  });
  agent.getAgentPath = () => 'C:\\NekoPresenceAgent.exe';
  agent.activityRequest = async () => { throw new Error('offline'); };
  agent.command = async () => { throw new Error('pipe unavailable'); };

  assert.equal(agent.getPipePath(), '\\\\.\\pipe\\NekoStatusPresenceAgent-v1-dev');

  await agent.revoke('account_change');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'C:\\NekoPresenceAgent.exe');
  assert.deepEqual(calls[0].args, ['--clear-activity-identity', '--channel=dev']);
  assert.equal(calls[0].options.windowsHide, true);
});

test('a full settings payload does not rewrite snapshot privacy when the value is unchanged', async () => {
  const privacyError = Object.assign(new Error('privacy endpoint must not be called'), {
    code: 'ACTIVITY_API_ERROR',
  });
  const harness = createSettingsHarness({ privacyError });

  const updated = await harness.handlers[IPC_CHANNELS.ACTIVITY_UPDATE_SETTINGS](null, {
    enabled: true,
    publishing: false,
    snapshots: false,
    background: true,
    autoStart: true,
  });

  assert.equal(updated.ok, true);
  assert.deepEqual(harness.requests, []);
  assert.equal(harness.values.enableActivityPublishing, false);
  assert.equal(updated.data.effectiveSettings.snapshots, false);
});

test('snapshot setting remains canonical when the remote Activity API is unavailable', async () => {
  const error = Object.assign(new Error('Activity API is not deployed'), {
    code: 'API_NOT_DEPLOYED',
    status: 404,
  });
  const harness = createSettingsHarness({ privacyError: error });

  const updated = await harness.handlers[IPC_CHANNELS.ACTIVITY_UPDATE_SETTINGS](null, {
    enabled: true,
    publishing: true,
    snapshots: true,
    background: true,
    autoStart: true,
  });

  assert.equal(updated.ok, true);
  assert.equal(harness.values.enableActivitySnapshots, true);
  assert.equal(updated.data.settings.snapshots, true);
  assert.equal(updated.data.effectiveSettings.snapshots, true);
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.pendingPrivacy, [true]);
});

test('effective snapshots require both the feature and publishing to be enabled', () => {
  const values = {
    enableExperimentalFeatures: true,
    enableActivityFeature: true,
    enableActivityPublishing: false,
    enableActivitySnapshots: true,
    enableActivityBackground: false,
    enableActivityAutoStart: true,
    authToken: 'jwt',
    authUser: { id: 7 },
  };
  const agent = new ActivityAgentController({
    app: { getAppPath: () => process.cwd(), getPath: () => 'C:\\NekoStatus.exe' },
    configStore: {
      get: (key) => values[key],
      getServerUrl: () => 'https://example.test',
    },
  });

  assert.equal(agent.getSnapshot().settings.snapshots, true);
  assert.equal(agent.getSnapshot().effectiveSettings.snapshots, false);
  assert.equal(agent.getSnapshot().effectiveSettings.autoStart, false);
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
  assert.equal(commandPayload.snapshotCacheDir, path.join('C:\\NekoData', 'activity-snapshots'));
  assert.deepEqual(commandPayload.snapshotBlockedProcesses, ['code.exe', 'keepass.exe']);
});

function createEnabledController() {
  const values = {
    enableExperimentalFeatures: true,
    enableActivityFeature: true,
  };
  return new ActivityAgentController({
    app: {
      getAppPath: () => process.cwd(),
      getPath: () => 'C:\\Program Files\\NekoStatus\\NekoStatus.exe',
    },
    configStore: {
      get: (key) => values[key],
      getServerUrl: () => 'https://example.test',
    },
    logger: { warn() {} },
  });
}

test('agent pipe disconnect automatically recovers the published status', async () => {
  const agent = createEnabledController();
  agent.reconnectDelayMs = 0;
  agent.ensureRunning = async () => ({ ok: true, alreadyRunning: true });
  agent.getStatus = async () => agent.publishStatus({
    state: 'embedded',
    connection: 'online',
    available: true,
  });
  const disconnectedSocket = { destroyed: false };
  agent.socket = disconnectedSocket;

  agent.handleDisconnect(undefined, disconnectedSocket);

  assert.equal(agent.lastStatus.state, 'reconnecting');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(agent.lastStatus.state, 'embedded');
  assert.equal(agent.lastStatus.connection, 'online');
});

test('agent pipe recovery failure replaces reconnecting with an actionable error', async () => {
  const agent = createEnabledController();
  agent.reconnectDelayMs = 0;
  agent.getAgentPath = () => null;
  agent.ensureRunning = async () => ({
    ok: false,
    code: 'AGENT_MISSING',
    message: 'NekoPresenceAgent.exe 不存在',
  });
  const disconnectedSocket = { destroyed: false };
  agent.socket = disconnectedSocket;

  agent.handleDisconnect(undefined, disconnectedSocket);

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(agent.lastStatus.state, 'error');
  assert.equal(agent.lastStatus.connection, 'disconnected');
  assert.equal(agent.lastStatus.code, 'AGENT_MISSING');
  assert.equal(agent.lastStatus.available, false);
});

test('a stale pipe close cannot discard the current agent connection', () => {
  const agent = createEnabledController();
  const currentSocket = { destroyed: false };
  const staleSocket = { destroyed: true };
  agent.socket = currentSocket;

  agent.handleDisconnect(undefined, staleSocket);

  assert.equal(agent.socket, currentSocket);
  assert.equal(agent.lastStatus.state, 'disabled');
});

test('concurrent agent recovery checks share a single startup attempt', async () => {
  const agent = createEnabledController();
  let starts = 0;
  agent.startAgent = async () => {
    starts += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, started: true };
  };

  const results = await Promise.all([agent.ensureRunning(), agent.ensureRunning()]);

  assert.equal(starts, 1);
  assert.deepEqual(results, [
    { ok: true, started: true },
    { ok: true, started: true },
  ]);
});

test('a late pipe automatically reconnects to the existing child after initial startup timeout', async () => {
  const agent = createEnabledController();
  const existingChild = { exitCode: null, killed: false };
  agent.child = existingChild;
  agent.reconnectDelayMs = 0;
  agent.existingChildProbeDelaysMs = [0];
  let connects = 0;
  let statusChecks = 0;
  agent.connect = async () => {
    connects += 1;
    if (connects < 3) throw new Error('pipe not ready yet');
    agent.socket = { destroyed: false };
    return agent.socket;
  };
  agent.getStatus = async () => {
    statusChecks += 1;
    return agent.publishStatus({ state: 'embedded', connection: 'online', provisioned: true });
  };

  const initial = await agent.ensureRunning();
  assert.equal(initial.ok, false);
  assert.equal(initial.code, 'AGENT_START_TIMEOUT');

  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(agent.child, existingChild);
  assert.equal(connects, 3);
  assert.equal(statusChecks, 1);
  assert.equal(agent.lastStatus.state, 'embedded');
  assert.equal(agent.lastStatus.connection, 'online');
  agent.shuttingDown = true;
  agent.cancelReconnect();
});

test('a recovery already inside connect cannot reopen the Agent after app exit', async () => {
  const agent = createEnabledController();
  let releaseConnect;
  let connectEntered;
  const entered = new Promise((resolve) => { connectEntered = resolve; });
  const gate = new Promise((resolve) => { releaseConnect = resolve; });
  let statusChecks = 0;
  let closed = 0;
  const lateSocket = {
    destroyed: false,
    end() { closed += 1; },
    destroy() { this.destroyed = true; closed += 1; },
  };
  agent.connect = async () => {
    connectEntered();
    await gate;
    agent.socket = lateSocket;
    return lateSocket;
  };
  agent.getStatus = async () => { statusChecks += 1; return agent.getSnapshot(); };

  const recovery = agent.recoverConnection(agent.reconnectGeneration);
  await entered;
  await agent.releaseForAppExit({ exitAll: true });
  releaseConnect();
  await recovery;

  assert.equal(agent.shuttingDown, true);
  assert.equal(agent.socket, null);
  assert.equal(lateSocket.destroyed, true);
  assert.equal(closed, 2);
  assert.equal(statusChecks, 0);
  assert.equal(agent.child, null);
  assert.equal(agent.reconnectTimer, null);
});

function jsonResponse(status, value, contentType = 'application/json; charset=utf-8') {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? contentType : null },
    async json() { return value; },
  };
}

function createRequestController() {
  const values = {
    enableExperimentalFeatures: true,
    enableActivityFeature: true,
    enableActivityPublishing: true,
    enableActivityBackground: true,
    enableActivityAutoStart: true,
    authToken: 'jwt',
    authUser: { id: 7 },
  };
  return new ActivityAgentController({
    app: {
      isPackaged: true,
      getAppPath: () => process.cwd(),
      getPath: () => 'C:\\NekoStatus.exe',
    },
    configStore: {
      get: (key) => values[key],
      set: (key, value) => { values[key] = value; },
      setMany: (next) => { Object.assign(values, next); },
      getServerUrl: () => 'https://example.test',
    },
    logger: { warn() {} },
  });
}

function createMutableController(initial = {}, { spawnSyncImpl, isDevRuntime } = {}) {
  const values = {
    enableExperimentalFeatures: true,
    enableActivityFeature: true,
    enableActivityPublishing: true,
    enableActivitySnapshots: false,
    enableActivityBackground: true,
    enableActivityAutoStart: true,
    enableNotification: true,
    doNotDisturb: false,
    authToken: 'jwt',
    authUser: { id: 7 },
    ...initial,
  };
  let serverUrl = 'https://example.test';
  const configStore = {
    get(key) { return values[key]; },
    set(key, value) { values[key] = value; },
    setMany(next) { Object.assign(values, next); },
    getServerUrl() { return serverUrl; },
  };
  const agent = new ActivityAgentController({
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getPath: () => 'C:\\NekoStatus-dev.exe',
    },
    configStore,
    logger: { warn() {} },
    ...(spawnSyncImpl ? { spawnSyncImpl } : {}),
    ...(typeof isDevRuntime === 'boolean' ? { isDevRuntime } : {}),
  });
  return {
    agent,
    values,
    configStore,
    setServerUrl(next) { serverUrl = next; },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test('activity request rejects redirects, HTML success pages and empty JSON objects', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const agent = createRequestController();

  global.fetch = async () => jsonResponse(307, {}, 'text/html');
  await assert.rejects(
    agent.activityRequest('/api/activity/follows'),
    (error) => error.code === 'API_REDIRECTED' && error.status === 307,
  );

  global.fetch = async () => jsonResponse(200, {}, 'text/html; charset=utf-8');
  await assert.rejects(
    agent.activityRequest('/api/activity/follows'),
    (error) => error.code === 'API_INCOMPATIBLE',
  );

  global.fetch = async () => jsonResponse(200, {});
  await assert.rejects(
    agent.activityRequest('/api/activity/follows'),
    (error) => error.code === 'API_INCOMPATIBLE',
  );
});

test('a management endpoint failure does not override healthy Native connection state', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const agent = createRequestController();
  agent.socket = { destroyed: false };
  agent.publishStatus({
    state: 'embedded',
    provisioned: true,
    health: {
      provision: { state: 'ready', deviceConfigured: true, boundToCurrentUser: true },
      receiver: { state: 'connected', transport: 'sse' },
      publisher: { state: 'online' },
    },
  });
  let response = jsonResponse(404, { success: false, error: { code: 'NOT_FOUND' } });
  global.fetch = async () => response;

  await assert.rejects(agent.activityRequest('/api/activity/blocks'), { code: 'API_NOT_DEPLOYED' });
  assert.equal(agent.getSnapshot().health.receiver.state, 'connected');
  assert.equal(agent.getSnapshot().health.publisher.state, 'online');
  assert.equal(agent.getSnapshot().health.overall, 'healthy');

  response = jsonResponse(200, { success: true, data: { blocks: [] } });
  const result = await agent.activityRequest('/api/activity/blocks');
  assert.deepEqual(result, { blocks: [] });
  assert.equal(agent.getSnapshot().health.overall, 'healthy');
});

test('an enroll endpoint failure still marks the core Activity service unavailable', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const agent = createRequestController();
  agent.socket = { destroyed: false };
  agent.publishStatus({
    state: 'embedded',
    provisioned: false,
    health: {
      provision: { state: 'needs_enroll', deviceConfigured: false, boundToCurrentUser: false },
      receiver: { state: 'connecting', transport: null },
      publisher: { state: 'idle' },
    },
  });
  global.fetch = async () => jsonResponse(404, {
    success: false,
    error: { code: 'NOT_FOUND', message: 'missing enroll route' },
  });

  await assert.rejects(agent.activityRequest('/api/activity/agent/enroll', {
    method: 'POST',
    body: { capabilities: ['events'] },
  }), { code: 'API_NOT_DEPLOYED' });

  const snapshot = agent.getSnapshot();
  assert.equal(snapshot.health.receiver.state, 'unsupported');
  assert.equal(snapshot.health.overall, 'unavailable');

  global.fetch = async () => { throw new Error('TLS connection failed'); };
  await assert.rejects(agent.activityRequest('/api/activity/agent/enroll', {
    method: 'POST',
    body: { capabilities: ['events'] },
  }), { code: 'API_TRANSIENT' });
  const transientSnapshot = agent.getSnapshot();
  assert.equal(transientSnapshot.health.provision.state, 'needs_enroll');
  assert.equal(transientSnapshot.health.receiver.lastError.code, 'API_TRANSIENT');
  assert.equal(transientSnapshot.health.overall, 'unavailable');
});

test('a missing enrolled device remains distinguishable from an undeployed route', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const agent = createRequestController();
  global.fetch = async () => jsonResponse(404, {
    success: false,
    error: { code: 'DEVICE_NOT_FOUND', message: 'device was removed' },
  });

  await assert.rejects(agent.activityRequest('/api/activity/agent/enroll', {
    method: 'POST',
    body: { deviceId: 88, capabilities: ['events'] },
  }), { code: 'DEVICE_NOT_FOUND' });
});

test('a rejected user JWT maps to needs_login and repair never rotates the Agent token', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const agent = createRequestController();
  agent.socket = { destroyed: false };
  agent.publishStatus({
    state: 'embedded',
    provisioned: true,
    health: {
      provision: { state: 'ready', deviceConfigured: true, boundToCurrentUser: true },
      receiver: { state: 'connected', transport: 'sse' },
      publisher: { state: 'online' },
    },
  });
  global.fetch = async () => jsonResponse(401, {
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'expired JWT' },
  });

  await assert.rejects(agent.activityRequest('/api/activity/agent/enroll', {
    method: 'POST',
    body: { capabilities: ['events'] },
  }), { code: 'CREDENTIAL_INVALID' });
  const snapshot = agent.getSnapshot();
  assert.equal(snapshot.health.provision.state, 'needs_login');
  assert.equal(snapshot.health.overall, 'needs_login');

  let enrolls = 0;
  agent.provision = async () => { enrolls += 1; return { ok: true }; };
  const repaired = await agent.repair();
  assert.equal(repaired.ok, false);
  assert.equal(repaired.code, 'UNAUTHORIZED');
  assert.equal(enrolls, 0);
});

test('v2 snapshot keeps receiver and publisher health independent', () => {
  const agent = createRequestController();
  agent.socket = { destroyed: false };
  let changed = null;
  agent.setStatusChangedCallback((snapshot) => { changed = snapshot; });

  const snapshot = agent.publishStatus({
    state: 'embedded',
    connection: 'reconnecting',
    provisioned: true,
    health: {
      provision: { state: 'ready', deviceConfigured: true, boundToCurrentUser: true },
      receiver: { state: 'retrying', transport: null, consecutiveFailures: 3 },
      publisher: { state: 'online', lastSuccessAtMs: 1234 },
    },
  });

  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.health.overall, 'recovering');
  assert.equal(snapshot.health.receiver.state, 'retrying');
  assert.equal(snapshot.health.publisher.state, 'online');
  assert.equal(snapshot.agent.connection, 'reconnecting');
  assert.equal(changed.revision, snapshot.revision);
});

test('a locally detected app is not exposed as server-confirmed sharing', () => {
  const agent = createRequestController();
  agent.socket = { destroyed: false };

  const detectedApp = { appKey: 'win32:chatgpt.exe', displayName: 'chatgpt' };
  const snapshot = agent.publishStatus({
    state: 'embedded',
    provisioned: true,
    latestDetectedApp: detectedApp,
    health: {
      provision: { state: 'ready', deviceConfigured: true, boundToCurrentUser: true },
      receiver: { state: 'connected', transport: 'sse' },
      publisher: { state: 'idle', currentApp: null },
    },
  });

  assert.equal(snapshot.health.publisher.currentApp, null);
  assert.deepEqual(snapshot.health.publisher.detectedApp, detectedApp);
});

test('a connected pipe with a Native lifecycle error always needs action', () => {
  const agent = createRequestController();
  agent.socket = { destroyed: false };

  const snapshot = agent.publishStatus({
    state: 'error',
    code: 'AGENT_PROTOCOL_MISMATCH',
    provisioned: true,
    health: {
      lifecycle: 'error',
      provision: { state: 'ready', deviceConfigured: true, boundToCurrentUser: true },
      receiver: { state: 'connected', transport: 'sse' },
      publisher: { state: 'online' },
    },
  });

  assert.equal(snapshot.health.localIpc.state, 'connected');
  assert.equal(snapshot.health.lifecycle, 'error');
  assert.equal(snapshot.health.overall, 'needs_action');
});

test('status polling is read-only while the pipe is disconnected', async () => {
  const agent = createRequestController();
  let starts = 0;
  let events = 0;
  agent.ensureRunning = async () => { starts += 1; return { ok: true }; };
  agent.setStatusChangedCallback(() => { events += 1; });

  const first = await agent.getStatus();
  const second = await agent.getStatus();

  assert.equal(starts, 0);
  assert.equal(events, 0);
  assert.equal(first.schemaVersion, 2);
  assert.equal(second.health.localIpc.state, 'disconnected');
});

test('agent commands are serialized even when callers invoke them concurrently', async () => {
  const agent = createRequestController();
  let active = 0;
  let maximum = 0;
  agent.sendCommand = async (command) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { ok: true, data: { command } };
  };

  const result = await Promise.all([
    agent.command('first'),
    agent.command('second'),
    agent.command('third'),
  ]);

  assert.equal(maximum, 1);
  assert.deepEqual(result.map((entry) => entry.data.command), ['first', 'second', 'third']);
});

test('repair re-enrolls an explicitly invalid Agent credential instead of syncing the bad token', async () => {
  const agent = createRequestController();
  agent.socket = { destroyed: false };
  agent.publishStatus({
    state: 'embedded',
    provisioned: true,
    health: {
      provision: { state: 'credential_error', deviceConfigured: true, boundToCurrentUser: true },
      receiver: {
        state: 'credential_error',
        transport: null,
        lastError: { code: 'CREDENTIAL_INVALID', message: 'expired', transient: false, atMs: 1 },
      },
      publisher: { state: 'credential_error' },
    },
  });
  let enrolls = 0;
  let syncs = 0;
  agent.provision = async () => { enrolls += 1; return { ok: true, data: { schemaVersion: 2 } }; };
  agent.syncProfile = async () => { syncs += 1; return { ok: true }; };

  const result = await agent.repair();

  assert.equal(result.ok, true);
  assert.equal(enrolls, 1);
  assert.equal(syncs, 0);
});

test('repair retries enroll before retry_now when the server was unavailable during initial provisioning', async () => {
  const agent = createRequestController();
  agent.socket = { destroyed: false };
  agent.publishStatus({
    state: 'embedded',
    provisioned: false,
    health: {
      provision: { state: 'needs_enroll', deviceConfigured: false, boundToCurrentUser: false },
      receiver: {
        state: 'unsupported',
        transport: null,
        lastError: { code: 'API_NOT_DEPLOYED', message: 'missing route', transient: false, atMs: 1 },
      },
      publisher: { state: 'disabled' },
    },
  });
  let enrolls = 0;
  let retries = 0;
  agent.provision = async () => { enrolls += 1; return { ok: true, data: { schemaVersion: 2 } }; };
  agent.command = async (command) => {
    if (command === 'retry_now') retries += 1;
    return { ok: true, data: {} };
  };

  const result = await agent.repair();

  assert.equal(result.ok, true);
  assert.equal(enrolls, 1);
  assert.equal(retries, 0);
});

test('repair does not rotate credentials while the receiver is healthy or polling', async () => {
  for (const receiverState of ['connected', 'polling']) {
    const agent = createRequestController();
    agent.socket = { destroyed: false };
    agent.publishStatus({
      state: 'embedded',
      provisioned: true,
      health: {
        provision: { state: 'ready', deviceConfigured: true, boundToCurrentUser: true },
        receiver: { state: receiverState, transport: receiverState === 'polling' ? 'polling' : 'sse' },
        publisher: { state: 'online' },
      },
    });
    let enrolls = 0;
    let retries = 0;
    agent.provision = async () => { enrolls += 1; return { ok: true }; };
    agent.command = async (command) => {
      if (command === 'retry_now') retries += 1;
      return { ok: true, data: {} };
    };

    const result = await agent.repair();

    assert.equal(result.ok, true);
    assert.equal(result.noAction, receiverState === 'connected' ? true : undefined);
    assert.equal(enrolls, 0);
    assert.equal(retries, receiverState === 'polling' ? 1 : 0);
  }
});

test('bootstrap marks cached sections stale without replacing them with empty defaults', async () => {
  let followsFail = false;
  const agent = createActivityAgent();
  agent.activityRequest = async (pathname) => {
    if (pathname === '/api/activity/follows') {
      if (followsFail) throw Object.assign(new Error('offline'), { code: 'API_TRANSIENT', transient: true });
      return { follows: [{ id: 8 }] };
    }
    if (pathname === '/api/activity/me/privacy') return { visibility: 'private' };
    if (pathname === '/api/activity/me/apps') return { apps: [] };
    if (pathname === '/api/activity/me/followers') return { followers: [] };
    if (pathname === '/api/activity/blocks') return { blocks: [] };
    throw new Error('unexpected path');
  };
  const handlers = registerWithAgent(agent);

  const fresh = await handlers['activity:manage'](null, { action: 'bootstrap', data: {} });
  followsFail = true;
  const stale = await handlers['activity:manage'](null, { action: 'bootstrap', data: {} });

  assert.equal(fresh.data.sections.follows.status, 'fresh');
  assert.equal(stale.data.sections.follows.status, 'stale');
  assert.deepEqual(stale.data.follows, { follows: [{ id: 8 }] });
  assert.equal(stale.data.sections.follows.error.code, 'API_TRANSIENT');
});

test('revoke clears the local Agent identity before best-effort remote deletion', async () => {
  const harness = createMutableController({
    authToken: 'old-jwt',
    authUser: { id: 9 },
    activityDeviceId: 77,
    activityDeviceName: 'old device',
    activityOnboardingSeen: false,
  });
  const events = [];
  let remoteOptions;
  harness.agent.command = async (command, data) => {
    events.push(['local', command, data?.reason]);
    harness.values.authToken = '';
    harness.setServerUrl('https://new.example.test');
    return { ok: true, data: {} };
  };
  harness.agent.activityRequest = async (pathname, options) => {
    events.push(['remote', pathname]);
    remoteOptions = options;
    return {};
  };

  await harness.agent.revoke('account_change');

  assert.deepEqual(events.map(([kind]) => kind), ['local', 'remote']);
  assert.equal(remoteOptions.authContext.authToken, 'old-jwt');
  assert.equal(remoteOptions.authContext.serverUrl, 'https://example.test');
  assert.deepEqual(remoteOptions.body, {
    installationId: harness.values.activityInstallationId,
    runtimeChannel: 'dev',
  });
  assert.equal(harness.values.activityDeviceId, null);
  assert.equal(harness.values.activityOnboardingSeen, true);
  assert.equal(harness.agent.getSnapshot().health.provision.everConfigured, true);
});

test('revoke without a current device uses installation and channel scope instead of an empty body', async () => {
  const harness = createMutableController({
    activityDeviceId: null,
    activityDeviceName: '',
    activityDeviceBindings: { version: 1, entries: {} },
  });
  harness.agent.command = async () => ({ ok: true, data: {} });
  let remoteBody;
  harness.agent.activityRequest = async (_pathname, options) => {
    remoteBody = options.body;
    return { revoked: true };
  };

  await harness.agent.revoke('logout');

  assert.deepEqual(remoteBody, {
    installationId: harness.values.activityInstallationId,
    runtimeChannel: 'dev',
  });
});

test('revoke is single-flight and allowAfterShutdown cannot revive the Agent during cleanup', async () => {
  const harness = createMutableController();
  const shutdown = createDeferred();
  let shutdownCommands = 0;
  harness.agent.command = async (command) => {
    assert.equal(command, 'shutdown');
    shutdownCommands += 1;
    return shutdown.promise;
  };
  harness.agent.activityRequest = async () => ({ revoked: true });

  const first = harness.agent.revoke('logout');
  const second = harness.agent.revoke('disable');
  assert.equal(first, second);
  assert.equal(shutdownCommands, 1);

  const start = await harness.agent.ensureRunning({ allowAfterShutdown: true });
  const provision = await harness.agent.provision();
  assert.equal(start.code, 'ACTIVITY_REVOKING');
  assert.equal(provision.code, 'ACTIVITY_REVOKING');
  assert.equal(harness.agent.shuttingDown, true);

  shutdown.resolve({ ok: true, data: {} });
  await first;
  assert.equal(harness.agent.revoking, false);
});

test('revoke waits for a deferred enroll then performs the final installation-scoped deletion', async () => {
  const harness = createMutableController();
  const enroll = createDeferred();
  const requests = [];
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.command = async () => ({ ok: true, data: {} });
  harness.agent.activityRequest = async (_pathname, options) => {
    requests.push({ method: options.method, body: { ...options.body } });
    if (options.method === 'POST') return enroll.promise;
    return { revoked: true };
  };

  const pendingProvision = harness.agent.provision();
  while (!requests.some((request) => request.method === 'POST')) await Promise.resolve();
  let revokeSettled = false;
  const pendingRevoke = harness.agent.revoke('logout').then((result) => {
    revokeSettled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(revokeSettled, false);
  assert.equal(requests.filter((request) => request.method === 'DELETE').length, 0);

  enroll.resolve({ agentToken: 'late-token', device: { id: 401, name: 'late device' } });
  assert.equal((await pendingProvision).code, 'PROVISION_SUPERSEDED');
  await pendingRevoke;

  assert.deepEqual(requests.map((request) => request.method), ['POST', 'DELETE']);
  assert.deepEqual(requests[1].body, {
    installationId: harness.values.activityInstallationId,
    runtimeChannel: 'dev',
  });
  assert.equal(harness.values.activityDeviceId, null);
});

test('revoke covers a DEVICE_NOT_FOUND replacement enroll that was already in flight', async () => {
  const installationId = '5f534f8a-3784-42a0-93f7-6d3068d6cf24';
  const harness = createMutableController({
    activityInstallationId: installationId,
    activityBoundUserId: 7,
    activityDeviceId: 410,
    activityDeviceName: 'stale device',
    activityDeviceBindings: {
      version: 2,
      entries: {
        'https://example.test::7::dev': {
          serverUrl: 'https://example.test',
          userId: '7',
          runtimeChannel: 'dev',
          installationId,
          deviceId: 410,
          deviceName: 'stale device',
        },
      },
    },
  });
  const replacement = createDeferred();
  const requests = [];
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.command = async () => ({ ok: true, data: {} });
  harness.agent.activityRequest = async (_pathname, options) => {
    requests.push({ method: options.method, body: { ...options.body } });
    if (options.method === 'DELETE') return { revoked: true };
    if (requests.filter((request) => request.method === 'POST').length === 1) {
      throw Object.assign(new Error('gone'), { code: 'DEVICE_NOT_FOUND', status: 404 });
    }
    return replacement.promise;
  };

  const pendingProvision = harness.agent.provision();
  while (requests.filter((request) => request.method === 'POST').length < 2) await Promise.resolve();
  const pendingRevoke = harness.agent.revoke('account_change');
  replacement.resolve({ agentToken: 'replacement-token', device: { id: 411, name: 'replacement' } });

  assert.equal((await pendingProvision).code, 'PROVISION_SUPERSEDED');
  await pendingRevoke;
  assert.equal(requests.filter((request) => request.method === 'POST').length, 2);
  assert.equal(Object.hasOwn(requests[1].body, 'deviceId'), false);
  assert.deepEqual(requests.at(-1).body, {
    installationId,
    runtimeChannel: 'dev',
  });
});

test('stable revoke falls back to a legacy deviceId only when exact installation revoke fails', async () => {
  const harness = createMutableController(
    { activityDeviceId: 420, activityBoundUserId: 7 },
    { isDevRuntime: false },
  );
  const bodies = [];
  harness.agent.command = async () => ({ ok: true, data: {} });
  harness.agent.activityRequest = async (_pathname, options) => {
    bodies.push({ ...options.body });
    if (bodies.length === 1) throw Object.assign(new Error('legacy server'), { code: 'API_INCOMPATIBLE' });
    return { revoked: true };
  };

  await harness.agent.revoke('logout');

  assert.deepEqual(bodies[0], {
    installationId: harness.values.activityInstallationId,
    runtimeChannel: 'stable',
  });
  assert.deepEqual(bodies[1], { deviceId: 420 });
});

test('development revoke never falls back to an unscoped legacy deviceId', async () => {
  const harness = createMutableController({ activityDeviceId: 31, activityBoundUserId: 7 });
  const bodies = [];
  harness.agent.command = async () => ({ ok: true, data: {} });
  harness.agent.activityRequest = async (_pathname, options) => {
    bodies.push({ ...options.body });
    throw Object.assign(new Error('legacy server'), { code: 'API_INCOMPATIBLE' });
  };

  await harness.agent.revoke('logout');

  assert.deepEqual(bodies, [{
    installationId: harness.values.activityInstallationId,
    runtimeChannel: 'dev',
  }]);
});

test('pending snapshot privacy survives offline failure and replays after profile sync', async () => {
  const harness = createMutableController();
  harness.agent.markSnapshotPrivacyPending(false);
  let online = false;
  const privacyRequests = [];
  harness.agent.activityRequest = async (pathname, options) => {
    privacyRequests.push([pathname, options]);
    if (!online) throw Object.assign(new Error('offline'), { code: 'API_TRANSIENT' });
    return { shareSnapshots: options.body.shareSnapshots };
  };

  const offline = await harness.agent.reconcileSnapshotPrivacy();
  assert.equal(offline.ok, false);
  assert.equal(Object.keys(harness.values.activitySnapshotPrivacyPending.entries).length, 1);

  online = true;
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.command = async (command) => (
    command === 'reload_config'
      ? { ok: true, data: { provisioned: true } }
      : { ok: true, data: {} }
  );
  const synced = await harness.agent.syncProfile();

  assert.equal(synced.ok, true);
  assert.equal(privacyRequests.at(-1)[1].body.shareSnapshots, false);
  assert.equal(privacyRequests.at(-1)[1].authContext.authToken, 'jwt');
  assert.deepEqual(harness.values.activitySnapshotPrivacyPending.entries, {});
});

test('snapshot privacy reconciliation is single-flight per identity, not across accounts', async () => {
  const harness = createMutableController({ authToken: 'jwt-a', authUser: { id: 1 } });
  harness.agent.markSnapshotPrivacyPending(true);
  harness.values.authToken = 'jwt-b';
  harness.values.authUser = { id: 2 };
  harness.agent.markSnapshotPrivacyPending(false);
  harness.values.authToken = 'jwt-a';
  harness.values.authUser = { id: 1 };

  const gates = { 'jwt-a': createDeferred(), 'jwt-b': createDeferred() };
  const requests = [];
  harness.agent.activityRequest = async (pathname, options) => {
    requests.push({ pathname, options });
    return gates[options.authContext.authToken].promise;
  };

  const accountA = harness.agent.reconcileSnapshotPrivacy();
  harness.values.authToken = 'jwt-b';
  harness.values.authUser = { id: 2 };
  const accountB = harness.agent.reconcileSnapshotPrivacy();

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((entry) => entry.options.body.shareSnapshots), [true, false]);
  gates['jwt-b'].resolve({ shareSnapshots: false });
  gates['jwt-a'].resolve({ shareSnapshots: true });
  assert.equal((await accountA).ok, true);
  assert.equal((await accountB).ok, true);
  assert.deepEqual(harness.values.activitySnapshotPrivacyPending.entries, {});
});

test('concurrent provision calls for one credential share a single enroll and Native write', async () => {
  const harness = createMutableController();
  const enroll = createDeferred();
  let enrollRequests = 0;
  const nativeProfiles = [];
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async () => {
    enrollRequests += 1;
    return enroll.promise;
  };
  harness.agent.command = async (command, profile) => {
    if (command === 'provision') nativeProfiles.push(profile);
    return { ok: true, data: command === 'provision' ? { provisioned: true } : {} };
  };

  const first = harness.agent.provision();
  const second = harness.agent.provision();
  assert.equal(first, second);
  while (enrollRequests === 0) await Promise.resolve();
  assert.equal(enrollRequests, 1);
  enroll.resolve({ agentToken: 'agent-token', device: { id: 101, name: 'device' } });
  const result = await first;

  assert.equal(result.ok, true);
  assert.equal(enrollRequests, 1);
  assert.equal(nativeProfiles.length, 1);
  assert.equal(nativeProfiles[0].agentToken, 'agent-token');
  assert.equal(harness.values.activityDeviceId, 101);
  assert.equal(harness.values.activityOnboardingSeen, true);
});

test('provision persists one installation id and enrolls the development channel explicitly', async () => {
  const harness = createMutableController();
  const requests = [];
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async (pathname, options) => {
    requests.push({ pathname, body: { ...options.body } });
    return { agentToken: 'agent-token', device: { id: 141, name: options.body.deviceName } };
  };
  harness.agent.command = async (command) => ({
    ok: true,
    data: command === 'provision' ? { provisioned: true } : {},
  });

  const installationId = harness.values.activityInstallationId;
  const result = await harness.agent.provision();

  assert.equal(result.ok, true);
  assert.match(installationId, /^[0-9a-f-]{36}$/);
  assert.equal(harness.values.activityInstallationId, installationId);
  assert.equal(requests[0].body.installationId, installationId);
  assert.equal(requests[0].body.runtimeChannel, 'dev');
  assert.match(requests[0].body.deviceName, /（开发版）$/);
  assert.equal(harness.values.activityBoundUserId, 7);
  assert.equal(harness.values.activityDeviceBindings.entries['https://example.test::7::dev'].deviceId, 141);
});

test('development provision upgrades an unscoped legacy generated name without claiming its device id', async () => {
  const harness = createMutableController({
    activityDeviceId: 31,
    activityBoundUserId: null,
    activityDeviceName: `${os.hostname()} 的活动提醒`,
  });
  let enrollBody;
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async (_pathname, options) => {
    enrollBody = { ...options.body };
    return { agentToken: 'dev-token', device: { id: 501, name: options.body.deviceName } };
  };
  harness.agent.command = async () => ({ ok: true, data: { provisioned: true } });

  const result = await harness.agent.provision();

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(enrollBody, 'deviceId'), false);
  assert.equal(enrollBody.runtimeChannel, 'dev');
  assert.equal(enrollBody.deviceName, `${os.hostname()} 的活动提醒（开发版）`);
  assert.equal(harness.values.activityDeviceId, 501);
  assert.equal(
    harness.values.activityDeviceBindings.entries['https://example.test::7::dev'].deviceId,
    501,
  );
});

test('development provision preserves an explicit custom legacy device name', async () => {
  const harness = createMutableController({
    activityDeviceId: 31,
    activityBoundUserId: 7,
    activityDeviceName: 'NF 的专用提醒主机',
  });
  let enrollBody;
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async (_pathname, options) => {
    enrollBody = { ...options.body };
    return { agentToken: 'dev-token', device: { id: 502, name: options.body.deviceName } };
  };
  harness.agent.command = async () => ({ ok: true, data: { provisioned: true } });

  const result = await harness.agent.provision();

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(enrollBody, 'deviceId'), false);
  assert.equal(enrollBody.deviceName, 'NF 的专用提醒主机');
});

test('stable provision retains the unscoped legacy device migration path', async () => {
  const harness = createMutableController({
    activityDeviceId: 31,
    activityBoundUserId: 7,
    activityDeviceName: `${os.hostname()} 的活动提醒`,
  }, { isDevRuntime: false });
  let enrollBody;
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async (_pathname, options) => {
    enrollBody = { ...options.body };
    return { agentToken: 'stable-token', device: { id: 31, name: options.body.deviceName } };
  };
  harness.agent.command = async () => ({ ok: true, data: { provisioned: true } });

  const result = await harness.agent.provision();

  assert.equal(result.ok, true);
  assert.equal(enrollBody.deviceId, 31);
  assert.equal(enrollBody.runtimeChannel, 'stable');
  assert.equal(enrollBody.deviceName, `${os.hostname()} 的活动提醒`);
});

test('same user and server reuse the non-sensitive device binding after logout cleared current fields', async () => {
  const installationId = 'd8cf6ab8-bb9a-4cf0-9f62-ef993d9c02f3';
  const harness = createMutableController({
    activityInstallationId: installationId,
    activityBoundUserId: 7,
    activityDeviceId: null,
    activityDeviceName: '',
    activityDeviceBindings: {
      version: 1,
      entries: {
        'https://example.test::7::dev': {
          serverUrl: 'https://example.test',
          userId: '7',
          runtimeChannel: 'dev',
          deviceId: 142,
          deviceName: 'remembered device',
        },
      },
    },
  });
  let enrollBody;
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async (_pathname, options) => {
    enrollBody = { ...options.body };
    return { agentToken: 'rotated-token', device: { id: 142, name: 'remembered device' } };
  };
  harness.agent.command = async () => ({ ok: true, data: { provisioned: true } });

  const result = await harness.agent.provision();

  assert.equal(result.ok, true);
  assert.equal(enrollBody.deviceId, 142);
  assert.equal(enrollBody.installationId, installationId);
  assert.equal(harness.values.activityDeviceId, 142);
});

test('a replacement installation UUID cannot reuse a binding owned by the old installation', async () => {
  const oldInstallationId = 'bf6c7f45-269d-4692-a3b0-247726df816b';
  const harness = createMutableController({
    activityInstallationId: 'corrupted-installation-id',
    activityBoundUserId: 7,
    activityDeviceId: 145,
    activityDeviceName: 'old installation device',
    activityDeviceBindings: {
      version: 2,
      entries: {
        'https://example.test::7::dev': {
          serverUrl: 'https://example.test',
          userId: '7',
          runtimeChannel: 'dev',
          installationId: oldInstallationId,
          deviceId: 145,
          deviceName: 'old installation device',
        },
      },
    },
  });
  let enrollBody;
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async (_pathname, options) => {
    enrollBody = { ...options.body };
    return { agentToken: 'new-installation-token', device: { id: 146, name: 'new installation device' } };
  };
  harness.agent.command = async () => ({ ok: true, data: { provisioned: true } });

  const result = await harness.agent.provision();

  assert.equal(result.ok, true);
  assert.notEqual(harness.values.activityInstallationId, oldInstallationId);
  assert.match(harness.values.activityInstallationId, /^[0-9a-f-]{36}$/);
  assert.equal(Object.hasOwn(enrollBody, 'deviceId'), false);
  assert.equal(enrollBody.installationId, harness.values.activityInstallationId);
  const binding = harness.values.activityDeviceBindings.entries['https://example.test::7::dev'];
  assert.equal(binding.deviceId, 146);
  assert.equal(binding.installationId, harness.values.activityInstallationId);
});

test('DEVICE_NOT_FOUND removes only the stale binding and retries enroll once without deviceId', async () => {
  const harness = createMutableController({
    activityBoundUserId: 7,
    activityDeviceId: 151,
    activityDeviceName: 'deleted device',
    activityDeviceBindings: {
      version: 1,
      entries: {
        'https://example.test::7::dev': {
          serverUrl: 'https://example.test',
          userId: '7',
          runtimeChannel: 'dev',
          deviceId: 151,
          deviceName: 'deleted device',
        },
      },
    },
  });
  const enrollBodies = [];
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async (_pathname, options) => {
    enrollBodies.push({ ...options.body });
    if (enrollBodies.length === 1) {
      throw Object.assign(new Error('gone'), { code: 'DEVICE_NOT_FOUND', status: 404 });
    }
    return { agentToken: 'new-token', device: { id: 152, name: 'replacement device' } };
  };
  harness.agent.command = async () => ({ ok: true, data: { provisioned: true } });

  const result = await harness.agent.provision();

  assert.equal(result.ok, true);
  assert.equal(enrollBodies.length, 2);
  assert.equal(enrollBodies[0].deviceId, 151);
  assert.equal(Object.hasOwn(enrollBodies[1], 'deviceId'), false);
  assert.equal(enrollBodies[1].installationId, harness.values.activityInstallationId);
  assert.equal(harness.values.activityDeviceBindings.entries['https://example.test::7::dev'].deviceId, 152);
});

test('syncProfile immediately provisions when Native reports that its credential is absent', async () => {
  const harness = createMutableController({
    activityBoundUserId: 7,
    activityDeviceId: 161,
    activityDeviceName: 'bound device',
  });
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.command = async (command) => {
    assert.equal(command, 'reload_config');
    return { ok: true, data: { provisioned: false, health: { provision: { state: 'needs_enroll' } } } };
  };
  let provisions = 0;
  harness.agent.provision = async () => {
    provisions += 1;
    return { ok: true, data: { provisioned: true } };
  };

  const result = await harness.agent.syncProfile();

  assert.equal(result.ok, true);
  assert.equal(provisions, 1);
});

test('same-user JWT rotation discards the old enroll response before writing Native credentials', async () => {
  const harness = createMutableController({ authToken: 'jwt-old', authUser: { id: 7 } });
  const oldEnroll = createDeferred();
  const enrollTokens = [];
  const nativeProfiles = [];
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async (pathname, options) => {
    if (options.method === 'DELETE') return {};
    enrollTokens.push(options.authContext.authToken);
    if (options.authContext.authToken === 'jwt-old') return oldEnroll.promise;
    return { agentToken: 'agent-new', device: { id: 202, name: 'new device' } };
  };
  harness.agent.command = async (command, profile) => {
    if (command === 'provision') nativeProfiles.push(profile);
    return { ok: true, data: command === 'provision' ? { provisioned: true } : {} };
  };

  const oldProvision = harness.agent.provision();
  while (enrollTokens.length === 0) await Promise.resolve();
  harness.agent.invalidateProvisionGeneration();
  harness.values.authToken = 'jwt-new';
  const newProvision = harness.agent.provision();
  oldEnroll.resolve({ agentToken: 'agent-old', device: { id: 201, name: 'old device' } });

  const oldResult = await oldProvision;
  const newResult = await newProvision;
  assert.equal(oldResult.code, 'PROVISION_SUPERSEDED');
  assert.equal(newResult.ok, true);
  assert.deepEqual(enrollTokens, ['jwt-old', 'jwt-new']);
  assert.deepEqual(nativeProfiles.map((profile) => profile.agentToken), ['agent-new']);
  assert.equal(harness.values.activityDeviceId, 202);
});

test('a delayed old-account enroll cannot overwrite a newer account provision', async () => {
  const harness = createMutableController({ authToken: 'jwt-a', authUser: { id: 1 } });
  const oldEnroll = createDeferred();
  const nativeProfiles = [];
  const deletedDevices = [];
  let oldEnrollStarted = false;
  harness.agent.ensureRunning = async () => ({ ok: true });
  harness.agent.activityRequest = async (pathname, options) => {
    if (options.method === 'DELETE') {
      deletedDevices.push([options.authContext.authToken, options.body.deviceId]);
      return {};
    }
    if (options.authContext.authToken === 'jwt-a') {
      oldEnrollStarted = true;
      return oldEnroll.promise;
    }
    return { agentToken: 'agent-b', device: { id: 302, name: 'device b' } };
  };
  harness.agent.command = async (command, profile) => {
    if (command === 'provision') nativeProfiles.push(profile);
    return { ok: true, data: command === 'provision' ? { provisioned: true } : {} };
  };

  const accountA = harness.agent.provision();
  while (!oldEnrollStarted) await Promise.resolve();
  harness.agent.invalidateProvisionGeneration();
  harness.values.authToken = 'jwt-b';
  harness.values.authUser = { id: 2 };
  const accountB = await harness.agent.provision();
  assert.equal(accountB.ok, true);
  oldEnroll.resolve({ agentToken: 'agent-a', device: { id: 301, name: 'device a' } });
  const oldResult = await accountA;

  assert.equal(oldResult.code, 'PROVISION_SUPERSEDED');
  assert.deepEqual(nativeProfiles.map((profile) => profile.agentToken), ['agent-b']);
  assert.deepEqual(deletedDevices, [['jwt-a', 301]]);
  assert.equal(harness.values.activityDeviceId, 302);
});

test('exit-all stops a live Agent without clearing its persisted Activity identity', async () => {
  const spawnCalls = [];
  const harness = createMutableController({
    activityDeviceId: 88,
    activityDeviceName: 'persisted device',
  }, {
    spawnSyncImpl(executable, args, options) {
      spawnCalls.push({ executable, args, options });
      return { status: 0 };
    },
  });
  harness.agent.getAgentPath = () => 'C:\\NekoPresenceAgent.exe';
  harness.agent.child = { exitCode: null, killed: false };

  const result = await harness.agent.releaseForAppExit({ exitAll: true, reason: 'session' });

  assert.equal(result.ok, true);
  assert.deepEqual(spawnCalls[0].args, ['--shutdown-for-update', '--channel=dev']);
  assert.equal(harness.values.activityDeviceId, 88);
  assert.equal(harness.values.activityDeviceName, 'persisted device');
});

test('identityRevision changes for a server identity change without exposing credentials', () => {
  const harness = createMutableController();
  const initial = harness.agent.getSnapshot();
  const stable = harness.agent.getSnapshot();
  assert.equal(stable.identityRevision, initial.identityRevision);

  harness.setServerUrl('https://other.example.test');
  const changed = harness.agent.getSnapshot();
  assert.ok(changed.identityRevision > initial.identityRevision);
  assert.equal(Object.prototype.hasOwnProperty.call(changed, 'sessionIdentityKey'), false);
  assert.equal(JSON.stringify(changed).includes('jwt'), false);
});

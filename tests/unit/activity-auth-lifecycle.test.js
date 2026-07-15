const test = require('node:test');
const assert = require('node:assert/strict');

const { registerAuthIpc } = require('../../src/main/ipc/auth.ipc');

function createHarness({ values = {}, loginUser = { id: 1, username: 'alice' } } = {}) {
  const handlers = {};
  const data = {
    authToken: '',
    authUser: null,
    activityBoundUserId: null,
    activityDeviceId: null,
    activityDeviceName: '',
    enableExperimentalFeatures: true,
    enableActivityFeature: true,
    ...values,
  };
  const calls = [];
  let cacheResets = 0;
  let provisionInvalidations = 0;
  const configStore = {
    get(key) { return data[key]; },
    set(key, value) { data[key] = value; },
    setMany(next) { Object.assign(data, next); },
    getServerUrl() { return 'https://example.test'; },
  };
  const activityAgent = {
    isEnabled: () => data.enableActivityFeature === true,
    async revoke(reason) {
      calls.push(['revoke', reason, data.authToken, data.authUser?.id]);
    },
    async ensureRunning(options) { calls.push(['ensureRunning', options]); return { ok: true }; },
    async getStatus() { calls.push(['getStatus']); return { provisioned: false, health: { provision: { state: 'needs_enroll' } } }; },
    async provision() { calls.push(['provision']); return { ok: true }; },
    async syncProfile() { calls.push(['syncProfile']); return { ok: true }; },
    async claimTray() { calls.push(['claimTray']); return { ok: true }; },
    resetActivitySessionCache() { cacheResets += 1; },
    invalidateProvisionGeneration() { provisionInvalidations += 1; },
  };
  registerAuthIpc({
    ipcMain: { handle(channel, handler) { handlers[channel] = handler; } },
    os: { hostname: () => 'test', platform: () => 'win32', arch: () => 'x64' },
    configStore,
    statusService: {},
    apiService: {
      async authLogin() { return { success: true, token: 'new-token', user: loginUser }; },
      async authRegister() { return { success: true, token: 'new-token', user: loginUser }; },
    },
    activityAgent,
  });
  return {
    handlers,
    data,
    calls,
    get cacheResets() { return cacheResets; },
    get provisionInvalidations() { return provisionInvalidations; },
  };
}

test('switching accounts revokes the old Activity identity before storing the new session', async () => {
  const harness = createHarness({
    values: {
      authToken: 'old-token',
      authUser: { id: 1, username: 'alice' },
      activityBoundUserId: 1,
      activityDeviceId: 77,
      activityDeviceName: 'old device',
    },
    loginUser: { id: 2, username: 'bob' },
  });

  const result = await harness.handlers['auth:login'](null, { username: 'bob', password: 'password123' });

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls[0], ['revoke', 'account_change', 'old-token', 1]);
  assert.equal(harness.data.authToken, 'new-token');
  assert.equal(harness.data.authUser.id, 2);
  assert.equal(harness.data.activityBoundUserId, 2);
  assert.equal(harness.data.activityDeviceId, null);
  assert.equal(harness.data.enableActivityFeature, false);
  assert.equal(harness.data.enableActivityPublishing, false);
  assert.equal(harness.data.enableActivitySnapshots, false);
  assert.equal(harness.calls.some(([name]) => name === 'provision'), false);
  assert.equal(harness.cacheResets, 1);
});

test('the same user logging in again automatically provisions an enabled Activity session', async () => {
  const harness = createHarness({
    values: {
      authToken: '',
      authUser: null,
      activityBoundUserId: 1,
      enableActivityFeature: true,
    },
    loginUser: { id: 1, username: 'alice' },
  });

  const result = await harness.handlers['auth:login'](null, { username: 'alice', password: 'password123' });

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.map(([name]) => name), [
    'ensureRunning',
    'getStatus',
    'provision',
    'claimTray',
  ]);
  assert.deepEqual(harness.calls[0][1], { allowAfterShutdown: true });
  assert.equal(harness.data.enableActivityFeature, true);
  assert.equal(harness.cacheResets, 1);
});

test('refreshing the JWT for the same user invalidates an older provision operation', async () => {
  const harness = createHarness({
    values: {
      authToken: 'old-token',
      authUser: { id: 1, username: 'alice' },
      activityBoundUserId: 1,
      enableActivityFeature: true,
    },
    loginUser: { id: 1, username: 'alice' },
  });

  const result = await harness.handlers['auth:login'](null, { username: 'alice', password: 'password123' });

  assert.equal(result.ok, true);
  assert.equal(harness.provisionInvalidations, 1);
  assert.equal(harness.data.authToken, 'new-token');
});

test('logout revokes Activity credentials before clearing the user session', async () => {
  const harness = createHarness({
    values: {
      authToken: 'old-token',
      authUser: { id: 1, username: 'alice' },
      activityBoundUserId: 1,
      activityDeviceId: 77,
    },
  });

  const result = await harness.handlers['auth:logout']();

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls[0], ['revoke', 'logout', 'old-token', 1]);
  assert.equal(harness.data.authToken, '');
  assert.equal(harness.data.authUser, null);
  assert.equal(harness.data.activityBoundUserId, 1);
  assert.equal(harness.data.activityDeviceId, null);
  assert.equal(harness.data.enableActivityFeature, true);
  assert.equal(harness.cacheResets, 1);
});

test('logout then login as the bound user restores the enabled Activity preference', async () => {
  const harness = createHarness({
    values: {
      authToken: 'old-token',
      authUser: { id: 1, username: 'alice' },
      activityBoundUserId: 1,
      enableActivityFeature: true,
      enableActivityPublishing: true,
      enableActivitySnapshots: true,
    },
    loginUser: { id: 1, username: 'alice' },
  });

  await harness.handlers['auth:logout']();
  const result = await harness.handlers['auth:login'](null, { username: 'alice', password: 'password123' });

  assert.equal(result.ok, true);
  assert.equal(harness.data.enableActivityFeature, true);
  assert.equal(harness.data.enableActivityPublishing, true);
  assert.equal(harness.data.enableActivitySnapshots, true);
  assert.equal(harness.calls.filter(([name]) => name === 'provision').length, 1);
});

test('logout then login as a different user disables Activity until reconfirmed', async () => {
  const harness = createHarness({
    values: {
      authToken: 'old-token',
      authUser: { id: 1, username: 'alice' },
      activityBoundUserId: 1,
      enableActivityFeature: true,
      enableActivityPublishing: true,
      enableActivitySnapshots: true,
    },
    loginUser: { id: 2, username: 'bob' },
  });

  await harness.handlers['auth:logout']();
  const result = await harness.handlers['auth:login'](null, { username: 'bob', password: 'password123' });

  assert.equal(result.ok, true);
  assert.equal(harness.data.activityBoundUserId, 2);
  assert.equal(harness.data.enableActivityFeature, false);
  assert.equal(harness.data.enableActivityPublishing, false);
  assert.equal(harness.data.enableActivitySnapshots, false);
  assert.equal(harness.calls.filter(([name]) => name === 'provision').length, 0);
});

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

function createMocks() {
  const handlers = {};
  return {
    ipcMain: {
      handle(channel, fn) { handlers[channel] = fn; },
    },
    handlers,
    os: {
      hostname: () => 'test-host',
      platform: () => 'win32',
      arch: () => 'x64',
    },
    configStore: {
      _data: {
        authToken: 'token',
        authUser: { id: 'u1', username: 'alice', email: '', avatar: '' },
      },
      get(k) { return this._data[k]; },
      set(k, v) { this._data[k] = v; },
      setMany(obj) { Object.assign(this._data, obj); },
      getServerUrl() { return 'https://example.test'; },
    },
    statusService: {
      getDeviceFingerprint: () => 'fingerprint',
    },
    apiService: {
      authLogin: mock.fn(async () => ({ success: true, token: 'new-token' })),
      authRegister: mock.fn(async () => ({ success: true, token: 'token', user: { username: 'alice' } })),
      authGetMe: mock.fn(async () => ({ success: true, user: { username: 'alice' } })),
      authUpdateProfile: mock.fn(async (_token, data) => ({ success: true, user: { username: data.username || 'alice' } })),
      authGenerateDeviceKey: mock.fn(async () => ({ success: true, deviceKey: 'dev-key', deviceId: 1 })),
    },
  };
}

describe('registerAuthIpc', () => {
  let mocks;
  let handlers;

  beforeEach(() => {
    mocks = createMocks();
    const { registerAuthIpc } = require('../../src/main/ipc/auth.ipc');
    registerAuthIpc(mocks);
    handlers = mocks.handlers;
  });

  it('verifies current password before changing a remote password', async () => {
    const result = await handlers['auth:updateProfile'](null, {
      username: 'alice',
      currentPassword: 'old-pass',
      newPassword: 'new-pass',
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.success, true);
    assert.equal(mocks.apiService.authLogin.mock.callCount(), 1);
    assert.deepEqual(mocks.apiService.authLogin.mock.calls[0].arguments, ['alice', 'old-pass']);
    assert.equal(mocks.apiService.authUpdateProfile.mock.callCount(), 1);
  });

  it('does not clear the session when current password verification fails', async () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    mocks.apiService.authLogin = mock.fn(async () => { throw err; });

    const result = await handlers['auth:updateProfile'](null, {
      username: 'alice',
      currentPassword: 'wrong-pass',
      newPassword: 'new-pass',
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'AUTH_FAILED');
    assert.match(result.error.message, /当前密码不正确/);
    assert.equal(mocks.configStore.get('authToken'), 'token');
    assert.equal(mocks.apiService.authUpdateProfile.mock.callCount(), 0);
  });

  it('checks local test account password before local password change', async () => {
    mocks.configStore._data.authToken = 'local-test-token';
    mocks.configStore._data.authUser = { id: 'local-alice', username: 'alice' };
    mocks.configStore._data.localTestAccounts = [{ username: 'alice', password: 'old-pass' }];

    const failed = await handlers['auth:updateProfile'](null, {
      currentPassword: 'wrong-pass',
      newPassword: 'new-pass',
    });
    assert.equal(failed.ok, false);
    assert.match(failed.error.message, /当前密码不正确/);
    assert.equal(mocks.configStore.get('localTestAccounts')[0].password, 'old-pass');

    const ok = await handlers['auth:updateProfile'](null, {
      currentPassword: 'old-pass',
      newPassword: 'new-pass',
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.success, true);
    assert.equal(mocks.configStore.get('localTestAccounts')[0].password, 'new-pass');
  });

  it('wraps auth state and dismiss prompt in the shared IPC envelope', async () => {
    const state = await handlers['auth:getState']();
    assert.equal(state.ok, true);
    assert.equal(state.data.isLoggedIn, true);
    assert.equal(state.data.user.username, 'alice');

    const dismissed = await handlers['auth:dismissPrompt']();
    assert.equal(dismissed.ok, true);
    assert.equal(dismissed.data, true);
    assert.equal(mocks.configStore.get('authPromptDismissed'), true);
  });

  it('keeps the cached account for network, HTML and ambiguous 401 failures', async () => {
    const error = new Error('upstream returned HTML');
    error.status = 401;
    error.trustedJson = false;
    mocks.apiService.authGetMe = mock.fn(async () => { throw error; });

    const result = await handlers['auth:me']();

    assert.equal(result.ok, true);
    assert.equal(result.data.sessionState, 'offline_cached');
    assert.equal(result.data.user.username, 'alice');
    assert.equal(mocks.configStore.get('authToken'), 'token');
  });

  it('clears the cached account only for a trusted terminal auth code', async () => {
    const error = new Error('session revoked');
    error.status = 401;
    error.code = 'AUTH_SESSION_REVOKED';
    error.trustedJson = true;
    mocks.apiService.authGetMe = mock.fn(async () => { throw error; });

    const result = await handlers['auth:me']();

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'AUTH_SESSION_REVOKED');
    assert.equal(mocks.configStore.get('authToken'), '');
    assert.equal(mocks.configStore.get('authUser'), null);
  });

  it('rotates refresh credentials after an expired access token', async () => {
    mocks.configStore._data.authRefreshToken = 'refresh-old';
    mocks.configStore._data.authClientInstanceId = 'instance-id';
    const expired = new Error('expired');
    expired.status = 401;
    expired.code = 'AUTH_TOKEN_EXPIRED';
    expired.trustedJson = true;
    mocks.apiService.authGetMe = mock.fn(async () => { throw expired; });
    mocks.apiService.authRefresh = mock.fn(async () => ({
      success: true,
      token: 'access-new',
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      user: { id: 'u1', username: 'alice' },
    }));

    const result = await handlers['auth:me']();

    assert.equal(result.ok, true);
    assert.equal(result.data.refreshed, true);
    assert.equal(mocks.configStore.get('authToken'), 'access-new');
    assert.equal(mocks.configStore.get('authRefreshToken'), 'refresh-new');
  });
});

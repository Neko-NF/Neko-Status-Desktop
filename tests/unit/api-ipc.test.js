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
        deviceKey: 'dev-key',
        serverUrl: 'https://example.test',
      },
      get(key) { return this._data[key]; },
      setMany(values) { Object.assign(this._data, values); },
      getServerUrl() { return this._data.serverUrl; },
    },
    statusService: {
      isRunning: true,
    },
    apiService: {
      performHandshake: mock.fn(async () => ({ success: true, key: 'next-key', deviceId: 'dev-1' })),
      testConnection: mock.fn(async () => ({ success: true, latency: 42, version: '1.0.0' })),
      validateDeviceKey: mock.fn(async () => ({ valid: true })),
      validateDeviceKeyAt: mock.fn(async () => ({ valid: true })),
    },
  };
}

describe('registerApiIpc', () => {
  let mocks;
  let handlers;

  beforeEach(() => {
    mocks = createMocks();
    const { registerApiIpc } = require('../../src/main/ipc/api.ipc');
    registerApiIpc(mocks);
    handlers = mocks.handlers;
  });

  it('stores device identity after a successful pairing handshake', async () => {
    const result = await handlers['pairing:handshake'](null, { token: 'pair-token', model: 'My PC' });

    assert.equal(result.ok, true);
    assert.equal(result.data.key, 'next-key');
    assert.equal(mocks.configStore.get('deviceKey'), 'next-key');
    assert.deepEqual(mocks.apiService.performHandshake.mock.calls[0].arguments[0], {
      token: 'pair-token',
      model: 'My PC',
    });
  });

  it('wraps connection test metadata for renderer compatibility', async () => {
    const result = await handlers['api:testConnection'](null, 'https://example.test');

    assert.equal(result.ok, true);
    assert.equal(result.data.success, true);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.latencyMs, 42);
    assert.equal(result.data.latency, 42);
  });

  it('returns a contract error when validating without a device key', async () => {
    mocks.configStore._data.deviceKey = '';

    const result = await handlers['api:validateKey']();

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NO_DEVICE_KEY');
  });

  it('rejects empty pre-validation keys before calling the API service', async () => {
    const result = await handlers['api:preValidateKey'](null, '');

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NO_KEY_PROVIDED');
    assert.equal(mocks.apiService.validateDeviceKeyAt.mock.callCount(), 0);
  });

  it('syncs client version with device metadata', async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, status: 200 };
    });
    try {
      const result = await handlers['device:syncMeta']();

      assert.equal(result.ok, true);
      assert.equal(calls[0].deviceKey, 'dev-key');
      assert.equal(calls[0].clientVersion, require('../../package.json').version);
      assert.equal(calls[0].appVersion, require('../../package.json').version);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

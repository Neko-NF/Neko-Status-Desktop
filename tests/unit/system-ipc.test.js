const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

function createMocks() {
  const handlers = {};
  const session = {
    getCacheSize: mock.fn(async () => 1024),
    clearCache: mock.fn(async () => {}),
    clearStorageData: mock.fn(async () => {}),
  };

  return {
    ipcMain: {
      handle(channel, fn) { handlers[channel] = fn; },
      on() {},
    },
    handlers,
    app: {
      getVersion: () => '1.2.3',
      quit: mock.fn(),
      isPackaged: false,
    },
    dialog: {
      showOpenDialog: mock.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: mock.fn(async () => ({ canceled: true, filePath: '' })),
    },
    shell: {
      openExternal: mock.fn(),
    },
    os: {
      hostname: () => 'test-host',
      platform: () => 'win32',
      arch: () => 'x64',
      type: () => 'Windows_NT',
      totalmem: () => 100,
      freemem: () => 50,
    },
    systemUtils: {
      captureScreen: async () => Buffer.from([1, 2, 3]),
      getActiveWindow: async () => null,
      listVisibleWindows: async () => [],
      getBatteryInfo: async () => ({ level: 100 }),
      getSystemMetrics: async () => ({ cpuPct: 1, memPct: 2 }),
    },
    statusService: {
      getDeviceFingerprint: () => 'fingerprint',
    },
    metricsHistory: [],
    getMainWindow: () => ({ webContents: { session, setZoomFactor: mock.fn() }, hide: mock.fn(), show: mock.fn(), minimize: mock.fn() }),
    showWindow: mock.fn(),
    setIsQuitting: mock.fn(),
    pickPrivacyWindow: mock.fn(async () => null),
    showNotification: mock.fn(() => ({ shown: true })),
    getCacheDiskSize: mock.fn(async () => 1024),
    removeCacheTargets: mock.fn(async () => ({ removed: ['Cache'], failed: [] })),
  };
}

describe('registerSystemIpc', () => {
  let mocks;
  let handlers;

  beforeEach(() => {
    mocks = createMocks();
    const { registerSystemIpc } = require('../../src/main/ipc/system.ipc');
    registerSystemIpc(mocks);
    handlers = mocks.handlers;
  });

  it('cache:clear returns success metadata consumed by settings page', async () => {
    const result = await handlers['cache:clear']();

    assert.equal(result.ok, true);
    assert.equal(result.data.success, true);
    assert.equal(typeof result.data.clearedBytes, 'number');
    assert.equal(result.data.removedCount, 1);
  });

  it('system:getFocusAssist returns a renderer-friendly ok/enabled object', async () => {
    const result = await handlers['system:getFocusAssist']();

    assert.equal(result.ok, true);
    assert.equal(result.data.ok, true);
    assert.equal(typeof result.data.enabled, 'boolean');
  });

  it('dialog:saveTextFile reports canceled export without writing', async () => {
    const result = await handlers['dialog:saveTextFile'](null, { content: 'hello' });

    assert.equal(result.ok, true);
    assert.equal(result.data.success, false);
    assert.equal(result.data.canceled, true);
    assert.equal(mocks.dialog.showSaveDialog.mock.callCount(), 1);
  });
});

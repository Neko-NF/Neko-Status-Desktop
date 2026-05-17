/**
 * tests/unit/service-ipc.test.js
 * service.ipc.js 的可 mock 单元测试
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// 构造 mock 依赖
function createMocks() {
  const handlers = {};
  return {
    ipcMain: {
      handle(channel, fn) { handlers[channel] = fn; },
    },
    handlers,
    app: {
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings: mock.fn(),
      getPath: () => '/tmp/test-userData',
    },
    configStore: {
      _data: {},
      get(k) { return this._data[k]; },
      set(k, v) { this._data[k] = v; },
      getAll() { return { ...this._data }; },
    },
    statusService: {
      isRunning: false,
      lastResult: { ok: true },
      start: mock.fn(),
      stop: mock.fn(),
      restart: mock.fn(),
      getRecoveryStats: () => ({ count: 0 }),
    },
    apiService: {
      testConnection: mock.fn(async () => ({ ok: true, latencyMs: 50 })),
    },
    isRunAsAdmin: () => false,
    refreshTrayMenu: mock.fn(),
  };
}

describe('registerServiceIpc', () => {
  let mocks;
  let handlers;

  beforeEach(() => {
    mocks = createMocks();
    const { registerServiceIpc } = require('../../src/main/ipc/service.ipc');
    registerServiceIpc(mocks);
    handlers = mocks.handlers;
  });

  it('注册了所有必需的 IPC channel', () => {
    const expected = [
      'service:start', 'service:stop', 'service:isRunning',
      'service:restart', 'service:lastResult',
      'autostart:enable', 'autostart:disable', 'autostart:isEnabled',
      'service:getProcessInfo', 'service:checkPermissions', 'service:healthCheck',
    ];
    for (const ch of expected) {
      assert.ok(handlers[ch], `应注册 ${ch}`);
    }
  });

  it('service:start 启动服务并返回状态', async () => {
    const result = await handlers['service:start']();
    assert.equal(mocks.statusService.start.mock.callCount(), 1);
    assert.equal(mocks.refreshTrayMenu.mock.callCount(), 1);
    assert.ok('isRunning' in result.data);
  });

  it('service:stop 停止服务并返回状态', async () => {
    const result = await handlers['service:stop']();
    assert.equal(mocks.statusService.stop.mock.callCount(), 1);
    assert.ok('isRunning' in result.data);
  });

  it('service:restart 重启服务', async () => {
    const result = await handlers['service:restart']();
    assert.equal(mocks.statusService.restart.mock.callCount(), 1);
    assert.equal(result.data, true);
  });

  it('service:isRunning 返回布尔值', async () => {
    mocks.statusService.isRunning = true;
    const result = await handlers['service:isRunning']();
    assert.equal(result.data, true);
  });

  it('autostart:enable 配置开机自启', async () => {
    const result = await handlers['autostart:enable']();
    assert.equal(result.data, true);
    assert.equal(mocks.app.setLoginItemSettings.mock.callCount(), 1);
    assert.equal(mocks.configStore.get('enableAutoStart'), true);
  });

  it('autostart:disable 取消开机自启', async () => {
    const result = await handlers['autostart:disable']();
    assert.equal(result.data, true);
    assert.equal(mocks.configStore.get('enableAutoStart'), false);
  });

  it('service:getProcessInfo 返回进程信息对象', async () => {
    const { data: info } = await handlers['service:getProcessInfo']();
    assert.ok(info.pid);
    assert.ok(typeof info.memoryMB === 'number');
    assert.ok(typeof info.uptimeSec === 'number');
    assert.ok('isAdmin' in info);
    assert.ok('recoveryStats' in info);
  });
});

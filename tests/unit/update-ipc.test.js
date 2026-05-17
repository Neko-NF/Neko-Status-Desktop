/**
 * tests/unit/update-ipc.test.js
 * update.ipc.js 的可 mock 单元测试
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

function createMocks() {
  const handlers = {};
  let _autoDownloadState = null;
  return {
    ipcMain: {
      handle(channel, fn) { handlers[channel] = fn; },
    },
    handlers,
    app: {
      getVersion: () => '1.2.3',
      getPath: () => '/tmp/test-userData',
      quit: mock.fn(),
    },
    shell: {},
    configStore: {
      _data: { githubOwner: 'Neko-NF', githubRepo: 'Neko-Status-Desktop' },
      get(k) { return this._data[k]; },
      set(k, v) { this._data[k] = v; },
      getAll() { return { ...this._data }; },
    },
    sendToRenderer: mock.fn(),
    checkForUpdates: mock.fn(async () => ({ hasUpdate: false })),
    launchInstaller: mock.fn(async () => null),
    getAutoDownloadState: () => _autoDownloadState,
    setAutoDownloadState: (v) => { _autoDownloadState = v; },
    setIsQuitting: mock.fn(),
    _getState: () => _autoDownloadState,
    _setState: (v) => { _autoDownloadState = v; },
  };
}

describe('registerUpdateIpc', () => {
  let mocks;
  let handlers;

  beforeEach(() => {
    mocks = createMocks();
    const { registerUpdateIpc } = require('../../src/main/ipc/update.ipc');
    registerUpdateIpc(mocks);
    handlers = mocks.handlers;
  });

  it('注册了所有必需的 IPC channel', () => {
    const expected = [
      'update:check', 'update:getChannel', 'update:setChannel',
      'update:getPendingInstall', 'update:installPending',
      'update:download', 'update:install',
      'update:getChangelog', 'update:integrity', 'update:rollback',
    ];
    for (const ch of expected) {
      assert.ok(handlers[ch], `应注册 ${ch}`);
    }
  });

  it('update:check 调用 checkForUpdates', async () => {
    await handlers['update:check']();
    assert.equal(mocks.checkForUpdates.mock.callCount(), 1);
  });

  it('update:getChannel 返回默认通道 stable', async () => {
    const result = await handlers['update:getChannel']();
    assert.equal(result.data, 'stable');
  });

  it('update:setChannel 接受合法通道', async () => {
    assert.equal((await handlers['update:setChannel'](null, 'beta')).data, true);
    assert.equal(mocks.configStore.get('updateChannel'), 'beta');
  });

  it('update:setChannel 拒绝非法通道', async () => {
    assert.equal((await handlers['update:setChannel'](null, 'invalid')).ok, false);
  });

  it('update:getPendingInstall 无待安装时返回 hasPending: false', async () => {
    const result = await handlers['update:getPendingInstall']();
    assert.equal(result.data.hasPending, false);
  });

  it('update:download 拒绝无效 URL', async () => {
    const result = await handlers['update:download'](null, { url: 'not-a-url' });
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('update:download 防止重入', async () => {
    mocks._setState({ stage: 'downloading' });
    const result = await handlers['update:download'](null, { url: 'https://example.com/test.exe' });
    assert.equal(result.ok, false);
    assert.ok(result.error && (result.error.code || result.error.message).includes('已有下载'));
  });

  it('update:install 拒绝缺少 filePath 的 payload', async () => {
    const result = await handlers['update:install'](null, {});
    assert.equal(result.ok, false);
  });

  it('update:integrity 返回诊断结果数组', async () => {
    const { data: results } = await handlers['update:integrity']();
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 3);
    assert.ok(results.every(r => 'name' in r && 'ok' in r && 'text' in r));
  });
});

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

function createMocks() {
  const handlers = {};
  return {
    ipcMain: {
      handle(channel, fn) { handlers[channel] = fn; },
    },
    handlers,
    configStore: {
      _data: {
        authToken: 'jwt-token',
        serverUrl: 'https://example.test',
      },
      get(key) { return this._data[key]; },
      getServerUrl() { return this._data.serverUrl; },
    },
    apiService: {
      fetchAnnouncements: mock.fn(async () => ({ announcements: [], total: 0 })),
      createAnnouncement: mock.fn(async () => ({ id: 1 })),
      updateAnnouncement: mock.fn(async () => ({ id: 1, title: 'Updated' })),
      deleteAnnouncement: mock.fn(async () => ({ success: true })),
      recordAnnouncementReceipt: mock.fn(async () => ({ success: true, views: 1, acknowledges: 1 })),
    },
  };
}

describe('registerAnnouncementIpc', () => {
  let mocks;
  let handlers;

  beforeEach(() => {
    mocks = createMocks();
    const { registerAnnouncementIpc } = require('../../src/main/ipc/announcement.ipc');
    registerAnnouncementIpc(mocks);
    handlers = mocks.handlers;
  });

  it('requires an auth token before fetching announcements', async () => {
    mocks.configStore._data.authToken = '';

    const result = await handlers['announcement:fetch'](null, {});

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NO_AUTH_TOKEN');
    assert.equal(mocks.apiService.fetchAnnouncements.mock.callCount(), 0);
  });

  it('creates announcements through the API service with validated payload', async () => {
    const payload = {
      title: 'Maintenance',
      content: 'Starts tonight',
      type: 'warning',
      category: 'it',
      targetAudience: 'All staff',
      status: 'published',
      pinned: true,
      priority: 8,
      showPopup: true,
      totalAudience: 120,
    };

    const result = await handlers['announcement:create'](null, payload);

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { id: 1 });
    assert.deepEqual(mocks.apiService.createAnnouncement.mock.calls[0].arguments, ['jwt-token', payload]);
  });

  it('rejects invalid update payloads before calling the API service', async () => {
    const result = await handlers['announcement:update'](null, 1, { priority: 99 });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_PAYLOAD');
    assert.equal(mocks.apiService.updateAnnouncement.mock.callCount(), 0);
  });

  it('includes non-json response details on fetch failures', async () => {
    const err = new Error('服务端返回非 JSON 响应 (HTTP 200)');
    err.status = 200;
    err.body = '<!doctype html><html>login</html>';
    mocks.apiService.fetchAnnouncements = mock.fn(async () => {
      throw err;
    });

    const result = await handlers['announcement:fetch'](null, {});

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ANNOUNCEMENT_FETCH_FAILED');
    assert.equal(result.error.details.apiPath, '/api/announcements');
    assert.match(result.error.details.body, /html/);
  });

  it('records announcement receipts through the API service', async () => {
    const result = await handlers['announcement:receipt'](null, 1, 'ack');

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { success: true, views: 1, acknowledges: 1 });
    assert.deepEqual(mocks.apiService.recordAnnouncementReceipt.mock.calls[0].arguments, ['jwt-token', 1, 'ack']);
  });

  it('rejects invalid receipt actions before calling the API service', async () => {
    const result = await handlers['announcement:receipt'](null, 1, 'dismiss');

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_PAYLOAD');
    assert.equal(mocks.apiService.recordAnnouncementReceipt.mock.callCount(), 0);
  });
});

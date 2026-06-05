const { IPC_CHANNELS, createIpcSuccess, createIpcError } = require('../../shared/ipc-contracts');
const {
  validateAnnouncementPayload,
  validateAnnouncementReceiptPayload,
} = require('../../shared/schemas');

function registerAnnouncementIpc({ ipcMain, configStore, apiService }) {
  function getToken() {
    return configStore.get('authToken');
  }

  function requireToken() {
    const token = getToken();
    if (!token) return createIpcError('NO_AUTH_TOKEN', '未登录，请先登录');
    return token;
  }

  ipcMain.handle(IPC_CHANNELS.ANNOUNCEMENT_FETCH, async (_, options = {}) => {
    const token = requireToken();
    if (typeof token !== 'string') return token;
    try {
      const result = await apiService.fetchAnnouncements(token, options);
      return createIpcSuccess(result);
    } catch (err) {
      if (err.status === 401) return createIpcError('AUTH_EXPIRED', '登录已过期，请重新登录');
      const detail = { serverUrl: configStore.getServerUrl(), apiPath: '/api/announcements' };
      if (err.body) detail.body = err.body.substring(0, 300);
      return createIpcError('ANNOUNCEMENT_FETCH_FAILED', err.message, detail);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ANNOUNCEMENT_CREATE, async (_, payload) => {
    const token = requireToken();
    if (typeof token !== 'string') return token;

    const validation = validateAnnouncementPayload(payload);
    if (!validation.ok) return createIpcError('INVALID_PAYLOAD', validation.reason);

    try {
      const result = await apiService.createAnnouncement(token, payload);
      return createIpcSuccess(result);
    } catch (err) {
      if (err.status === 401) return createIpcError('AUTH_EXPIRED', '登录已过期，请重新登录');
      if (err.status === 403) return createIpcError('FORBIDDEN', '仅管理员可以发布公告');
      const detail = { serverUrl: configStore.getServerUrl(), apiPath: '/api/announcements' };
      if (err.body) detail.body = err.body.substring(0, 300);
      return createIpcError('ANNOUNCEMENT_CREATE_FAILED', err.message, detail);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ANNOUNCEMENT_UPDATE, async (_, id, payload) => {
    const token = requireToken();
    if (typeof token !== 'string') return token;

    if (id === undefined || id === null) return createIpcError('INVALID_PARAM', '公告 ID 不能为空');

    const validation = validateAnnouncementPayload(payload, { partial: true });
    if (!validation.ok) return createIpcError('INVALID_PAYLOAD', validation.reason);

    try {
      const result = await apiService.updateAnnouncement(token, id, payload);
      return createIpcSuccess(result);
    } catch (err) {
      if (err.status === 401) return createIpcError('AUTH_EXPIRED', '登录已过期，请重新登录');
      if (err.status === 403) return createIpcError('FORBIDDEN', '仅管理员可以编辑公告');
      if (err.status === 404) return createIpcError('NOT_FOUND', '公告不存在');
      const detail = { serverUrl: configStore.getServerUrl(), apiPath: `/api/announcements/${id}` };
      if (err.body) detail.body = err.body.substring(0, 300);
      return createIpcError('ANNOUNCEMENT_UPDATE_FAILED', err.message, detail);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ANNOUNCEMENT_DELETE, async (_, id) => {
    const token = requireToken();
    if (typeof token !== 'string') return token;

    if (id === undefined || id === null) return createIpcError('INVALID_PARAM', '公告 ID 不能为空');

    try {
      const result = await apiService.deleteAnnouncement(token, id);
      return createIpcSuccess(result);
    } catch (err) {
      if (err.status === 401) return createIpcError('AUTH_EXPIRED', '登录已过期，请重新登录');
      if (err.status === 403) return createIpcError('FORBIDDEN', '仅管理员可以删除公告');
      if (err.status === 404) return createIpcError('NOT_FOUND', '公告不存在');
      const detail = { serverUrl: configStore.getServerUrl(), apiPath: `/api/announcements/${id}` };
      if (err.body) detail.body = err.body.substring(0, 300);
      return createIpcError('ANNOUNCEMENT_DELETE_FAILED', err.message, detail);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ANNOUNCEMENT_RECEIPT, async (_, id, action = 'ack') => {
    const token = requireToken();
    if (typeof token !== 'string') return token;

    const validation = validateAnnouncementReceiptPayload({ id, action });
    if (!validation.ok) return createIpcError('INVALID_PAYLOAD', validation.reason);

    try {
      const result = await apiService.recordAnnouncementReceipt(token, id, action);
      return createIpcSuccess(result);
    } catch (err) {
      if (err.status === 401) return createIpcError('AUTH_EXPIRED', '登录已过期，请重新登录');
      if (err.status === 404) return createIpcError('NOT_FOUND', '公告不存在');
      const detail = { serverUrl: configStore.getServerUrl(), apiPath: `/api/announcements/${id}/receipt` };
      if (err.body) detail.body = err.body.substring(0, 300);
      return createIpcError('ANNOUNCEMENT_RECEIPT_FAILED', err.message, detail);
    }
  });
}

module.exports = { registerAnnouncementIpc };

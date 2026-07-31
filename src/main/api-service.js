/**
 * api-service.js
 * 与服务端的 HTTP 通信，使用 Node.js 22 内置 fetch
 */
const configStore = require('./config-store');
const os = require('os');
const { parseRetryAfterSeconds } = require('./report-recovery-policy');

/** 构建带超时的 AbortSignal */
function withTimeout(ms) {
  return AbortSignal.timeout(ms);
}

async function readJsonResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = null;
  }
  return { text, json };
}

function createHttpError(response, json, text, fallbackMessage) {
  const message = json?.message || json?.error || fallbackMessage || `Request failed HTTP ${response.status}`;
  const err = new Error(message);
  err.status = response.status;
  if (json?.code) err.code = json.code;
  if (text) err.body = text.substring(0, 300);
  return err;
}

function isTrustedJsonResponse(response, expectedUrl, json) {
  if (!json || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) return false;
  try {
    return new URL(response.url).origin === new URL(expectedUrl).origin;
  } catch {
    return false;
  }
}

async function authJsonRequest(pathname, { method = 'POST', token = '', body } = {}) {
  const url = new URL(pathname, configStore.getServerUrl()).toString();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: withTimeout(15000),
  });
  const { text, json } = await readJsonResponse(response);
  if (!response.ok) {
    const error = createHttpError(response, json, text, `认证请求失败 HTTP ${response.status}`);
    if (!isTrustedJsonResponse(response, url, json)) delete error.code;
    error.trustedJson = isTrustedJsonResponse(response, url, json);
    throw error;
  }
  if (!isTrustedJsonResponse(response, url, json)) {
    const error = new Error('服务端返回了非 JSON 或非可信来源的响应');
    error.status = response.status;
    error.trustedJson = false;
    throw error;
  }
  return json;
}

async function streamRequest(pathname, { method = 'GET', deviceKey, query, body } = {}) {
  const serverUrl = configStore.getServerUrl();
  const url = new URL(pathname, serverUrl);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const headers = { 'X-API-Key': deviceKey };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: withTimeout(15000),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(json.message || json.error || `请求失败 HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return json;
}

/**
 * 状态上报 V2: POST /api/v2/status/report (multipart/form-data)
 * @param {object} params
 * @param {string} params.deviceKey
 * @param {string} [params.deviceFingerprint]
 * @param {string} [params.appName]       前台窗口标题
 * @param {string} [params.packageName]   进程名 (e.g. chrome.exe)
 * @param {number} [params.batteryLevel]
 * @param {boolean} [params.isCharging]
 * @param {string} [params.status]        'online' | 'away' | 'offline'
 * @param {Buffer|null} [params.screenshotBuffer] PNG/JPEG Buffer
 * @param {string} [params.screenshotMimeType]
 * @param {string} [params.screenshotFilename]
 * @param {object|null} [params.music]
 * @param {Buffer|null} [params.iconBuffer] 应用图标 PNG Buffer
 */
async function reportStatusV2(params) {
  const {
    deviceKey,
    deviceFingerprint = '',
    clientVersion = '',
    runtimeSessionId = '',
    appName = '',
    packageName = '',
    batteryLevel = 0,
    isCharging = false,
    status = 'online',
    screenshotBuffer = null,
    screenshotMimeType = 'image/png',
    screenshotFilename = 'screenshot.png',
    music = null,
    iconBuffer = null,
  } = params;

  const serverUrl = configStore.getServerUrl();

  const dataObj = {
    deviceKey,
    deviceFingerprint,
    clientVersion,
    appVersion: clientVersion,
    runtimeSessionId,
    appName,
    packageName,
    status,
    batteryLevel: Number(batteryLevel) || 0,
    isCharging: Boolean(isCharging),
    screenStatus: 'on',
  };

  if (music && music.isPlaying) {
    dataObj.music = music;
  }

  const formData = new FormData();
  formData.append('data', JSON.stringify(dataObj));

  if (screenshotBuffer && screenshotBuffer.length > 0) {
    const safeMime = screenshotMimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const safeFilename = typeof screenshotFilename === 'string' && /\.(png|jpe?g)$/i.test(screenshotFilename)
      ? screenshotFilename
      : safeMime === 'image/jpeg' ? 'screenshot.jpg' : 'screenshot.png';
    const blob = new Blob([screenshotBuffer], { type: safeMime });
    formData.append('screenshot', blob, safeFilename);
  }

  if (iconBuffer && iconBuffer.length > 0) {
    const blob = new Blob([iconBuffer], { type: 'image/png' });
    formData.append('file', blob, 'icon.png');
  }

  const response = await fetch(`${serverUrl}/api/v2/status/report`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${deviceKey}` },
    body: formData,
    signal: withTimeout(15000),
  });

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    const { text, json: body } = await readJsonResponse(response);
    const err = new Error(body?.message || '设备密钥无效');
    if (isTrustedJsonResponse(response, `${serverUrl}/api/v2/status/report`, body)) {
      err.code = body.code;
      err.trustedJson = true;
    } else {
      err.trustedJson = false;
      err.body = text.substring(0, 200);
    }
    err.status = response.status;
    throw err;
  }

  if (response.status === 429) {
    const retryAfter = parseRetryAfterSeconds(response.headers.get('Retry-After'));
    const err = new Error('请求频率过高，请稍后重试');
    err.code = 'RATE_LIMITED';
    err.status = 429;
    err.retryAfter = retryAfter;
    throw err;
  }

  // 5xx 网关/服务器错误 — 数据大概率已被上游处理，标记为瞬时错误
  if (response.status >= 500 && response.status < 600) {
    const err = new Error(`服务器暂时异常 (HTTP ${response.status})，数据可能已送达`);
    err.status = response.status;
    err.transient = true;
    throw err;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`上报失败 HTTP ${response.status}: ${text.substring(0, 200)}`);
  }

  return await response.json();
}

/**
 * 设备配对握手: POST /api/pair/handshake
 * @param {object} params
 * @param {string} params.token  扫码获取的 sessionToken
 * @param {string} [params.model] 设备型号，默认用主机名
 */
async function performHandshake({ token, model }) {
  const serverUrl = configStore.getServerUrl();

  const response = await fetch(`${serverUrl}/api/pair/handshake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      model: model || os.hostname(),
      type: 'windows',
    }),
    signal: withTimeout(15000),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(json.message || `配对失败 HTTP ${response.status}`);
    err.code = json.code;
    err.status = response.status;
    throw err;
  }

  return json; // { success, key, deviceId, ... }
}

/**
 * 测试服务器连通性
 * @param {string} serverUrl 服务器基础 URL
 * @returns {Promise<{ok: boolean, latencyMs?: number, error?: string}>}
 */
async function testConnection(serverUrl) {
  const url = serverUrl || configStore.getServerUrl();
  const start = Date.now();
  try {
    // Prefer a lightweight ping endpoint; fall back to the status API for older servers.
    let response = await fetch(`${url}/api/v1/auth/ping`, {
      method: 'GET',
      signal: withTimeout(7000),
    }).catch(() => null);

    if (!response) {
      response = await fetch(`${url}/api/v2/status/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: '{}' }),
        signal: withTimeout(7000),
      });
    }
    const latencyMs = Date.now() - start;
    // 任何 HTTP 响应（包括 4xx）都说明服务器在线
    return { ok: true, latencyMs, statusCode: response.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  公 告 系 统  (需要 JWT Bearer Token)
// ═══════════════════════════════════════════════════════════════════════

/**
 * 获取公告列表: GET /api/announcements
 * @param {string} token JWT token
 * @param {object} [options]
 * @param {boolean} [options.all] 管理员查看全部（含已过期）
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 */
async function fetchAnnouncements(token, options = {}) {
  const serverUrl = configStore.getServerUrl();
  const params = new URLSearchParams();
  if (options.all) params.set('all', 'true');
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.status) params.set('status', String(options.status));
  if (options.category) params.set('category', String(options.category));
  if (options.search) params.set('search', String(options.search));

  const qs = params.toString();
  const url = qs ? `${serverUrl}/api/announcements?${qs}` : `${serverUrl}/api/announcements`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    signal: withTimeout(10000),
  });

  const { text, json } = await readJsonResponse(response);

  if (!response.ok) {
    throw createHttpError(response, json, text, `获取公告失败 HTTP ${response.status}`);
  }

  if (!json) {
    const err = new Error(`服务端返回非 JSON 响应 (HTTP ${response.status})`);
    err.status = response.status;
    err.body = text.substring(0, 300);
    throw err;
  }

  return json;
}

/**
 * 创建公告: POST /api/announcements
 * @param {string} token JWT token
 * @param {object} payload { title, content, type, priority, expiresAt, showPopup, pushNotification }
 */
async function createAnnouncement(token, payload) {
  const serverUrl = configStore.getServerUrl();
  const response = await fetch(`${serverUrl}/api/announcements`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: withTimeout(10000),
  });

  const { text, json } = await readJsonResponse(response);

  if (!response.ok) {
    throw createHttpError(response, json, text, `创建公告失败 HTTP ${response.status}`);
  }

  if (!json) {
    const err = new Error(`服务端返回非 JSON 响应 (HTTP ${response.status})`);
    err.status = response.status;
    err.body = text.substring(0, 300);
    throw err;
  }

  return json;
}

/**
 * 更新公告: PUT /api/announcements/[id]
 * @param {string} token JWT token
 * @param {number} id
 * @param {object} payload 局部更新的字段
 */
async function updateAnnouncement(token, id, payload) {
  const serverUrl = configStore.getServerUrl();
  const response = await fetch(`${serverUrl}/api/announcements/${id}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: withTimeout(10000),
  });

  const { text, json } = await readJsonResponse(response);

  if (!response.ok) {
    throw createHttpError(response, json, text, `更新公告失败 HTTP ${response.status}`);
  }

  if (!json) {
    const err = new Error(`服务端返回非 JSON 响应 (HTTP ${response.status})`);
    err.status = response.status;
    err.body = text.substring(0, 300);
    throw err;
  }

  return json;
}

/**
 * 删除公告: DELETE /api/announcements/[id]
 * @param {string} token JWT token
 * @param {number} id
 */
async function deleteAnnouncement(token, id) {
  const serverUrl = configStore.getServerUrl();
  const response = await fetch(`${serverUrl}/api/announcements/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
    signal: withTimeout(10000),
  });

  const { text, json } = await readJsonResponse(response);

  if (!response.ok) {
    throw createHttpError(response, json, text, `删除公告失败 HTTP ${response.status}`);
  }

  if (!json) {
    const err = new Error(`服务端返回非 JSON 响应 (HTTP ${response.status})`);
    err.status = response.status;
    err.body = text.substring(0, 300);
    throw err;
  }

  return json;
}

/**
 * 记录公告回执: POST /api/announcements/[id]/receipt
 * @param {string} token JWT token
 * @param {number|string} id
 * @param {'view'|'ack'} action
 */
async function recordAnnouncementReceipt(token, id, action = 'ack') {
  const serverUrl = configStore.getServerUrl();
  const response = await fetch(`${serverUrl}/api/announcements/${id}/receipt`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action }),
    signal: withTimeout(10000),
  });

  const { text, json } = await readJsonResponse(response);

  if (!response.ok) {
    throw createHttpError(response, json, text, `记录公告回执失败 HTTP ${response.status}`);
  }

  if (!json) {
    const err = new Error(`服务端返回非 JSON 响应 (HTTP ${response.status})`);
    err.status = response.status;
    err.body = text.substring(0, 300);
    throw err;
  }

  return json;
}

module.exports = {
  reportStatusV2,
  performHandshake,
  testConnection,
  validateDeviceKey,
  validateDeviceKeyAt,
  authLogin,
  authRegister,
  authGetMe,
  authUpdateProfile,
  authGenerateDeviceKey,
  authSessionUpgrade,
  authRefresh,
  authLogout,
  reportLifecycleEvent,
  getDiagnosticsCapabilities,
  uploadDiagnosticReport,
  streamGetOrInitKey,
  streamResetKey,
  streamGetStatus,
  streamTestSrs,
  fetchAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  recordAnnouncementReceipt,
};

/**
 * 验证设备密钥: GET /api/device/validate
 * @param {string} deviceKey
 * @param {string} [fingerprint]
 * @returns {Promise<{valid: boolean, deviceId?: number, warning?: string, ...}>}
 */
async function validateDeviceKey(deviceKey, fingerprint) {
  const serverUrl = configStore.getServerUrl();
  const params = new URLSearchParams();
  if (fingerprint) params.set('fingerprint', fingerprint);

  const url = `${serverUrl}/api/device/validate?${params.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${deviceKey}` },
    signal: withTimeout(10000),
  });

  const { text, json } = await readJsonResponse(response);
  const trustedJson = isTrustedJsonResponse(response, url, json);

  if (response.status === 403) {
    const err = new Error(json?.message || '密钥已被撤销');
    if (trustedJson) err.code = json?.errorCode;
    err.trustedJson = trustedJson;
    err.status = 403;
    throw err;
  }

  if (response.status === 404) {
    const err = new Error(json?.message || '密钥不存在');
    if (trustedJson) err.code = json?.errorCode;
    err.trustedJson = trustedJson;
    err.status = 404;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(json?.message || `验证失败 HTTP ${response.status}`);
    err.status = response.status;
    err.trustedJson = trustedJson;
    err.body = text.substring(0, 200);
    throw err;
  }

  if (!trustedJson) throw new Error('设备验证接口返回非可信 JSON');
  return json;
}

/**
 * 密钥预检：使用指定服务器验证密钥（不发送指纹，用于检测接管风险）
 * @param {string} deviceKey
 * @param {string} serverUrl
 * @returns {Promise<{valid: boolean, warning?: string, ...}>}
 */
async function validateDeviceKeyAt(deviceKey, serverUrl) {
  const response = await fetch(`${serverUrl}/api/device/validate`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${deviceKey}` },
    signal: withTimeout(5000),
  });

  const json = await response.json().catch(() => ({}));

  if (response.status === 403) {
    const err = new Error(json.message || '密钥已被撤销');
    err.code = json.errorCode || 'KEY_REVOKED';
    err.status = 403;
    throw err;
  }

  if (!response.ok) {
    throw new Error(json.message || `验证失败 HTTP ${response.status}`);
  }

  return json;
}

// ═══════════════════════════════════════════════════════════════════════
//  用 户 认 证  (桌面客户端 REST API)
// ═══════════════════════════════════════════════════════════════════════

/**
 * 登录: POST /api/auth/login
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{success: boolean, token?: string, user?: object, message?: string}>}
 */
async function authLogin(username, password, session = {}) {
  return authJsonRequest('/api/auth/login', {
    body: { username, password, ...session },
  });
}

/**
 * 注册: POST /api/auth/register
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{success: boolean, token?: string, user?: object, message?: string}>}
 */
async function authRegister(username, password, session = {}) {
  return authJsonRequest('/api/auth/register', {
    body: { username, password, ...session },
  });
}

/**
 * 获取当前用户信息: GET /api/auth/me
 * @param {string} token JWT token
 * @returns {Promise<{success: boolean, user?: object}>}
 */
async function authGetMe(token) {
  return authJsonRequest('/api/auth/me', { method: 'GET', token });
}

async function authSessionUpgrade(token, session = {}) {
  return authJsonRequest('/api/auth/session/upgrade', { token, body: session });
}

async function authRefresh(refreshToken, session = {}) {
  return authJsonRequest('/api/auth/refresh', { body: { refreshToken, ...session } });
}

async function authLogout(refreshToken) {
  return authJsonRequest('/api/auth/logout', { body: { refreshToken } });
}

async function reportLifecycleEvent(deviceKey, event) {
  const url = new URL('/api/v2/status/lifecycle', configStore.getServerUrl()).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    signal: withTimeout(1200),
  });
  const { text, json } = await readJsonResponse(response);
  if (!response.ok) throw createHttpError(response, json, text, `生命周期事件上报失败 HTTP ${response.status}`);
  if (!isTrustedJsonResponse(response, url, json)) throw new Error('生命周期接口返回非可信 JSON');
  return json;
}

async function getDiagnosticsCapabilities() {
  const url = new URL('/api/v2/diagnostics/capabilities', configStore.getServerUrl()).toString();
  const response = await fetch(url, { signal: withTimeout(10000) });
  const { text, json } = await readJsonResponse(response);
  if (!response.ok) throw createHttpError(response, json, text, `诊断能力探测失败 HTTP ${response.status}`);
  if (!isTrustedJsonResponse(response, url, json)) throw new Error('诊断能力接口返回非可信 JSON');
  return json;
}

async function uploadDiagnosticReport(credential, report) {
  const url = new URL('/api/v2/diagnostics/reports', configStore.getServerUrl()).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    signal: withTimeout(15000),
  });
  const { text, json } = await readJsonResponse(response);
  if (!response.ok) throw createHttpError(response, json, text, `诊断上传失败 HTTP ${response.status}`);
  if (!isTrustedJsonResponse(response, url, json)) throw new Error('诊断上传接口返回非可信 JSON');
  return json;
}

/**
 * 更新个人信息: PUT /api/auth/profile
 * @param {string} token JWT token
 * @param {object} data { username?, email?, avatar?, currentPassword?, newPassword? }
 * @returns {Promise<{success: boolean, user?: object, message?: string}>}
 */
async function authUpdateProfile(token, data) {
  return authJsonRequest('/api/auth/profile', { method: 'PUT', token, body: data });
}

/**
 * 生成设备密钥: POST /api/auth/device-key
 * @param {string} token JWT token
 * @param {object} data { deviceName?, platform?, deviceFingerprint? }
 * @returns {Promise<{success: boolean, deviceKey?: string, deviceId?: number, isExisting?: boolean}>}
 */
async function authGenerateDeviceKey(token, data) {
  return authJsonRequest('/api/auth/device-key', { token, body: data });
}

/**
 * 获取或初始化 Stream Key: GET /api/v1/stream/key
 * @param {string} deviceKey
 */
async function streamGetOrInitKey(deviceKey) {
  return streamRequest('/api/v1/stream/key', {
    method: 'GET',
    deviceKey,
  });
}

/**
 * 重置 Stream Key: POST /api/v1/stream/key/reset
 * @param {string} deviceKey
 */
async function streamResetKey(deviceKey) {
  return streamRequest('/api/v1/stream/key/reset', {
    method: 'POST',
    deviceKey,
  });
}

/**
 * 查询推流状态: GET /api/v1/stream/status
 * @param {string} deviceKey
 * @param {object} query
 */
async function streamGetStatus(deviceKey, query) {
  return streamRequest('/api/v1/stream/status', {
    method: 'GET',
    deviceKey,
    query,
  });
}

/**
 * 测试 SRS 连通性: POST /api/v1/stream/test-srs
 * @param {string} deviceKey
 * @param {object} body
 */
async function streamTestSrs(deviceKey, body) {
  return streamRequest('/api/v1/stream/test-srs', {
    method: 'POST',
    deviceKey,
    body,
  });
}

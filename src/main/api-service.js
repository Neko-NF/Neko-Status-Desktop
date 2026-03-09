/**
 * api-service.js
 * 与服务端的 HTTP 通信，使用 Node.js 22 内置 fetch
 */
const configStore = require('./config-store');
const os = require('os');

/** 构建带超时的 AbortSignal */
function withTimeout(ms) {
  return AbortSignal.timeout(ms);
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
 * @param {Buffer|null} [params.screenshotBuffer] PNG/JPG Buffer
 * @param {object|null} [params.music]
 * @param {Buffer|null} [params.iconBuffer] 应用图标 PNG Buffer
 */
async function reportStatusV2(params) {
  const {
    deviceKey,
    deviceFingerprint = '',
    appName = '',
    packageName = '',
    batteryLevel = 0,
    isCharging = false,
    status = 'online',
    screenshotBuffer = null,
    music = null,
    iconBuffer = null,
  } = params;

  const serverUrl = configStore.getServerUrl();

  const dataObj = {
    deviceKey,
    deviceFingerprint,
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
    const blob = new Blob([screenshotBuffer], { type: 'image/png' });
    formData.append('screenshot', blob, 'screenshot.png');
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

  if (response.status === 401) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body.message || '设备密钥无效');
    err.code = body.code || 'INVALID_KEY';
    err.status = 401;
    throw err;
  }

  if (response.status === 403) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body.message || '设备密钥无效或已被撤销');
    err.code = body.code || 'KEY_REVOKED';
    err.status = 403;
    throw err;
  }

  if (response.status === 404) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body.message || '设备不存在');
    err.code = body.code || 'DEVICE_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
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
    // 尝试 /api/v2/status/report 发一个空请求 (会返回400/403，但说明服务器在线)
    const response = await fetch(`${url}/api/v2/status/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '{}' }),
      signal: withTimeout(7000),
    });
    const latencyMs = Date.now() - start;
    // 任何 HTTP 响应（包括 4xx）都说明服务器在线
    return { ok: true, latencyMs, statusCode: response.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { reportStatusV2, performHandshake, testConnection, validateDeviceKey };

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

  const response = await fetch(`${serverUrl}/api/device/validate?${params.toString()}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${deviceKey}` },
    signal: withTimeout(10000),
  });

  const json = await response.json().catch(() => ({}));

  if (response.status === 403) {
    const err = new Error(json.message || '密钥已被撤销');
    err.code = json.errorCode || 'KEY_REVOKED';
    err.status = 403;
    throw err;
  }

  if (response.status === 404) {
    const err = new Error(json.message || '密钥不存在');
    err.code = json.errorCode || 'KEY_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  if (!response.ok) {
    throw new Error(json.message || `验证失败 HTTP ${response.status}`);
  }

  return json;
}

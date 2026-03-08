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

  const response = await fetch(`${serverUrl}/api/v2/status/report`, {
    method: 'POST',
    body: formData,
    signal: withTimeout(15000),
  });

  if (response.status === 403) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body.message || '设备密钥无效或已被撤销');
    err.code = body.code || 'KEY_REVOKED';
    err.status = 403;
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

module.exports = { reportStatusV2, performHandshake, testConnection };

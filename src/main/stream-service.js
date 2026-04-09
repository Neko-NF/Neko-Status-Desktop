const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { OBSWebSocket } = require('obs-websocket-js');

const apiService = require('./api-service');
const configStore = require('./config-store');

const obs = new OBSWebSocket();

const DEFAULT_STREAM_CONFIG = {
  srsHost: '',
  srsRtmpPort: 1935,
  srsApp: 'live',
  srsApiPort: 1985,
  streamKey: '',
  obsWsHost: '127.0.0.1',
  obsWsPort: 4455,
  obsWsPasswordEncrypted: '',
};

let obsConnection = {
  connected: false,
  url: '',
  password: '',
};

function normalizePort(value, fallback) {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    return port;
  }
  return fallback;
}

function trimSlashes(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

function normalizeStreamConfig(config = {}) {
  return {
    ...DEFAULT_STREAM_CONFIG,
    ...(config || {}),
    srsHost: String(config.srsHost || '').trim(),
    srsRtmpPort: normalizePort(config.srsRtmpPort, DEFAULT_STREAM_CONFIG.srsRtmpPort),
    srsApp: trimSlashes(config.srsApp || DEFAULT_STREAM_CONFIG.srsApp) || DEFAULT_STREAM_CONFIG.srsApp,
    srsApiPort: normalizePort(config.srsApiPort, DEFAULT_STREAM_CONFIG.srsApiPort),
    streamKey: String(config.streamKey || '').trim(),
    obsWsHost: String(config.obsWsHost || DEFAULT_STREAM_CONFIG.obsWsHost).trim() || DEFAULT_STREAM_CONFIG.obsWsHost,
    obsWsPort: normalizePort(config.obsWsPort, DEFAULT_STREAM_CONFIG.obsWsPort),
    obsWsPasswordEncrypted: String(config.obsWsPasswordEncrypted || ''),
  };
}

function encryptSecret(secret) {
  if (!secret) return '';
  const text = String(secret);
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(text).toString('base64')}`;
  }
  return `plain:${Buffer.from(text, 'utf8').toString('base64')}`;
}

function decryptSecret(payload) {
  if (!payload) return '';
  if (payload.startsWith('enc:')) {
    if (!safeStorage.isEncryptionAvailable()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(payload.slice(4), 'base64'));
    } catch {
      return '';
    }
  }
  if (payload.startsWith('plain:')) {
    try {
      return Buffer.from(payload.slice(6), 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
  return '';
}

function getStoredStreamConfig() {
  return normalizeStreamConfig(configStore.get('streamConfig'));
}

function saveStoredStreamConfig(config) {
  const normalized = normalizeStreamConfig(config);
  configStore.set('streamConfig', normalized);
  return normalized;
}

function buildPublicStreamConfig(config) {
  const normalized = normalizeStreamConfig(config);
  return {
    srsHost: normalized.srsHost,
    srsRtmpPort: normalized.srsRtmpPort,
    srsApp: normalized.srsApp,
    srsApiPort: normalized.srsApiPort,
    streamKey: normalized.streamKey,
    obsWsHost: normalized.obsWsHost,
    obsWsPort: normalized.obsWsPort,
    obsWsPassword: decryptSecret(normalized.obsWsPasswordEncrypted),
  };
}

function getDeviceKeyOrThrow() {
  const deviceKey = String(configStore.get('deviceKey') || '').trim();
  if (!deviceKey) {
    throw new Error('未配置设备密钥，无法调用直播推流接口');
  }
  return deviceKey;
}

function normalizeSrsHostForApi(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  if (/^rtmps?:\/\//i.test(raw) || /^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).hostname;
    } catch {
      return raw;
    }
  }

  return raw.replace(/^\/+|\/+$/g, '').split('/')[0];
}

function buildRtmpServer(config) {
  const normalized = normalizeStreamConfig(config);
  const appName = trimSlashes(normalized.srsApp) || DEFAULT_STREAM_CONFIG.srsApp;
  const host = normalized.srsHost;

  if (!host) return '';

  if (/^rtmps?:\/\//i.test(host)) {
    const url = new URL(host);
    url.pathname = `/${appName}`;
    if (!url.port) {
      url.port = String(normalized.srsRtmpPort);
    }
    return url.toString().replace(/\/$/, '');
  }

  const protocol = normalized.srsRtmpPort === 443 ? 'rtmps' : 'rtmp';
  return `${protocol}://${host}:${normalized.srsRtmpPort}/${appName}`;
}

async function ensureStreamKey(config) {
  const normalized = normalizeStreamConfig(config);
  if (!normalized.srsHost || normalized.streamKey) {
    return normalized;
  }

  try {
    const keyResponse = await getOrInitStreamKey();
    normalized.streamKey = keyResponse.stream_key || '';
  } catch {
    // 未完成配对或后端暂不可用时保留空值，不阻断页面使用
  }

  return normalized;
}

function persistObsConnectionSettings(wsConfig = {}) {
  const current = getStoredStreamConfig();
  const password = Object.prototype.hasOwnProperty.call(wsConfig, 'password')
    ? String(wsConfig.password || '')
    : decryptSecret(current.obsWsPasswordEncrypted);

  return saveStoredStreamConfig({
    ...current,
    obsWsHost: String(wsConfig.host || current.obsWsHost || DEFAULT_STREAM_CONFIG.obsWsHost).trim() || DEFAULT_STREAM_CONFIG.obsWsHost,
    obsWsPort: normalizePort(wsConfig.port, current.obsWsPort || DEFAULT_STREAM_CONFIG.obsWsPort),
    obsWsPasswordEncrypted: encryptSecret(password),
  });
}

async function ensureObsConnection(wsConfig = {}) {
  const host = String(wsConfig.host || DEFAULT_STREAM_CONFIG.obsWsHost).trim() || DEFAULT_STREAM_CONFIG.obsWsHost;
  const port = normalizePort(wsConfig.port, DEFAULT_STREAM_CONFIG.obsWsPort);
  const password = String(wsConfig.password || '');
  const url = `ws://${host}:${port}`;

  if (obsConnection.connected && (obsConnection.url !== url || obsConnection.password !== password)) {
    await disconnectObs();
  }

  if (!obsConnection.connected) {
    await obs.connect(url, password || undefined);
    obsConnection = {
      connected: true,
      url,
      password,
    };
  }

  return obs.call('GetVersion');
}

async function getStreamConfig() {
  const config = await ensureStreamKey(getStoredStreamConfig());
  if (config.streamKey) {
    saveStoredStreamConfig(config);
  }
  return buildPublicStreamConfig(config);
}

async function saveStreamConfig(config) {
  const current = getStoredStreamConfig();
  const merged = normalizeStreamConfig({
    ...current,
    ...config,
    obsWsPasswordEncrypted: current.obsWsPasswordEncrypted,
  });

  if (Object.prototype.hasOwnProperty.call(config || {}, 'obsWsPassword')) {
    merged.obsWsPasswordEncrypted = encryptSecret(config.obsWsPassword);
  }

  const withKey = await ensureStreamKey(merged);
  saveStoredStreamConfig(withKey);

  return {
    ok: true,
    config: buildPublicStreamConfig(withKey),
  };
}

async function getOrInitStreamKey() {
  const response = await apiService.streamGetOrInitKey(getDeviceKeyOrThrow());
  const streamKey = response && response.data ? response.data.stream_key : '';

  if (!streamKey) {
    throw new Error('服务端未返回 Stream Key');
  }

  const current = getStoredStreamConfig();
  saveStoredStreamConfig({
    ...current,
    streamKey,
  });

  return {
    stream_key: streamKey,
    created_at: response.data.created_at || null,
  };
}

async function resetStreamKey() {
  const response = await apiService.streamResetKey(getDeviceKeyOrThrow());
  const streamKey = response && response.data ? response.data.stream_key : '';

  if (!streamKey) {
    throw new Error('服务端未返回新的 Stream Key');
  }

  const current = getStoredStreamConfig();
  saveStoredStreamConfig({
    ...current,
    streamKey,
  });

  return { stream_key: streamKey };
}

async function getStreamLiveStatus() {
  const config = getStoredStreamConfig();
  if (!config.srsHost || !config.streamKey) return 'idle';

  try {
    const response = await apiService.streamGetStatus(getDeviceKeyOrThrow(), {
      srs_host: normalizeSrsHostForApi(config.srsHost),
      srs_api_port: config.srsApiPort,
      stream_key: config.streamKey,
    });

    return response && response.data && response.data.status
      ? response.data.status
      : 'idle';
  } catch {
    return 'error';
  }
}

async function testSrsConnection(config) {
  try {
    const normalized = normalizeStreamConfig(config);
    const response = await apiService.streamTestSrs(getDeviceKeyOrThrow(), {
      srs_host: normalizeSrsHostForApi(normalized.srsHost),
      srs_rtmp_port: normalized.srsRtmpPort,
      srs_api_port: normalized.srsApiPort,
    });

    const data = response && response.data ? response.data : {};
    return {
      ok: Boolean(data.api_reachable && data.rtmp_reachable),
      srsVersion: data.srs_version || '',
      rtmp_reachable: Boolean(data.rtmp_reachable),
      api_reachable: Boolean(data.api_reachable),
      reason: data.reason || '',
    };
  } catch (error) {
    return {
      ok: false,
      srsVersion: '',
      rtmp_reachable: false,
      api_reachable: false,
      reason: error.message,
    };
  }
}

async function testObsWebSocket(wsConfig = {}) {
  try {
    persistObsConnectionSettings(wsConfig);
    const version = await ensureObsConnection(wsConfig);
    return {
      connected: true,
      obsVersion: version.obsVersion || version.platform || '',
    };
  } catch (error) {
    obsConnection.connected = false;
    return {
      connected: false,
      reason: error.message,
    };
  }
}

async function applyStreamConfigToObs(wsConfig = {}) {
  try {
    const stored = persistObsConnectionSettings(wsConfig);
    const currentConfig = await ensureStreamKey(stored);

    if (!currentConfig.srsHost || !currentConfig.streamKey) {
      return { ok: false, error: '请先完成 SRS 配置并获取 Stream Key' };
    }

    await ensureObsConnection({
      host: stored.obsWsHost,
      port: stored.obsWsPort,
      password: Object.prototype.hasOwnProperty.call(wsConfig, 'password')
        ? String(wsConfig.password || '')
        : decryptSecret(stored.obsWsPasswordEncrypted),
    });

    await obs.call('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: {
        server: buildRtmpServer(currentConfig),
        key: currentConfig.streamKey,
        use_auth: false,
      },
    });

    saveStoredStreamConfig(currentConfig);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function exportObsServiceConfig() {
  const config = await ensureStreamKey(getStoredStreamConfig());
  if (!config.srsHost || !config.streamKey) {
    throw new Error('请先完成 SRS 配置并获取 Stream Key');
  }

  const savedPath = path.join(app.getPath('desktop'), 'neko-obs-stream-config.json');
  const payload = {
    type: 'rtmp_custom',
    settings: {
      server: buildRtmpServer(config),
      key: config.streamKey,
      use_auth: false,
    },
  };

  fs.writeFileSync(savedPath, JSON.stringify(payload, null, 2), 'utf8');
  saveStoredStreamConfig(config);
  return savedPath;
}

async function disconnectObs() {
  if (!obsConnection.connected) return;
  try {
    await obs.disconnect();
  } catch {
    // ignore disconnect failures during shutdown
  } finally {
    obsConnection = {
      connected: false,
      url: '',
      password: '',
    };
  }
}

module.exports = {
  getStreamConfig,
  saveStreamConfig,
  getOrInitStreamKey,
  resetStreamKey,
  getStreamLiveStatus,
  testSrsConnection,
  testObsWebSocket,
  applyStreamConfigToObs,
  exportObsServiceConfig,
  disconnectObs,
};
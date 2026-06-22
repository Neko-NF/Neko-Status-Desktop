const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const PIPE_PATH = '\\\\.\\pipe\\NekoStatusPresenceAgent-v1';
const PROTOCOL_VERSION = 1;
const MIN_AGENT_PROTOCOL_VERSION = 1;
const MAX_AGENT_PROTOCOL_VERSION = 1;
const MAX_FRAME = 64 * 1024;
const MAX_DETECTED_APPS = 12;

function activityProcessName(value = '') {
  let text = String(value || '').trim().toLowerCase();
  if (text.startsWith('win32:')) text = text.slice('win32:'.length);
  text = text.split(/[\\/]/).filter(Boolean).pop() || '';
  if (!text) return '';
  return text.endsWith('.exe') ? text : `${text}.exe`;
}

function normalizeActivityAppKey(value = '') {
  const processName = activityProcessName(value);
  return processName ? `win32:${processName}` : '';
}

function activityDisplayName(value = '') {
  return activityProcessName(value).replace(/\.exe$/i, '').replace(/[-_]+/g, ' ').trim();
}

class ActivityAgentController {
  constructor({ app, configStore, logger = console }) {
    this.app = app;
    this.configStore = configStore;
    this.logger = logger;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.connecting = null;
    this.child = null;
    this.detectedApps = new Map();
    this.lastStatus = { state: 'disabled', available: !!this.getAgentPath() };
    this.statusChanged = null;
  }

  setStatusChangedCallback(callback) {
    this.statusChanged = typeof callback === 'function' ? callback : null;
  }

  publishStatus(status) {
    this.captureDetectedApp(status?.latestDetectedApp);
    this.lastStatus = { ...this.lastStatus, ...(status || {}) };
    try { this.statusChanged?.(this.lastStatus); } catch {}
    return this.lastStatus;
  }

  captureDetectedApp(app) {
    const appKey = normalizeActivityAppKey(app?.appKey || app?.processName);
    if (!appKey) return null;
    const processName = activityProcessName(app?.processName || appKey);
    const detected = {
      appKey,
      processName,
      displayName: String(app?.displayName || activityDisplayName(processName)).trim(),
      stableSinceMs: Number(app?.stableSinceMs) || 0,
      detectorKind: String(app?.detectorKind || ''),
      detected: true,
      source: 'local-detected',
      isHidden: true,
    };
    this.detectedApps.delete(appKey);
    this.detectedApps.set(appKey, detected);
    while (this.detectedApps.size > MAX_DETECTED_APPS) {
      this.detectedApps.delete(this.detectedApps.keys().next().value);
    }
    return detected;
  }

  mergeDetectedApps(serverApps = []) {
    this.captureDetectedApp(this.lastStatus?.latestDetectedApp);
    const merged = new Map();
    for (const rawApp of Array.isArray(serverApps) ? serverApps : []) {
      const appKey = normalizeActivityAppKey(rawApp?.appKey);
      if (!appKey) continue;
      merged.set(appKey, {
        ...rawApp,
        appKey,
        displayName: String(rawApp?.displayName || activityDisplayName(appKey)).trim(),
      });
    }
    for (const [appKey, detected] of this.detectedApps) {
      if (!merged.has(appKey)) merged.set(appKey, { ...detected });
    }
    return Array.from(merged.values());
  }

  getAgentPath() {
    const candidates = [
      path.join(process.resourcesPath || '', 'NekoPresenceAgent.exe'),
      path.join(this.app.getAppPath(), '..', 'NekoPresenceAgent.exe'),
      path.join(__dirname, '..', '..', 'build', 'native', 'NekoPresenceAgent.exe'),
      path.join(__dirname, '..', '..', 'native', 'presence-agent', 'target', 'release', 'NekoPresenceAgent.exe'),
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
  }

  isEnabled() {
    return this.configStore.get('enableExperimentalFeatures') === true
      && this.configStore.get('enableActivityFeature') === true;
  }

  snapshotProfileFields() {
    const incognitoScope = this.configStore.get('incognitoScope') || 'screenshot';
    const screenshotPrivacyActive = this.configStore.get('enableIncognito') === true
      && (incognitoScope === 'screenshot' || incognitoScope === 'both');
    const blockedProcesses = screenshotPrivacyActive
      ? (Array.isArray(this.configStore.get('privacyRules')) ? this.configStore.get('privacyRules') : [])
          .map(activityProcessName)
          .filter(Boolean)
      : [];
    return {
      snapshotEnabled: this.configStore.get('enableActivitySnapshots') === true,
      snapshotMaxBytes: 512 * 1024,
      snapshotMaxWidth: 640,
      snapshotMaxHeight: 360,
      snapshotCacheDir: path.join(this.app.getPath('userData'), 'activity-snapshots'),
      snapshotPrivacyBlockAll: screenshotPrivacyActive && this.configStore.get('blurAllScreenshots') === true,
      snapshotBlockedProcesses: [...new Set(blockedProcesses)],
    };
  }

  async ensureRunning() {
    if (!this.isEnabled()) return { ok: false, code: 'ACTIVITY_DISABLED' };
    try {
      await this.connect();
      return { ok: true, alreadyRunning: true };
    } catch {}
    const executable = this.getAgentPath();
    if (!executable) return { ok: false, code: 'AGENT_MISSING', message: 'NekoPresenceAgent.exe 不存在，请重新安装或构建' };
    try {
      this.child = spawn(executable, ['--embedded'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      this.child.unref();
      for (const delay of [150, 250, 500, 1000, 1500, 2000]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          await this.connect();
          return { ok: true, started: true };
        } catch {}
      }
      return { ok: false, code: 'AGENT_START_TIMEOUT', message: '后台代理启动超时' };
    } catch (error) {
      return { ok: false, code: 'AGENT_START_FAILED', message: error.message };
    }
  }

  connect() {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = net.createConnection(PIPE_PATH);
      const onError = (error) => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        socket.on('error', (error) => this.handleDisconnect(error));
        socket.on('close', () => this.handleDisconnect());
        socket.on('data', (chunk) => this.handleData(chunk));
        this.socket = socket;
        resolve(socket);
      });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  handleDisconnect(error) {
    if (error) this.logger.warn('[ActivityAgent] pipe disconnected:', error.message);
    this.socket = null;
    this.publishStatus({
      state: this.isEnabled() ? 'reconnecting' : 'disabled',
      connection: 'disconnected',
    });
    while (this.pending.length) {
      this.pending.shift().reject(new Error('后台代理连接已断开'));
    }
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (!length || length > MAX_FRAME) {
        this.socket?.destroy(new Error('Invalid Activity Agent frame'));
        return;
      }
      if (this.buffer.length < length + 4) return;
      const payload = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      const pending = this.pending.shift();
      if (!pending) continue;
      try { pending.resolve(JSON.parse(payload.toString('utf8'))); }
      catch (error) { pending.reject(error); }
    }
  }

  async command(command, payload = {}) {
    const socket = await this.connect();
    const body = Buffer.from(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, command, payload }), 'utf8');
    if (body.length > MAX_FRAME) throw new Error('后台代理命令超过 64KiB');
    const frame = Buffer.allocUnsafe(body.length + 4);
    frame.writeUInt32LE(body.length, 0);
    body.copy(frame, 4);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.pending.findIndex((item) => item.resolve === wrappedResolve);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new Error('后台代理响应超时'));
      }, 5000);
      const wrappedResolve = (value) => { clearTimeout(timeout); resolve(value); };
      const wrappedReject = (error) => { clearTimeout(timeout); reject(error); };
      this.pending.push({ resolve: wrappedResolve, reject: wrappedReject });
      socket.write(frame, (error) => {
        if (error) wrappedReject(error);
      });
    });
  }

  async activityRequest(pathname, { method = 'GET', body, query } = {}) {
    const token = this.configStore.get('authToken');
    if (!token) throw Object.assign(new Error('请先登录'), { code: 'UNAUTHORIZED' });
    const url = new URL(pathname, this.configStore.getServerUrl());
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.success === false) {
      const error = new Error(json.error?.message || `Activity API HTTP ${response.status}`);
      error.code = json.error?.code || 'ACTIVITY_API_ERROR';
      error.status = response.status;
      throw error;
    }
    return json.data ?? json;
  }

  async provision() {
    const ready = await this.ensureRunning();
    if (!ready.ok) return ready;
    const user = this.configStore.get('authUser') || {};
    if (!user.id) return { ok: false, code: 'UNAUTHORIZED', message: '请先登录' };
    try {
      const existingActivityDeviceId = Number(this.configStore.get('activityDeviceId'));
      const enrollBody = {
        capabilities: ['presence', 'events', 'tray', 'snapshots'],
        deviceName: this.configStore.get('activityDeviceName') || `${os.hostname()} 的活动提醒`,
      };
      if (Number.isInteger(existingActivityDeviceId) && existingActivityDeviceId > 0) {
        enrollBody.deviceId = existingActivityDeviceId;
      }
      const enrolled = await this.activityRequest('/api/activity/agent/enroll', {
        method: 'POST',
        body: enrollBody,
      });
      const activityDeviceId = Number(enrolled.device?.id);
      const activityDeviceName = enrolled.device?.name || enrollBody.deviceName;
      if (Number.isInteger(activityDeviceId) && activityDeviceId > 0) {
        this.configStore.setMany({
          activityDeviceId,
          activityDeviceName,
        });
      }
      const profile = {
        protocolVersion: PROTOCOL_VERSION,
        serverUrl: this.configStore.getServerUrl(),
        deviceId: activityDeviceId,
        deviceName: activityDeviceName,
        userId: Number(user.id),
        mainExecutable: this.app.getPath('exe'),
        featureEnabled: true,
        publishEnabled: this.configStore.get('enableActivityPublishing') === true,
        backgroundEnabled: this.configStore.get('enableActivityBackground') === true,
        autoStartEnabled: this.configStore.get('enableActivityAutoStart') !== false,
        notificationsEnabled: this.configStore.get('enableNotification') !== false
          && this.configStore.get('doNotDisturb') !== true,
        ...this.snapshotProfileFields(),
        agentToken: enrolled.agentToken,
      };
      const result = await this.command('provision', profile);
      if (!result.ok) return { ok: false, code: result.data?.code || 'PROVISION_FAILED', message: result.data?.message || '代理配置失败' };
      const claimed = await this.command('claim_tray');
      const status = this.publishStatus({ state: 'embedded', ...result.data, trayClaimed: claimed.ok === true });
      return { ok: true, data: status };
    } catch (error) {
      return { ok: false, code: error.code || 'PROVISION_FAILED', message: error.message };
    }
  }

  async syncProfile() {
    const ready = await this.ensureRunning();
    if (!ready.ok) return ready;
    const user = this.configStore.get('authUser') || {};
    const profile = {
      protocolVersion: PROTOCOL_VERSION,
      serverUrl: this.configStore.getServerUrl(),
      deviceId: Number(this.configStore.get('activityDeviceId')) || 0,
      deviceName: this.configStore.get('activityDeviceName') || '',
      userId: Number(user.id) || 0,
      mainExecutable: this.app.getPath('exe'),
      featureEnabled: this.isEnabled(),
      publishEnabled: this.configStore.get('enableActivityPublishing') === true,
      backgroundEnabled: this.configStore.get('enableActivityBackground') === true,
      autoStartEnabled: this.configStore.get('enableActivityAutoStart') !== false,
      notificationsEnabled: this.configStore.get('enableNotification') !== false
        && this.configStore.get('doNotDisturb') !== true,
      ...this.snapshotProfileFields(),
    };
    const result = await this.command('reload_config', profile);
    return result.ok
      ? { ok: true, data: this.publishStatus({ state: 'embedded', ...result.data }) }
      : { ok: false, ...result.data };
  }

  async getStatus() {
    if (!this.isEnabled()) return this.publishStatus({ state: 'disabled', available: !!this.getAgentPath() });
    const ready = await this.ensureRunning();
    if (!ready.ok) return this.publishStatus({ state: 'error', available: !!this.getAgentPath(), ...ready });
    const result = await this.command('get_status');
    const protocolVersion = Number(result.data?.protocolVersion);
    if (result.ok && (protocolVersion < MIN_AGENT_PROTOCOL_VERSION || protocolVersion > MAX_AGENT_PROTOCOL_VERSION)) {
      return this.publishStatus({
        state: 'error',
        code: 'AGENT_PROTOCOL_MISMATCH',
        message: `代理协议 v${protocolVersion || '?'} 不受当前客户端支持`,
        protocolVersion,
      });
    }
    return result.ok
      ? this.publishStatus({ state: result.data.paused ? 'paused' : 'embedded', available: true, ...result.data })
      : this.publishStatus({ state: 'error', ...result.data });
  }

  async claimTray() {
    const ready = await this.ensureRunning();
    if (!ready.ok) return ready;
    const result = await this.command('claim_tray');
    if (result.ok) this.publishStatus({ state: this.lastStatus.paused ? 'paused' : 'embedded', trayClaimed: true });
    return result;
  }

  async pause() {
    const result = await this.command('pause');
    if (result.ok) this.publishStatus({ state: 'paused', ...result.data });
    return result;
  }

  async resume() {
    const result = await this.command('resume');
    if (result.ok) this.publishStatus({ state: 'embedded', ...result.data });
    return result;
  }

  async releaseForAppExit({ exitAll = false, reason = 'session' } = {}) {
    if (!this.socket || this.socket.destroyed) return;
    try {
      if (exitAll || !this.configStore.get('enableActivityBackground')) {
        await this.command('shutdown', { reason });
      } else {
        await this.command('release_tray');
        this.publishStatus({ state: 'background', trayClaimed: false });
      }
    } catch {}
    this.socket?.end();
    this.socket = null;
  }

  shutdownForUpdateSync() {
    const executable = this.getAgentPath();
    if (!executable) return { ok: true, skipped: true };
    const result = spawnSync(executable, ['--shutdown-for-update'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 25000,
    });
    this.socket?.destroy();
    this.socket = null;
    return result.error
      ? { ok: false, message: result.error.message }
      : { ok: result.status === 0, status: result.status };
  }

  async revoke(reason = 'disable') {
    const deviceId = Number(this.configStore.get('activityDeviceId')) || undefined;
    try { await this.activityRequest('/api/activity/agent/enroll', { method: 'DELETE', body: { deviceId } }); } catch {}
    try { await this.command('shutdown', { reason }); } catch {}
    this.detectedApps.clear();
    this.publishStatus({ state: 'disabled', connection: 'offline', provisioned: false, trayClaimed: false });
  }
}

module.exports = {
  ActivityAgentController,
  activityProcessName,
  normalizeActivityAppKey,
  activityDisplayName,
  PIPE_PATH,
  PROTOCOL_VERSION,
  MIN_AGENT_PROTOCOL_VERSION,
  MAX_AGENT_PROTOCOL_VERSION,
};

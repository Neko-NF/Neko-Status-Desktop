const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const PIPE_PATH = '\\\\.\\pipe\\NekoStatusPresenceAgent-v1';
const DEV_PIPE_PATH = '\\\\.\\pipe\\NekoStatusPresenceAgent-v1-dev';
const PROTOCOL_VERSION = 1;
const MIN_AGENT_PROTOCOL_VERSION = 1;
const MAX_AGENT_PROTOCOL_VERSION = 1;
const MAX_FRAME = 64 * 1024;
const MAX_DETECTED_APPS = 12;
const COMMAND_TIMEOUT_MS = 5000;
const START_COOLDOWN_MS = 2000;
const RECONNECT_DELAYS_MS = [1500, 3000, 5000, 10000, 30000, 60000];
const ACTIVITY_BINDINGS_VERSION = 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function activityError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = options.httpStatus;
  error.httpStatus = options.httpStatus;
  error.transient = options.transient === true;
  return error;
}

function publicActivityError(error, fallbackCode = 'ACTIVITY_FAILED') {
  if (!error) return null;
  return {
    code: String(error.code || fallbackCode),
    message: String(error.message || '活动提醒服务暂不可用'),
    httpStatus: Number(error.httpStatus || error.status) || null,
    transient: error.transient === true,
    atMs: Number(error.atMs) || Date.now(),
  };
}

function validateActivityEndpointData(pathname, method, data, envelope) {
  const verb = String(method || 'GET').toUpperCase();
  if (pathname === '/api/activity/agent/enroll' && verb === 'POST') {
    return isObject(data)
      && isObject(data.device)
      && Number(data.device.id) > 0
      && typeof data.agentToken === 'string'
      && data.agentToken.length > 0;
  }
  if (verb === 'GET' && pathname === '/api/activity/follows') return Array.isArray(data?.follows);
  if (verb === 'GET' && pathname === '/api/activity/me/privacy') return typeof data?.visibility === 'string';
  if (verb === 'GET' && pathname === '/api/activity/me/apps') return Array.isArray(data?.apps);
  if (verb === 'GET' && pathname === '/api/activity/me/followers') return Array.isArray(data?.followers);
  if (verb === 'GET' && pathname === '/api/activity/blocks') return Array.isArray(data?.blocks);
  if (verb === 'GET' && pathname === '/api/activity/users/search') {
    return Array.isArray(data?.users) || Array.isArray(data?.results);
  }
  if (envelope?.success === true && Object.prototype.hasOwnProperty.call(envelope, 'data')) return true;
  return isObject(data) && Object.keys(data).length > 0;
}

function isCoreActivityEndpoint(pathname) {
  const normalized = String(pathname || '').split('?')[0];
  return normalized === '/api/activity/agent/enroll'
    || normalized === '/api/activity/agent/bootstrap'
    || normalized === '/api/activity/presence'
    || normalized === '/api/activity/events'
    || normalized === '/api/activity/events/stream';
}

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
  constructor({ app, configStore, isDevRuntime, logger = console, spawnSyncImpl = spawnSync }) {
    this.app = app;
    // A renamed Electron development executable can report app.isPackaged=true.
    // Keep the runtime channel explicit so development can never fall back to the
    // production pipe, mutex, profile or autorun entry.
    this.isDevRuntime = typeof isDevRuntime === 'boolean'
      ? isDevRuntime
      : app?.isPackaged === false;
    this.runtimeChannel = this.isDevRuntime ? 'dev' : 'stable';
    this.configStore = configStore;
    this.logger = logger;
    this.spawnSync = spawnSyncImpl;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.commandTail = Promise.resolve();
    this.connecting = null;
    this.starting = null;
    this.reconnectTimer = null;
    this.reconnectDelayMs = null;
    this.reconnectAttempt = 0;
    this.reconnectGeneration = 0;
    this.lastStartAttemptAt = 0;
    this.startProbeDelaysMs = [150, 250, 500, 1000, 1500, 2000];
    this.existingChildProbeDelaysMs = [250, 500, 1000, 1500, 2000];
    this.shuttingDown = false;
    this.child = null;
    this.detectedApps = new Map();
    this.lastStatus = {
      state: 'disabled',
      connection: 'offline',
      available: !!this.getAgentPath(),
    };
    this.revision = 0;
    this.lastSnapshot = null;
    this.lastApiError = null;
    this.apiErrors = new Map();
    this.privacyPendingRevision = 0;
    this.privacyReconcileInFlight = new Map();
    this.provisionGeneration = 0;
    this.provisionInFlight = new Map();
    this.provisionQueues = new Map();
    this.revoking = false;
    this.revokeInFlight = null;
    this.activitySessionCacheResetHandler = null;
    this.sessionIdentityKey = this.currentSessionIdentityKey();
    this.identityRevision = 1;
    this.statusChanged = null;
    this.activityInstallationIdWasReplaced = false;
    this.activityInstallationId = this.ensureActivityInstallationId();
    if (Number(this.configStore.get('activityDeviceId')) > 0) this.markActivityOnboardingSeen();
  }

  setStatusChangedCallback(callback) {
    this.statusChanged = typeof callback === 'function' ? callback : null;
  }

  setActivitySessionCacheResetHandler(callback) {
    this.activitySessionCacheResetHandler = typeof callback === 'function' ? callback : null;
  }

  resetActivitySessionCache(options = {}) {
    try {
      this.activitySessionCacheResetHandler?.(options);
    } catch (error) {
      this.logger.warn('[ActivityAgent] failed to reset Activity session cache:', error.message);
    }
  }

  publishStatus(status) {
    this.captureDetectedApp(status?.latestDetectedApp);
    this.lastStatus = { ...this.lastStatus, ...(status || {}) };
    const snapshot = this.createSnapshot(this.lastStatus, { increment: true });
    try { this.statusChanged?.(snapshot); } catch {}
    return snapshot;
  }

  getPipePath() {
    return this.isDevRuntime ? DEV_PIPE_PATH : PIPE_PATH;
  }

  getSettings() {
    return {
      enabled: this.configStore.get('enableActivityFeature') === true,
      publishing: this.configStore.get('enableActivityPublishing') === true,
      snapshots: this.configStore.get('enableActivitySnapshots') === true,
      background: this.configStore.get('enableActivityBackground') === true,
      autoStart: this.configStore.get('enableActivityAutoStart') !== false,
    };
  }

  markActivityOnboardingSeen() {
    if (this.configStore.get('activityOnboardingSeen') === true) return;
    if (typeof this.configStore.set === 'function') this.configStore.set('activityOnboardingSeen', true);
    else if (typeof this.configStore.setMany === 'function') this.configStore.setMany({ activityOnboardingSeen: true });
  }

  ensureActivityInstallationId() {
    const stored = String(this.configStore.get('activityInstallationId') || '').trim();
    if (UUID_PATTERN.test(stored)) return stored.toLowerCase();
    // An invalid, non-empty value means a previously established installation
    // identity was lost or corrupted. Bindings created for that identity must
    // never be attached to the replacement UUID.
    this.activityInstallationIdWasReplaced = stored.length > 0;
    const installationId = crypto.randomUUID().toLowerCase();
    if (typeof this.configStore.set === 'function') {
      this.configStore.set('activityInstallationId', installationId);
    } else if (typeof this.configStore.setMany === 'function') {
      this.configStore.setMany({ activityInstallationId: installationId });
    }
    return installationId;
  }

  defaultActivityDeviceName() {
    return `${os.hostname()} 的活动提醒${this.isDevRuntime ? '（开发版）' : ''}`;
  }

  normalizeActivityDeviceNameForRuntime(value) {
    const name = String(value || '').trim();
    if (!name) return this.defaultActivityDeviceName();

    // Before runtime channels were isolated, development inherited the same
    // generated name as stable builds. Upgrade only that exact local default;
    // every other value may be a user/server-confirmed custom name and must be
    // preserved verbatim.
    const legacyGeneratedName = `${os.hostname()} 的活动提醒`;
    if (this.isDevRuntime && name === legacyGeneratedName) {
      return `${legacyGeneratedName}（开发版）`;
    }
    return name;
  }

  canUseUnscopedLegacyActivityDevice(identity = this.provisionIdentity()) {
    // A bare activityDeviceId predates channel metadata. Let stable keep its
    // historical migration path, but never let development claim or revoke an
    // ID that may still own a stable credential. Development may only reuse a
    // binding found under its explicit server/user/::dev key above.
    return (identity?.runtimeChannel || this.runtimeChannel) === 'stable';
  }

  activityBindingKey({ serverUrl, userId, runtimeChannel = this.runtimeChannel } = {}) {
    const normalizedServerUrl = String(serverUrl || '').replace(/\/+$/, '');
    if (!normalizedServerUrl || userId === undefined || userId === null) return '';
    return `${normalizedServerUrl}::${String(userId)}::${runtimeChannel}`;
  }

  readActivityDeviceBindings() {
    const stored = this.configStore.get('activityDeviceBindings');
    if (!isObject(stored) || !isObject(stored.entries)) {
      return { version: ACTIVITY_BINDINGS_VERSION, entries: {} };
    }
    return {
      version: ACTIVITY_BINDINGS_VERSION,
      entries: { ...stored.entries },
    };
  }

  writeActivityDeviceBindings(bindings) {
    const normalized = {
      version: ACTIVITY_BINDINGS_VERSION,
      entries: { ...(bindings?.entries || {}) },
    };
    if (typeof this.configStore.set === 'function') {
      this.configStore.set('activityDeviceBindings', normalized);
    } else if (typeof this.configStore.setMany === 'function') {
      this.configStore.setMany({ activityDeviceBindings: normalized });
    }
  }

  getActivityDeviceBinding(identity = this.provisionIdentity(), { migrateLegacy = true } = {}) {
    if (!identity) return null;
    const key = identity.bindingKey || this.activityBindingKey(identity);
    if (!key) return null;
    const bindings = this.readActivityDeviceBindings();
    const stored = bindings.entries[key];
    const storedDeviceId = Number(stored?.deviceId);
    if (Number.isInteger(storedDeviceId) && storedDeviceId > 0) {
      const storedInstallationId = String(stored.installationId || '').trim().toLowerCase();
      const currentInstallationId = String(identity.installationId || this.activityInstallationId).toLowerCase();
      if (storedInstallationId && storedInstallationId !== currentInstallationId) {
        delete bindings.entries[key];
        this.writeActivityDeviceBindings(bindings);
        if (String(this.configStore.get('activityBoundUserId')) === String(identity.userId)
          && Number(this.configStore.get('activityDeviceId')) === storedDeviceId) {
          this.configStore.setMany({ activityDeviceId: null, activityDeviceName: '' });
        }
        return null;
      }
      if (!storedInstallationId && this.activityInstallationIdWasReplaced) {
        delete bindings.entries[key];
        this.writeActivityDeviceBindings(bindings);
        if (String(this.configStore.get('activityBoundUserId')) === String(identity.userId)
          && Number(this.configStore.get('activityDeviceId')) === storedDeviceId) {
          this.configStore.setMany({ activityDeviceId: null, activityDeviceName: '' });
        }
        return null;
      }
      if (!storedInstallationId) {
        this.storeActivityDeviceBinding(identity, stored);
      }
      return {
        deviceId: storedDeviceId,
        deviceName: String(stored.deviceName || ''),
      };
    }
    if (!migrateLegacy) return null;

    if (this.activityInstallationIdWasReplaced) return null;
    if (!this.canUseUnscopedLegacyActivityDevice(identity)) return null;

    const legacyDeviceId = Number(this.configStore.get('activityDeviceId'));
    const boundUserId = this.configStore.get('activityBoundUserId');
    const boundMatches = boundUserId === undefined || boundUserId === null
      || String(boundUserId) === String(identity.userId);
    if (!Number.isInteger(legacyDeviceId) || legacyDeviceId <= 0 || !boundMatches) return null;
    const migrated = {
      deviceId: legacyDeviceId,
      deviceName: String(this.configStore.get('activityDeviceName') || ''),
    };
    this.storeActivityDeviceBinding(identity, migrated);
    return migrated;
  }

  storeActivityDeviceBinding(identity, binding) {
    const key = identity?.bindingKey || this.activityBindingKey(identity);
    const deviceId = Number(binding?.deviceId);
    if (!key || !Number.isInteger(deviceId) || deviceId <= 0) return false;
    const bindings = this.readActivityDeviceBindings();
    bindings.entries[key] = {
      serverUrl: identity.serverUrl,
      userId: String(identity.userId),
      runtimeChannel: identity.runtimeChannel || this.runtimeChannel,
      installationId: identity.installationId || this.activityInstallationId,
      deviceId,
      deviceName: String(binding.deviceName || ''),
      updatedAtMs: Date.now(),
    };
    this.writeActivityDeviceBindings(bindings);
    return true;
  }

  removeActivityDeviceBinding(identity) {
    const key = identity?.bindingKey || this.activityBindingKey(identity);
    if (!key) return false;
    const bindings = this.readActivityDeviceBindings();
    if (!Object.prototype.hasOwnProperty.call(bindings.entries, key)) return false;
    delete bindings.entries[key];
    this.writeActivityDeviceBindings(bindings);
    return true;
  }

  privacyIdentity({ userId, serverUrl } = {}) {
    const resolvedUserId = userId ?? this.configStore.get('authUser')?.id;
    const resolvedServerUrl = String(serverUrl || this.configStore.getServerUrl?.() || '').replace(/\/+$/, '');
    if (resolvedUserId === undefined || resolvedUserId === null || !resolvedServerUrl) return null;
    return {
      key: `${resolvedServerUrl}::${String(resolvedUserId)}`,
      userId: String(resolvedUserId),
      serverUrl: resolvedServerUrl,
    };
  }

  readSnapshotPrivacyPending() {
    const stored = this.configStore.get('activitySnapshotPrivacyPending');
    if (!isObject(stored) || !isObject(stored.entries)) return { version: 1, entries: {} };
    return { version: 1, entries: { ...stored.entries } };
  }

  writeSnapshotPrivacyPending(pending) {
    if (typeof this.configStore.set === 'function') {
      this.configStore.set('activitySnapshotPrivacyPending', pending);
    } else if (typeof this.configStore.setMany === 'function') {
      this.configStore.setMany({ activitySnapshotPrivacyPending: pending });
    }
  }

  markSnapshotPrivacyPending(shareSnapshots, identityOptions = {}) {
    const identity = this.privacyIdentity(identityOptions);
    if (!identity) return null;
    const pending = this.readSnapshotPrivacyPending();
    const entry = {
      userId: identity.userId,
      serverUrl: identity.serverUrl,
      shareSnapshots: shareSnapshots === true,
      updatedAtMs: Date.now(),
      revision: `${Date.now()}-${++this.privacyPendingRevision}`,
    };
    pending.entries[identity.key] = entry;
    this.writeSnapshotPrivacyPending(pending);
    return entry;
  }

  clearSnapshotPrivacyPending({ expectedRevision, ...identityOptions } = {}) {
    const identity = this.privacyIdentity(identityOptions);
    if (!identity) return false;
    const pending = this.readSnapshotPrivacyPending();
    const current = pending.entries[identity.key];
    if (!current || (expectedRevision && current.revision !== expectedRevision)) return false;
    delete pending.entries[identity.key];
    this.writeSnapshotPrivacyPending(pending);
    return true;
  }

  async reconcileSnapshotPrivacy() {
    const identity = this.privacyIdentity();
    const authToken = this.configStore.get('authToken');
    if (!identity || !authToken) return { ok: true, skipped: true };
    const existing = this.privacyReconcileInFlight.get(identity.key);
    if (existing) return existing;
    const pending = this.readSnapshotPrivacyPending();
    const entry = pending.entries[identity.key];
    if (!entry) return { ok: true, skipped: true };
    const operation = (async () => {
      try {
        await this.activityRequest('/api/activity/me/privacy', {
          method: 'PUT',
          body: { shareSnapshots: entry.shareSnapshots === true },
          authContext: { authToken, serverUrl: identity.serverUrl },
          affectHealth: false,
        });
        this.clearSnapshotPrivacyPending({
          userId: identity.userId,
          serverUrl: identity.serverUrl,
          expectedRevision: entry.revision,
        });
        return { ok: true, reconciled: true };
      } catch (error) {
        return { ok: false, code: error.code || 'ACTIVITY_PRIVACY_RECONCILE_FAILED', message: error.message };
      }
    })();
    this.privacyReconcileInFlight.set(identity.key, operation);
    try {
      return await operation;
    } finally {
      if (this.privacyReconcileInFlight.get(identity.key) === operation) {
        this.privacyReconcileInFlight.delete(identity.key);
      }
    }
  }

  provisionIdentity() {
    const user = this.configStore.get('authUser') || {};
    const serverUrl = String(this.configStore.getServerUrl?.() || '').replace(/\/+$/, '');
    const authToken = this.configStore.get('authToken') || '';
    if (user.id === undefined || user.id === null || !serverUrl || !authToken) return null;
    const runtimeChannel = this.runtimeChannel;
    const bindingKey = this.activityBindingKey({ serverUrl, userId: user.id, runtimeChannel });
    return {
      key: bindingKey,
      bindingKey,
      userId: String(user.id),
      boundUserId: user.id,
      numericUserId: Number(user.id),
      serverUrl,
      authToken,
      installationId: this.activityInstallationId,
      runtimeChannel,
    };
  }

  currentSessionIdentityKey() {
    const userId = this.configStore.get('authUser')?.id;
    const serverUrl = String(this.configStore.getServerUrl?.() || '').replace(/\/+$/, '');
    const authenticated = !!this.configStore.get('authToken');
    if (!authenticated || userId === undefined || userId === null || !serverUrl) return null;
    return `${serverUrl}::${String(userId)}::${this.runtimeChannel}`;
  }

  refreshSessionIdentityRevision() {
    const current = this.currentSessionIdentityKey();
    if (current !== this.sessionIdentityKey) {
      this.sessionIdentityKey = current;
      this.identityRevision += 1;
    }
    return this.identityRevision;
  }

  invalidateSessionIdentity() {
    this.sessionIdentityKey = this.currentSessionIdentityKey();
    this.identityRevision += 1;
    return this.identityRevision;
  }

  invalidateProvisionGeneration() {
    this.provisionGeneration += 1;
    this.provisionInFlight.clear();
  }

  async settleProvisionQueues(identityKeys) {
    const selectedKeys = identityKeys
      ? new Set(Array.isArray(identityKeys) ? identityKeys.filter(Boolean) : [identityKeys])
      : null;
    const pending = Array.from(this.provisionQueues.entries())
      .filter(([key]) => !selectedKeys || selectedKeys.has(key))
      .map(([, promise]) => promise);
    if (pending.length) await Promise.allSettled(pending);
  }

  provisionStillCurrent(identity, generation) {
    const current = this.provisionIdentity();
    return generation === this.provisionGeneration
      && current?.key === identity.key
      && current?.authToken === identity.authToken
      && this.isEnabled();
  }

  createSnapshot(agent = this.lastStatus, { increment = false } = {}) {
    const now = Date.now();
    this.refreshSessionIdentityRevision();
    const settings = this.getSettings();
    const enabled = settings.enabled && this.configStore.get('enableExperimentalFeatures') === true;
    const user = this.configStore.get('authUser') || null;
    const authenticated = !!this.configStore.get('authToken') && !!user?.id;
    const raw = isObject(agent) ? agent : {};
    const nativeHealth = isObject(raw.health) ? raw.health : {};
    const nativeReceiver = isObject(nativeHealth.receiver) ? nativeHealth.receiver : {};
    const nativePublisher = isObject(nativeHealth.publisher) ? nativeHealth.publisher : {};
    const coreApiError = Array.from(this.apiErrors.entries())
      .filter(([pathname]) => isCoreActivityEndpoint(pathname))
      .map(([, error]) => error)
      .at(-1) || null;
    const apiError = publicActivityError(coreApiError);
    const localConnected = !!this.socket && !this.socket.destroyed;
    let lifecycle = typeof nativeHealth.lifecycle === 'string'
      ? nativeHealth.lifecycle
      : (localConnected ? 'embedded' : 'starting');
    if (!enabled) lifecycle = 'disabled';
    else if (raw.state === 'paused' || raw.paused) lifecycle = 'paused';
    else if (raw.state === 'background') lifecycle = 'background';
    else if (raw.state === 'stopping') lifecycle = 'stopping';
    else if (raw.state === 'error') lifecycle = 'error';
    const localIpc = {
      state: !enabled ? 'disconnected' : (localConnected ? 'connected' : (this.reconnectTimer || this.starting ? 'reconnecting' : 'disconnected')),
      attempt: Number(this.reconnectAttempt) || 0,
      sinceMs: Number(nativeHealth.localIpc?.sinceMs) || null,
      nextRetryAtMs: Number(this.nextReconnectAtMs) || null,
      lastError: publicActivityError(nativeHealth.localIpc?.lastError || (raw.code?.startsWith?.('AGENT_') ? raw : null)),
    };
    const nativeProvisionState = nativeHealth.provision?.state;
    const provisioned = raw.provisioned === true
      || nativeProvisionState === 'provisioned'
      || nativeProvisionState === 'ready';
    const configuredDevice = Number(this.configStore.get('activityDeviceId')) > 0
      || nativeHealth.provision?.deviceConfigured === true;
    const provision = {
      state: apiError?.code === 'CREDENTIAL_INVALID'
        ? 'needs_login'
        : (!authenticated
        ? 'needs_login'
        : (nativeProvisionState === 'credential_error'
          ? 'credential_error'
          : (nativeProvisionState === 'failed' ? 'failed' : (provisioned ? 'ready' : 'needs_enroll')))),
      deviceConfigured: configuredDevice,
      boundToCurrentUser: provisioned
        ? (nativeHealth.provision?.boundToCurrentUser !== false)
        : false,
      everConfigured: this.configStore.get('activityOnboardingSeen') === true || configuredDevice,
    };
    const legacyConnection = String(raw.connection || 'idle');
    let receiverState = nativeReceiver.state;
    if (!receiverState) {
      receiverState = ({
        online: 'connected',
        polling: 'polling',
        reconnecting: 'retrying',
        unprovisioned: 'credential_error',
        offline: 'disabled',
        idle: enabled ? 'connecting' : 'disabled',
      })[legacyConnection] || (enabled ? 'connecting' : 'disabled');
    }
    if (apiError?.code === 'CREDENTIAL_INVALID') receiverState = 'credential_error';
    if (['API_REDIRECTED', 'API_NOT_DEPLOYED', 'API_INCOMPATIBLE', 'FEATURE_DISABLED'].includes(apiError?.code)) receiverState = 'unsupported';
    if (!enabled) receiverState = 'disabled';
    else if (lifecycle === 'paused') receiverState = 'paused';
    const receiver = {
      state: receiverState,
      transport: nativeReceiver.transport || (receiverState === 'polling' ? 'polling' : (receiverState === 'connected' ? 'sse' : null)),
      lastConnectedAtMs: Number(nativeReceiver.lastConnectedAtMs) || null,
      lastHeartbeatAtMs: Number(nativeReceiver.lastHeartbeatAtMs) || null,
      lastEventAtMs: Number(nativeReceiver.lastEventAtMs) || null,
      consecutiveFailures: Number(nativeReceiver.consecutiveFailures) || 0,
      nextRetryAtMs: Number(nativeReceiver.nextRetryAtMs) || null,
      lastError: publicActivityError(nativeReceiver.lastError) || apiError,
    };
    let publisherState = nativePublisher.state;
    if (!publisherState) {
      if (!enabled || !settings.publishing) publisherState = 'disabled';
      else if (legacyConnection === 'online') publisherState = 'online';
      else if (legacyConnection === 'reconnecting') publisherState = 'retrying';
      else publisherState = 'idle';
    }
    if (apiError?.code === 'CREDENTIAL_INVALID') publisherState = 'credential_error';
    if (['API_REDIRECTED', 'API_NOT_DEPLOYED', 'API_INCOMPATIBLE', 'FEATURE_DISABLED'].includes(apiError?.code)) publisherState = 'unsupported';
    if (!enabled || !settings.publishing) publisherState = 'disabled';
    else if (lifecycle === 'paused') publisherState = 'paused';
    const publisher = {
      state: publisherState,
      lastSuccessAtMs: Number(nativePublisher.lastSuccessAtMs) || null,
      // `currentApp` is the server-confirmed public Presence.  A locally detected
      // foreground app can still be hidden by the user's server-side catalog
      // settings, so keep that signal separate instead of claiming it is shared.
      currentApp: isObject(raw.health?.publisher)
        ? (nativePublisher.currentApp || null)
        : (raw.latestDetectedApp || null),
      detectedApp: nativePublisher.detectedApp || raw.latestDetectedApp || null,
      lastError: publicActivityError(nativePublisher.lastError) || apiError,
    };
    let overall = 'healthy';
    if (!enabled) overall = 'disabled';
    else if (!authenticated) overall = 'needs_login';
    else if (provision.state === 'needs_login') overall = 'needs_login';
    else if (lifecycle === 'paused') overall = 'paused';
    else if (lifecycle === 'error') overall = 'needs_action';
    else if (localIpc.state !== 'connected') overall = lifecycle === 'error' ? 'needs_action' : 'starting';
    else if (['API_REDIRECTED', 'API_NOT_DEPLOYED', 'API_INCOMPATIBLE', 'FEATURE_DISABLED'].includes(apiError?.code)) overall = 'unavailable';
    else if (apiError?.code === 'API_TRANSIENT' && provision.state !== 'ready') overall = 'unavailable';
    else if (provision.state === 'credential_error' || provision.state === 'failed') overall = 'needs_action';
    else if (provision.state !== 'ready') overall = 'needs_enroll';
    else if (receiver.state === 'unsupported' || publisher.state === 'unsupported') overall = 'unavailable';
    else if (receiver.state === 'credential_error' || publisher.state === 'credential_error') overall = 'needs_action';
    else if (receiver.state === 'polling') overall = 'degraded';
    else if (['connecting', 'retrying'].includes(receiver.state) || publisher.state === 'retrying') overall = 'recovering';
    const effectiveSettings = {
      enabled,
      publishing: enabled && settings.publishing,
      snapshots: enabled && settings.publishing && settings.snapshots,
      background: enabled && settings.background,
      autoStart: enabled && settings.background && settings.autoStart,
    };
    if (increment || !this.lastSnapshot) this.revision += 1;
    const snapshot = {
      ...raw,
      schemaVersion: 2,
      revision: this.revision,
      identityRevision: this.identityRevision,
      observedAtMs: now,
      settings,
      effectiveSettings,
      health: { overall, lifecycle, localIpc, provision, receiver, publisher },
      agent: { ...raw },
      state: raw.state || lifecycle,
      connection: raw.connection || (receiver.state === 'connected' ? 'online' : receiver.state),
    };
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  getSnapshot() {
    return this.createSnapshot(this.lastStatus, { increment: false });
  }

  refreshSnapshot() {
    return this.publishStatus(this.lastStatus);
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

  async ensureRunning({ allowAfterShutdown = false } = {}) {
    if (!this.isEnabled()) return { ok: false, code: 'ACTIVITY_DISABLED' };
    // allowAfterShutdown is used for an explicit post-login/user action. It must
    // never cancel a credential revocation that is still in progress.
    if (this.revoking) {
      return { ok: false, code: 'ACTIVITY_REVOKING', message: '正在撤销旧的提醒凭据，请稍候' };
    }
    if (this.shuttingDown && !allowAfterShutdown) {
      return { ok: false, code: 'ACTIVITY_STOPPING', message: '后台提醒服务正在停止' };
    }
    if (allowAfterShutdown) {
      this.shuttingDown = false;
      if (this.reconnectTimer) this.cancelReconnect();
    }
    if (this.socket && !this.socket.destroyed) return { ok: true, alreadyRunning: true };
    if (this.starting) return this.starting;
    const generation = this.reconnectGeneration;
    const starting = this.startAgent({ generation });
    this.starting = starting;
    try {
      const result = await starting;
      if (!result.ok && generation === this.reconnectGeneration && !this.shuttingDown) {
        const retryable = ['AGENT_START_TIMEOUT', 'AGENT_START_FAILED', 'AGENT_START_COOLDOWN'].includes(result.code);
        this.publishStatus({
          state: retryable ? 'reconnecting' : 'error',
          connection: 'disconnected',
          available: !!this.getAgentPath(),
          code: result.code,
          message: result.message,
        });
        if (retryable) this.scheduleReconnect(result.retryAfterMs);
      }
      return result;
    } finally {
      if (this.starting === starting) this.starting = null;
    }
  }

  hasLiveChild() {
    return !!this.child && this.child.exitCode === null && this.child.killed !== true;
  }

  startupAllowed(generation) {
    return !this.shuttingDown
      && generation === this.reconnectGeneration
      && this.isEnabled();
  }

  closeLateConnection(socket = this.socket) {
    if (!socket) return;
    if (this.socket === socket) this.socket = null;
    try { socket.end?.(); } catch {}
    try { socket.destroy?.(); } catch {}
  }

  async probeExistingAgent(delays, generation) {
    for (const delay of delays) {
      if (!this.startupAllowed(generation)) {
        return { ok: false, code: 'ACTIVITY_STOPPING', message: '后台提醒服务正在停止' };
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delay) || 0)));
      if (!this.startupAllowed(generation)) {
        return { ok: false, code: 'ACTIVITY_STOPPING', message: '后台提醒服务正在停止' };
      }
      try {
        const socket = await this.connect();
        if (!this.startupAllowed(generation)) {
          this.closeLateConnection(socket);
          return { ok: false, code: 'ACTIVITY_STOPPING', message: '后台提醒服务正在停止' };
        }
        this.reconnectAttempt = 0;
        return { ok: true };
      } catch {}
    }
    return { ok: false, code: 'AGENT_START_TIMEOUT', message: '后台代理启动超时，仍在后台等待连接' };
  }

  async startAgent({ generation = this.reconnectGeneration } = {}) {
    if (!this.startupAllowed(generation)) {
      return { ok: false, code: 'ACTIVITY_STOPPING', message: '后台提醒服务正在停止' };
    }
    try {
      const socket = await this.connect();
      if (!this.startupAllowed(generation)) {
        this.closeLateConnection(socket);
        return { ok: false, code: 'ACTIVITY_STOPPING', message: '后台提醒服务正在停止' };
      }
      this.reconnectAttempt = 0;
      return { ok: true, alreadyRunning: true };
    } catch {}
    if (!this.startupAllowed(generation)) {
      return { ok: false, code: 'ACTIVITY_STOPPING', message: '后台提醒服务正在停止' };
    }
    if (this.hasLiveChild()) {
      const probed = await this.probeExistingAgent(this.existingChildProbeDelaysMs, generation);
      return probed.ok ? { ...probed, alreadyRunning: true } : probed;
    }
    const executable = this.getAgentPath();
    if (!executable) return { ok: false, code: 'AGENT_MISSING', message: 'NekoPresenceAgent.exe 不存在，请重新安装或构建' };
    const cooldownRemaining = START_COOLDOWN_MS - (Date.now() - this.lastStartAttemptAt);
    if (cooldownRemaining > 0) {
      return {
        ok: false,
        code: 'AGENT_START_COOLDOWN',
        message: '后台提醒服务正在恢复，请稍候',
        retryAfterMs: cooldownRemaining,
      };
    }
    this.lastStartAttemptAt = Date.now();
    if (!this.startupAllowed(generation)) {
      return { ok: false, code: 'ACTIVITY_STOPPING', message: '后台提醒服务正在停止' };
    }
    try {
      const args = ['--embedded'];
      if (this.isDevRuntime) args.push('--channel=dev');
      const child = spawn(executable, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      this.child = child;
      child.once('error', (error) => {
        if (this.child === child) this.child = null;
        this.publishStatus({
          state: 'error',
          connection: 'disconnected',
          code: 'AGENT_START_FAILED',
          message: error.message,
        });
        if (!this.shuttingDown) this.scheduleReconnect();
      });
      child.once('exit', (code) => {
        if (this.child === child) this.child = null;
        if (!this.shuttingDown && this.isEnabled() && !this.socket) {
          this.publishStatus({
            state: 'reconnecting',
            connection: 'disconnected',
            code: code ? 'AGENT_EXITED' : null,
            message: code ? `后台提醒服务意外退出（${code}）` : null,
          });
          this.scheduleReconnect();
        }
      });
      child.unref();
      const probed = await this.probeExistingAgent(this.startProbeDelaysMs, generation);
      return probed.ok ? { ...probed, started: true } : probed;
    } catch (error) {
      return { ok: false, code: 'AGENT_START_FAILED', message: error.message };
    }
  }

  connect() {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = net.createConnection(this.getPipePath());
      const onError = (error) => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        socket.on('error', (error) => this.handleDisconnect(error, socket));
        socket.on('close', () => this.handleDisconnect(undefined, socket));
        socket.on('data', (chunk) => this.handleData(chunk, socket));
        this.socket = socket;
        this.reconnectAttempt = 0;
        this.nextReconnectAtMs = null;
        this.clearReconnectTimer();
        resolve(socket);
      });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.nextReconnectAtMs = null;
    this.reconnectGeneration += 1;
  }

  cancelReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.nextReconnectAtMs = null;
    this.reconnectGeneration += 1;
  }

  scheduleReconnect(delayOverride) {
    this.cancelReconnect();
    if (!this.isEnabled() || this.shuttingDown) return;
    const generation = this.reconnectGeneration;
    const configuredDelay = this.reconnectDelayMs === null
      ? RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
      : this.reconnectDelayMs;
    const delay = Math.max(0, Number(delayOverride ?? configuredDelay) || 0);
    this.reconnectAttempt += 1;
    this.nextReconnectAtMs = Date.now() + delay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.nextReconnectAtMs = null;
      this.recoverConnection(generation);
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async recoverConnection(generation) {
    if (generation !== this.reconnectGeneration || !this.isEnabled() || this.shuttingDown) return;
    try {
      const ready = await this.ensureRunning({ allowAfterShutdown: false });
      if (generation !== this.reconnectGeneration || !this.isEnabled() || this.shuttingDown) return;
      if (!ready.ok) {
        this.publishStatus({
          state: 'error',
          connection: 'disconnected',
          available: !!this.getAgentPath(),
          code: ready.code || 'AGENT_RECONNECT_FAILED',
          message: ready.message || '后台代理无法启动',
        });
        if (!this.reconnectTimer && ['AGENT_START_TIMEOUT', 'AGENT_START_FAILED', 'AGENT_START_COOLDOWN'].includes(ready.code)) {
          this.scheduleReconnect(ready.retryAfterMs);
        }
        return;
      }
      await this.getStatus();
    } catch (error) {
      if (generation !== this.reconnectGeneration || !this.isEnabled() || this.shuttingDown) return;
      this.publishStatus({
        state: 'error',
        connection: 'disconnected',
        available: !!this.getAgentPath(),
        code: error.code || 'AGENT_RECONNECT_FAILED',
        message: error.message || '后台代理重连失败',
      });
      this.scheduleReconnect();
    }
  }

  handleDisconnect(error, socket = this.socket) {
    if (socket && socket !== this.socket) return;
    if (error) this.logger.warn('[ActivityAgent] pipe disconnected:', error.message);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    const enabled = this.isEnabled();
    this.publishStatus({
      state: enabled ? 'reconnecting' : 'disabled',
      connection: 'disconnected',
      code: null,
      message: null,
    });
    const disconnected = activityError('AGENT_PIPE_DISCONNECTED', '后台代理连接已断开', { transient: true });
    while (this.pending.length) this.pending.shift().reject(disconnected);
    if (socket && !socket.destroyed) socket.destroy?.();
    if (enabled) this.scheduleReconnect();
    else this.cancelReconnect();
  }

  handleData(chunk, socket = this.socket) {
    if (socket && socket !== this.socket) return;
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
      catch {
        const error = activityError('AGENT_INVALID_RESPONSE', '后台代理返回了无效响应');
        pending.reject(error);
        this.handleDisconnect(error, socket);
        return;
      }
    }
  }

  command(command, payload = {}) {
    const operation = this.commandTail
      .catch(() => undefined)
      .then(() => this.sendCommand(command, payload));
    this.commandTail = operation.catch(() => undefined);
    return operation;
  }

  async sendCommand(command, payload = {}) {
    const socket = await this.connect();
    const body = Buffer.from(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, command, payload }), 'utf8');
    if (body.length > MAX_FRAME) throw new Error('后台代理命令超过 64KiB');
    const frame = Buffer.allocUnsafe(body.length + 4);
    frame.writeUInt32LE(body.length, 0);
    body.copy(frame, 4);
    return new Promise((resolve, reject) => {
      let settled = false;
      const failConnection = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const index = this.pending.findIndex((item) => item.resolve === wrappedResolve);
        if (index >= 0) this.pending.splice(index, 1);
        reject(error);
        this.handleDisconnect(error, socket);
      };
      const timeout = setTimeout(() => {
        failConnection(activityError('AGENT_COMMAND_TIMEOUT', '后台代理响应超时', { transient: true }));
      }, COMMAND_TIMEOUT_MS);
      const wrappedResolve = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const wrappedReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      this.pending.push({ resolve: wrappedResolve, reject: wrappedReject });
      socket.write(frame, (error) => {
        if (error) failConnection(activityError('AGENT_PIPE_WRITE_FAILED', error.message, { transient: true }));
      });
    });
  }

  classifyActivityResponse(response, json) {
    const status = Number(response?.status) || 0;
    const serverCode = String(json?.error?.code || '');
    if (status >= 300 && status < 400) {
      return activityError('API_REDIRECTED', '服务器将 Activity API 重定向到了网页，接口尚未正确配置', {
        httpStatus: status,
      });
    }
    if (status === 401 || status === 403) {
      return activityError('CREDENTIAL_INVALID', json?.error?.message || '活动提醒凭据已失效，请重新配置', {
        httpStatus: status,
      });
    }
    if (status === 404 && serverCode === 'DEVICE_NOT_FOUND') {
      return activityError('DEVICE_NOT_FOUND', json?.error?.message || '原 Activity 设备已不存在', {
        httpStatus: status,
      });
    }
    if (status === 404) {
      return activityError('API_NOT_DEPLOYED', '服务器尚未部署 Activity API', { httpStatus: status });
    }
    if (serverCode === 'ACTIVITY_FEATURE_DISABLED' || serverCode === 'FEATURE_DISABLED' || status === 204) {
      return activityError('FEATURE_DISABLED', json?.error?.message || '服务器暂未启用上线提醒功能', {
        httpStatus: status,
      });
    }
    if (status === 429 || status >= 500 || status === 0) {
      return activityError('API_TRANSIENT', json?.error?.message || `Activity API HTTP ${status || '?'}`, {
        httpStatus: status || undefined,
        transient: true,
      });
    }
    return activityError(serverCode || 'ACTIVITY_API_ERROR', json?.error?.message || `Activity API HTTP ${status}`, {
      httpStatus: status,
    });
  }

  noteApiFailure(error, pathname = 'unknown') {
    this.apiErrors.set(String(pathname), publicActivityError(error));
    this.lastApiError = Array.from(this.apiErrors.values()).at(-1) || null;
    if (!isCoreActivityEndpoint(pathname)) return;
    this.publishStatus({
      code: error.code,
      message: error.message,
      httpStatus: error.httpStatus || error.status || null,
    });
  }

  noteApiSuccess(pathname = 'unknown') {
    if (!this.apiErrors.has(String(pathname))) return;
    this.apiErrors.delete(String(pathname));
    this.lastApiError = Array.from(this.apiErrors.values()).at(-1) || null;
    if (!isCoreActivityEndpoint(pathname)) return;
    const remainingCoreError = Array.from(this.apiErrors.entries())
      .filter(([endpoint]) => isCoreActivityEndpoint(endpoint))
      .map(([, error]) => error)
      .at(-1) || null;
    this.publishStatus({
      code: remainingCoreError?.code || null,
      message: remainingCoreError?.message || null,
      httpStatus: remainingCoreError?.httpStatus || null,
    });
  }

  async activityRequest(pathname, {
    method = 'GET',
    body,
    query,
    validate,
    authContext,
    affectHealth = true,
  } = {}) {
    const token = authContext?.authToken ?? this.configStore.get('authToken');
    if (!token) throw activityError('UNAUTHORIZED', '请先登录');
    const url = new URL(pathname, authContext?.serverUrl || this.configStore.getServerUrl());
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    try {
      const response = await fetch(url, {
        method,
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      if (response.status >= 300 && response.status < 400) {
        throw this.classifyActivityResponse(response);
      }
      if (response.status === 204) throw this.classifyActivityResponse(response);
      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        if (!response.ok) throw this.classifyActivityResponse(response);
        throw activityError('API_INCOMPATIBLE', '服务器返回了网页而不是 Activity API 数据', {
          httpStatus: response.status,
        });
      }
      let json;
      try {
        json = await response.json();
      } catch {
        throw activityError('API_INCOMPATIBLE', '服务器返回的 Activity API 数据格式无效', {
          httpStatus: response.status,
        });
      }
      if (!isObject(json)) {
        throw activityError('API_INCOMPATIBLE', '服务器返回的 Activity API 数据结构无效', {
          httpStatus: response.status,
        });
      }
      if (!response.ok || json.success === false) throw this.classifyActivityResponse(response, json);
      const data = Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
      const validator = typeof validate === 'function'
        ? validate
        : (value) => validateActivityEndpointData(pathname, method, value, json);
      if (!validator(data, json)) {
        throw activityError('API_INCOMPATIBLE', '服务器返回的 Activity API 数据缺少必要字段', {
          httpStatus: response.status,
        });
      }
      const healthIsCurrent = typeof affectHealth === 'function' ? affectHealth() : affectHealth !== false;
      if (healthIsCurrent) this.noteApiSuccess(pathname);
      return data;
    } catch (error) {
      const classified = error?.code
        ? error
        : activityError('API_TRANSIENT', error?.name === 'TimeoutError' ? 'Activity API 请求超时' : '无法连接 Activity API', {
          transient: true,
        });
      const healthIsCurrent = typeof affectHealth === 'function' ? affectHealth() : affectHealth !== false;
      if (classified.code !== 'UNAUTHORIZED' && healthIsCurrent) this.noteApiFailure(classified, pathname);
      throw classified;
    }
  }

  provision() {
    if (this.revoking) {
      return Promise.resolve({ ok: false, code: 'ACTIVITY_REVOKING', message: '正在撤销旧的提醒凭据，请稍候' });
    }
    const identity = this.provisionIdentity();
    if (!identity) return Promise.resolve({ ok: false, code: 'UNAUTHORIZED', message: '请先登录' });
    if (!Number.isFinite(identity.numericUserId) || identity.numericUserId <= 0) {
      return Promise.resolve({ ok: false, code: 'UNSUPPORTED_ACCOUNT_ID', message: '当前账号无法配置原生提醒服务' });
    }
    const generation = this.provisionGeneration;
    const existing = this.provisionInFlight.get(identity.key);
    if (existing?.generation === generation && existing.authToken === identity.authToken) return existing.promise;

    const previous = this.provisionQueues.get(identity.key) || Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.performProvision(identity, generation));
    let tracked;
    tracked = operation.finally(() => {
      if (this.provisionInFlight.get(identity.key)?.promise === tracked) {
        this.provisionInFlight.delete(identity.key);
      }
      if (this.provisionQueues.get(identity.key) === tracked) {
        this.provisionQueues.delete(identity.key);
      }
    });
    this.provisionInFlight.set(identity.key, { generation, authToken: identity.authToken, promise: tracked });
    this.provisionQueues.set(identity.key, tracked);
    return tracked;
  }

  async performProvision(identity, generation) {
    if (!this.provisionStillCurrent(identity, generation)) {
      return { ok: false, code: 'PROVISION_SUPERSEDED', message: '账号或服务器已变更，已忽略旧配置请求' };
    }
    const ready = await this.ensureRunning({ allowAfterShutdown: true });
    if (!ready.ok) return ready;
    if (!this.provisionStillCurrent(identity, generation)) {
      return { ok: false, code: 'PROVISION_SUPERSEDED', message: '账号或服务器已变更，已忽略旧配置请求' };
    }
    try {
      const existingBinding = this.getActivityDeviceBinding(identity);
      const configuredDeviceName = this.configStore.get('activityDeviceName')
        || existingBinding?.deviceName;
      const enrollBody = {
        capabilities: ['presence', 'events', 'tray', 'snapshots'],
        deviceName: this.normalizeActivityDeviceNameForRuntime(configuredDeviceName),
        installationId: identity.installationId,
        runtimeChannel: identity.runtimeChannel,
      };
      if (Number.isInteger(existingBinding?.deviceId) && existingBinding.deviceId > 0) {
        enrollBody.deviceId = existingBinding.deviceId;
      }
      let enrolled;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!this.provisionStillCurrent(identity, generation)) {
          return { ok: false, code: 'PROVISION_SUPERSEDED', message: '账号或服务器已变更，已忽略旧配置请求' };
        }
        try {
          enrolled = await this.activityRequest('/api/activity/agent/enroll', {
            method: 'POST',
            body: enrollBody,
            validate: (data) => validateActivityEndpointData('/api/activity/agent/enroll', 'POST', data),
            authContext: identity,
            affectHealth: () => this.provisionStillCurrent(identity, generation),
          });
          break;
        } catch (error) {
          const canRetryMissingDevice = attempt === 0
            && error?.code === 'DEVICE_NOT_FOUND'
            && Number(enrollBody.deviceId) > 0;
          if (!canRetryMissingDevice) throw error;
          this.removeActivityDeviceBinding(identity);
          if (String(this.configStore.get('activityBoundUserId')) === String(identity.userId)) {
            this.configStore.setMany({ activityDeviceId: null, activityDeviceName: '' });
          }
          delete enrollBody.deviceId;
          if (!this.provisionStillCurrent(identity, generation)) {
            return { ok: false, code: 'PROVISION_SUPERSEDED', message: '账号或服务器已变更，已停止重建设备' };
          }
        }
      }
      const activityDeviceId = Number(enrolled.device?.id);
      const activityDeviceName = enrolled.device?.name || enrollBody.deviceName;
      if (!this.provisionStillCurrent(identity, generation)) {
        const currentIdentity = this.provisionIdentity();
        if (currentIdentity?.key !== identity.key) {
          try {
            await this.activityRequest('/api/activity/agent/enroll', {
              method: 'DELETE',
              body: { deviceId: activityDeviceId },
              authContext: identity,
              affectHealth: false,
            });
          } catch {}
        }
        return { ok: false, code: 'PROVISION_SUPERSEDED', message: '账号或服务器已变更，已丢弃旧凭据' };
      }
      if (Number.isInteger(activityDeviceId) && activityDeviceId > 0) {
        this.storeActivityDeviceBinding(identity, {
          deviceId: activityDeviceId,
          deviceName: activityDeviceName,
        });
        this.configStore.setMany({
          activityBoundUserId: identity.boundUserId,
          activityDeviceId,
          activityDeviceName,
          activityOnboardingSeen: true,
        });
      }
      const profile = {
        protocolVersion: PROTOCOL_VERSION,
        serverUrl: identity.serverUrl,
        deviceId: activityDeviceId,
        deviceName: activityDeviceName,
        userId: identity.numericUserId,
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
      if (!this.provisionStillCurrent(identity, generation)) {
        return { ok: false, code: 'PROVISION_SUPERSEDED', message: '账号或服务器已变更，已丢弃旧凭据' };
      }
      const result = await this.command('provision', profile);
      if (!result.ok) return { ok: false, code: result.data?.code || 'PROVISION_FAILED', message: result.data?.message || '代理配置失败' };
      if (!this.provisionStillCurrent(identity, generation)) {
        return { ok: false, code: 'PROVISION_SUPERSEDED', message: '账号或服务器已变更，旧凭据将由撤销流程清理' };
      }
      const claimed = await this.command('claim_tray');
      const status = this.publishStatus({
        state: 'embedded',
        ...result.data,
        trayClaimed: claimed.ok === true,
        code: null,
        message: null,
      });
      await this.reconcileSnapshotPrivacy();
      return { ok: true, data: status };
    } catch (error) {
      return { ok: false, code: error.code || 'PROVISION_FAILED', message: error.message };
    }
  }

  async syncProfile() {
    const ready = await this.ensureRunning();
    if (!ready.ok) return ready;
    const user = this.configStore.get('authUser') || {};
    const identity = this.provisionIdentity();
    const binding = this.getActivityDeviceBinding(identity);
    if (binding && identity) {
      this.configStore.setMany({
        activityBoundUserId: identity.boundUserId,
        activityDeviceId: binding.deviceId,
        activityDeviceName: binding.deviceName || this.configStore.get('activityDeviceName') || '',
      });
    }
    const profile = {
      protocolVersion: PROTOCOL_VERSION,
      serverUrl: this.configStore.getServerUrl(),
      deviceId: Number(binding?.deviceId) || 0,
      deviceName: binding?.deviceName || this.configStore.get('activityDeviceName') || '',
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
    if (!result.ok) return { ok: false, ...result.data };
    const provisionState = result.data?.health?.provision?.state;
    const nativeNeedsProvision = result.data?.provisioned === false
      || ['needs_enroll', 'credential_error', 'failed'].includes(provisionState);
    if (nativeNeedsProvision && identity && this.isEnabled()) {
      return this.provision();
    }
    const data = this.publishStatus({ state: 'embedded', ...result.data, code: null, message: null });
    await this.reconcileSnapshotPrivacy();
    return { ok: true, data };
  }

  async getStatus() {
    if (!this.isEnabled()) {
      return this.createSnapshot({
        ...this.lastStatus,
        state: 'disabled',
        connection: 'offline',
        available: !!this.getAgentPath(),
        code: null,
        message: null,
      });
    }
    if (!this.socket || this.socket.destroyed) {
      return this.createSnapshot({
        ...this.lastStatus,
        state: this.lastStatus.state === 'error' ? 'error' : 'reconnecting',
        connection: 'disconnected',
        available: !!this.getAgentPath(),
      });
    }
    let result;
    try {
      result = await this.command('get_status');
    } catch (error) {
      return this.getSnapshot();
    }
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
      ? this.publishStatus({ state: result.data.paused ? 'paused' : 'embedded', available: true, ...result.data, code: null, message: null })
      : this.publishStatus({ state: 'error', ...result.data });
  }

  async claimTray() {
    const ready = await this.ensureRunning();
    if (!ready.ok) return ready;
    const result = await this.command('claim_tray');
    if (!result.ok) return result;
    const data = this.publishStatus({ state: this.lastStatus.paused ? 'paused' : 'embedded', trayClaimed: true });
    return { ...result, data };
  }

  async pause() {
    const result = await this.command('pause');
    if (!result.ok) return result;
    return { ...result, data: this.publishStatus({ state: 'paused', ...result.data }) };
  }

  async resume() {
    const result = await this.command('resume');
    if (!result.ok) return result;
    return { ...result, data: this.publishStatus({ state: 'embedded', ...result.data }) };
  }

  async repair() {
    const snapshot = this.getSnapshot();
    if (snapshot.health.overall === 'healthy') {
      const privacyReconcile = await this.reconcileSnapshotPrivacy();
      return { ok: true, data: this.getSnapshot(), noAction: true, privacyReconcile };
    }
    if (snapshot.health.overall === 'needs_login') {
      return { ok: false, code: 'UNAUTHORIZED', message: '请先登录后再配置上线提醒' };
    }
    const credentialInvalid = snapshot.health.provision.state === 'credential_error'
      || snapshot.health.receiver.state === 'credential_error'
      || snapshot.health.publisher.state === 'credential_error'
      || snapshot.health.receiver.lastError?.code === 'CREDENTIAL_INVALID'
      || snapshot.health.publisher.lastError?.code === 'CREDENTIAL_INVALID'
      || snapshot.agent?.code === 'CREDENTIAL_INVALID';
    const provisionState = snapshot.health.provision.state;
    if (credentialInvalid || provisionState === 'needs_enroll' || provisionState === 'failed') {
      // A fresh enroll atomically rotates the Agent token and the Native provision
      // command replaces the encrypted local credential. Do not use this path for
      // transient reconnects or polling degradation.
      return this.provision();
    }
    const receiverState = snapshot.health.receiver.state;
    if (['unsupported', 'polling'].includes(receiverState) && provisionState === 'ready') {
      try {
        const retried = await this.command('retry_now');
        if (!retried.ok) {
          return {
            ok: false,
            code: retried.data?.code || 'AGENT_RETRY_FAILED',
            message: retried.data?.message || '无法立即检查服务器状态',
          };
        }
        if (isObject(retried.data)) this.publishStatus(retried.data);
        const privacyReconcile = await this.reconcileSnapshotPrivacy();
        return { ok: true, data: this.getSnapshot(), privacyReconcile };
      } catch (error) {
        return { ok: false, code: error.code, message: error.message, data: this.getSnapshot() };
      }
    }
    const ready = await this.ensureRunning();
    if (!ready.ok) return ready;
    const status = await this.getStatus();
    if (status.provisioned === true || ['provisioned', 'ready'].includes(status.health?.provision?.state)) {
      const synced = await this.syncProfile();
      return synced.ok ? { ...synced, data: this.getSnapshot() } : synced;
    }
    return this.provision();
  }

  async releaseForAppExit({ exitAll = false, reason = 'session' } = {}) {
    this.shuttingDown = true;
    this.cancelReconnect();
    const shutdownRequired = exitAll || !this.configStore.get('enableActivityBackground');
    if (!this.socket || this.socket.destroyed) {
      if (shutdownRequired && (this.hasLiveChild() || this.starting || this.isEnabled())) {
        return this.shutdownExistingAgentSync();
      }
      return { ok: true, skipped: true };
    }
    let shutdownResult = { ok: true };
    try {
      if (shutdownRequired) {
        shutdownResult = await this.command('shutdown', { reason });
      } else {
        await this.command('release_tray');
        this.publishStatus({ state: 'background', trayClaimed: false });
      }
    } catch (error) {
      shutdownResult = { ok: false, message: error.message };
    }
    this.cancelReconnect();
    this.socket?.end();
    this.socket = null;
    if (shutdownRequired && shutdownResult?.ok !== true) return this.shutdownExistingAgentSync();
    return shutdownResult;
  }

  shutdownExistingAgentSync() {
    // Release the Agent's single pipe instance before the synchronous helper
    // tries to connect. Keeping the Electron socket open here makes the helper
    // wait on the mutex while it can never acquire the only pipe instance.
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    const executable = this.getAgentPath();
    if (!executable) return { ok: true, skipped: true };
    const args = ['--shutdown-for-update'];
    if (this.isDevRuntime) args.push('--channel=dev');
    const result = this.spawnSync(executable, args, {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 25000,
    });
    return result.error
      ? { ok: false, message: result.error.message }
      : { ok: result.status === 0, status: result.status };
  }

  clearActivityIdentitySync() {
    const executable = this.getAgentPath();
    if (!executable) return { ok: false, skipped: true, message: 'NekoPresenceAgent.exe 不存在' };
    const args = ['--clear-activity-identity'];
    if (this.isDevRuntime) args.push('--channel=dev');
    const result = this.spawnSync(executable, args, {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 15000,
    });
    return result.error
      ? { ok: false, message: result.error.message }
      : { ok: result.status === 0, status: result.status };
  }

  shutdownForUpdateSync() {
    this.shuttingDown = true;
    this.cancelReconnect();
    return this.shutdownExistingAgentSync();
  }

  revoke(reason = 'disable') {
    if (this.revokeInFlight) return this.revokeInFlight;
    this.revoking = true;
    this.shuttingDown = true;
    this.cancelReconnect();
    const identity = this.provisionIdentity();
    const operation = this.performRevoke(reason, identity);
    let tracked;
    tracked = operation.finally(() => {
      this.revoking = false;
      if (this.revokeInFlight === tracked) this.revokeInFlight = null;
    });
    this.revokeInFlight = tracked;
    return tracked;
  }

  async performRevoke(reason, identity) {
    this.invalidateProvisionGeneration();
    this.invalidateSessionIdentity();
    this.resetActivitySessionCache();
    const initialBinding = this.getActivityDeviceBinding(identity);
    const unscopedLegacyDeviceId = this.canUseUnscopedLegacyActivityDevice(identity)
      ? this.configStore.get('activityDeviceId')
      : undefined;
    const initialDeviceId = Number(initialBinding?.deviceId || unscopedLegacyDeviceId) || undefined;
    if (initialDeviceId || this.lastStatus.provisioned === true) this.markActivityOnboardingSeen();
    const authContext = {
      authToken: this.configStore.get('authToken') || '',
      serverUrl: this.configStore.getServerUrl?.() || '',
    };
    let agentClearedIdentity = false;
    try {
      const response = await this.command('shutdown', { reason });
      agentClearedIdentity = response?.ok === true;
    } catch {}
    this.cancelReconnect();
    const socket = this.socket;
    this.socket = null;
    try { socket?.destroy(); } catch {}
    if (!agentClearedIdentity) {
      const cleanup = this.clearActivityIdentitySync();
      if (!cleanup.ok && !cleanup.skipped) {
        this.logger.warn('[ActivityAgent] offline identity cleanup failed:', cleanup.message || cleanup.status);
      }
    }
    // An enroll POST may already be waiting on the server when revocation starts.
    // Wait for every queue belonging to this identity to observe the invalidated
    // generation before issuing the final exact remote revoke.
    await this.settleProvisionQueues(identity?.key);
    const settledBinding = this.getActivityDeviceBinding(identity, { migrateLegacy: false });
    const deviceId = Number(settledBinding?.deviceId || initialDeviceId) || undefined;
    if (authContext.authToken && authContext.serverUrl) {
      let exactRevoked = false;
      try {
        await this.activityRequest('/api/activity/agent/enroll', {
          method: 'DELETE',
          body: {
            installationId: identity?.installationId || this.activityInstallationId,
            runtimeChannel: identity?.runtimeChannel || this.runtimeChannel,
          },
          authContext,
          affectHealth: false,
        });
        exactRevoked = true;
      } catch {}
      // Compatibility for servers deployed before installation-scoped revoke.
      // Never send an empty DELETE, and only fall back when the exact request did
      // not succeed.
      if (!exactRevoked && deviceId) {
        try {
          await this.activityRequest('/api/activity/agent/enroll', {
            method: 'DELETE',
            body: { deviceId },
            authContext,
            affectHealth: false,
          });
        } catch {}
      }
    }
    this.detectedApps.clear();
    this.lastApiError = null;
    this.apiErrors.clear();
    if (typeof this.configStore.setMany === 'function') {
      this.configStore.setMany({ activityDeviceId: null, activityDeviceName: '' });
    }
    return this.publishStatus({
      state: 'disabled',
      connection: 'offline',
      provisioned: false,
      trayClaimed: false,
      code: null,
      message: null,
    });
  }

  isActive() {
    return !!(this.socket && !this.socket.destroyed) || !!this.child || !!this.starting || !!this.reconnectTimer;
  }
}

module.exports = {
  ActivityAgentController,
  activityProcessName,
  normalizeActivityAppKey,
  activityDisplayName,
  PIPE_PATH,
  DEV_PIPE_PATH,
  PROTOCOL_VERSION,
  MIN_AGENT_PROTOCOL_VERSION,
  MAX_AGENT_PROTOCOL_VERSION,
};

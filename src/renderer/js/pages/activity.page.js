(function attachActivityPage() {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    publishing: false,
    snapshots: false,
    background: false,
    autoStart: true,
  });
  function deriveEffectiveSettings(settings = {}, reported = {}) {
    const configured = { ...DEFAULT_SETTINGS, ...settings };
    const effective = { ...configured, ...(reported || {}) };
    const enabled = configured.enabled === true && effective.enabled === true;
    const publishing = enabled && effective.publishing === true;
    const background = enabled && effective.background === true;
    return {
      ...effective,
      enabled,
      publishing,
      snapshots: publishing && effective.snapshots === true,
      background,
      autoStart: background && effective.autoStart === true,
    };
  }
  const REMOTE_DEBOUNCE_MS = 5000;
  const HEALTH_RECOVERY_POLL_MS = 2000;
  const HEALTH_STABLE_POLL_MS = 10000;
  const FOLLOWS_POLL_MS = 30000;
  const UNSUPPORTED_CODES = new Set([
    'API_REDIRECTED',
    'API_NOT_DEPLOYED',
    'API_INCOMPATIBLE',
    'ACTIVITY_API_UNAVAILABLE',
    'ACTIVITY_API_MISMATCH',
    'FEATURE_DISABLED',
  ]);
  const OVERALL_STATES = new Set([
    'disabled', 'needs_login', 'needs_enroll', 'starting', 'healthy',
    'degraded', 'recovering', 'paused', 'unavailable', 'needs_action',
  ]);

  let initialized = false;
  let pageActive = false;
  let healthPollTimer = null;
  let followsPollTimer = null;
  let remoteDebounceTimer = null;
  let pendingRemoteHealth = null;
  let displayHealth = null;
  let latestRevision = -1;
  let latestIdentityRevision = null;
  let lastAnnouncement = '';
  let diagnosticsText = '';
  let settingsSavePromise = null;
  let businessLoaded = false;
  let businessEpoch = 0;
  let businessRequestRevision = 0;
  let followsRequestRevision = 0;
  let authReadRevision = 0;
  let pendingSettingsPatch = {};
  let confirmedSettings = { ...DEFAULT_SETTINGS };
  const unsubscriptions = [];
  let state = {
    schemaVersion: 1,
    revision: -1,
    observedAtMs: 0,
    settings: { ...DEFAULT_SETTINGS },
    effectiveSettings: deriveEffectiveSettings(DEFAULT_SETTINGS),
    health: null,
    readError: null,
    agent: { state: 'disabled' },
    follows: [], followers: [], apps: [], blocks: [], visibility: 'private',
    sectionStatus: { follows: 'idle', privacy: 'idle', apps: 'idle', followers: 'idle', blocks: 'idle' },
    partialFailures: [],
    currentUserId: null, currentUsername: '',
  };
  const pendingSettings = new Set();
  let deps = {};

  const byId = (id) => document.getElementById(id);
  const client = () => window._nekoModules?.services?.ActivityClient;
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const notify = (message, type = 'info') => deps.showNotice?.(message, type);
  const failed = (result) => result?.ok === false || result?.success === false;
  const errorText = (result, fallback) => result?.message
    || result?.error?.message
    || (typeof result?.error === 'string' ? result.error : '')
    || fallback;

  function confirmActivityDanger(action, button) {
    const messages = {
      unfollow: '确定取消关注这个用户吗？相关应用提醒规则也会一并失效。',
      'delete-rule': '确定删除这条应用提醒规则吗？删除后不会再收到该应用提醒。',
      block: '确定拉黑这个用户吗？双方会互相不可见，并立即撤销相关关注动态。',
    };
    if (action === 'toggle-app' && button?.dataset.hidden !== '1') {
      return window.confirm('停止公开这个应用吗？关注你的人将看不到它，也不会再收到它的上线提醒。');
    }
    const message = messages[action];
    return !message || window.confirm(message);
  }

  function setPageStatus(message = '', type = 'info') {
    const el = byId('activityPageStatus');
    if (!el) return;
    if (!message) {
      el.textContent = '';
      delete el.dataset.tone;
      delete el.dataset.partialLoad;
      el.setAttribute?.('role', 'status');
      el.setAttribute?.('aria-live', 'polite');
      return;
    }
    el.textContent = message;
    el.dataset.tone = type;
    if (type === 'error') {
      el.setAttribute?.('role', 'alert');
      el.setAttribute?.('aria-live', 'assertive');
    } else {
      el.setAttribute?.('role', 'status');
      el.setAttribute?.('aria-live', 'polite');
    }
  }

  function switchState(element, enabled, disabled = false, pending = false) {
    if (!element) return;
    const isDisabled = !!disabled || !!pending;
    element.classList.toggle('on', !!enabled);
    element.classList.toggle('disabled', isDisabled);
    element.classList.toggle('loading', !!pending);
    element.setAttribute('aria-checked', enabled ? 'true' : 'false');
    element.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    element.setAttribute('aria-busy', pending ? 'true' : 'false');
    element.disabled = isDisabled;
  }

  function formatDuration(value) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
  }

  function asTime(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatRelativeTime(value, fallback = '暂无记录') {
    const time = asTime(value);
    if (!time) return fallback;
    const delta = Date.now() - time;
    const future = delta < 0;
    const seconds = Math.max(0, Math.round(Math.abs(delta) / 1000));
    let text;
    if (seconds < 5) text = '刚刚';
    else if (seconds < 60) text = `${seconds} 秒`;
    else if (seconds < 3600) text = `${Math.floor(seconds / 60)} 分钟`;
    else if (seconds < 86400) text = `${Math.floor(seconds / 3600)} 小时`;
    else text = `${Math.floor(seconds / 86400)} 天`;
    if (text === '刚刚') return text;
    return future ? `${text}后` : `${text}前`;
  }

  function normalizeError(error) {
    if (!error || typeof error !== 'object') return null;
    return {
      code: String(error.code || 'UNKNOWN_ERROR').slice(0, 80),
      message: String(error.message || '未知错误').slice(0, 240),
      httpStatus: Number.isFinite(Number(error.httpStatus)) ? Number(error.httpStatus) : null,
      transient: error.transient === true,
      atMs: asTime(error.atMs),
    };
  }

  function normalizeProvisionState(value) {
    const aliases = {
      provisioned: 'ready',
      configured: 'ready',
      unprovisioned: 'needs_enroll',
      missing: 'needs_enroll',
      error: 'failed',
    };
    const stateValue = String(value || 'needs_enroll');
    return aliases[stateValue] || stateValue;
  }

  function errorIsUnsupported(error) {
    const code = String(error?.code || '').toUpperCase();
    return UNSUPPORTED_CODES.has(code) || /NOT_DEPLOYED|INCOMPATIBLE|REDIRECTED|FEATURE_DISABLED/.test(code);
  }

  function defaultHealth(settings = state.settings) {
    const enabled = settings.enabled === true;
    return {
      overall: enabled ? 'starting' : 'disabled',
      lifecycle: enabled ? 'starting' : 'disabled',
      localIpc: { state: enabled ? 'connecting' : 'disabled', attempt: 0, sinceMs: null, nextRetryAtMs: null, lastError: null },
      provision: { state: enabled ? 'needs_enroll' : 'needs_enroll', deviceConfigured: false, boundToCurrentUser: false },
      receiver: { state: enabled ? 'connecting' : 'disabled', transport: null, lastConnectedAtMs: null, lastHeartbeatAtMs: null, lastEventAtMs: null, consecutiveFailures: 0, nextRetryAtMs: null, lastError: null },
      publisher: {
        state: settings.publishing ? 'idle' : 'disabled',
        lastSuccessAtMs: null,
        currentApp: null,
        detectedApp: null,
        lastError: null,
      },
    };
  }

  function deriveOverall(health, settings) {
    if (!settings.enabled) return 'disabled';
    const provision = normalizeProvisionState(health.provision?.state);
    if (provision === 'needs_login') return 'needs_login';
    if (health.lifecycle === 'paused' || health.receiver?.state === 'paused') return 'paused';
    if (errorIsUnsupported(health.receiver?.lastError)
      || errorIsUnsupported(health.publisher?.lastError)
      || health.receiver?.state === 'unsupported'
      || health.publisher?.state === 'unsupported') return 'unavailable';
    if (provision === 'needs_enroll') return 'needs_enroll';
    if (provision === 'failed' || provision === 'credential_error'
      || ['error', 'disconnected'].includes(health.localIpc?.state)
      || health.lifecycle === 'error'
      || ['credential_error'].includes(health.receiver?.state)
      || ['credential_error'].includes(health.publisher?.state)) return 'needs_action';
    if (health.lifecycle === 'starting' || health.localIpc?.state === 'connecting') return 'starting';
    if (health.receiver?.state === 'polling') return 'degraded';
    if (['reconnecting', 'retrying'].includes(health.localIpc?.state)
      || ['connecting', 'retrying'].includes(health.receiver?.state)
      || health.publisher?.state === 'retrying') return 'recovering';
    return health.overall === 'degraded' ? 'degraded' : 'healthy';
  }

  function normalizeV2Health(input, settings) {
    const base = defaultHealth(settings);
    const health = input && typeof input === 'object' ? input : {};
    const normalized = {
      ...base,
      ...health,
      localIpc: {
        ...base.localIpc,
        ...(health.localIpc || {}),
        lastError: normalizeError(health.localIpc?.lastError),
      },
      provision: {
        ...base.provision,
        ...(health.provision || {}),
        state: normalizeProvisionState(health.provision?.state),
      },
      receiver: {
        ...base.receiver,
        ...(health.receiver || {}),
        lastError: normalizeError(health.receiver?.lastError),
      },
      publisher: {
        ...base.publisher,
        ...(health.publisher || {}),
        lastError: normalizeError(health.publisher?.lastError),
      },
    };
    const derivedOverall = deriveOverall(normalized, settings);
    const declaredOverall = String(health.overall || '');
    // v2 snapshots own the aggregate state. Keep one defensive guard against a
    // contradictory green state, while avoiding Renderer reclassification of
    // legitimate Main states such as `starting + local IPC disconnected`.
    normalized.overall = OVERALL_STATES.has(declaredOverall)
      ? (declaredOverall === 'healthy' && derivedOverall !== 'healthy' ? derivedOverall : declaredOverall)
      : derivedOverall;
    return normalized;
  }

  function legacyHealth(agent = {}, settings = state.settings) {
    const enabled = settings.enabled === true;
    if (!enabled) return normalizeV2Health({ overall: 'disabled', lifecycle: 'disabled' }, settings);
    const lifecycle = agent.state || 'starting';
    const localState = ['embedded', 'background', 'paused'].includes(lifecycle)
      ? (lifecycle === 'paused' ? 'paused' : 'connected')
      : lifecycle === 'reconnecting' ? 'reconnecting'
        : lifecycle === 'error' ? 'error' : 'connecting';
    const receiverState = {
      online: 'connected',
      polling: 'polling',
      reconnecting: 'retrying',
      offline: 'retrying',
      disconnected: localState === 'connected' ? 'retrying' : 'disabled',
    }[agent.connection] || (localState === 'connected' ? 'connecting' : 'disabled');
    const legacyError = agent.code || agent.message ? normalizeError({
      code: agent.code || 'ACTIVITY_STATE_FAILED',
      message: agent.message || '后台提醒状态异常',
      transient: lifecycle === 'reconnecting',
      atMs: Date.now(),
    }) : null;
    return normalizeV2Health({
      lifecycle,
      localIpc: { state: localState, lastError: localState === 'error' ? legacyError : null },
      provision: {
        state: agent.deviceId ? 'ready' : 'needs_enroll',
        deviceConfigured: !!agent.deviceId,
        boundToCurrentUser: !!agent.deviceId,
      },
      receiver: { state: receiverState, transport: receiverState === 'polling' ? 'polling' : receiverState === 'connected' ? 'sse' : null, lastError: receiverState === 'retrying' ? legacyError : null },
      publisher: { state: settings.publishing ? 'idle' : 'disabled', currentApp: agent.currentApp || null },
    }, settings);
  }

  function healthFingerprint(health) {
    return JSON.stringify([
      health?.overall,
      health?.lifecycle,
      health?.localIpc?.state,
      health?.provision?.state,
      health?.receiver?.state,
      health?.receiver?.transport,
      health?.receiver?.lastError?.code,
      health?.publisher?.state,
      health?.publisher?.lastError?.code,
    ]);
  }

  function isRemoteTransient(health) {
    if (!health || health.overall === 'unavailable') return false;
    return ['connecting', 'retrying'].includes(health.receiver?.state)
      || health.publisher?.state === 'retrying';
  }

  function clearRemoteDebounce() {
    if (remoteDebounceTimer) window.clearTimeout(remoteDebounceTimer);
    remoteDebounceTimer = null;
    pendingRemoteHealth = null;
  }

  function setDisplayedHealth(nextHealth, { immediate = false } = {}) {
    if (!displayHealth || immediate) {
      clearRemoteDebounce();
      displayHealth = nextHealth;
      return;
    }
    if (healthFingerprint(nextHealth) === healthFingerprint(displayHealth)) {
      clearRemoteDebounce();
      displayHealth = nextHealth;
      return;
    }
    const localStable = nextHealth.localIpc?.state === displayHealth.localIpc?.state
      && nextHealth.lifecycle === displayHealth.lifecycle
      && nextHealth.provision?.state === displayHealth.provision?.state;
    if (!localStable || !isRemoteTransient(nextHealth)) {
      clearRemoteDebounce();
      displayHealth = nextHealth;
      return;
    }
    pendingRemoteHealth = nextHealth;
    if (remoteDebounceTimer) return;
    remoteDebounceTimer = window.setTimeout(() => {
      remoteDebounceTimer = null;
      if (!pendingRemoteHealth) return;
      displayHealth = pendingRemoteHealth;
      pendingRemoteHealth = null;
      renderAgent();
      scheduleHealthPoll();
    }, REMOTE_DEBOUNCE_MS);
  }

  function unwrapSnapshot(result) {
    if (result?.data && typeof result.data === 'object' && (result.data.schemaVersion || result.data.health)) return result.data;
    return result;
  }

  function applyActivitySnapshot(raw, { immediate = false } = {}) {
    const snapshot = unwrapSnapshot(raw);
    if (!snapshot || typeof snapshot !== 'object') return false;
    const isV2 = Number(snapshot.schemaVersion) >= 2 && snapshot.health;
    const revision = Number(snapshot.revision);
    if (!isV2 && latestRevision >= 0) return false;
    if (isV2 && latestRevision >= 0 && (!Number.isFinite(revision) || revision <= latestRevision)) return false;
    if (isV2 && Number.isFinite(revision)) latestRevision = revision;
    const identityRevision = Number(snapshot.identityRevision);
    if (Number.isFinite(identityRevision)) {
      if (latestIdentityRevision !== null && identityRevision !== latestIdentityRevision) resetBusinessState();
      latestIdentityRevision = identityRevision;
    }

    state.schemaVersion = isV2 ? Number(snapshot.schemaVersion) : 1;
    state.readError = null;
    state.revision = Number.isFinite(revision) ? revision : state.revision;
    state.observedAtMs = asTime(snapshot.observedAtMs) || Date.now();
    const optimisticSettings = {};
    pendingSettings.forEach((key) => { optimisticSettings[key] = state.settings[key]; });
    const hasCanonicalSettings = snapshot.settings && typeof snapshot.settings === 'object';
    const canonicalSettings = hasCanonicalSettings
      ? { ...state.settings, ...snapshot.settings }
      : { ...state.settings };
    if (hasCanonicalSettings) confirmedSettings = { ...canonicalSettings };
    state.settings = { ...canonicalSettings, ...optimisticSettings };
    state.effectiveSettings = pendingSettings.size
      ? deriveEffectiveSettings(state.settings)
      : deriveEffectiveSettings(state.settings, snapshot.effectiveSettings || snapshot.settings || {});
    state.agent = isV2
      ? (snapshot.agent || state.agent)
      : (snapshot.agent || snapshot || state.agent);
    state.health = isV2
      ? normalizeV2Health(snapshot.health, state.settings)
      : legacyHealth(snapshot.agent || snapshot, state.settings);
    setDisplayedHealth(state.health, { immediate: immediate || !displayHealth });
    return true;
  }

  function sectionPayload(data, key, fallbackValue) {
    const section = data?.sections?.[key];
    if (section && typeof section === 'object') {
      return { status: section.status || 'fresh', value: section.data };
    }
    const partialFailed = (data?.partialFailures || []).some((item) => item?.section === key);
    if (partialFailed) return { status: 'error', value: undefined };
    if (Object.prototype.hasOwnProperty.call(data || {}, key)) return { status: 'fresh', value: data[key] };
    return { status: 'error', value: fallbackValue };
  }

  function normalizeBootstrap(data) {
    const mappings = {
      follows: { current: 'follows', list: 'follows', fallback: { follows: [] } },
      followers: { current: 'followers', list: 'followers', fallback: { followers: [] } },
      apps: { current: 'apps', list: 'apps', fallback: { apps: [] } },
      blocks: { current: 'blocks', list: 'blocks', fallback: { blocks: [] } },
    };
    Object.entries(mappings).forEach(([key, mapping]) => {
      const section = sectionPayload(data, key, mapping.fallback);
      state.sectionStatus[key] = section.status;
      if (section.status === 'error' || !section.value) return;
      const list = section.value?.[mapping.list];
      if (Array.isArray(list)) state[mapping.current] = list;
    });
    const privacy = sectionPayload(data, 'privacy', { visibility: 'private' });
    state.sectionStatus.privacy = privacy.status;
    if (privacy.status !== 'error' && privacy.value) {
      state.visibility = privacy.value.visibility || state.visibility;
    }
    state.partialFailures = Array.isArray(data?.partialFailures)
      ? data.partialFailures
      : Object.entries(state.sectionStatus)
        .filter(([, status]) => status === 'error')
        .map(([section]) => ({ section }));
  }

  function renderPartialLoadStatus() {
    const status = byId('activityPageStatus');
    if (!state.partialFailures.length) {
      if (status?.dataset.partialLoad === '1') setPageStatus('');
      return;
    }
    const sectionLabels = {
      follows: '关注列表',
      privacy: '隐私设置',
      apps: '云端应用目录',
      followers: '关注者',
      blocks: '黑名单',
    };
    const labels = [...new Set(state.partialFailures.map((item) => (
      sectionLabels[item?.section] || '部分数据'
    )))];
    setPageStatus(`${labels.join('、')}暂时无法加载，已继续显示可用的应用数据。`, 'warn');
    if (status) status.dataset.partialLoad = '1';
  }

  function setHealthRow(prefix, tone, label, detail) {
    const root = byId(`activity${prefix}Health`);
    if (root) root.dataset.state = tone;
    const labelEl = byId(`activity${prefix}HealthLabel`);
    if (labelEl) labelEl.textContent = label;
    const detailEl = byId(`activity${prefix}HealthDetail`);
    if (detailEl) detailEl.textContent = detail;
  }

  function localHealthView(health, settings) {
    if (!settings.enabled || health.lifecycle === 'disabled') return ['disabled', '未启用', '开启功能后自动准备本机服务'];
    if (health.lifecycle === 'paused' || health.localIpc?.state === 'paused') return ['paused', '已暂停', '本次登录期间不会接收或分享活动'];
    if (health.localIpc?.state === 'connected') {
      const mode = health.lifecycle === 'background' ? '轻量服务正在后台运行' : '随 Neko Status 主窗口运行';
      return ['healthy', '运行中', mode];
    }
    if (['connecting', 'reconnecting', 'retrying'].includes(health.localIpc?.state) || health.lifecycle === 'starting') {
      const retry = health.localIpc?.nextRetryAtMs ? `，${formatRelativeTime(health.localIpc.nextRetryAtMs)}重试` : '';
      return ['recovering', '正在恢复', `正在连接本机服务${retry}`];
    }
    const error = health.localIpc?.lastError;
    return ['error', '需要处理', error?.message || '本机提醒组件暂不可用'];
  }

  function receiverHealthView(health, settings) {
    const receiver = health.receiver || {};
    if (!settings.enabled) return ['disabled', '未启用', '开启后可接收关注对象的上线提醒'];
    if (receiver.state === 'disabled' && receiver.lastError) {
      if (errorIsUnsupported(receiver.lastError)) return ['unavailable', '服务器未提供', '已停止频繁重试，本地设置会保留'];
      if (receiver.lastError.transient || receiver.lastError.code === 'API_TRANSIENT') {
        return ['unavailable', '服务器暂不可用', receiver.lastError.message || '暂时无法连接提醒服务器'];
      }
      return ['error', '需要处理', receiver.lastError.message || '无法接收上线提醒'];
    }
    if (receiver.state === 'disabled') return ['disabled', '未启用', '开启后可接收关注对象的上线提醒'];
    if (receiver.state === 'paused') return ['paused', '已暂停', '恢复后继续接收提醒'];
    if (receiver.state === 'connected') {
      const recent = receiver.lastHeartbeatAtMs || receiver.lastEventAtMs || receiver.lastConnectedAtMs;
      return ['healthy', '实时连接', recent ? `最近通信 ${formatRelativeTime(recent)}` : '服务器事件流已连接'];
    }
    if (receiver.state === 'polling') return ['degraded', '降级运行', '提醒仍可接收，但可能稍有延迟'];
    if (receiver.state === 'unsupported') return ['unavailable', '服务器未提供', '已停止频繁重试，本地设置会保留'];
    if (receiver.state === 'credential_error') return ['error', '需要重新配置', '提醒凭据已失效，请重新配置这台设备'];
    if (['connecting', 'retrying'].includes(receiver.state)) {
      const attempt = Number(receiver.consecutiveFailures || 0);
      const retry = receiver.nextRetryAtMs ? `，${formatRelativeTime(receiver.nextRetryAtMs)}重试` : '';
      return ['recovering', '正在连接', `${attempt ? `第 ${attempt} 次恢复` : '正在建立实时连接'}${retry}`];
    }
    return ['error', '需要处理', receiver.lastError?.message || '无法接收上线提醒'];
  }

  function publisherHealthView(health, settings) {
    const publisher = health.publisher || {};
    if (!settings.enabled || !settings.publishing) return ['disabled', '未分享', '这台电脑不会对外分享应用在线'];
    if (publisher.state === 'disabled' && publisher.lastError) {
      if (errorIsUnsupported(publisher.lastError)) return ['unavailable', '服务器未提供', '当前服务器无法接收应用在线状态'];
      if (publisher.lastError.transient || publisher.lastError.code === 'API_TRANSIENT') {
        return ['unavailable', '服务器暂不可用', publisher.lastError.message || '暂时无法连接应用分享服务'];
      }
      return ['error', '需要处理', publisher.lastError.message || '应用分享暂不可用'];
    }
    if (publisher.state === 'disabled') return ['disabled', '未分享', '这台电脑不会对外分享应用在线'];
    if (publisher.state === 'paused') return ['paused', '已暂停', '恢复后才会继续分享'];
    if (publisher.state === 'online') {
      const current = publisher.currentApp;
      const appKey = String(current?.appKey || '').trim().toLowerCase();
      const app = current?.displayName || current?.appKey || current;
      const catalogApp = appKey
        ? state.apps.find((entry) => String(entry?.appKey || '').trim().toLowerCase() === appKey)
        : null;
      // The catalog is the user's canonical visibility choice.  Keep this
      // defensive guard for an older Native Agent that may call a successful
      // hidden Presence "online" without inspecting the server's data.state.
      if (app && catalogApp?.isHidden === true) {
        return ['healthy', '未公开', `已检测到：${app}；“我的应用可见性”当前未公开此应用`];
      }
      return ['healthy', '分享正常', app ? `正在分享：${app}` : `最近成功 ${formatRelativeTime(publisher.lastSuccessAtMs)}`];
    }
    if (publisher.state === 'idle') {
      const detected = publisher.detectedApp;
      const appKey = String(detected?.appKey || '').trim().toLowerCase();
      const appName = detected?.displayName || detected?.appKey || detected;
      const catalogApp = appKey
        ? state.apps.find((app) => String(app?.appKey || '').trim().toLowerCase() === appKey)
        : null;
      if (appName && catalogApp?.isHidden !== false) {
        return ['healthy', '未公开', `已检测到：${appName}；“我的应用可见性”当前未公开此应用`];
      }
      if (appName) return ['healthy', '正在确认', `已检测到：${appName}；正在确认服务端公开状态`];
      return ['healthy', '等待应用', '服务已就绪，公开应用稳定打开后显示在线'];
    }
    if (publisher.state === 'unsupported') return ['unavailable', '服务器未提供', '当前服务器无法接收应用在线状态'];
    if (publisher.state === 'credential_error') return ['error', '需要重新配置', '分享凭据已失效，请重新配置这台设备'];
    if (publisher.state === 'retrying') {
      const retry = publisher.nextRetryAtMs ? `，${formatRelativeTime(publisher.nextRetryAtMs)}重试` : '';
      return ['recovering', '正在恢复', `应用分享连接正在恢复${retry}`];
    }
    return ['error', '需要处理', publisher.lastError?.message || '应用分享暂不可用'];
  }

  function overallView(health) {
    const views = {
      disabled: { title: '尚未开启', summary: '开启后可接收关注对象的应用上线提醒，并选择是否分享自己的应用。', icon: 'ph-bell-simple-slash' },
      needs_login: { title: '需要重新登录', summary: '登录状态已失效。重新登录后会安全地重新配置这台设备。', icon: 'ph-sign-in' },
      needs_enroll: { title: '需要配置这台设备', summary: '这台电脑还没有完成提醒服务配置，现有隐私设置不会被改变。', icon: 'ph-key' },
      starting: { title: '正在启动', summary: '正在准备本机提醒服务，通常只需要几秒。', icon: 'ph-spinner-gap' },
      healthy: { title: '运行正常', summary: '本机服务与服务器连接正常。你可以分别控制接收提醒和分享应用。', icon: 'ph-check-circle' },
      degraded: { title: '降级运行', summary: '提醒仍然可用，但实时连接已临时切换为轮询，通知可能稍有延迟。', icon: 'ph-warning-circle' },
      recovering: { title: '正在恢复', summary: '连接暂时中断，本地设置已保留；恢复后只同步当前稳定状态。', icon: 'ph-arrows-clockwise' },
      paused: { title: '已暂停', summary: '本次登录期间不会接收提醒或分享应用，设置仍会保留。', icon: 'ph-pause-circle' },
      unavailable: { title: '服务器暂未提供上线提醒', summary: '本机服务仍可管理，但当前服务器未部署兼容的 Activity API。已停止频繁重试，本地设置不会丢失。', icon: 'ph-cloud-slash' },
      needs_action: { title: '需要处理', summary: '提醒服务遇到无法自动恢复的问题。查看详情可确认具体原因。', icon: 'ph-warning-octagon' },
    };
    if (health.overall === 'unavailable') {
      const error = health.receiver?.lastError || health.publisher?.lastError;
      if (error?.transient || error?.code === 'API_TRANSIENT') {
        return {
          title: '服务器暂不可用',
          summary: '本机提醒服务正在运行，但服务器连接暂时失败。不会反复轮换凭据，可稍后立即检查。',
          icon: 'ph-cloud-x',
        };
      }
    }
    return views[health.overall] || views.recovering;
  }

  function contextualAction(health) {
    if (health.overall === 'disabled') return { action: 'enable', label: '开启上线提醒', icon: 'ph-power' };
    if (health.overall === 'needs_login') return { action: 'login', label: '去登录', icon: 'ph-sign-in' };
    if (health.overall === 'needs_enroll') return { action: 'provision', label: '重新配置提醒', icon: 'ph-key' };
    if (health.overall === 'paused') return { action: 'resume', label: '恢复活动功能', icon: 'ph-play' };
    if (health.overall === 'unavailable' || health.overall === 'degraded') return { action: 'check', label: '立即检查', icon: 'ph-stethoscope' };
    if (health.overall === 'needs_action') {
      const credential = health.provision?.state === 'credential_error'
        || health.receiver?.state === 'credential_error'
        || health.publisher?.state === 'credential_error';
      return credential
        ? { action: 'provision', label: '重新配置提醒', icon: 'ph-key' }
        : { action: 'repair', label: '修复提醒组件', icon: 'ph-wrench' };
    }
    return null;
  }

  function safeDiagnosticError(error) {
    const normalized = normalizeError(error);
    if (!normalized) return null;
    return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== null && value !== ''));
  }

  function buildDiagnostics(health) {
    const agent = state.agent || {};
    const memory = Number(agent.memoryBytes || 0);
    const payload = {
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      observedAt: state.observedAtMs ? new Date(state.observedAtMs).toISOString() : null,
      overall: health.overall,
      lifecycle: health.lifecycle,
      localIpc: {
        state: health.localIpc?.state,
        attempt: Number(health.localIpc?.attempt || 0),
        since: asTime(health.localIpc?.sinceMs) ? new Date(asTime(health.localIpc.sinceMs)).toISOString() : null,
        nextRetryAt: asTime(health.localIpc?.nextRetryAtMs) ? new Date(asTime(health.localIpc.nextRetryAtMs)).toISOString() : null,
        error: safeDiagnosticError(health.localIpc?.lastError),
      },
      provision: {
        state: health.provision?.state,
        deviceConfigured: health.provision?.deviceConfigured === true,
        boundToCurrentUser: health.provision?.boundToCurrentUser === true,
      },
      receiver: {
        state: health.receiver?.state,
        transport: health.receiver?.transport || null,
        consecutiveFailures: Number(health.receiver?.consecutiveFailures || 0),
        lastConnectedAt: asTime(health.receiver?.lastConnectedAtMs) ? new Date(asTime(health.receiver.lastConnectedAtMs)).toISOString() : null,
        lastHeartbeatAt: asTime(health.receiver?.lastHeartbeatAtMs) ? new Date(asTime(health.receiver.lastHeartbeatAtMs)).toISOString() : null,
        lastEventAt: asTime(health.receiver?.lastEventAtMs) ? new Date(asTime(health.receiver.lastEventAtMs)).toISOString() : null,
        nextRetryAt: asTime(health.receiver?.nextRetryAtMs) ? new Date(asTime(health.receiver.nextRetryAtMs)).toISOString() : null,
        error: safeDiagnosticError(health.receiver?.lastError),
      },
      publisher: {
        state: health.publisher?.state,
        lastSuccessAt: asTime(health.publisher?.lastSuccessAtMs) ? new Date(asTime(health.publisher.lastSuccessAtMs)).toISOString() : null,
        currentApp: health.publisher?.currentApp?.displayName || health.publisher?.currentApp?.appKey || health.publisher?.currentApp || null,
        detectedApp: health.publisher?.detectedApp?.displayName || health.publisher?.detectedApp?.appKey || health.publisher?.detectedApp || null,
        error: safeDiagnosticError(health.publisher?.lastError),
      },
      agent: {
        version: agent.agentVersion || null,
        protocolVersion: agent.protocolVersion || null,
        pid: Number(agent.pid || 0) || null,
        memoryMiB: memory ? Number((memory / 1024 / 1024).toFixed(1)) : null,
        available: agent.available !== false,
      },
      stateReadError: safeDiagnosticError(state.readError),
    };
    return JSON.stringify(payload, null, 2)
      .replace(/("(?:token|authorization|password|secret)"\s*:\s*)"[^"]*"/gi, '$1"[已隐藏]"');
  }

  function renderOnboarding() {
    const onboarding = byId('activityOnboarding');
    if (!onboarding) return;
    const provision = (displayHealth || state.health)?.provision || {};
    const firstRun = provision.everConfigured !== true
      && normalizeProvisionState(provision.state) !== 'ready'
      && !provision.deviceConfigured
      && !state.apps.length
      && !state.follows.length;
    onboarding.hidden = !firstRun;
  }

  function renderRemoteControlAvailability() {
    const health = displayHealth || state.health || defaultHealth(state.settings);
    const blocked = !state.settings.enabled || ['unavailable', 'needs_login', 'needs_enroll'].includes(health.overall);
    document.querySelectorAll?.('#page-activity .activity-remote-control').forEach((element) => {
      element.disabled = blocked;
      element.setAttribute?.('aria-disabled', blocked ? 'true' : 'false');
    });
  }

  function renderAgent() {
    const settings = state.settings || {};
    const effective = state.effectiveSettings || settings;
    const health = displayHealth || state.health || defaultHealth(settings);
    switchState(byId('activityEnabledSwitch'), settings.enabled, false, pendingSettings.has('enabled'));
    switchState(byId('activityPublishingSwitch'), settings.publishing, !settings.enabled, pendingSettings.has('publishing'));
    switchState(byId('activitySnapshotsSwitch'), settings.snapshots, !settings.enabled || !settings.publishing, pendingSettings.has('snapshots'));
    switchState(byId('activityBackgroundSwitch'), settings.background, !settings.enabled, pendingSettings.has('background'));
    switchState(byId('activityAutoStartSwitch'), settings.autoStart, !settings.enabled || !settings.background, pendingSettings.has('autoStart'));

    const view = overallView(health);
    const card = byId('activityHealthCard');
    if (card) card.dataset.tone = health.overall;
    const title = byId('activityHealthTitle');
    if (title) title.textContent = view.title;
    const legacyBadge = byId('activityAgentBadge');
    if (legacyBadge) legacyBadge.textContent = view.title;
    const summary = byId('activityHealthSummary');
    if (summary) summary.textContent = view.summary;
    const icon = byId('activityHealthIcon');
    if (icon) icon.innerHTML = `<i class="ph ${escapeHtml(view.icon)}"></i>`;
    const freshness = byId('activityHealthFreshness');
    if (freshness) {
      freshness.textContent = state.readError
        ? `暂时无法确认服务状态，上次确认于 ${formatRelativeTime(state.observedAtMs)}`
        : state.observedAtMs
          ? `上次检查：${formatRelativeTime(state.observedAtMs)}`
          : '等待首次检查';
    }

    setHealthRow('Local', ...localHealthView(health, settings));
    setHealthRow('Receiver', ...receiverHealthView(health, settings));
    setHealthRow('Publisher', ...publisherHealthView(health, settings));

    const action = contextualAction(health);
    const actionButton = byId('activityHealthActionBtn');
    const refreshButton = byId('activityHealthRefreshBtn');
    if (actionButton) {
      actionButton.hidden = !action;
      actionButton.disabled = pendingSettings.size > 0;
      actionButton.dataset.healthAction = action?.action || '';
      actionButton.innerHTML = action ? `<i class="ph ${escapeHtml(action.icon)}"></i><span>${escapeHtml(action.label)}</span>` : '';
    }
    if (refreshButton) refreshButton.hidden = action?.action === 'check';

    diagnosticsText = buildDiagnostics(health);
    const diagnostics = byId('activityDiagnosticsContent');
    if (diagnostics) diagnostics.textContent = diagnosticsText;
    const announcer = byId('activityHealthAnnouncer');
    const announcement = `${view.title}。${view.summary}`;
    if (announcer && announcement !== lastAnnouncement) {
      announcer.textContent = announcement;
      lastAnnouncement = announcement;
    }

    const pauseButton = byId('activityPauseBtn');
    if (pauseButton) {
      const paused = health.lifecycle === 'paused' || health.receiver?.state === 'paused';
      pauseButton.disabled = !settings.enabled;
      pauseButton.innerHTML = paused
        ? '<i class="ph ph-play"></i> 恢复活动功能'
        : '<i class="ph ph-pause"></i> 临时暂停';
      pauseButton.dataset.paused = paused ? '1' : '0';
    }
    const effectiveHint = byId('activityEffectiveSettingsHint');
    if (effectiveHint) {
      effectiveHint.textContent = pendingSettings.size
        ? '正在保存设置…'
        : effective.enabled
          ? `当前生效：接收提醒${effective.publishing ? ' · 分享应用' : ''}${effective.background ? ' · 后台运行' : ''}`
          : '当前未启用上线提醒';
    }
    renderOnboarding();
    renderRemoteControlAvailability();
  }

  function renderPrivacy() {
    const unavailable = remoteActionsDisabled();
    document.querySelectorAll('#activityPrivacyOptions [data-visibility]').forEach((button) => {
      const active = button.dataset.visibility === state.visibility;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.disabled = unavailable;
      button.setAttribute('aria-disabled', unavailable ? 'true' : 'false');
    });
  }

  function remoteActionsDisabled() {
    const overall = (displayHealth || state.health)?.overall;
    return !state.settings.enabled || ['unavailable', 'needs_login', 'needs_enroll'].includes(overall);
  }

  function remoteDisabledAttribute() {
    return remoteActionsDisabled() ? ' disabled aria-disabled="true"' : '';
  }

  function userRow(user, actions = '') {
    const username = user?.username || '未知用户';
    const initial = escapeHtml(String(username || '?').slice(0, 1).toUpperCase());
    const avatar = user?.avatar
      ? `<img src="${escapeHtml(user.avatar)}" alt="${escapeHtml(username)}头像" data-avatar-fallback="initial" data-avatar-name="${escapeHtml(username)}">`
      : `<span class="activity-avatar-fallback" aria-hidden="true">${initial}</span>`;
    return `<div class="activity-user-avatar">${avatar}</div>
      <div class="activity-user-copy" title="${escapeHtml(username)}"><strong>${escapeHtml(username)}</strong><small>UID ${escapeHtml(user?.id)}</small></div>
      <div class="activity-row-actions">${actions}</div>`;
  }

  function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  }

  function interactiveToken(element, index) {
    if (!element) return `control:${index}`;
    if (element.id) return `id:${element.id}`;
    if (element.dataset?.field) return `field:${element.dataset.field}`;
    const action = element.dataset?.action;
    if (action) {
      const identity = element.dataset.ruleId || element.dataset.appKey
        || element.dataset.followId || element.dataset.userId || index;
      return `action:${action}:${identity}`;
    }
    return `${String(element.tagName || 'control').toLowerCase()}:${index}`;
  }

  function captureInteractiveState(node) {
    const controls = Array.from(node.querySelectorAll?.('input, textarea, select, button, [tabindex]') || []);
    return controls.map((control, index) => ({
      token: interactiveToken(control, index),
      value: 'value' in control ? control.value : undefined,
      checked: 'checked' in control ? control.checked : undefined,
      selectionStart: Number.isInteger(control.selectionStart) ? control.selectionStart : null,
      selectionEnd: Number.isInteger(control.selectionEnd) ? control.selectionEnd : null,
      active: document.activeElement === control,
    }));
  }

  function restoreInteractiveState(node, saved = []) {
    const controls = Array.from(node.querySelectorAll?.('input, textarea, select, button, [tabindex]') || []);
    const byToken = new Map(controls.map((control, index) => [interactiveToken(control, index), control]));
    saved.forEach((entry) => {
      const control = byToken.get(entry.token);
      if (!control) return;
      if (entry.value !== undefined && 'value' in control) control.value = entry.value;
      if (entry.checked !== undefined && 'checked' in control) control.checked = entry.checked;
      if (entry.active) {
        control.focus?.({ preventScroll: true });
        if (entry.selectionStart !== null && control.setSelectionRange) {
          control.setSelectionRange(entry.selectionStart, entry.selectionEnd ?? entry.selectionStart);
        }
      }
    });
  }

  function elementFromHtml(html) {
    if (typeof document.createElement !== 'function') return null;
    const template = document.createElement('template');
    template.innerHTML = String(html || '').trim();
    return template.content?.firstElementChild || template.firstElementChild || null;
  }

  function reconcileKeyedList(root, items, { key, render, emptyHtml, emptyKey }) {
    if (!root) return;
    const entries = items.map((item, index) => {
      const itemKey = String(key(item, index));
      return { itemKey, html: render(item, itemKey, index) };
    });
    root.classList?.toggle?.('is-empty', entries.length === 0);
    const countTarget = root.dataset?.countTarget;
    const countElement = countTarget ? byId(countTarget) : null;
    if (countElement) {
      countElement.textContent = String(entries.length);
      countElement.setAttribute?.('aria-label', `${entries.length} 项`);
    }
    const canReconcile = typeof root.insertBefore === 'function'
      && root.children
      && typeof document.createElement === 'function';

    if (!canReconcile) {
      root.innerHTML = entries.length ? entries.map((entry) => entry.html).join('') : emptyHtml;
      return;
    }
    if (!entries.length) {
      const nextEmptyKey = String(emptyKey || emptyHtml);
      if (root.dataset.activityEmptyKey !== nextEmptyKey) root.innerHTML = emptyHtml;
      root.dataset.activityEmptyKey = nextEmptyKey;
      return;
    }

    delete root.dataset.activityEmptyKey;
    const scrollTop = root.scrollTop;
    const oldNodes = new Map(Array.from(root.children)
      .filter((node) => node.dataset?.activityKey)
      .map((node) => [node.dataset.activityKey, node]));
    const oldRects = new Map(Array.from(oldNodes, ([itemKey, node]) => (
      [itemKey, node.getBoundingClientRect?.()]
    )));
    const nextKeySet = new Set(entries.map((entry) => entry.itemKey));
    const nextNodes = entries.map(({ itemKey, html }) => {
      const existing = oldNodes.get(itemKey);
      if (!existing) {
        const added = elementFromHtml(html);
        if (!added) return null;
        added.dataset.activityKey = itemKey;
        added._activityRenderHtml = html;
        added.classList.add('activity-keyed-enter');
        added.addEventListener?.('animationend', () => added.classList.remove('activity-keyed-enter'), { once: true });
        return added;
      }
      if (existing.dataset.activityLeaving === 'true') {
        delete existing.dataset.activityLeaving;
        existing.removeAttribute?.('aria-hidden');
        if ('inert' in existing) existing.inert = false;
        existing.removeAttribute?.('inert');
        existing.getAnimations?.().forEach((animation) => animation.cancel());
      }
      if (existing._activityRenderHtml !== html) {
        const replacement = elementFromHtml(html);
        if (replacement) {
          const saved = captureInteractiveState(existing);
          existing.className = replacement.className;
          existing.innerHTML = replacement.innerHTML;
          Array.from(existing.attributes || []).forEach((attribute) => {
            if (attribute.name !== 'class' && attribute.name !== 'data-activity-key') {
              existing.removeAttribute(attribute.name);
            }
          });
          Array.from(replacement.attributes || []).forEach((attribute) => {
            if (attribute.name !== 'class') existing.setAttribute(attribute.name, attribute.value);
          });
          restoreInteractiveState(existing, saved);
        }
        existing._activityRenderHtml = html;
      }
      existing.dataset.activityKey = itemKey;
      return existing;
    }).filter(Boolean);

    const shouldAnimate = !prefersReducedMotion();
    const nextNodeSet = new Set(nextNodes);
    oldNodes.forEach((node, itemKey) => {
      if (nextKeySet.has(itemKey) || node.dataset.activityLeaving === 'true') return;
      if (!shouldAnimate || typeof node.animate !== 'function') {
        node.remove?.();
        return;
      }
      node.dataset.activityLeaving = 'true';
      node.setAttribute?.('aria-hidden', 'true');
      if ('inert' in node) node.inert = true;
      node.setAttribute?.('inert', '');
      root.appendChild(node);
      const removal = node.animate([
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-4px)' },
      ], { duration: 180, easing: 'ease-out', fill: 'forwards' });
      const removeWhenDone = () => {
        if (node.dataset.activityLeaving === 'true') node.remove?.();
      };
      removal?.finished?.then(removeWhenDone, removeWhenDone);
      if (!removal?.finished) window.setTimeout(removeWhenDone, 200);
    });

    // Remove placeholders and any stale non-animated nodes before placing the
    // retained keyed nodes. Leaving nodes remain at the end until their fade
    // completes, so the list does not replay or lose focus on every update.
    Array.from(root.children).forEach((node) => {
      if (!nextNodeSet.has(node) && node.dataset.activityLeaving !== 'true') node.remove?.();
    });
    nextNodes.forEach((node, index) => {
      const current = root.children[index] || null;
      if (current !== node) root.insertBefore(node, current);
    });
    root.scrollTop = scrollTop;
    if (!shouldAnimate) return;
    nextNodes.forEach((node) => {
      const first = oldRects.get(node.dataset.activityKey);
      const last = node.getBoundingClientRect?.();
      if (!first || !last || typeof node.animate !== 'function') return;
      const x = first.left - last.left;
      const y = first.top - last.top;
      if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
      node.animate([
        { transform: `translate(${x}px, ${y}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration: 220, easing: 'cubic-bezier(.2, 0, 0, 1)' });
    });
  }

  function renderSearchResults(users = []) {
    const root = byId('activitySearchResults');
    if (!root) return;
    reconcileKeyedList(root, users, {
      key: (user) => user.id,
      render: (user, itemKey) => `<div class="activity-list-row" data-activity-key="${escapeHtml(itemKey)}">
        ${userRow(user, `<button class="action-btn x-small primary-border activity-remote-control" type="button" data-action="follow" data-user-id="${escapeHtml(user.id)}" aria-label="关注 ${escapeHtml(user.username || `UID ${user.id}`)}"${remoteDisabledAttribute()}><i class="ph ph-user-plus"></i> 关注</button>`)}
      </div>`,
      emptyHtml: '<div class="activity-empty">没有找到匹配的用户</div>',
      emptyKey: 'search-empty',
    });
  }

  function renderSearchMessage(message, tone = '') {
    const root = byId('activitySearchResults');
    if (!root) return;
    root.innerHTML = `<div class="activity-empty ${escapeHtml(tone)}">${escapeHtml(message)}</div>`;
  }

  function setButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    window._nekoUIHelpers?.setButtonBusy?.(button, busy, { label: busyLabel || '处理中…' });
  }

  function queryTargetsSelf(query = '') {
    const text = String(query || '').trim();
    const currentId = Number(state.currentUserId || 0);
    if (currentId > 0) {
      const uidMatch = text.match(/^#?(\d+)$/);
      if (uidMatch && Number(uidMatch[1]) === currentId) return true;
    }
    return !!state.currentUsername && text.toLowerCase() === String(state.currentUsername).toLowerCase();
  }

  function resetBusinessState() {
    businessEpoch += 1;
    businessRequestRevision += 1;
    followsRequestRevision += 1;
    // Account/server changes invalidate queued UI writes as well as reads.  Without
    // this, a toggle queued for the previous identity could be submitted after the
    // first in-flight save settles and accidentally become the new account's change.
    pendingSettingsPatch = {};
    pendingSettings.clear();
    businessLoaded = false;
    state.follows = [];
    state.followers = [];
    state.apps = [];
    state.blocks = [];
    state.visibility = 'private';
    state.partialFailures = [];
    Object.keys(state.sectionStatus).forEach((key) => { state.sectionStatus[key] = 'idle'; });
  }

  async function loadCurrentUser() {
    const readRevision = ++authReadRevision;
    try {
      const auth = await window._nekoModules?.services?.AuthClient?.getState?.();
      if (readRevision !== authReadRevision) return false;
      const user = auth?.user || auth?.authUser || null;
      const nextUserId = Number(user?.id || user?.uid || 0) || null;
      const changed = state.currentUserId !== null && state.currentUserId !== nextUserId;
      if (changed) resetBusinessState();
      state.currentUserId = nextUserId;
      state.currentUsername = user?.username || '';
      return changed;
    } catch {}
    return false;
  }

  function handleAuthChange(event) {
    authReadRevision += 1;
    const user = event?.detail?.user || null;
    const nextUserId = Number(user?.id || user?.uid || 0) || null;
    const changed = state.currentUserId !== nextUserId;
    if (changed || event?.detail?.loggedIn === false) resetBusinessState();
    state.currentUserId = nextUserId;
    state.currentUsername = user?.username || '';
    renderAll();
    if (pageActive) {
      refreshData(true).finally(() => {
        scheduleHealthPoll();
        scheduleFollowsPoll();
      });
    }
  }

  function renderFollows() {
    const root = byId('activityFollowsList');
    if (!root) return;
    reconcileKeyedList(root, state.follows, {
      key: (follow) => follow.id ?? follow.user?.id,
      render: (follow, itemKey) => {
        const online = follow.activeSessions || [];
        const onlineHtml = online.length ? online.map((session) => {
          const devices = (session.devices || []).map((device) => device.name).join('、') || '未知设备';
          return `<div class="activity-online-pill" title="${escapeHtml(session.displayName)} · ${escapeHtml(devices)}"><i class="ph ph-circle"></i><strong>${escapeHtml(session.displayName)}</strong>
            <span>已在线 ${formatDuration(session.startedAt)} · ${escapeHtml(devices)}</span></div>`;
        }).join('') : `<div class="activity-offline-copy">${follow.allowed ? '当前没有匹配规则的应用在线' : '对方未向你开放活动状态'}</div>`;
        const rules = (follow.rules || []).map((rule) => `<div class="activity-rule-chip">
          <span title="${escapeHtml(rule.displayName)} · ${escapeHtml(rule.appKey)}">${escapeHtml(rule.displayName)} <small>${escapeHtml(rule.appKey)}</small></span>
          <button class="activity-remote-control" type="button" data-action="delete-rule" data-rule-id="${escapeHtml(rule.id)}" title="删除规则" aria-label="删除 ${escapeHtml(rule.displayName)} 的提醒规则"${remoteDisabledAttribute()}><i class="ph ph-x"></i></button>
        </div>`).join('');
        const catalog = (follow.catalog || []).map((app) => `<button class="activity-catalog-option activity-remote-control" type="button" data-action="catalog-rule" title="为 ${escapeHtml(app.displayName)} 开启上线提醒"
          data-follow-id="${escapeHtml(follow.id)}" data-app-key="${escapeHtml(app.appKey)}" data-display-name="${escapeHtml(app.displayName)}">
          <i class="ph ph-bell-ringing"></i> ${escapeHtml(app.displayName)} <small>${escapeHtml(app.appKey)}</small></button>`).join('');
        const catalogHtml = catalog || (follow.catalogLoaded ? '<div class="activity-empty compact">对方还没有公开可提醒的应用</div>' : '');
        return `<article class="activity-follow-card" data-activity-key="${escapeHtml(itemKey)}" data-follow-id="${escapeHtml(follow.id)}">
          <div class="activity-list-row activity-follow-head">
            ${userRow(follow.user, `<button class="action-btn x-small activity-remote-control" type="button" data-action="unfollow" data-follow-id="${escapeHtml(follow.id)}"${remoteDisabledAttribute()}>取消关注</button>`)}
          </div>
          <div class="activity-online-state">${onlineHtml}</div>
          <div class="activity-rules">${rules || '<span class="activity-empty compact">尚未设置应用规则，不会发送提醒</span>'}</div>
          <div class="activity-rule-editor">
            <button class="action-btn x-small primary activity-remote-control" type="button" data-action="load-catalog" data-follow-id="${escapeHtml(follow.id)}"${remoteDisabledAttribute()}>选择对方公开的应用</button>
            <input class="activity-input activity-remote-control" data-field="app-key" aria-label="对方公开的应用进程名" placeholder="高级：手动输入对方已公开的 .exe"${remoteDisabledAttribute()}>
            <input class="activity-input activity-remote-control" data-field="display-name" aria-label="提醒显示名称" placeholder="提醒名称（可选）"${remoteDisabledAttribute()}>
            <button class="action-btn x-small activity-remote-control" type="button" data-action="create-rule" data-follow-id="${escapeHtml(follow.id)}"${remoteDisabledAttribute()}>手动添加</button>
          </div>
          <div class="activity-catalog-list">${catalogHtml}</div>
        </article>`;
      },
      emptyHtml: '<div class="activity-empty">暂无关注用户，先在上方搜索吧。</div>',
      emptyKey: 'follows-empty',
    });
  }

  function renderFollowers() {
    const root = byId('activityFollowersList');
    if (!root) return;
    reconcileKeyedList(root, state.followers, {
      key: (item) => item.user?.id ?? item.id,
      render: (item, itemKey) => `<div class="activity-list-row" data-activity-key="${escapeHtml(itemKey)}">
        ${userRow(item.user, `<button class="action-btn x-small danger activity-remote-control" type="button" data-action="block" data-user-id="${escapeHtml(item.user.id)}"${remoteDisabledAttribute()}><i class="ph ph-prohibit"></i> 拉黑</button>`)}
      </div>`,
      emptyHtml: '<div class="activity-empty">暂无关注者</div>',
      emptyKey: 'followers-empty',
    });
  }

  function renderApps() {
    const root = byId('activityAppsList');
    if (!root) return;
    reconcileKeyedList(root, state.apps, {
      key: (app) => app.appKey,
      render: (app, itemKey) => {
        const isPublic = app.isHidden === false;
        const locallyDetected = app.detected === true && app.source === 'local-detected';
        return `<div class="activity-list-row" data-activity-key="${escapeHtml(itemKey)}">
          <div class="activity-app-icon"><i class="ph ph-app-window"></i></div>
          <div class="activity-user-copy" title="${escapeHtml(app.displayName)}"><strong>${escapeHtml(app.displayName)}</strong><small>${escapeHtml(app.appKey)}${locallyDetected ? ' · 本机检测' : ''}</small></div>
          <span class="activity-app-visibility ${isPublic ? 'public' : 'private'}">${isPublic ? '已公开' : '未公开'}</span>
          <button class="action-btn x-small activity-remote-control ${isPublic ? '' : 'primary-border'}" type="button" data-action="toggle-app" data-app-key="${escapeHtml(app.appKey)}" data-display-name="${escapeHtml(app.displayName)}" data-hidden="${app.isHidden ? '1' : '0'}" data-local-detected="${locallyDetected ? '1' : '0'}" aria-label="${isPublic ? '停止公开' : '公开'} ${escapeHtml(app.displayName)}"${remoteDisabledAttribute()}>
            ${isPublic ? '停止公开' : '公开'}
          </button>
        </div>`;
      },
      emptyHtml: '<div class="activity-empty">还没有公开应用。你可以从已打开的窗口中选择应用，也可以手动输入规范化 .exe 进程名。</div>',
      emptyKey: 'apps-empty',
    });
  }

  function renderBlocks() {
    const root = byId('activityBlocksList');
    if (!root) return;
    reconcileKeyedList(root, state.blocks, {
      key: (item) => item.user?.id ?? item.id,
      render: (item, itemKey) => `<div class="activity-list-row" data-activity-key="${escapeHtml(itemKey)}">
        ${userRow(item.user, `<button class="action-btn x-small activity-remote-control" type="button" data-action="unblock" data-user-id="${escapeHtml(item.user.id)}"${remoteDisabledAttribute()}>解除拉黑</button>`)}
      </div>`,
      emptyHtml: '<div class="activity-empty">暂无拉黑用户</div>',
      emptyKey: 'blocks-empty',
    });
  }

  function renderSectionDataStatus() {
    const setStatus = (id, keys) => {
      const element = byId(id);
      if (!element) return;
      const statuses = keys.map((key) => state.sectionStatus[key]);
      const hasError = statuses.includes('error');
      const hasStale = statuses.includes('stale');
      element.hidden = !hasError && !hasStale;
      element.textContent = hasError ? '部分数据加载失败，显示上次内容' : hasStale ? '正在显示缓存数据' : '';
    };
    setStatus('activityReceiveDataStatus', ['follows']);
    setStatus('activityShareDataStatus', ['apps', 'privacy']);
    setStatus('activityPeopleDataStatus', ['followers', 'blocks']);
  }

  function renderAll() {
    renderAgent(); renderPrivacy(); renderFollows(); renderFollowers(); renderApps(); renderBlocks(); renderSectionDataStatus();
    renderRemoteControlAvailability();
  }

  async function refreshAgent(silent = false) {
    let result;
    try {
      result = await client()?.getState?.();
    } catch (error) {
      result = { ok: false, code: error?.code, message: error?.message };
    }
    if (!result || failed(result)) {
      const message = errorText(result, '无法读取活动代理状态');
      const code = result?.code || result?.error?.code || 'ACTIVITY_STATE_FAILED';
      const explicitLocalFailure = code === 'AGENT_MISSING'
        || /PROTOCOL|INCOMPATIBLE|EXECUTABLE|SPAWN_FAILED/.test(String(code).toUpperCase());
      state.readError = normalizeError({
        code,
        message,
        transient: !explicitLocalFailure,
        atMs: Date.now(),
      });
      state.agent = {
        ...state.agent,
        state: explicitLocalFailure ? 'error' : state.agent?.state,
        connection: state.agent?.connection || 'unknown',
        available: code === 'AGENT_MISSING' ? false : state.agent?.available,
        code,
        message,
      };
      if (explicitLocalFailure || !displayHealth) {
        state.observedAtMs = state.observedAtMs || Date.now();
        state.health = normalizeV2Health({
          ...(state.health || defaultHealth(state.settings)),
          overall: 'needs_action',
          lifecycle: 'error',
          localIpc: {
            ...(state.health?.localIpc || {}),
            state: 'error',
            lastError: { code, message, transient: false, atMs: Date.now() },
          },
        }, state.settings);
        setDisplayedHealth(state.health, { immediate: true });
      }
      renderAgent();
      if (!silent) notify(errorText(result, '无法读取活动代理状态'), 'error');
      return result;
    }
    if (applyActivitySnapshot(result)) renderAgent();
    return result;
  }

  async function refreshData(silent = false, { forceBusiness = false } = {}) {
    const requestEpoch = businessEpoch;
    const requestRevision = ++businessRequestRevision;
    // Invalidate an in-flight follows-only poll. Its response must not land
    // after this full bootstrap or a mutation-triggered refresh.
    followsRequestRevision += 1;
    const requestIsCurrent = () => requestEpoch === businessEpoch
      && requestRevision === businessRequestRevision;
    const agentResult = await refreshAgent(silent);
    if (!requestIsCurrent()) return { superseded: true };
    if (!state.settings.enabled) {
      renderAll();
      return { disabled: true };
    }
    if (['unavailable', 'needs_login'].includes((displayHealth || state.health)?.overall) && !forceBusiness) {
      renderAll();
      return agentResult || { unavailable: true };
    }
    const result = await client()?.bootstrap?.();
    if (!requestIsCurrent()) return { superseded: true };
    if (!result || failed(result)) {
      Object.keys(state.sectionStatus).forEach((key) => {
        state.sectionStatus[key] = ['fresh', 'stale'].includes(state.sectionStatus[key]) ? 'stale' : 'error';
      });
      state.partialFailures = Object.keys(state.sectionStatus).map((section) => ({ section }));
      renderAll();
      renderPartialLoadStatus();
      if (!silent) notify(errorText(result, '无法加载关注动态'), 'error');
      return result;
    }
    normalizeBootstrap(result);
    businessLoaded = true;
    renderAll();
    renderPartialLoadStatus();
    return result;
  }

  async function drainSettingsQueue() {
    let enabledTransition = false;
    let success = true;
    while (Object.keys(pendingSettingsPatch).length) {
      const patch = pendingSettingsPatch;
      pendingSettingsPatch = {};
      const requested = { ...state.settings };
      enabledTransition = enabledTransition || (patch.enabled === true && confirmedSettings.enabled !== true);
      try {
        const result = await client()?.updateSettings?.(requested);
        if (!result || failed(result)) throw new Error(errorText(result, '设置未能保存'));
        if (!applyActivitySnapshot(result, { immediate: true })) {
          state.settings = { ...requested, ...(result.settings || {}) };
          state.effectiveSettings = deriveEffectiveSettings(state.settings, result.effectiveSettings || {});
          confirmedSettings = { ...state.settings };
        }
        if (Object.keys(pendingSettingsPatch).length) {
          state.settings = { ...state.settings, ...pendingSettingsPatch };
        }
        Object.keys(patch).forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(pendingSettingsPatch, key)) pendingSettings.delete(key);
        });
      } catch (error) {
        success = false;
        pendingSettingsPatch = {};
        pendingSettings.clear();
        state.settings = { ...confirmedSettings };
        state.effectiveSettings = deriveEffectiveSettings(confirmedSettings);
        notify(error.message || '设置未能保存', 'error');
        setPageStatus('保存失败，已恢复到上一次设置。', 'error');
        await refreshAgent(true);
        break;
      }
    }
    if (success) {
      setPageStatus('设置已保存。', 'success');
      notify('设置已保存', 'success');
      if (enabledTransition && state.settings.enabled) await refreshData(true);
      window.setTimeout(() => {
        const status = byId('activityPageStatus');
        if (status?.dataset?.tone === 'success') setPageStatus('');
      }, 2200);
    }
    renderAll();
    scheduleHealthPoll();
    return success;
  }

  function updateSettings(changes) {
    Object.assign(pendingSettingsPatch, changes);
    Object.keys(changes).forEach((key) => pendingSettings.add(key));
    state.settings = { ...state.settings, ...changes };
    state.effectiveSettings = deriveEffectiveSettings(state.settings);
    renderAgent();
    setPageStatus('正在保存设置；可继续调整，其余更改会按顺序保存。', 'loading');
    if (!settingsSavePromise) {
      settingsSavePromise = drainSettingsQueue().finally(() => {
        settingsSavePromise = null;
        renderAgent();
      });
    }
    return settingsSavePromise;
  }

  function bindSwitch(id, settingKey) {
    const element = byId(id);
    if (!element) return;
    const activate = () => {
      if (element.classList.contains('disabled') || element.classList.contains('loading')) return;
      updateSettings({ [settingKey]: !state.settings[settingKey] });
    };
    element.addEventListener('click', activate);
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    if (!action) return;
    if (!confirmActivityDanger(action, button)) return;
    button.disabled = true;
    try {
      let result;
      if (action === 'follow' && Number(button.dataset.userId) === Number(state.currentUserId)) {
        throw new Error('不能关注自己。你可以搜索其他用户。');
      }
      if (action === 'follow') result = await client().follow(Number(button.dataset.userId));
      if (action === 'unfollow') result = await client().unfollow(button.dataset.followId);
      if (action === 'delete-rule') result = await client().deleteRule(button.dataset.ruleId);
      if (action === 'block') result = await client().block(Number(button.dataset.userId));
      if (action === 'unblock') result = await client().unblock(Number(button.dataset.userId));
      if (action === 'toggle-app') {
        const shouldPublishLocalCandidate = button.dataset.localDetected === '1'
          && button.dataset.hidden === '1';
        result = shouldPublishLocalCandidate
          ? await client().upsertApp({
              appKey: button.dataset.appKey,
              displayName: button.dataset.displayName,
            })
          : await client().setAppHidden(
              button.dataset.appKey,
              button.dataset.hidden !== '1',
              button.dataset.displayName,
            );
      }
      if (action === 'create-rule') {
        const card = button.closest('.activity-follow-card');
        const appKey = card?.querySelector('[data-field="app-key"]')?.value?.trim();
        const displayName = card?.querySelector('[data-field="display-name"]')?.value?.trim();
        result = await client().createRule({ followId: button.dataset.followId, appKey, displayName });
      }
      if (action === 'load-catalog') {
        const follow = state.follows.find((item) => String(item.id) === String(button.dataset.followId));
        if (!follow) throw new Error('找不到这条关注记录，请刷新后重试。');
        result = await client().getApps(follow?.user?.id);
        if (!result || failed(result)) throw new Error(errorText(result, '无法加载对方公开的应用'));
        follow.catalog = result.apps || [];
        follow.catalogLoaded = true;
        renderFollows();
        renderRemoteControlAvailability();
        return;
      }
      if (action === 'catalog-rule') {
        result = await client().createRule({
          followId: button.dataset.followId,
          appKey: button.dataset.appKey,
          displayName: button.dataset.displayName,
        });
      }
      if (!result || failed(result)) throw new Error(errorText(result, '操作失败'));
      await refreshData(true);
      const actionMessages = {
        follow: '已关注，可以为对方公开的应用设置提醒。',
        unfollow: '已取消关注。',
        'delete-rule': '提醒规则已删除。',
        block: '已拉黑，双方的关注动态已撤销。',
        unblock: '已解除拉黑。',
        'toggle-app': button.dataset.hidden === '1' ? '已公开此应用。' : '已停止公开此应用。',
        'create-rule': '提醒规则已添加。',
        'catalog-rule': '提醒规则已添加。',
      };
      notify(actionMessages[action] || '操作已完成', 'success');
    } catch (error) {
      notify(error.message || '操作失败', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function displayNameFromProcess(processName = '') {
    return String(processName || '').replace(/\.exe$/i, '').replace(/[-_]+/g, ' ').trim();
  }

  async function pickActivityAppForComposer() {
    const button = byId('activityActiveAppBtn');
    if (button) button.disabled = true;
    try {
      const selected = await window._nekoModules?.services?.SystemClient?.pickActivityAppWindow?.();
      if (!selected) {
        notify('已取消选择。', 'info');
        return;
      }
      const processName = String(selected?.processName || '').trim();
      if (!processName) {
        notify('没有读到这个窗口的进程名，请手动输入 .exe 进程名。', 'warn');
        return;
      }
      const appKeyInput = byId('activityAppKeyInput');
      const appNameInput = byId('activityAppNameInput');
      if (appKeyInput) appKeyInput.value = processName;
      if (appNameInput && !appNameInput.value.trim()) appNameInput.value = displayNameFromProcess(processName);
      const advanced = byId('activityAdvancedComposer');
      const advancedTrigger = byId('activityAdvancedComposerToggle');
      setActivityExpandable(advanced, true, { trigger: advancedTrigger });
      appNameInput?.focus?.();
      notify('已选择应用。确认名称后点击“公开此应用”。', 'success');
    } catch (error) {
      notify(error.message || '选择应用失败，请手动输入。', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function addPublicAppFromComposer() {
    const button = byId('activityAddAppBtn');
    const appKey = byId('activityAppKeyInput')?.value?.trim();
    const displayName = byId('activityAppNameInput')?.value?.trim();
    if (!appKey) {
      notify('请输入要公开的 .exe 进程名。', 'warn');
      byId('activityAppKeyInput')?.focus?.();
      return;
    }
    if (button) button.disabled = true;
    try {
      const result = await client()?.upsertApp?.({ appKey, displayName });
      if (!result || failed(result)) throw new Error(errorText(result, '公开应用失败'));
      await refreshData(true);
      if (byId('activityAppKeyInput')) byId('activityAppKeyInput').value = '';
      if (byId('activityAppNameInput')) byId('activityAppNameInput').value = '';
      setActivityExpandable(byId('activityAdvancedComposer'), false, {
        trigger: byId('activityAdvancedComposerToggle'),
      });
      notify('已公开此应用。关注你的人现在可以为它设置提醒。', 'success');
    } catch (error) {
      notify(error.message || '公开应用失败', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function handleRefreshButton(button) {
    setButtonBusy(button, true, '刷新中');
    setPageStatus('正在检查提醒服务和关注数据。', 'loading');
    try {
      const result = await refreshData(false, { forceBusiness: true });
      if (!result || failed(result)) {
        setPageStatus('刷新失败，请稍后再试。', 'error');
        notify(errorText(result, '刷新失败，请稍后再试'), 'error');
        return;
      }
      if (state.partialFailures.length) {
        renderPartialLoadStatus();
        notify('部分数据暂时无法刷新，已保留上次内容', 'warn');
      } else {
        setPageStatus('提醒服务和关注数据已刷新。', 'success');
        notify('提醒服务和关注数据已刷新', 'success');
      }
      window.setTimeout(() => setPageStatus(''), 1800);
    } catch (error) {
      notify(error.message || '刷新失败', 'error');
      setPageStatus('刷新失败，请稍后再试。', 'error');
    } finally {
      setButtonBusy(button, false);
      scheduleHealthPoll();
    }
  }

  async function handleRepairButton(button, { checkOnly = false } = {}) {
    setButtonBusy(button, true, checkOnly ? '检查中' : '修复中');
    setPageStatus(checkOnly ? '正在检查服务器与后台提醒服务。' : '正在重新准备后台提醒。', 'loading');
    try {
      const result = await client()?.provisionAgent?.();
      if (!result || failed(result)) throw new Error(errorText(result, checkOnly ? '服务器状态检查失败' : '后台提醒修复失败'));
      applyActivitySnapshot(result, { immediate: true });
      notify(checkOnly ? '服务器状态检查完成' : '后台提醒已重新准备好', 'success');
      setPageStatus(checkOnly ? '服务器状态检查完成。' : '后台提醒已重新准备好。', 'success');
      await refreshData(true, { forceBusiness: checkOnly });
      window.setTimeout(() => setPageStatus(''), 2200);
    } catch (error) {
      notify(error.message || (checkOnly ? '服务器状态检查失败' : '后台提醒修复失败'), 'error');
      setPageStatus(checkOnly
        ? '服务器仍未提供兼容的上线提醒服务，请稍后再检查。'
        : '后台提醒修复失败，请检查登录状态和服务器连接。', 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function handlePauseButton(button) {
    const paused = button.dataset.paused === '1';
    setButtonBusy(button, true, paused ? '恢复中' : '暂停中');
    setPageStatus(paused ? '正在恢复活动提醒。' : '正在临时暂停活动提醒。', 'loading');
    try {
      const result = paused ? await client()?.resumeAgent?.() : await client()?.pauseAgent?.();
      if (!result || failed(result)) throw new Error(errorText(result, '状态切换失败'));
      applyActivitySnapshot(result, { immediate: true });
      notify(paused ? '活动提醒已恢复' : '活动提醒已临时暂停', 'success');
      setPageStatus(paused ? '活动提醒已恢复。' : '活动提醒已临时暂停。', 'success');
      await refreshAgent(true);
      window.setTimeout(() => setPageStatus(''), 2000);
    } catch (error) {
      notify(error.message || '状态切换失败', 'error');
      setPageStatus('状态切换失败，请稍后再试。', 'error');
      await refreshAgent(true);
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function handleHealthAction(button) {
    const action = button.dataset.healthAction;
    if (!action) return;
    if (action === 'enable') {
      activateActivitySection('background');
      await updateSettings({ enabled: true });
      return;
    }
    if (action === 'login') {
      window._nekoModules?.pages?.AuthPage?.openAuthModal?.('login');
      return;
    }
    if (action === 'resume') {
      button.dataset.paused = '1';
      await handlePauseButton(button);
      return;
    }
    if (action === 'check') {
      await handleRepairButton(button, { checkOnly: true });
      return;
    }
    if (action === 'provision' || action === 'repair') await handleRepairButton(button);
  }

  async function copyDiagnostics(button) {
    if (!diagnosticsText) return;
    setButtonBusy(button, true, '复制中');
    try {
      if (!window.navigator?.clipboard?.writeText) throw new Error('系统剪贴板不可用');
      await window.navigator.clipboard.writeText(diagnosticsText);
      notify('诊断信息已复制（不包含登录凭据）', 'success');
    } catch (error) {
      notify(error.message || '复制诊断信息失败', 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  function toggleDiagnostics() {
    const panel = byId('activityDiagnosticsPanel');
    const button = byId('activityDiagnosticsToggle');
    if (!panel || !button) return;
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    setActivityExpandable(panel, expanded, { trigger: button });
    const label = button.querySelector?.('span');
    if (label) label.textContent = expanded ? '收起详情' : '查看详情';
  }

  function setActivityExpandable(panel, expanded, { trigger, initial = false } = {}) {
    if (!panel) return;
    const setter = window._nekoModules?.expandableSection?.setExpandableSectionState
      || window._nekoUIHelpers?.setExpandableSectionState;
    if (typeof setter === 'function') {
      setter(panel, expanded, { trigger, initial });
      return;
    }
    panel.hidden = !expanded;
    panel.inert = !expanded;
    panel.setAttribute?.('aria-hidden', expanded ? 'false' : 'true');
    if (expanded) panel.removeAttribute?.('inert');
    else panel.setAttribute?.('inert', '');
    trigger?.setAttribute?.('aria-expanded', expanded ? 'true' : 'false');
  }

  function toggleAdvancedComposer() {
    const panel = byId('activityAdvancedComposer');
    const trigger = byId('activityAdvancedComposerToggle');
    if (!panel || !trigger) return;
    setActivityExpandable(panel, trigger.getAttribute('aria-expanded') !== 'true', { trigger });
  }

  function activateActivitySection(section, { focus = false, initial = false } = {}) {
    const valid = ['receive', 'share', 'background', 'people'];
    const selected = valid.includes(section) ? section : 'receive';
    document.querySelectorAll?.('#activitySectionTabs [data-activity-section]').forEach((button) => {
      const active = button.dataset.activitySection === selected;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('tabindex', active ? '0' : '-1');
      if (active && focus) button.focus?.();
    });
    document.querySelectorAll?.('#page-activity [data-activity-panel]').forEach((panel) => {
      const active = panel.dataset.activityPanel === selected;
      const wasActive = panel.hidden === false && panel.getAttribute?.('aria-hidden') !== 'true';
      panel.classList.remove('is-entering');
      panel.hidden = !active;
      panel.inert = !active;
      panel.setAttribute?.('aria-hidden', active ? 'false' : 'true');
      if (active) panel.removeAttribute?.('inert');
      else panel.setAttribute?.('inert', '');
      if (active && !wasActive && !initial && !prefersReducedMotion()) {
        void panel.offsetWidth;
        panel.classList.add('is-entering');
        panel.addEventListener?.('animationend', () => panel.classList.remove('is-entering'), { once: true });
      }
    });
  }

  function bindSectionTabs() {
    const tabs = byId('activitySectionTabs');
    if (!tabs) return;
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-activity-section]');
      if (button) activateActivitySection(button.dataset.activitySection);
    });
    tabs.addEventListener('keydown', (event) => {
      const current = event.target.closest?.('[data-activity-section]');
      if (!current) return;
      const buttons = Array.from(tabs.querySelectorAll?.('[data-activity-section]') || []);
      const index = buttons.indexOf(current);
      let nextIndex = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % buttons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = buttons.length - 1;
      else return;
      event.preventDefault();
      activateActivitySection(buttons[nextIndex]?.dataset.activitySection, { focus: true });
    });
  }

  function healthPollDelay() {
    const overall = (displayHealth || state.health)?.overall;
    return ['healthy', 'disabled', 'paused', 'unavailable'].includes(overall)
      ? HEALTH_STABLE_POLL_MS
      : HEALTH_RECOVERY_POLL_MS;
  }

  function stopPagePolling() {
    if (healthPollTimer) window.clearTimeout(healthPollTimer);
    if (followsPollTimer) window.clearTimeout(followsPollTimer);
    healthPollTimer = null;
    followsPollTimer = null;
  }

  function scheduleHealthPoll(delay = healthPollDelay()) {
    if (healthPollTimer) window.clearTimeout(healthPollTimer);
    healthPollTimer = null;
    if (!pageActive) return;
    healthPollTimer = window.setTimeout(async () => {
      healthPollTimer = null;
      await refreshAgent(true);
      scheduleHealthPoll();
    }, delay);
  }

  async function refreshFollowsOnly() {
    if (!pageActive || !state.settings.enabled) return;
    const overall = (displayHealth || state.health)?.overall;
    if (!['healthy', 'degraded'].includes(overall)) return;
    const requestEpoch = businessEpoch;
    const fullRequestRevision = businessRequestRevision;
    const requestRevision = ++followsRequestRevision;
    const requestIsCurrent = () => requestEpoch === businessEpoch
      && requestRevision === followsRequestRevision
      && fullRequestRevision === businessRequestRevision;
    const hadCredibleSnapshot = ['fresh', 'stale'].includes(state.sectionStatus.follows);
    try {
      const result = await client()?.manage?.('getFollows');
      if (!requestIsCurrent()) return;
      if (!result || failed(result)) {
        state.sectionStatus.follows = hadCredibleSnapshot ? 'stale' : 'error';
      } else {
        const follows = result?.follows;
        if (Array.isArray(follows)) state.follows = follows;
        state.sectionStatus.follows = 'fresh';
      }
      renderFollows();
      renderSectionDataStatus();
      renderRemoteControlAvailability();
    } catch {
      if (!requestIsCurrent()) return;
      state.sectionStatus.follows = hadCredibleSnapshot ? 'stale' : 'error';
      renderSectionDataStatus();
    }
  }

  function scheduleFollowsPoll() {
    if (followsPollTimer) window.clearTimeout(followsPollTimer);
    followsPollTimer = null;
    if (!pageActive) return;
    followsPollTimer = window.setTimeout(async () => {
      followsPollTimer = null;
      await refreshFollowsOnly();
      scheduleFollowsPoll();
    }, FOLLOWS_POLL_MS);
  }

  function setPageActive(active) {
    pageActive = !!active;
    if (!pageActive) {
      stopPagePolling();
      followsRequestRevision += 1;
      return;
    }
    scheduleHealthPoll(HEALTH_RECOVERY_POLL_MS);
    scheduleFollowsPoll();
  }

  async function handleSearchButton(button) {
    const query = byId('activityUserSearchInput')?.value?.trim();
    if (!query) return notify('请输入用户名或 #UID', 'warn');
    if (queryTargetsSelf(query)) {
      renderSearchMessage('不能关注自己。你可以搜索其他用户。', 'compact');
      return notify('不能关注自己喵。换一个用户试试。', 'warn');
    }
    setButtonBusy(button, true, '搜索中');
    renderSearchMessage('正在搜索用户…');
    try {
      const result = await client()?.searchUsers?.(query);
      if (!result || failed(result)) throw new Error(errorText(result, '搜索失败'));
      const users = (result?.users || []).filter((user) => Number(user?.id) !== Number(state.currentUserId));
      if (!users.length && (result?.users || []).length) {
        renderSearchMessage('不能关注自己。你可以搜索其他用户。', 'compact');
        return;
      }
      renderSearchResults(users);
    } catch (error) {
      if (queryTargetsSelf(query)) {
        renderSearchMessage('不能关注自己。你可以搜索其他用户。', 'compact');
        notify('不能关注自己喵。换一个用户试试。', 'warn');
        return;
      }
      renderSearchMessage('搜索失败，请检查网络后重试。');
      notify(error.message || '搜索失败', 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  function bindActivityToolbarDelegation() {
    const pageRoot = byId('page-activity');
    if (!pageRoot || pageRoot.dataset.toolbarDelegated === '1') return;
    pageRoot.dataset.toolbarDelegated = '1';
    pageRoot.addEventListener('click', (event) => {
      const button = event.target.closest?.('#activityPauseBtn, #activityUserSearchBtn');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled && !button.classList.contains('loading')) return;
      if (button.id === 'activityPauseBtn') handlePauseButton(button);
      if (button.id === 'activityUserSearchBtn') handleSearchButton(button);
    }, true);
  }

  function init(options = {}) {
    deps = { ...deps, ...options };
    if (initialized) return;
    initialized = true;
    bindActivityToolbarDelegation();
    bindSwitch('activityEnabledSwitch', 'enabled');
    bindSwitch('activityPublishingSwitch', 'publishing');
    bindSwitch('activitySnapshotsSwitch', 'snapshots');
    bindSwitch('activityBackgroundSwitch', 'background');
    bindSwitch('activityAutoStartSwitch', 'autoStart');
    bindSectionTabs();
    byId('activityHealthActionBtn')?.addEventListener('click', (event) => handleHealthAction(event.currentTarget));
    byId('activityHealthRefreshBtn')?.addEventListener('click', (event) => handleRefreshButton(event.currentTarget));
    byId('activityDiagnosticsToggle')?.addEventListener('click', toggleDiagnostics);
    byId('activityAdvancedComposerToggle')?.addEventListener('click', toggleAdvancedComposer);
    byId('activityCopyDiagnosticsBtn')?.addEventListener('click', (event) => copyDiagnostics(event.currentTarget));
    byId('activityActiveAppBtn')?.addEventListener('click', pickActivityAppForComposer);
    byId('activityAddAppBtn')?.addEventListener('click', addPublicAppFromComposer);
    byId('activityAppKeyInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') byId('activityAddAppBtn')?.click();
    });
    byId('activityAppNameInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') byId('activityAddAppBtn')?.click();
    });
    byId('activityUserSearchInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') byId('activityUserSearchBtn')?.click();
    });
    byId('activityPrivacyOptions')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-visibility]');
      if (!button || button.disabled) return;
      button.disabled = true;
      try {
        const result = await client()?.setPrivacy?.(button.dataset.visibility);
        if (!result || failed(result)) throw new Error(errorText(result, '隐私设置失败'));
        state.visibility = button.dataset.visibility;
        renderPrivacy();
        notify('可见范围已更新', 'success');
      } catch (error) {
        notify(error.message || '隐私设置失败', 'error');
      } finally {
        renderPrivacy();
      }
    });
    document.getElementById('page-activity')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (button && !button.disabled) handleAction(button);
    });
    unsubscriptions.push(window._nekoModules?.services?.IpcClient?.on?.('activity:stateChanged', (snapshot) => {
      if (applyActivitySnapshot(snapshot)) {
        renderAll();
        scheduleHealthPoll();
      }
    }) || (() => {}));
    unsubscriptions.push(window._nekoModules?.services?.IpcClient?.on?.('app:openPage', (payload) => {
      if (payload?.page === 'page-activity') window._nekoModules?.router?.navigateTo?.('page-activity');
    }) || (() => {}));
    unsubscriptions.push(window._nekoModules?.eventBus?.on?.('router:page-changed', ({ page } = {}) => {
      setPageActive(page === 'page-activity');
      if (page === 'page-activity') {
        loadCurrentUser().then((identityChanged) => (
          (identityChanged || !businessLoaded) ? refreshData(true) : refreshAgent(true)
        )).finally(() => {
          scheduleHealthPoll();
          scheduleFollowsPoll();
        });
      }
    }) || (() => {}));
    document.addEventListener?.('neko:authChange', handleAuthChange);
    unsubscriptions.push(() => document.removeEventListener?.('neko:authChange', handleAuthChange));
    setActivityExpandable(byId('activityDiagnosticsPanel'), false, {
      trigger: byId('activityDiagnosticsToggle'),
      initial: true,
    });
    setActivityExpandable(byId('activityAdvancedComposer'), false, {
      trigger: byId('activityAdvancedComposerToggle'),
      initial: true,
    });
    activateActivitySection('receive', { initial: true });
    pageActive = window._nekoModules?.router?.getCurrentPage?.() === 'page-activity';
    const initialLoad = loadCurrentUser().then(() => (pageActive ? refreshData(true) : refreshAgent(true)));
    initialLoad.finally(() => {
      if (pageActive) {
        scheduleHealthPoll();
        scheduleFollowsPoll();
      }
    });
  }

  function destroy() {
    stopPagePolling();
    clearRemoteDebounce();
    while (unsubscriptions.length) {
      try { unsubscriptions.pop()?.(); } catch {}
    }
    initialized = false;
  }

  window._nekoModules.pages.ActivityPage = { init, refresh: refreshData, destroy };
})();

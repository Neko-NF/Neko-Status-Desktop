/*
 * Deterministic preload used by the visual harness.
 *
 * It deliberately does not load the production preload: the renderer is
 * exercised with the real index.html and page modules, while all external
 * state is kept local and repeatable.  The object exposed as __nekoVisual is
 * test-only and is never included in the packaged application.
 */
const { contextBridge } = require('electron');
const { IPC_EVENTS } = require('../../src/shared/ipc-contracts');

const FIXED_TIME = '2026-01-15T08:00:00.000Z';
const listeners = new Map();
let scenario = 'default';
let activityRevision = 0;

const clone = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

const config = {
  authUser: {
    id: 1001,
    username: 'Visual Admin',
    nickname: 'Visual Admin',
    role: 'admin',
    isAdmin: true,
  },
  restoreLastState: false,
  lastPage: 'mainDashboardArea',
  themeMode: 'dark',
  seedColor: '#0ea5e9',
  customSeedColor: '#0ea5e9',
  uiScale: 100,
  uiFont: '',
  glassEffect: true,
  debugEnabled: false,
  enableExperimentalFeatures: true,
  enableExperimentalActivityEntry: true,
  enableExperimentalStreamEntry: true,
  enableActivityPublishing: true,
  enableActivityBackground: true,
  enableExperimentalUiLabEntry: true,
  enableExperimentalCurveLoaders: false,
  loadingCurveStyle: 'auto',
  uiAppearanceProfile: 'classic',
  serverUrl: 'https://visual.invalid',
  deviceKey: 'visual-device-key',
  readAnnouncementIds: Array.from({ length: 100 }, (_, index) => String(index + 1)),
};

function announcement(id, overrides = {}) {
  return {
    id,
    title: `视觉回归公告 ${id}`,
    content: '用于验证公告列表、详情面板、刷新状态和长文本布局的确定性内容。',
    type: id % 3 === 0 ? 'urgent' : id % 2 === 0 ? 'warning' : 'info',
    category: id % 2 === 0 ? 'it' : 'system',
    targetAudience: 'all',
    status: id === 4 ? 'draft' : id === 5 ? 'archived' : 'published',
    pinned: id === 1 || id === 7,
    author: '视觉测试管理员',
    showPopup: true,
    pushNotification: id % 3 === 0,
    priority: id === 1 ? 10 : id % 4 + 2,
    views: id * 11,
    acknowledges: id * 7,
    totalAudience: 120,
    createdAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function getAnnouncements() {
  if (scenario === 'announcement-empty') return [];
  if (scenario === 'announcement-error') {
    throw Object.assign(new Error('visual announcement fixture failed'), { code: 'VISUAL_ANNOUNCEMENT_ERROR' });
  }
  const count = scenario === 'announcement-long' ? 24 : 8;
  return Array.from({ length: count }, (_, index) => {
    const item = announcement(index + 1);
    if (scenario === 'announcement-long' && index === 0) {
      item.title = '这是一个用于验证公告卡片在超长标题、置顶状态和多种操作同时存在时仍保持稳定几何的测试公告标题';
      item.content = `${item.content} `.repeat(8).trim();
    }
    return item;
  });
}

function user(id, index = id) {
  return {
    id,
    username: `followed-user-${index}`,
    nickname: `关注用户 ${index}`,
    avatar: '',
  };
}

function getActivitySnapshot() {
  activityRevision += 1;
  if (scenario === 'activity-error') {
    return {
      ok: false,
      success: false,
      code: 'AGENT_MISSING',
      message: '视觉测试：活动代理不可用',
    };
  }
  const settings = {
    enabled: true,
    publishing: true,
    snapshots: false,
    background: true,
    autoStart: true,
  };
  const health = scenario === 'activity-degraded'
    ? {
      overall: 'degraded',
      lifecycle: 'running',
      localIpc: { state: 'connected', attempt: 1 },
      provision: { state: 'ready', deviceConfigured: true, boundToCurrentUser: true },
      receiver: { state: 'polling', transport: 'http', consecutiveFailures: 1 },
      publisher: { state: 'idle', currentApp: null },
    }
    : {
      overall: 'healthy',
      lifecycle: 'running',
      localIpc: { state: 'connected', attempt: 1 },
      provision: { state: 'ready', deviceConfigured: true, boundToCurrentUser: true },
      receiver: { state: 'connected', transport: 'websocket', consecutiveFailures: 0 },
      publisher: { state: 'online', currentApp: { displayName: 'Neko Status', appKey: 'NekoStatus.exe' } },
    };
  return {
    schemaVersion: 2,
    revision: activityRevision,
    identityRevision: 1,
    observedAtMs: Date.parse(FIXED_TIME),
    settings,
    effectiveSettings: settings,
    health,
    agent: { state: 'running', available: true, connection: 'connected', version: 'visual-1.0' },
  };
}

function getActivityBootstrap() {
  const count = scenario === 'activity-long' ? 12 : 4;
  const follows = Array.from({ length: count }, (_, index) => ({
    id: `follow-${index + 1}`,
    user: user(index + 1, index + 1),
    allowed: true,
    activeSessions: index === 0
      ? [{ displayName: 'Neko Status', startedAt: FIXED_TIME, devices: [{ name: '桌面端' }] }]
      : [],
    rules: index % 2 === 0 ? [{ id: `rule-${index + 1}`, displayName: 'Neko Status', appKey: 'NekoStatus.exe' }] : [],
  }));
  const followers = Array.from({ length: scenario === 'activity-people-long' ? 18 : scenario === 'activity-long' ? 9 : 2 }, (_, index) => ({
    id: `follower-${index + 1}`,
    user: user(50 + index, 50 + index),
  }));
  const apps = Array.from({ length: scenario === 'activity-share-long' ? 24 : scenario === 'activity-long' ? 8 : 3 }, (_, index) => ({
    appKey: `VisualApp${index + 1}.exe`,
    displayName: `Visual App ${index + 1}`,
    isHidden: index % 3 === 0,
    detected: index === 0,
    source: index === 0 ? 'local-detected' : 'remote',
  }));
  return {
    follows: { follows },
    followers: { followers },
    apps: { apps },
    blocks: {
      blocks: Array.from({ length: scenario === 'activity-people-long' ? 14 : 0 }, (_, index) => ({
        id: `blocked-${index + 1}`,
        user: user(150 + index, 150 + index),
      })),
    },
    privacy: { visibility: 'followers' },
    partialFailures: scenario === 'activity-partial' ? [{ section: 'followers' }] : [],
  };
}

function delayForCurrentScenario() {
  if (scenario === 'announcement-cold' || scenario === 'announcement-refresh') return 260;
  return 4;
}

function emit(channel, data) {
  const callbacks = listeners.get(channel) || [];
  return Promise.allSettled(callbacks.slice().map((callback) => {
    try { return callback(data); } catch (error) { return Promise.reject(error); }
  }));
}

function rememberConfig(key, value) {
  config[key] = clone(value);
  return clone(value);
}

const bridge = {
  getConfig: async (key) => clone(config[key]),
  setConfig: async (key, value) => rememberConfig(key, value),
  setManyConfig: async (values) => {
    Object.assign(config, clone(values) || {});
    return clone(config);
  },
  getAllConfig: async () => clone(config),

  startService: async () => true,
  stopService: async () => true,
  isRunning: async () => true,
  restartService: async () => true,
  getLastResult: async () => null,
  enableAutoStart: async () => true,
  disableAutoStart: async () => true,
  isAutoStartEnabled: async () => true,
  getProcessInfo: async () => ({ pid: 1001, name: 'NekoPresenceAgent.exe', running: true }),
  checkPermissions: async () => ({ granted: true, permissions: [] }),
  runHealthCheck: async () => ({ ok: true, checks: [] }),

  captureScreen: async () => ({ ok: false, message: 'visual fixture' }),
  getActiveWindow: async () => ({ title: 'Neko Status', processName: 'NekoStatus.exe' }),
  listWindows: async () => [],
  pickPrivacyWindow: async () => null,
  pickActivityAppWindow: async () => null,
  getSystemInfo: async () => ({ platform: 'win32', arch: 'x64', hostname: 'visual-host' }),
  getBattery: async () => ({ level: 78, isCharging: true, hasBattery: true, powerSource: 'AC' }),
  getMetrics: async () => ({ cpu: 18, memory: 42, disk: 28, network: { up: 0, down: 0 } }),
  getMetricsHistory: async () => [],
  getFingerprint: async () => ({ id: 'visual-device', name: 'Visual Test Device' }),
  selectFile: async () => null,
  saveTextFile: async () => ({ ok: true }),
  clearCache: async () => ({ ok: true }),
  getCacheSize: async () => 1024 * 1024,
  setZoom: async () => true,
  getSystemFonts: async () => [],

  handshake: async () => ({ ok: true, user: clone(config.authUser) }),
  testConnection: async () => ({ ok: true }),
  validateKey: async () => ({ ok: true }),
  preValidateKey: async () => ({ ok: true }),
  authLogin: async () => ({ ok: true, user: clone(config.authUser) }),
  authRegister: async () => ({ ok: true, user: clone(config.authUser) }),
  authGetMe: async () => ({ success: true, user: clone(config.authUser) }),
  authUpdateProfile: async (data) => ({ ...clone(config.authUser), ...(clone(data) || {}) }),
  authLogout: async () => ({ ok: true }),
  authGenerateDeviceKey: async () => ({ deviceKey: 'visual-device-key' }),
  authGetState: async () => ({
    loggedIn: true,
    isLoggedIn: true,
    promptDismissed: true,
    serverConfigured: true,
    user: clone(config.authUser),
    authUser: clone(config.authUser),
  }),
  authDismissPrompt: async () => true,

  checkUpdate: async () => ({ hasUpdate: false }),
  getChangelog: async () => [],
  checkIntegrity: async () => ({ ok: true }),
  rollbackInfo: async () => null,
  getUpdateChannel: async () => 'stable',
  setUpdateChannel: async () => true,
  downloadUpdate: async () => ({ ok: true }),
  installUpdate: async () => ({ ok: true }),
  getPendingInstall: async () => null,
  installPendingUpdate: async () => ({ ok: true }),

  getStreamConfig: async () => ({ srsHost: '', srsRtmpPort: 1935, srsApp: 'live', srsApiPort: 1985, streamKey: '', obsWsHost: '127.0.0.1', obsWsPort: 4455, obsWsPassword: '' }),
  saveStreamConfig: async (value) => clone(value),
  getStreamKey: async () => ({ stream_key: '' }),
  resetStreamKey: async () => ({ stream_key: 'visual-stream-key' }),
  getStreamLiveStatus: async () => 'idle',
  testSrsConnection: async () => ({ ok: false, reason: 'visual fixture' }),
  testSrs: async () => ({ ok: false, reason: 'visual fixture' }),
  testObsWebSocket: async () => ({ connected: false, reason: 'visual fixture' }),
  applyStreamConfigToObs: async () => ({ ok: false, error: 'visual fixture' }),
  exportObsServiceConfig: async () => 'visual-stream-config.json',
  getLiveStatus: async () => 'idle',

  fetchAnnouncements: async () => {
    await new Promise((resolve) => setTimeout(resolve, delayForCurrentScenario()));
    const list = getAnnouncements();
    return { announcements: list };
  },
  createAnnouncement: async (payload) => ({ id: 999, ...clone(payload) }),
  updateAnnouncement: async (id, payload) => ({ id, ...clone(payload) }),
  deleteAnnouncement: async () => ({ ok: true }),
  recordAnnouncementReceipt: async () => ({ ok: true }),

  getActivityState: async () => getActivitySnapshot(),
  updateActivitySettings: async (payload) => ({ ...getActivitySnapshot(), settings: clone(payload), effectiveSettings: clone(payload) }),
  provisionActivityAgent: async () => getActivitySnapshot(),
  pauseActivityAgent: async () => getActivitySnapshot(),
  resumeActivityAgent: async () => getActivitySnapshot(),
  manageActivity: async (action) => {
    if (action === 'bootstrap') return getActivityBootstrap();
    if (action === 'getFollows') return { follows: getActivityBootstrap().follows.follows };
    if (action === 'searchUsers') return { users: [user(2001, 'search-result')] };
    return { ok: true };
  },

  getVersion: async () => '1.4.1',
  getDeviceName: async () => 'Visual Test Device',
  quit: async () => true,
  hide: async () => true,
  show: async () => true,
  minimize: async () => true,
  openExternal: async () => true,
  notify: async () => true,
  getFocusAssist: async () => false,
  setFocusAssist: async () => true,
  syncMeta: async () => true,

  on(channel, callback) {
    const list = listeners.get(channel) || [];
    list.push(callback);
    listeners.set(channel, list);
    return () => {
      const next = (listeners.get(channel) || []).filter((item) => item !== callback);
      listeners.set(channel, next);
    };
  },
  once(channel, callback) {
    const unsubscribe = bridge.on(channel, (data) => {
      unsubscribe();
      callback(data);
    });
  },
  emitRendererError: () => {},
};

contextBridge.exposeInMainWorld('nekoIPC', bridge);
contextBridge.exposeInMainWorld('__NEKO_IPC_CONTRACTS__', {
  IPC_CHANNELS: {},
  IPC_EVENTS,
});
contextBridge.exposeInMainWorld('nekoRuntime', {
  versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
});
contextBridge.exposeInMainWorld('__nekoVisual', {
  setScenario(value) {
    scenario = String(value || 'default');
    activityRevision = 0;
    return scenario;
  },
  getScenario: () => scenario,
  emit(channel, data) {
    return emit(channel, clone(data));
  },
  getFixedTime: () => FIXED_TIME,
});

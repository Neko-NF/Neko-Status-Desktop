const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE_FILE = path.resolve(__dirname, '..', '..', 'src', 'renderer', 'js', 'pages', 'activity.page.js');

function createElement() {
  const classes = new Set();
  const attributes = new Map();
  const listeners = new Map();
  const element = {
    dataset: {},
    disabled: false,
    hidden: false,
    innerHTML: '',
    textContent: '',
    value: '',
    open: false,
    style: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    click() {
      if (element.disabled) return;
      (listeners.get('click') || []).forEach((listener) => listener({
        currentTarget: element,
        target: element,
        preventDefault() {},
        stopPropagation() {},
      }));
    },
    closest() { return null; },
    focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
  };
  Object.defineProperty(element, 'className', {
    get: () => [...classes].join(' '),
    set(value) {
      classes.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    },
  });
  return element;
}

function healthySnapshot(overrides = {}) {
  const settings = {
    enabled: true,
    publishing: false,
    snapshots: false,
    background: false,
    autoStart: true,
    ...(overrides.settings || {}),
  };
  const baseHealth = {
    overall: 'healthy',
    lifecycle: 'embedded',
    localIpc: { state: 'connected', attempt: 0, sinceMs: Date.now() - 1000, nextRetryAtMs: null, lastError: null },
    provision: { state: 'ready', deviceConfigured: true, boundToCurrentUser: true },
    receiver: {
      state: 'connected',
      transport: 'sse',
      lastConnectedAtMs: Date.now() - 1000,
      lastHeartbeatAtMs: Date.now() - 500,
      lastEventAtMs: null,
      consecutiveFailures: 0,
      nextRetryAtMs: null,
      lastError: null,
    },
    publisher: {
      state: settings.publishing ? 'idle' : 'disabled',
      lastSuccessAtMs: null,
      currentApp: null,
      detectedApp: null,
      lastError: null,
    },
  };
  const health = {
    ...baseHealth,
    ...(overrides.health || {}),
    localIpc: { ...baseHealth.localIpc, ...(overrides.health?.localIpc || {}) },
    provision: { ...baseHealth.provision, ...(overrides.health?.provision || {}) },
    receiver: { ...baseHealth.receiver, ...(overrides.health?.receiver || {}) },
    publisher: { ...baseHealth.publisher, ...(overrides.health?.publisher || {}) },
  };
  return {
    schemaVersion: 2,
    revision: overrides.revision ?? 1,
    observedAtMs: overrides.observedAtMs ?? Date.now(),
    settings,
    effectiveSettings: {
      ...settings,
      enabled: settings.enabled === true,
      publishing: settings.enabled === true && settings.publishing === true,
      snapshots: settings.enabled === true && settings.publishing === true && settings.snapshots === true,
      background: settings.enabled === true && settings.background === true,
      autoStart: settings.enabled === true && settings.background === true && settings.autoStart === true,
    },
    health,
    agent: { state: health.lifecycle, agentVersion: '1.2.3', pid: 1234, protocolVersion: 1 },
  };
}

function emptyBootstrap() {
  return {
    follows: { follows: [] },
    followers: { followers: [] },
    apps: { apps: [] },
    blocks: { blocks: [] },
    privacy: { visibility: 'private' },
  };
}

function createActivityPageHarness(initialState, options = {}) {
  const elements = new Map();
  const timers = new Map();
  const ipcListeners = new Map();
  const documentListeners = new Map();
  let nextTimerId = 1;
  let activityState = initialState;
  let bootstrapResult = options.bootstrap || emptyBootstrap();
  let bootstrapCalls = 0;
  let provisionCalls = 0;
  let stateCalls = 0;
  const manageCalls = [];

  const fakeSetTimeout = (callback, delay = 0) => {
    const id = nextTimerId++;
    timers.set(id, { callback, delay, active: true });
    return id;
  };
  const fakeClearTimeout = (id) => {
    const timer = timers.get(id);
    if (timer) timer.active = false;
  };
  const document = {
    documentElement: { dataset: {} },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      documentListeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      documentListeners.get(event?.type)?.forEach((listener) => listener(event));
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelectorAll() { return []; },
  };
  const activityClient = {
    getState: async () => {
      stateCalls += 1;
      return activityState;
    },
    bootstrap: async () => {
      bootstrapCalls += 1;
      return bootstrapResult;
    },
    manage: async (action) => {
      manageCalls.push(action);
      if (action === 'getFollows') return { follows: [] };
      return {};
    },
    updateSettings: async (settings) => healthySnapshot({
      revision: Number(activityState?.revision || 0) + 1,
      settings,
    }),
    provisionAgent: async () => {
      provisionCalls += 1;
      return healthySnapshot({ revision: Number(activityState?.revision || 0) + 1 });
    },
  };
  Object.assign(activityClient, options.activityClient || {});

  const window = {
    _nekoModules: {
      router: { getCurrentPage: () => options.currentPage || 'page-activity' },
      services: {
        ActivityClient: activityClient,
        AuthClient: { getState: async () => ({ user: { id: 99, username: 'tester' } }) },
        IpcClient: {
          on(channel, listener) {
            ipcListeners.set(channel, listener);
            return () => ipcListeners.delete(channel);
          },
        },
      },
    },
    clearInterval() {},
    clearTimeout: fakeClearTimeout,
    confirm: () => true,
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    setInterval: () => 0,
    setTimeout: fakeSetTimeout,
  };
  window.window = window;
  const context = {
    clearTimeout: fakeClearTimeout,
    console,
    document,
    setTimeout: fakeSetTimeout,
    window,
  };
  vm.runInNewContext(fs.readFileSync(PAGE_FILE, 'utf8'), context, { filename: PAGE_FILE });

  async function flush() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    elements,
    page: window._nekoModules.pages.ActivityPage,
    async emit(channel, value) {
      ipcListeners.get(channel)?.(value);
      await flush();
    },
    async emitAuth(detail) {
      document.dispatchEvent({ type: 'neko:authChange', detail });
      await flush();
    },
    get bootstrapCalls() { return bootstrapCalls; },
    get manageCalls() { return [...manageCalls]; },
    get provisionCalls() { return provisionCalls; },
    get stateCalls() { return stateCalls; },
    setActivityState(value) { activityState = value; },
    setBootstrap(value) { bootstrapResult = value; },
    async runTimer(delay) {
      const entry = [...timers.entries()].find(([, timer]) => timer.active && timer.delay === delay);
      assert.ok(entry, `expected an active ${delay}ms timer`);
      const [id, timer] = entry;
      timer.active = false;
      timers.delete(id);
      await timer.callback();
      await flush();
    },
    flush,
  };
}

test('activity page shows a stable unavailable state without hiding local service health', async () => {
  const snapshot = healthySnapshot({
    settings: { publishing: true },
    health: {
      receiver: {
        state: 'unsupported',
        lastError: { code: 'API_NOT_DEPLOYED', message: 'Activity API 未部署', httpStatus: 404, transient: false, atMs: Date.now() },
      },
      publisher: {
        state: 'unsupported',
        lastError: { code: 'API_INCOMPATIBLE', message: '返回了 HTML', httpStatus: 200, transient: false, atMs: Date.now() },
      },
    },
  });
  const harness = createActivityPageHarness(snapshot);
  harness.page.init();
  await harness.flush();

  assert.equal(harness.elements.get('activityHealthTitle').textContent, '服务器暂未提供上线提醒');
  assert.equal(harness.elements.get('activityLocalHealthLabel').textContent, '运行中');
  assert.equal(harness.elements.get('activityReceiverHealthLabel').textContent, '服务器未提供');
  assert.equal(harness.elements.get('activityHealthCard').dataset.tone, 'unavailable');
  assert.match(harness.elements.get('activityDiagnosticsContent').textContent, /API_NOT_DEPLOYED/);
  assert.doesNotMatch(harness.elements.get('activityDiagnosticsContent').textContent, /token|authorization/i);
  harness.page.destroy();
});

test('a detected but private app is never described as currently shared', async () => {
  const snapshot = healthySnapshot({
    settings: { publishing: true },
    health: {
      publisher: {
        state: 'online',
        currentApp: { appKey: 'win32:chatgpt.exe', displayName: 'chatgpt' },
        detectedApp: { appKey: 'win32:chatgpt.exe', displayName: 'chatgpt' },
      },
    },
  });
  const bootstrap = emptyBootstrap();
  bootstrap.apps = {
    apps: [{ appKey: 'win32:chatgpt.exe', displayName: 'chatgpt', isHidden: true }],
  };
  const harness = createActivityPageHarness(snapshot, { bootstrap });
  harness.page.init();
  await harness.flush();

  assert.equal(harness.elements.get('activityPublisherHealthLabel').textContent, '未公开');
  assert.match(harness.elements.get('activityPublisherHealthDetail').textContent, /chatgpt/);
  assert.match(harness.elements.get('activityPublisherHealthDetail').textContent, /我的应用可见性/);
  assert.doesNotMatch(harness.elements.get('activityPublisherHealthDetail').textContent, /正在分享/);
  harness.page.destroy();
});

test('an initial transient provision failure is reported as server unavailable, not a device setup error', async () => {
  const transientError = {
    code: 'API_TRANSIENT',
    message: '无法连接 Activity API',
    httpStatus: null,
    transient: true,
    atMs: Date.now(),
  };
  const snapshot = healthySnapshot({
    settings: { publishing: true },
    health: {
      overall: 'unavailable',
      provision: { state: 'needs_enroll', deviceConfigured: true, boundToCurrentUser: false },
      receiver: { state: 'disabled', lastError: transientError },
      publisher: { state: 'disabled', lastError: transientError },
    },
  });
  const harness = createActivityPageHarness(snapshot);
  harness.page.init();
  await harness.flush();

  assert.equal(harness.elements.get('activityHealthTitle').textContent, '服务器暂不可用');
  assert.equal(harness.elements.get('activityLocalHealthLabel').textContent, '运行中');
  assert.equal(harness.elements.get('activityReceiverHealthLabel').textContent, '服务器暂不可用');
  assert.equal(harness.elements.get('activityPublisherHealthLabel').textContent, '服务器暂不可用');
  assert.match(harness.elements.get('activityHealthActionBtn').innerHTML, /立即检查/);
  harness.page.destroy();
});

test('the first-use guide stays hidden after a configured user disables the feature', async () => {
  const snapshot = healthySnapshot({
    settings: { enabled: false },
    health: {
      overall: 'disabled',
      lifecycle: 'disabled',
      provision: { state: 'needs_enroll', deviceConfigured: false, everConfigured: true },
      receiver: { state: 'disabled' },
      publisher: { state: 'disabled' },
    },
  });
  const harness = createActivityPageHarness(snapshot);
  harness.page.init();
  await harness.flush();

  assert.equal(harness.elements.get('activityOnboarding').hidden, true);
  harness.page.destroy();
});

test('activity page rejects stale v2 revisions and accepts a newer full snapshot', async () => {
  const harness = createActivityPageHarness(healthySnapshot({ revision: 10 }));
  harness.page.init();
  await harness.flush();
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '运行正常');

  await harness.emit('activity:stateChanged', healthySnapshot({
    revision: 9,
    health: { receiver: { state: 'unsupported', lastError: { code: 'API_NOT_DEPLOYED', message: 'missing' } } },
  }));
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '运行正常');

  await harness.emit('activity:stateChanged', {
    settings: { enabled: true, publishing: false },
    agent: { state: 'error', connection: 'disconnected', code: 'LEGACY_LATE_EVENT', deviceId: 'device-1' },
  });
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '运行正常');

  await harness.emit('activity:stateChanged', healthySnapshot({
    revision: 11,
    health: { receiver: { state: 'unsupported', lastError: { code: 'API_NOT_DEPLOYED', message: 'missing' } } },
  }));
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '服务器暂未提供上线提醒');
  harness.page.destroy();
});

test('a top-level bootstrap failure marks previously loaded data stale instead of empty', async () => {
  const harness = createActivityPageHarness(healthySnapshot(), {
    bootstrap: {
      ...emptyBootstrap(),
      follows: { follows: [{ id: 7, allowed: true, user: { id: 8, username: 'Alice' }, rules: [], activeSessions: [] }] },
    },
  });
  harness.page.init();
  await harness.flush();
  harness.setBootstrap({ ok: false, success: false, code: 'API_TRANSIENT', message: 'timeout' });

  await harness.page.refresh(true);
  assert.match(harness.elements.get('activityFollowsList').innerHTML, /Alice/);
  assert.match(harness.elements.get('activityReceiveDataStatus').textContent, /缓存数据/);
  harness.page.destroy();
});

test('an account change clears the previous user business data before a failed reload', async () => {
  const harness = createActivityPageHarness(healthySnapshot(), {
    bootstrap: {
      ...emptyBootstrap(),
      follows: { follows: [{ id: 7, allowed: true, user: { id: 8, username: 'Alice' }, rules: [], activeSessions: [] }] },
    },
  });
  harness.page.init();
  await harness.flush();
  assert.match(harness.elements.get('activityFollowsList').innerHTML, /Alice/);
  harness.setBootstrap({ ok: false, code: 'API_TRANSIENT', message: 'offline' });

  await harness.emitAuth({ loggedIn: true, user: { id: 100, username: 'Bob' } });

  assert.doesNotMatch(harness.elements.get('activityFollowsList').innerHTML, /Alice/);
  assert.match(harness.elements.get('activityFollowsList').innerHTML, /暂无关注用户/);
  harness.page.destroy();
});

test('an Activity identity revision change clears cached business data without exposing identity details', async () => {
  const first = healthySnapshot({ revision: 1 });
  first.identityRevision = 1;
  const harness = createActivityPageHarness(first, {
    bootstrap: {
      ...emptyBootstrap(),
      follows: { follows: [{ id: 7, allowed: true, user: { id: 8, username: 'Alice' }, rules: [], activeSessions: [] }] },
    },
  });
  harness.page.init();
  await harness.flush();
  assert.match(harness.elements.get('activityFollowsList').innerHTML, /Alice/);
  const next = healthySnapshot({ revision: 2 });
  next.identityRevision = 2;

  await harness.emit('activity:stateChanged', next);

  assert.doesNotMatch(harness.elements.get('activityFollowsList').innerHTML, /Alice/);
  assert.match(harness.elements.get('activityFollowsList').innerHTML, /暂无关注用户/);
  harness.page.destroy();
});

test('a superseded bootstrap response cannot overwrite the next account data state', async () => {
  let bootstrapCall = 0;
  let resolveOldRequest;
  const oldRequest = new Promise((resolve) => { resolveOldRequest = resolve; });
  const withFollow = (username, id) => ({
    ...emptyBootstrap(),
    follows: { follows: [{ id, allowed: true, user: { id: id + 10, username }, rules: [], activeSessions: [] }] },
  });
  const harness = createActivityPageHarness(healthySnapshot(), {
    activityClient: {
      bootstrap: () => {
        bootstrapCall += 1;
        if (bootstrapCall === 1) return Promise.resolve(withFollow('Alice', 1));
        if (bootstrapCall === 2) return oldRequest;
        return Promise.resolve(withFollow('Bob', 2));
      },
    },
  });
  harness.page.init();
  await harness.flush();
  assert.match(harness.elements.get('activityFollowsList').innerHTML, /Alice/);

  const staleRefresh = harness.page.refresh(true);
  await harness.flush();
  await harness.emitAuth({ loggedIn: true, user: { id: 100, username: 'Bob' } });
  assert.match(harness.elements.get('activityFollowsList').innerHTML, /Bob/);
  resolveOldRequest({ ok: false, code: 'ACTIVITY_SESSION_CHANGED', message: 'old account' });
  await staleRefresh;
  await harness.flush();

  assert.match(harness.elements.get('activityFollowsList').innerHTML, /Bob/);
  assert.doesNotMatch(harness.elements.get('activityReceiveDataStatus').textContent, /加载失败/);
  harness.page.destroy();
});

test('activity page debounces a transient remote reconnect but not local status', async () => {
  const harness = createActivityPageHarness(healthySnapshot({ revision: 1 }));
  harness.page.init();
  await harness.flush();

  await harness.emit('activity:stateChanged', healthySnapshot({
    revision: 2,
    health: {
      receiver: {
        state: 'retrying',
        consecutiveFailures: 1,
        nextRetryAtMs: Date.now() + 2000,
        lastError: { code: 'API_TRANSIENT', message: 'temporary', transient: true, atMs: Date.now() },
      },
    },
  }));
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '运行正常');

  await harness.runTimer(5000);
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '正在恢复');
  assert.equal(harness.elements.get('activityReceiverHealthLabel').textContent, '正在连接');
  harness.page.destroy();
});

test('legacy embedded plus reconnecting is not rendered as a green overall state', async () => {
  const harness = createActivityPageHarness({
    settings: { enabled: true, publishing: true, snapshots: false, background: false, autoStart: true },
    agent: { state: 'embedded', connection: 'reconnecting', available: true, deviceId: 'device-1' },
  });
  harness.page.init();
  await harness.flush();

  assert.equal(harness.elements.get('activityHealthTitle').textContent, '正在恢复');
  assert.equal(harness.elements.get('activityLocalHealthLabel').textContent, '运行中');
  assert.equal(harness.elements.get('activityReceiverHealthLabel').textContent, '正在连接');
  harness.page.destroy();
});

test('partial bootstrap failures retain the last rendered section data', async () => {
  const harness = createActivityPageHarness(healthySnapshot(), {
    bootstrap: {
      ...emptyBootstrap(),
      follows: { follows: [{ id: 7, allowed: true, user: { id: 8, username: 'Alice' }, rules: [], activeSessions: [] }] },
    },
  });
  harness.page.init();
  await harness.flush();
  assert.match(harness.elements.get('activityFollowsList').innerHTML, /Alice/);

  harness.setBootstrap({
    ...emptyBootstrap(),
    sections: {
      follows: { status: 'error', data: null, error: { code: 'API_TRANSIENT' } },
      privacy: { status: 'fresh', data: { visibility: 'private' } },
      apps: { status: 'fresh', data: { apps: [] } },
      followers: { status: 'fresh', data: { followers: [] } },
      blocks: { status: 'fresh', data: { blocks: [] } },
    },
    partialFailures: [{ section: 'follows', code: 'API_TRANSIENT' }],
  });
  await harness.page.refresh(true);

  assert.match(harness.elements.get('activityFollowsList').innerHTML, /Alice/);
  assert.match(harness.elements.get('activityReceiveDataStatus').textContent, /上次内容/);
  harness.page.destroy();
});

test('stable health polling does not repeat the five-section bootstrap', async () => {
  const harness = createActivityPageHarness(healthySnapshot());
  harness.page.init();
  await harness.flush();
  assert.equal(harness.bootstrapCalls, 1);

  await harness.runTimer(10000);
  assert.equal(harness.stateCalls, 2);
  assert.equal(harness.bootstrapCalls, 1);

  await harness.runTimer(30000);
  assert.deepEqual(harness.manageCalls, ['getFollows']);
  assert.equal(harness.bootstrapCalls, 1);
  harness.page.destroy();
});

test('a failed follows poll keeps a previously loaded empty list as stale data', async () => {
  const harness = createActivityPageHarness(healthySnapshot(), {
    activityClient: {
      manage: async () => ({ ok: false, code: 'API_TRANSIENT', message: 'offline' }),
    },
  });
  harness.page.init();
  await harness.flush();

  await harness.runTimer(30000);

  assert.match(harness.elements.get('activityReceiveDataStatus').textContent, /缓存数据/);
  assert.doesNotMatch(harness.elements.get('activityReceiveDataStatus').textContent, /加载失败/);
  harness.page.destroy();
});

test('off-page initialization reads health only and skips business APIs', async () => {
  const harness = createActivityPageHarness(healthySnapshot(), { currentPage: 'mainDashboardArea' });
  harness.page.init();
  await harness.flush();

  assert.equal(harness.stateCalls, 1);
  assert.equal(harness.bootstrapCalls, 0);
  harness.page.destroy();
});

test('a logged-out enabled session shows needs-login health without calling management APIs', async () => {
  const harness = createActivityPageHarness(healthySnapshot({
    health: {
      overall: 'needs_login',
      provision: { state: 'needs_login', deviceConfigured: false, boundToCurrentUser: false },
      receiver: { state: 'disabled' },
      publisher: { state: 'disabled' },
    },
  }));
  harness.page.init();
  await harness.flush();

  assert.equal(harness.bootstrapCalls, 0);
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '需要重新登录');
  harness.page.destroy();
});

test('a transient status read failure preserves the last credible health', async () => {
  const harness = createActivityPageHarness(healthySnapshot());
  harness.page.init();
  await harness.flush();
  harness.setActivityState({ ok: false, success: false, code: 'ACTIVITY_STATE_FAILED', message: 'pipe timeout' });

  await harness.page.refresh(true);
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '运行正常');
  assert.match(harness.elements.get('activityHealthFreshness').textContent, /暂时无法确认服务状态/);
  assert.match(harness.elements.get('activityDiagnosticsContent').textContent, /ACTIVITY_STATE_FAILED/);
  harness.page.destroy();
});

test('an explicit missing Agent error replaces stale local reconnect state', async () => {
  const harness = createActivityPageHarness({
    settings: { enabled: true, publishing: false, snapshots: false, background: false, autoStart: true },
    agent: { state: 'reconnecting', connection: 'disconnected', available: true, deviceId: 'device-1' },
  });
  harness.page.init();
  await harness.flush();
  harness.setActivityState({ ok: false, success: false, code: 'AGENT_MISSING', message: 'NekoPresenceAgent.exe 不存在' });

  await harness.page.refresh(true);
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '需要处理');
  assert.match(harness.elements.get('activityDiagnosticsContent').textContent, /AGENT_MISSING/);
  harness.page.destroy();
});

test('immediate check uses the classified Agent repair path instead of only refreshing lists', async () => {
  const harness = createActivityPageHarness(healthySnapshot({
    health: {
      overall: 'unavailable',
      provision: { state: 'needs_enroll', deviceConfigured: false, boundToCurrentUser: false },
      receiver: {
        state: 'unsupported',
        lastError: { code: 'API_NOT_DEPLOYED', message: 'Activity API 未部署', httpStatus: 404, transient: false, atMs: Date.now() },
      },
    },
  }));
  harness.page.init();
  await harness.flush();

  const action = harness.elements.get('activityHealthActionBtn');
  assert.equal(action.dataset.healthAction, 'check');
  action.click();
  await harness.flush();
  await harness.flush();

  assert.equal(harness.provisionCalls, 1);
  assert.equal(harness.elements.get('activityHealthTitle').textContent, '运行正常');
  harness.page.destroy();
});

test('Agent credential errors request reconfiguration while user JWT errors request login', async () => {
  const agentCredential = createActivityPageHarness(healthySnapshot({
    health: {
      overall: 'needs_action',
      provision: { state: 'credential_error' },
      receiver: { state: 'credential_error', lastError: { code: 'CREDENTIAL_INVALID', message: 'agent token expired' } },
    },
  }));
  agentCredential.page.init();
  await agentCredential.flush();
  assert.equal(agentCredential.elements.get('activityHealthActionBtn').dataset.healthAction, 'provision');
  assert.match(agentCredential.elements.get('activityHealthActionBtn').textContent || agentCredential.elements.get('activityHealthActionBtn').innerHTML, /重新配置提醒/);
  agentCredential.page.destroy();

  const userCredential = createActivityPageHarness(healthySnapshot({
    health: { overall: 'needs_login', provision: { state: 'needs_login' } },
  }));
  userCredential.page.init();
  await userCredential.flush();
  assert.equal(userCredential.elements.get('activityHealthActionBtn').dataset.healthAction, 'login');
  userCredential.page.destroy();
});

test('v2 aggregate starting state is not reclassified by the Renderer', async () => {
  const harness = createActivityPageHarness(healthySnapshot({
    health: {
      overall: 'starting',
      lifecycle: 'starting',
      localIpc: { state: 'disconnected' },
      receiver: { state: 'connecting' },
    },
  }));
  harness.page.init();
  await harness.flush();

  assert.equal(harness.elements.get('activityHealthTitle').textContent, '正在启动');
  harness.page.destroy();
});

test('privacy bootstrap data cannot overwrite canonical local snapshot settings', async () => {
  const harness = createActivityPageHarness(healthySnapshot({
    settings: { publishing: true, snapshots: true },
  }), {
    bootstrap: { ...emptyBootstrap(), privacy: { visibility: 'followers', shareSnapshots: false } },
  });
  harness.page.init();
  await harness.flush();

  assert.equal(harness.elements.get('activitySnapshotsSwitch').getAttribute('aria-checked'), 'true');
  harness.page.destroy();
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadBrowserScript(context, relPath) {
  const filename = path.join(ROOT, relPath);
  const code = fs.readFileSync(filename, 'utf8');
  vm.runInNewContext(code, context, { filename });
}

test('renderer stream client delegates through the live IPC bridge', async () => {
  const calls = [];
  const context = {
    window: {
      nekoIPC: {
        getStreamConfig: async () => {
          calls.push('getStreamConfig');
          return { srsHost: 'live.example.com' };
        },
        saveStreamConfig: async (cfg) => {
          calls.push(['saveStreamConfig', cfg]);
          return { ok: true, ...cfg };
        },
        getStreamKey: async () => ({ streamKey: 'sk_test' }),
        resetStreamKey: async () => ({ streamKey: 'sk_reset' }),
        getStreamLiveStatus: async () => 'idle',
        testSrsConnection: async () => ({ ok: true }),
        testObsWebSocket: async () => ({ connected: true }),
        applyStreamConfigToObs: async () => ({ ok: true }),
        exportObsServiceConfig: async () => ({ path: 'C:\\tmp\\obs.json' }),
      },
    },
    console,
  };
  context.window.window = context.window;

  loadBrowserScript(context, 'src/renderer/js/services/ipc-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/stream-client.js');

  const client = context.window._nekoModules.services.StreamClient;
  assert.equal(client.isReady(), true);
  assert.deepEqual(await client.getConfig(), { srsHost: 'live.example.com' });
  assert.deepEqual(await client.saveConfig({ srsHost: 'next.example.com' }), {
    ok: true,
    srsHost: 'next.example.com',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    'getStreamConfig',
    ['saveStreamConfig', { srsHost: 'next.example.com' }],
  ]);
});

test('renderer IPC client resolves methods at call time for stream mocks', async () => {
  const context = {
    window: {
      nekoIPC: {
        getStreamLiveStatus: async () => 'before-mock',
      },
    },
    console,
  };
  context.window.window = context.window;

  loadBrowserScript(context, 'src/renderer/js/services/ipc-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/stream-client.js');

  const client = context.window._nekoModules.services.StreamClient;
  context.window.nekoIPC.getStreamLiveStatus = async () => 'after-mock';

  assert.equal(await client.getLiveStatus(), 'after-mock');
});

test('renderer update client delegates update IPC methods through the shared client', async () => {
  const calls = [];
  const context = {
    window: {
      nekoIPC: {
        checkUpdate: async () => {
          calls.push('checkUpdate');
          return { hasUpdate: false };
        },
        downloadUpdate: async (url) => {
          calls.push(['downloadUpdate', url]);
          return { filePath: 'C:\\tmp\\NekoStatus.exe' };
        },
        installUpdate: async (filePath, sha256, options) => {
          calls.push(['installUpdate', filePath, sha256, options]);
          return { ok: true };
        },
        setUpdateChannel: async (channel) => {
          calls.push(['setUpdateChannel', channel]);
          return true;
        },
        setConfig: async (key, value) => {
          calls.push(['setConfig', key, value]);
          return true;
        },
        setManyConfig: async (source) => {
          calls.push(['setManyConfig', source]);
          return true;
        },
        getChangelog: async () => [],
        installPendingUpdate: async () => ({ ok: true }),
        getPendingInstall: async () => {
          calls.push('getPendingInstall');
          return { hasPending: false };
        },
        checkIntegrity: async () => {
          calls.push('checkIntegrity');
          return [{ name: 'package', ok: true }];
        },
        rollbackInfo: async () => {
          calls.push('rollbackInfo');
          return { success: true, version: '1.2.6' };
        },
        rollbackVersion: async (version) => ({ ok: true, version }),
      },
    },
    console,
  };
  context.window.window = context.window;

  loadBrowserScript(context, 'src/renderer/js/services/ipc-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/update-client.js');

  const client = context.window._nekoModules.services.UpdateClient;
  assert.equal(client.isReady(), true);
  assert.deepEqual(await client.check(), { hasUpdate: false });
  assert.deepEqual(await client.download('https://example.com/NekoStatus.exe'), {
    filePath: 'C:\\tmp\\NekoStatus.exe',
  });
  assert.deepEqual(await client.install('C:\\tmp\\NekoStatus.exe', 'abc123', { manual: true }), { ok: true });
  assert.equal(await client.setChannel('beta'), true);
  assert.equal(await client.setSkippedVersion('1.2.8'), true);
  assert.equal(await client.saveSource({ githubOwner: 'Neko-NF', githubRepo: 'Neko-Status-Desktop' }), true);
  assert.deepEqual(await client.getPendingInstall(), { hasPending: false });
  assert.deepEqual(await client.checkIntegrity(), [{ name: 'package', ok: true }]);
  assert.deepEqual(await client.rollbackInfo(), { success: true, version: '1.2.6' });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    'checkUpdate',
    ['downloadUpdate', 'https://example.com/NekoStatus.exe'],
    ['installUpdate', 'C:\\tmp\\NekoStatus.exe', 'abc123', { manual: true }],
    ['setUpdateChannel', 'beta'],
    ['setConfig', 'skippedVersion', '1.2.8'],
    ['setManyConfig', { githubOwner: 'Neko-NF', githubRepo: 'Neko-Status-Desktop' }],
    'getPendingInstall',
    'checkIntegrity',
    'rollbackInfo',
  ]);
});

test('renderer domain clients delegate config auth service and system IPC methods', async () => {
  const calls = [];
  const context = {
    window: {
      nekoIPC: {
        getAllConfig: async () => {
          calls.push('getAllConfig');
          return { serverMode: 'local' };
        },
        setManyConfig: async (cfg) => {
          calls.push(['setManyConfig', cfg]);
          return true;
        },
        authLogin: async (username, password) => {
          calls.push(['authLogin', username, password]);
          return { success: true };
        },
        authGetState: async () => {
          calls.push('authGetState');
          return { isLoggedIn: false };
        },
        startService: async () => {
          calls.push('startService');
          return { isRunning: true };
        },
        checkPermissions: async () => {
          calls.push('checkPermissions');
          return { screenCapture: 'granted' };
        },
        captureScreen: async () => {
          calls.push('captureScreen');
          return { type: 'image/png', data: [] };
        },
        notify: async (title, body) => {
          calls.push(['notify', title, body]);
          return true;
        },
      },
    },
    console,
  };
  context.window.window = context.window;

  loadBrowserScript(context, 'src/renderer/js/services/ipc-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/config-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/auth-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/service-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/system-client.js');

  const services = context.window._nekoModules.services;
  assert.deepEqual(await services.ConfigClient.getAll(), { serverMode: 'local' });
  assert.equal(await services.ConfigClient.setMany({ serverConfigured: true }), true);
  assert.deepEqual(await services.AuthClient.login('neko', 'secret'), { success: true });
  assert.deepEqual(await services.AuthClient.getState(), { isLoggedIn: false });
  assert.deepEqual(await services.ServiceClient.start(), { isRunning: true });
  assert.deepEqual(await services.SystemClient.checkPermissions(), { screenCapture: 'granted' });
  assert.deepEqual(await services.SystemClient.captureScreen(), { type: 'image/png', data: [] });
  assert.equal(await services.SystemClient.notify('Neko', 'ready'), true);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    'getAllConfig',
    ['setManyConfig', { serverConfigured: true }],
    ['authLogin', 'neko', 'secret'],
    'authGetState',
    'startService',
    'checkPermissions',
    'captureScreen',
    ['notify', 'Neko', 'ready'],
  ]);
});

test('renderer announcement client delegates announcement IPC methods', async () => {
  const calls = [];
  const context = {
    window: {
      nekoIPC: {
        fetchAnnouncements: async (options) => {
          calls.push(['fetchAnnouncements', options]);
          return { announcements: [] };
        },
        createAnnouncement: async (payload) => {
          calls.push(['createAnnouncement', payload]);
          return { id: 1 };
        },
        updateAnnouncement: async (id, payload) => {
          calls.push(['updateAnnouncement', id, payload]);
          return { id, ...payload };
        },
        deleteAnnouncement: async (id) => {
          calls.push(['deleteAnnouncement', id]);
          return { success: true };
        },
        recordAnnouncementReceipt: async (id, action) => {
          calls.push(['recordAnnouncementReceipt', id, action]);
          return { success: true };
        },
      },
    },
    console,
  };
  context.window.window = context.window;

  loadBrowserScript(context, 'src/renderer/js/services/ipc-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/announcement-client.js');

  const client = context.window._nekoModules.services.AnnouncementClient;
  assert.equal(client.isReady(), true);
  assert.deepEqual(await client.fetch({ all: true }), { announcements: [] });
  assert.deepEqual(await client.create({ title: 'A', content: 'B' }), { id: 1 });
  assert.deepEqual(await client.update(1, { pinned: true }), { id: 1, pinned: true });
  assert.deepEqual(await client.delete(1), { success: true });
  assert.deepEqual(await client.recordReceipt(1, 'ack'), { success: true });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['fetchAnnouncements', { all: true }],
    ['createAnnouncement', { title: 'A', content: 'B' }],
    ['updateAnnouncement', 1, { pinned: true }],
    ['deleteAnnouncement', 1],
    ['recordAnnouncementReceipt', 1, 'ack'],
  ]);
});

test('announcement page owns unread popup polling and receipt state', async () => {
  function makeElement(id) {
    const listeners = {};
    return {
      id,
      innerHTML: '',
      textContent: '',
      style: {},
      dataset: {},
      className: '',
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        toggle(value, enabled) {
          const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
          if (shouldAdd) this.values.add(value);
          else this.values.delete(value);
        },
        contains(value) { return this.values.has(value); },
      },
      addEventListener(type, handler) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(handler);
      },
      removeEventListener(type, handler) {
        listeners[type] = (listeners[type] || []).filter((item) => item !== handler);
      },
      dispatch(type, event = {}) {
        return Promise.all((listeners[type] || []).map((handler) => handler.call(this, {
          target: this,
          currentTarget: this,
          ...event,
        })));
      },
    };
  }

  const elements = new Map([
    'announcementPopupOverlay',
    'announcementPopupTitle',
    'announcementPopupContent',
    'announcementPopupMeta',
    'announcementPopupIcon',
    'announcementPopupCloseBtn',
  ].map((id) => [id, makeElement(id)]));
  const calls = [];
  const context = {
    window: {
      _nekoModules: {
        services: {
          AnnouncementClient: {
            isReady: () => true,
            fetch: async () => ({
              announcements: [{
                id: 7,
                title: 'Urgent maintenance',
                content: 'Restart window at 23:00',
                type: 'urgent',
                showPopup: true,
                pushNotification: true,
                createdAt: '2026-06-04T12:00:00Z',
              }],
            }),
            recordReceipt: async (id, action) => {
              calls.push(['receipt', id, action]);
              return { success: true };
            },
          },
          ConfigClient: {
            getAll: async () => ({ readAnnouncementIds: [] }),
            set: async (key, value) => {
              calls.push(['set', key, value]);
              return true;
            },
          },
          SystemClient: {
            notify: async (title, body) => {
              calls.push(['notify', title, body]);
              return true;
            },
          },
        },
      },
    },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelectorAll() {
        return [];
      },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;

  loadBrowserScript(context, 'src/renderer/js/pages/announcement.page.js');

  const page = context.window._nekoModules.pages.AnnouncementPage;
  await page.checkUnreadPopups();

  assert.equal(elements.get('announcementPopupOverlay').classList.contains('show'), true);
  assert.equal(elements.get('announcementPopupTitle').textContent, 'Urgent maintenance');
  assert.deepEqual(calls.slice(0, 2), [
    ['notify', 'Urgent maintenance', 'Restart window at 23:00'],
    ['receipt', 7, 'view'],
  ]);

  await elements.get('announcementPopupCloseBtn').dispatch('click');
  assert.equal(elements.get('announcementPopupOverlay').classList.contains('show'), false);
  assert.deepEqual(calls.at(-2), ['set', 'readAnnouncementIds', [7]]);
  assert.deepEqual(calls.at(-1), ['receipt', 7, 'ack']);
});

test('announcement page uses themed delete dialog instead of native confirm', async () => {
  function makeElement(id, extra = {}) {
    const listeners = {};
    const el = {
      id,
      dataset: extra.dataset || {},
      style: {},
      value: extra.value || '',
      textContent: extra.textContent || '',
      innerHTML: extra.innerHTML || '',
      disabled: false,
      classList: {
        values: new Set(extra.classes || []),
        add(...names) { names.forEach((name) => this.values.add(name)); },
        remove(...names) { names.forEach((name) => this.values.delete(name)); },
        contains(name) { return this.values.has(name); },
        toggle(name, force) {
          const next = force === undefined ? !this.values.has(name) : !!force;
          if (next) this.values.add(name);
          else this.values.delete(name);
          return next;
        },
      },
      addEventListener(type, handler) { listeners[type] = handler; },
      dispatch(type, event = {}) {
        return listeners[type]?.({ target: el, currentTarget: el, ...event });
      },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      closest() { return null; },
      focus() { el.focused = true; },
      ...extra,
    };
    return el;
  }

  const elements = new Map();
  [
    'announcementDeleteOverlay',
    'announcementDeleteTarget',
    'announcementDeleteCancelBtn',
    'announcementDeleteConfirmBtn',
  ].forEach((id) => elements.set(id, makeElement(id)));

  const calls = [];
  const context = {
    window: {
      _nekoModules: {
        services: {
          AnnouncementClient: {
            isReady: () => true,
            delete: async (id) => {
              calls.push(['delete', id]);
              return { success: true };
            },
          },
        },
      },
    },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelectorAll() { return []; },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    confirm() {
      throw new Error('native confirm should not be called');
    },
    setTimeout(fn) { fn(); return 1; },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;

  loadBrowserScript(context, 'src/renderer/js/pages/announcement.page.js');

  const page = context.window._nekoModules.pages.AnnouncementPage;
  page._deps = { showNotice: (message, type) => calls.push(['notice', message, type]) };
  page._items = [{ id: 9, _id: '9', title: 'Server maintenance' }];
  page.loadAnnouncements = async () => calls.push(['reload']);

  page.handleDelete(9);
  assert.equal(elements.get('announcementDeleteOverlay').classList.contains('show'), true);
  assert.equal(elements.get('announcementDeleteTarget').textContent, 'Server maintenance');

  await page.confirmDelete();
  assert.equal(elements.get('announcementDeleteOverlay').classList.contains('show'), false);
  assert.deepEqual(calls, [
    ['delete', 9],
    ['reload'],
    ['notice', '公告已删除', 'success'],
  ]);
});

test('about page owns version rendering and repository links', async () => {
  function makeElement(id, extra = {}) {
    const listeners = {};
    return {
      id,
      href: extra.href || '',
      textContent: extra.textContent || '',
      dataset: {},
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        contains(value) { return this.values.has(value); },
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      dispatch(type, event = {}) {
        return listeners[type]?.({ target: this, currentTarget: this, preventDefault() {}, ...event });
      },
      ...extra,
    };
  }

  function makeAboutCard(labelText) {
    const label = makeElement(`${labelText}-label`, { textContent: labelText });
    const value = makeElement(`${labelText}-value`);
    const sub = makeElement(`${labelText}-sub`);
    return {
      label,
      value,
      sub,
      querySelector(selector) {
        if (selector === '.about-info-label') return label;
        if (selector === '.about-info-value') return value;
        if (selector === '.about-info-sub') return sub;
        return null;
      },
    };
  }

  const runtimeCard = makeAboutCard('运行环境');
  const developerCardInfo = makeAboutCard('开发者');
  const licenseCard = makeAboutCard('开源协议');
  const calls = [];
  const elements = new Map([
    ['aboutVersionValue', makeElement('aboutVersionValue')],
    ['aboutVersionSub', makeElement('aboutVersionSub')],
    ['aboutGithubBtn', makeElement('aboutGithubBtn')],
    ['aboutReleaseBtn', makeElement('aboutReleaseBtn')],
    ['aboutDeveloperCard', makeElement('aboutDeveloperCard')],
  ]);
  const context = {
    window: { _nekoModules: { pages: {} } },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelectorAll(selector) {
        if (selector === '.about-info-card') return [runtimeCard, developerCardInfo, licenseCard];
        return [];
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/about.page.js');

  const page = context.window._nekoModules.pages.AboutPage;
  page.init({
    openExternal: (url) => calls.push(['open', url]),
    fetchRepo: async () => ({
      owner: { login: 'Neko-NF', html_url: 'https://github.com/Neko-NF' },
      organization: { login: 'Neko Lab' },
      license: { spdx_id: 'MIT' },
    }),
  });
  page.sync({
    version: '1.3.0-beta.3',
    cfg: { githubOwner: 'Neko-NF', githubRepo: 'Neko-Status-Desktop' },
    runtimeVersions: { electron: '35.0.0', node: '22.0.0', chrome: '134.0.0' },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get('aboutVersionValue').textContent, 'v1.3.0-beta.3');
  assert.match(elements.get('aboutVersionSub').textContent, /Beta/);
  assert.equal(elements.get('aboutGithubBtn').href, 'https://github.com/Neko-NF/Neko-Status-Desktop');
  assert.equal(elements.get('aboutReleaseBtn').href, 'https://github.com/Neko-NF/Neko-Status-Desktop/releases');
  assert.equal(runtimeCard.value.textContent, 'Electron 35.0.0');
  assert.equal(runtimeCard.sub.textContent, 'Node.js 22.0.0 · Chromium 134.0.0');
  assert.equal(developerCardInfo.value.textContent, 'Neko-NF');
  assert.equal(developerCardInfo.sub.textContent, 'Neko Lab');
  assert.equal(licenseCard.value.textContent, 'MIT');

  elements.get('aboutGithubBtn').dispatch('click');
  elements.get('aboutDeveloperCard').dispatch('click');
  assert.deepEqual(calls, [
    ['open', 'https://github.com/Neko-NF/Neko-Status-Desktop'],
    ['open', 'https://github.com/Neko-NF'],
  ]);
});

test('security dialogs own takeover warning and confirm flow', async () => {
  function makeElement(id) {
    const listeners = {};
    return {
      id,
      textContent: '',
      innerHTML: '',
      style: {},
      dataset: {},
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        contains(value) { return this.values.has(value); },
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      removeEventListener(type, handler) {
        if (listeners[type] === handler) delete listeners[type];
      },
      dispatch(type, event = {}) {
        return listeners[type]?.({ target: this, currentTarget: this, ...event });
      },
    };
  }

  const elements = new Map([
    'takeoverWarningModal',
    'takeoverWarningTitle',
    'takeoverWarningDesc',
    'takeoverDetailBox',
    'takeoverWarningActionBtn',
    'takeoverWarningDismissBtn',
    'takeoverWarningCloseBtn',
    'takeoverConfirmModal',
    'takeoverConfirmOkBtn',
    'takeoverConfirmCancelBtn',
    'takeoverConfirmCloseBtn',
  ].map((id) => [id, makeElement(id)]));
  const calls = [];
  const context = {
    window: { _nekoModules: { components: {} } },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/components/security-dialogs.js');

  const dialogs = context.window._nekoModules.components.SecurityDialogs.create({
    showNotice: (title, type, duration) => calls.push(['notice', title, type, duration]),
    openConfig: () => calls.push(['openConfig']),
  });

  assert.equal(dialogs.showWarning('Key revoked', 'Please reset', '<unsafe>', true), true);
  assert.equal(elements.get('takeoverWarningModal').classList.contains('show'), true);
  assert.equal(elements.get('takeoverWarningTitle').textContent, 'Key revoked');
  assert.equal(elements.get('takeoverWarningDesc').textContent, 'Please reset');
  assert.match(elements.get('takeoverDetailBox').innerHTML, /&lt;unsafe&gt;/);
  assert.equal(elements.get('takeoverWarningActionBtn').style.display, '');

  elements.get('takeoverWarningActionBtn').dispatch('click');
  assert.equal(elements.get('takeoverWarningModal').classList.contains('show'), false);
  assert.deepEqual(calls.slice(0, 2), [
    ['notice', 'Key revoked', 'error', 5000],
    ['openConfig'],
  ]);

  const confirmPromise = dialogs.confirmTakeover();
  elements.get('takeoverConfirmOkBtn').dispatch('click');
  assert.equal(await confirmPromise, true);
  assert.equal(elements.get('takeoverConfirmModal').classList.contains('show'), false);
});

test('experimental features component owns settings mount and stream gate state', () => {
  function makeElement(id, extra = {}) {
    const el = {
      id,
      dataset: extra.dataset || {},
      style: {},
      children: [],
      parentNode: null,
      clicked: 0,
      className: '',
      innerHTML: '',
      textContent: '',
      attributes: {},
      classList: {
        values: new Set(),
        add(...names) { names.forEach((name) => this.values.add(name)); },
        remove(...names) { names.forEach((name) => this.values.delete(name)); },
        toggle(name, force) {
          const next = force === undefined ? !this.values.has(name) : !!force;
          if (next) this.values.add(name);
          else this.values.delete(name);
          return next;
        },
        contains(name) { return this.values.has(name); },
      },
      appendChild(child) {
        child.parentNode = el;
        el.children.push(child);
        return child;
      },
      remove() {
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((child) => child !== el);
        el.parentNode = null;
        el.removed = true;
      },
      setAttribute(name, value) {
        el.attributes[name] = String(value);
      },
      removeAttribute(name) {
        delete el.attributes[name];
      },
      click() {
        el.clicked += 1;
      },
    };
    return el;
  }

  const elements = new Map([
    ['settingsExperimentalZone', makeElement('settingsExperimentalZone')],
    ['settingsExperimentalLabel', makeElement('settingsExperimentalLabel')],
    ['settings-experimental', makeElement('settings-experimental')],
    ['stgExperimentalActivityRow', makeElement('stgExperimentalActivityRow')],
    ['stgExperimentalStreamRow', makeElement('stgExperimentalStreamRow')],
    ['stgExperimentalUiLabRow', makeElement('stgExperimentalUiLabRow')],
    ['stgExperimentalDesc', makeElement('stgExperimentalDesc')],
    ['streamExperimentalGate', makeElement('streamExperimentalGate')],
    ['streamExperimentalContent', makeElement('streamExperimentalContent')],
    ['page-stream', makeElement('page-stream')],
    ['page-activity', makeElement('page-activity')],
    ['page-ui-lab', makeElement('page-ui-lab')],
    ['stgExperimentalSwitch', makeElement('stgExperimentalSwitch')],
    ['stgExperimentalActivitySwitch', makeElement('stgExperimentalActivitySwitch')],
    ['stgExperimentalStreamSwitch', makeElement('stgExperimentalStreamSwitch')],
    ['stgExperimentalUiLabSwitch', makeElement('stgExperimentalUiLabSwitch')],
    ['navActivity', makeElement('navActivity')],
    ['navStream', makeElement('navStream')],
    ['navUiLab', makeElement('navUiLab')],
  ]);
  const activeUiLabNav = makeElement('activeUiLabNav');
  const dashboardNav = makeElement('dashboardNav');
  const calls = [];
  const context = {
    window: {
      _nekoSyncNavIndicator: () => calls.push('syncNav'),
      stopStreamStatusPolling: () => calls.push('stopStream'),
    },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      createElement(tag) {
        return makeElement(tag);
      },
      querySelector(selector) {
        if (selector === '.nav-item.active[data-target="page-ui-lab"]') return activeUiLabNav;
        if (selector === '.nav-item[data-target="mainDashboardArea"]') return dashboardNav;
        return null;
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/components/experimental-features.js');
  const expanded = [];
  const runtime = context.window._nekoModules.components.ExperimentalFeatures.create({
    setExpandableSectionState: (el, state, options) => expanded.push([el?.id, state, options?.display]),
  });

  runtime.mountSettingsZone();
  assert.equal(elements.get('settingsExperimentalZone').dataset.mounted, '1');
  assert.ok(elements.get('settings-experimental').classList.contains('settings-experimental-shell'));

  runtime.applyState({
    enableExperimentalFeatures: true,
    enableExperimentalActivityEntry: true,
    enableExperimentalStreamEntry: true,
    enableExperimentalUiLabEntry: true,
  });
  assert.equal(elements.get('navStream').attributes['aria-hidden'], 'false');
  assert.ok(elements.get('navStream').classList.contains('show'));
  assert.equal(elements.get('navActivity').attributes['aria-hidden'], 'false');
  assert.ok(elements.get('navActivity').classList.contains('show'));
  assert.ok(elements.get('stgExperimentalActivitySwitch').classList.contains('on'));
  assert.ok(elements.get('stgExperimentalStreamSwitch').classList.contains('on'));
  assert.ok(elements.get('stgExperimentalUiLabSwitch').classList.contains('on'));
  assert.equal(elements.get('navUiLab').attributes['aria-hidden'], 'false');
  assert.ok(elements.get('settings-experimental').classList.contains('is-experimental-expanded'));
  assert.equal(elements.get('stgExperimentalActivityRow').attributes['aria-hidden'], 'false');

  runtime.applyState({ enableExperimentalFeatures: false });
  assert.equal(elements.get('navStream').attributes['aria-hidden'], 'true');
  assert.equal(elements.get('navStream').attributes.tabindex, '-1');
  assert.equal(elements.get('navActivity').attributes['aria-hidden'], 'true');
  assert.equal(elements.get('navUiLab').attributes['aria-hidden'], 'true');
  assert.equal(elements.get('stgExperimentalActivityRow').attributes['aria-hidden'], 'true');
  assert.ok(elements.get('stgExperimentalStreamRow').classList.contains('is-collapsed'));
  assert.equal(elements.get('settings-experimental').classList.contains('is-experimental-expanded'), false);
  assert.equal(elements.get('page-stream').style.display, 'none');
  assert.equal(elements.get('page-ui-lab').style.display, 'none');
  assert.equal(dashboardNav.clicked, 1);
  assert.deepEqual(calls, ['syncNav', 'syncNav', 'stopStream']);
  assert.ok(expanded.some((entry) => entry[0] === 'streamExperimentalGate' && entry[1] === true));
});

test('activity experimental entry stays hidden when only the runtime feature is enabled', () => {
  function makeClassList() {
    const values = new Set();
    return {
      toggle(name, force) {
        const next = force === undefined ? !values.has(name) : !!force;
        if (next) values.add(name);
        else values.delete(name);
      },
      contains(name) { return values.has(name); },
    };
  }
  function makeElement() {
    return {
      style: { removeProperty() {} },
      classList: makeClassList(),
      setAttribute() {},
      removeAttribute() {},
    };
  }
  const elements = new Map([
    ['stgExperimentalSwitch', makeElement()],
    ['stgExperimentalActivitySwitch', makeElement()],
    ['stgExperimentalStreamSwitch', makeElement()],
    ['stgExperimentalActivityRow', makeElement()],
    ['stgExperimentalStreamRow', makeElement()],
    ['settings-experimental', makeElement()],
    ['stgExperimentalDesc', makeElement()],
    ['streamExperimentalGate', makeElement()],
    ['streamExperimentalContent', makeElement()],
    ['page-stream', makeElement()],
    ['page-activity', makeElement()],
    ['navActivity', makeElement()],
    ['navStream', makeElement()],
  ]);
  const context = {
    window: {},
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelector() { return null; },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  loadBrowserScript(context, 'src/renderer/js/components/experimental-features.js');

  const runtime = context.window._nekoModules.components.ExperimentalFeatures.create();
  runtime.applyState({
    enableExperimentalFeatures: true,
    enableExperimentalActivityEntry: false,
    enableActivityFeature: true,
  });

  assert.equal(elements.get('navActivity').classList.contains('show'), false);
  assert.equal(elements.get('stgExperimentalActivitySwitch').classList.contains('on'), false);
  assert.equal(elements.get('page-activity').style.display, 'none');
});

test('announcement pin actions use icons available in the regular phosphor bundle', () => {
  const pageSource = fs.readFileSync(path.join(ROOT, 'src/renderer/js/pages/announcement.page.js'), 'utf8');
  const regularIcons = fs.readFileSync(path.join(ROOT, 'node_modules/@phosphor-icons/web/src/regular/style.css'), 'utf8');

  assert.match(pageSource, /ph-push-pin-simple-slash/);
  assert.doesNotMatch(pageSource, /ph-push-pin-fill/);
  assert.match(regularIcons, /\.ph\.ph-push-pin-simple-slash:before/);
});

test('config page loads modal values and saves through ConfigClient', async () => {
  function makeElement(id, extra = {}) {
    const listeners = {};
    return {
      id,
      value: extra.value || '',
      innerHTML: extra.innerHTML || '',
      disabled: false,
      dataset: {},
      style: {},
      classList: {
        values: new Set(extra.classes || []),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        toggle(value, enabled) {
          const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
          if (shouldAdd) this.values.add(value);
          else this.values.delete(value);
        },
        contains(value) { return this.values.has(value); },
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      cloneNode() {
        return makeElement(id, extra);
      },
      parentNode: {
        replaceChild(next) {
          elements.set(id, next);
        },
      },
      dispatch(type, event = {}) {
        return listeners[type]?.({ target: this, currentTarget: this, ...event });
      },
      querySelectorAll(selector) {
        if (selector === '.modal-mode-btn') return extra.modeButtons || [];
        return [];
      },
      ...extra,
    };
  }

  const modeButtons = [
    makeElement('modeLocal', { dataset: { mode: 'local' } }),
    makeElement('modeServer', { dataset: { mode: 'server' } }),
  ];
  const elements = new Map([
    ['configUrlInput', makeElement('configUrlInput')],
    ['configApiKeyInput', makeElement('configApiKeyInput')],
    ['configModeSwitcher', makeElement('configModeSwitcher', { modeButtons })],
    ['saveConfigBtn', makeElement('saveConfigBtn', { innerHTML: 'Save' })],
    ['btnConfigKey', makeElement('btnConfigKey')],
    ['stgConfigBtn', makeElement('stgConfigBtn')],
    ['configModal', makeElement('configModal')],
  ]);
  const logs = [];
  const calls = [];
  const context = {
    window: {
      _nekoModules: {
        services: {
          ConfigClient: {
            getAll: async () => ({
              serverMode: 'local',
              serverUrlLocal: 'http://localhost:8080',
              serverUrlProd: 'https://api.example.com',
              deviceKey: 'old-key',
            }),
            get: async (key) => {
              calls.push(['get', key]);
              return 'old-key';
            },
            setMany: async (cfg) => {
              calls.push(['setMany', cfg]);
              return true;
            },
            testConnection: async (serverUrl) => {
              calls.push(['testConnection', serverUrl]);
              return { ok: true, latencyMs: 12 };
            },
          },
        },
      },
      _authPendingAfterConfig: false,
      setTimeout(fn) { fn(); },
    },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
    },
    setTimeout() { return 1; },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/config.page.js');

  const page = context.window._nekoModules.pages.ConfigPage;
  page.init({
    addLogLine: (level, msg) => logs.push([level, msg]),
    showNotice: (msg, type) => logs.push(['NOTICE', type, msg]),
  });

  await page.loadConfigToModal();
  assert.equal(elements.get('configUrlInput').value, 'http://localhost:8080');
  assert.equal(elements.get('configApiKeyInput').value, 'old-key');
  assert.equal(modeButtons[0].classList.contains('active'), true);

  elements.get('configUrlInput').value = 'https://api.example.com';
  elements.get('configApiKeyInput').value = 'old-key';
  await page.saveConfig();

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['testConnection', 'https://api.example.com'],
    ['get', 'deviceKey'],
    ['setMany', {
      deviceKey: 'old-key',
      serverMode: 'production',
      serverConfigured: true,
      serverUrlProd: 'https://api.example.com',
    }],
  ]);
  assert.equal(logs.some(([level]) => level === 'SUCCESS'), true);
});

test('service page owns health check rendering and init state', async () => {
  const elements = new Map();

  function makeElement(id, extra = {}) {
    const listeners = {};
    return {
      id,
      innerHTML: extra.innerHTML || '',
      textContent: extra.textContent || '',
      value: extra.value || '',
      disabled: false,
      dataset: extra.dataset || {},
      style: {},
      children: [],
      className: extra.className || '',
      classList: {
        values: new Set(extra.classes || []),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        toggle(value, enabled) {
          const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
          if (shouldAdd) this.values.add(value);
          else this.values.delete(value);
        },
        contains(value) { return this.values.has(value); },
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      appendChild(child) {
        this.children.push(child);
      },
      cloneNode() {
        return makeElement(id, {
          ...extra,
          className: this.className,
          innerHTML: this.innerHTML,
          textContent: this.textContent,
          value: this.value,
        });
      },
      dispatch(type, event = {}) {
        return listeners[type]?.({ target: this, currentTarget: this, ...event });
      },
      parentNode: {
        replaceChild(next) {
          elements.set(id, next);
        },
      },
      ...extra,
    };
  }

  [
    'runHealthCheckBtn',
    'healthResultsList',
    'daemonProcessName',
    'daemonPidBadge',
    'daemonStatus',
    'privLevelBadge',
    'permScreenCapture',
    'permProcessEnum',
    'permPowerControl',
    'permNetwork',
    'permFileIO',
    'captureStatus',
    'reportAutoDelayInput',
    'startDelayInput',
    'maxRestartsInput',
    'restartIntervalInput',
    'restartIntervalUnit',
    'watchdogTimeoutInput',
    'watchdogUnit',
    'reportAutoStartSwitch',
    'reportAutoDelayRow',
    'autoRestartSwitch',
    'autoStartMinimizeSwitch',
  ].forEach((id) => elements.set(id, makeElement(id)));
  elements.get('restartIntervalUnit').value = 'm';

  const calls = [];
  const context = {
    window: {
      _nekoModules: {
        pages: {},
        services: {
          ServiceClient: {
            runHealthCheck: async () => [
              { name: 'service', text: 'running', ok: true },
              { name: 'network', text: 'slow', ok: 'warn' },
            ],
            checkPermissions: async () => ({
              screenCapture: 'granted',
              processEnum: 'granted',
              powerControl: 'denied',
              network: 'granted',
              fileIO: 'granted',
            }),
          },
          ConfigClient: {
            set: async (key, value) => {
              calls.push(['set', key, value]);
              return true;
            },
          },
        },
      },
      _nekoUIHelpers: {
        setExpandableSectionState(el, expanded) {
          if (el) el.dataset.expanded = String(expanded);
        },
      },
    },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      createElement(tag) {
        return makeElement(tag);
      },
    },
    setTimeout(fn) {
      fn();
      return 1;
    },
    clearTimeout() {},
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/service.page.js');

  const page = context.window._nekoModules.pages.ServicePage;
  page.init({
    service: context.window._nekoModules.services.ServiceClient,
    config: context.window._nekoModules.services.ConfigClient,
    setExpandableSectionState: context.window._nekoUIHelpers.setExpandableSectionState,
  });

  await elements.get('runHealthCheckBtn').dispatch('click');
  assert.equal(elements.get('runHealthCheckBtn').disabled, false);
  assert.equal(elements.get('healthResultsList').children.length, 3);
  assert.match(elements.get('healthResultsList').children[0].innerHTML, /2/);

  page.initFromAppInit({
    processName: 'NekoStatus',
    pid: 42,
    isAdmin: true,
    config: {
      minimizeOnAutoStart: true,
      enableAutoRestart: false,
      reportInterval: 12,
      startupDelayMs: 7000,
      maxRestarts: 5,
      restartIntervalSec: 45,
      watchdogTimeoutSec: 90,
      enableAutoServiceStart: true,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(elements.get('daemonProcessName').textContent, 'NekoStatus');
  assert.equal(elements.get('daemonPidBadge').textContent, 'PID 42');
  assert.equal(elements.get('reportAutoDelayInput').value, 12);
  assert.equal(elements.get('startDelayInput').value, 7);
  assert.equal(elements.get('reportAutoDelayRow').dataset.expanded, 'true');
  assert.equal(elements.get('permScreenCapture').className, 'perm-status success');
  assert.equal(elements.get('permPowerControl').className, 'perm-status error');

  elements.get('restartIntervalInput').value = '3';
  await elements.get('restartIntervalInput').dispatch('change');
  assert.deepEqual(calls.at(-1), ['set', 'restartIntervalSec', 180]);
});

test('update page renders update dialog state without direct IPC access', () => {
  function makeElement(id) {
    const listeners = {};
    return {
      id,
      innerHTML: '',
      textContent: '',
      style: {},
      className: '',
      dataset: {},
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        contains(value) { return this.values.has(value); },
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      dispatch(type, event = {}) {
        if (listeners[type]) listeners[type]({ target: this, ...event });
      },
    };
  }

  const elements = new Map([
    'updateDialogOverlay',
    'updateDialogCurrentVer',
    'updateDialogNewVer',
    'updateDialogSize',
    'updateDialogDate',
    'updateDialogChannel',
    'updateDialogNotes',
    'updateDialogForceBanner',
    'updateDialogClose',
    'updateDialogSkipBtn',
    'updateDialogInstallBtn',
  ].map((id) => [id, makeElement(id)]));

  const context = {
    window: {},
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector() {
        return null;
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/update.page.js');

  const page = context.window._nekoModules.pages.UpdatePage;
  assert.equal(page.showDialog({
    currentVersion: '1.2.7',
    latestVersion: '1.2.8',
    downloadSize: 10485760,
    publishedAt: '2026-05-18T00:00:00Z',
    channel: 'stable',
    forceUpdate: true,
    releaseNotes: '# Release\n- Fix update flow',
  }), true);

  assert.equal(elements.get('updateDialogCurrentVer').textContent, '1.2.7');
  assert.equal(elements.get('updateDialogNewVer').textContent, '1.2.8');
  assert.match(elements.get('updateDialogSize').innerHTML, /10\.0 MB/);
  assert.match(elements.get('updateDialogNotes').innerHTML, /Fix update flow/);
  assert.equal(elements.get('updateDialogForceBanner').style.display, '');
  assert.equal(elements.get('updateDialogClose').style.display, 'none');
  assert.equal(elements.get('updateDialogOverlay')._updateResult.latestVersion, '1.2.8');

  assert.equal(page.hideDialog(), true);
  assert.equal(elements.get('updateDialogOverlay').classList.contains('show'), false);

  const actions = [];
  page.bindDialogActions({
    onClose: () => actions.push('close'),
    onSkip: (result) => actions.push(['skip', result.latestVersion]),
    onInstall: (result) => actions.push(['install', result.latestVersion]),
  });

  page.showDialog({ latestVersion: '1.2.9', forceUpdate: false });
  elements.get('updateDialogSkipBtn').dispatch('click');
  elements.get('updateDialogInstallBtn').dispatch('click');
  elements.get('updateDialogOverlay').dispatch('click');

  assert.deepEqual(actions, [
    ['skip', '1.2.9'],
    ['install', '1.2.9'],
    'close',
  ]);
});

test('update page owns local package install through injected clients', async () => {
  function makeElement(id) {
    const listeners = {};
    return {
      id,
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      dispatch(type, event = {}) {
        if (!listeners[type]) return undefined;
        return listeners[type]({ target: this, ...event });
      },
    };
  }

  const localInstallBtn = makeElement('localInstallBtn');
  const calls = [];
  const logs = [];
  const context = {
    window: { _nekoModules: {} },
    document: {
      getElementById(id) {
        return id === 'localInstallBtn' ? localInstallBtn : null;
      },
      querySelector() {
        return null;
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/update.page.js');

  const page = context.window._nekoModules.pages.UpdatePage;
  page.init();
  page.init({
    addLogLine: (level, message) => logs.push([level, message]),
    system: {
      selectFile: async (options) => {
        calls.push(['selectFile', options]);
        return 'C:\\tmp\\NekoStatus-Setup.exe';
      },
    },
    update: {
      install: async (filePath, sha256, options) => {
        calls.push(['install', filePath, sha256, options]);
        return { success: true };
      },
    },
  });

  await localInstallBtn.dispatch('click');

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['selectFile', {
      title: '选择更新安装包',
      filters: [{ name: '安装包', extensions: ['exe', 'zip', '7z'] }],
    }],
    ['install', 'C:\\tmp\\NekoStatus-Setup.exe', null, { manual: true }],
  ]);
  assert.deepEqual(logs, [
    ['INFO', '选择本地安装包: C:\\tmp\\NekoStatus-Setup.exe'],
    ['SUCCESS', '安装程序已启动'],
  ]);
});

test('update page owns download progress and background update state', async () => {
  function makeClassList() {
    return {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
    };
  }

  function makeElement(id) {
    const listeners = {};
    return {
      id,
      innerHTML: '',
      textContent: '',
      className: '',
      disabled: false,
      _updateMode: '',
      style: {},
      dataset: {},
      classList: makeClassList(),
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      dispatch(type, event = {}) {
        if (listeners[type]) return listeners[type]({ target: this, currentTarget: this, ...event });
        return undefined;
      },
      querySelector() {
        return null;
      },
    };
  }

  const ids = [
    'updateProgressRow',
    'updateProgressBar',
    'updateProgressPct',
    'updateProgressFill',
    'updateProgressLabel',
    'updateStatusBadge',
    'checkUpdateBtn',
    'checkUpdateLabel',
    'checkUpdateIcon',
    'forceUpdateBtn',
    'rollbackBtn',
    'updateDialogOverlay',
    'updateDialogCurrentVer',
    'updateDialogNewVer',
    'updateDialogSize',
    'updateDialogDate',
    'updateDialogChannel',
    'updateDialogNotes',
    'updateDialogForceBanner',
    'updateDialogClose',
    'updateDialogSkipBtn',
    'updateVerNumber',
    'updateVerDesc',
  ];
  const elements = new Map(ids.map((id) => [id, makeElement(id)]));
  const navUpdate = makeElement('navUpdate');
  const forceLabel = makeElement('forceLabel');
  const rollbackIcon = makeElement('rollbackIcon');
  const rollbackLabel = makeElement('rollbackLabel');
  elements.get('forceUpdateBtn').querySelector = (selector) => (selector === '.update-ctrl-label' ? forceLabel : null);
  elements.get('rollbackBtn').querySelector = (selector) => {
    if (selector === 'i') return rollbackIcon;
    if (selector === 'span') return rollbackLabel;
    return null;
  };
  const channelBadge = makeElement('channelBadge');
  const versionTag = makeElement('versionTag');
  const timeline = makeElement('timeline');
  timeline.children = [];
  timeline.appendChild = (child) => {
    timeline.children.push(child);
  };
  const calls = [];
  const logs = [];
  const notices = [];
  let pendingInstall = null;
  const context = {
    window: { _nekoModules: {} },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector(selector) {
        if (selector === '.nav-item[data-target="page-update"]') return navUpdate;
        if (selector === '.update-channel-badge') return channelBadge;
        if (selector === '.update-ver-tag') return versionTag;
        if (selector === '.update-timeline') return timeline;
        return null;
      },
      createElement: makeElement,
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/update.page.js');

  const page = context.window._nekoModules.pages.UpdatePage;
  page.init({
    addLogLine: (level, message) => logs.push([level, message]),
    showNotice: (message, type) => notices.push([message, type]),
    update: {
      check: async () => {
        calls.push(['check']);
        return {
          hasUpdate: true,
          currentVersion: '1.2.9',
          latestVersion: '1.3.2',
          exeDownloadUrl: 'https://example.com/NekoStatus-1.3.2.exe',
        };
      },
      download: async (url) => {
        calls.push(['download', url]);
        return {
          success: true,
          filePath: 'C:\\tmp\\NekoStatus-Setup.exe',
          sha256: 'abcdef0123456789',
        };
      },
      install: async (filePath, sha256) => {
        calls.push(['install', filePath, sha256]);
        return { success: true };
      },
      installPending: async () => {
        calls.push(['installPending']);
        return { success: true };
      },
      getPendingInstall: async () => {
        calls.push(['getPendingInstall']);
        return pendingInstall || { hasPending: false };
      },
      rollbackInfo: async () => {
        calls.push(['rollbackInfo']);
        return {
          success: true,
          version: '1.2.8',
          exeDownloadUrl: 'https://example.com/NekoStatus-1.2.8.exe',
        };
      },
    },
    config: {
      get: async (key) => {
        calls.push(['get', key]);
        return '';
      },
      set: async (key, value) => {
        calls.push(['set', key, value]);
        return true;
      },
    },
  });

  assert.equal(await page.downloadAndInstall({
    latestVersion: '1.2.9',
    exeDownloadUrl: 'https://example.com/NekoStatus-Setup.exe',
  }), true);
  assert.deepEqual(calls, [
    ['download', 'https://example.com/NekoStatus-Setup.exe'],
    ['install', 'C:\\tmp\\NekoStatus-Setup.exe', 'abcdef0123456789'],
  ]);
  assert.equal(elements.get('updateProgressRow').style.display, '');
  assert.equal(elements.get('updateProgressPct').textContent, '100%');
  assert.equal(elements.get('updateProgressFill').style.width, '100%');
  assert.equal(elements.get('updateProgressLabel').textContent, '校验完成');
  assert.equal(logs.some(([level]) => level === 'SUCCESS'), true);

  page.updateProgress({ pct: 42, received: 1024, total: 2048, speed: 512 });
  assert.equal(elements.get('updateProgressPct').textContent, '42%');
  assert.equal(elements.get('updateProgressFill').style.width, '42%');
  assert.match(elements.get('updateProgressLabel').textContent, /1\.0 KB \/ 2\.0 KB/);

  page.markAutoDownloaded({ version: '1.3.0' });
  assert.equal(navUpdate.classList.contains('has-update'), true);
  assert.match(elements.get('updateStatusBadge').innerHTML, /1\.3\.0/);
  assert.equal(elements.get('checkUpdateBtn')._updateMode, 'install-pending');

  assert.equal(page.markAvailable({
    hasUpdate: true,
    currentVersion: '1.2.9',
    latestVersion: '1.3.1',
    releaseNotes: '- update runtime',
  }), true);
  assert.equal(elements.get('checkUpdateBtn')._updateMode, 'download');
  assert.equal(elements.get('updateDialogOverlay').classList.contains('show'), true);
  assert.match(elements.get('updateStatusBadge').innerHTML, /1\.3\.1/);

  assert.equal(page.renderReleaseNotes({
    currentVersion: '1.2.9-beta.1',
    latestVersion: '1.3.1',
  }), true);
  assert.equal(channelBadge.className, 'update-channel-badge beta');
  assert.equal(versionTag.textContent, 'Beta');

  assert.equal(page.syncInstalledVersion({
    version: '1.3.1-nightly.2',
    cfg: { lastUpdateCheck: '2026-06-05T00:00:00.000Z' },
    runtimeVersions: { electron: '37.0.0', node: '24.0.0' },
  }), true);
  assert.equal(channelBadge.className, 'update-channel-badge nightly');
  assert.equal(elements.get('updateVerNumber').textContent, 'v1.3.1-nightly.2');
  assert.match(elements.get('updateVerDesc').textContent, /Electron 37\.0\.0/);

  assert.equal(page.renderChangelogEntries([{
    version: '1.3.1',
    date: '2026-06-05',
    notes: '## Added\n- update page rendering',
    isPreRelease: false,
  }]), true);
  assert.equal(timeline.children.length, 1);
  assert.match(timeline.children[0].innerHTML, /update page rendering/);

  elements.get('checkUpdateBtn')._updateMode = 'check';
  assert.equal((await page.checkForUpdates()).latestVersion, '1.3.2');
  assert.equal(elements.get('checkUpdateBtn')._updateMode, 'download');
  assert.equal(calls.some((call) => call[0] === 'check'), true);
  assert.equal(calls.some((call) => call[0] === 'get' && call[1] === 'skippedVersion'), true);

  pendingInstall = { hasPending: true, version: '1.3.2' };
  elements.get('checkUpdateBtn')._updateMode = 'check';
  const downloadsBeforePendingCheck = calls.filter((call) => call[0] === 'download').length;
  assert.equal((await page.checkForUpdates()).latestVersion, '1.3.2');
  assert.equal(elements.get('checkUpdateBtn')._updateMode, 'install-pending');
  assert.equal(calls.filter((call) => call[0] === 'download').length, downloadsBeforePendingCheck);
  pendingInstall = null;

  page.setPendingInstall('1.3.3');
  assert.equal((await page.checkForUpdates()).success, true);
  assert.equal(calls.some((call) => call[0] === 'installPending'), true);

  assert.equal((await page.forceUpdate()).latestVersion, '1.3.2');
  assert.equal(calls.some((call) => call[0] === 'set' && call[1] === 'skippedVersion'), true);

  assert.equal((await page.rollbackVersion()).confirming, true);
  assert.equal((await page.rollbackVersion()).version, '1.2.8');
  assert.equal(calls.some((call) => call[0] === 'rollbackInfo'), true);
  assert.equal(notices.some(([message]) => message.includes('发现新版本')), true);
  assert.equal(notices.some(([message]) => message.includes('正在下载回滚版本')), true);
});

test('update page owns update channel controls through injected update client', async () => {
  function makeRadio(value) {
    const listeners = {};
    return {
      value,
      checked: false,
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      dispatch(type, event = {}) {
        if (!listeners[type]) return undefined;
        return listeners[type]({ target: this, ...event });
      },
    };
  }

  const stable = makeRadio('stable');
  const beta = makeRadio('beta');
  const calls = [];
  const logs = [];
  const context = {
    window: { _nekoModules: {} },
    document: {
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'input[name="updateChannel"]') return [stable, beta];
        return [];
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/update.page.js');

  const page = context.window._nekoModules.pages.UpdatePage;
  page.init({
    addLogLine: (level, message) => logs.push([level, message]),
    update: {
      setChannel: async (channel) => {
        calls.push(['setChannel', channel]);
        return true;
      },
    },
  });

  beta.checked = true;
  await beta.dispatch('change');
  page.syncChannel('stable');

  assert.deepEqual(calls, [['setChannel', 'beta']]);
  assert.deepEqual(logs, [['INFO', '更新通道已切换为 beta']]);
  assert.equal(stable.checked, true);
  assert.equal(beta.checked, false);
});

test('update page owns integrity check button rendering and logging', async () => {
  function makeButton(id) {
    const listeners = {};
    const label = { textContent: '完整性检查' };
    return {
      id,
      disabled: false,
      querySelector(selector) {
        return selector === 'span' ? label : null;
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      dispatch(type, event = {}) {
        if (!listeners[type]) return undefined;
        return listeners[type]({ target: this, ...event });
      },
      label,
    };
  }

  const integrityBtn = makeButton('updateIntegrityBtn');
  const badge = { className: '', innerHTML: '' };
  const logs = [];
  const notices = [];
  const context = {
    window: { _nekoModules: {} },
    document: {
      getElementById(id) {
        if (id === 'updateIntegrityBtn') return integrityBtn;
        if (id === 'updateStatusBadge') return badge;
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/update.page.js');

  const page = context.window._nekoModules.pages.UpdatePage;
  page.init({
    addLogLine: (level, message) => logs.push([level, message]),
    showNotice: (message, type, duration) => notices.push([message, type, duration]),
    update: {
      checkIntegrity: async () => [
        { name: 'package', ok: true, text: 'OK' },
        { name: 'installer', ok: false, text: 'missing' },
      ],
    },
  });

  await integrityBtn.dispatch('click');

  assert.equal(integrityBtn.disabled, false);
  assert.equal(integrityBtn.label.textContent, '完整性检查');
  assert.deepEqual(notices, [['完整性检查异常: installer: missing', 'error', 5000]]);
  assert.match(badge.className, /warn/);
  assert.match(badge.innerHTML, /1 项异常/);
  assert.deepEqual(logs, [
    ['INFO', '[完整性] package: OK'],
    ['WARN', '[完整性] installer: missing'],
  ]);
});

test('update page owns update source controls and persists through injected config client', async () => {
  function makeElement(id, extra = {}) {
    const listeners = {};
    return {
      id,
      value: extra.value || '',
      innerHTML: extra.innerHTML || '',
      textContent: extra.textContent || '',
      disabled: false,
      dataset: extra.dataset || {},
      style: {},
      scrollLeft: 0,
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        toggle(value, enabled) {
          const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
          if (shouldAdd) this.values.add(value);
          else this.values.delete(value);
        },
        contains(value) { return this.values.has(value); },
      },
      addEventListener(type, handler) { listeners[type] = handler; },
      dispatch(type, event = {}) { return listeners[type]?.({ target: this, currentTarget: this, ...event }); },
      querySelectorAll() { return []; },
      setPointerCapture() {},
      ...extra,
    };
  }

  const currentUrl = makeElement('currentUrl');
  const modeSelected = makeElement('modeSelected', { dataset: { mode: 'selected' } });
  const modeSmart = makeElement('modeSmart', { dataset: { mode: 'smart' } });
  const elements = new Map([
    ['updateSourceRail', makeElement('updateSourceRail')],
    ['updateSourceDots', makeElement('updateSourceDots')],
    ['updateSourcePrevBtn', makeElement('updateSourcePrevBtn')],
    ['updateSourceNextBtn', makeElement('updateSourceNextBtn')],
    ['updateSourceInput', makeElement('updateSourceInput', { value: 'https://git.koirin.com:39520/NF/Neko.git' })],
    ['saveUpdateSourceBtn', makeElement('saveUpdateSourceBtn', { innerHTML: 'Save' })],
  ]);
  const calls = [];
  const logs = [];
  const context = {
    window: { _nekoModules: {} },
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) {
        if (selector === '#updateSourceCurrent .update-source-current-url') return currentUrl;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '#updateSourceModeGroup .update-source-mode-btn') return [modeSelected, modeSmart];
        return [];
      },
    },
    setTimeout(fn) { fn(); return 1; },
    URL,
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/update.page.js');
  const page = context.window._nekoModules.pages.UpdatePage;
  const cfg = {
    githubOwner: 'Neko-NF',
    githubRepo: 'Neko-Status-Desktop',
    updateSourceMode: 'selected',
  };

  page.bindSourceControls({
    getAllConfig: async () => cfg,
    setConfig: async (key, value) => {
      calls.push(['setConfig', key, value]);
      cfg[key] = value;
      return true;
    },
    setManyConfig: async (payload) => {
      calls.push(['setManyConfig', payload]);
      Object.assign(cfg, payload);
      return true;
    },
    addLogLine: (level, message) => logs.push([level, message]),
  });

  page.renderSources(cfg);
  assert.match(elements.get('updateSourceRail').innerHTML, /github.com\/Neko-NF\/Neko-Status-Desktop/);
  assert.equal(currentUrl.textContent, 'github.com/Neko-NF/Neko-Status-Desktop');

  await elements.get('saveUpdateSourceBtn').dispatch('click');
  assert.equal(calls[0][0], 'setManyConfig');
  assert.equal(calls[0][1].activeUpdateSourceId, 'personal-nf-neko');
  assert.equal(calls[0][1].personalUpdateRepo, 'https://git.koirin.com:39520/NF/Neko');
  assert.equal(calls[0][1].updateSources[0].type, 'personal');
  assert.equal(logs.at(-1)[0], 'SUCCESS');

  await elements.get('updateSourceRail').dispatch('click', {
    target: {
      closest(selector) {
        if (selector === '[data-action]') return { dataset: { action: 'edit' } };
        if (selector === '.update-source-chip') return { dataset: { sourceId: 'personal-nf-neko' } };
        return null;
      },
    },
  });
  assert.equal(elements.get('updateSourceInput').value, 'https://git.koirin.com:39520/NF/Neko');
  assert.equal(elements.get('saveUpdateSourceBtn').dataset.editSourceId, 'personal-nf-neko');

  await elements.get('updateSourceRail').dispatch('click', {
    target: {
      closest(selector) {
        if (selector === '[data-action]') return { dataset: { action: 'delete' } };
        if (selector === '.update-source-chip') return { dataset: { sourceId: 'personal-nf-neko' } };
        return null;
      },
    },
  });
  assert.equal(calls.at(-1)[0], 'setManyConfig');
  assert.equal(logs.at(-1)[0], 'WARN');

  await elements.get('updateSourceRail').dispatch('click', {
    target: {
      closest(selector) {
        if (selector === '[data-action]') return { dataset: { action: 'confirm-delete' } };
        if (selector === '.update-source-chip') return { dataset: { sourceId: 'personal-nf-neko' } };
        return null;
      },
    },
  });
  assert.equal(calls.at(-1)[0], 'setManyConfig');
  assert.equal(calls.at(-1)[1].updateSources.some((source) => source.id === 'personal-nf-neko'), false);
  assert.equal(logs.at(-1)[0], 'SUCCESS');

  await modeSmart.dispatch('click');
  assert.deepEqual(calls.at(-1), ['setConfig', 'updateSourceMode', 'smart']);
});

test('update page renders animated and tiered update source diagnostics', () => {
  const panel = {
    className: '',
    innerHTML: '',
  };
  const context = {
    window: { _nekoModules: {} },
    document: {
      getElementById(id) {
        return id === 'updateSourceDiagnostics' ? panel : null;
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    URL,
    setInterval() { return 1; },
    clearInterval() {},
    Date,
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/update.page.js');
  const page = context.window._nekoModules.pages.UpdatePage;
  const cfg = {
    updateSourceType: 'personal',
    activeUpdateSourceId: 'personal-default',
    personalUpdateRepo: 'https://git.koirin.com:39520/NF/Neko',
  };

  page.renderSourceDiagnostics({}, { cfg, checking: true, elapsedMs: 1234 });
  assert.match(panel.className, /is-checking/);
  assert.match(panel.innerHTML, /检测中/);
  assert.match(panel.innerHTML, /1\.2 s/);
  assert.match(panel.innerHTML, /采样中/);

  page.renderSourceDiagnostics({
    sourceId: 'personal-default',
    sourceType: 'personal',
    sourceLabel: 'Personal',
    sourceLatencyMs: 640,
    downloadSpeedBytesPerSecond: 3 * 1024 * 1024,
    hasInstaller: true,
  }, { cfg });

  assert.match(panel.className, /success/);
  assert.match(panel.innerHTML, /已检测/);
  assert.match(panel.innerHTML, /640 ms/);
  assert.match(panel.innerHTML, /3\.0 MB\/s/);
  assert.match(panel.innerHTML, /is-good/);

  page.renderSourceDiagnostics({
    sourceId: 'personal-default',
    sourceType: 'personal',
    sourceLabel: 'Personal',
    sourceLatencyMs: 9504,
    downloadSpeedBytesPerSecond: 10.5 * 1024 * 1024,
    hasInstaller: true,
  }, { cfg });

  assert.match(panel.className, /error/);
  assert.match(panel.innerHTML, /连接过慢/);
  assert.match(panel.innerHTML, /9504 ms/);
});

test('update source diagnostics runs once on entry and reruns from explicit controls', async () => {
  function makeElement(id) {
    const listeners = {};
    return {
      id,
      innerHTML: '',
      disabled: false,
      dataset: {},
      className: '',
      setAttribute(name, value) { this[name] = value; },
      addEventListener(type, handler) { listeners[type] = handler; },
      dispatch(type, event = {}) { return listeners[type]?.({ target: this, currentTarget: this, ...event }); },
    };
  }

  const panel = makeElement('updateSourceDiagnostics');
  const probeBtn = makeElement('updateSourceProbeBtn');
  const nav = makeElement('navUpdate');
  const elements = new Map([
    ['updateSourceDiagnostics', panel],
    ['updateSourceProbeBtn', probeBtn],
  ]);
  let checks = 0;
  const context = {
    window: { _nekoModules: {} },
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) {
        return selector === '.nav-item[data-target="page-update"]' ? nav : null;
      },
      querySelectorAll() { return []; },
    },
    URL,
    setInterval() { return 1; },
    clearInterval() {},
    Date,
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/update.page.js');
  const page = context.window._nekoModules.pages.UpdatePage;
  page.bindSourceControls({
    checkUpdate: async () => {
      checks += 1;
      return {
        sourceId: 'github-default',
        sourceType: 'github',
        sourceLabel: 'GitHub',
        sourceLatencyMs: 120,
        hasInstaller: true,
      };
    },
  });

  page.init();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);
  assert.equal(probeBtn.disabled, false);

  assert.equal(page.requestSourceDiagnosticsCheck({ reason: 'enter-update-page' }), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);

  await probeBtn.dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 2);
});

test('update source diagnostics drains latest queued switch without leaking the timer', async () => {
  function makeElement(id) {
    return {
      id,
      innerHTML: '',
      disabled: false,
      dataset: {},
      className: '',
      title: '',
      setAttribute(name, value) { this[name] = value; },
      addEventListener() {},
    };
  }

  let nextTimerId = 0;
  const clearedTimers = [];
  let checks = 0;
  let resolveFirst;
  const panel = makeElement('updateSourceDiagnostics');
  const probeBtn = makeElement('updateSourceProbeBtn');
  const context = {
    window: { _nekoModules: {} },
    document: {
      getElementById(id) {
        if (id === 'updateSourceDiagnostics') return panel;
        if (id === 'updateSourceProbeBtn') return probeBtn;
        return null;
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    URL,
    Date,
    console,
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    setInterval() { nextTimerId += 1; return nextTimerId; },
    clearInterval(id) { clearedTimers.push(id); },
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/update.page.js');
  const page = context.window._nekoModules.pages.UpdatePage;
  page.bindSourceControls({
    checkUpdate: async () => {
      checks += 1;
      if (checks === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({
            sourceId: 'github-default',
            sourceType: 'github',
            sourceLabel: 'GitHub',
            sourceLatencyMs: 120,
            hasInstaller: true,
          });
        });
      }
      return {
        sourceId: 'personal-default',
        sourceType: 'personal',
        sourceLabel: 'Personal',
        sourceLatencyMs: 160,
        hasInstaller: true,
      };
    },
  });

  assert.equal(page.requestSourceDiagnosticsCheck({ force: true, latestWins: true }), true);
  page.scheduleSourceDiagnosticsCheck({ reason: 'manual-source-carousel' }, 0);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(checks, 1);
  assert.equal(page._sourceDiagnosticsRequestRunning, true);
  assert.equal(page._sourceDiagnosticTimerId, 1);

  resolveFirst();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(checks, 2);
  assert.deepEqual(clearedTimers, [1, 2]);
  assert.equal(page._sourceDiagnosticsRequestRunning, false);
  assert.equal(page._sourceDiagnosticTimerId, 0);
});

test('screenshot page exposes activity helpers after page initialization', () => {
  const storage = new Map([
    ['neko_privacy_rules', JSON.stringify(['Code.exe', 'chrome'])],
  ]);
  const context = {
    window: {
      _nekoModules: {},
      nekoIPC: {
        setConfig: async () => true,
      },
      addEventListener() {},
      requestAnimationFrame(fn) { fn(); },
    },
    document: {
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
    },
    requestAnimationFrame(fn) { fn(); },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;

  loadBrowserScript(context, 'src/renderer/js/pages/screenshot.page.js');

  const page = context.window._nekoModules.pages.ScreenshotPage;
  assert.equal(typeof page.init, 'function');
  page.init();
  page.init();

  assert.equal(typeof context.window._nekoActivityHelpers.hideEmpty, 'function');
  assert.equal(context.window._nekoActivityHelpers.normalizePrivacyRule('C:\\\\Apps\\\\Code'), 'Code.exe');
  assert.deepEqual(Array.from(context.window._nekoActivityHelpers.getPrivacyRules()), ['Code.exe', 'chrome.exe']);
});

test('screenshot page owns capture controls and persistence', async () => {
  const elements = new Map();

  function makeClassList(classes = []) {
    return {
      values: new Set(classes),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      toggle(value, enabled) {
        const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
        if (shouldAdd) this.values.add(value);
        else this.values.delete(value);
      },
      contains(value) { return this.values.has(value); },
    };
  }

  function makeElement(id, extra = {}) {
    const listeners = {};
    const el = {
      id,
      value: extra.value || '',
      dataset: extra.dataset || {},
      style: {},
      className: extra.className || '',
      innerHTML: '',
      textContent: '',
      src: '',
      classList: makeClassList(extra.classes),
      addEventListener(type, handler) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(handler);
      },
      dispatch(type, event = {}) {
        return Promise.all((listeners[type] || []).map((handler) => handler.call(this, {
          target: this,
          currentTarget: this,
          ...event,
        })));
      },
      closest() { return null; },
      querySelector(selector) {
        if (selector === '.screenshot-placeholder') return elements.get('screenshotPlaceholder');
        if (selector === '.screenshot-frame-overlay') return elements.get('screenshotOverlay');
        return null;
      },
      querySelectorAll() { return []; },
      ...extra,
    };
    elements.set(id, el);
    return el;
  }

  const toggleScreenshot = makeElement('toggleScreenshot');
  const uploadSwitch = makeElement('uploadSwitch', { classes: ['on'] });
  const captureNowBtn = makeElement('captureNowBtn');
  const dashCaptureNowBtn = makeElement('dashCaptureNowBtn');
  const screenshotModeGroup = makeElement('screenshotModeGroup');
  const intervalSelector = makeElement('intervalSelector');
  const customIntervalValue = makeElement('customIntervalValue', { value: '2' });
  makeElement('customIntervalUnit', { value: 'm' });
  makeElement('intervalCustomGroup');
  makeElement('intervalAutoHint');
  makeElement('screenshotPreviewTime');
  makeElement('screenshotFrame');
  makeElement('screenshotPlaceholder');
  makeElement('screenshotOverlay');
  makeElement('dashScreenshotImg');
  makeElement('dashScreenshotEmpty');
  makeElement('dashScreenshotName');
  makeElement('dashScreenshotSize');

  const calls = [];
  const activities = [];
  const logs = [];
  const context = {
    window: {
      _nekoModules: { pages: {} },
      addEventListener() {},
      requestAnimationFrame(fn) { fn(); },
    },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector(selector) {
        if (selector === '.screenshot-preview-time') return elements.get('screenshotPreviewTime');
        if (selector === '.screenshot-frame') return elements.get('screenshotFrame');
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    requestAnimationFrame(fn) { fn(); },
    Blob,
    URL: {
      createObjectURL() { return 'blob:screenshot'; },
    },
    Date,
    Uint8Array,
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;

  loadBrowserScript(context, 'src/renderer/js/pages/screenshot.page.js');

  const page = context.window._nekoModules.pages.ScreenshotPage;
  page.init({
    addLogLine: (level, message) => logs.push([level, message]),
    showNotice: (message, type) => calls.push(['notice', message, type]),
    appendActivityItem: (...args) => activities.push(args),
    formatDateTime: () => '2026-06-05 12:00:00',
    formatTimeOnly: () => '12:00',
    config: {
      set: async (key, value) => {
        calls.push(['set', key, value]);
        return true;
      },
    },
    service: {
      syncMeta: async () => {
        calls.push(['syncMeta']);
        return true;
      },
    },
    system: {
      captureScreen: async () => ({
        data: [1, 2, 3, 4],
        type: 'image/png',
        extension: 'png',
      }),
    },
  });

  toggleScreenshot.classList.add('on');
  await toggleScreenshot.dispatch('click');
  assert.deepEqual(calls.slice(0, 2), [
    ['set', 'enableScreenshot', true],
    ['syncMeta'],
  ]);
  assert.equal(uploadSwitch.classList.contains('on'), true);

  await uploadSwitch.dispatch('click');
  assert.deepEqual(calls.slice(2, 4), [
    ['set', 'enableScreenshot', false],
    ['syncMeta'],
  ]);
  assert.equal(toggleScreenshot.classList.contains('on'), false);

  const intervalMode = makeElement('intervalMode', { dataset: { mode: 'interval' } });
  await screenshotModeGroup.dispatch('click', {
    target: {
      closest(selector) {
        return selector === '.toggle-btn' ? intervalMode : null;
      },
    },
  });
  assert.deepEqual(calls.slice(4, 6), [
    ['set', 'screenshotMode', 'interval'],
    ['set', 'syncScreenshotInterval', false],
  ]);

  const intervalBtn = makeElement('interval30', { dataset: { value: '30' } });
  await intervalSelector.dispatch('click', {
    target: {
      closest(selector) {
        return selector === '.interval-btn' ? intervalBtn : null;
      },
    },
  });
  assert.deepEqual(calls.at(-1), ['set', 'screenshotInterval', 30]);

  await customIntervalValue.dispatch('change');
  assert.deepEqual(calls.at(-1), ['set', 'screenshotInterval', 120]);

  await captureNowBtn.dispatch('click');
  assert.deepEqual(activities[0], ['capture', '截图完成', '0 KB · PNG', '12:00']);
  assert.equal(elements.get('screenshotPreviewTime').textContent, '2026-06-05 12:00:00');
  assert.equal(elements.get('screenshotFrame').style.backgroundImage, 'url(blob:screenshot)');
  assert.equal(elements.get('dashScreenshotImg').src, 'blob:screenshot');
  assert.match(elements.get('dashScreenshotName').innerHTML, /screenshot_/);
  assert.equal(logs.some(([level]) => level === 'SUCCESS'), true);
});

test('dashboard page owns trend chart metrics runtime', () => {
  function makeClassList() {
    return {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      toggle(value, enabled) {
        const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
        if (shouldAdd) this.values.add(value);
        else this.values.delete(value);
      },
      contains(value) { return this.values.has(value); },
    };
  }

  function makeElement(id, extra = {}) {
    const listeners = {};
    return {
      id,
      dataset: extra.dataset || {},
      style: extra.style || {},
      classList: makeClassList(),
      addEventListener(type, handler) { listeners[type] = handler; },
      dispatch(type, event = {}) { listeners[type]?.({ target: this, currentTarget: this, ...event }); },
      closest() { return this; },
      getContext() {
        return {
          createLinearGradient() {
            return { addColorStop() {} };
          },
        };
      },
      ...extra,
    };
  }

  const updates = [];
  class ChartStub {
    static defaults = {};
    static instances = [];
    constructor(ctx, config) {
      this.ctx = ctx;
      this.data = config.data;
      this.options = config.options;
      this.chartArea = { top: 0, bottom: 120 };
      this.destroyed = false;
      ChartStub.instances.push(this);
    }
    update(mode) {
      updates.push(mode);
    }
    destroy() {
      this.destroyed = true;
    }
  }

  const oneMinuteBtn = makeElement('trend1m', { dataset: { range: '1m' } });
  const oneHourBtn = makeElement('trend1h', { dataset: { range: '1h' } });
  const elements = new Map([
    ['trendChart', makeElement('trendChart')],
    ['trendRangeGroup', makeElement('trendRangeGroup')],
    ['mainDashboardArea', makeElement('mainDashboardArea', { style: { display: '' } })],
  ]);

  const context = {
    window: {
      _nekoModules: {
        services: {
          ConfigClient: {
            setDashboardLayout: async () => true,
          },
        },
      },
    },
    document: {
      documentElement: {
        hasAttribute() { return false; },
      },
      body: {},
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelectorAll(selector) {
        if (selector === '#trendRangeGroup .toggle-btn') return [oneMinuteBtn, oneHourBtn];
        return [];
      },
      querySelector() {
        return null;
      },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    getComputedStyle() {
      return {
        getPropertyValue(name) {
          return name === '--theme-color'
            ? 'color-mix(in srgb, #8ac2ff 58%, #0f172a 42%)'
            : '';
        },
      };
    },
    setTimeout(fn) { fn(); return 1; },
    Chart: ChartStub,
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.Chart = ChartStub;

  loadBrowserScript(context, 'src/renderer/js/pages/dashboard.page.js');

  const page = context.window._nekoModules.pages.DashboardPage;
  page.initRuntime();
  page.setMetricsHistory([{ timestamp: Date.now() - 1000, cpuPct: 12, memPct: 34 }]);
  page.recordMetrics({ timestamp: Date.now(), cpuPct: 20, memPct: 40 });

  assert.equal(ChartStub.instances.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(page._themeColorRgb)), { r: 86, g: 122, b: 166 });
  assert.equal(page._metricsBuffer.length, 2);
  assert.equal(ChartStub.instances[0].data.datasets[0].data.some((value) => value != null), true);
  assert.equal(ChartStub.instances[0].data.datasets[1].data.some((value) => value != null), true);

  elements.get('trendRangeGroup').dispatch('click', { target: oneHourBtn });
  assert.equal(page._trendRange, '1h');
  assert.equal(oneHourBtn.classList.contains('active'), true);
  assert.equal(updates.length > 0, true);
});

test('dashboard page renders last reported app from normalized service fields', () => {
  function makeElement(id, extra = {}) {
    return {
      id,
      textContent: '',
      innerHTML: '',
      title: '',
      dataset: {},
      style: {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      ...extra,
    };
  }

  const appValue = makeElement('appValue');
  const appTrend = makeElement('appTrend');
  const elements = new Map([
    ['mainDashboardArea', makeElement('mainDashboardArea')],
  ]);
  const context = {
    window: { _nekoModules: {} },
    document: {
      documentElement: { hasAttribute() { return false; } },
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) {
        if (selector === '#card-app .metric-value') return appValue;
        if (selector === '#card-app .metric-trend') return appTrend;
        return null;
      },
      querySelectorAll() { return []; },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    setTimeout(fn) { fn(); return 1; },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;

  loadBrowserScript(context, 'src/renderer/js/pages/dashboard.page.js');

  const page = context.window._nekoModules.pages.DashboardPage;
  page.initRuntime({ escapeHtml: (value) => String(value).replace(/</g, '&lt;') });
  page.updateCards({
    foregroundWindowTitle: 'Design Tool',
    foregroundProcessName: 'design.exe',
  });

  assert.equal(appValue.textContent, 'Design Tool');
  assert.equal(appValue.title, 'Design Tool');
  assert.match(appTrend.innerHTML, /design\.exe/);
});

test('device status page owns metrics rendering and diagnostics', () => {
  function makeClassList() {
    return {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
    };
  }

  function makeElement(id, extra = {}) {
    const children = [];
    const el = {
      id,
      children,
      textContent: '',
      innerHTML: '',
      dataset: {},
      style: {},
      className: '',
      classList: makeClassList(),
      appendChild(child) { children.push(child); child.parentNode = this; },
      removeChild(child) {
        const index = children.indexOf(child);
        if (index >= 0) children.splice(index, 1);
      },
      insertBefore(child, before) {
        const index = children.indexOf(before);
        if (index >= 0) children.splice(index, 0, child);
        else children.unshift(child);
        child.parentNode = this;
      },
      querySelector(selector) {
        if (selector === '.kpi-value') return extra.valueEl || null;
        if (selector === '.kpi-value-sm') return extra.valueSmEl || null;
        if (selector === '.kpi-badge') return extra.badgeEl || null;
        if (selector === '.kpi-footer') return extra.footerEl || null;
        if (selector === '.event-empty-hint') return children.find((child) => child.className === 'event-empty-hint') || null;
        return null;
      },
      querySelectorAll() { return []; },
      remove() {
        if (!this.parentNode) return;
        this.parentNode.removeChild(this);
      },
      addEventListener() {},
      getBoundingClientRect() { return { width: 100, left: 0 }; },
      closest() { return null; },
      ...extra,
    };
    return el;
  }

  function makeCard(id) {
    return makeElement(id, {
      valueEl: makeElement(`${id}Value`),
      badgeEl: makeElement(`${id}Badge`),
      footerEl: makeElement(`${id}Footer`),
    });
  }

  const kpiCards = [makeCard('cpu'), makeCard('mem'), makeCard('net'), makeCard('battery')];
  const dashEventList = makeElement('dashEventList');
  dashEventList.appendChild(makeElement('empty', { className: 'event-empty-hint' }));
  const historyTableBody = makeElement('historyTableBody');
  const elements = new Map([
    ['dashEventList', dashEventList],
    ['historyTableBody', historyTableBody],
    ['netSpeedFooter', makeElement('netSpeedFooter')],
    ['metaOS', makeElement('metaOS')],
  ]);
  const notifications = [];
  const context = {
    window: { _nekoModules: {}, requestAnimationFrame(fn) { fn(); } },
    document: {
      documentElement: makeElement('html', {
        style: {
          getPropertyValue() { return '#0ea5e9'; },
        },
      }),
      body: makeElement('body'),
      createElement(tag) { return makeElement(tag); },
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) {
        if (selector === '.nav-item[data-target=\"page-device-status\"]') return null;
        if (selector === '#historyFilterGroup .filter-segmented-btn.active') return null;
        if (selector === '#sparkBattery') return null;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '#page-device-status .kpi-card') return kpiCards;
        if (selector === '#historyTableBody tr') return [];
        return [];
      },
    },
    getComputedStyle() {
      return {
        getPropertyValue() { return '#0ea5e9'; },
        color: 'rgb(6, 182, 212)',
      };
    },
    requestAnimationFrame(fn) { fn(); },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/device-status.page.js');

  const page = context.window._nekoModules.pages.DeviceStatusPage;
  page.init({ notify: (title, body) => notifications.push([title, body]) });
  page.updateMetrics({
    cpuPct: 91,
    memPct: 86,
    networkLatency: 42,
    netDownBps: 2048,
    netUpBps: 1024,
    uptime: 3661,
    osFriendlyName: 'Windows 11',
    arch: 'x64',
  });

  assert.equal(kpiCards[0].querySelector('.kpi-value').textContent, '91.0%');
  assert.equal(kpiCards[1].querySelector('.kpi-value').textContent, '86.0%');
  assert.equal(kpiCards[2].querySelector('.kpi-value').textContent, '42 ms');
  assert.equal(elements.get('metaOS').textContent, 'Windows 11 (x64)');
  assert.match(elements.get('netSpeedFooter').innerHTML, /2\.0 KB\/s/);
  assert.match(elements.get('historyTableBody').innerHTML, /CPU/);
  assert.equal(notifications.length, 2);
  assert.equal(dashEventList.children.length > 0, true);

  page.updatePowerKpi(64, false, true, 'battery sampled');
  assert.equal(kpiCards[3].querySelector('.kpi-value').textContent, '64%');
  assert.equal(kpiCards[3].querySelector('.kpi-footer').textContent, 'battery sampled');
});

test('auth page owns modal state and profile summary rendering', async () => {
  function makeElement(id, extra = {}) {
    const listeners = {};
    return {
      id,
      value: extra.value || '',
      textContent: extra.textContent || '',
      innerHTML: extra.innerHTML || '',
      src: '',
      hidden: false,
      disabled: false,
      dataset: {},
      style: { display: extra.display || '' },
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        contains(value) { return this.values.has(value); },
        toggle(value, enabled) {
          const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
          if (shouldAdd) this.values.add(value);
          else this.values.delete(value);
        },
      },
      addEventListener(type, handler) { listeners[type] = handler; },
      removeEventListener(type) { delete listeners[type]; },
      dispatch(type, event = {}) { return listeners[type]?.({ target: this, currentTarget: this, preventDefault() {}, ...event }); },
      setAttribute(name, value) { this[name] = value; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      cloneNode() { return makeElement(id, extra); },
      parentNode: { replaceChild(next) { elements.set(id, next); } },
      insertAdjacentHTML() {},
      ...extra,
    };
  }

  const elements = new Map();
  [
    'authModal',
    'authLoginView',
    'authRegisterView',
    'authServerWarning',
    'authLocalBadge',
    'authLoginBtn',
    'authRegBtn',
    'closeAuthModal',
    'switchToRegister',
    'switchToLogin',
    'authOpenConfigBtn',
    'btnOpenLogin',
    'btnLogout',
    'userAvatar',
    'dropdownUsername',
    'dropdownRole',
    'btnProfileSettings',
    'logoutDivider',
    'settingsAvatar',
    'profileModalAvatar',
    'firstTimeAuthPrompt',
    'firstTimeSkipBtn',
    'firstTimeTestBtn',
    'firstTimeServerUrl',
    'firstTimeServerStatus',
    'firstTimeStep1',
    'firstTimeStep2',
    'firstTimeSkipStep2Btn',
    'firstTimeLoginBtn',
    'profileModal',
    'saveProfileBtn',
  ].forEach((id) => elements.set(id, makeElement(id)));

  const settingsName = makeElement('settingsName');
  const settingsSub = makeElement('settingsSub');
  const authCalls = [];
  const context = {
    window: {
      _nekoModules: {},
      addEventListener() {},
      setTimeout(fn) { fn(); return 1; },
    },
    document: {
      body: makeElement('body', {
        insertAdjacentHTML() {},
      }),
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) {
        if (selector === '.settings-profile-name') return settingsName;
        if (selector === '.settings-profile-sub') return settingsSub;
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener() {},
      dispatchEvent(event) { this.lastEvent = event; return true; },
    },
    setTimeout(fn) { fn(); return 1; },
    CustomEvent: function CustomEvent(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    },
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    Image: function Image() {},
    FileReader: function FileReader() {},
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/pages/auth.page.js');

  const page = context.window._nekoModules.pages.AuthPage;
  page.init({
    callAuth: async (method) => {
      authCalls.push(method);
      if (method === 'getState') return { isLoggedIn: false, showPrompt: false, serverConfigured: true };
      if (method === 'getMe') return { success: true, user: { username: 'neko', role: 'admin', avatar: 'avatar.png' } };
      return { success: true };
    },
  });

  page.openAuthModal('register');
  assert.equal(elements.get('authModal').style.display, 'flex');
  assert.equal(elements.get('authLoginView').style.display, 'none');
  assert.equal(elements.get('authRegisterView').style.display, '');

  page.updateAuthUI(true, { username: 'neko', role: 'admin', avatar: 'avatar.png' });
  assert.equal(elements.get('dropdownUsername').textContent, 'neko');
  assert.equal(elements.get('btnOpenLogin').style.display, 'none');
  assert.equal(elements.get('btnProfileSettings').style.display, '');
  assert.equal(elements.get('settingsAvatar').src, 'avatar.png');
  assert.equal(settingsName.textContent, 'neko');

  await page.checkFirstTimeAuthPrompt();
  assert.equal(authCalls.includes('getState'), true);
});

test('settings page owns core persistence controls', async () => {
  const elements = new Map();

  function makeClassList(classes = []) {
    return {
      values: new Set(classes),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      toggle(value, enabled) {
        const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
        if (shouldAdd) this.values.add(value);
        else this.values.delete(value);
      },
      contains(value) { return this.values.has(value); },
    };
  }

  function makeElement(id, extra = {}) {
    const listeners = {};
    const el = {
      id,
      value: extra.value || '',
      textContent: extra.textContent || '',
      innerHTML: '',
      dataset: extra.dataset || {},
      style: {},
      disabled: false,
      childNodes: extra.childNodes || [],
      classList: makeClassList(extra.classes),
      addEventListener(type, handler) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(handler);
      },
      dispatch(type, event = {}) {
        return Promise.all((listeners[type] || []).map((handler) => handler.call(this, {
          target: this,
          currentTarget: this,
          ...event,
        })));
      },
      appendChild(child) { this.lastChild = child; },
      querySelectorAll(selector) {
        if (selector === '.toggle-btn') return extra.toggleButtons || [];
        return [];
      },
      querySelector() { return null; },
      closest() { return extra.closestEl || null; },
      scrollIntoView() { this.scrolled = true; },
      ...extra,
    };
    elements.set(id, el);
    return el;
  }

  const reportAuto = makeElement('reportAuto', { dataset: { mode: 'auto' } });
  const reportCustom = makeElement('reportCustom', { dataset: { mode: 'custom' } });
  const screenshotAuto = makeElement('screenshotAuto', { dataset: { mode: 'auto' } });
  const screenshotInterval = makeElement('screenshotInterval', { dataset: { mode: 'interval' } });
  const scopeBoth = makeElement('scopeBoth', { dataset: { scope: 'both' } });
  const row = makeElement('reportRow');

  makeElement('stgFontSelect');
  makeElement('stgTraySwitch', { classes: ['on'] });
  makeElement('stgRestoreSwitch');
  makeElement('stgAutoDownloadSwitch', { classes: ['on'] });
  makeElement('stgExperimentalSwitch');
  makeElement('stgExperimentalActivitySwitch');
  makeElement('stgExperimentalStreamSwitch');
  makeElement('stgExperimentalUiLabSwitch');
  makeElement('openExperimentalSettingsBtn');
  makeElement('settings-experimental');
  makeElement('stgReportModeGroup', { toggleButtons: [reportAuto, reportCustom], closestEl: row });
  makeElement('stgCustomIntervalRow');
  makeElement('stgReportIntervalInput', { value: '20' });
  makeElement('stgReportIntervalDesc');
  makeElement('stgSaveIntervalBtn');
  makeElement('quickIntervalInput', { value: '15' });
  makeElement('quickIntervalLabel');
  makeElement('quickIntervalStepper');
  makeElement('quickIntervalHint');
  makeElement('intervalAutoHintValue');
  makeElement('stgSyncScreenshotSwitch');
  makeElement('screenshotModeGroup', { toggleButtons: [screenshotAuto, screenshotInterval] });
  makeElement('quickIntervalCard');
  makeElement('quickIntervalDown');
  makeElement('quickIntervalUp');
  makeElement('stgNotifySwitch', { classes: ['on'] });
  makeElement('stgDndSwitch', { classes: ['on'] });
  makeElement('stgIncognitoSwitch', { classes: ['on'] });
  makeElement('privacyBarTitle');
  makeElement('privacyBarDesc');
  makeElement('privacyBarIcon');
  makeElement('openPrivacyRulesBtn');
  makeElement('incognitoScopeGroup');
  makeElement('blurAllSwitch', { classes: ['on'] });
  makeElement('stg2FASwitch', { classes: ['on'] });
  makeElement('stgGlassSwitch');
  makeElement('stgDarkSwitch', { classes: ['on'] });
  makeElement('stgDarkScheduleSwitch', { classes: ['on'] });
  makeElement('stgDarkTimeRow');
  makeElement('stgDarkStartTime', { value: '19:00' });
  makeElement('stgDarkEndTime', { value: '06:00' });
  makeElement('stgScaleLabel', { textContent: '100%' });
  makeElement('stgScaleDown');
  makeElement('stgScaleUp');
  makeElement('clearCacheBtn', { childNodes: [{ textContent: ' 清理缓存' }] });
  makeElement('clearCacheIcon');
  makeElement('cacheSizeDesc');

  const calls = [];
  const logs = [];
  const themes = [];
  const expanded = [];
  const dispatched = [];
  const storage = new Map();
  const context = {
    window: {
      _nekoModules: { pages: {}, services: {} },
      _nekoUIHelpers: {
        applyUIFontProfile: (font) => calls.push(['fontProfile', font]),
      },
      _nekoActivityHelpers: {
        syncPrivacyBar: () => calls.push(['syncPrivacyBar']),
      },
    },
    document: {
      documentElement: {
        style: {
          setProperty: (key, value) => calls.push(['styleSet', key, value]),
          removeProperty: (key) => calls.push(['styleRemove', key]),
        },
        classList: makeClassList(),
      },
      getElementById(id) { return elements.get(id) || null; },
      createElement(tag) { return makeElement(tag); },
      querySelector(selector) {
        if (selector === '.nav-item[data-target="page-settings"]') return makeElement('settingsNav');
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '#stgReportModeGroup .toggle-btn') return [reportAuto, reportCustom];
        return [];
      },
      dispatchEvent(event) {
        dispatched.push(event);
        return true;
      },
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
    },
    setTimeout(fn) { fn(); return 1; },
    setInterval() { return 1; },
    CustomEvent: function CustomEvent(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;

  loadBrowserScript(context, 'src/renderer/js/pages/settings.page.js');

  const page = context.window._nekoModules.pages.SettingsPage;
  page.init({
    addLogLine: (level, message) => logs.push([level, message]),
    showNotice: (message, type) => calls.push(['notice', message, type]),
    applyThemeMode: (...args) => themes.push(args),
    applyExperimentalFeatureState: (cfg) => calls.push(['experimental', cfg]),
    setExpandableSectionState: (el, expandedState) => {
      expanded.push([el?.id, expandedState]);
      if (el) el.dataset.expanded = String(expandedState);
    },
    setIncognitoScopeUI: (scope) => calls.push(['scopeUi', scope]),
    setConsoleStatus: (...args) => calls.push(['consoleStatus', ...args]),
    formatBytes: (bytes) => `${bytes} B`,
    config: {
      getAll: async () => ({ reportIntervalMode: 'auto' }),
      set: async (key, value) => {
        calls.push(['set', key, value]);
        return true;
      },
      setMany: async (values) => {
        calls.push(['setMany', values]);
        return true;
      },
    },
    system: {
      notify: async () => ({ shown: true }),
      setFocusAssist: async (enabled) => {
        calls.push(['focus', enabled]);
        return { ok: true };
      },
      getFocusAssist: async () => ({ ok: true, enabled: false }),
      setZoom: async (zoom) => {
        calls.push(['zoom', zoom]);
        return true;
      },
      clearCache: async () => ({
        success: true,
        clearedBytes: 2048,
        afterBytes: 1024,
        removedCount: 3,
      }),
    },
  });

  await elements.get('stgTraySwitch').dispatch('click');
  await elements.get('stgAutoDownloadSwitch').dispatch('click');
  await elements.get('stgExperimentalSwitch').dispatch('click');
  assert.deepEqual(calls.filter((call) => call[0] === 'set').slice(0, 3), [
    ['set', 'closeAction', 'minimize'],
    ['set', 'autoDownload', true],
    ['set', 'enableExperimentalFeatures', true],
  ]);

  elements.get('stgExperimentalActivitySwitch').classList.add('on');
  await page.handleExperimentalSwitchClick(
    elements.get('stgExperimentalActivitySwitch'),
    'enableExperimentalActivityEntry',
    '关注动态入口',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter((call) => call[0] === 'setMany').at(-1))), [
    'setMany',
    {
      enableExperimentalActivityEntry: false,
      enableActivityFeature: false,
      enableActivityPublishing: false,
      enableActivityBackground: false,
    },
  ]);

  await elements.get('stgReportModeGroup').dispatch('click', {
    target: { closest: () => reportCustom },
  });
  assert.deepEqual(calls.filter((call) => call[0] === 'set').slice(3, 4), [
    ['set', 'reportIntervalMode', 'custom'],
  ]);
  assert.equal(elements.get('stgReportIntervalDesc').textContent, '自定义模式: 每 20s 上报');
  assert.equal(expanded.some(([id, state]) => id === 'stgCustomIntervalRow' && state === true), true);

  await elements.get('stgSaveIntervalBtn').dispatch('click');
  assert.deepEqual(calls.filter((call) => call[0] === 'set').at(-1), ['set', 'reportInterval', 20]);
  assert.equal(elements.get('quickIntervalLabel').textContent, '20s · 自定义');

  await elements.get('stgDndSwitch').dispatch('click');
  assert.equal(elements.get('stgNotifySwitch').classList.contains('on'), false);
  assert.deepEqual(calls.filter((call) => call[0] === 'set').slice(-2), [
    ['set', 'doNotDisturb', true],
    ['set', 'enableNotification', false],
  ]);

  await elements.get('incognitoScopeGroup').dispatch('click', {
    target: { closest: () => scopeBoth },
  });
  assert.deepEqual(calls.filter((call) => call[0] === 'scopeUi').at(-1), ['scopeUi', 'both']);
  assert.deepEqual(calls.filter((call) => call[0] === 'set').at(-1), ['set', 'incognitoScope', 'both']);
  assert.equal(dispatched.at(-1).type, 'neko:privacy-scope-changed');

  await elements.get('stgDarkScheduleSwitch').dispatch('click');
  assert.deepEqual(themes.at(-1), ['auto', '19:00', '06:00']);

  await elements.get('stgScaleUp').dispatch('click');
  assert.equal(elements.get('stgScaleLabel').textContent, '110%');
  assert.deepEqual(calls.filter((call) => call[0] === 'set').at(-1), ['set', 'uiScale', 110]);
  assert.deepEqual(calls.filter((call) => call[0] === 'zoom').at(-1), ['zoom', 1.1]);

  await elements.get('clearCacheBtn').dispatch('click');
  assert.equal(elements.get('clearCacheBtn').classList.contains('loading'), false);
  assert.equal(elements.get('clearCacheIcon').className, 'ph ph-broom');
  assert.equal(elements.get('cacheSizeDesc').textContent, '会话缓存（图片、脚本等）· 当前 1024 B');
  assert.deepEqual(calls.filter((call) => call[0] === 'consoleStatus').at(-1), [
    'consoleStatus',
    'Cache',
    '1024 B',
    'Local cache',
    'ok',
  ]);
  assert.equal(logs.some(([level]) => level === 'INFO'), true);
});

test('theme module owns color normalization, persistence, and swatch binding', () => {
  function makeElement(id, extra = {}) {
    const listeners = {};
    return {
      id,
      dataset: extra.dataset || {},
      value: extra.value || '',
      src: '',
      style: {
        values: {},
        setProperty(name, value) { this.values[name] = value; },
        getPropertyValue(name) { return this.values[name] || ''; },
        removeProperty(name) { delete this.values[name]; },
      },
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        toggle(value, enabled) {
          const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
          if (shouldAdd) this.values.add(value);
          else this.values.delete(value);
        },
        contains(value) { return this.values.has(value); },
      },
      addEventListener(type, handler) { listeners[type] = handler; },
      dispatch(type, event = {}) { listeners[type]?.({ stopPropagation() {}, target: this, ...event }); },
      focus() {},
      select() {},
      click() { listeners.click?.({ stopPropagation() {}, target: this }); },
      ...extra,
    };
  }

  const storage = new Map([
    ['neko-theme-color', '#0ea5e9'],
    ['neko-custom-theme-color', '#123abc'],
  ]);
  const setConfigCalls = [];
  const topSwatch = makeElement('topSwatch', { dataset: { color: '#ff0000' } });
  topSwatch.classList.add('color-swatch');
  const settingsSwatch = makeElement('settingsSwatch', { dataset: { color: '#00ff00' } });
  settingsSwatch.classList.add('settings-swatch');

  const elements = new Map([
    ['themeColorBtn', makeElement('themeColorBtn')],
    ['colorPalette', makeElement('colorPalette')],
    ['stgCustomColorBtn', makeElement('stgCustomColorBtn')],
    ['topCustomColorBtn', makeElement('topCustomColorBtn')],
    ['stgCustomColorInput', makeElement('stgCustomColorInput')],
    ['stgCustomColorHex', makeElement('stgCustomColorHex')],
    ['stgCustomColorPreview', makeElement('stgCustomColorPreview')],
    ['stgCustomColorApply', makeElement('stgCustomColorApply')],
    ['stgCustomColorRow', makeElement('stgCustomColorRow')],
    ['stgColorPickerPlane', makeElement('stgColorPickerPlane', {
      getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 100 }; },
      setPointerCapture() {},
    })],
    ['stgColorPickerHandle', makeElement('stgColorPickerHandle')],
    ['stgColorHue', makeElement('stgColorHue', { value: '199' })],
    ['topCustomColorHex', makeElement('topCustomColorHex')],
    ['topCustomColorPreview', makeElement('topCustomColorPreview')],
    ['topCustomColorEditor', makeElement('topCustomColorEditor', { hidden: true })],
    ['topCustomColorApply', makeElement('topCustomColorApply')],
    ['topColorPickerPlane', makeElement('topColorPickerPlane', {
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
      setPointerCapture() {},
    })],
    ['topColorPickerHandle', makeElement('topColorPickerHandle')],
    ['topColorHue', makeElement('topColorHue', { value: '199' })],
    ['profileModalAvatar', makeElement('profileModalAvatar')],
  ]);

  const context = {
    window: {
      _nekoModules: {
        services: {
          ConfigClient: {
            set: async (key, value) => {
              setConfigCalls.push([key, value]);
              return true;
            },
          },
        },
      },
    },
    document: {
      documentElement: makeElement('html'),
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelectorAll(selector) {
        if (selector === '.settings-swatch, .color-swatch[data-color]') return [settingsSwatch, topSwatch];
        if (selector === '.color-swatch[data-color]') return [topSwatch];
        if (selector === '#stgColorSwatches .settings-swatch') return [settingsSwatch];
        return [];
      },
      dispatchEvent(event) {
        this.lastEvent = event;
      },
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
    },
    CustomEvent: function CustomEvent(name) {
      this.type = name;
    },
    getComputedStyle(el) {
      return el.style;
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;

  loadBrowserScript(context, 'src/renderer/js/core/theme.js');

  const theme = context.window._nekoModules.theme;
  assert.equal(theme.normalizeThemeColorInput('abc'), '#aabbcc');
  assert.equal(theme.normalizeThemeColorInput('0x123456'), '#123456');
  assert.equal(theme.normalizeThemeColorInput('nope'), '');

  theme.initThemeColorControls();
  assert.equal(storage.get('neko-theme-color'), '#0ea5e9');
  assert.equal(elements.get('stgCustomColorHex').value, '#123ABC');
  assert.equal(elements.get('topCustomColorHex').value, '#123ABC');

  topSwatch.dispatch('click');
  assert.equal(storage.get('neko-theme-color'), '#ff0000');
  assert.equal(context.document.documentElement.style.values['--theme-color-seed'], '#ff0000');
  assert.equal(context.document.documentElement.style.values['--theme-color'], undefined);
  assert.equal(elements.get('profileModalAvatar').src.includes('background=ff0000'), true);
  assert.equal(context.document.lastEvent.type, 'neko:themeChange');

  elements.get('stgCustomColorHex').value = '#abcdef';
  elements.get('stgColorHue').value = '180';
  elements.get('stgColorHue').dispatch('input');
  assert.match(elements.get('stgCustomColorHex').value, /^#[0-9A-F]{6}$/);
  elements.get('stgCustomColorHex').value = '#abcdef';
  elements.get('stgCustomColorApply').dispatch('click');
  assert.equal(storage.get('neko-theme-color'), '#abcdef');
  assert.equal(storage.get('neko-custom-theme-color'), '#abcdef');
  assert.deepEqual(setConfigCalls.at(-2), ['seedColor', '#abcdef']);
  assert.deepEqual(setConfigCalls.at(-1), ['customSeedColor', '#abcdef']);

  elements.get('topCustomColorBtn').dispatch('click', { stopPropagation() {} });
  assert.equal(elements.get('topCustomColorEditor').hidden, false);
  elements.get('topColorHue').value = '0';
  elements.get('topColorHue').dispatch('input');
  assert.match(elements.get('topCustomColorHex').value, /^#[0-9A-F]{6}$/);
  elements.get('topCustomColorHex').value = '#123456';
  elements.get('topCustomColorApply').dispatch('click', { stopPropagation() {} });
  assert.equal(storage.get('neko-theme-color'), '#123456');
  assert.equal(storage.get('neko-custom-theme-color'), '#123456');
});

test('developer console registry parses aliases and delegates commands', async () => {
  const logs = [];
  const calls = [];
  const context = {
    window: {},
    console,
  };
  context.window.window = context.window;

  loadBrowserScript(context, 'src/renderer/js/components/developer-console.js');

  const registry = context.window._nekoModules.components.DeveloperConsole.createCommandRegistry({
    addLogLine: (level, msg) => logs.push([level, msg]),
    clearOutput: () => calls.push('clearOutput'),
    ipc: {
      getVersion: async () => '1.2.7',
      isRunning: async () => true,
      getConfig: async (key) => ({ key, value: 10 }),
      getAllConfig: async () => ({
        updateSourceMode: 'smart',
        activeUpdateSourceId: 'personal-default',
        githubOwner: 'Neko-NF',
        githubRepo: 'Neko-Status-Desktop',
        personalUpdateRepo: 'https://git.koirin.com:39520/NF/Neko',
        updateSources: [{
          id: 'personal-default',
          type: 'personal',
          repoUrl: 'https://git.koirin.com:39520/NF/Neko',
        }],
      }),
      setConfig: async (key, value) => {
        calls.push(['setConfig', key, value]);
        return true;
      },
      testConnection: async (serverUrl) => {
        calls.push(['testConnection', serverUrl]);
        return { ok: true, serverUrl };
      },
      checkUpdate: async () => ({ hasUpdate: false, currentVersion: '1.2.7' }),
      installUpdate: async (filePath, expectedSha256, options) => {
        calls.push(['installUpdate', filePath, expectedSha256, options]);
        return { success: true, filePath };
      },
    },
    helpers: {
      applyServiceState: (running) => calls.push(['serviceState', running]),
      refreshConsoleStatus: async () => calls.push('refreshStatus'),
      getStatusSummary: () => 'runtime=PID 1 service=Running cache=0 B',
    },
  });

  assert.deepEqual(Array.from(context.window._nekoModules.components.DeveloperConsole.tokenize('config get "report interval"')), [
    'config',
    'get',
    'report interval',
  ]);

  await registry.execute('ver');
  await registry.execute('service status');
  await registry.execute('config get reportInterval');
  await registry.execute('config set updateSourceMode "smart"');
  await registry.execute('api test http://127.0.0.1:3000');
  await registry.execute('update source');
  await registry.execute('update check');
  await registry.execute('update install "C:\\tmp\\NekoStatus-Setup-1.2.7.exe"');
  await registry.execute('status');
  await registry.execute('clear');

  assert.deepEqual(logs.slice(0, 11), [
    ['INFO', 'Neko Status v1.2.7'],
    ['INFO', 'service=running'],
    ['INFO', 'reportInterval={\n  "key": "reportInterval",\n  "value": 10\n}'],
    ['SUCCESS', 'updateSourceMode=smart'],
    ['SUCCESS', '{\n  "ok": true,\n  "serverUrl": "http://127.0.0.1:3000"\n}'],
    ['INFO', 'sourceMode=smart active=personal-default'],
    ['INFO', '- github-default: github https://github.com/Neko-NF/Neko-Status-Desktop'],
    ['INFO', '- personal-default: personal https://git.koirin.com:39520/NF/Neko'],
    ['INFO', '- personal-default: personal https://git.koirin.com:39520/NF/Neko'],
    ['INFO', 'already latest: v1.2.7'],
    ['SUCCESS', '{\n  "success": true,\n  "filePath": "C:\\\\tmp\\\\NekoStatus-Setup-1.2.7.exe"\n}'],
  ]);
  assert.deepEqual(logs.slice(11), [
    ['INFO', 'runtime=PID 1 service=Running cache=0 B'],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['serviceState', true],
    ['setConfig', 'updateSourceMode', 'smart'],
    ['testConnection', 'http://127.0.0.1:3000'],
    ['installUpdate', 'C:\\tmp\\NekoStatus-Setup-1.2.7.exe', null, { manual: true }],
    'refreshStatus',
    'clearOutput',
  ]);
});

test('console runtime owns logs, status cards, export and command input', async () => {
  function makeElement(id, extra = {}) {
    const listeners = {};
    let html = extra.innerHTML || '';
    const el = {
      id,
      dataset: extra.dataset || {},
      style: {},
      children: [],
      parentNode: null,
      disabled: false,
      value: extra.value || '',
      checked: extra.checked,
      scrollTop: 0,
      scrollHeight: 0,
      className: extra.className || '',
      textContent: extra.textContent || '',
      classList: {
        values: new Set(),
        add(...names) { names.forEach((name) => this.values.add(name)); },
        remove(...names) { names.forEach((name) => this.values.delete(name)); },
        contains(name) { return this.values.has(name); },
      },
      addEventListener(type, handler) { listeners[type] = handler; },
      dispatch(type, event = {}) { listeners[type]?.({ target: el, ...event }); },
      appendChild(child) {
        child.parentNode = el;
        el.children.push(child);
        el.scrollHeight = el.children.length * 20;
        return child;
      },
      removeChild(child) {
        el.children = el.children.filter((item) => item !== child);
      },
      cloneNode() {
        return makeElement(id, {
          dataset: { ...el.dataset },
          value: el.value,
          checked: el.checked,
          className: el.className,
          textContent: el.textContent,
          innerHTML: html,
        });
      },
      querySelectorAll(selector) {
        if (selector === '.log-line') return el.children.filter((child) => child.className === 'log-line');
        return [];
      },
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = value;
        if (value === '') el.children = [];
        el.textContent = String(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      },
    };
    return el;
  }

  const elements = new Map();
  [
    'consoleOutput',
    'consoleAutoScroll',
    'consoleClearBtn',
    'consoleExportBtn',
    'consoleInput',
    'consoleSendBtn',
    'consoleRuntimeValue',
    'consoleRuntimeMeta',
    'consoleServiceValue',
    'consoleServiceMeta',
    'consoleUploadValue',
    'consoleUploadMeta',
    'consoleCacheValue',
    'consoleCacheMeta',
    'consoleMetricsValue',
    'consoleMetricsMeta',
    'consoleTickValue',
    'consoleTickMeta',
  ].forEach((id) => elements.set(id, makeElement(id)));
  elements.get('consoleAutoScroll').checked = true;
  const filters = [
    makeElement('filterAll', { dataset: { level: 'ALL' } }),
    makeElement('filterError', { dataset: { level: 'ERROR' } }),
  ];
  const body = makeElement('body');
  elements.forEach((el) => {
    el.parentNode = body;
  });

  const savedFiles = [];
  const calls = [];
  const context = {
    window: {},
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      createElement(tag) {
        return makeElement(tag);
      },
      querySelectorAll(selector) {
        if (selector === '.console-filter') return filters;
        return [];
      },
    },
    console,
    setTimeout,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/components/developer-console.js');
  context.window._nekoModules.components.DeveloperMode = {
    create: () => ({
      init: () => calls.push('developerModeInit'),
      updateScreenshotDebug: (data) => calls.push(['screenshotDebug', data.success]),
    }),
  };
  loadBrowserScript(context, 'src/renderer/js/components/console-runtime.js');

  const runtime = context.window._nekoModules.components.ConsoleRuntime.create({
    ipcClient: { isReady: () => true, invoke: async () => null, on: () => {} },
    IPC_EVENTS: { DEV_MODE_PANEL_COMMAND: 'dev:modePanel:command' },
    runtimeVersions: { electron: '30.0.0' },
    healthStats: { total: 4, success: 3 },
    callService: async (method) => {
      calls.push(['service', method]);
      if (method === 'isRunning') return true;
      if (method === 'getProcessInfo') return { pid: 42, memoryMB: 128, uptimeSec: 65 };
      return null;
    },
    callSystem: async (method, _fallback, payload) => {
      calls.push(['system', method]);
      if (method === 'getVersion') return '1.2.7';
      if (method === 'getCacheSize') return 2048;
      if (method === 'getMetrics') return { cpuPct: 20, memPct: 30, memUsed: 1024, memTotal: 4096 };
      if (method === 'saveTextFile') {
        savedFiles.push(payload);
        return { success: true, path: 'C:\\tmp\\neko-console.log' };
      }
      return null;
    },
    callConfig: async () => ({}),
    callUpdate: async () => null,
    callAnnouncement: async () => null,
    applyServiceState: (running) => calls.push(['serviceState', running]),
    replaceHandler: (id, handler) => {
      elements.get(id)?.addEventListener('click', handler);
    },
  });

  runtime.addLogLine('INFO', 'hello <unsafe>');
  runtime.addLogLine('ERROR', 'boom');
  filters[1].dispatch('click');
  assert.equal(elements.get('consoleOutput').children[0].style.display, 'none');
  assert.equal(elements.get('consoleOutput').children[1].style.display, '');

  await runtime.refreshStatus();
  assert.equal(elements.get('consoleRuntimeValue').textContent, 'PID 42');
  assert.equal(elements.get('consoleCacheValue').textContent, '2.0 KB');
  assert.equal(elements.get('consoleUploadValue').textContent, '75.0%');
  assert.equal(elements.get('consoleMetricsValue').textContent, '20.0% / 30.0%');

  elements.get('consoleExportBtn').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(savedFiles[0].content, /boom/);

  elements.get('consoleInput').value = 'version';
  elements.get('consoleSendBtn').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements.get('consoleOutput').children.at(-1).textContent, /Neko Status v1.2.7/);

  runtime.updateScreenshotDebug({ success: true });
  assert.deepEqual(calls.filter((call) => call === 'developerModeInit' || call[0] === 'screenshotDebug'), [
    'developerModeInit',
    ['screenshotDebug', true],
  ]);
});

test('app init runtime owns startup hydration and cross-page sync', async () => {
  function makeElement(id, extra = {}) {
    const listeners = {};
    const el = {
      id,
      dataset: extra.dataset || {},
      style: {
        values: {},
        setProperty(name, value) { this.values[name] = value; },
        removeProperty(name) { delete this.values[name]; },
      },
      children: [],
      value: extra.value || '',
      textContent: extra.textContent || '',
      innerHTML: extra.innerHTML || '',
      title: '',
      disabled: false,
      clicked: 0,
      className: extra.className || '',
      classList: {
        values: new Set(extra.classes || []),
        add(...names) { names.forEach((name) => this.values.add(name)); },
        remove(...names) { names.forEach((name) => this.values.delete(name)); },
        toggle(name, force) {
          const next = force === undefined ? !this.values.has(name) : !!force;
          if (next) this.values.add(name);
          else this.values.delete(name);
          return next;
        },
        contains(name) { return this.values.has(name); },
      },
      addEventListener(type, handler) { listeners[type] = handler; },
      click() {
        el.clicked += 1;
        listeners.click?.({ target: el });
      },
      querySelector(selector) {
        if (selector === 'i') {
          if (!el._icon) el._icon = makeElement(`${id}-icon`);
          return el._icon;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.toggle-btn') return extra.toggleButtons || [];
        return [];
      },
      closest() {
        return extra.closest || null;
      },
    };
    return el;
  }

  const elements = new Map();
  [
    'stgTraySwitch',
    'stgRestoreSwitch',
    'stgAutoDownloadSwitch',
    'stgDndSwitch',
    'stgNotifySwitch',
    'stgIncognitoSwitch',
    'blurAllSwitch',
    'stg2FASwitch',
    'stgGlassSwitch',
    'stgScaleLabel',
    'stgScaleDown',
    'stgScaleUp',
    'stgFontSelect',
    'cacheSizeDesc',
    'stgScaleDesc',
    'metaFingerprint',
    'metaProcess',
    'metaPrivilege',
    'authGrantedCount',
    'historyTableBody',
    'dashPermDesc',
    'dashDeniedList',
    'dashDeniedItems',
    'metaAuthScreenCapture',
    'metaAuthProcessEnum',
    'metaAuthPowerControl',
    'metaAuthNetwork',
    'metaAuthFileIO',
    'metaAuthAutoStart',
  ].forEach((id) => elements.set(id, makeElement(id)));
  const deviceBadge = makeElement('deviceBadge');
  const navUpdate = makeElement('navUpdate', { dataset: { target: 'page-update' } });
  const reportButtons = [
    makeElement('reportAuto', { dataset: { mode: 'auto' } }),
    makeElement('reportCustom', { dataset: { mode: 'custom' } }),
  ];
  const screenshotButtons = [
    makeElement('ssAuto', { dataset: { mode: 'auto' } }),
    makeElement('ssManual', { dataset: { mode: 'manual' } }),
  ];
  elements.set('stgReportModeGroup', makeElement('stgReportModeGroup', { toggleButtons: reportButtons }));
  elements.set('screenshotModeGroup', makeElement('screenshotModeGroup', { toggleButtons: screenshotButtons }));

  const storage = new Map();
  const calls = [];
  const updatePage = {
    bindSourceControls: () => calls.push('bindSourceControls'),
    renderSources: (cfg) => calls.push(['renderSources', cfg.updateChannel]),
    setPendingInstall: (version) => calls.push(['pending', version]),
    syncChannel: (channel) => calls.push(['channel', channel]),
    syncInstalledVersion: ({ version }) => calls.push(['installed', version]),
  };
  const context = {
    window: {
      devicePixelRatio: 2,
      _nekoActivityHelpers: { syncPrivacyBar: () => calls.push('privacyBar') },
    },
    document: {
      documentElement: makeElement('html'),
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector(selector) {
        if (selector === '.device-badge') return deviceBadge;
        if (selector === '.nav-item[data-target="page-update"]') return navUpdate;
        if (selector === '.rating-badge') return elements.get('ratingBadge') || null;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '#stgReportModeGroup .toggle-btn') return reportButtons;
        if (selector === '.settings-swatch, .color-swatch[data-color]') return [];
        return [];
      },
      dispatchEvent(event) {
        calls.push(['dispatch', event.type]);
      },
    },
    localStorage: {
      setItem(key, value) { storage.set(key, value); },
      getItem(key) { return storage.get(key) || null; },
    },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init?.detail;
    },
    requestAnimationFrame(fn) {
      calls.push('raf');
      return fn();
    },
    setTimeout(fn) {
      fn();
      return 1;
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.CustomEvent = context.CustomEvent;

  loadBrowserScript(context, 'src/renderer/js/core/app-init-runtime.js');
  const runtime = context.window._nekoModules.core.AppInitRuntime.create({
    runtimeVersions: { electron: '30.0.0' },
    consoleRuntime: {
      refreshStatus: () => calls.push('refreshStatus'),
      setLastTickSnapshot: (value) => calls.push(['lastTick', value.success]),
      updateTickStatus: (value) => calls.push(['tickStatus', value.success]),
    },
    addLogLine: (level, msg) => calls.push(['log', level, msg]),
    showNotice: (msg) => calls.push(['notice', msg]),
    escapeHtml: (value) => String(value).replace(/</g, '&lt;'),
    applyServiceState: (running) => calls.push(['serviceState', running]),
    applyThemeMode: (...args) => calls.push(['theme', ...args]),
    applyUIFontProfile: (font) => calls.push(['font', font]),
    applyExperimentalFeatureState: (cfg) => calls.push(['experimental', cfg.enableExperimentalFeatures]),
    setExpandableSectionState: (el, expanded) => calls.push(['expand', el?.id || null, expanded]),
    setIncognitoScopeUI: (scope) => calls.push(['scope', scope]),
    syncDeviceAuthExpandedState: () => calls.push('syncAuthExpanded'),
    updateDashboardCards: (data) => calls.push(['dashboard', data.success ?? data.batteryLevel]),
    updateDeviceStatusPage: (metrics) => calls.push(['deviceMetrics', metrics.cpuPct]),
    updatePowerKpi: (...args) => calls.push(['power', ...args]),
    addDiagnosticEntry: (...args) => calls.push(['diag', ...args]),
    renderChangelogEntries: (entries) => calls.push(['changelog', entries.length]),
    getInstalledChannel: () => 'stable',
    initTrendChart: () => calls.push('trendInit'),
    dashboardPage: () => ({ setMetricsHistory: (history) => calls.push(['history', history.length]) }),
    servicePage: () => ({
      syncAutoStartToggles: (enabled) => calls.push(['autoStart', enabled]),
      initFromAppInit: (data) => calls.push(['serviceInit', data.version]),
    }),
    updatePage: () => updatePage,
    aboutPage: () => ({ sync: ({ version }) => calls.push(['about', version]) }),
    callConfig: async (method, _fallback, key, value) => {
      calls.push(['config', method, key, value]);
      return {};
    },
    callService: async (method) => {
      calls.push(['service', method]);
      if (method === 'getLastResult') return { success: true };
      if (method === 'isAutoStartEnabled') return true;
      if (method === 'checkPermissions') {
        return {
          screenCapture: 'granted',
          processEnum: 'denied',
          powerControl: 'granted',
          network: 'granted',
          fileIO: 'granted',
        };
      }
      return null;
    },
    callSystem: async (method) => {
      calls.push(['system', method]);
      if (method === 'getFocusAssist') return { ok: true, enabled: true };
      if (method === 'getCacheSize') return 1048576;
      if (method === 'getMetricsHistory') return [{ cpuPct: 1 }];
      if (method === 'getMetrics') return { cpuPct: 33 };
      if (method === 'getFingerprint') return '1234567890abcdef9999';
      if (method === 'getBattery') return { level: 87, isCharging: true, hasBattery: true };
      return null;
    },
    callUpdate: async (method) => {
      calls.push(['update', method]);
      if (method === 'getPendingInstall') return { hasPending: true, version: '1.3.1' };
      if (method === 'getChangelog') return [{ version: '1.3.0' }];
      return null;
    },
  });

  await runtime.handle({
    version: '1.3.0',
    deviceName: 'Desk <One>',
    platform: 'win32',
    isRunning: true,
    isAutoStart: true,
    isAdmin: false,
    pid: 1234,
    processName: 'neko.exe',
    config: {
      closeAction: 'minimize',
      restoreLastState: true,
      lastPage: 'page-update',
      autoDownload: true,
      reportIntervalMode: 'custom',
      reportInterval: 30,
      syncScreenshotInterval: false,
      enableNotification: true,
      doNotDisturb: false,
      enableIncognito: true,
      incognitoScope: 'both',
      blurAllScreenshots: true,
      enable2FA: true,
      glassEffect: false,
      themeMode: 'auto',
      darkModeStart: '19:00',
      darkModeEnd: '06:00',
      screenshotMode: 'manual',
      uiScale: 150,
      uiFont: 'Inter',
      seedColor: '#123456',
      enableExperimentalFeatures: true,
      updateChannel: 'beta',
      deviceKey: 'dk_live',
    },
  });

  assert.match(deviceBadge.innerHTML, /Desk &lt;One>/);
  assert.equal(elements.get('stgTraySwitch').classList.contains('on'), true);
  assert.equal(elements.get('stgScaleLabel').textContent, '150%');
  assert.equal(elements.get('cacheSizeDesc').textContent, '会话缓存（图片、脚本等）· 当前 1.0 MB');
  assert.equal(elements.get('metaFingerprint').textContent, '1234567890abcdef…');
  assert.equal(elements.get('authGrantedCount').textContent, '1项未授权');
  assert.equal(navUpdate.clicked, 1);
  assert.equal(storage.get('neko-ui-font'), 'Inter');
  assert.equal(context.document.documentElement.style.values['--theme-color-seed'], '#123456');
  assert.equal(context.document.documentElement.style.values['--theme-color'], undefined);
  assert.deepEqual(calls.filter((call) => Array.isArray(call) && ['about', 'pending', 'channel', 'installed', 'history'].includes(call[0])), [
    ['pending', '1.3.1'],
    ['channel', 'beta'],
    ['installed', '1.3.0'],
    ['about', '1.3.0'],
    ['history', 1],
  ]);
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'config' && call[2] === 'doNotDisturb'));
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'service' && call[1] === 'syncMeta'));
});

test('app-ipc is only a compatibility bootstrap for AppRuntime', () => {
  let domReadyHandler = null;
  let starts = 0;
  const context = {
    window: {
      _nekoModules: {
        core: {
          AppRuntime: {
            start() {
              starts += 1;
            },
          },
        },
      },
    },
    document: {
      readyState: 'loading',
      addEventListener(type, handler, options) {
        assert.equal(type, 'DOMContentLoaded');
        assert.equal(options?.once, true);
        domReadyHandler = handler;
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/app-ipc.js');

  assert.equal(starts, 0);
  domReadyHandler();
  assert.equal(starts, 1);
});

test('router delegates conditional nav clicks to announcement page', () => {
  function makeClassList(initial = []) {
    return {
      values: new Set(initial),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
      toggle(value, enabled) {
        const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
        if (shouldAdd) this.values.add(value);
        else this.values.delete(value);
      },
    };
  }

  function makeElement(id, extra = {}) {
    const listeners = {};
    const attrs = new Map(Object.entries(extra.attrs || {}));
    return {
      id,
      offsetTop: extra.offsetTop || 0,
      offsetHeight: extra.offsetHeight || 44,
      style: {
        display: '',
        setProperty(key, value) { this[key] = value; },
      },
      classList: makeClassList(extra.classes || []),
      innerHTML: '',
      dataset: extra.dataset || {},
      addEventListener(type, handler) { listeners[type] = handler; },
      dispatch(type, event = {}) { return listeners[type]?.({ target: this, currentTarget: this, preventDefault() {}, ...event }); },
      getAttribute(name) { return attrs.get(name) || null; },
      setAttribute(name, value) { attrs.set(name, String(value)); },
      removeAttribute(name) { attrs.delete(name); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      contains(target) { return target === this; },
      click() { return listeners.click?.({ target: this, currentTarget: this, preventDefault() {} }); },
      ...extra,
    };
  }

  const navDashboard = makeElement('navDashboard', { attrs: { 'data-target': 'mainDashboardArea' }, classes: ['nav-item', 'active'] });
  const navAnnouncement = makeElement('navAnnouncement', {
    attrs: { 'data-target': 'page-announcement', 'aria-hidden': 'false' },
    classes: ['nav-item', 'conditional-nav', 'show'],
    offsetTop: 52,
  });
  const navMenu = makeElement('navMenu', {
    querySelector(selector) {
      if (selector === '.nav-item.active') return [navDashboard, navAnnouncement].find((item) => item.classList.contains('active')) || null;
      if (selector === '.nav-item[data-target="mainDashboardArea"]') return navDashboard;
      if (selector === '.nav-item[data-target="page-announcement"]') return navAnnouncement;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '.nav-item' ? [navDashboard, navAnnouncement] : [];
    },
    contains(target) {
      return target === navDashboard || target === navAnnouncement;
    },
  });
  const pages = new Map([
    ['mainDashboardArea', makeElement('mainDashboardArea')],
    ['page-announcement', makeElement('page-announcement')],
  ]);
  const title = makeElement('pageTitle');
  const indicator = makeElement('navActiveIndicator');
  const editBtn = makeElement('editLayoutBtn');
  const context = {
    window: {
      _nekoModules: {
        services: {
          ConfigClient: { set: async () => true },
        },
      },
      addEventListener() {},
    },
    document: {
      querySelector(selector) {
        if (selector === '.nav-menu') return navMenu;
        if (selector === '.page-title') return title;
        return null;
      },
      querySelectorAll(selector) {
        return selector === '.nav-menu .nav-item' ? [navDashboard, navAnnouncement] : [];
      },
      getElementById(id) {
        if (id === 'navActiveIndicator') return indicator;
        if (id === 'editLayoutBtn') return editBtn;
        return pages.get(id) || null;
      },
    },
    getComputedStyle(el) {
      return {
        display: el.style.display || 'flex',
        visibility: el.classList.contains('show') || !el.classList.contains('conditional-nav') ? 'visible' : 'hidden',
      };
    },
    requestAnimationFrame(fn) { fn(); },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/core/event-bus.js');
  loadBrowserScript(context, 'src/renderer/js/core/router.js');

  context.window._nekoModules.router.init();
  navMenu.dispatch('click', {
    target: {
      closest(selector) {
        return selector === '.nav-item' ? navAnnouncement : null;
      },
    },
    preventDefault() {},
  });

  assert.equal(context.window._nekoModules.router.getCurrentPage(), 'page-announcement');
  assert.equal(pages.get('page-announcement').style.display, 'block');
  assert.equal(navAnnouncement.classList.contains('active'), true);
  assert.equal(navDashboard.classList.contains('active'), false);
});

test('app event runtime owns main-process event forwarding', async () => {
  const ipcHandlers = new Map();
  const documentHandlers = new Map();
  const actions = {};
  const calls = [];
  const updateSeeAllBtn = {
    addEventListener(type, handler) {
      documentHandlers.set(`seeAll:${type}`, handler);
    },
  };
  const context = {
    window: {},
    document: {
      querySelector(selector) {
        if (selector === '.update-see-all-btn') return updateSeeAllBtn;
        return null;
      },
      addEventListener(type, handler) {
        documentHandlers.set(type, handler);
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;

  loadBrowserScript(context, 'src/renderer/js/core/app-event-runtime.js');
  const runtime = context.window._nekoModules.core.AppEventRuntime.create({
    ipcClient: {
      on(event, handler) {
        ipcHandlers.set(event, handler);
      },
    },
    IPC_EVENTS: {
      APP_INIT: 'app:init',
      UPDATE_PROGRESS: 'update:progress',
      UPDATE_AUTO_DOWNLOADED: 'update:autoDownloaded',
      UPDATE_FORCE_INSTALL_STARTED: 'update:forceInstallStarted',
      UPDATE_AUTO_DOWNLOAD_FAILED: 'update:autoDownloadFailed',
      UPDATE_AVAILABLE: 'update:available',
      SERVICE_TICK: 'service:tick',
      SYSTEM_METRICS_UPDATE: 'system:metricsUpdate',
      SERVICE_STATUS_CHANGED: 'service:statusChanged',
      LOG_ENTRY: 'log:entry',
      SERVICE_KEY_STATUS: 'service:keyStatus',
    },
    appInitRuntime: { handle: async (data) => calls.push(['appInit', data.version]) },
    consoleRuntime: {
      setLastTickSnapshot: (data) => calls.push(['lastTick', data.success]),
      updateTickStatus: (data) => calls.push(['tickStatus', data.success]),
      updateScreenshotDebug: (data) => calls.push(['debug', data.success]),
      setLastMetricsSnapshot: (data) => calls.push(['lastMetrics', data.cpuPct]),
      updateMetricsStatus: (data) => calls.push(['metricsStatus', data.cpuPct]),
    },
    addLogLine: (...args) => calls.push(['log', ...args]),
    showNotice: (...args) => calls.push(['notice', ...args]),
    applyServiceState: (running) => calls.push(['serviceState', running]),
    addDiagnosticEntry: (...args) => calls.push(['diag', ...args]),
    updateDashboardCards: (data) => calls.push(['dashboard', data.success]),
    updatePowerKpi: (...args) => calls.push(['power', ...args]),
    updateDeviceStatusPage: (data) => calls.push(['device', data.cpuPct]),
    rebuildTrendChartDeferred: () => calls.push('trendRebuild'),
    applyDeviceStatusSparklineTheme: () => calls.push('sparkTheme'),
    securityDialogs: { showWarning: (...args) => calls.push(['warning', ...args]) },
    updatePage: () => ({
      bindDialogActions: (nextActions) => Object.assign(actions, nextActions),
      hideDialog: () => calls.push('hideDialog'),
      downloadAndInstall: (result) => calls.push(['downloadInstall', result.latestVersion]),
      updateProgress: (data) => calls.push(['progress', data.percent]),
      markAutoDownloaded: (data) => calls.push(['autoDownloaded', data.version]),
      markForceInstallStarted: (data) => calls.push(['forceInstall', data.version]),
      markAvailable: (data) => calls.push(['available', data.latestVersion]),
      renderReleaseNotes: (data) => calls.push(['notes', data.latestVersion]),
    }),
    updateClient: () => ({ setSkippedVersion: async (version) => calls.push(['skip', version]) }),
    callConfig: async (method) => {
      calls.push(['config', method]);
      return { githubOwner: 'Owner', githubRepo: 'Repo' };
    },
    callSystem: async (method, _fallback, url) => calls.push(['system', method, url]),
    callService: async (method) => calls.push(['service', method]),
  });

  runtime.bind();
  await ipcHandlers.get('app:init')({ version: '1.3.0' });
  ipcHandlers.get('update:progress')({ percent: 42 });
  ipcHandlers.get('update:available')({ hasUpdate: true, latestVersion: '1.3.1', forceUpdate: false });
  ipcHandlers.get('update:autoDownloaded')({ version: '1.3.1' });
  ipcHandlers.get('update:forceInstallStarted')({ version: '1.3.2' });
  ipcHandlers.get('update:autoDownloadFailed')({ version: '1.3.3', error: 'network' });
  ipcHandlers.get('service:tick')({ success: true, batteryLevel: 88, isCharging: false, hasBattery: true });
  ipcHandlers.get('system:metricsUpdate')({ cpuPct: 17 });
  ipcHandlers.get('service:statusChanged')({ isRunning: false });
  ipcHandlers.get('log:entry')({ level: 'WARN', msg: 'careful', time: 1 });
  ipcHandlers.get('service:keyStatus')({ code: 'KEY_REVOKED', message: 'revoked' });
  documentHandlers.get('neko:themeChange')();
  await actions.onSkip({ latestVersion: '1.3.4' });
  await actions.onInstall({ latestVersion: '1.3.5' });
  await documentHandlers.get('seeAll:click')();

  assert.deepEqual(calls.filter((call) => Array.isArray(call) && [
    'appInit',
    'progress',
    'available',
    'notes',
    'autoDownloaded',
    'forceInstall',
    'dashboard',
    'device',
    'warning',
    'downloadInstall',
  ].includes(call[0])), [
    ['appInit', '1.3.0'],
    ['progress', 42],
    ['available', '1.3.1'],
    ['notes', '1.3.1'],
    ['autoDownloaded', '1.3.1'],
    ['forceInstall', '1.3.2'],
    ['dashboard', true],
    ['device', 17],
    ['warning', '密钥已被撤销', '当前设备密钥已被服务器撤销，上报服务已自动停止。可能原因：密钥在网页端被手动删除，或被其他设备接管。', 'revoked', true],
    ['downloadInstall', '1.3.5'],
  ]);
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'service' && call[1] === 'syncMeta'));
  assert.ok(calls.includes('trendRebuild'));
  assert.ok(calls.includes('sparkTheme'));
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'system' && call[2] === 'https://github.com/Owner/Repo/releases'));
});

test('developer mode extracts UI metadata without direct IPC access', () => {
  const context = {
    window: {
      innerWidth: 1280,
      innerHeight: 720,
      getComputedStyle: () => ({
        position: 'fixed',
        zIndex: '24',
        transitionDuration: '0.2s',
        animationName: 'none',
        backdropFilter: 'blur(8px)',
        maskImage: 'none',
        overflow: 'hidden',
        borderRadius: '12px',
        opacity: '0.86',
        fontSize: '14px',
        fontWeight: '600',
        lineHeight: '20px',
        color: 'rgb(15, 23, 42)',
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        padding: '8px 12px',
        margin: '0px',
        display: 'inline-flex',
        gap: '6px',
      }),
    },
    console,
  };
  context.window.window = context.window;

  loadBrowserScript(context, 'src/renderer/js/components/developer-mode.js');

  const attrs = new Map([
    ['type', 'button'],
    ['title', 'Save config'],
  ]);
  const el = {
    tagName: 'BUTTON',
    id: 'saveConfigBtn',
    dataset: { section: 'settings' },
    classList: ['action-btn', 'primary'],
    getAttribute: (key) => attrs.get(key) || '',
    getBoundingClientRect: () => ({ width: 120, height: 40 }),
    matches: (selector) => selector.includes('#page-settings'),
    closest: () => ({ id: 'page-settings' }),
  };

  const info = context.window._nekoModules.components.DeveloperMode.inspectElement(el);
  assert.equal(context.window._nekoModules.components.DeveloperMode.CONFIG_KEYS.MODE, 'debugEnabled');
  assert.equal(info.name, 'settings');
  assert.equal(info.selector, '#saveConfigBtn');
  assert.equal(info.role, 'button');
  assert.equal(info.sourceOwner, 'SettingsPage');
  assert.equal(info.sourceFile, 'src/renderer/js/pages/settings.page.js');
  assert.equal(info.size, '120x40');
  assert.match(info.features, /position=fixed/);
  assert.match(info.features, /transition=0.2s/);
  assert.match(info.features, /backdrop-filter/);
  assert.equal(info.uiux.radius, '12px');
  assert.equal(info.uiux.opacity, '0.86');
  assert.equal(info.uiux.fontSize, '14px');
  assert.equal(info.uiux.gap, '6px');

  const iconAttrs = new Map([
    ['aria-label', 'Refresh backend'],
  ]);
  const icon = {
    tagName: 'I',
    id: '',
    dataset: {},
    classList: ['ph', 'ph-plugs-connected'],
    getAttribute: (key) => iconAttrs.get(key) || '',
    getBoundingClientRect: () => ({ width: 18, height: 18 }),
    matches: (selector) => selector.includes('#page-settings'),
    closest: () => ({ id: 'page-settings' }),
  };
  const iconInfo = context.window._nekoModules.components.DeveloperMode.inspectElement(icon);
  assert.equal(iconInfo.name, 'Refresh backend');
  assert.equal(iconInfo.selector, 'i.ph.ph-plugs-connected');
  assert.equal(iconInfo.role, 'Refresh backend');

  const textNode = { nodeValue: '  Developer diagnostics  ' };
  const parent = {
    tagName: 'SPAN',
    id: 'developerDiagnosticsTitle',
    dataset: {},
    classList: ['settings-title'],
    childNodes: [textNode],
    getAttribute: () => '',
    matches: (selector) => selector.includes('#page-settings'),
    closest: () => ({ id: 'page-settings' }),
  };
  const textInfo = context.window._nekoModules.components.DeveloperMode.inspectTextNode(
    textNode,
    parent,
    { width: 164, height: 24 },
  );
  assert.equal(textInfo.name, 'text:Developer diagnostics');
  assert.equal(textInfo.selector, '#developerDiagnosticsTitle::text(1)');
  assert.equal(textInfo.role, 'text');
  assert.match(textInfo.features, /text-node/);
});

test('developer mode panel commands drive diagnostic switches through injected clients', async () => {
  function makeElement(id) {
    return {
      id,
      dataset: {},
      hidden: false,
      style: {
        values: {},
        setProperty(name, value) { this.values[name] = value; },
        getPropertyValue(name) { return this.values[name] || ''; },
      },
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        toggle(value, enabled) {
          const shouldAdd = enabled === undefined ? !this.values.has(value) : !!enabled;
          if (shouldAdd) this.values.add(value);
          else this.values.delete(value);
        },
      },
      append() {},
      appendChild() {},
      replaceChildren() {},
      remove() {},
      addEventListener() {},
      getAttribute() { return ''; },
      setAttribute() {},
      removeAttribute() {},
      getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; },
    };
  }

  let panelHandler = null;
  const calls = [];
  const panelStates = [];
  const context = {
    window: {
      innerWidth: 1280,
      innerHeight: 720,
      requestAnimationFrame(fn) { fn(); return 1; },
      setTimeout(fn) { fn(); return 1; },
      addEventListener() {},
      getComputedStyle: () => ({
        getPropertyValue() { return ''; },
      }),
    },
    document: {
      documentElement: makeElement('html'),
      body: makeElement('body'),
      createElement(tag) { return makeElement(tag); },
      getElementById() { return null; },
      addEventListener() {},
      querySelectorAll() { return []; },
    },
    MutationObserver: class {
      observe() {}
    },
    getComputedStyle: () => ({
      getPropertyValue() { return ''; },
    }),
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.MutationObserver = context.MutationObserver;
  context.window.requestAnimationFrame = context.window.requestAnimationFrame;
  context.window.setTimeout = context.window.setTimeout;

  loadBrowserScript(context, 'src/renderer/js/components/developer-mode.js');

  const mode = context.window._nekoModules.components.DeveloperMode.create({
    getConfig: async (key) => key === 'debugEnabled',
    setConfig: async (key, value) => {
      calls.push(['setConfig', key, value]);
      return true;
    },
    getBackendSnapshot: async () => ({
      ipcReady: true,
      update: { sourceMode: 'selected', autoCheck: true, autoDownload: false },
    }),
    openPanel: async () => calls.push('openPanel'),
    closePanel: async () => calls.push('closePanel'),
    updatePanel: async (payload) => panelStates.push(payload),
    onPanelCommand: (handler) => {
      panelHandler = handler;
      return () => {};
    },
    runHealthCheck: async () => {
      calls.push('runHealthCheck');
      return [{ name: 'service', ok: true }];
    },
    runUpdateIntegrity: async () => {
      calls.push('runUpdateIntegrity');
      return [{ name: 'package', ok: true }];
    },
    clearCache: async () => {
      calls.push('clearCache');
      return { success: true };
    },
  });

  await mode.init();
  await panelHandler({ action: 'toggle-update-source-mode' });
  await panelHandler({ action: 'toggle-auto-check-update' });
  await panelHandler({ action: 'toggle-auto-download' });
  await panelHandler({ action: 'run-health-check' });
  await panelHandler({ action: 'run-update-integrity' });
  await panelHandler({ action: 'clear-cache' });
  await panelHandler({ action: 'set-uiux-token', token: 'radiusCard', value: 30 });
  await panelHandler({ action: 'set-uiux-token', token: 'fontScale', value: 110 });
  await panelHandler({ action: 'reset-uiux-tokens' });
  await panelHandler({ action: 'set-screenshot-token', token: 'uploadFormat', value: 'jpeg' });
  await panelHandler({ action: 'set-screenshot-token', token: 'targetKb', value: 2048 });
  await panelHandler({ action: 'set-screenshot-token', token: 'resizeFloor', value: 65 });
  mode.updateScreenshotDebug({
    hasScreenshot: true,
    screenshotSize: 512 * 1024,
    screenshotTuning: { targetKb: 2048, resizeFloor: 65 },
    screenshotCompression: {
      originalBytes: 1024 * 1024,
      compressedBytes: 512 * 1024,
      ratio: 0.5,
      format: 'jpeg',
      quality: 84,
      scale: 0.9,
      width: 1280,
      height: 720,
    },
  });
  await panelHandler({ action: 'reset-screenshot-tokens' });

  assert.deepEqual(calls.filter(Array.isArray).map(([kind, key, value]) => [kind, key, typeof value]), [
    ['setConfig', 'updateSourceMode', 'string'],
    ['setConfig', 'autoCheckUpdate', 'boolean'],
    ['setConfig', 'autoDownload', 'boolean'],
    ['setConfig', 'developerUiuxTuning', 'object'],
    ['setConfig', 'developerUiuxTuning', 'object'],
    ['setConfig', 'developerUiuxTuning', 'object'],
    ['setConfig', 'developerScreenshotTuning', 'object'],
    ['setConfig', 'developerScreenshotTuning', 'object'],
    ['setConfig', 'developerScreenshotTuning', 'object'],
    ['setConfig', 'developerScreenshotTuning', 'object'],
  ]);
  assert.equal(calls.includes('runHealthCheck'), true);
  assert.equal(calls.includes('runUpdateIntegrity'), true);
  assert.equal(calls.includes('clearCache'), true);
  assert.equal(context.document.documentElement.style.values['--radius-card'], '24px');
  assert.equal(context.document.documentElement.style.values['--type-body-size'], '12px');
  assert.equal(context.document.documentElement.style.values['--uiux-glass-opacity'], '0.05');
  assert.equal(context.document.documentElement.style.values['--uiux-text-secondary-opacity'], '0.6');
  assert.equal(context.document.documentElement.style.values['--text-secondary'], undefined);
  assert.equal(context.document.body.style.values['--glass-bg'], undefined);
  assert.equal(context.document.body.style.zoom, '');
  assert.equal(panelStates.some((payload) => payload.diagnostics?.some((item) => item.title === '服务体检')), true);
  assert.equal(panelStates.some((payload) => payload.diagnostics?.some((item) => item.title === '缓存清理')), true);
  assert.equal(panelStates.some((payload) => payload.uiuxTuning?.radiusCard === 30), true);
  assert.equal(panelStates.some((payload) => payload.uiuxTuning?.fontScale === 110), true);
  assert.equal(panelStates.some((payload) => payload.screenshotTuning?.uploadFormat === 'jpeg'), true);
  assert.equal(panelStates.some((payload) => payload.screenshotTuning?.targetKb === 2048), true);
  assert.equal(panelStates.some((payload) => payload.screenshotDebug?.screenshotCompression?.compressedBytes === 512 * 1024), true);
  assert.equal(mode.getState().screenshotTuning.targetKb, 2253);
});

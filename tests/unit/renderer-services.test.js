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
    setTimeout(fn) { fn(); return 1; },
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
          getPropertyValue() { return '#06b6d4'; },
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
        getPropertyValue() { return '#06b6d4'; },
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
    },
    setTimeout(fn) { fn(); return 1; },
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
    ['neko-theme-color', '#06b6d4'],
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
  assert.equal(storage.get('neko-theme-color'), '#06b6d4');
  assert.equal(elements.get('stgCustomColorHex').value, '#123ABC');

  topSwatch.dispatch('click');
  assert.equal(storage.get('neko-theme-color'), '#ff0000');
  assert.equal(context.document.documentElement.style.values['--theme-color'], '#ff0000');
  assert.equal(elements.get('profileModalAvatar').src.includes('background=ff0000'), true);
  assert.equal(context.document.lastEvent.type, 'neko:themeChange');

  elements.get('stgCustomColorHex').value = '#abcdef';
  elements.get('stgCustomColorApply').dispatch('click');
  assert.equal(storage.get('neko-theme-color'), '#abcdef');
  assert.equal(storage.get('neko-custom-theme-color'), '#abcdef');
  assert.deepEqual(setConfigCalls.at(-2), ['seedColor', '#abcdef']);
  assert.deepEqual(setConfigCalls.at(-1), ['customSeedColor', '#abcdef']);
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
});

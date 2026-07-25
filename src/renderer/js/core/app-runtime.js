/**
 * core/app-runtime.js
 * Renderer runtime composition layer.
 *
 * Domain DOM behavior lives in pages/* and components/*; this module wires
 * services, pages, cross-page runtimes, and main-process events together.
 */

(function attachAppRuntime() {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.core = window._nekoModules.core || {};

  function start() {
    if (document.documentElement.dataset.appRuntimeBound === '1') return;
    document.documentElement.dataset.appRuntimeBound = '1';

  const ipcClient = window._nekoModules?.services?.IpcClient;
  const runtimeVersions = window.nekoRuntime?.versions || {};
  const IPC_EVENTS = window.__NEKO_IPC_CONTRACTS__?.IPC_EVENTS || {
    APP_INIT: 'app:init',
    LOG_ENTRY: 'log:entry',
    SERVICE_TICK: 'service:tick',
    SERVICE_STATUS_CHANGED: 'service:statusChanged',
    SERVICE_KEY_STATUS: 'service:keyStatus',
    UPDATE_PROGRESS: 'update:progress',
    UPDATE_AVAILABLE: 'update:available',
    UPDATE_FORCE_INSTALL_STARTED: 'update:forceInstallStarted',
    UPDATE_AUTO_DOWNLOADED: 'update:autoDownloaded',
    UPDATE_AUTO_DOWNLOAD_FAILED: 'update:autoDownloadFailed',
    SYSTEM_METRICS_UPDATE: 'system:metricsUpdate',
    DEV_MODE_PANEL_COMMAND: 'dev:modePanel:command',
    DEV_MODE_PANEL_STATE: 'dev:modePanel:state',
  };
  const consoleNavEntry = document.getElementById('navConsole');
  const setExpandableSectionState = window._nekoUIHelpers?.setExpandableSectionState
    || ((el, expanded, options = {}) => {
      if (!el) return;
      el.style.display = expanded ? (options.display || '') : 'none';
    });
  const applyUIFontProfile = window._nekoUIHelpers?.applyUIFontProfile
    || (() => {});
  const normalizeServiceHealthCheckCopy = window._nekoUIHelpers?.normalizeServiceHealthCheckCopy
    || (() => {});
  const authClient = () => window._nekoModules?.services?.AuthClient || null;
  const apiClient = () => window._nekoModules?.services?.ApiClient || null;
  const configClient = () => window._nekoModules?.services?.ConfigClient || null;
  const serviceClient = () => window._nekoModules?.services?.ServiceClient || null;
  const systemClient = () => window._nekoModules?.services?.SystemClient || null;
  const updateClient = () => window._nekoModules?.services?.UpdateClient || null;
  const dashboardPage = () => window._nekoModules?.pages?.DashboardPage || null;
  const updatePage = () => window._nekoModules?.pages?.UpdatePage || null;
  const settingsPage = () => window._nekoModules?.pages?.SettingsPage || null;
  const screenshotPage = () => window._nekoModules?.pages?.ScreenshotPage || null;
  const announcementClient = () => window._nekoModules?.services?.AnnouncementClient || null;
  const announcementPage = () => window._nekoModules?.pages?.AnnouncementPage || null;
  const aboutPage = () => window._nekoModules?.pages?.AboutPage || null;
  const servicePage = () => window._nekoModules?.pages?.ServicePage || null;
  const activityPage = () => window._nekoModules?.pages?.ActivityPage || null;
  const uiLabPage = () => window._nekoModules?.pages?.UiLabPage || null;
  const loadingSystem = () => window._nekoModules?.components?.LoadingSystem || null;
  const loadingCurves = () => window._nekoModules?.components?.LoadingCurves || null;
  const appearanceProfile = window._nekoModules?.core?.AppearanceProfile || null;
  const experimentalFeatures = window._nekoModules?.components?.ExperimentalFeatures?.create?.({
    setExpandableSectionState,
  });
  const applyThemeMode = (...args) => window._nekoModules?.theme?.applyThemeMode?.(...args);
  function showNekoIsland(text, type = 'info', durationMs = 3000) {
    const island = window._nekoModules?.nekoIsland;
    if (island?.show) {
      island.show(text, type, durationMs);
      return;
    }
    if (typeof window.showNekoIsland === 'function' && window.showNekoIsland !== showNekoIsland) {
      window.showNekoIsland(text, type, durationMs);
    }
  }

  appearanceProfile?.init?.({ config: configClient(), showNotice: showNekoIsland });

  experimentalFeatures?.mountSettingsZone?.();
  normalizeServiceHealthCheckCopy();
  if (!ipcClient?.isReady?.()) {
    console.error('[AppRuntime] IPC service is not ready, please check preload and ipc-client loading order');
    return;
  }

  function callUpdate(methodName, _fallbackName, ...args) {
    const client = updateClient();
    if (client && typeof client[methodName] === 'function') {
      return client[methodName](...args);
    }
    throw new Error(`UpdateClient method missing: ${methodName}`);
  }

  function callAnnouncement(methodName, _fallbackName, ...args) {
    const client = announcementClient();
    if (client && typeof client[methodName] === 'function') {
      return client[methodName](...args);
    }
    throw new Error(`AnnouncementClient method missing: ${methodName}`);
  }

  function callRendererClient(factory, methodName, _fallbackName, ...args) {
    const client = factory();
    if (client && typeof client[methodName] === 'function') {
      return client[methodName](...args);
    }
    throw new Error(`Renderer service method missing: ${methodName}`);
  }

  const callApi = (methodName, fallbackName, ...args) =>
    callRendererClient(apiClient, methodName, fallbackName, ...args);
  const callAuth = (methodName, fallbackName, ...args) =>
    callRendererClient(authClient, methodName, fallbackName, ...args);
  const callConfig = (methodName, fallbackName, ...args) =>
    callRendererClient(configClient, methodName, fallbackName, ...args);
  const callService = (methodName, fallbackName, ...args) =>
    callRendererClient(serviceClient, methodName, fallbackName, ...args);
  const callSystem = (methodName, fallbackName, ...args) =>
    callRendererClient(systemClient, methodName, fallbackName, ...args);

  let consoleRuntime = null;

  function addLogLine(...args) {
    return consoleRuntime?.addLogLine?.(...args);
  }

  function escapeHtml(str) {
    const helper = consoleRuntime?.escapeHtml || window._nekoModules?.components?.ConsoleRuntime?.escapeHtml;
    if (helper) return helper(str);
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatBytes(bytes) {
    const helper = consoleRuntime?.formatBytes || window._nekoModules?.components?.ConsoleRuntime?.formatBytes;
    if (helper) return helper(bytes);
    return `${Number(bytes) || 0} B`;
  }

  const deviceStatusPage = () => window._nekoModules?.pages?.DeviceStatusPage || null;

  function ensureDeviceStatusPage() {
    const page = deviceStatusPage();
    page?.init?.({
      notify: (title, body) => callSystem('notify', 'notify', title, body),
      addLogLine,
      showNotice: showNekoIsland,
      config: configClient(),
      service: serviceClient(),
      escapeHtml,
    });
    return page;
  }

  function updatePowerKpi(level, isCharging, hasBattery, footerText, powerInfo) {
    return ensureDeviceStatusPage()?.updatePowerKpi?.(level, isCharging, hasBattery, footerText, powerInfo);
  }

  function updateDeviceStatusPage(metrics) {
    return ensureDeviceStatusPage()?.updateMetrics?.(metrics);
  }

  function recordDashboardMetrics(metrics) {
    return dashboardPage()?.recordMetrics?.(metrics);
  }

  function addDiagnosticEntry(module, status, detail, actionHtml) {
    return ensureDeviceStatusPage()?.addDiagnosticEntry?.(module, status, detail, actionHtml);
  }

  function applyDeviceStatusSparklineTheme() {
    return ensureDeviceStatusPage()?.applySparklineTheme?.();
  }

  ensureDeviceStatusPage();

  // ══════════════════════════════════════════════════════════════
  //  工具函数
  // ══════════════════════════════════════════════════════════════

  /** 克隆元素并替换，以清除 app.js 注册的旧处理器 */
  function replaceHandler(id, handler) {
    const el = document.getElementById(id);
    if (!el) return null;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', handler);
    return clone;
  }

  if (consoleNavEntry) {
    consoleNavEntry.setAttribute('aria-hidden', consoleNavEntry.classList.contains('show') ? 'false' : 'true');
    consoleNavEntry.setAttribute('tabindex', consoleNavEntry.classList.contains('show') ? '0' : '-1');
    consoleNavEntry.style.removeProperty('display');
    consoleNavEntry.style.removeProperty('color');
  }

  // ── 上传健康度追踪 ─────────────────────────────────────────────────────
  const _healthStats = { total: 0, success: 0 };

  // ── 趋势图表 ──────────────────────────────────────────────────────────
  function _rebuildTrendChartDeferred() {
    return dashboardPage()?.rebuildTrendChartDeferred?.();
  }

  function _initTrendChart() {
    return dashboardPage()?.initTrendRuntime?.();
  }

  function _updateTrendChart(updateMode = 'active') {
    return dashboardPage()?.updateTrendChart?.(updateMode);
  }

  consoleRuntime = window._nekoModules?.components?.ConsoleRuntime?.create?.({
    ipcClient,
    IPC_EVENTS,
    runtimeVersions,
    healthStats: _healthStats,
    callApi,
    callConfig,
    callService,
    callSystem,
    callUpdate,
    callAnnouncement,
    applyServiceState,
    triggerScreenshot,
    notify: showNekoIsland,
    replaceHandler,
  });

  function setIncognitoScopeUI(scope) {
    return settingsPage()?.setIncognitoScopeUI?.(scope);
  }

  // ══════════════════════════════════════════════════════════════
  //  服务状态指示器更新
  // ══════════════════════════════════════════════════════════════
  function applyServiceState(isRunning) {
    consoleRuntime?.updateServiceStatus?.(isRunning);
    dashboardPage()?.applyServiceState?.(isRunning);
    servicePage()?.applyServiceState?.(isRunning);

    // 顶栏状态点 — 需动态查询，因 app:init 会重建 badge innerHTML
    const dot = document.getElementById('deviceStatusDot');
    if (dot) {
      dot.classList.toggle('error', !isRunning);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  仪表盘卡片实时数据
  // ══════════════════════════════════════════════════════════════
  function updateDashboardCards(data, options = {}) {
    return dashboardPage()?.updateCards?.(data, options);
  }

  function appendActivityItem(type, main, sub, time) {
    return dashboardPage()?.appendActivityItem?.(type, main, sub, time);
  }

  function formatDateTime(value) {
    return dashboardPage()?.formatDateTime?.(value) || new Date().toISOString();
  }

  function formatTimeOnly(value) {
    return dashboardPage()?.formatTimeOnly?.(value) || new Date().toTimeString().slice(0, 8);
  }

  async function triggerScreenshot() {
    return screenshotPage()?.triggerScreenshot?.();
  }

  dashboardPage()?.initRuntime?.({
    escapeHtml,
    onUploadHealthChange: (stats) => {
      _healthStats.total = stats?.total || 0;
      _healthStats.success = stats?.success || 0;
      consoleRuntime?.updateUploadStatus?.();
    },
  });

  const securityDialogs = window._nekoModules?.components?.SecurityDialogs?.create?.({
    escapeHtml,
    showNotice: showNekoIsland,
    openConfig: () => document.getElementById('btnConfigKey')?.click(),
  });
  const showTakeoverConfirmDialog = () => securityDialogs?.confirmTakeover?.() || Promise.resolve(false);

  window._nekoModules?.pages?.ConfigPage?.init?.({
    addLogLine,
    showNotice: showNekoIsland,
    showTakeoverConfirmDialog,
    reopenAuthModal: openAuthModal,
  });

  servicePage()?.init?.({
    addLogLine,
    showNotice: showNekoIsland,
    applyServiceState,
    runPermissionDiagnosis,
    setExpandableSectionState,
    service: serviceClient(),
    config: configClient(),
    system: systemClient(),
    escapeHtml,
  });

  screenshotPage()?.init?.({
    addLogLine,
    showNotice: showNekoIsland,
    appendActivityItem,
    formatDateTime,
    formatTimeOnly,
    config: configClient(),
    service: serviceClient(),
    system: systemClient(),
  });

  settingsPage()?.init?.({
    addLogLine,
    showNotice: showNekoIsland,
    applyThemeMode,
    applyExperimentalFeatureState,
    setExpandableSectionState,
    setConsoleStatus: (...args) => consoleRuntime?.setStatus?.(...args),
    formatBytes,
    config: configClient(),
    system: systemClient(),
  });

  uiLabPage()?.init?.({
    addLogLine,
    showNotice: showNekoIsland,
    applyExperimentalFeatureState,
    config: configClient(),
    loading: loadingSystem(),
    curves: loadingCurves(),
  });

  updatePage()?.init?.({
    addLogLine,
    showNotice: showNekoIsland,
    system: systemClient(),
    update: updateClient(),
    config: configClient(),
  });

  aboutPage()?.init?.({
    openExternal: (url) => callSystem('openExternal', 'openExternal', url),
  });

  activityPage()?.init?.({ showNotice: showNekoIsland });

  // ══════════════════════════════════════════════════════════════
  //  关键权限详情折叠切换
  // ══════════════════════════════════════════════════════════════
  function syncDeviceAuthExpandedState() {
    return ensureDeviceStatusPage()?.syncAuthExpandedState?.();
  }

  async function runPermissionDiagnosis() {
    const delegated = ensureDeviceStatusPage()?.runPermissionDiagnosis?.();
    if (delegated) return delegated;
    return { grantedCount: 0, totalPerm: 0, denied: 0, running: false };
  }

  /** 根据当前安装的版本号解析所属通道（徽章应反映实际安装版本，而非通道选择） */
  function getInstalledChannel(version) {
    const v = (version || '').toLowerCase();
    if (v.includes('-nightly')) return 'nightly';
    if (v.includes('-beta')) return 'beta';
    return 'stable';
  }
  function applyExperimentalFeatureState(cfg = {}) {
    const result = experimentalFeatures?.applyState?.(cfg);
    appearanceProfile?.applyConfig?.(cfg);
    loadingSystem()?.applyPreferences?.(cfg);
    uiLabPage()?.applyConfig?.(cfg);
    return result;
  }

  /** Render online changelog entries through UpdatePage. */
  function renderChangelogEntries(entries) {
    return updatePage()?.renderChangelogEntries?.(entries);
  }

  const appInitRuntime = window._nekoModules?.core?.AppInitRuntime?.create?.({
    runtimeVersions,
    consoleRuntime,
    addLogLine,
    showNotice: showNekoIsland,
    escapeHtml,
    applyServiceState,
    applyThemeMode,
    applyUIFontProfile,
    applyExperimentalFeatureState,
    setExpandableSectionState,
    setIncognitoScopeUI,
    syncDeviceAuthExpandedState,
    updateDashboardCards,
    updateDeviceStatusPage,
    updatePowerKpi,
    addDiagnosticEntry,
    renderChangelogEntries,
    getInstalledChannel,
    initTrendChart: _initTrendChart,
    dashboardPage,
    servicePage,
    updatePage,
    aboutPage,
    callConfig,
    callService,
    callSystem,
    callUpdate,
  });

  window._nekoModules?.core?.AppEventRuntime?.create?.({
    ipcClient,
    IPC_EVENTS,
    appInitRuntime,
    consoleRuntime,
    addLogLine,
    showNotice: showNekoIsland,
    applyServiceState,
    addDiagnosticEntry,
    updateDashboardCards,
    recordDashboardMetrics,
    updatePowerKpi,
    updateDeviceStatusPage,
    rebuildTrendChartDeferred: _rebuildTrendChartDeferred,
    applyDeviceStatusSparklineTheme,
    securityDialogs,
    updatePage,
    updateClient,
    callConfig,
    callSystem,
    callService,
  })?.bind?.();


  // ══════════════════════════════════════════════════════════════
  //  P2-8: 设备状态页面实时数据
  // ══════════════════════════════════════════════════════════════

  // 格式化字节数为人类可读
  // Auth page behavior lives in pages/auth.page.js.

  const authPage = () => window._nekoModules?.pages?.AuthPage || null;

  function ensureAuthPage() {
    const page = authPage();
    page?.init?.({
      callAuth,
      callConfig,
      callSystem,
      validateKey: () => callApi('validateKey', 'validateKey'),
      addLogLine,
      showNekoIsland,
      escapeHtml,
    });
    return page;
  }

  function openAuthModal(mode = 'login') {
    return ensureAuthPage()?.openAuthModal?.(mode);
  }

  ensureAuthPage();

  // Announcement page owns its management UI, popup polling, receipts, and nav visibility.
  function ensureAnnouncementPage() {
    const page = announcementPage();
    page?.init?.({
      showNotice: showNekoIsland,
    });
    page?.startRuntime?.();
    return page;
  }

  ensureAnnouncementPage();

    addLogLine('INFO', 'UI 后端连接初始化完成，等待主进程推送...');
  }

  window._nekoModules.core.AppRuntime = { start };
})();

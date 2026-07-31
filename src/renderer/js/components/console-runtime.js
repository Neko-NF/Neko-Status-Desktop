(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.components = window._nekoModules.components || {};

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : '--';
  }

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = n;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
  }

  function formatUptime(sec) {
    const total = Math.max(0, Number(sec) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function nowStr() {
    return new Date().toTimeString().slice(0, 8);
  }

  function create(deps = {}) {
    const {
      ipcClient = null,
      IPC_EVENTS = {},
      runtimeVersions = {},
      healthStats = { success: 0, total: 0 },
      callApi = () => Promise.reject(new Error('ApiClient is not ready')),
      callConfig = () => Promise.reject(new Error('ConfigClient is not ready')),
      callService = () => Promise.reject(new Error('ServiceClient is not ready')),
      callSystem = () => Promise.reject(new Error('SystemClient is not ready')),
      callUpdate = () => Promise.reject(new Error('UpdateClient is not ready')),
      callAnnouncement = () => Promise.reject(new Error('AnnouncementClient is not ready')),
      applyServiceState = () => {},
      triggerScreenshot = () => {},
      notify = () => {},
      replaceHandler = (_id, handler) => {
        const el = document.getElementById(_id);
        el?.addEventListener?.('click', handler);
      },
    } = deps;

    const consoleOutput = document.getElementById('consoleOutput');
    const consoleInput = document.getElementById('consoleInput');
    let currentLogFilter = 'ALL';
    let autoScroll = document.getElementById('consoleAutoScroll')?.checked !== false;
    let lastMetricsSnapshot = null;
    let lastTickSnapshot = null;

    function setConsoleStatus(slot, value, meta, state) {
      const valueEl = document.getElementById(`console${slot}Value`);
      const metaEl = document.getElementById(`console${slot}Meta`);
      if (valueEl) {
        valueEl.textContent = value ?? '--';
        valueEl.classList.remove('ok', 'warn', 'error');
        if (state) valueEl.classList.add(state);
      }
      if (metaEl && meta != null) metaEl.textContent = meta;
    }

    function updateServiceStatus(isRunning, serviceState = (isRunning ? 'running' : 'stopped')) {
      const labels = { running: 'Running', waiting_network: 'Waiting network', rate_limited: 'Rate limited', credential_invalid: 'Credential invalid', stopped: 'Stopped' };
      setConsoleStatus('Service', labels[serviceState] || serviceState, 'Reporter service', serviceState === 'running' ? 'ok' : serviceState === 'credential_invalid' ? 'error' : 'warn');
    }

    function updateUploadStatus() {
      const pct = healthStats.total > 0 ? (healthStats.success / healthStats.total * 100) : null;
      const state = pct == null ? '' : pct >= 99 ? 'ok' : pct >= 90 ? 'warn' : 'error';
      setConsoleStatus('Upload', pct == null ? '--' : `${pct.toFixed(1)}%`, `${healthStats.success}/${healthStats.total} successful`, state);
    }

    function updateMetricsStatus(m) {
      if (!m) return;
      const cpu = formatPercent(m.cpuPct);
      const mem = formatPercent(m.memPct);
      const state = Number(m.cpuPct) > 90 || Number(m.memPct) > 90 ? 'error' : Number(m.cpuPct) > 70 || Number(m.memPct) > 80 ? 'warn' : 'ok';
      setConsoleStatus('Metrics', `${cpu} / ${mem}`, 'CPU / Memory', state);
    }

    function updateTickStatus(data) {
      if (!data) return;
      lastTickSnapshot = data;
      const ok = data.success !== false;
      const ts = data.time || data.timestamp || Date.now();
      setConsoleStatus('Tick', ok ? 'OK' : 'Failed', new Date(ts).toLocaleTimeString(), ok ? 'ok' : 'error');
    }

    async function refreshStatus() {
      try {
        const [running, proc, cacheSize, metrics] = await Promise.all([
          callService('isRunning', 'isRunning').catch(() => false),
          callService('getProcessInfo', 'getProcessInfo').catch(() => null),
          callSystem('getCacheSize', 'getCacheSize').catch(() => 0),
          callSystem('getMetrics', 'getMetrics').catch(() => null),
        ]);
        setConsoleStatus('Runtime', proc ? `PID ${proc.pid}` : '--', proc ? `RSS ${proc.memoryMB} MB / up ${formatUptime(proc.uptimeSec)}` : 'Process unavailable', proc ? 'ok' : 'warn');
        updateServiceStatus(running);
        updateUploadStatus();
        setConsoleStatus('Cache', formatBytes(cacheSize), 'Local cache', Number(cacheSize) > 0 ? 'warn' : 'ok');
        if (metrics) {
          lastMetricsSnapshot = metrics;
          updateMetricsStatus(metrics);
        }
        updateTickStatus(lastTickSnapshot);
      } catch (e) {
        setConsoleStatus('Runtime', 'Error', e.message, 'error');
      }
    }

    function addLogLine(level, msg, time) {
      if (!consoleOutput) return;

      const timeStr = time ? new Date(time).toTimeString().slice(0, 8) : nowStr();
      const levelText = String(level || 'INFO').toUpperCase();
      const levelClass = levelText.toLowerCase();

      const line = document.createElement('div');
      line.className = 'log-line';
      line.dataset.level = levelText;
      line.innerHTML =
        `<span class="log-time">[${timeStr}]</span> ` +
        `<span class="log-level ${levelClass}">[${levelText}]</span> ` +
        `<span class="log-msg">${escapeHtml(msg)}</span>`;

      const show = currentLogFilter === 'ALL' || currentLogFilter === levelText;
      if (!show) line.style.display = 'none';

      consoleOutput.appendChild(line);
      if (autoScroll) consoleOutput.scrollTop = consoleOutput.scrollHeight;

      while (consoleOutput.children.length > 500) {
        consoleOutput.removeChild(consoleOutput.firstChild);
      }
    }

    function clearOutput() {
      if (consoleOutput) consoleOutput.innerHTML = '';
    }

    async function exportOutput() {
      if (!consoleOutput) return;
      const lines = Array.from(consoleOutput.querySelectorAll('.log-line'))
        .map((line) => line.textContent.trim())
        .filter(Boolean);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try {
        const result = await callSystem('saveTextFile', 'saveTextFile', {
          title: '导出控制台日志',
          defaultPath: `neko-console-${stamp}.log`,
          content: lines.join('\n') + '\n',
        });
        if (result?.success) addLogLine('SUCCESS', `日志已导出: ${result.path}`);
        else addLogLine('INFO', '已取消导出日志');
      } catch (e) {
        addLogLine('ERROR', `导出日志失败: ${e.message}`);
      }
    }

    const developerConsoleIpc = {
      getVersion: () => callSystem('getVersion', 'getVersion'),
      runHealthCheck: () => callService('runHealthCheck', 'runHealthCheck'),
      getMetrics: () => callSystem('getMetrics', 'getMetrics'),
      getCacheSize: () => callSystem('getCacheSize', 'getCacheSize'),
      clearCache: () => callSystem('clearCache', 'clearCache'),
      getLastResult: () => callService('getLastResult', 'getLastResult'),
      getAllConfig: () => callConfig('getAll', 'getAllConfig'),
      getConfig: (key) => callConfig('get', 'getConfig', key),
      setConfig: (key, value) => callConfig('set', 'setConfig', key, value),
      testConnection: (serverUrl) => callConfig('testConnection', 'testConnection', serverUrl),
      startService: () => callService('start', 'startService'),
      stopService: () => callService('stop', 'stopService'),
      restartService: () => callService('restart', 'restartService'),
      isRunning: () => callService('isRunning', 'isRunning'),
      checkUpdate: () => callUpdate('check', 'checkUpdate'),
      installUpdate: (filePath, expectedSha256, options) => callUpdate('install', 'installUpdate', filePath, expectedSha256, options),
      getPendingInstall: () => callUpdate('getPendingInstall', 'getPendingInstall'),
      checkIntegrity: () => callUpdate('checkIntegrity', 'checkIntegrity'),
      fetchAnnouncements: (options) => callAnnouncement('fetch', 'fetchAnnouncements', options),
      createAnnouncement: (payload) => callAnnouncement('create', 'createAnnouncement', payload),
      updateAnnouncement: (id, payload) => callAnnouncement('update', 'updateAnnouncement', id, payload),
      deleteAnnouncement: (id) => callAnnouncement('delete', 'deleteAnnouncement', id),
      recordAnnouncementReceipt: (id, action) => callAnnouncement('recordReceipt', 'recordAnnouncementReceipt', id, action),
    };

    async function getDeveloperBackendSnapshot(options = {}) {
      const includeNetwork = options.includeNetwork === true;
      const [version, serviceRunning, processInfo, metrics, cacheSize, config, pendingInstall, lastResult] = await Promise.all([
        callSystem('getVersion', 'getVersion').catch(() => null),
        callService('isRunning', 'isRunning').catch(() => false),
        callService('getProcessInfo', 'getProcessInfo').catch(() => null),
        callSystem('getMetrics', 'getMetrics').catch(() => null),
        callSystem('getCacheSize', 'getCacheSize').catch(() => 0),
        callConfig('getAll', 'getAllConfig').catch(() => ({})),
        callUpdate('getPendingInstall', 'getPendingInstall').catch(() => null),
        callService('getLastResult', 'getLastResult').catch(() => null),
      ]);
      const snapshot = {
        ipcReady: !!ipcClient?.isReady?.(),
        version,
        runtime: runtimeVersions,
        serviceRunning: !!serviceRunning,
        processInfo,
        metrics,
        cacheSize,
        lastResult,
        configMode: config?.serverMode || 'production',
        update: {
          channel: config?.updateChannel || 'stable',
          sourceMode: config?.updateSourceMode === 'smart' ? 'smart' : 'selected',
          activeSourceId: config?.activeUpdateSourceId || config?.updateSourceType || 'github-default',
          autoCheck: config?.autoCheckUpdate !== false,
          autoDownload: config?.autoDownload === true,
          pending: pendingInstall || null,
        },
        sampledAt: new Date().toISOString(),
      };
      if (includeNetwork) {
        const serverUrl = config?.serverMode === 'local' ? config.serverUrlLocal : config?.serverUrlProd;
        const apiProbe = callApi('testConnection', 'testConnection', serverUrl).catch((error) => ({
          ok: false,
          error: error.message,
        }));
        const timeoutProbe = new Promise((resolve) => {
          setTimeout(() => resolve({ ok: false, error: 'API 探测超时' }), 5000);
        });
        snapshot.api = await Promise.race([apiProbe, timeoutProbe]);
      }
      return snapshot;
    }

    const developerMode = window._nekoModules?.components?.DeveloperMode?.create?.({
      getConfig: (key) => callConfig('get', 'getConfig', key),
      setConfig: (key, value) => callConfig('set', 'setConfig', key, value),
      getBackendSnapshot: getDeveloperBackendSnapshot,
      runHealthCheck: () => callService('runHealthCheck', 'runHealthCheck'),
      runUpdateIntegrity: () => callUpdate('checkIntegrity', 'checkIntegrity'),
      clearCache: () => callSystem('clearCache', 'clearCache'),
      addLogLine,
      notify,
      openPanel: () => ipcClient?.invoke?.('openDeveloperModePanel'),
      closePanel: () => ipcClient?.invoke?.('closeDeveloperModePanel'),
      updatePanel: (payload) => ipcClient?.invoke?.('updateDeveloperModePanel', payload),
      onPanelCommand: (handler) => ipcClient?.on?.(IPC_EVENTS.DEV_MODE_PANEL_COMMAND, handler),
    });
    developerMode?.init?.();

    const developerConsole = window._nekoModules?.components?.DeveloperConsole?.createCommandRegistry?.({
      addLogLine,
      clearOutput,
      ipc: developerConsoleIpc,
      helpers: {
        applyServiceState,
        refreshConsoleStatus: refreshStatus,
        updateConsoleMetricsStatus: updateMetricsStatus,
        triggerScreenshot,
        setConsoleStatus,
        formatBytes,
        formatMetrics: (m) => `metrics cpu=${formatPercent(m?.cpuPct)} mem=${formatPercent(m?.memPct)} used=${formatBytes(m?.memUsed)} total=${formatBytes(m?.memTotal)}`,
        setLastMetricsSnapshot: (m) => { lastMetricsSnapshot = m; },
        getStatusSummary: () => `runtime=${document.getElementById('consoleRuntimeValue')?.textContent || '--'} service=${document.getElementById('consoleServiceValue')?.textContent || '--'} cache=${document.getElementById('consoleCacheValue')?.textContent || '--'}`,
      },
    });

    function handleConsoleCommand() {
      const cmd = consoleInput?.value?.trim();
      if (!cmd) return;
      addLogLine('INFO', `> ${cmd}`);
      consoleInput.value = '';
      if (!developerConsole) {
        addLogLine('ERROR', 'Developer console module is not loaded');
        return;
      }
      developerConsole.execute(cmd);
    }

    document.getElementById('consoleAutoScroll')?.addEventListener('change', (e) => {
      autoScroll = e.target.checked;
    });

    document.querySelectorAll('.console-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.console-filter').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentLogFilter = btn.dataset.level || 'ALL';
        consoleOutput?.querySelectorAll('.log-line').forEach((line) => {
          const show = currentLogFilter === 'ALL' || line.dataset.level === currentLogFilter;
          line.style.display = show ? '' : 'none';
        });
      });
    });

    replaceHandler('consoleClearBtn', clearOutput);
    replaceHandler('consoleExportBtn', exportOutput);
    document.getElementById('consoleSendBtn')?.addEventListener('click', handleConsoleCommand);
    consoleInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleConsoleCommand(); });

    return {
      addLogLine,
      clearOutput,
      escapeHtml,
      exportOutput,
      formatBytes,
      refreshStatus,
      setStatus: setConsoleStatus,
      setLastMetricsSnapshot: (m) => { lastMetricsSnapshot = m; },
      setLastTickSnapshot: (data) => { lastTickSnapshot = data; },
      updateMetricsStatus,
      updateServiceStatus,
      updateTickStatus,
      updateUploadStatus,
      updateScreenshotDebug: (data) => developerMode?.updateScreenshotDebug?.(data),
      getDeveloperBackendSnapshot,
      getLastMetricsSnapshot: () => lastMetricsSnapshot,
      getLastTickSnapshot: () => lastTickSnapshot,
    };
  }

  window._nekoModules.components.ConsoleRuntime = {
    create,
    escapeHtml,
    formatBytes,
    formatPercent,
    formatUptime,
  };
})();

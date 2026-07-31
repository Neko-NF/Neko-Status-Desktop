(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.core = window._nekoModules.core || {};

  function create(deps = {}) {
    const {
      ipcClient = null,
      IPC_EVENTS = {},
      appInitRuntime = null,
      consoleRuntime = null,
      addLogLine = () => {},
      showNotice = () => {},
      applyServiceState = () => {},
      addDiagnosticEntry = () => {},
      updateDashboardCards = () => {},
      recordDashboardMetrics = () => {},
      updatePowerKpi = () => {},
      updateDeviceStatusPage = () => {},
      rebuildTrendChartDeferred = () => {},
      applyDeviceStatusSparklineTheme = () => {},
      securityDialogs = null,
      updatePage = () => null,
      updateClient = () => null,
      callConfig = () => Promise.reject(new Error('ConfigClient is not ready')),
      callSystem = () => Promise.reject(new Error('SystemClient is not ready')),
      callService = () => Promise.reject(new Error('ServiceClient is not ready')),
    } = deps;

    function bindUpdateDialogActions() {
      const page = updatePage();
      page?.bindDialogActions?.({
        onClose: () => page.hideDialog?.(),
        onSkip: async (result) => {
          if (result?.latestVersion) {
            await (updateClient()?.setSkippedVersion?.(result.latestVersion) || callConfig('set', 'setConfig', 'skippedVersion', result.latestVersion));
            addLogLine('INFO', `已跳过版本 v${result.latestVersion}，下一版本发布前不再提醒`);
            showNotice(`已跳过 v${result.latestVersion}`, 'info', 3000);
          }
          page.hideDialog?.();
        },
        onInstall: async (result) => {
          if (!result) return;
          page.hideDialog?.();
          await (updateClient()?.setSkippedVersion?.('') || callConfig('set', 'setConfig', 'skippedVersion', ''));
          showNotice(`开始下载 v${result.latestVersion}...`, 'info', 3000);
          addLogLine('INFO', `用户确认更新 v${result.latestVersion}，开始下载`);
          page.downloadAndInstall?.(result);
        },
      });
    }

    function bindUpdateSeeAll() {
      document.querySelector('.update-see-all-btn')?.addEventListener('click', async () => {
        const cfg = await callConfig('getAll', 'getAllConfig') || {};
        const owner = cfg.githubOwner || 'Neko-NF';
        const repo = cfg.githubRepo || 'Neko-Status-Desktop';
        callSystem('openExternal', 'openExternal', `https://github.com/${owner}/${repo}/releases`);
      });
    }

    function bindUpdateEvents() {
      ipcClient.on(IPC_EVENTS.UPDATE_PROGRESS, (data) => {
        updatePage()?.updateProgress?.(data);
      });

      ipcClient.on(IPC_EVENTS.UPDATE_AUTO_DOWNLOADED, (data) => {
        updatePage()?.markAutoDownloaded?.(data);
        showNotice(`Update v${data.version} downloaded in background; it will install on next launch`, 'info', 6000);
        addLogLine('SUCCESS', `Background update v${data.version} downloaded; pending next launch install`);
      });

      ipcClient.on(IPC_EVENTS.UPDATE_FORCE_INSTALL_STARTED, (data) => {
        updatePage()?.markForceInstallStarted?.(data);
        showNotice(`Force update v${data.version} installer started; app will close soon`, 'warn', 6000);
        addLogLine('WARN', `Force update v${data.version} installer started`);
      });

      ipcClient.on(IPC_EVENTS.UPDATE_AUTO_DOWNLOAD_FAILED, (data) => {
        addLogLine('ERROR', `Background update v${data.version} download failed: ${data.error}`);
        showNotice(`Update v${data.version} background download failed; please check manually`, 'error', 5000);
      });

      ipcClient.on(IPC_EVENTS.UPDATE_AVAILABLE, (result) => {
        if (!result?.hasUpdate) return;
        updatePage()?.markAvailable?.(result);
        updatePage()?.renderReleaseNotes?.(result);
        addLogLine(result.forceUpdate ? 'WARN' : 'INFO', `${result.forceUpdate ? 'Force update available' : 'Background update available'}: v${result.latestVersion}`);
      });
    }

    function bindServiceEvents() {
      ipcClient.on(IPC_EVENTS.SERVICE_TICK, (data) => {
        if (data.serviceState) applyServiceState(data.serviceState !== 'stopped' && data.serviceState !== 'credential_invalid', data.serviceState);
        consoleRuntime?.setLastTickSnapshot?.(data);
        updateDashboardCards(data);
        consoleRuntime?.updateTickStatus?.(data);
        consoleRuntime?.updateScreenshotDebug?.(data);
        if (data.batteryLevel != null) {
          updatePowerKpi(data.batteryLevel, data.isCharging, data.hasBattery, null, {
            deviceType: data.deviceType,
            powerSource: data.powerSource,
          });
        }
      });

      ipcClient.on(IPC_EVENTS.SYSTEM_METRICS_UPDATE, (m) => {
        consoleRuntime?.setLastMetricsSnapshot?.(m);
        consoleRuntime?.updateMetricsStatus?.(m);
        updateDeviceStatusPage(m);
        recordDashboardMetrics(m);
      });

      ipcClient.on(IPC_EVENTS.SERVICE_STATUS_CHANGED, (data) => {
        applyServiceState(data.isRunning, data.serviceState);
        addDiagnosticEntry('守护进程', data.serviceState === 'credential_invalid' ? 'error' : 'success', `上报状态：${data.serviceState || (data.isRunning ? 'running' : 'stopped')}`);
        callService('syncMeta', 'syncMeta').catch(() => {});
      });

      ipcClient.on(IPC_EVENTS.LOG_ENTRY, (data) => {
        addLogLine(data.level, data.msg, data.time);
        const lvl = (data.level || '').toUpperCase();
        if (lvl === 'ERROR') {
          addDiagnosticEntry('服务日志', 'error', data.msg);
        } else if (lvl === 'WARN') {
          addDiagnosticEntry('服务日志', 'warn', data.msg);
        }
      });

      ipcClient.on(IPC_EVENTS.SERVICE_KEY_STATUS, (data) => {
        const { code, message } = data;
        if (code === 'KEY_REVOKED') {
          addLogLine('ERROR', `密钥已被撤销: ${message}`);
          addDiagnosticEntry('认证系统', 'error', `密钥已被撤销: ${message}`);
          applyServiceState(false);
          securityDialogs?.showWarning?.('密钥已被撤销', '当前设备密钥已被服务器撤销，上报服务已自动停止。可能原因：密钥在网页端被手动删除，或被其他设备接管。', message, true);
        } else if (code === 'DEVICE_NOT_FOUND') {
          addLogLine('ERROR', `设备已被删除: ${message}`);
          addDiagnosticEntry('认证系统', 'error', `设备已被删除: ${message}`);
          applyServiceState(false);
          securityDialogs?.showWarning?.('设备已从服务器删除', '该设备已被从服务器端移除，上报服务已自动停止。请重新配置密钥或登录账号重新生成。', message, true);
        } else if (code === 'TAKEOVER_SUCCESS') {
          addLogLine('WARN', `设备接管: ${message}`);
          addDiagnosticEntry('认证系统', 'warn', `设备接管: ${message}`);
          securityDialogs?.showWarning?.('设备接管已发生', '当前密钥已被新设备接管，该密钥之前绑定的上报数据已被服务器清除。如果这不是您的操作，请立即更换密钥。', message, true);
        }
      });
    }

    function bindThemeEvents() {
      document.addEventListener('neko:themeChange', () => {
        rebuildTrendChartDeferred();
        applyDeviceStatusSparklineTheme();
      });
      document.addEventListener('neko:appearanceChange', () => {
        rebuildTrendChartDeferred();
        applyDeviceStatusSparklineTheme();
      });
    }

    function bind() {
      if (!ipcClient?.on) return;
      bindUpdateDialogActions();
      bindUpdateSeeAll();
      bindUpdateEvents();
      ipcClient.on(IPC_EVENTS.APP_INIT, async (data) => {
        await appInitRuntime?.handle?.(data);
      });
      bindServiceEvents();
      bindThemeEvents();
    }

    return { bind };
  }

  window._nekoModules.core.AppEventRuntime = { create };
})();

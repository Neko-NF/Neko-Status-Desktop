(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.core = window._nekoModules.core || {};

  const SCALE_STEPS = Object.freeze([75, 90, 100, 110, 125, 150, 175, 200]);
  const RESTORABLE_PAGES = new Set([
    'mainDashboardArea',
    'consoleArea',
    'page-device-status',
    'page-screenshot',
    'page-services',
    'page-stream',
    'page-update',
    'page-about',
    'page-announcement',
  ]);

  function create(deps = {}) {
    const {
      runtimeVersions = {},
      consoleRuntime = null,
      addLogLine = () => {},
      showNotice = () => {},
      escapeHtml = (value) => String(value ?? ''),
      applyServiceState = () => {},
      applyThemeMode = () => {},
      applyUIFontProfile = () => {},
      applyExperimentalFeatureState = () => {},
      setExpandableSectionState = () => {},
      setIncognitoScopeUI = () => {},
      syncDeviceAuthExpandedState = () => {},
      updateDashboardCards = () => {},
      updateDeviceStatusPage = () => {},
      updatePowerKpi = () => {},
      addDiagnosticEntry = () => {},
      renderChangelogEntries = () => {},
      getInstalledChannel = () => 'stable',
      initTrendChart = () => {},
      dashboardPage = () => null,
      servicePage = () => null,
      updatePage = () => null,
      aboutPage = () => null,
      callConfig = () => Promise.reject(new Error('ConfigClient is not ready')),
      callService = () => Promise.reject(new Error('ServiceClient is not ready')),
      callSystem = () => Promise.reject(new Error('SystemClient is not ready')),
      callUpdate = () => Promise.reject(new Error('UpdateClient is not ready')),
    } = deps;

    function syncDeviceBadge(data) {
      const badge = document.querySelector('.device-badge');
      if (!badge || !data.deviceName) return;
      badge.innerHTML = `<div class="status-dot" id="deviceStatusDot"></div>${escapeHtml(data.deviceName)}`;
      applyServiceState(data.isRunning);
    }

    function bindUpdateSourceControls(cfg) {
      updatePage()?.bindSourceControls?.({
        getAllConfig: () => callConfig('getAll', 'getAllConfig'),
        setConfig: (key, value) => callConfig('set', 'setConfig', key, value),
        setManyConfig: (payload) => callConfig('setMany', 'setManyConfig', payload),
        addLogLine,
        checkUpdate: () => callUpdate('check', 'checkUpdate'),
      });
      updatePage()?.renderSources?.(cfg || {});
    }

    async function syncPendingInstall() {
      try {
        const pending = await callUpdate('getPendingInstall', 'getPendingInstall');
        if (pending && pending.hasPending) {
          showNotice(
            `发现已预下载的更新 v${pending.version}，点击「立即安装」完成更新`,
            'info',
            0
          );
          addLogLine('INFO', `检测到待安装更新 v${pending.version}，已在后台下载完成`);
          updatePage()?.setPendingInstall?.(pending.version);
        }
      } catch (e) {
        console.warn('[Init] 检查待安装更新失败:', e.message);
      }
    }

    async function syncLastServiceResult() {
      try {
        const lastResult = await callService('getLastResult', 'getLastResult');
        if (!lastResult) return;
        consoleRuntime?.setLastTickSnapshot?.(lastResult);
        updateDashboardCards(lastResult, { recordHealth: false });
        consoleRuntime?.updateTickStatus?.(lastResult);
      } catch {}
    }

    async function syncAutoStart() {
      const autoStartEnabled = await callService('isAutoStartEnabled', 'isAutoStartEnabled');
      servicePage()?.syncAutoStartToggles?.(autoStartEnabled);
    }

    function syncScreenshotSwitches(cfg) {
      if (cfg.enableScreenshot === undefined) return;
      ['toggleScreenshot', 'uploadSwitch'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('on', cfg.enableScreenshot);
      });
    }

    async function syncSettingSwitches(cfg) {
      const traySwitch = document.getElementById('stgTraySwitch');
      if (traySwitch) traySwitch.classList.toggle('on', cfg.closeAction === 'minimize');

      const restoreSwitch = document.getElementById('stgRestoreSwitch');
      if (restoreSwitch) restoreSwitch.classList.toggle('on', !!cfg.restoreLastState);

      const autoDownloadSwitch = document.getElementById('stgAutoDownloadSwitch');
      if (autoDownloadSwitch) autoDownloadSwitch.classList.toggle('on', !!cfg.autoDownload);

      const reportMode = cfg.reportIntervalMode || 'auto';
      document.querySelectorAll('#stgReportModeGroup .toggle-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === reportMode);
      });
      const customRow = document.getElementById('stgCustomIntervalRow');
      setExpandableSectionState(customRow, reportMode === 'custom', { display: 'flex' });
      const stgIntervalInput = document.getElementById('stgReportIntervalInput');
      if (stgIntervalInput) stgIntervalInput.value = cfg.reportInterval || 10;
      const stgIntervalDesc = document.getElementById('stgReportIntervalDesc');
      if (stgIntervalDesc) {
        stgIntervalDesc.textContent = reportMode === 'auto'
          ? '自动模式: 每 10s 自动上报'
          : `自定义模式: 每 ${cfg.reportInterval || 10}s 上报`;
      }

      const quickInput = document.getElementById('quickIntervalInput');
      const quickLabel = document.getElementById('quickIntervalLabel');
      const quickStepper = document.getElementById('quickIntervalStepper');
      if (quickInput) quickInput.value = cfg.reportInterval || 10;
      const quickHint = document.getElementById('quickIntervalHint');
      if (reportMode === 'auto') {
        if (quickLabel) quickLabel.textContent = '自动';
        setExpandableSectionState(quickStepper, false, { display: 'flex' });
        setExpandableSectionState(quickHint, true, { display: 'block' });
      } else {
        if (quickLabel) quickLabel.textContent = `${cfg.reportInterval || 10}s · 自定义`;
        setExpandableSectionState(quickStepper, true, { display: 'flex' });
        setExpandableSectionState(quickHint, false, { display: 'block' });
      }

      const syncSwitch = document.getElementById('stgSyncScreenshotSwitch');
      if (syncSwitch) syncSwitch.classList.toggle('on', cfg.syncScreenshotInterval !== false);
      const hintValEl = document.getElementById('intervalAutoHintValue');
      if (hintValEl) hintValEl.textContent = cfg.reportInterval || 10;

      const notifySwitch = document.getElementById('stgNotifySwitch');
      if (notifySwitch) notifySwitch.classList.toggle('on', cfg.enableNotification !== false);

      const dndSwitch = document.getElementById('stgDndSwitch');
      try {
        const fa = await callSystem('getFocusAssist', 'getFocusAssist');
        const winDnd = fa && fa.ok ? fa.enabled : !!cfg.doNotDisturb;
        if (dndSwitch) dndSwitch.classList.toggle('on', winDnd);
        if (winDnd !== !!cfg.doNotDisturb) await callConfig('set', 'setConfig', 'doNotDisturb', winDnd);
        if (winDnd && notifySwitch) {
          notifySwitch.classList.remove('on');
          if (cfg.enableNotification !== false) await callConfig('set', 'setConfig', 'enableNotification', false);
        }
      } catch {}

      const incognitoSwitch = document.getElementById('stgIncognitoSwitch');
      if (incognitoSwitch) incognitoSwitch.classList.toggle('on', !!cfg.enableIncognito);
      setIncognitoScopeUI(cfg.incognitoScope || 'screenshot');

      const blurAllSwitch = document.getElementById('blurAllSwitch');
      if (blurAllSwitch) blurAllSwitch.classList.toggle('on', !!cfg.blurAllScreenshots);

      if (cfg.privacyRules && Array.isArray(cfg.privacyRules)) {
        localStorage.setItem('neko_privacy_rules', JSON.stringify(cfg.privacyRules));
        document.dispatchEvent(new CustomEvent('neko:privacy-rules-loaded'));
      }

      setTimeout(() => {
        const privacyRulesBtn = document.getElementById('openPrivacyRulesBtn');
        if (privacyRulesBtn) privacyRulesBtn.style.display = '';
        const privacyBarCard = document.querySelector('.privacy-bar-card');
        if (privacyBarCard) privacyBarCard.classList.toggle('disabled', !cfg.enableIncognito);
        const privacyBarTitle = document.getElementById('privacyBarTitle');
        const privacyBarDesc = document.getElementById('privacyBarDesc');
        const privacyBarIcon = document.getElementById('privacyBarIcon');
        if (privacyBarTitle) privacyBarTitle.textContent = cfg.enableIncognito ? '隐私防护已启用' : '隐私防护未启用';
        if (privacyBarDesc) privacyBarDesc.textContent = cfg.enableIncognito
          ? '匹配隐私规则的前台应用截图将自动模糊后再上传，截图仅上传至已配置的自有服务器。'
          : '隐身模式未开启，截图将正常上传。开启隐身模式后可配置隐私规则。';
        if (privacyBarIcon) privacyBarIcon.innerHTML = cfg.enableIncognito
          ? '<i class="ph ph-shield-check"></i>'
          : '<i class="ph ph-shield-slash"></i>';
        window._nekoActivityHelpers?.syncPrivacyBar?.();
      }, 50);

      const twoFASwitch = document.getElementById('stg2FASwitch');
      if (twoFASwitch) twoFASwitch.classList.toggle('on', !!cfg.enable2FA);

      const glassSwitch = document.getElementById('stgGlassSwitch');
      if (glassSwitch) glassSwitch.classList.toggle('on', cfg.glassEffect !== false);
    }

    function syncTheme(cfg) {
      const isDark = (cfg.themeMode === 'dark') || (cfg.themeMode === 'auto');
      const isSchedule = (cfg.themeMode === 'auto');
      const darkSwitch = document.getElementById('stgDarkSwitch');
      const darkSched = document.getElementById('stgDarkScheduleSwitch');
      const darkTimeRow = document.getElementById('stgDarkTimeRow');
      if (darkSwitch) darkSwitch.classList.toggle('on', isDark);
      if (darkSched) darkSched.classList.toggle('on', isSchedule);
      setExpandableSectionState(darkTimeRow, isSchedule, { display: 'flex' });
      const darkStart = document.getElementById('stgDarkStartTime');
      const darkEnd = document.getElementById('stgDarkEndTime');
      if (darkStart) darkStart.value = cfg.darkModeStart || '18:00';
      if (darkEnd) darkEnd.value = cfg.darkModeEnd || '07:00';
      applyThemeMode(cfg.themeMode || 'light', cfg.darkModeStart || '18:00', cfg.darkModeEnd || '07:00');
    }

    function syncScreenshotMode(cfg) {
      const ssMode = cfg.screenshotMode || 'auto';
      const ssModeGroup = document.getElementById('screenshotModeGroup');
      if (ssModeGroup) {
        ssModeGroup.querySelectorAll('.toggle-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.mode === ssMode);
        });
      }
    }

    function syncUiScale(cfg) {
      const idx = SCALE_STEPS.indexOf(cfg.uiScale || 100);
      const scaleIdx = idx >= 0 ? idx : SCALE_STEPS.indexOf(100);
      const scaleLabel = document.getElementById('stgScaleLabel');
      const scaleDown = document.getElementById('stgScaleDown');
      const scaleUp = document.getElementById('stgScaleUp');
      if (scaleLabel) scaleLabel.textContent = `${SCALE_STEPS[scaleIdx]}%`;
      if (scaleDown) scaleDown.disabled = scaleIdx <= 0;
      if (scaleUp) scaleUp.disabled = scaleIdx >= SCALE_STEPS.length - 1;
    }

    function syncUiFont(cfg) {
      localStorage.setItem('neko-ui-font', cfg.uiFont || '');
      if (cfg.uiFont) document.documentElement.style.setProperty('--ui-font', `"${cfg.uiFont}"`);
      else document.documentElement.style.removeProperty('--ui-font');
      applyUIFontProfile(cfg.uiFont || '');
      const stgFontSel = document.getElementById('stgFontSelect');
      if (stgFontSel) stgFontSel.value = cfg.uiFont || '';
    }

    function syncSeedColor(cfg) {
      if (!cfg.seedColor) return;
      document.documentElement.style.setProperty('--theme-color', cfg.seedColor);
      localStorage.setItem('neko-theme-color', cfg.seedColor);
      const builtinSwatches = document.querySelectorAll('.settings-swatch, .color-swatch[data-color]');
      let matchedBuiltin = false;
      builtinSwatches.forEach((s) => {
        const isMatch = s.dataset.color === cfg.seedColor;
        s.classList.toggle('active', isMatch);
        if (isMatch) matchedBuiltin = true;
      });
      [
        document.getElementById('stgCustomColorBtn'),
        document.getElementById('topCustomColorBtn'),
      ].filter(Boolean).forEach((customBtn) => {
        customBtn.classList.toggle('active', !matchedBuiltin);
        customBtn.style.setProperty('--custom-swatch-color', cfg.customSeedColor || cfg.seedColor);
      });
      if (cfg.customSeedColor) {
        localStorage.setItem('neko-custom-theme-color', cfg.customSeedColor);
        const cInput = document.getElementById('stgCustomColorInput');
        const cHex = document.getElementById('stgCustomColorHex');
        const cPrev = document.getElementById('stgCustomColorPreview');
        if (cInput) cInput.value = cfg.customSeedColor;
        if (cHex) cHex.value = cfg.customSeedColor.toUpperCase();
        if (cPrev) cPrev.style.background = cfg.customSeedColor;
      }
    }

    async function syncCacheSize() {
      try {
        const cacheSize = await callSystem('getCacheSize', 'getCacheSize');
        const cacheSizeMB = (cacheSize / 1024 / 1024).toFixed(1);
        const cacheDesc = document.getElementById('cacheSizeDesc');
        if (cacheDesc) cacheDesc.textContent = `会话缓存（图片、脚本等）· 当前 ${cacheSizeMB} MB`;
      } catch {}
    }

    function syncScaleDescription() {
      const scaleDesc = document.getElementById('stgScaleDesc');
      if (!scaleDesc) return;
      const dpr = window.devicePixelRatio || 1;
      scaleDesc.textContent = dpr >= 2
        ? `建议 ≥150%（当前屏幕 DPI×${dpr}）`
        : '高清屏可调至 150%–200%';
    }

    function syncServerDescription(cfg) {
      const serverDesc = document.querySelector('#stgConfigBtn')?.closest('.settings-row')?.querySelector('.settings-row-desc');
      if (!serverDesc) return;
      const mode = cfg.serverMode || 'production';
      const url = mode === 'local' ? (cfg.serverUrlLocal || '127.0.0.1:3000') : (cfg.serverUrlProd || 'nf.koirin.com');
      serverDesc.textContent = url.replace(/^https?:\/\//, '');
    }

    async function applyZoom(cfg) {
      if (cfg.uiScale && cfg.uiScale !== 100) {
        await callSystem('setZoom', 'setZoom', cfg.uiScale / 100);
      }
    }

    function restoreLastPage(cfg) {
      if (!cfg.restoreLastState || !cfg.lastPage || !RESTORABLE_PAGES.has(cfg.lastPage)) return;
      if (!cfg.enableExperimentalFeatures && cfg.lastPage === 'page-stream') return;
      const navItem = document.querySelector(`.nav-item[data-target="${cfg.lastPage}"]`);
      if (navItem?.getAttribute?.('aria-hidden') === 'true') return;
      if (navItem?.classList.contains('conditional-nav') && !navItem.classList.contains('show')) return;
      if (navItem?.classList.contains('console-nav') && !navItem.classList.contains('show')) return;
      if (navItem) navItem.click();
    }

    function syncUpdatePage(data, cfg) {
      updatePage()?.syncChannel?.(cfg.updateChannel || 'stable');
      updatePage()?.syncInstalledVersion?.({ version: data.version, cfg, runtimeVersions });
      const navUpdateItem = document.querySelector('.nav-item[data-target="page-update"]');
      if (navUpdateItem) {
        navUpdateItem.addEventListener('click', () => navUpdateItem.classList.remove('has-update'));
      }
      updatePage()?.renderSources?.(cfg || {});
      callUpdate('getChangelog', 'getChangelog').then((entries) => {
        if (entries && entries.length > 0) {
          renderChangelogEntries(entries);
        } else {
          renderChangelogEntries([{ version: data.version, date: '', notes: '', isPreRelease: getInstalledChannel(data.version) !== 'stable', isCurrent: true }]);
        }
      }).catch(() => {});
    }

    function loadMetricsHistory() {
      callSystem('getMetricsHistory', 'getMetricsHistory').then((history) => {
        if (history && history.length) dashboardPage()?.setMetricsHistory?.(history);
        else initTrendChart();
      }).catch(() => initTrendChart());
    }

    async function syncDeviceStatus(data, cfg) {
      try {
        const metrics = await callSystem('getMetrics', 'getMetrics');
        updateDeviceStatusPage(metrics);

        try {
          const fp = await callSystem('getFingerprint', 'getFingerprint');
          const fpEl = document.getElementById('metaFingerprint');
          if (fpEl && fp) fpEl.textContent = `${fp.substring(0, 16)}…`;
          if (fpEl && fp) fpEl.title = fp;
        } catch {}

        const metaProcEl = document.getElementById('metaProcess');
        if (metaProcEl && data.processName) {
          metaProcEl.innerHTML = `${escapeHtml(data.processName)} <span class="meta-pid">PID ${data.pid}</span> <span class="status-dot info"></span>`;
        }
        const metaPrivEl = document.getElementById('metaPrivilege');
        if (metaPrivEl) {
          metaPrivEl.innerHTML = data.isAdmin
            ? '<span class="privilege-tag success">管理员</span><span class="privilege-tag success">后台常驻</span>'
            : '<span class="privilege-tag warn">普通用户</span><span class="privilege-tag success">后台常驻</span>';
        }

        await syncPermissionSummary(data, cfg);

        const bat = await callSystem('getBattery', 'getBattery');
        updatePowerKpi(
          bat.level,
          bat.isCharging,
          bat.hasBattery,
          bat.hasBattery === false ? '台式机 / 外接电源 · 无电池读数' : null,
          { deviceType: bat.deviceType, powerSource: bat.powerSource }
        );
        updateDashboardCards({
          batteryLevel: bat.hasBattery === false ? 100 : bat.level,
          isCharging: bat.isCharging,
          hasBattery: bat.hasBattery,
          deviceType: bat.deviceType,
          powerSource: bat.powerSource,
        });
      } catch {}
    }

    async function syncPermissionSummary(data, cfg) {
      try {
        const perms = await callService('checkPermissions', 'checkPermissions');
        const permUI = {
          metaAuthScreenCapture: perms.screenCapture,
          metaAuthProcessEnum: perms.processEnum,
          metaAuthPowerControl: perms.powerControl,
          metaAuthNetwork: perms.network,
          metaAuthFileIO: perms.fileIO,
        };
        const permNameMap = {
          metaAuthScreenCapture: '屏幕捕获',
          metaAuthProcessEnum: '进程遍历',
          metaAuthPowerControl: '电源控制',
          metaAuthNetwork: '网络访问',
          metaAuthFileIO: '文件读写',
        };
        let grantedCount = 0;
        const deniedNames = [];
        const totalPerm = Object.keys(permUI).length + 1;
        for (const [elId, status] of Object.entries(permUI)) {
          const el = document.getElementById(elId);
          if (!el) continue;
          const icon = el.querySelector('i');
          if (!icon) continue;
          if (status === 'granted') {
            icon.className = 'ph ph-check-circle text-theme';
            el.classList.add('granted');
            grantedCount++;
          } else {
            icon.className = 'ph ph-x-circle text-error';
            el.classList.remove('granted');
            deniedNames.push(permNameMap[elId] || elId);
          }
        }

        try {
          const autoStartEl = document.getElementById('metaAuthAutoStart');
          const icon = autoStartEl?.querySelector?.('i');
          if (icon) {
            if (data.isAutoStart) {
              icon.className = 'ph ph-check-circle text-theme';
              autoStartEl.classList.add('granted');
              grantedCount++;
            } else {
              icon.className = 'ph ph-warning text-warn';
              autoStartEl.classList.remove('granted');
              deniedNames.push('开机自启');
            }
          }
        } catch {}

        const countEl = document.getElementById('authGrantedCount');
        const denied = totalPerm - grantedCount;
        if (countEl) {
          if (denied === 0) {
            countEl.textContent = '已全部授权';
            countEl.className = 'auth-count-ok';
          } else {
            countEl.textContent = `${denied}项未授权`;
            countEl.className = 'auth-count-warn';
          }
        }

        const authList = document.getElementById('metaAuthList');
        const collapseIcon = document.getElementById('authCollapseIcon');
        if (grantedCount >= totalPerm || cfg.authListCollapsed !== false) {
          if (authList) authList.classList.add('collapsed');
          if (collapseIcon) collapseIcon.classList.add('collapsed');
        } else {
          if (authList) authList.classList.remove('collapsed');
          if (collapseIcon) collapseIcon.classList.remove('collapsed');
        }
        requestAnimationFrame(syncDeviceAuthExpandedState);

        const ratingBadge = document.querySelector('.rating-badge');
        if (ratingBadge) {
          if (grantedCount >= totalPerm) ratingBadge.textContent = '评级: S';
          else if (grantedCount >= totalPerm - 1) ratingBadge.textContent = '评级: A';
          else if (grantedCount >= totalPerm - 2) ratingBadge.textContent = '评级: B';
          else ratingBadge.textContent = '评级: C';
        }
        const permDescEl = document.getElementById('dashPermDesc');
        if (permDescEl) {
          permDescEl.textContent = denied === 0
            ? '所需权限（开机自启、屏幕捕获、进程读取、网络隧道）均已授予并检测通过。'
            : `有 ${denied} 项权限未授权，可能影响部分功能。点击下方按钮重新诊断。`;
        }
        const deniedListEl = document.getElementById('dashDeniedList');
        const deniedItemsEl = document.getElementById('dashDeniedItems');
        if (deniedListEl && deniedItemsEl) {
          if (denied > 0) {
            const displayNames = deniedNames.length > 3
              ? deniedNames.slice(0, 3).concat(`+${deniedNames.length - 3} 项`)
              : deniedNames;
            deniedItemsEl.innerHTML = displayNames.map((n) =>
              `<span class="denied-tag">${escapeHtml(n)}</span>`
            ).join('');
            deniedListEl.style.display = '';
          } else {
            deniedListEl.style.display = 'none';
          }
        }
      } catch {}
    }

    function syncDiagnostics(data) {
      const historyBody = document.getElementById('historyTableBody');
      if (historyBody) historyBody.innerHTML = '';
      addDiagnosticEntry('守护进程', 'success', `Neko Status v${data.version} 初始化完成 (PID ${data.pid})`);
      if (data.isRunning) addDiagnosticEntry('上报服务', 'success', '上报服务正在运行');
      if (data.isAutoStart) addDiagnosticEntry('系统权限', 'success', '开机自启已启用');
      if (data.isAdmin) addDiagnosticEntry('系统权限', 'success', '以管理员权限运行');
      else addDiagnosticEntry('系统权限', 'warn', '以普通用户权限运行，部分功能可能受限');
    }

    async function handle(data = {}) {
      const cfg = data.config || {};
      consoleRuntime?.refreshStatus?.();
      addLogLine('INFO', `Neko Status v${data.version} 初始化完成`);
      addLogLine('INFO', `设备: ${data.deviceName} | 平台: ${data.platform}`);

      applyServiceState(data.isRunning);
      await syncLastServiceResult();
      await syncPendingInstall();
      syncDeviceBadge(data);
      bindUpdateSourceControls(cfg);
      await syncAutoStart();
      syncScreenshotSwitches(cfg);
      await syncSettingSwitches(cfg);
      syncTheme(cfg);
      servicePage()?.initFromAppInit?.(data);
      syncScreenshotMode(cfg);
      syncUiScale(cfg);
      syncUiFont(cfg);
      syncSeedColor(cfg);
      applyExperimentalFeatureState(cfg);
      if (cfg.dashboardLayout && Array.isArray(cfg.dashboardLayout) && cfg.dashboardLayout.length && typeof window.loadLayoutConfig === 'function') {
        window.loadLayoutConfig(cfg.dashboardLayout);
      }
      if (cfg.glassEffect === false) document.documentElement.classList.add('no-glass');
      await syncCacheSize();
      syncScaleDescription();
      syncServerDescription(cfg);
      await applyZoom(cfg);
      restoreLastPage(cfg);
      syncUpdatePage(data, cfg);
      loadMetricsHistory();
      aboutPage()?.sync?.({ version: data.version, cfg, runtimeVersions });
      await syncDeviceStatus(data, cfg);
      syncDiagnostics(data);
      if (cfg.deviceKey) {
        callService('syncMeta', 'syncMeta').catch(() => {});
      }
    }

    return { handle };
  }

  window._nekoModules.core.AppInitRuntime = { create };
})();

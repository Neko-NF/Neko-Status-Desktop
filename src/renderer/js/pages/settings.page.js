(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const $ = (id) => document.getElementById(id);
  const SCALE_STEPS = [75, 90, 100, 110, 125, 150, 175, 200];

  function getConfigClient() {
    return window._nekoModules?.services?.ConfigClient || null;
  }

  function getSystemClient() {
    return window._nekoModules?.services?.SystemClient || null;
  }

  function defaultDeps() {
    return {
      addLogLine: () => {},
      showNotice: () => {},
      applyThemeMode: () => {},
      applyExperimentalFeatureState: () => {},
      setExpandableSectionState: window._nekoUIHelpers?.setExpandableSectionState || (() => {}),
      setIncognitoScopeUI: () => {},
      setConsoleStatus: () => {},
      formatBytes: (bytes) => `${bytes || 0} B`,
      config: getConfigClient(),
      system: getSystemClient(),
    };
  }

  function applySavedFontProfile() {
    const savedFont = localStorage.getItem('neko-ui-font') || '';
    if (savedFont) {
      document.documentElement.style.setProperty('--ui-font', `"${savedFont}"`);
    } else {
      document.documentElement.style.removeProperty('--ui-font');
    }
    window._nekoUIHelpers?.applyUIFontProfile?.(savedFont);
    return savedFont;
  }

  function applyFont(font) {
    if (font) {
      document.documentElement.style.setProperty('--ui-font', `"${font}"`);
    } else {
      document.documentElement.style.removeProperty('--ui-font');
    }
    window._nekoUIHelpers?.applyUIFontProfile?.(font);
    localStorage.setItem('neko-ui-font', font);
    const savePromise = getConfigClient()?.set?.('uiFont', font);
    if (savePromise?.catch) savePromise.catch(() => {});
  }

  async function loadFontOptions(select) {
    select.innerHTML = '<option value="">系统默认</option>';
    let fonts = [];
    try {
      const client = getSystemClient();
      fonts = client?.isReady?.() ? await client.getFonts() : [];
    } catch {}
    [...new Set(fonts || [])]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        opt.style.fontFamily = name;
        select.appendChild(opt);
      });
    select.value = localStorage.getItem('neko-ui-font') || '';
  }

  const SettingsPage = {
    _inited: false,
    _actionsBound: false,
    _experimentalDelegated: false,
    _dndPollStarted: false,
    _dndUserAction: false,
    _deps: defaultDeps(),

    init(deps = {}) {
      this._deps = { ...this._deps, ...deps };
      if (this._inited) {
        this.bindBackendControls();
        return;
      }
      this._inited = true;
      this.bindEvents();
      this.bindBackendControls();
    },

    bindEvents() {
      const fontSelect = $('stgFontSelect');
      if (!fontSelect) return;

      applySavedFontProfile();
      loadFontOptions(fontSelect);
      fontSelect.addEventListener('change', () => {
        applyFont(fontSelect.value);
      });
    },

    config() {
      return this._deps.config || getConfigClient();
    },

    system() {
      return this._deps.system || getSystemClient();
    },

    log(level, message) {
      this._deps.addLogLine(level, message);
    },

    notice(message, type = 'info', duration = 2000) {
      this._deps.showNotice(message, type, duration);
    },

    async handleExperimentalSwitchClick(switchEl, key, label) {
      if (!switchEl || switchEl.classList.contains('loading')) return;
      const next = !switchEl.classList.contains('on');
      const currentConfig = {
        enableExperimentalFeatures: $('stgExperimentalSwitch')?.classList.contains('on') === true,
        enableExperimentalActivityEntry: $('stgExperimentalActivitySwitch')?.classList.contains('on') === true,
        enableExperimentalStreamEntry: $('stgExperimentalStreamSwitch')?.classList.contains('on') === true,
        enableExperimentalUiLabEntry: $('stgExperimentalUiLabSwitch')?.classList.contains('on') === true,
      };
      switchEl.classList.toggle('on', next);
      switchEl.classList.add('loading');
      try {
        let payload = null;
        if (key === 'enableExperimentalFeatures' && next === false) {
          payload = {
              enableExperimentalFeatures: false,
              enableExperimentalActivityEntry: false,
              enableExperimentalStreamEntry: false,
              enableExperimentalUiLabEntry: false,
              enableExperimentalCurveLoaders: false,
              enableActivityFeature: false,
              enableActivityPublishing: false,
              enableActivityBackground: false,
            };
        } else if (key === 'enableExperimentalActivityEntry' && next === false) {
          payload = {
            enableExperimentalActivityEntry: false,
            enableActivityFeature: false,
            enableActivityPublishing: false,
            enableActivityBackground: false,
          };
        }
        this._deps.applyExperimentalFeatureState({
          ...currentConfig,
          ...(payload || { [key]: next }),
        });
        const saved = payload
          ? await this.config()?.setMany?.(payload)
          : await this.config()?.set?.(key, next);
        if (saved && saved.ok === false) throw new Error(saved.error || saved.message || '保存失败');
        const cfg = await this.config()?.getAll?.();
        this._deps.applyExperimentalFeatureState(cfg || { [key]: next });
        this.log('INFO', `${label} -> ${next ? '已开启' : '已关闭'}`);
      } catch (error) {
        switchEl.classList.toggle('on', !next);
        this.notice(error.message || `${label}保存失败`, 'error');
        let cfg = null;
        try { cfg = await this.config()?.getAll?.(); } catch {}
        if (cfg) this._deps.applyExperimentalFeatureState(cfg);
      } finally {
        switchEl.classList.remove('loading');
      }
    },

    bindExperimentalSwitchDelegation() {
      if (this._experimentalDelegated) return;
      this._experimentalDelegated = true;
      const metaById = {
        stgExperimentalSwitch: ['enableExperimentalFeatures', '实验性内容'],
        stgExperimentalActivitySwitch: ['enableExperimentalActivityEntry', '关注动态入口'],
        stgExperimentalStreamSwitch: ['enableExperimentalStreamEntry', '直播推流入口'],
        stgExperimentalUiLabSwitch: ['enableExperimentalUiLabEntry', 'UI 实验室入口'],
      };
      document.addEventListener?.('click', (event) => {
        const switchEl = event.target.closest?.('#stgExperimentalSwitch, #stgExperimentalActivitySwitch, #stgExperimentalStreamSwitch, #stgExperimentalUiLabSwitch');
        const meta = switchEl ? metaById[switchEl.id] : null;
        if (!meta) return;
        event.preventDefault();
        event.stopPropagation();
        this.handleExperimentalSwitchClick(switchEl, meta[0], meta[1]);
      }, true);
    },

    bindBackendControls() {
      if (this._actionsBound) return;
      if (!this.config() && !this.system()) return;
      this._actionsBound = true;

      $('stgTraySwitch')?.addEventListener('click', async function handleTraySwitch() {
        const isOn = this.classList.contains('on');
        await SettingsPage.config()?.set?.('closeAction', isOn ? 'minimize' : 'ask');
        SettingsPage.log('INFO', `关闭行为 -> ${isOn ? '最小化到托盘' : '每次询问'}`);
      });

      $('stgRestoreSwitch')?.addEventListener('click', async function handleRestoreSwitch() {
        await SettingsPage.config()?.set?.('restoreLastState', this.classList.contains('on'));
      });

      $('stgAutoDownloadSwitch')?.addEventListener('click', async function handleAutoDownloadSwitch() {
        const isOn = this.classList.contains('on');
        await SettingsPage.config()?.set?.('autoDownload', isOn);
        SettingsPage.log('INFO', `自动下载更新 -> ${isOn ? '开启（后台静默下载，下次启动时安装）' : '已关闭'}`);
      });

      this.bindExperimentalSwitchDelegation();

      $('openExperimentalSettingsBtn')?.addEventListener('click', () => {
        document.querySelector('.nav-item[data-target="page-settings"]')?.click();
        setTimeout(() => $('settings-experimental')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
      });

      $('stgReportModeGroup')?.addEventListener('click', (event) => this.handleReportModeClick(event));
      $('stgSaveIntervalBtn')?.addEventListener('click', () => this.saveCustomReportInterval());
      $('stgSyncScreenshotSwitch')?.addEventListener('click', async function handleScreenshotSync() {
        const isOn = this.classList.contains('on');
        await SettingsPage.config()?.set?.('syncScreenshotInterval', isOn);
        const targetMode = isOn ? 'auto' : 'interval';
        const modeGroup = $('screenshotModeGroup');
        if (modeGroup) {
          await SettingsPage.config()?.set?.('screenshotMode', targetMode);
          modeGroup.querySelectorAll('.toggle-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.mode === targetMode);
          });
        }
        SettingsPage.log('INFO', `截图间隔同步 -> ${isOn ? '已启用 (跟随上报)' : '已关闭 (独立间隔)'}`);
      });

      $('quickIntervalCard')?.addEventListener('click', (event) => this.openReportIntervalSettings(event));
      $('quickIntervalDown')?.addEventListener('click', () => this.changeQuickInterval(-1));
      $('quickIntervalUp')?.addEventListener('click', () => this.changeQuickInterval(1));
      $('quickIntervalInput')?.addEventListener('change', function handleQuickIntervalChange() {
        SettingsPage.saveQuickInterval(this.value);
      });

      $('stgNotifySwitch')?.addEventListener('click', async function handleNotifySwitch() {
        const isOn = this.classList.contains('on');
        const dndSwitch = $('stgDndSwitch');
        if (isOn && dndSwitch?.classList.contains('on')) {
          this.classList.remove('on');
          SettingsPage.log('WARN', '勿扰模式已开启，无法开启通知');
          return;
        }
        await SettingsPage.config()?.set?.('enableNotification', isOn);
        if (isOn) {
          const result = await SettingsPage.system()?.notify?.('Neko Status', '系统推送通知已启用');
          if (result?.shown === false) {
            SettingsPage.log('WARN', `系统通知未显示: ${result.reason || 'unknown'}`);
          }
        }
      });

      $('stgDndSwitch')?.addEventListener('click', async function handleDndSwitch() {
        await SettingsPage.applyDndState(this.classList.contains('on'), { userAction: true });
      });
      this.startDndPolling();

      $('stgIncognitoSwitch')?.addEventListener('click', async function handleIncognitoSwitch() {
        const isOn = this.classList.contains('on');
        await SettingsPage.config()?.set?.('enableIncognito', isOn);
        SettingsPage.log('INFO', `隐身模式 -> ${isOn ? '已启用（截图将模糊处理）' : '已禁用'}`);
        SettingsPage.syncPrivacyCopy(isOn);
        window._nekoActivityHelpers?.syncPrivacyBar?.();
      });

      $('incognitoScopeGroup')?.addEventListener('click', async (event) => {
        const btn = event.target.closest('.filter-segmented-btn');
        if (!btn) return;
        const scope = btn.dataset.scope || 'screenshot';
        this.setIncognitoScopeUI(scope);
        await this.config()?.set?.('incognitoScope', scope);
        window._nekoActivityHelpers?.syncPrivacyBar?.();
        this.log('INFO', `隐身保护范围 -> ${scope}`);
      });

      $('blurAllSwitch')?.addEventListener('click', async function handleBlurAllSwitch() {
        const isOn = this.classList.contains('on');
        await SettingsPage.config()?.set?.('blurAllScreenshots', isOn);
        SettingsPage.log('INFO', `全局截图模糊 -> ${isOn ? '已启用' : '已禁用'}`);
      });

      $('stg2FASwitch')?.addEventListener('click', async function handleTwoFactorSwitch() {
        const isOn = this.classList.contains('on');
        await SettingsPage.config()?.set?.('enable2FA', isOn);
        SettingsPage.log('INFO', `双重认证 -> ${isOn ? '已启用' : '已禁用'}`);
      });

      $('stgGlassSwitch')?.addEventListener('click', async function handleGlassSwitch() {
        const isOn = this.classList.contains('on');
        await SettingsPage.config()?.set?.('glassEffect', isOn);
        document.documentElement.classList.toggle('no-glass', !isOn);
        SettingsPage.log('INFO', `玻璃拟态 -> ${isOn ? '已启用' : '已禁用'}`);
      });

      $('stgDarkSwitch')?.addEventListener('click', async function handleDarkSwitch() {
        const isOn = this.classList.contains('on');
        const scheduleSwitch = $('stgDarkScheduleSwitch');
        if (scheduleSwitch?.classList.contains('on')) {
          scheduleSwitch.classList.remove('on');
          SettingsPage._deps.setExpandableSectionState($('stgDarkTimeRow'), false, { display: 'flex' });
        }
        const mode = isOn ? 'dark' : 'light';
        await SettingsPage.config()?.set?.('themeMode', mode);
        SettingsPage.applyTheme(mode);
      });

      $('stgDarkScheduleSwitch')?.addEventListener('click', async function handleDarkScheduleSwitch() {
        const isOn = this.classList.contains('on');
        SettingsPage._deps.setExpandableSectionState($('stgDarkTimeRow'), isOn, { display: 'flex' });
        const mode = isOn ? 'auto' : ($('stgDarkSwitch')?.classList.contains('on') ? 'dark' : 'light');
        await SettingsPage.config()?.set?.('themeMode', mode);
        SettingsPage.applyTheme(mode);
        SettingsPage.log('INFO', `定时深色模式 -> ${isOn ? `${SettingsPage.darkStart()}-${SettingsPage.darkEnd()}` : '已关闭'}`);
      });

      $('stgDarkStartTime')?.addEventListener('change', async function handleDarkStart() {
        await SettingsPage.config()?.set?.('darkModeStart', this.value);
        SettingsPage.applyTheme('auto', this.value, SettingsPage.darkEnd());
      });

      $('stgDarkEndTime')?.addEventListener('change', async function handleDarkEnd() {
        await SettingsPage.config()?.set?.('darkModeEnd', this.value);
        SettingsPage.applyTheme('auto', SettingsPage.darkStart(), this.value);
      });

      $('stgScaleDown')?.addEventListener('click', () => this.changeScale(-1));
      $('stgScaleUp')?.addEventListener('click', () => this.changeScale(1));
      $('clearCacheBtn')?.addEventListener('click', function handleClearCacheClick() {
        return SettingsPage.clearCache(this);
      });
    },

    async handleReportModeClick(event) {
      const btn = event.target.closest('.toggle-btn');
      if (!btn || !btn.dataset.mode) return;
      const mode = btn.dataset.mode;
      document.querySelectorAll('#stgReportModeGroup .toggle-btn').forEach((item) => {
        item.classList.toggle('active', item === btn);
      });
      await this.config()?.set?.('reportIntervalMode', mode);
      this._deps.setExpandableSectionState($('stgCustomIntervalRow'), mode === 'custom', { display: 'flex' });
      if (mode === 'auto') {
        await this.config()?.set?.('reportInterval', 10);
        this.syncReportIntervalUi(10, 'auto');
      } else {
        const value = parseInt($('stgReportIntervalInput')?.value, 10) || 10;
        this.syncReportIntervalUi(value, 'custom');
      }
      this.log('INFO', `上报模式 -> ${mode === 'auto' ? '自动 (10s)' : '自定义'}`);
    },

    async saveCustomReportInterval() {
      const value = parseInt($('stgReportIntervalInput')?.value, 10);
      if (Number.isNaN(value) || value < 5) {
        this.notice('间隔不能小于 5 秒', 'warn', 2000);
        return;
      }
      await this.config()?.set?.('reportInterval', value);
      this.syncReportIntervalUi(value, 'custom');
      this.log('INFO', `上报间隔已保存: ${value}s`);
      this.notice(`上报间隔已设为 ${value} 秒`, 'success', 2000);
    },

    syncReportIntervalUi(value, mode = 'custom') {
      const desc = $('stgReportIntervalDesc');
      if (desc) desc.textContent = mode === 'auto' ? '自动模式: 每 10s 自动上报' : `自定义模式: 每 ${value}s 上报`;
      const quickInput = $('quickIntervalInput');
      if (quickInput) quickInput.value = value;
      const quickLabel = $('quickIntervalLabel');
      if (quickLabel) quickLabel.textContent = mode === 'auto' ? '自动' : `${value}s · 自定义`;
      const hintValue = $('intervalAutoHintValue');
      if (hintValue) hintValue.textContent = value;
      this._deps.setExpandableSectionState($('quickIntervalStepper'), mode !== 'auto', { display: 'flex' });
      this._deps.setExpandableSectionState($('quickIntervalHint'), mode === 'auto', { display: 'block' });
    },

    async openReportIntervalSettings(event) {
      if (event.target.closest('.neko-stepper')) return;
      const cfg = await this.config()?.getAll?.();
      if ((cfg?.reportIntervalMode || 'auto') !== 'auto') return;
      document.querySelector('.nav-item[data-target="page-settings"]')?.click();
      setTimeout(() => {
        const targetRow = $('stgReportModeGroup')?.closest('.settings-row');
        if (!targetRow) return;
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetRow.classList.add('highlight-flash');
        setTimeout(() => targetRow.classList.remove('highlight-flash'), 2000);
      }, 300);
    },

    changeQuickInterval(dir) {
      const input = $('quickIntervalInput');
      if (!input) return;
      const current = parseInt(input.value, 10) || 10;
      input.value = Math.max(5, Math.min(3600, current + dir * 5));
    },

    async saveQuickInterval(rawValue) {
      const value = parseInt(rawValue, 10);
      if (Number.isNaN(value) || value < 5) return;
      await this.config()?.set?.('reportInterval', value);
      await this.config()?.set?.('reportIntervalMode', 'custom');
      document.querySelectorAll('#stgReportModeGroup .toggle-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === 'custom');
      });
      this._deps.setExpandableSectionState($('stgCustomIntervalRow'), true, { display: 'flex' });
      const settingInput = $('stgReportIntervalInput');
      if (settingInput) settingInput.value = value;
      this.syncReportIntervalUi(value, 'custom');
      this.log('INFO', `上报间隔快捷修改: ${value}s`);
    },

    async applyDndState(isOn, { userAction = false } = {}) {
      if (userAction) this._dndUserAction = true;
      await this.config()?.set?.('doNotDisturb', isOn);
      const result = await this.system()?.setFocusAssist?.(isOn);
      await this.syncNotifyWithDnd(isOn);
      if (result?.ok) {
        this.log('INFO', `勿扰模式 -> ${isOn ? '已开启（Windows 免打扰已同步，通知已自动关闭）' : '已关闭（通知已自动恢复）'}`);
      } else {
        this.log('WARN', `勿扰模式 -> ${isOn ? '已开启' : '已关闭'}（Windows 免打扰同步失败）`);
      }
    },

    async syncNotifyWithDnd(dndEnabled) {
      const notifySwitch = $('stgNotifySwitch');
      if (notifySwitch) notifySwitch.classList.toggle('on', !dndEnabled);
      await this.config()?.set?.('enableNotification', !dndEnabled);
    },

    startDndPolling() {
      if (this._dndPollStarted || !this.system()?.getFocusAssist) return;
      this._dndPollStarted = true;
      setInterval(async () => {
        if (this._dndUserAction) {
          this._dndUserAction = false;
          return;
        }
        try {
          const focusAssist = await this.system()?.getFocusAssist?.();
          if (!focusAssist?.ok) return;
          const switchEl = $('stgDndSwitch');
          const current = !!switchEl?.classList.contains('on');
          if (focusAssist.enabled === current) return;
          switchEl?.classList.toggle('on', focusAssist.enabled);
          await this.config()?.set?.('doNotDisturb', focusAssist.enabled);
          await this.syncNotifyWithDnd(focusAssist.enabled);
        } catch { /* ignore */ }
      }, 30000);
    },

    syncPrivacyCopy(isOn) {
      const privacyRulesBtn = $('openPrivacyRulesBtn');
      if (privacyRulesBtn) privacyRulesBtn.style.display = '';
      const privacyBarTitle = $('privacyBarTitle');
      const privacyBarDesc = $('privacyBarDesc');
      const privacyBarIcon = $('privacyBarIcon');
      if (privacyBarTitle) privacyBarTitle.textContent = isOn ? '隐私防护已启用' : '隐私防护未启用';
      if (privacyBarDesc) {
        privacyBarDesc.textContent = isOn
          ? '匹配隐私规则的前台应用截图将自动模糊后再上传，截图仅上传至已配置的自有服务器。'
          : '隐身模式未开启，截图将正常上传。开启隐身模式后可配置隐私规则。';
      }
      if (privacyBarIcon) {
        privacyBarIcon.innerHTML = isOn
          ? '<i class="ph ph-shield-check"></i>'
          : '<i class="ph ph-shield-slash"></i>';
      }
    },

    setIncognitoScopeUI(scope) {
      const normalized = ['screenshot', 'title', 'both'].includes(scope) ? scope : 'screenshot';
      const group = $('incognitoScopeGroup');
      const pill = $('incognitoScopePill');
      if (!group) return normalized;

      group.querySelectorAll('.filter-segmented-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.scope === normalized);
      });
      const active = group.querySelector('.filter-segmented-btn.active');
      if (pill && active) {
        pill.style.width = `${active.offsetWidth}px`;
        pill.style.transform = `translateX(${active.offsetLeft - 4}px)`;
      }
      this._deps.setIncognitoScopeUI(normalized);
      document.dispatchEvent?.(new CustomEvent('neko:privacy-scope-changed', { detail: { scope: normalized } }));
      return normalized;
    },

    darkStart() {
      return $('stgDarkStartTime')?.value || '18:00';
    },

    darkEnd() {
      return $('stgDarkEndTime')?.value || '07:00';
    },

    applyTheme(mode, start = this.darkStart(), end = this.darkEnd()) {
      this._deps.applyThemeMode(mode, start, end);
    },

    currentScaleIndex() {
      const current = parseInt($('stgScaleLabel')?.textContent || '', 10);
      const idx = SCALE_STEPS.indexOf(current);
      return idx >= 0 ? idx : SCALE_STEPS.indexOf(100);
    },

    changeScale(dir) {
      const nextIdx = this.currentScaleIndex() + dir;
      if (nextIdx < 0 || nextIdx >= SCALE_STEPS.length) return;
      const pct = SCALE_STEPS[nextIdx];
      const scaleLabel = $('stgScaleLabel');
      const scaleDown = $('stgScaleDown');
      const scaleUp = $('stgScaleUp');
      if (scaleLabel) scaleLabel.textContent = `${pct}%`;
      if (scaleDown) scaleDown.disabled = nextIdx <= 0;
      if (scaleUp) scaleUp.disabled = nextIdx >= SCALE_STEPS.length - 1;
      this.config()?.set?.('uiScale', pct);
      this.system()?.setZoom?.(pct / 100);
      this.log('INFO', `界面缩放 -> ${pct}%`);
    },

    async clearCache(button) {
      if (!button || button.classList.contains('loading')) return;
      button.classList.add('loading');
      const icon = $('clearCacheIcon');
      if (icon) {
        icon.className = 'ph ph-spinner ph-spin';
      }
      const label = button.childNodes?.[button.childNodes.length - 1] || null;
      if (label) label.textContent = ' 清理中...';

      try {
        const result = await this.system()?.clearCache?.();
        if (result?.success) {
          const afterBytes = result.afterBytes || 0;
          this.log('SUCCESS', `cache cleared: ${this._deps.formatBytes(result.clearedBytes || 0)} freed, ${result.removedCount || 0} paths touched`);
          if (icon) {
            icon.className = 'ph ph-check-circle';
          }
          if (label) label.textContent = ' 已完成';
          const cacheDesc = $('cacheSizeDesc');
          if (cacheDesc) cacheDesc.textContent = `会话缓存（图片、脚本等）· 当前 ${this._deps.formatBytes(afterBytes)}`;
          this._deps.setConsoleStatus('Cache', this._deps.formatBytes(afterBytes), 'Local cache', 'ok');
          await new Promise((resolve) => setTimeout(resolve, 1200));
        } else {
          this.log('ERROR', `清理失败: ${result?.error || 'unknown'}`);
        }
      } catch (error) {
        this.log('ERROR', `清理失败: ${error.message}`);
      }

      if (icon) {
        icon.className = 'ph ph-broom';
      }
      if (label) label.textContent = ' 清理缓存';
      button.classList.remove('loading');
    },

    render() {},
  };

  window._nekoModules.pages.SettingsPage = SettingsPage;
  applySavedFontProfile();
})();

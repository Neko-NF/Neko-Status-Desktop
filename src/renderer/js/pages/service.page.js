(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function defaultDeps() {
    return {
      addLogLine: () => {},
      showNotice: () => {},
      applyServiceState: () => {},
      runPermissionDiagnosis: async () => {},
      refreshHealthResultsScrollFx: null,
      setExpandableSectionState: window._nekoUIHelpers?.setExpandableSectionState || (() => {}),
      service: window._nekoModules?.services?.ServiceClient || null,
      config: window._nekoModules?.services?.ConfigClient || null,
      system: window._nekoModules?.services?.SystemClient || null,
      escapeHtml,
    };
  }

  function replaceHandler(id, handler) {
    const el = $(id);
    if (!el) return null;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', handler);
    return clone;
  }

  function initHealthResultsScrollFx() {
    const shell = $('healthResultsShell');
    const list = $('healthResultsList');
    if (!shell || !list) return () => {};

    const updateFades = () => {
      const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
      const current = list.scrollTop;
      shell.dataset.topFade = current > 6 ? '1' : '0';
      shell.dataset.bottomFade = maxScroll - current > 6 ? '1' : '0';
    };

    if (list.dataset.scrollFxBound !== '1') {
      list.addEventListener('scroll', updateFades, { passive: true });
      window.addEventListener?.('resize', updateFades);
      list.dataset.scrollFxBound = '1';
    }

    const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
    raf(updateFades);
    return updateFades;
  }

  const ServicePage = {
    _inited: false,
    _deps: defaultDeps(),
    _healthScrollFx: null,

    init(deps = {}) {
      if (this._inited) return;
      this._inited = true;
      this._deps = { ...defaultDeps(), ...deps };

      this.bindReportToggle();
      this.bindAutoStartSwitches();
      this.bindServiceActions();
      this.bindAutoServiceSettings();
      this.bindRecoverySettings();
      this.bindHealthCheck();
      this._healthScrollFx = initHealthResultsScrollFx();
    },

    service() {
      return this._deps.service || window._nekoModules?.services?.ServiceClient;
    },

    config() {
      return this._deps.config || window._nekoModules?.services?.ConfigClient;
    },

    system() {
      return this._deps.system || window._nekoModules?.services?.SystemClient;
    },

    log(level, message) {
      this._deps.addLogLine(level, message);
    },

    notice(message, type = 'info', timeout = 2000) {
      this._deps.showNotice(message, type, timeout);
    },

    refreshHealthResultsScrollFx() {
      const fx = this._deps.refreshHealthResultsScrollFx || this._healthScrollFx || initHealthResultsScrollFx();
      this._healthScrollFx = fx;
      fx();
    },

    applyServiceState(isRunning) {
      const reporterStatusEl = $('reporterStatus');
      if (!reporterStatusEl) return;
      reporterStatusEl.className = `svc-pill-status ${isRunning ? 'running' : 'error'}`;
      reporterStatusEl.innerHTML = isRunning
        ? '<i class="ph ph-check-circle"></i> 上报中'
        : '<i class="ph ph-x-circle"></i> 已停止';
    },

    bindReportToggle() {
      replaceHandler('reportToggleBtn', async () => {
        const btn = $('reportToggleBtn');
        if (!btn || btn.classList.contains('btn-pending')) return;

        const running = await this.service()?.isRunning?.();
        btn.className = 'status-toggle-btn btn-pending';
        window._nekoUIHelpers?.setButtonBusy?.(btn, true, { label: running ? '停止中…' : '连接中…' });
        let finalRunning = !!running;

        try {
          if (running) {
            const result = await this.service()?.stop?.();
            finalRunning = result && typeof result.isRunning === 'boolean' ? result.isRunning : false;
            this.log('INFO', '已手动停止上报服务');
            this.notice('上报服务已停止', 'info', 2000);
            this._deps.applyServiceState(finalRunning);
            return;
          }

          const cfg = await this.config()?.getAll?.();
          if (!cfg?.deviceKey) {
            this.log('WARN', '请先在配置中填写设备密钥，再启动上报服务');
            this.notice('请先配置设备密钥', 'warn', 3000);
            this._deps.applyServiceState(false);
            return;
          }

          const result = await this.service()?.start?.();
          finalRunning = result && typeof result.isRunning === 'boolean' ? result.isRunning : true;
          this.log('INFO', '已手动启动上报服务');
          this.notice('上报服务已启动', 'success', 2000);
          this._deps.applyServiceState(finalRunning);
        } catch (error) {
          this.log('ERROR', `服务切换失败: ${error.message}`);
          this.notice('服务切换失败', 'error', 3000);
          finalRunning = !!(await this.service()?.isRunning?.());
          this._deps.applyServiceState(finalRunning);
        } finally {
          window._nekoUIHelpers?.setButtonBusy?.(btn, false);
          btn.className = `status-toggle-btn ${finalRunning ? 'btn-stop' : 'btn-start'}`;
          btn.innerHTML = finalRunning
            ? '<i class="ph ph-stop-circle"></i> 停止上报'
            : '<i class="ph ph-play-circle"></i> 开始上报';
        }
      });
    },

    bindAutoStartSwitches() {
      const bind = (id, mirrorId) => {
        $(id)?.addEventListener('click', async function handleAutoStartClick() {
          const enabled = this.classList.contains('on');
          try {
            if (enabled) await ServicePage.service()?.enableAutoStart?.();
            else await ServicePage.service()?.disableAutoStart?.();
            ServicePage.log('INFO', `开机自启 -> ${enabled ? '已启用' : '已禁用'}`);
            ServicePage.notice(enabled ? '开机自启已启用' : '开机自启已禁用', enabled ? 'success' : 'info', 2000);
            $(mirrorId)?.classList.toggle('on', enabled);
            ServicePage._deps.runPermissionDiagnosis().catch(() => {});
          } catch (error) {
            ServicePage.log('ERROR', `自启设置失败: ${error.message}`);
            ServicePage.notice('自启设置失败', 'error', 3000);
          }
        });
      };

      bind('autoStartSwitch', 'stgAutoStartSwitch');
      bind('stgAutoStartSwitch', 'autoStartSwitch');
    },

    bindServiceActions() {
      $('autoStartMinimizeSwitch')?.addEventListener('click', async function handleMinimize() {
        const enabled = this.classList.contains('on');
        await ServicePage.config()?.set?.('minimizeOnAutoStart', enabled);
        ServicePage.log('INFO', `开机自启最小化 -> ${enabled ? '已启用' : '已禁用'}`);
      });

      $('btnRestartReporter')?.addEventListener('click', async () => {
        try {
          this.log('INFO', '正在重启上报服务...');
          this.notice('正在重启上报服务...', 'info', 2000);
          await this.service()?.restart?.();
          this.log('SUCCESS', '上报服务已重启');
          this.notice('上报服务已重启', 'success', 2000);
        } catch (error) {
          this.log('ERROR', `重启失败: ${error.message}`);
          this.notice('重启失败', 'error', 3000);
        }
      });

      $('btnStopReporter')?.addEventListener('click', async () => {
        const running = await this.service()?.isRunning?.();
        if (!running) {
          this.notice('上报服务未在运行', 'info', 2000);
          return;
        }
        try {
          await this.service()?.stop?.();
          this.log('INFO', '已手动停止上报服务');
          this.notice('上报服务已停止', 'info', 2000);
        } catch (error) {
          this.log('ERROR', `停止失败: ${error.message}`);
          this.notice('操作失败', 'error', 3000);
        }
      });

      $('btnTestCapture')?.addEventListener('click', async () => {
        const captureStatusEl = $('captureStatus');
        try {
          this.log('INFO', '正在测试屏幕捕获...');
          const result = await this.system()?.captureScreen?.();
          if (captureStatusEl) {
            captureStatusEl.className = result ? 'svc-pill-status running' : 'svc-pill-status error';
            captureStatusEl.innerHTML = result
              ? '<i class="ph ph-check-circle"></i> <span>可用</span>'
              : '<i class="ph ph-x-circle"></i> <span>API 不可用</span>';
          }
          this.notice(result ? '屏幕捕获测试成功' : '屏幕捕获不可用', result ? 'success' : 'error', result ? 2000 : 3000);
        } catch (error) {
          if (captureStatusEl) {
            captureStatusEl.className = 'svc-pill-status error';
            captureStatusEl.innerHTML = '<i class="ph ph-x-circle"></i> <span>异常</span>';
          }
          this.log('ERROR', `截图测试异常: ${error.message}`);
        }
      });
    },

    bindAutoServiceSettings() {
      $('reportAutoStartSwitch')?.addEventListener('click', async function handleReportAutoStart() {
        const enabled = this.classList.contains('on');
        await ServicePage.config()?.set?.('enableAutoServiceStart', enabled);
        ServicePage._deps.setExpandableSectionState($('reportAutoDelayRow'), enabled, { display: 'flex' });
        ServicePage.log('INFO', `启动后自动上报 -> ${enabled ? '已启用' : '已禁用'}`);
      });
    },

    bindRecoverySettings() {
      $('autoRestartSwitch')?.addEventListener('click', async function handleAutoRestart() {
        const enabled = this.classList.contains('on');
        await ServicePage.config()?.set?.('enableAutoRestart', enabled);
        ServicePage.log('INFO', `崩溃自动重启 -> ${enabled ? '已启用' : '已禁用'}`);
      });

      const numericInputs = [
        { id: 'reportAutoDelayInput', key: 'reportInterval', label: '上报延迟' },
        { id: 'startDelayInput', key: 'startupDelayMs', label: '启动延迟', multiplier: 1000 },
        { id: 'maxRestartsInput', key: 'maxRestarts', label: '最大重启次数' },
        { id: 'restartIntervalInput', unitId: 'restartIntervalUnit', key: 'restartIntervalSec', label: '重启间隔' },
        { id: 'watchdogTimeoutInput', unitId: 'watchdogUnit', key: 'watchdogTimeoutSec', label: '看门狗超时' },
      ];

      const saveValue = async ({ id, unitId, key, label, multiplier }) => {
        const el = $(id);
        if (!el) return;
        const raw = parseInt(el.value, 10);
        if (Number.isNaN(raw)) return;
        const min = parseInt(el.min, 10) || 0;
        const max = parseInt(el.max, 10) || Infinity;
        const clamped = Math.max(min, Math.min(max, raw));
        const unit = unitId ? ($(unitId)?.value || 's') : '';
        const unitMultiplier = unit === 'm' ? 60 : 1;
        el.value = clamped;
        await this.config()?.set?.(key, multiplier ? clamped * multiplier : clamped * unitMultiplier);
        this.log('INFO', `${label} -> ${clamped}${multiplier ? 'ms' : unit || ''}`);
      };

      numericInputs.forEach((item) => {
        const el = $(item.id);
        if (!el) return;
        let saveTimer = null;
        el.addEventListener('input', () => {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => saveValue(item), 600);
        });
        el.addEventListener('change', () => saveValue(item));
        if (item.unitId) $(item.unitId)?.addEventListener('change', () => saveValue(item));
      });
    },

    bindHealthCheck() {
      replaceHandler('runHealthCheckBtn', async () => this.runHealthCheck());
    },

    renderHealthItem(result, index = 0, item = null) {
      const meta = this.statusMeta(result.ok);
      const node = item || document.createElement('div');
      const signature = `${meta.tone}\u0000${result.name}\u0000${result.text}`;
      node.className = `health-result-item ${meta.tone}${item ? '' : ' is-entering'}`;
      if (!item) node.addEventListener?.('animationend', () => node.classList.remove('is-entering'), { once: true });
      if (node.dataset.healthSignature === signature) return node;
      node.dataset.healthSignature = signature;
      node.innerHTML = `
        <div class="health-result-top">
          <div class="health-result-title-wrap">
            <i class="ph ${meta.icon} health-result-icon ${meta.tone}"></i>
            <div class="health-result-name">${this._deps.escapeHtml(result.name)}</div>
          </div>
          <span class="health-result-badge ${meta.tone}">${meta.label}</span>
        </div>
        <div class="health-result-desc">${this._deps.escapeHtml(result.text)}</div>`;
      return node;
    },

    renderHealthSummary(results, durationMs, summary = null) {
      const okCount = results.filter((item) => item.ok === true).length;
      const warnCount = results.filter((item) => item.ok === 'warn').length;
      const failCount = results.filter((item) => item.ok !== true && item.ok !== 'warn').length;
      const node = summary || document.createElement('div');
      node.className = 'health-summary-bar';
      node.dataset.healthKey = '__summary__';
      node.innerHTML = `
        <div class="health-summary-copy">
          <div class="health-summary-title">已完成 ${results.length} 项检查</div>
          <div class="health-summary-subtitle">用时 ${(durationMs / 1000).toFixed(1)} 秒</div>
        </div>
        <div class="health-summary-pills">
          <span class="health-summary-pill ok"><i class="ph ph-check-circle"></i>${okCount} 项正常</span>
          <span class="health-summary-pill warn"><i class="ph ph-warning"></i>${warnCount} 项关注</span>
          <span class="health-summary-pill fail"><i class="ph ph-x-circle"></i>${failCount} 项异常</span>
        </div>`;
      return node;
    },

    reconcileHealthResults(results, durationMs) {
      const list = $('healthResultsList');
      if (!list) return;

      if (!list.ownerDocument) {
        list.innerHTML = '';
        if (Array.isArray(list.children)) list.children.length = 0;
        list.appendChild(this.renderHealthSummary(results, durationMs));
        results.forEach((result, index) => list.appendChild(this.renderHealthItem(result, index)));
        return;
      }

      const scrollTop = Number(list.scrollTop) || 0;
      list.querySelector?.('.health-result-placeholder')?.remove?.();
      const existing = new Map(
        Array.from(list.querySelectorAll('[data-health-key]'))
          .map((node) => [node.dataset.healthKey, node]),
      );
      const retained = new Set(['__summary__']);
      const summary = this.renderHealthSummary(results, durationMs, existing.get('__summary__'));
      list.appendChild(summary);

      const occurrences = new Map();
      results.forEach((result, index) => {
        const baseKey = String(result.id || result.key || result.name || `result-${index}`);
        const occurrence = occurrences.get(baseKey) || 0;
        occurrences.set(baseKey, occurrence + 1);
        const key = occurrence ? `${baseKey}-${occurrence}` : baseKey;
        const item = this.renderHealthItem(result, index, existing.get(key));
        item.dataset.healthKey = key;
        list.appendChild(item);
        retained.add(key);
      });

      existing.forEach((node, key) => {
        if (!retained.has(key)) node.remove();
      });
      list.scrollTop = scrollTop;
    },

    statusMeta(ok) {
      if (ok === true) return { tone: 'ok', icon: 'ph-check-circle', label: '正常' };
      if (ok === 'warn') return { tone: 'warn', icon: 'ph-warning', label: '关注' };
      return { tone: 'fail', icon: 'ph-x-circle', label: '异常' };
    },

    async runHealthCheck() {
      const btn = $('runHealthCheckBtn');
      const list = $('healthResultsList');
      if (!btn || !list) return;

      window._nekoUIHelpers?.setButtonBusy?.(btn, true, { label: '体检中…' });
      list.setAttribute?.('aria-busy', 'true');
      this.refreshHealthResultsScrollFx();
      const startedAt = Date.now();

      try {
        const results = await this.service()?.runHealthCheck?.();
        this.reconcileHealthResults(results, Date.now() - startedAt);
      } catch (error) {
        const failedResult = { name: '检测异常', text: error.message, ok: false };
        this.reconcileHealthResults([failedResult], Date.now() - startedAt);
      }

      list.setAttribute?.('aria-busy', 'false');
      window._nekoUIHelpers?.setButtonBusy?.(btn, false);
      btn.innerHTML = '<i class="ph ph-stethoscope"></i> 重新检测';
      this.refreshHealthResultsScrollFx();
    },

    syncAutoStartToggles(enabled) {
      ['stgAutoStartSwitch', 'autoStartSwitch'].forEach((id) => {
        $(id)?.classList.toggle('on', !!enabled);
      });
    },

    initFromAppInit(initData = {}) {
      const cfg = initData.config || {};
      const nameEl = $('daemonProcessName');
      const pidEl = $('daemonPidBadge');
      if (nameEl) nameEl.textContent = initData.processName || 'Neko Status';
      if (pidEl) pidEl.textContent = `PID ${initData.pid || '-'}`;

      const daemonStatusEl = $('daemonStatus');
      if (daemonStatusEl) {
        daemonStatusEl.className = 'svc-pill-status running';
        daemonStatusEl.innerHTML = '<i class="ph ph-check-circle"></i> <span>运行中</span>';
      }

      const privBadge = $('privLevelBadge');
      if (privBadge) {
        privBadge.textContent = initData.isAdmin ? '管理员' : '标准用户';
        privBadge.className = `status-badge ${initData.isAdmin ? 'success' : 'info'}`;
      }

      $('autoStartMinimizeSwitch')?.classList.toggle('on', !!cfg.minimizeOnAutoStart);
      $('autoRestartSwitch')?.classList.toggle('on', cfg.enableAutoRestart !== false);
      $('reportAutoDelayInput') && ($('reportAutoDelayInput').value = cfg.reportInterval || 10);
      $('startDelayInput') && ($('startDelayInput').value = Math.round((cfg.startupDelayMs || 5000) / 1000));
      $('maxRestartsInput') && ($('maxRestartsInput').value = cfg.maxRestarts || 3);
      $('restartIntervalInput') && ($('restartIntervalInput').value = cfg.restartIntervalSec || 30);
      $('watchdogTimeoutInput') && ($('watchdogTimeoutInput').value = cfg.watchdogTimeoutSec || 60);
      $('reportAutoStartSwitch')?.classList.toggle('on', !!cfg.enableAutoServiceStart);
      this._deps.setExpandableSectionState($('reportAutoDelayRow'), !!cfg.enableAutoServiceStart, { display: 'flex' });

      this.syncPermissionPills();
    },

    async syncPermissionPills() {
      try {
        const perms = await this.service()?.checkPermissions?.();
        const permMap = {
          screenCapture: 'permScreenCapture',
          processEnum: 'permProcessEnum',
          powerControl: 'permPowerControl',
          network: 'permNetwork',
          fileIO: 'permFileIO',
        };
        Object.entries(permMap).forEach(([key, elId]) => {
          const el = $(elId);
          if (!el) return;
          const granted = perms?.[key] === 'granted';
          el.className = granted ? 'perm-status success' : 'perm-status error';
          el.innerHTML = granted
            ? '<i class="ph ph-check-circle"></i> 已授权'
            : '<i class="ph ph-x-circle"></i> 拒绝';
        });

        const captureStatusEl = $('captureStatus');
        if (captureStatusEl) {
          const granted = perms?.screenCapture === 'granted';
          captureStatusEl.className = granted ? 'svc-pill-status running' : 'svc-pill-status error';
          captureStatusEl.innerHTML = granted
            ? '<i class="ph ph-check-circle"></i> <span>可用</span>'
            : '<i class="ph ph-x-circle"></i> <span>不可用</span>';
        }
      } catch (error) {
        this.log('WARN', `权限检测失败: ${error.message}`);
      }
    },
  };

  window._nekoModules.pages.ServicePage = ServicePage;
})();

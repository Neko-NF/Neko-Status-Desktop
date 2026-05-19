(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  function $(id) {
    return document.getElementById(id);
  }

  function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '--';
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function releaseNotesToHtml(notes) {
    const text = String(notes || '').replace(/<!--\s*FORCE_UPDATE\s*-->/gi, '').trim();
    if (!text) return '<p>No release notes.</p>';
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        if (/^[-*]\s+/.test(line)) return `<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`;
        if (/^#{1,6}\s+/.test(line)) return `<p><strong>${escapeHtml(line.replace(/^#{1,6}\s+/, ''))}</strong></p>`;
        return `<p>${escapeHtml(line)}</p>`;
      })
      .join('')
      .replace(/(?:<li>.*?<\/li>)+/gs, (items) => `<ul>${items}</ul>`);
  }

  function setBadge(kind, html) {
    const badge = $('updateStatusBadge');
    if (!badge) return;
    badge.className = `update-status-badge ${kind}`;
    badge.innerHTML = html;
  }

  function setCheckButton(mode, label, iconClass) {
    const btn = $('checkUpdateBtn');
    const icon = $('checkUpdateIcon');
    const labelEl = $('checkUpdateLabel');
    if (btn && mode) btn._updateMode = mode;
    if (labelEl && label) labelEl.textContent = label;
    if (icon && iconClass) {
      icon.className = iconClass;
      icon.style.animation = '';
    }
  }

  function getDialogResult() {
    const overlay = $('updateDialogOverlay');
    return overlay?.__updateResult || overlay?._updateResult || null;
  }

  function parseRepoInput(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    try {
      const url = new URL(value);
      const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/i, '');
      const isGithub = /(^|\.)github\.com$/i.test(url.hostname);
      const baseUrl = `${url.protocol}//${url.host}`.replace(/\/+$/g, '');
      return { type: isGithub ? 'github' : 'personal', owner, repo, baseUrl, repoUrl: `${baseUrl}/${owner}/${repo}` };
    } catch {
      const parts = value.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (parts.length !== 2) return null;
      const repo = parts[1].replace(/\.git$/i, '');
      return { type: 'github', owner: parts[0], repo, baseUrl: 'https://github.com', repoUrl: `https://github.com/${parts[0]}/${repo}` };
    }
  }

  function sourceIdForParsed(parsed) {
    return `${parsed.type}-${parsed.owner}-${parsed.repo}`.toLowerCase();
  }

  function sourceTypeLabel(type) {
    return type === 'github' ? 'GitHub' : '个人仓库';
  }

  function normalizeSourceLabel(label, type) {
    const value = String(label || '').trim();
    if (!value || /^local repo$/i.test(value) || /^personal$/i.test(value)) return sourceTypeLabel(type);
    return value;
  }

  function compactRepoUrl(url) {
    return String(url || '').replace(/^https?:\/\//, '');
  }

  function normalizeSource(source) {
    const parsed = parseRepoInput(source?.repoUrl || source?.url || '');
    const type = source?.type === 'personal' ? 'personal' : 'github';
    const owner = source?.owner || parsed?.owner || '';
    const repo = source?.repo || parsed?.repo || '';
    const baseUrl = (source?.baseUrl || parsed?.baseUrl || (type === 'github' ? 'https://github.com' : 'https://git.koirin.com:39520')).replace(/\/+$/g, '');
    if (!owner || !repo) return null;
    return {
      id: source?.id || `${type}-${owner}-${repo}`.toLowerCase(),
      type,
      label: normalizeSourceLabel(source?.label, type),
      owner,
      repo,
      baseUrl,
      repoUrl: type === 'github' ? `https://github.com/${owner}/${repo}` : `${baseUrl}/${owner}/${repo}`,
      token: source?.token || '',
      enabled: source?.enabled !== false,
      priority: Number(source?.priority) || 0,
    };
  }

  function explicitSources(cfg = {}) {
    return Array.isArray(cfg.updateSources) ? cfg.updateSources.map(normalizeSource).filter(Boolean) : [];
  }

  function visibleSourcesFromExplicit(explicit) {
    const hidden = new Set(explicit.filter((source) => source.enabled === false).map((source) => source.id));
    return explicit.filter((source) => source.enabled !== false && !hidden.has(source.id));
  }

  function buildSourceList(cfg = {}) {
    const byId = new Map();
    const github = normalizeSource({
      id: 'github-default',
      type: 'github',
      label: 'GitHub',
      owner: cfg.githubOwner || 'Neko-NF',
      repo: cfg.githubRepo || 'Neko-Status-Desktop',
    });
    if (github) byId.set(github.id, github);

    const personalParsed = parseRepoInput(cfg.personalUpdateRepo || '');
    const personal = normalizeSource({
      id: 'personal-default',
      type: 'personal',
      label: 'Local repo',
      baseUrl: cfg.personalUpdateBaseUrl || personalParsed?.baseUrl || 'https://git.koirin.com:39520',
      owner: personalParsed?.owner || cfg.personalUpdateOwner,
      repo: personalParsed?.repo || cfg.personalUpdateRepoName,
      repoUrl: cfg.personalUpdateRepo || '',
    });
    if (personal) byId.set(personal.id, personal);

    explicitSources(cfg)
      .forEach((source) => {
        if (!source.enabled) {
          byId.delete(source.id);
          return;
        }
        byId.set(source.id, source);
      });

    return Array.from(byId.values()).sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  }

  function sourcePayload(source, overrides = {}) {
    if (!source) return {};
    return {
      activeUpdateSourceId: overrides.activeUpdateSourceId || source.id,
      updateSourceType: source.type,
      ...(source.type === 'github'
        ? { githubOwner: source.owner, githubRepo: source.repo }
        : {
            personalUpdateBaseUrl: source.baseUrl,
            personalUpdateRepo: source.repoUrl,
            personalUpdateOwner: source.owner,
            personalUpdateRepoName: source.repo,
      }),
    };
  }

  function formatLatency(value) {
    const latency = Number(value);
    return Number.isFinite(latency) && latency >= 0 ? `${Math.round(latency)} ms` : '待检测';
  }

  function formatDuration(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0) return '待检测';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  }

  function pickDownloadSpeed(result = {}) {
    return result.downloadSpeedBytesPerSecond
      ?? result.estimatedDownloadSpeedBytesPerSecond
      ?? result.bytesPerSecond
      ?? result.speedBytesPerSec
      ?? result.downloadSpeed
      ?? result.estimatedDownloadSpeed;
  }

  function formatSpeed(value) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    const speed = Number(value);
    return Number.isFinite(speed) && speed > 0 ? `${formatFileSize(speed)}/s` : '待检测';
  }

  function hasDiagnosticData(result) {
    return !!(result && (Object.keys(result).length || Array.isArray(result.smartSources)));
  }

  function latencyLevel(value) {
    const latency = Number(value);
    if (!Number.isFinite(latency) || latency < 0) return 'idle';
    if (latency <= 1200) return 'good';
    if (latency <= 3500) return 'warn';
    return 'error';
  }

  function speedLevel(value) {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed <= 0) return 'idle';
    if (speed >= 1024 * 1024) return 'good';
    if (speed >= 256 * 1024) return 'warn';
    return 'error';
  }

  function statusMeta(kind) {
    const map = {
      checking: { icon: 'ph-circle-notch', text: '检测中', className: 'checking' },
      success: { icon: 'ph-check-circle', text: '已检测', className: 'success' },
      best: { icon: 'ph-sparkle', text: '当前最优', className: 'success' },
      warn: { icon: 'ph-warning-circle', text: '资产缺失', className: 'warn' },
      error: { icon: 'ph-warning', text: '检测失败', className: 'error' },
      idle: { icon: 'ph-clock', text: '待检测', className: 'idle' },
    };
    return map[kind] || map.idle;
  }

  const UpdatePage = {
    init() {
      if (this._inited) return;
      this._inited = true;
      document.querySelector('.nav-item[data-target="page-update"]')?.addEventListener('click', (event) => {
        event.currentTarget.classList.remove('has-update');
      });
      this.requestSourceDiagnosticsCheck({ reason: 'enter-update-page' });
    },

    buildSourceList,

    startSourceDiagnosticsCheck() {
      this.stopSourceDiagnosticsTimer();
      this._sourceDiagnosticStartedAt = Date.now();
      const tick = () => {
        const elapsedMs = Math.max(0, Date.now() - this._sourceDiagnosticStartedAt);
        this.renderSourceDiagnostics(this._sourceDiagnostics || {}, { checking: true, elapsedMs });
      };
      tick();
      this._sourceDiagnosticTimerId = setInterval(tick, 100);
    },

    stopSourceDiagnosticsTimer() {
      if (this._sourceDiagnosticTimerId) {
        clearInterval(this._sourceDiagnosticTimerId);
        this._sourceDiagnosticTimerId = 0;
      }
    },

    finishSourceDiagnosticsCheck(result = {}) {
      const elapsedMs = this._sourceDiagnosticStartedAt ? Math.max(0, Date.now() - this._sourceDiagnosticStartedAt) : undefined;
      this.stopSourceDiagnosticsTimer();
      this._sourceDiagnosticStartedAt = 0;
      this.renderSourceDiagnostics(result, { elapsedMs });
    },

    failSourceDiagnosticsCheck(error) {
      const elapsedMs = this._sourceDiagnosticStartedAt ? Math.max(0, Date.now() - this._sourceDiagnosticStartedAt) : undefined;
      this.stopSourceDiagnosticsTimer();
      this._sourceDiagnosticStartedAt = 0;
      const cfg = this._lastSourceCfg || {};
      const sources = buildSourceList(cfg);
      const selectedId = cfg.activeUpdateSourceId || (cfg.updateSourceType === 'personal' ? 'personal-default' : 'github-default');
      const selected = sources.find((source) => source.id === selectedId) || sources[0];
      this.renderSourceDiagnostics({
        sourceId: selected?.id,
        sourceType: selected?.type,
        sourceLabel: selected?.label,
        error: error?.message || String(error || '检测失败'),
      }, { elapsedMs });
    },

    requestSourceDiagnosticsCheck(options = {}) {
      const runner = this._runSourceDiagnosticsCheck;
      if (this._sourceDiagnosticsRequestRunning || this._sourceDiagnosticTimerId) return false;
      if (typeof runner !== 'function') {
        this._pendingSourceDiagnosticsOnEnter = true;
        return false;
      }
      const now = Date.now();
      if (!options.force && this._lastSourceDiagnosticsRequestedAt && now - this._lastSourceDiagnosticsRequestedAt < 3000) {
        return false;
      }
      this._lastSourceDiagnosticsRequestedAt = now;
      runner();
      return true;
    },

    renderSources(cfg = {}) {
      this._lastSourceCfg = cfg;
      const sources = buildSourceList(cfg);
      const selectedId = cfg.activeUpdateSourceId || (cfg.updateSourceType === 'personal' ? 'personal-default' : 'github-default');
      const selected = sources.find((source) => source.id === selectedId) || sources[0];
      const mode = cfg.updateSourceMode === 'smart' ? 'smart' : 'selected';
      const rail = $('updateSourceRail');
      const dots = $('updateSourceDots');
      const prevBtn = $('updateSourcePrevBtn');
      const nextBtn = $('updateSourceNextBtn');
      const currentUrlSpan = document.querySelector('#updateSourceCurrent .update-source-current-url');
      const currentLabel = document.querySelector('#updateSourceCurrent .update-source-current-label');
      const sourceCount = $('updateSourceCount');
      const modeHint = $('updateSourceModeHint');

      if (currentUrlSpan) {
        currentUrlSpan.textContent = mode === 'smart'
          ? `智能模式将检测 ${sources.length} 个已保存更新源`
          : compactRepoUrl(selected?.repoUrl || 'github.com/Neko-NF/Neko-Status-Desktop');
      }

      if (currentLabel) {
        currentLabel.textContent = mode === 'smart' ? '智能择优' : '当前使用';
      }

      if (sourceCount) {
        sourceCount.textContent = `${sources.length} 个源`;
      }

      if (modeHint) {
        modeHint.textContent = mode === 'smart'
          ? '智能模式会探测所有启用源，并优先使用延迟更低且含可安装资产的结果。'
          : '手动模式会固定使用下方选中的仓库源，适合调试或锁定私有发布源。';
      }

      document.querySelectorAll('#updateSourceModeGroup .update-source-mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
      });

      const modeGroup = $('updateSourceModeGroup');
      if (modeGroup) modeGroup.dataset.mode = mode;

      if (!rail) return;
      const activeIndex = Math.max(0, sources.findIndex((source) => source.id === selected?.id));
      if (!Number.isInteger(this._sourceCarouselIndex)) this._sourceCarouselIndex = activeIndex;
      this._sourceCarouselIndex = Math.max(0, Math.min(this._sourceCarouselIndex, Math.max(0, sources.length - 1)));
      rail.innerHTML = sources.map((source) => {
        const icon = source.type === 'github' ? 'ph-github-logo' : 'ph-hard-drives';
        const active = source.id === selected?.id && mode !== 'smart' ? ' active' : '';
        const confirmingDelete = this._sourcePendingDeleteId === source.id;
        const modeLabel = mode === 'smart'
          ? '参与智能检测'
          : (source.id === selected?.id ? '当前使用' : '点击切换');
        const host = compactRepoUrl(source.baseUrl);
        return `<article class="update-source-chip${active}${confirmingDelete ? ' delete-confirm' : ''}" data-source-id="${escapeHtml(source.id)}">
          <span class="update-source-chip-main">
            <span class="update-source-chip-icon"><i class="ph ${icon}"></i></span>
            <span class="update-source-chip-copy">
              <span class="update-source-chip-title">${escapeHtml(source.label)}</span>
              <span class="update-source-chip-url">${escapeHtml(compactRepoUrl(source.repoUrl))}</span>
            </span>
          </span>
          <span class="update-source-chip-meta">
            <span>${escapeHtml(host)}</span>
            <span>${escapeHtml(source.owner)}/${escapeHtml(source.repo)}</span>
          </span>
          <span class="update-source-chip-footer">
            <button type="button" class="update-source-mini-btn update-source-select-btn" data-action="select" data-source-id="${escapeHtml(source.id)}">${escapeHtml(modeLabel)}</button>
            <span class="update-source-chip-actions">
              <button type="button" class="update-source-icon-btn" data-action="edit" data-source-id="${escapeHtml(source.id)}" title="修改更新源"><i class="ph ph-pencil-simple"></i></button>
              <button type="button" class="update-source-icon-btn danger" data-action="delete" data-source-id="${escapeHtml(source.id)}" title="删除更新源"><i class="ph ph-trash"></i></button>
            </span>
          </span>
          ${confirmingDelete ? `<span class="update-source-delete-panel">
            <button type="button" class="update-source-delete-choice danger" data-action="confirm-delete" data-source-id="${escapeHtml(source.id)}"><i class="ph ph-trash"></i><span>删除</span></button>
            <button type="button" class="update-source-delete-choice" data-action="cancel-delete" data-source-id="${escapeHtml(source.id)}"><i class="ph ph-x"></i><span>取消</span></button>
          </span>` : ''}
        </article>`;
      }).join('');
      rail.style.transform = `translateX(${-100 * this._sourceCarouselIndex}%)`;

      if (dots) {
        dots.innerHTML = sources.map((source, index) => `<button type="button" class="update-source-dot${index === this._sourceCarouselIndex ? ' active' : ''}" data-source-index="${index}" aria-label="查看第 ${index + 1} 个更新源"></button>`).join('');
      }
      if (prevBtn) prevBtn.disabled = sources.length <= 1;
      if (nextBtn) nextBtn.disabled = sources.length <= 1;
      this.renderSourceDiagnostics(this._sourceDiagnostics || {}, { cfg, selected, mode });
    },

    renderSourceDiagnostics(result = {}, options = {}) {
      if (hasDiagnosticData(result)) this._sourceDiagnostics = result;
      const diagnostics = this._sourceDiagnostics || {};
      const cfg = options.cfg || this._lastSourceCfg || {};
      const sources = buildSourceList(cfg);
      const mode = options.mode || (cfg.updateSourceMode === 'smart' ? 'smart' : 'selected');
      const selectedId = cfg.activeUpdateSourceId || (cfg.updateSourceType === 'personal' ? 'personal-default' : 'github-default');
      const selected = options.selected || sources.find((source) => source.id === selectedId) || sources[0];
      const smartItems = Array.isArray(diagnostics.smartSources) ? diagnostics.smartSources : [];
      const selectedSmart = smartItems.find((item) => item.sourceId === selected?.id);
      const smartBest = smartItems.find((item) => item.sourceId === diagnostics.sourceId)
        || smartItems.slice().sort((a, b) => {
          const aError = a.error ? 1 : 0;
          const bError = b.error ? 1 : 0;
          if (aError !== bError) return aError - bError;
          return (Number(a.latencyMs) || Number.POSITIVE_INFINITY) - (Number(b.latencyMs) || Number.POSITIVE_INFINITY);
        })[0];
      const sourceResult = mode === 'smart'
        ? (diagnostics.sourceId ? diagnostics : smartBest)
        : (diagnostics.sourceId === selected?.id ? diagnostics : selectedSmart);
      const source = mode === 'smart'
        ? sources.find((item) => item.id === (sourceResult?.sourceId || diagnostics.sourceId)) || selected
        : selected;
      const label = mode === 'smart'
        ? (sourceResult?.sourceLabel || diagnostics.sourceLabel || source?.label || '等待检测')
        : (source?.label || '未选择');
      const repo = source?.repoUrl ? compactRepoUrl(source.repoUrl) : '待检测';
      const latency = sourceResult?.sourceLatencyMs ?? sourceResult?.latencyMs;
      const speed = pickDownloadSpeed(sourceResult || diagnostics);
      const elapsedMs = options.elapsedMs ?? latency;
      const hasInstaller = sourceResult && Object.prototype.hasOwnProperty.call(sourceResult, 'hasInstaller')
        ? sourceResult.hasInstaller
        : !!(sourceResult?.exeDownloadUrl || sourceResult?.zipDownloadUrl);
      const isChecking = !!options.checking;
      const statusKind = isChecking
        ? 'checking'
        : (sourceResult?.error
          ? 'error'
          : (sourceResult ? (hasInstaller ? (mode === 'smart' ? 'best' : 'success') : 'warn') : 'idle'));
      const status = statusMeta(statusKind);
      const latencyKind = isChecking ? 'checking' : latencyLevel(latency);
      const speedKind = isChecking ? 'checking' : speedLevel(speed);
      const installerKind = isChecking ? 'checking' : (sourceResult ? (hasInstaller ? 'good' : 'warn') : 'idle');
      const panel = $('updateSourceDiagnostics');
      if (!panel) return;
      panel.className = `update-source-diagnostics ${status.className}${isChecking ? ' is-checking' : ''}`;
      panel.innerHTML = `<div class="update-source-diagnostics-head">
          <span><i class="ph ph-gauge"></i>${mode === 'smart' ? '智能最优状态' : '当前仓库状态'}</span>
          <strong class="update-source-status-pill ${escapeHtml(status.className)}"><i class="ph ${escapeHtml(status.icon)}"></i>${escapeHtml(status.text)}</strong>
        </div>
        <div class="update-source-probe-meter" aria-hidden="true"><span></span></div>
        <div class="update-source-diagnostics-main">
          <div class="update-source-diagnostic-row is-neutral">
            <span><i class="ph ph-database"></i>仓库</span>
            <strong title="${escapeHtml(repo)}">${escapeHtml(label)}</strong>
          </div>
          <div class="update-source-diagnostic-row is-neutral">
            <span><i class="ph ph-link"></i>地址</span>
            <strong title="${escapeHtml(repo)}">${escapeHtml(repo)}</strong>
          </div>
          <div class="update-source-diagnostic-row is-${escapeHtml(latencyKind)}">
            <span><i class="ph ph-timer"></i>检测耗时</span>
            <strong>${escapeHtml(isChecking ? formatDuration(elapsedMs) : formatLatency(latency))}</strong>
          </div>
          <div class="update-source-diagnostic-row is-${escapeHtml(speedKind)}">
            <span><i class="ph ph-gauge"></i>预估速度</span>
            <strong>${escapeHtml(isChecking ? '采样中...' : formatSpeed(speed))}</strong>
          </div>
          <div class="update-source-diagnostic-row is-${escapeHtml(installerKind)}">
            <span><i class="ph ph-package"></i>安装资产</span>
            <strong>${escapeHtml(isChecking ? '检测中' : (sourceResult ? (hasInstaller ? '可用' : '未发现') : '待检测'))}</strong>
          </div>
          ${sourceResult?.error ? `<div class="update-source-diagnostic-row is-error">
            <span><i class="ph ph-warning"></i>错误</span>
            <strong title="${escapeHtml(sourceResult.error)}">${escapeHtml(sourceResult.error)}</strong>
          </div>` : ''}
        </div>`;
    },

    bindSourceControls(deps = {}) {
      if (this._sourceControlsBound) return;
      this._sourceControlsBound = true;
      const {
        getAllConfig,
        setConfig,
        setManyConfig,
        addLogLine = () => {},
        checkUpdate,
      } = deps;

      const triggerSilentCheck = async () => {
        if (typeof checkUpdate === 'function') {
          this._sourceDiagnosticsRequestRunning = true;
          this.startSourceDiagnosticsCheck();
          try {
            const result = await checkUpdate();
            this.finishSourceDiagnosticsCheck(result);
          } catch (e) {
            this.failSourceDiagnosticsCheck(e);
            console.error('[UpdatePage] silent check failed:', e);
          } finally {
            this._sourceDiagnosticsRequestRunning = false;
          }
        }
      };
      this._runSourceDiagnosticsCheck = triggerSilentCheck;
      if (this._pendingSourceDiagnosticsOnEnter) {
        this._pendingSourceDiagnosticsOnEnter = false;
        this.requestSourceDiagnosticsCheck({ force: true, reason: 'pending-enter-update-page' });
      }

      const refresh = async (patch = {}) => {
        const cfg = await getAllConfig?.() || {};
        this.renderSources({ ...cfg, ...patch });
        return cfg;
      };

      const rail = $('updateSourceRail');
      if (rail && !rail.dataset.dragBound) {
        rail.dataset.dragBound = 'true';
        rail.addEventListener('click', async (event) => {
          const actionEl = event.target?.closest?.('[data-action]');
          const chip = event.target?.closest?.('.update-source-chip');
          if (!chip) return;
          const cfg = await getAllConfig?.() || {};
          const source = buildSourceList(cfg).find((item) => item.id === chip.dataset.sourceId);
          if (!source) return;

          if (actionEl?.dataset.action === 'edit') {
            const input = $('updateSourceInput');
            const saveBtn = $('saveUpdateSourceBtn');
            if (input) input.value = source.repoUrl;
            if (saveBtn) {
              saveBtn.dataset.editSourceId = source.id;
              saveBtn.innerHTML = '<i class="ph ph-pencil-simple"></i> 更新当前源';
            }
            const inputWrap = input?.closest?.('.update-source-input-wrap') || input?.parentElement;
            inputWrap?.classList?.remove('editing');
            void inputWrap?.offsetWidth;
            inputWrap?.classList?.add('editing');
            input?.focus?.();
            input?.select?.();
            setTimeout(() => inputWrap?.classList?.remove('editing'), 1400);
            addLogLine('INFO', `正在修改更新源：${source.label}`);
            return;
          }

          if (actionEl?.dataset.action === 'delete') {
            this._sourcePendingDeleteId = source.id;
            this.renderSources(cfg);
            addLogLine('WARN', `请确认是否删除更新源：${source.label}`);
            return;
          }

          if (actionEl?.dataset.action === 'cancel-delete') {
            this._sourcePendingDeleteId = '';
            this.renderSources(cfg);
            return;
          }

          if (actionEl?.dataset.action === 'confirm-delete') {
            const existing = explicitSources(cfg);
            const nextExplicit = existing.filter((item) => item.id !== source.id);
            if (['github-default', 'personal-default'].includes(source.id)) {
              nextExplicit.push({ ...source, enabled: false });
            }
            const nextSources = buildSourceList({ ...cfg, updateSources: nextExplicit });
            const nextActive = nextSources[0] || null;
            const payload = {
              updateSources: nextExplicit,
              updateSourceMode: nextActive ? cfg.updateSourceMode || 'selected' : 'selected',
              ...sourcePayload(nextActive, { activeUpdateSourceId: nextActive?.id || '' }),
            };
            if (!nextActive) payload.activeUpdateSourceId = '';
            await setManyConfig?.(payload);
            this._sourceCarouselIndex = 0;
            this._sourcePendingDeleteId = '';
            this.renderSources({ ...cfg, ...payload });
            addLogLine('SUCCESS', `已删除更新源：${source.label}`);
            triggerSilentCheck();
            return;
          }

          const payload = {
            updateSourceMode: 'selected',
            ...sourcePayload(source),
          };
          await setManyConfig?.(payload);
          this.renderSources({ ...cfg, ...payload });
          addLogLine('INFO', `已切换更新源：${source.label} - ${source.repoUrl}`);
          triggerSilentCheck();
        });
      }

      const activateCarouselSource = async (cfg, sources, nextIndex) => {
        this._sourceCarouselIndex = nextIndex;
        if (cfg.updateSourceMode !== 'smart') {
          const nextSource = sources[nextIndex];
          const payload = {
            updateSourceMode: 'selected',
            ...sourcePayload(nextSource),
          };
          await setManyConfig?.(payload);
          this.renderSources({ ...cfg, ...payload });
          addLogLine('INFO', `已切换更新源：${nextSource.label} - ${nextSource.repoUrl}`);
          triggerSilentCheck();
          return;
        }
        this.renderSources(cfg);
      };

      const moveCarousel = async (delta) => {
        const cfg = await getAllConfig?.() || {};
        const sources = buildSourceList(cfg);
        if (sources.length <= 1) return;
        const nextIndex = ((this._sourceCarouselIndex || 0) + delta + sources.length) % sources.length;
        await activateCarouselSource(cfg, sources, nextIndex);
      };
      $('updateSourcePrevBtn')?.addEventListener('click', () => moveCarousel(-1));
      $('updateSourceNextBtn')?.addEventListener('click', () => moveCarousel(1));
      $('updateSourceDots')?.addEventListener('click', async (event) => {
        const dot = event.target?.closest?.('.update-source-dot');
        if (!dot) return;
        const cfg = await getAllConfig?.() || {};
        const sources = buildSourceList(cfg);
        const nextIndex = Math.max(0, Math.min(Number(dot.dataset.sourceIndex) || 0, sources.length - 1));
        await activateCarouselSource(cfg, sources, nextIndex);
      });

      document.querySelectorAll('#updateSourceModeGroup .update-source-mode-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const mode = btn.dataset.mode === 'smart' ? 'smart' : 'selected';
          await setConfig?.('updateSourceMode', mode);
          await refresh({ updateSourceMode: mode });
          addLogLine('INFO', `更新源模式：${mode === 'smart' ? '智能择优' : '手动选择'}`);
          triggerSilentCheck();
        });
      });

      $('saveUpdateSourceBtn')?.addEventListener('click', async () => {
        const btn = $('saveUpdateSourceBtn');
        const input = $('updateSourceInput');
        if (!btn || !input) return;
        const defaultSaveHtml = '<i class="ph ph-floppy-disk"></i> 保存更新源';
        const parsed = parseRepoInput(input.value);
        if (!parsed) {
          addLogLine('WARN', '请输入 GitHub 或个人服务器仓库地址');
          return;
        }

        const origHtml = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-circle-notch" style="animation:spin 0.8s linear infinite"></i> 保存中...';
        btn.disabled = true;

        try {
          const existingCfg = await getAllConfig?.() || {};
          const editSourceId = btn.dataset.editSourceId || '';
          const editingSource = editSourceId ? buildSourceList(existingCfg).find((source) => source.id === editSourceId) : null;
          const savedSources = visibleSourcesFromExplicit(explicitSources(existingCfg))
            .filter((source) => source.id !== editSourceId && !['github-default', 'personal-default'].includes(source.id));
          const savedSource = normalizeSource({
            id: editingSource?.id || sourceIdForParsed(parsed),
            type: parsed.type,
            label: sourceTypeLabel(parsed.type),
            baseUrl: parsed.baseUrl,
            owner: parsed.owner,
            repo: parsed.repo,
            repoUrl: parsed.repoUrl,
            priority: editingSource?.priority || savedSources.length + 10,
          });
          const nextUpdateSources = ['github-default', 'personal-default'].includes(savedSource.id)
            ? explicitSources(existingCfg).filter((source) => source.id !== savedSource.id)
            : [...savedSources.filter((source) => source.id !== savedSource.id), savedSource];
          const payload = {
            updateSources: nextUpdateSources,
            updateSourceMode: 'selected',
            ...sourcePayload(savedSource),
          };
          await setManyConfig?.(payload);
          this.renderSources({ ...existingCfg, ...payload });
          btn.innerHTML = '<i class="ph ph-check-circle"></i> 已保存';
          addLogLine('SUCCESS', `${editSourceId ? '已修改' : '已保存'}更新源：${sourceTypeLabel(parsed.type)} - ${parsed.repoUrl}`);
          input.value = '';
          delete btn.dataset.editSourceId;
          triggerSilentCheck();
          setTimeout(() => { btn.innerHTML = editSourceId ? defaultSaveHtml : origHtml; btn.disabled = false; }, 1500);
        } catch (error) {
          addLogLine('ERROR', `更新源保存失败：${error.message}`);
          btn.innerHTML = origHtml;
          btn.disabled = false;
        }
      });
    },

    setChecking() {
      const btn = $('checkUpdateBtn');
      const icon = $('checkUpdateIcon');
      if (btn) btn.disabled = true;
      if (icon) {
        icon.className = 'ph ph-circle-notch';
        icon.style.animation = 'spin 0.8s linear infinite';
      }
      setBadge('info', '<i class="ph ph-arrows-clockwise"></i> Checking');
      this.startSourceDiagnosticsCheck();
    },

    setLatest() {
      const btn = $('checkUpdateBtn');
      if (btn) {
        btn.disabled = false;
        btn._updateMode = 'check';
      }
      this.stopSourceDiagnosticsTimer();
      setCheckButton('check', '检查更新', 'ph ph-arrows-clockwise');
      setBadge('success', '<i class="ph ph-check-circle"></i> 已是最新');
    },

    setError(message, options = {}) {
      const btn = $('checkUpdateBtn');
      const icon = $('checkUpdateIcon');
      if (btn) {
        btn.disabled = false;
        btn._updateMode = 'check';
      }
      this.stopSourceDiagnosticsTimer();
      setCheckButton('check', options.label || '检查更新', 'ph ph-arrows-clockwise');
      if (icon) icon.style.animation = '';
      setBadge(options.isConfigError ? 'error' : 'error', options.badgeHtml || '<i class="ph ph-warning"></i> 检查失败');
      return message;
    },

    setAvailable(result = {}) {
      const btn = $('checkUpdateBtn');
      if (btn) {
        btn.disabled = false;
        btn._updateMode = 'download';
        btn.classList.remove('rollback-install-btn');
        btn.classList.add('primary');
      }
      this.stopSourceDiagnosticsTimer();
      setCheckButton('download', '立刻更新', 'ph ph-download-simple');
      setBadge(result.forceUpdate ? 'error' : 'warn', result.forceUpdate
        ? `<i class="ph ph-warning"></i> 强制更新 v${escapeHtml(result.latestVersion || '')}`
        : `<i class="ph ph-arrow-circle-up"></i> 发现新版本 v${escapeHtml(result.latestVersion || '')}`);
      document.querySelector('.nav-item[data-target="page-update"]')?.classList.add('has-update');
    },

    setSkipped(version) {
      const btn = $('checkUpdateBtn');
      if (btn) btn._updateMode = 'check';
      this.stopSourceDiagnosticsTimer();
      setCheckButton('check', '检查更新', 'ph ph-arrows-clockwise');
      setBadge('success', `<i class="ph ph-check-circle"></i> 已跳过 v${escapeHtml(version || '')}`);
    },

    setPendingInstall(version) {
      const btn = $('checkUpdateBtn');
      if (btn) {
        btn._updateMode = 'install-pending';
        btn.classList.remove('rollback-install-btn');
        btn.classList.add('primary');
      }
      this.stopSourceDiagnosticsTimer();
      setCheckButton('install-pending', '立即安装', 'ph ph-package');
      setBadge('warn', `<i class="ph ph-arrow-circle-up"></i> 已下载 v${escapeHtml(version || '')}，等待安装`);
      document.querySelector('.nav-item[data-target="page-update"]')?.classList.add('has-update');
    },

    showDialog(result = {}) {
      const overlay = $('updateDialogOverlay');
      if (!overlay) return false;
      overlay.__updateResult = result;
      overlay._updateResult = result;

      const currentVersion = result.currentVersion || result.version || '--';
      const latestVersion = result.latestVersion || result.tagName || '--';
      const publishedAt = result.publishedAt || result.releaseDate || result.date || '';

      if ($('updateDialogCurrentVer')) $('updateDialogCurrentVer').textContent = currentVersion;
      if ($('updateDialogNewVer')) $('updateDialogNewVer').textContent = latestVersion;
      if ($('updateDialogSize')) $('updateDialogSize').innerHTML = `<i class="ph ph-hard-drive"></i> ${formatFileSize(result.downloadSize)}`;
      if ($('updateDialogDate')) $('updateDialogDate').innerHTML = `<i class="ph ph-calendar"></i> ${escapeHtml(publishedAt ? String(publishedAt).slice(0, 10) : '--')}`;
      if ($('updateDialogChannel')) $('updateDialogChannel').innerHTML = `<i class="ph ph-tag"></i> ${escapeHtml(result.channel || 'Stable')}`;
      if ($('updateDialogNotes')) $('updateDialogNotes').innerHTML = releaseNotesToHtml(result.releaseNotes || result.notes || result.body || '');

      const forceBanner = $('updateDialogForceBanner');
      if (forceBanner) forceBanner.style.display = result.forceUpdate ? '' : 'none';
      const closeBtn = $('updateDialogClose');
      const skipBtn = $('updateDialogSkipBtn');
      if (closeBtn) closeBtn.style.display = result.forceUpdate ? 'none' : '';
      if (skipBtn) skipBtn.style.display = result.forceUpdate ? 'none' : '';

      overlay.classList.add('show');
      return true;
    },

    getDialogResult,

    hideDialog() {
      const overlay = $('updateDialogOverlay');
      if (!overlay) return false;
      overlay.classList.remove('show');
      return true;
    },

    bindDialogActions(actions = {}) {
      if (this._dialogActionsBound) return;
      this._dialogActionsBound = true;

      $('updateDialogClose')?.addEventListener('click', () => actions.onClose?.());

      $('updateDialogOverlay')?.addEventListener('click', (event) => {
        if (event.target.id !== 'updateDialogOverlay') return;
        const result = getDialogResult();
        if (result?.forceUpdate) return;
        actions.onClose?.();
      });

      $('updateDialogSkipBtn')?.addEventListener('click', () => {
        actions.onSkip?.(getDialogResult());
      });

      $('updateDialogInstallBtn')?.addEventListener('click', () => {
        actions.onInstall?.(getDialogResult());
      });
    },
  };

  window._nekoModules.pages.UpdatePage = UpdatePage;
})();

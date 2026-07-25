(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  function $(id) {
    return document.getElementById(id);
  }

  function setProgressPanelVisible(visible, options = {}) {
    const panel = $('updateProgressPanel');
    const setter = window._nekoUIHelpers?.setExpandableSectionState;
    if (panel && typeof setter === 'function') {
      setter(panel, visible, { display: 'grid', duration: 220, ...options });
      return;
    }
    const row = $('updateProgressRow');
    if (row) row.style.display = visible ? '' : 'none';
  }

  function setProgressBarVisible(visible) {
    const bar = $('updateProgressBar');
    if (!bar) return;
    if ($('updateProgressPanel')) {
      bar.classList?.toggle?.('is-progress-bar-hidden', !visible);
      bar.setAttribute?.('aria-hidden', visible ? 'false' : 'true');
      return;
    }
    bar.style.display = visible ? '' : 'none';
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

  function getInstalledChannel(version) {
    const value = String(version || '').toLowerCase();
    if (value.includes('-nightly')) return 'nightly';
    if (value.includes('-beta')) return 'beta';
    return 'stable';
  }

  const installedChannelNameMap = { stable: '稳定版', beta: 'Beta', nightly: 'Nightly' };
  const installedChannelTagMap = { stable: 'Stable', beta: 'Beta', nightly: 'Nightly' };

  function setBadge(kind, html) {
    const badge = $('updateStatusBadge');
    if (!badge) return;
    badge.className = `update-status-badge ${kind}`;
    badge.innerHTML = html;
    badge.title = String(badge.textContent || '').trim();
  }

  function versionText(version) {
    const value = String(version || '').trim();
    return value ? `v${escapeHtml(value)}` : '';
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

  function isOfficialSource(source = {}) {
    return source.type === 'github'
      && String(source.owner || '').toLowerCase() === 'neko-nf'
      && String(source.repo || '').toLowerCase() === 'neko-status-desktop';
  }

  function sourceKindLabel(source = {}) {
    if (isOfficialSource(source)) return '官方仓库';
    return source.type === 'github' ? 'GitHub' : '个人仓库';
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

  function placeholderSourceFor(displayIndex) {
    const number = displayIndex + 1;
    return {
      id: `placeholder-${number}`,
      type: 'placeholder',
      label: `示例源 ${number}`,
      owner: 'team',
      repo: `neko-status-${number}`,
      baseUrl: 'https://example.com',
      repoUrl: `https://example.com/team/neko-status-${number}`,
      isPlaceholder: true,
      enabled: true,
      priority: number,
    };
  }

  function buildDisplaySourceList(sources = []) {
    const items = sources.slice();
    while (items.length < 3) {
      items.push(placeholderSourceFor(items.length));
    }
    return items;
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

  function scoreDiagnosticSource(item = {}) {
    if (item.error) return Number.POSITIVE_INFINITY;
    const latency = Number(item.sourceLatencyMs ?? item.latencyMs);
    const speed = Number(pickDownloadSpeed(item));
    const installerPenalty = item.hasInstaller ? 0 : 50000;
    const updateBonus = item.hasUpdate ? -100000 : 0;
    const speedBonus = Number.isFinite(speed) && speed > 0 ? -Math.min(speed / 1024, 25000) : 0;
    return (Number.isFinite(latency) ? latency : 999999) + installerPenalty + updateBonus + speedBonus;
  }

  function statusMeta(kind) {
    const map = {
      checking: { icon: 'ph-circle-notch', text: '检测中', className: 'checking' },
      success: { icon: 'ph-check-circle', text: '已检测', className: 'success' },
      best: { icon: 'ph-sparkle', text: '当前最优', className: 'success' },
      warn: { icon: 'ph-warning-circle', text: '资产缺失', className: 'warn' },
      degraded: { icon: 'ph-gauge', text: '状态一般', className: 'warn' },
      slow: { icon: 'ph-timer', text: '连接过慢', className: 'error' },
      error: { icon: 'ph-warning', text: '检测失败', className: 'error' },
      idle: { icon: 'ph-clock', text: '待检测', className: 'idle' },
    };
    return map[kind] || map.idle;
  }

  const UpdatePage = {
    _checkingLoader: null,

    ensureCheckingLoader() {
      if (this._checkingLoader) return this._checkingLoader;
      const host = $('updateCheckingLoaderHost');
      this._checkingLoader = window._nekoModules?.components?.LoadingSystem?.create?.(host, {
        context: 'search',
        mode: 'section',
        size: 'md',
        label: '正在检查更新与来源…',
      }) || null;
      return this._checkingLoader;
    },

    init(deps = {}) {
      this._deps = { ...(this._deps || {}), ...deps };
      this.bindBackendControls();
      this.bindUpdateActions();
      if (this._inited) return;
      this._inited = true;
      document.querySelector('.nav-item[data-target="page-update"]')?.addEventListener('click', (event) => {
        event.currentTarget.classList.remove('has-update');
      });
      this.requestSourceDiagnosticsCheck({ reason: 'enter-update-page', oncePerSession: true });
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

    setSourceProbeButtonChecking(checking) {
      const btn = $('updateSourceProbeBtn');
      if (!btn) return;
      btn.disabled = !!checking;
      btn.innerHTML = checking
        ? '<i class="ph ph-circle-notch ph-spin"></i><span>检测中</span>'
        : '<i class="ph ph-gauge"></i><span>重新检测</span>';
      btn.title = checking ? '检测中' : '重新检测更新源';
      btn.setAttribute('aria-label', btn.title);
    },

    requestSourceDiagnosticsCheck(options = {}) {
      const runner = this._runSourceDiagnosticsCheck;
      const isEnter = options.oncePerSession || options.reason === 'enter-update-page';
      const cfg = options.cfg || this._lastSourceCfg || {};
      const mode = options.mode || (cfg.updateSourceMode === 'smart' ? 'smart' : 'selected');
      const isSmartEnter = isEnter && mode === 'smart';
      if (!options.force && isSmartEnter && this._sourceDiagnosticsCheckedOnce) return false;
      if (typeof runner !== 'function') {
        this._pendingSourceDiagnosticsOnEnter = true;
        return false;
      }
      if (this._sourceDiagnosticsRequestRunning) {
        if (options.latestWins) this._queuedSourceDiagnosticsOptions = { ...options, force: true };
        return false;
      }
      if (this._sourceDiagnosticTimerId) {
        this.stopSourceDiagnosticsTimer();
        this._sourceDiagnosticStartedAt = 0;
      }
      const now = Date.now();
      if (!options.force && this._lastSourceDiagnosticsRequestedAt && now - this._lastSourceDiagnosticsRequestedAt < 3000) {
        return false;
      }
      this._lastSourceDiagnosticsRequestedAt = now;
      if (isSmartEnter) this._sourceDiagnosticsCheckedOnce = true;
      const requestSeq = (this._sourceDiagnosticsRequestSeq || 0) + 1;
      this._sourceDiagnosticsRequestSeq = requestSeq;
      runner({ ...options, requestSeq });
      return true;
    },

    scheduleSourceDiagnosticsCheck(options = {}, delayMs = 320) {
      if (this._sourceDiagnosticsDebounceTimer) clearTimeout(this._sourceDiagnosticsDebounceTimer);
      this._sourceDiagnosticsDebounceTimer = setTimeout(() => {
        this._sourceDiagnosticsDebounceTimer = 0;
        this.requestSourceDiagnosticsCheck({
          ...options,
          force: true,
          latestWins: true,
        });
      }, delayMs);
    },

    renderSources(cfg = {}) {
      this._lastSourceCfg = cfg;
      const sources = buildSourceList(cfg);
      const displaySources = buildDisplaySourceList(sources);
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
        const carouselItem = displaySources[this._sourceCarouselIndex || 0];
        currentUrlSpan.textContent = mode === 'smart'
          ? `智能模式将检测 ${sources.length} 个已保存更新源`
          : (carouselItem?.isPlaceholder
            ? '占位槽：保存新源后自动替换'
            : compactRepoUrl(selected?.repoUrl || 'github.com/Neko-NF/Neko-Status-Desktop'));
      }

      if (currentLabel) {
        currentLabel.textContent = mode === 'smart' ? '智能择优' : '当前使用';
      }

      if (sourceCount) {
        sourceCount.textContent = `${sources.length} 个源 / ${displaySources.length} 个槽位`;
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
      this._sourceCarouselIndex = Math.max(0, Math.min(this._sourceCarouselIndex, Math.max(0, displaySources.length - 1)));
      const currentIndex = this._sourceCarouselIndex;
      const renderedIndex = Number.isInteger(this._renderedCarouselIndex) ? this._renderedCarouselIndex : currentIndex;
      const stackClassFor = (index, baseIndex) => {
        const nextIndex = displaySources.length > 1 ? (baseIndex + 1) % displaySources.length : -1;
        const prevIndex = displaySources.length > 2 ? (baseIndex - 1 + displaySources.length) % displaySources.length : -1;
        if (index === baseIndex) return 'is-current';
        if (index === prevIndex) return 'is-prev';
        if (index === nextIndex) return 'is-next';
        return 'is-hidden';
      };
      const applyStackClasses = (baseIndex) => {
        rail.querySelectorAll('.update-source-chip').forEach((chip) => {
          chip.classList.remove('is-current', 'is-prev', 'is-next', 'is-hidden', 'is-preview-clone-visible');
          const stackClass = stackClassFor(Number(chip.dataset.sourceIndex) || 0, baseIndex);
          stackClass
            .split(' ')
            .filter(Boolean)
            .forEach((className) => chip.classList.add(className));
        });
      };
      const sourceCards = displaySources.map((source, index) => {
        const isPlaceholder = !!source.isPlaceholder;
        const icon = isPlaceholder ? 'ph-plus-circle' : (source.type === 'github' ? 'ph-github-logo' : 'ph-hard-drives');
        const active = !isPlaceholder && source.id === selected?.id && mode !== 'smart' ? ' active' : '';
        const confirmingDelete = this._sourcePendingDeleteId === source.id;
        const animateDeleteFlip = this._sourceFlipTargetId === source.id;
        const stackClass = ` ${stackClassFor(index, renderedIndex)}`;
        const sourceNumber = String(index + 1).padStart(2, '0');
        const modeLabel = mode === 'smart'
          ? (isPlaceholder ? '等待填写' : '参与智能检测')
          : (isPlaceholder ? '填写此槽' : (source.id === selected?.id ? '当前使用' : '点击切换'));
        const typeLabel = isPlaceholder ? '占位槽' : sourceKindLabel(source);
        const host = isPlaceholder ? compactRepoUrl(source.baseUrl) : compactRepoUrl(source.baseUrl);
        const title = isPlaceholder ? '待添加更新源' : source.label;
        const repoUrl = isPlaceholder ? '示例：example.com/team/neko-status' : compactRepoUrl(source.repoUrl);
        const action = isPlaceholder ? 'placeholder-fill' : 'select';
        return `<article class="update-source-chip${stackClass}${active}${isPlaceholder ? ' update-source-placeholder' : ''}${confirmingDelete && !animateDeleteFlip ? ' delete-confirm' : ''}" data-source-id="${escapeHtml(source.id)}" data-source-index="${index}" data-placeholder="${isPlaceholder ? 'true' : 'false'}">
          <span class="update-source-card-inner">
            <span class="update-source-card-face update-source-card-front">
              <span class="update-source-card-number" aria-label="第 ${index + 1} 个更新源">${escapeHtml(sourceNumber)}</span>
              <span class="update-source-chip-main">
                <span class="update-source-chip-icon"><i class="ph ${icon}"></i></span>
                <span class="update-source-chip-copy">
                  <span class="update-source-chip-title">${escapeHtml(title)}</span>
                  <span class="update-source-chip-url">${escapeHtml(repoUrl)}</span>
                </span>
              </span>
              <span class="update-source-chip-status">
                <span class="update-source-kind">${escapeHtml(typeLabel)}</span>
                <button type="button" class="update-source-mini-btn update-source-select-btn" data-action="${escapeHtml(action)}" data-source-id="${escapeHtml(source.id)}">${escapeHtml(modeLabel)}</button>
              </span>
              <span class="update-source-chip-meta">
                <span class="update-source-meta-item">
                  <span>服务器</span>
                  <strong title="${escapeHtml(host)}">${escapeHtml(host)}</strong>
                </span>
                <span class="update-source-meta-item">
                  <span>仓库路径</span>
                  <strong title="${escapeHtml(source.owner)}/${escapeHtml(source.repo)}">${escapeHtml(source.owner)}/${escapeHtml(source.repo)}</strong>
                </span>
              </span>
              <span class="update-source-chip-footer">
                <span class="update-source-chip-actions">
                  <button type="button" class="update-source-icon-btn" data-action="${isPlaceholder ? 'placeholder-fill' : 'edit'}" data-source-id="${escapeHtml(source.id)}" title="${isPlaceholder ? '填写占位槽' : '修改更新源'}" aria-label="${isPlaceholder ? '填写占位槽' : '修改更新源'}"><i class="ph ${isPlaceholder ? 'ph-plus' : 'ph-pencil-simple'}"></i><span>${isPlaceholder ? '填写' : '修改'}</span></button>
                  ${isPlaceholder ? '<button type="button" class="update-source-icon-btn disabled" disabled aria-disabled="true"><i class="ph ph-lock-simple"></i><span>保留</span></button>' : `<button type="button" class="update-source-icon-btn danger" data-action="delete" data-source-id="${escapeHtml(source.id)}" title="删除更新源" aria-label="删除更新源"><i class="ph ph-trash"></i><span>删除</span></button>`}
                </span>
              </span>
            </span>
            ${isPlaceholder ? '' : `<span class="update-source-card-face update-source-card-back">
              <span class="update-source-delete-message">
                <strong>删除此更新源？</strong>
                <small>删除后将自动切换到下一个可用源。</small>
              </span>
              <span class="update-source-delete-actions">
                <button type="button" class="update-source-delete-choice danger" data-action="confirm-delete" data-source-id="${escapeHtml(source.id)}"><i class="ph ph-trash"></i><span>确认删除</span></button>
                <button type="button" class="update-source-delete-choice" data-action="cancel-delete" data-source-id="${escapeHtml(source.id)}"><i class="ph ph-x"></i><span>取消</span></button>
              </span>
            </span>`}
          </span>
        </article>`;
      });
      rail.innerHTML = sourceCards.join('');
      rail.style.transform = 'translateX(0)';
      const animateDeleteFlipId = this._sourceFlipTargetId;
      if (animateDeleteFlipId) {
        const scheduleFrame = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
        scheduleFrame(() => {
          Array.from(rail.querySelectorAll('.update-source-chip'))
            .find((chip) => chip.dataset.sourceId === animateDeleteFlipId)
            ?.classList.add('delete-confirm');
          this._sourceFlipTargetId = '';
        });
      }
      if (renderedIndex !== currentIndex) {
        const scheduleFrame = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
        scheduleFrame(() => applyStackClasses(currentIndex));
      } else {
        applyStackClasses(currentIndex);
      }
      this._renderedCarouselIndex = currentIndex;

      if (dots) {
        const isSwitching = renderedIndex !== currentIndex;
        dots.classList.toggle('is-switching', isSwitching);
        dots.dataset.direction = isSwitching && currentIndex > renderedIndex ? 'next' : (isSwitching ? 'prev' : 'idle');
        dots.innerHTML = displaySources.map((source, index) => {
          const isActive = index === this._sourceCarouselIndex;
          const label = `查看第 ${index + 1} 个${source.isPlaceholder ? '占位槽' : '更新源'}`;
          return `<button type="button" class="update-source-dot${isActive ? ' active' : ''}" data-source-index="${index}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"${isActive ? ' aria-current="true"' : ''}><span aria-hidden="true"></span></button>`;
        }).join('');
        if (isSwitching) {
          const clearSwitching = typeof setTimeout === 'function'
            ? setTimeout
            : ((fn) => {
              const scheduleFrame = window.requestAnimationFrame || ((run) => run());
              scheduleFrame(fn);
              return 0;
            });
          clearSwitching(() => dots.classList.remove('is-switching'), 320);
        }
      }
      if (prevBtn) prevBtn.disabled = displaySources.length <= 1;
      if (nextBtn) nextBtn.disabled = displaySources.length <= 1;
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
        || smartItems.slice().sort((a, b) => scoreDiagnosticSource(a) - scoreDiagnosticSource(b))[0];
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
      const latencyKind = isChecking ? 'checking' : latencyLevel(latency);
      const speedKind = isChecking ? 'checking' : speedLevel(speed);
      const installerKind = isChecking ? 'checking' : (sourceResult ? (hasInstaller ? 'good' : 'warn') : 'idle');
      const statusKind = isChecking
        ? 'checking'
        : (sourceResult?.error
          ? 'error'
          : (!sourceResult
            ? 'idle'
            : (!hasInstaller
              ? 'warn'
              : (latencyKind === 'error'
                ? 'slow'
                : (speedKind === 'error' || latencyKind === 'warn' || speedKind === 'warn'
                  ? 'degraded'
                  : (mode === 'smart' ? 'best' : 'success'))))));
      const status = statusMeta(statusKind);
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

      const triggerSilentCheck = async (options = {}) => {
        if (typeof checkUpdate === 'function') {
          const requestSeq = options.requestSeq || this._sourceDiagnosticsRequestSeq || 0;
          this._sourceDiagnosticsRequestRunning = true;
          this.setSourceProbeButtonChecking(true);
          this.startSourceDiagnosticsCheck();
          try {
            const result = await checkUpdate();
            if (requestSeq === this._sourceDiagnosticsRequestSeq) this.finishSourceDiagnosticsCheck(result);
          } catch (e) {
            if (requestSeq === this._sourceDiagnosticsRequestSeq) this.failSourceDiagnosticsCheck(e);
            console.error('[UpdatePage] silent check failed:', e);
          } finally {
            this._sourceDiagnosticsRequestRunning = false;
            const queued = this._queuedSourceDiagnosticsOptions;
            this._queuedSourceDiagnosticsOptions = null;
            if (queued) {
              this.requestSourceDiagnosticsCheck({ ...queued, force: true, latestWins: true });
              return;
            }
            this.setSourceProbeButtonChecking(false);
          }
        }
      };
      this._runSourceDiagnosticsCheck = triggerSilentCheck;
      if (this._pendingSourceDiagnosticsOnEnter) {
        this._pendingSourceDiagnosticsOnEnter = false;
        this.requestSourceDiagnosticsCheck({ force: true, reason: 'enter-update-page', oncePerSession: true });
      }

      const refresh = async (patch = {}) => {
        const cfg = await getAllConfig?.() || {};
        this.renderSources({ ...cfg, ...patch });
        return cfg;
      };

      const probeBtn = $('updateSourceProbeBtn');
      if (probeBtn && !probeBtn.dataset.probeBound) {
        probeBtn.dataset.probeBound = 'true';
        probeBtn.addEventListener('click', () => {
          if (probeBtn.disabled) return;
          this.requestSourceDiagnosticsCheck({ force: true, latestWins: true, reason: 'source-probe-button' });
        });
      }

      const rail = $('updateSourceRail');
      if (rail && !rail.dataset.dragBound) {
        rail.dataset.dragBound = 'true';
        rail.addEventListener('click', async (event) => {
          const actionEl = event.target?.closest?.('[data-action]');
          const chip = event.target?.closest?.('.update-source-chip');
          if (!chip) return;
          const cfg = await getAllConfig?.() || {};
          const sources = buildSourceList(cfg);
          const displaySources = buildDisplaySourceList(sources);
          const hasSourceIndex = Object.prototype.hasOwnProperty.call(chip.dataset || {}, 'sourceIndex');
          const chipIndex = hasSourceIndex
            ? Math.max(0, Math.min(Number(chip.dataset.sourceIndex) || 0, displaySources.length - 1))
            : Math.max(0, displaySources.findIndex((item) => item.id === chip.dataset.sourceId));
          const source = displaySources[chipIndex] || displaySources.find((item) => item.id === chip.dataset.sourceId);
          if (!source) return;
          const isPlaceholder = !!source.isPlaceholder;

          if (isPlaceholder) {
            this._sourceCarouselIndex = chipIndex;
            if (actionEl?.dataset.action === 'placeholder-fill' || actionEl?.dataset.action === 'select' || !actionEl) {
              const input = $('updateSourceInput');
              const saveBtn = $('saveUpdateSourceBtn');
              if (saveBtn) {
                delete saveBtn.dataset.editSourceId;
                saveBtn.dataset.placeholderIndex = String(chipIndex);
                saveBtn.innerHTML = '<i class="ph ph-plus-circle"></i> 填充占位槽';
              }
              input?.focus?.();
              input?.select?.();
              this.renderSources(cfg);
              addLogLine('INFO', `正在填写第 ${chipIndex + 1} 个更新源槽位`);
            }
            return;
          }

          if (actionEl?.dataset.action === 'edit') {
            const input = $('updateSourceInput');
            const saveBtn = $('saveUpdateSourceBtn');
            if (input) input.value = source.repoUrl;
            if (saveBtn) {
              saveBtn.dataset.editSourceId = source.id;
              delete saveBtn.dataset.placeholderIndex;
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
            this._sourceFlipTargetId = source.id;
            this.renderSources(cfg);
            addLogLine('WARN', `请确认是否删除更新源：${source.label}`);
            return;
          }

          if (actionEl?.dataset.action === 'cancel-delete') {
            const cancelId = source.id;
            chip.classList.remove('delete-confirm');
            if (this._sourceFlipBackTimerId) clearTimeout(this._sourceFlipBackTimerId);
            this._sourceFlipBackTimerId = setTimeout(() => {
              if (this._sourcePendingDeleteId === cancelId) this._sourcePendingDeleteId = '';
              this._sourceFlipBackTimerId = null;
              this.renderSources(cfg);
            }, 820);
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
            return;
          }

          const payload = {
            updateSourceMode: 'selected',
            ...sourcePayload(source),
          };
          await setManyConfig?.(payload);
          this.renderSources({ ...cfg, ...payload });
          addLogLine('INFO', `已切换更新源：${source.label} - ${source.repoUrl}`);
          this.scheduleSourceDiagnosticsCheck({ reason: 'manual-source-selected' });
        });
      }

      const activateCarouselSource = async (cfg, sources, nextIndex) => {
        this._sourceCarouselIndex = nextIndex;
        const nextSource = sources[nextIndex];
        if (nextSource?.isPlaceholder) {
          this.renderSources(cfg);
          addLogLine('INFO', `已切换到第 ${nextIndex + 1} 个占位槽，保存新源后会自动替换`);
          return;
        }
        if (cfg.updateSourceMode !== 'smart') {
          const payload = {
            updateSourceMode: 'selected',
            ...sourcePayload(nextSource),
          };
          await setManyConfig?.(payload);
          this.renderSources({ ...cfg, ...payload });
          addLogLine('INFO', `已切换更新源：${nextSource.label} - ${nextSource.repoUrl}`);
          this.scheduleSourceDiagnosticsCheck({ reason: 'manual-source-carousel' });
          return;
        }
        this.renderSources(cfg);
      };

      const moveCarousel = async (delta) => {
        const cfg = await getAllConfig?.() || {};
        const sources = buildDisplaySourceList(buildSourceList(cfg));
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
        const sources = buildDisplaySourceList(buildSourceList(cfg));
        const nextIndex = Math.max(0, Math.min(Number(dot.dataset.sourceIndex) || 0, sources.length - 1));
        await activateCarouselSource(cfg, sources, nextIndex);
      });

      document.querySelectorAll('#updateSourceModeGroup .update-source-mode-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const mode = btn.dataset.mode === 'smart' ? 'smart' : 'selected';
          await setConfig?.('updateSourceMode', mode);
          await refresh({ updateSourceMode: mode });
          addLogLine('INFO', `更新源模式：${mode === 'smart' ? '智能择优' : '手动选择'}`);
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
        window._nekoUIHelpers?.setButtonBusy?.(btn, true, { label: '保存中…' });

        try {
          const existingCfg = await getAllConfig?.() || {};
          const editSourceId = btn.dataset.editSourceId || '';
          const placeholderIndex = Number(btn.dataset.placeholderIndex);
          const currentDisplaySources = buildDisplaySourceList(buildSourceList(existingCfg));
          const currentCarouselIndex = Number.isInteger(this._sourceCarouselIndex) ? this._sourceCarouselIndex : -1;
          const targetSlotIndex = Number.isInteger(placeholderIndex) && placeholderIndex >= 0
            ? placeholderIndex
            : (currentDisplaySources[currentCarouselIndex]?.isPlaceholder ? currentCarouselIndex : -1);
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
            priority: editingSource?.priority || (targetSlotIndex >= 0 ? targetSlotIndex + 1 : savedSources.length + 10),
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
          this._sourceCarouselIndex = targetSlotIndex >= 0 ? targetSlotIndex : Math.max(0, buildSourceList({ ...existingCfg, ...payload }).findIndex((source) => source.id === savedSource.id));
          this.renderSources({ ...existingCfg, ...payload });
          window._nekoUIHelpers?.setButtonBusy?.(btn, false);
          btn.innerHTML = '<i class="ph ph-check-circle"></i> 已保存';
          addLogLine('SUCCESS', `${editSourceId ? '已修改' : '已保存'}更新源：${sourceTypeLabel(parsed.type)} - ${parsed.repoUrl}`);
          input.value = '';
          delete btn.dataset.editSourceId;
          delete btn.dataset.placeholderIndex;
          this.requestSourceDiagnosticsCheck({ force: true, reason: editSourceId ? 'source-updated' : 'source-added' });
          setTimeout(() => { btn.innerHTML = defaultSaveHtml || origHtml; btn.disabled = false; }, 1500);
        } catch (error) {
          addLogLine('ERROR', `更新源保存失败：${error.message}`);
          window._nekoUIHelpers?.setButtonBusy?.(btn, false);
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
        icon.className = 'ph ph-circle-notch ph-spin';
        icon.style.animation = '';
      }
      setBadge('info', '<i class="ph ph-arrow-clockwise"></i> Checking');
      this.startSourceDiagnosticsCheck();
    },

    bindUpdateActions() {
      if (this._updateActionsBound) return;
      this._updateActionsBound = true;

      $('checkUpdateBtn')?.addEventListener('click', () => this.checkForUpdates());
      $('forceUpdateBtn')?.addEventListener('click', () => this.forceUpdate());
      $('rollbackBtn')?.addEventListener('click', () => this.rollbackVersion());
    },

    async checkForUpdates() {
      const {
        addLogLine = () => {},
        showNotice = () => {},
        update,
        config,
      } = this._deps || {};
      const btn = $('checkUpdateBtn');
      const icon = $('checkUpdateIcon');
      const label = $('checkUpdateLabel');
      if (!btn || btn.disabled) return null;

      if (btn._updateMode === 'install-pending') {
        return this.installPendingUpdate();
      }

      if (btn._updateMode === 'download' && this._lastUpdateResult?.hasUpdate) {
        if (await this.syncPendingInstallForVersion(this._lastUpdateResult.latestVersion)) {
          return this.installPendingUpdate();
        }
        btn.disabled = true;
        if (icon) { icon.className = 'ph ph-circle-notch ph-spin'; icon.style.animation = ''; }
        if (label) label.textContent = '下载中...';
        await this.downloadAndInstall(this._lastUpdateResult);
        if (btn._updateMode !== 'install-pending') {
          btn.disabled = false;
          if (icon) { icon.className = 'ph ph-download-simple'; icon.style.animation = ''; }
          if (label) label.textContent = '立刻更新';
        }
        return this._lastUpdateResult;
      }

      if (btn._updateMode === 'rollback-install' && btn._rollbackData) {
        btn.disabled = true;
        if (icon) { icon.className = 'ph ph-circle-notch ph-spin'; icon.style.animation = ''; }
        if (label) label.textContent = '安装中...';
        await this.downloadAndInstall(btn._rollbackData);
        return btn._rollbackData;
      }

      this.showCheckingProgress();
      btn.disabled = true;
      btn._updateMode = 'check';
      if (icon) { icon.className = 'ph ph-circle-notch ph-spin'; icon.style.animation = ''; }
      if (label) label.textContent = '检查中...';
      this.startSourceDiagnosticsCheck();

      try {
        const result = await update?.check?.();
        this._lastUpdateResult = result;
        this.finishSourceDiagnosticsCheck(result);
        btn.disabled = false;
        this.hideProgress();

        if (result?.error) {
          const isConfigError = String(result.error).includes('未配置');
          this.setError(result.error, {
            isConfigError,
            badgeHtml: isConfigError
              ? '<i class="ph ph-gear"></i> 请先配置更新源'
              : '<i class="ph ph-warning"></i> 检查失败',
          });
          showNotice(isConfigError ? '请先在右侧配置 GitHub 仓库地址' : `检查更新失败: ${result.error}`, 'error', 4000);
          addLogLine('ERROR', `检查更新失败: ${result.error}`);
          return result;
        }

        if (result?.hasUpdate && result.forceUpdate) {
          if (icon) { icon.className = 'ph ph-circle-notch ph-spin'; icon.style.animation = ''; }
          if (label) label.textContent = '强制安装中...';
          setBadge('error', `<i class="ph ph-warning"></i> 强更 ${versionText(result.latestVersion)}`);
          showNotice(`检测到强制更新 v${result.latestVersion}，正在自动下载...`, 'warn', 6000);
          addLogLine('WARN', `检测到强制更新 v${result.latestVersion}，必须安装`);
          this.renderReleaseNotes(result);
          btn.disabled = true;
          await this.downloadAndInstall(result);
          return result;
        }

        const skipped = await config?.get?.('skippedVersion');
        if (result?.hasUpdate && skipped === result.latestVersion) {
          this.setSkipped(result.latestVersion);
          addLogLine('INFO', `已跳过版本 v${result.latestVersion}`);
          this.renderReleaseNotes(result);
          return result;
        }

        if (result?.hasUpdate) {
          if (await this.syncPendingInstallForVersion(result.latestVersion)) {
            this.renderReleaseNotes(result);
            showNotice(`安装包已下载，点击「立即安装」完成 v${result.latestVersion} 更新`, 'info', 5000);
            addLogLine('INFO', `检测到 v${result.latestVersion} 已下载，阻止重复下载`);
            return result;
          }
          this.setAvailable(result);
          showNotice(`发现新版本 v${result.latestVersion}，点击「立刻更新」下载安装`, 'info', 5000);
          addLogLine('INFO', `发现新版本 v${result.latestVersion}（当前 v${result.currentVersion}）`);
        } else {
          this.setLatest();
          showNotice(`当前已是最新版本 v${result?.currentVersion || ''}`, 'success', 2500);
          addLogLine('INFO', `当前已是最新版本 v${result?.currentVersion || ''}`);
          setTimeout(() => {
            if (btn._updateMode !== 'check') return;
            if (icon) icon.className = 'ph ph-arrow-clockwise';
            if (label) label.textContent = '检查更新';
          }, 5000);
        }

        const versionNumber = document.querySelector('.update-ver-number');
        if (versionNumber && result?.currentVersion) versionNumber.textContent = `v${result.currentVersion}`;
        this.renderReleaseNotes(result);
        return result;
      } catch (e) {
        btn.disabled = false;
        if (icon) { icon.className = 'ph ph-arrows-clockwise'; icon.style.animation = ''; }
        if (label) label.textContent = '重试检查';
        this.hideProgress();
        this.failSourceDiagnosticsCheck(e);
        addLogLine('ERROR', `检查更新异常: ${e.message}`);
        return { error: e.message };
      }
    },

    async forceUpdate() {
      const {
        addLogLine = () => {},
        update,
        config,
      } = this._deps || {};
      const btn = $('forceUpdateBtn');
      if (!btn) return null;
      btn.disabled = true;
      const originalHtml = btn.innerHTML;
      const label = btn.querySelector('.update-ctrl-label');
      if (label) label.textContent = '检查中...';

      try {
        let result = this._lastUpdateResult;
        if (!result || !result.hasUpdate) {
          result = await update?.check?.();
          this._lastUpdateResult = result;
          this.renderSourceDiagnostics(result);
        }

        if (result?.error) {
          addLogLine('ERROR', `强制更新检查失败: ${result.error}`);
          return result;
        }

        if (!result?.hasUpdate) {
          addLogLine('INFO', '当前已是最新版本，无需强制更新');
          return result;
        }

        await config?.set?.('skippedVersion', '');
        const nextLabel = btn.querySelector('.update-ctrl-label');
        if (nextLabel) nextLabel.textContent = '下载中...';
        await this.downloadAndInstall(result);
        return result;
      } catch (e) {
        addLogLine('ERROR', `强制更新失败: ${e.message}`);
        return { error: e.message };
      } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }
    },

    async installPendingUpdate() {
      const {
        addLogLine = () => {},
        update,
      } = this._deps || {};
      const btn = $('checkUpdateBtn');
      const label = $('checkUpdateLabel');
      if (!btn || btn.disabled) return null;

      btn.disabled = true;
      if (label) label.textContent = '安装中...';
      try {
        const result = await update?.installPending?.();
        if (!result?.success) {
          addLogLine('ERROR', `安装失败: ${result?.error || 'unknown'}`);
          btn.disabled = false;
          if (label) label.textContent = '立即安装';
          return result;
        }
        addLogLine('SUCCESS', '安装程序已启动，应用即将关闭');
        return result;
      } catch (e) {
        addLogLine('ERROR', `安装失败: ${e.message}`);
        btn.disabled = false;
        if (label) label.textContent = '立即安装';
        return { success: false, error: e.message };
      }
    },

    async rollbackVersion() {
      const {
        addLogLine = () => {},
        showNotice = () => {},
        update,
      } = this._deps || {};
      const btn = $('rollbackBtn');
      if (!btn) return null;
      const icon = btn.querySelector('i');
      const label = btn.querySelector('span');

      if (!btn.classList.contains('confirming')) {
        btn.classList.add('confirming');
        if (label) label.textContent = '确认回滚？';
        btn._confirmTimer = setTimeout(() => {
          btn.classList.remove('confirming');
          if (label) label.textContent = '版本回滚';
        }, 3500);
        return { confirming: true };
      }

      clearTimeout(btn._confirmTimer);
      btn.classList.remove('confirming');
      btn.disabled = true;
      if (icon) { icon.className = 'ph ph-circle-notch ph-spin'; icon.style.animation = ''; }
      if (label) label.textContent = '查询中...';

      try {
        const result = await update?.rollbackInfo?.();
        if (!result?.success) {
          showNotice(`无法查询回滚版本: ${result?.error || 'unknown'}`, 'error', 4000);
          addLogLine('ERROR', `无法回滚: ${result?.error || 'unknown'}`);
          return result;
        }

        addLogLine('INFO', `找到历史版本 v${result.version}，开始下载...`);
        showNotice(`正在下载回滚版本 v${result.version}...`, 'warn', 4000);
        if (label) label.textContent = '下载中...';
        await this.downloadAndInstall({
          latestVersion: result.version,
          exeDownloadUrl: result.exeDownloadUrl || result.downloadUrl,
          zipDownloadUrl: result.zipDownloadUrl || null,
        });
        return result;
      } catch (e) {
        showNotice(`版本回滚失败: ${e.message}`, 'error', 4000);
        addLogLine('ERROR', `版本回滚失败: ${e.message}`);
        return { error: e.message };
      } finally {
        btn.disabled = false;
        if (icon) { icon.className = 'ph ph-arrow-counter-clockwise'; icon.style.animation = ''; }
        if (label) label.textContent = '版本回滚';
      }
    },

    setLatest() {
      const btn = $('checkUpdateBtn');
      if (btn) {
        btn.disabled = false;
        btn._updateMode = 'check';
      }
      this.stopSourceDiagnosticsTimer();
      setCheckButton('check', '检查更新', 'ph ph-arrow-clockwise');
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
      setCheckButton(
        'check',
        options.label || (options.isConfigError ? '检查更新' : '重试检查'),
        options.isConfigError ? 'ph ph-arrow-clockwise' : 'ph ph-arrows-clockwise',
      );
      if (icon) icon.style.animation = '';
      setBadge(options.isConfigError ? 'error' : 'error', options.badgeHtml || '<i class="ph ph-warning"></i> 检查失败');
      return message;
    },

    setAvailable(result = {}) {
      const btn = $('checkUpdateBtn');
      if (btn) {
        btn.disabled = false;
        btn._updateMode = 'download';
        btn._pendingVersion = '';
        btn.classList.remove('rollback-install-btn');
        btn.classList.add('primary');
      }
      this._pendingInstallVersion = '';
      this.stopSourceDiagnosticsTimer();
      setCheckButton('download', '立刻更新', 'ph ph-download-simple');
      setBadge(result.forceUpdate ? 'error' : 'warn', result.forceUpdate
        ? `<i class="ph ph-warning"></i> 强更 ${versionText(result.latestVersion)}`
        : `<i class="ph ph-arrow-circle-up"></i> 有更新 ${versionText(result.latestVersion)}`);
      document.querySelector('.nav-item[data-target="page-update"]')?.classList.add('has-update');
    },

    setSkipped(version) {
      const btn = $('checkUpdateBtn');
      if (btn) btn._updateMode = 'check';
      this.stopSourceDiagnosticsTimer();
      setCheckButton('check', '检查更新', 'ph ph-arrow-clockwise');
      setBadge('success', `<i class="ph ph-check-circle"></i> 已跳过 v${escapeHtml(version || '')}`);
    },

    renderReleaseNotes(result = {}) {
      if (!result?.latestVersion) return false;

      const channelBadge = document.querySelector('.update-channel-badge');
      if (channelBadge) {
        const installedChannel = getInstalledChannel(result.currentVersion);
        channelBadge.className = `update-channel-badge ${installedChannel}`;
        channelBadge.textContent = installedChannelNameMap[installedChannel] || '稳定版';
      }

      const versionTag = document.querySelector('.update-ver-tag');
      if (versionTag) {
        const installedChannel = getInstalledChannel(result.currentVersion || result.latestVersion);
        versionTag.textContent = installedChannelTagMap[installedChannel] || 'Stable';
      }

      return true;
    },

    renderChangelogEntries(entries = []) {
      const timeline = document.querySelector('.update-timeline');
      if (!timeline || !entries.length) return false;

      timeline.innerHTML = '';
      const entry = entries[0] || {};
      const lines = String(entry.notes || '')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.replace(/^#+\s*|^[-*•]\s*/g, '').trim())
        .filter(Boolean)
        .slice(0, 20);
      const item = document.createElement('div');
      item.className = 'update-tl-item';
      item.innerHTML = `
        <div class="update-tl-track">
          <div class="update-tl-dot current"></div>
          <div class="update-tl-line last"></div>
        </div>
        <div class="update-tl-body">
          <div class="update-tl-header">
            <span class="update-tl-ver">v${escapeHtml(entry.version)}</span>
            <span class="update-tl-badge latest">CURRENT</span>
            ${entry.isPreRelease ? '<span class="update-tl-badge pre">PRE</span>' : ''}
            <span class="update-tl-date">${escapeHtml(entry.date)}</span>
          </div>
          <div class="update-tl-block">
            <ul class="update-tl-list">
              ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('') || '<li>（暂无说明）</li>'}
            </ul>
          </div>
        </div>`;
      timeline.appendChild(item);
      return true;
    },

    syncInstalledVersion({ version, cfg = {}, runtimeVersions = {} } = {}) {
      if (!version) return false;

      const installedChannel = getInstalledChannel(version);
      const channelBadge = document.querySelector('.update-channel-badge');
      if (channelBadge) {
        channelBadge.className = `update-channel-badge ${installedChannel}`;
        channelBadge.textContent = installedChannelNameMap[installedChannel] || '稳定版';
      }

      const versionTag = document.querySelector('.update-ver-tag');
      if (versionTag) versionTag.textContent = installedChannelTagMap[installedChannel] || 'Stable';

      const versionNumber = $('updateVerNumber');
      if (versionNumber) versionNumber.textContent = `v${version}`;

      const versionDesc = $('updateVerDesc');
      if (versionDesc) {
        const lastCheck = cfg.lastUpdateCheck;
        const lastCheckText = lastCheck
          ? `上次检查：${new Date(lastCheck).toLocaleDateString()}`
          : '尚未检查更新';
        versionDesc.textContent = `运行在 Electron ${runtimeVersions.electron || 'N/A'} · Node ${runtimeVersions.node || 'N/A'}。${lastCheckText}。`;
      }

      return true;
    },

    setPendingInstall(version) {
      const btn = $('checkUpdateBtn');
      if (btn) {
        btn._updateMode = 'install-pending';
        btn._pendingVersion = version;
        btn.disabled = false;
        btn.classList.remove('rollback-install-btn');
        btn.classList.add('primary');
      }
      this._pendingInstallVersion = String(version || '');
      this.stopSourceDiagnosticsTimer();
      setCheckButton('install-pending', '立即安装', 'ph ph-cloud-arrow-down');
      setBadge('warn', `<i class="ph ph-download-simple"></i> 已下载 ${versionText(version)}`);
      document.querySelector('.nav-item[data-target="page-update"]')?.classList.add('has-update');
    },

    async syncPendingInstallForVersion(version) {
      const getPending = this._deps?.update?.getPendingInstall;
      if (typeof getPending !== 'function') return false;
      let pending = null;
      try {
        pending = await getPending();
      } catch {
        return false;
      }
      if (!pending?.hasPending) return false;
      const pendingVersion = String(pending.version || '');
      const expectedVersion = String(version || '');
      if (expectedVersion && pendingVersion && pendingVersion !== expectedVersion) return false;
      this.setPendingInstall(pendingVersion || expectedVersion);
      return true;
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

    bindBackendControls() {
      this.bindChannelControls();
      this.bindIntegrityControls();
      if (this._backendControlsBound) return;
      const localInstallBtn = $('localInstallBtn');
      if (!localInstallBtn) return;
      this._backendControlsBound = true;
      localInstallBtn.addEventListener('click', () => this.installLocalPackage());
    },

    bindChannelControls() {
      if (this._channelControlsBound) return;
      const radios = typeof document.querySelectorAll === 'function'
        ? Array.from(document.querySelectorAll('input[name="updateChannel"]') || [])
        : [];
      if (!radios.length) return;
      this._channelControlsBound = true;
      radios.forEach((radio) => {
        radio.addEventListener('change', async () => {
          if (!radio.checked) return;
          await this.setChannel(radio.value);
        });
      });
    },

    syncChannel(channel = 'stable') {
      const value = channel || 'stable';
      if (typeof document.querySelectorAll !== 'function') return;
      document.querySelectorAll('input[name="updateChannel"]').forEach((radio) => {
        radio.checked = radio.value === value;
      });
    },

    async setChannel(channel) {
      const {
        addLogLine = () => {},
        update,
      } = this._deps || {};
      const ok = await update?.setChannel?.(channel);
      if (ok) addLogLine('INFO', `更新通道已切换为 ${channel}`);
      return !!ok;
    },

    bindIntegrityControls() {
      if (this._integrityControlsBound) return;
      const btn = $('updateIntegrityBtn');
      if (!btn) return;
      this._integrityControlsBound = true;
      btn.addEventListener('click', () => this.checkIntegrity());
    },

    async checkIntegrity() {
      const {
        addLogLine = () => {},
        showNotice = () => {},
        update,
      } = this._deps || {};
      const btn = $('updateIntegrityBtn');
      const labelSpan = btn?.querySelector?.('span') || null;
      if (btn) btn.disabled = true;
      if (labelSpan) labelSpan.textContent = '检查中...';

      try {
        const results = await update?.checkIntegrity?.() || [];
        const failures = results.filter((item) => !item.ok);
        if (!failures.length) {
          showNotice('系统完整性正常，所有项目通过检查', 'success', 3500);
        } else {
          const detail = failures.length === 1
            ? `${failures[0].name}: ${failures[0].text}`
            : `${failures[0].name} 等 ${failures.length} 项`;
          showNotice(`完整性检查异常: ${detail}`, 'error', 5000);
        }

        setBadge(failures.length ? 'warn' : 'success', failures.length
          ? `<i class="ph ph-warning"></i> ${failures.length} 项异常`
          : '<i class="ph ph-seal-check"></i> 完整性正常');
        results.forEach((item) => addLogLine(item.ok ? 'INFO' : 'WARN', `[完整性] ${item.name}: ${item.text}`));
        return { success: true, failures };
      } catch (e) {
        showNotice(`完整性检查失败: ${e.message}`, 'error', 4000);
        addLogLine('ERROR', `完整性检查失败: ${e.message}`);
        return { success: false, error: e.message };
      } finally {
        if (labelSpan) labelSpan.textContent = '完整性检查';
        if (btn) btn.disabled = false;
      }
    },

    async installLocalPackage() {
      const {
        addLogLine = () => {},
        system,
        update,
      } = this._deps || {};

      try {
        const filePath = await system?.selectFile?.({
          title: '选择更新安装包',
          filters: [{ name: '安装包', extensions: ['exe', 'zip', '7z'] }],
        });
        if (!filePath) return false;

        addLogLine('INFO', `选择本地安装包: ${filePath}`);
        const result = await update?.install?.(filePath, null, { manual: true });
        if (result?.success) {
          addLogLine('SUCCESS', '安装程序已启动');
          return true;
        }

        addLogLine('ERROR', `安装失败: ${result?.error || '未知错误'}`);
        return false;
      } catch (e) {
        addLogLine('ERROR', `本地安装失败: ${e.message}`);
        return false;
      }
    },

    async downloadAndInstall(result = {}) {
      const {
        addLogLine = () => {},
        showNotice = () => {},
        update,
      } = this._deps || {};

      if (this._isDownloading) {
        showNotice('已有下载任务正在进行中，请稍候', 'warn', 3000);
        addLogLine('WARN', '已有下载任务进行中，已阻止重复触发');
        return false;
      }

      const downloadUrl = result.exeDownloadUrl || result.zipDownloadUrl;
      if (!downloadUrl) {
        addLogLine('ERROR', '没有找到可用的下载链接');
        return false;
      }

      this._isDownloading = true;
      this.resetProgress('下载中...');
      addLogLine('INFO', `开始下载更新 v${result.latestVersion || result.version || ''}...`);

      try {
        const dlResult = await update?.download?.(downloadUrl);
        if (!dlResult?.success) {
          addLogLine('ERROR', `下载失败: ${dlResult?.error || 'unknown'}`);
          this.setProgressLabel('下载失败');
          return false;
        }

        addLogLine('SUCCESS', `下载完成，SHA256: ${String(dlResult.sha256 || '').slice(0, 12)}...`);
        this.updateProgress({ pct: 100 });
        this.setProgressLabel('校验完成');

        addLogLine('INFO', '正在启动安装...');
        const installResult = await update?.install?.(dlResult.filePath, dlResult.sha256);
        if (!installResult?.success) {
          addLogLine('ERROR', `安装失败: ${installResult?.error || 'unknown'}`);
          this.setProgressLabel('安装失败');
          if (installResult?.pending || installResult?.hasPending || installResult?.code === 'PENDING_INSTALL_EXISTS') {
            this.setPendingInstall(result.latestVersion || result.version || installResult.version || '');
          }
          return false;
        }

        addLogLine('SUCCESS', '安装程序已启动，应用即将关闭');
        return true;
      } finally {
        this._isDownloading = false;
      }
    },

    resetProgress(label = '下载中...') {
      const progressBar = $('updateProgressBar');
      const progressLabel = $('updateProgressLabel');
      const progressPct = $('updateProgressPct');
      const progressFill = $('updateProgressFill');
      setProgressPanelVisible(true);
      if (progressBar) {
        setProgressBarVisible(true);
        progressBar.classList.remove('indeterminate');
      }
      if (progressLabel) progressLabel.textContent = label;
      if (progressPct) progressPct.textContent = '0%';
      if (progressFill) progressFill.style.width = '0%';
    },

    showCheckingProgress(label = '检查中...') {
      const progressBar = $('updateProgressBar');
      const progressLabel = $('updateProgressLabel');
      setProgressPanelVisible(true);
      const loadingSystem = window._nekoModules?.components?.LoadingSystem;
      const useCurve = loadingSystem?.getDiagnostics?.().enabled === true;
      if (useCurve) {
        if (progressBar) {
          setProgressBarVisible(false);
          progressBar.classList.remove('indeterminate');
        }
        this.ensureCheckingLoader()?.setLabel?.(label)?.show?.();
      } else if (progressBar) {
        this._checkingLoader?.hide?.();
        setProgressBarVisible(true);
        progressBar.classList.add('indeterminate');
      }
      if (progressLabel) progressLabel.textContent = label;
    },

    hideProgress() {
      const progressBar = $('updateProgressBar');
      if (progressBar) {
        setProgressBarVisible(false);
        progressBar.classList.remove('indeterminate');
      }
      setProgressPanelVisible(false);
      this._checkingLoader?.hide?.();
    },

    setProgressLabel(label) {
      const progressLabel = $('updateProgressLabel');
      if (progressLabel) progressLabel.textContent = label;
    },

    updateProgress(data = {}) {
      const progressBar = $('updateProgressBar');
      const progressPct = $('updateProgressPct');
      const progressFill = $('updateProgressFill');
      const progressLabel = $('updateProgressLabel');
      setProgressPanelVisible(true);
      this._checkingLoader?.hide?.();
      if (progressBar) {
        setProgressBarVisible(true);
        progressBar.classList.remove('indeterminate');
      }
      if (data.pct < 0) return;

      if (progressPct) progressPct.textContent = `${data.pct}%`;
      if (progressFill) progressFill.style.width = `${data.pct}%`;
      if (!progressLabel) return;

      if (data.speed > 0 && data.received > 0 && data.total > 0) {
        progressLabel.textContent = `下载中... (${formatFileSize(data.received)} / ${formatFileSize(data.total)}, ${formatFileSize(data.speed)}/s)`;
      } else if (data.received > 0) {
        progressLabel.textContent = `下载中... (${formatFileSize(data.received)}${data.total > 0 ? ` / ${formatFileSize(data.total)}` : ''})`;
      } else {
        progressLabel.textContent = '下载中...';
      }
    },

    markAutoDownloaded(data = {}) {
      this.setPendingInstall(data.version || '');
    },

    markForceInstallStarted(data = {}) {
      setBadge('error', `<i class="ph ph-warning"></i> 强制更新安装中...`);
      document.querySelector('.nav-item[data-target="page-update"]')?.classList.add('has-update');
      return data;
    },

    markAvailable(result = {}) {
      if (!result?.hasUpdate) return false;
      this._lastUpdateResult = result;
      this.setAvailable(result);
      this.showDialog(result);
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

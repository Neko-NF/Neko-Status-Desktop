(function () {
  const title = document.getElementById('startupTitle');
  const desc = document.getElementById('startupDesc');
  const meta = document.getElementById('startupMeta');
  const track = document.getElementById('progressTrack');
  const fill = document.getElementById('progressFill');
  const panel = document.querySelector('.startup-panel');
  const curveStage = document.getElementById('startupCurveLoaderStage');
  const loadingSystem = window._nekoModules?.components?.LoadingSystem;
  const curveController = loadingSystem?.create?.(curveStage, {
    context: 'startup',
    mode: 'section',
    size: 'lg',
    label: '正在准备 Neko Status',
    delayMs: 0,
    minVisibleMs: 0,
  }) || null;
  const curvePreferences = {
    enableExperimentalFeatures: false,
    enableExperimentalCurveLoaders: false,
    loadingCurveStyle: 'auto',
    uiAppearanceProfile: 'classic',
  };

  const contracts = window.__NEKO_IPC_CONTRACTS__ || {};
  const events = contracts.IPC_EVENTS || {};
  const textState = {
    title: title?.textContent || '',
    message: desc?.textContent || '',
    detail: meta?.textContent || '',
    phase: 'checking',
  };

  function setText(el, key, value) {
    if (!el || value == null || value === '') return;
    const next = String(value);
    if (textState[key] === next) return;
    textState[key] = next;
    el.textContent = next;
  }

  function setProgress(pct) {
    const numeric = Number(pct);
    if (Number.isFinite(numeric) && numeric >= 0) {
      track.classList.remove('is-indeterminate');
      fill.style.width = `${Math.max(0, Math.min(100, numeric))}%`;
      syncCurveLoader(false);
      return;
    }
    track.classList.add('is-indeterminate');
    fill.style.width = '';
    syncCurveLoader(true);
  }

  function syncCurveLoader(indeterminate) {
    const enabled = curvePreferences.enableExperimentalFeatures === true
      && curvePreferences.enableExperimentalCurveLoaders === true;
    const visible = enabled && indeterminate;
    panel?.classList.toggle('has-curve-loader', visible);
    if (visible) curveController?.show?.();
    else curveController?.hide?.();
  }

  function applyStatus(payload = {}) {
    if (payload.phase) textState.phase = payload.phase;
    setText(title, 'title', payload.title);
    setText(desc, 'message', payload.message);
    setText(meta, 'detail', payload.detail);

    if (payload.themeMode === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else if (payload.themeMode) {
      document.documentElement.removeAttribute('data-theme');
    }
    const themeColor = payload.themeColor || payload.customThemeColor;
    if (themeColor) {
      document.documentElement.style.setProperty('--theme-color-seed', themeColor);
      document.documentElement.style.removeProperty('--theme-color');
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'enableExperimentalFeatures')) {
      curvePreferences.enableExperimentalFeatures = payload.enableExperimentalFeatures === true;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'enableExperimentalCurveLoaders')) {
      curvePreferences.enableExperimentalCurveLoaders = payload.enableExperimentalCurveLoaders === true;
    }
    if (payload.loadingCurveStyle) curvePreferences.loadingCurveStyle = payload.loadingCurveStyle;
    if (payload.uiAppearanceProfile) {
      const profile = payload.uiAppearanceProfile === 'quiet' ? 'quiet' : 'classic';
      curvePreferences.uiAppearanceProfile = profile;
      document.documentElement.dataset.uiProfile = profile;
      try { localStorage.setItem('neko-ui-appearance-profile', profile); } catch {}
    }
    loadingSystem?.applyPreferences?.(curvePreferences);

    setProgress(payload.pct);
  }

  setProgress(-1);

  const eventClient = window._nekoModules?.services?.IpcClient;

  eventClient?.on?.(events.STARTUP_UPDATE_STATUS || 'startup-update:status', applyStatus);
  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  eventClient?.on?.(events.UPDATE_PROGRESS || 'update:progress', (payload = {}) => {
    const pct = Number(payload.pct);
    let detail = Number.isFinite(pct) && pct >= 0 ? `下载进度 ${pct}%` : '正在接收安装包...';
    if (payload.speed > 0 && payload.received > 0 && payload.total > 0) {
      const speedStr = formatFileSize(payload.speed);
      const receivedStr = formatFileSize(payload.received);
      const totalStr = formatFileSize(payload.total);
      detail = `下载进度 ${pct}% (${receivedStr} / ${totalStr}, ${speedStr}/s)`;
    } else if (payload.received > 0) {
      const receivedStr = formatFileSize(payload.received);
      const totalStr = payload.total > 0 ? ` / ${formatFileSize(payload.total)}` : '';
      detail = `下载进度 ${pct}% (${receivedStr}${totalStr})`;
    }
    const status = {
      phase: 'downloading',
      detail,
      pct,
    };
    if (textState.phase !== 'downloading') {
      status.title = '正在下载更新';
      status.message = '下载完成后将自动启动安装程序。';
    }
    applyStatus(status);
  });
})();

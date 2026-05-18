(function () {
  const title = document.getElementById('startupTitle');
  const desc = document.getElementById('startupDesc');
  const meta = document.getElementById('startupMeta');
  const track = document.getElementById('progressTrack');
  const fill = document.getElementById('progressFill');

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
      return;
    }
    track.classList.add('is-indeterminate');
    fill.style.width = '';
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
      document.documentElement.style.setProperty('--theme-color', themeColor);
    }

    setProgress(payload.pct);
  }

  setProgress(-1);

  const eventClient = window._nekoModules?.services?.IpcClient;

  eventClient?.on?.(events.STARTUP_UPDATE_STATUS || 'startup-update:status', applyStatus);
  eventClient?.on?.(events.UPDATE_PROGRESS || 'update:progress', (payload = {}) => {
    const pct = Number(payload.pct);
    const status = {
      phase: 'downloading',
      detail: Number.isFinite(pct) && pct >= 0 ? `下载进度 ${pct}%` : '正在接收安装包...',
      pct,
    };
    if (textState.phase !== 'downloading') {
      status.title = '正在下载更新';
      status.message = '下载完成后将自动启动安装程序。';
    }
    applyStatus(status);
  });
})();

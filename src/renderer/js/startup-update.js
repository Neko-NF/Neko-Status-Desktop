(function () {
  const title = document.getElementById('startupTitle');
  const desc = document.getElementById('startupDesc');
  const meta = document.getElementById('startupMeta');
  const track = document.getElementById('progressTrack');
  const fill = document.getElementById('progressFill');

  const contracts = window.__NEKO_IPC_CONTRACTS__ || {};
  const events = contracts.IPC_EVENTS || {};

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
    if (payload.title) title.textContent = payload.title;
    if (payload.message) desc.textContent = payload.message;
    if (payload.detail) meta.textContent = payload.detail;

    if (payload.themeMode) {
      document.documentElement.setAttribute('data-theme', payload.themeMode);
    }
    if (payload.themeColor) {
      document.documentElement.style.setProperty('--theme-color', payload.themeColor);
    }

    setProgress(payload.pct);
  }

  setProgress(-1);

  window.nekoIPC?.on?.(events.STARTUP_UPDATE_STATUS || 'startup-update:status', applyStatus);
  window.nekoIPC?.on?.(events.UPDATE_PROGRESS || 'update:progress', (payload = {}) => {
    const pct = Number(payload.pct);
    applyStatus({
      title: '正在下载更新',
      message: '下载完成后将自动启动安装程序。',
      detail: Number.isFinite(pct) && pct >= 0 ? `下载进度 ${pct}%` : '正在接收安装包...',
      pct,
    });
  });
})();

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

  const UpdatePage = {
    init() {
      if (this._inited) return;
      this._inited = true;
      document.querySelector('.nav-item[data-target="page-update"]')?.addEventListener('click', (event) => {
        event.currentTarget.classList.remove('has-update');
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
    },

    setLatest() {
      const btn = $('checkUpdateBtn');
      if (btn) {
        btn.disabled = false;
        btn._updateMode = 'check';
      }
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
      setCheckButton('download', '立刻更新', 'ph ph-download-simple');
      setBadge(result.forceUpdate ? 'error' : 'warn', result.forceUpdate
        ? `<i class="ph ph-warning"></i> 强制更新 v${escapeHtml(result.latestVersion || '')}`
        : `<i class="ph ph-arrow-circle-up"></i> 发现新版本 v${escapeHtml(result.latestVersion || '')}`);
      document.querySelector('.nav-item[data-target="page-update"]')?.classList.add('has-update');
    },

    setSkipped(version) {
      const btn = $('checkUpdateBtn');
      if (btn) btn._updateMode = 'check';
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

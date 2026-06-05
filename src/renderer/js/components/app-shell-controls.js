/**
 * components/app-shell-controls.js
 * Shell-level DOM bindings for the renderer entry.
 *
 * This module intentionally delegates page switching, theme color management,
 * expandable sections, and modal backdrop behavior to existing split modules.
 */
(function attachAppShellControls() {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.components = window._nekoModules.components || {};

  const $ = (id) => document.getElementById(id);

  function applyInitialTheme() {
    const savedMode = localStorage.getItem('neko-theme-mode') || 'light';
    if (savedMode === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }

    const savedColor = localStorage.getItem('neko-theme-color');
    if (savedColor) document.documentElement.style.setProperty('--theme-color', savedColor);
  }

  function getConfigClient() {
    return window._nekoModules?.services?.ConfigClient || null;
  }

  function syncNavIndicatorAfterLayout(target) {
    const router = window._nekoModules?.router;
    router?.syncNavIndicator?.(target);
    requestAnimationFrame(() => router?.syncNavIndicator?.(target));
    setTimeout(() => router?.syncNavIndicator?.(target), 280);
  }

  function bindRouteLifecycle() {
    const bus = window._nekoModules?.eventBus;
    bus?.on?.('router:access-denied', ({ page } = {}) => {
      if (page !== 'page-announcement') return;
      window._showIslandNotice?.('仅管理员可以打开公告管理', 'warn');
    });
    bus?.on?.('router:page-changed', ({ page } = {}) => {
      if (page === 'page-update') {
        if (window._nekoModules?.pages?.UpdatePage && !window._updatePageInited) {
          window._updatePageInited = true;
          window._nekoModules.pages.UpdatePage.init();
        }
        window._nekoModules?.pages?.UpdatePage?.requestSourceDiagnosticsCheck?.({ reason: 'enter-update-page' });
      }

      if (page === 'page-settings' && window._nekoModules?.pages?.SettingsPage && !window._settingsPageInited) {
        window._settingsPageInited = true;
        window._nekoModules.pages.SettingsPage.init();
      }

      if (page === 'page-stream' && window._nekoModules?.pages?.StreamPage && !window._streamPageInited) {
        window._streamPageInited = true;
        window._nekoModules.pages.StreamPage.init();
      }

      if (page === 'page-announcement') {
        window._nekoModules?.pages?.AnnouncementPage?.loadAnnouncements?.();
      }
    });
  }

  function initRouter() {
    const router = window._nekoModules?.router;
    if (!router) return;
    bindRouteLifecycle();
    router.init();
    window._nekoSyncNavIndicator = syncNavIndicatorAfterLayout;
  }

  function initThemeControls() {
    const theme = window._nekoModules?.theme;
    const setExpandableSectionState = window._nekoUIHelpers?.setExpandableSectionState || (() => {});
    const savedMode = localStorage.getItem('neko-theme-mode') || 'light';

    theme?.applyThemeMode?.(savedMode);
    theme?.initThemeColorControls?.();

    const themeModeBtn = $('themeModeBtn');
    themeModeBtn?.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const newMode = isLight ? 'dark' : 'light';
      theme?.applyThemeMode?.(newMode);

      $('stgDarkSwitch')?.classList.toggle('on', newMode === 'dark');
      const schedSwitch = $('stgDarkScheduleSwitch');
      if (schedSwitch?.classList.contains('on')) {
        schedSwitch.classList.remove('on');
        setExpandableSectionState($('stgDarkTimeRow'), false, { display: 'flex' });
      }

      const savePromise = getConfigClient()?.set?.('themeMode', newMode);
      if (savePromise?.catch) savePromise.catch(() => {});
    });
  }

  function bindProfileDropdown() {
    const avatar = $('userAvatar');
    const dropdown = $('userDropdown');
    const themeColorBtn = $('themeColorBtn');
    const colorPalette = $('colorPalette');
    if (!avatar || !dropdown) return;

    avatar.addEventListener('click', (event) => {
      event.stopPropagation();
      dropdown.classList.toggle('show');
    });

    document.addEventListener('click', (event) => {
      if (!dropdown.contains(event.target) && !avatar.contains(event.target)) {
        dropdown.classList.remove('show');
      }
      if (colorPalette && themeColorBtn && !colorPalette.contains(event.target) && !themeColorBtn.contains(event.target)) {
        colorPalette.classList.remove('show');
      }
    });
  }

  function bindConfigModalShell() {
    const modal = window._nekoModules?.modal;
    const openConfigModal = () => modal?.openModal?.('configModal') || $('configModal')?.classList.add('show');
    const closeConfigModal = () => modal?.closeModal?.('configModal') || $('configModal')?.classList.remove('show');

    $('btnConfigKey')?.addEventListener('click', openConfigModal);
    $('stgConfigBtn')?.addEventListener('click', openConfigModal);
    $('closeConfigBtn')?.addEventListener('click', closeConfigModal);
    $('cancelConfigBtn')?.addEventListener('click', closeConfigModal);

    modal?.registerBackdropClose?.('configModal', 'profileModal');
  }

  function bindProfileModalShell() {
    const modal = window._nekoModules?.modal;
    const dropdown = $('userDropdown');
    const openProfile = () => {
      dropdown?.classList.remove('show');
      const profileModal = $('profileModal');
      profileModal?.classList.add('show');
      profileModal?.classList.add('active');
    };
    const closeProfile = () => {
      const profileModal = $('profileModal');
      profileModal?.classList.remove('show');
      profileModal?.classList.remove('active');
    };

    $('btnProfileSettings')?.addEventListener('click', openProfile);
    $('openProfileBtnSettings')?.addEventListener('click', openProfile);
    $('closeProfileBtn')?.addEventListener('click', closeProfile);
    $('saveProfileBtn')?.addEventListener('click', function handleProfileSave() {
      const originalHtml = this.innerHTML;
      this.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';
      setTimeout(() => {
        this.innerHTML = '<i class="ph ph-check-circle"></i> 已保存';
        setTimeout(() => {
          closeProfile();
          setTimeout(() => { this.innerHTML = originalHtml; }, 300);
        }, 800);
      }, 600);
    });

    if (!modal) {
      $('profileModal')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeProfile();
      });
    }
  }

  function bindConsoleToggle() {
    const toggleConsole = $('toggleConsole');
    const navConsole = $('navConsole');
    if (!toggleConsole || !navConsole) return;

    navConsole.setAttribute('aria-hidden', navConsole.classList.contains('show') ? 'false' : 'true');
    if (!navConsole.classList.contains('show')) navConsole.setAttribute('tabindex', '-1');

    toggleConsole.addEventListener('click', () => {
      const isOn = toggleConsole.classList.toggle('on');
      if (isOn) {
        navConsole.classList.add('show');
        navConsole.setAttribute('aria-hidden', 'false');
        navConsole.removeAttribute('tabindex');
        syncNavIndicatorAfterLayout();
        return;
      }

      navConsole.classList.remove('show');
      navConsole.setAttribute('aria-hidden', 'true');
      navConsole.setAttribute('tabindex', '-1');
      if (navConsole.classList.contains('active')) {
        document.querySelector('.nav-menu .nav-item[data-target="mainDashboardArea"]')?.click();
      } else {
        syncNavIndicatorAfterLayout();
      }
    });
  }

  function bindQuickToggles() {
    $('toggleScreenshot')?.addEventListener('click', function toggleScreenshotState() {
      this.classList.toggle('on');
    });

    const setExpandableSectionState = window._nekoUIHelpers?.setExpandableSectionState || (() => {});
    const reportAutoStartSwitch = $('reportAutoStartSwitch');
    const reportAutoDelayRow = $('reportAutoDelayRow');
    if (reportAutoStartSwitch && reportAutoDelayRow) {
      const updateVisibility = () => {
        setExpandableSectionState(reportAutoDelayRow, reportAutoStartSwitch.classList.contains('on'), { display: 'flex' });
      };
      updateVisibility();
      reportAutoStartSwitch.addEventListener('click', updateVisibility);
    }
  }

  function bindGlobalStepper() {
    document.addEventListener('click', (event) => {
      const btn = event.target.closest('.neko-stepper-btn');
      if (!btn) return;
      const input = $(btn.dataset.target);
      if (!input) return;

      const dir = parseInt(btn.dataset.dir, 10) || 1;
      let value = parseInt(input.value, 10) || 0;
      const min = parseInt(input.min, 10);
      const max = parseInt(input.max, 10);

      value += dir;
      if (!Number.isNaN(min)) value = Math.max(min, value);
      if (!Number.isNaN(max)) value = Math.min(max, value);
      input.value = value;
    });
  }

  function bindServiceConfirmButtons() {
    document.querySelectorAll('.svc-action-btn[data-confirm]').forEach((button) => {
      let confirmTimer = null;
      const originalHTML = button.innerHTML;
      const originalClass = button.className;

      button.addEventListener('click', () => {
        if (button.classList.contains('confirming')) {
          clearTimeout(confirmTimer);
          button.innerHTML = '<i class="ph ph-check"></i>';
          button.classList.remove('confirming');
          setTimeout(() => {
            button.innerHTML = originalHTML;
            button.className = originalClass;
          }, 1200);
          return;
        }

        button.classList.add('confirming');
        button.innerHTML = button.dataset.confirm;
        confirmTimer = setTimeout(() => {
          button.innerHTML = originalHTML;
          button.className = originalClass;
        }, 3000);
      });
    });
  }

  function bindConfigModeSwitcher() {
    const switcher = $('configModeSwitcher');
    if (!switcher) return;

    switcher.addEventListener('click', (event) => {
      const btn = event.target.closest('.modal-mode-btn');
      if (!btn) return;
      switcher.querySelectorAll('.modal-mode-btn').forEach((item) => item.classList.remove('active'));
      btn.classList.add('active');

      const isLocal = btn.dataset.mode === 'local';
      const urlLabel = $('configUrlLabel');
      const urlInput = $('configUrlInput');
      const apiKeyGroup = $('configApiKeyGroup');
      const hint = $('configHint');

      if (urlLabel) urlLabel.textContent = isLocal ? '本地服务地址 (Local URL)' : '服务器后端地址 (Server URL)';
      if (urlInput) {
        urlInput.value = isLocal ? 'http://localhost:8080' : 'https://api.koirin.com/neko';
        urlInput.placeholder = isLocal ? '例如: http://localhost:8080' : '例如: http://192.168.1.100:8080';
      }
      if (apiKeyGroup) apiKeyGroup.style.opacity = isLocal ? '0.45' : '1';
      if (hint) {
        hint.innerHTML = isLocal
          ? '<i class="ph ph-info"></i> 本地测试模式下无需填写 API 密钥，直连本地服务即可。'
          : '<i class="ph ph-info"></i> 保存后服务可能需要重启以应用新的网络连接。';
      }
    });
  }

  function initPages() {
    window._nekoModules?.pages?.DashboardPage?.init?.();
    window._nekoModules?.pages?.ScreenshotPage?.init?.();
  }

  function init() {
    if (document.documentElement.dataset.appShellControlsBound === '1') return;
    document.documentElement.dataset.appShellControlsBound = '1';

    window._nekoUIHelpers?.normalizeServiceHealthCheckCopy?.();
    initRouter();
    initThemeControls();
    bindProfileDropdown();
    bindConfigModalShell();
    bindProfileModalShell();
    bindConsoleToggle();
    bindQuickToggles();
    bindGlobalStepper();
    bindServiceConfirmButtons();
    bindConfigModeSwitcher();
    initPages();
  }

  applyInitialTheme();
  document.addEventListener('DOMContentLoaded', init);

  window._nekoModules.components.AppShellControls = { init };
})();

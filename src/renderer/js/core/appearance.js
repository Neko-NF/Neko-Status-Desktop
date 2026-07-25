(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.core = window._nekoModules.core || {};

  const STORAGE_KEY = 'neko-ui-appearance-profile';
  const VALID_PROFILES = new Set(['classic', 'quiet']);
  let currentProfile = 'classic';
  let experimentalEnabled = false;
  let bound = false;
  let deps = {};

  function normalize(profile, experiments = experimentalEnabled) {
    if (!VALID_PROFILES.has(profile)) return 'classic';
    return profile === 'quiet' && experiments !== true ? 'classic' : profile;
  }

  function syncControls() {
    const quietAllowed = experimentalEnabled === true;
    document.querySelectorAll?.('[data-ui-profile-option]').forEach((button) => {
      const profile = button.dataset.uiProfileOption;
      const active = profile === currentProfile;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (profile === 'quiet') {
        button.disabled = !quietAllowed;
        button.setAttribute('aria-disabled', quietAllowed ? 'false' : 'true');
      }
    });
    const settingsDesc = document.getElementById?.('stgAppearanceProfileDesc');
    if (settingsDesc) {
      settingsDesc.textContent = quietAllowed
        ? (currentProfile === 'quiet' ? '当前使用沉静界面，可随时退回经典界面' : '经典界面为默认；沉静界面使用中性实色与紧凑层级')
        : '开启实验性内容后可体验沉静界面';
    }
    const labState = document.getElementById?.('uiLabAppearanceState');
    if (labState) labState.textContent = currentProfile === 'quiet' ? '沉静界面已应用' : '当前为经典界面';
  }

  function emitChange(previous, source) {
    if (previous === currentProfile) return;
    const detail = { profile: currentProfile, previous, source: source || 'runtime' };
    window._nekoModules?.eventBus?.emit?.('appearance:changed', detail);
    if (typeof CustomEvent === 'function') {
      document.dispatchEvent?.(new CustomEvent('neko:appearanceChange', { detail }));
    }
  }

  function apply(profile, options = {}) {
    const previous = currentProfile;
    if (Object.prototype.hasOwnProperty.call(options, 'experimentalEnabled')) {
      experimentalEnabled = options.experimentalEnabled === true;
    }
    currentProfile = normalize(profile);
    document.documentElement.dataset.uiProfile = currentProfile;
    if (options.mirror !== false) {
      try { localStorage.setItem(STORAGE_KEY, currentProfile); } catch {}
    }
    syncControls();
    if (options.emitEvent !== false) emitChange(previous, options.source);
    return currentProfile;
  }

  function applyConfig(config = {}, options = {}) {
    const hasProfile = Object.prototype.hasOwnProperty.call(config, 'uiAppearanceProfile');
    const profile = hasProfile ? config.uiAppearanceProfile : currentProfile;
    return apply(profile, {
      ...options,
      experimentalEnabled: config.enableExperimentalFeatures === true,
      source: options.source || 'config',
    });
  }

  async function saveProfile(profile, options = {}) {
    const requested = VALID_PROFILES.has(profile) ? profile : 'classic';
    if (requested === 'quiet' && experimentalEnabled !== true) {
      throw new Error('请先开启实验性内容，再启用沉静界面');
    }
    const previous = currentProfile;
    apply(requested, { source: options.source || 'control' });
    const client = options.config || deps.config || window._nekoModules?.services?.ConfigClient;
    try {
      if (!client?.set) throw new Error('配置服务尚未就绪');
      const result = await client.set('uiAppearanceProfile', requested);
      if (result?.ok === false) throw new Error(result.error?.message || result.message || '外观设置保存失败');
      let config = null;
      try { config = await client.getAll?.(); } catch {}
      if (config) applyConfig(config, { source: 'config-confirmed' });
      return currentProfile;
    } catch (error) {
      apply(previous, { source: 'rollback' });
      throw error;
    }
  }

  function handleProfileControl(button) {
    const profile = button?.dataset?.uiProfileOption;
    if (!profile || button.disabled) return;
    saveProfile(profile, { source: button.id || 'profile-control' })
      .then(() => deps.showNotice?.(profile === 'quiet' ? '已切换到沉静界面' : '已退回经典界面', 'success', 1800))
      .catch((error) => deps.showNotice?.(error.message || '外观设置保存失败', 'error', 2600));
  }

  function bindControls() {
    if (bound) return;
    bound = true;
    document.addEventListener?.('click', (event) => {
      const button = event.target?.closest?.('[data-ui-profile-option]');
      if (!button) return;
      event.preventDefault?.();
      handleProfileControl(button);
    });
  }

  function init(nextDeps = {}) {
    deps = { ...deps, ...nextDeps };
    bindControls();
    syncControls();
  }

  currentProfile = normalize(document.documentElement.dataset.uiProfile || (() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return 'classic'; }
  })(), true);

  window._nekoModules.core.AppearanceProfile = {
    STORAGE_KEY,
    normalize,
    init,
    apply,
    applyConfig,
    saveProfile,
    syncControls,
    getCurrent: () => currentProfile,
  };
})();

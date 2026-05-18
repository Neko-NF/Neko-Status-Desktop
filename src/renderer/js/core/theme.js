/**
 * core/theme.js
 * 主题模式（深色/浅色/定时/跟随系统）和主题色彩管理
 *
 * 依赖：core/event-bus.js
 * 发射事件：theme:mode-changed / theme:color-changed
 */
(function () {
  const bus = window._nekoModules?.eventBus;

  // ── 主题模式 ────────────────────────────────────────────────
  let _darkModeTimer = null;
  let _systemThemeHandler = null;

  /**
   * 设置深浅模式
   * @param {'dark'|'light'|'auto'|'system'} mode
   * @param {string} [startTime='18:00']
   * @param {string} [endTime='07:00']
   */
  function applyThemeMode(mode, startTime, endTime) {
    clearInterval(_darkModeTimer);
    _darkModeTimer = null;
    if (_systemThemeHandler) {
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', _systemThemeHandler);
      _systemThemeHandler = null;
    }

    function setDark(isDark) {
      const actual = isDark ? 'dark' : 'light';
      if (isDark) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('neko-theme-mode', actual);
      const icon = document.getElementById('themeModeIcon');
      if (icon) {
        icon.classList.remove('ph-sun', 'ph-moon');
        icon.classList.add(isDark ? 'ph-moon' : 'ph-sun');
      }
      const desc = document.getElementById('stgDarkModeDesc');
      if (desc) {
        const labels = { dark: '当前：深色模式', light: '当前：浅色模式', auto: `定时自动 (${startTime}–${endTime})`, system: '跟随系统外观' };
        desc.textContent = labels[mode] || '';
      }
      bus?.emit('theme:mode-changed', { mode: actual, isDark });
    }

    if (mode === 'dark') { setDark(true); return; }
    if (mode === 'light') { setDark(false); return; }
    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setDark(mq.matches);
      _systemThemeHandler = e => setDark(e.matches);
      mq.addEventListener('change', _systemThemeHandler, { once: false });
      return;
    }
    // auto（定时）
    function isInDarkRange() {
      const now = new Date();
      const curr = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = (startTime || '18:00').split(':').map(Number);
      const [eh, em] = (endTime || '07:00').split(':').map(Number);
      const start = sh * 60 + sm;
      const end   = eh * 60 + em;
      if (start <= end) return curr >= start && curr < end;
      return curr >= start || curr < end;
    }
    setDark(isInDarkRange());
    _darkModeTimer = setInterval(() => setDark(isInDarkRange()), 60000);
  }

  // ── 主题色 ──────────────────────────────────────────────────

  /** 解析颜色为 {r,g,b} */
  function parseColorRgb(colorStr) {
    const hex = (colorStr || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
    }
    const m = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return { r: 6, g: 182, b: 212 };
  }

  function normalizeThemeColorInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const plain = raw.replace(/^#/, '').replace(/^0x/i, '');
    if (/^[0-9a-f]{3}$/i.test(plain)) {
      return `#${plain.split('').map(ch => ch + ch).join('').toLowerCase()}`;
    }
    if (/^[0-9a-f]{6}$/i.test(plain)) {
      return `#${plain.toLowerCase()}`;
    }
    return '';
  }

  function getSavedCustomThemeColor() {
    return normalizeThemeColorInput(
      localStorage.getItem('neko-custom-theme-color')
      || (document.getElementById('stgCustomColorInput') || {}).value
      || localStorage.getItem('neko-theme-color')
    ) || '#06b6d4';
  }

  function syncThemeColorUI(color, customColor = getSavedCustomThemeColor()) {
    const normalizedColor = normalizeThemeColorInput(color) || '#06b6d4';
    const normalizedCustom = normalizeThemeColorInput(customColor) || normalizedColor;
    const builtinSelectors = document.querySelectorAll('.settings-swatch, .color-swatch[data-color]');
    let matchedBuiltin = false;

    builtinSelectors.forEach((s) => {
      const isMatch = s.dataset.color === normalizedColor;
      s.classList.toggle('active', isMatch);
      if (isMatch) matchedBuiltin = true;
      if (s.classList.contains('color-swatch') && s.dataset.color) {
        s.style.color = s.dataset.color;
      }
    });

    [
      document.getElementById('stgCustomColorBtn'),
      document.getElementById('topCustomColorBtn'),
    ].filter(Boolean).forEach((btn) => {
      btn.style.setProperty('--custom-swatch-color', normalizedCustom);
      btn.classList.toggle('active', !matchedBuiltin && normalizedColor === normalizedCustom);
    });

    const customColorInput = document.getElementById('stgCustomColorInput');
    const customColorHex = document.getElementById('stgCustomColorHex');
    const customColorPreview = document.getElementById('stgCustomColorPreview');
    if (customColorInput) customColorInput.value = normalizedCustom;
    if (customColorHex) customColorHex.value = normalizedCustom.toUpperCase();
    if (customColorPreview) customColorPreview.style.background = normalizedCustom;
  }

  /**
   * 应用主题色到 CSS 变量
   * @param {string} color - #hex 格式
   */
  function applyThemeColor(color, options = {}) {
    const normalizedColor = normalizeThemeColorInput(color);
    if (!normalizedColor) return false;
    const customColor = normalizeThemeColorInput(options.customColor || getSavedCustomThemeColor()) || normalizedColor;
    document.documentElement.style.setProperty('--theme-color', normalizedColor);
    localStorage.setItem('neko-theme-color', normalizedColor);
    localStorage.setItem('neko-custom-theme-color', customColor);
    syncThemeColorUI(normalizedColor, customColor);

    const profileAvatarImg = document.getElementById('profileModalAvatar');
    if (profileAvatarImg) {
      profileAvatarImg.src = `https://ui-avatars.com/api/?name=User&background=${normalizedColor.replace('#', '')}&color=fff`;
    }

    const configClient = window._nekoModules?.services?.ConfigClient;
    if (configClient?.set && options.persistSeed !== false) {
      const seedPromise = configClient.set('seedColor', normalizedColor);
      if (seedPromise?.catch) seedPromise.catch(() => {});
      if (options.persistCustom !== false) {
        const customPromise = configClient.set('customSeedColor', customColor);
        if (customPromise?.catch) customPromise.catch(() => {});
      }
    }

    if (options.emitEvent !== false) document.dispatchEvent(new CustomEvent('neko:themeChange'));
    bus?.emit('theme:color-changed', { color: normalizedColor, rgb: parseColorRgb(normalizedColor) });
    return true;
  }

  /** 获取当前主题色 */
  function getCurrentThemeColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() || '#06b6d4';
  }

  function initThemeColorControls() {
    if (document.documentElement.dataset.themeColorControlsBound === '1') return;
    document.documentElement.dataset.themeColorControlsBound = '1';

    const savedColor = normalizeThemeColorInput(localStorage.getItem('neko-theme-color')) || '#06b6d4';
    const savedCustomColor = getSavedCustomThemeColor();
    applyThemeColor(savedColor, { customColor: savedCustomColor, persistCustom: false, persistSeed: false, emitEvent: false });

    const colorPalette = document.getElementById('colorPalette');
    document.getElementById('themeColorBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      colorPalette?.classList.toggle('show');
    });

    document.querySelectorAll('.color-swatch[data-color]').forEach((swatch) => {
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        if (applyThemeColor(swatch.dataset.color)) {
          colorPalette?.classList.remove('show');
        }
      });
    });

    document.querySelectorAll('#stgColorSwatches .settings-swatch').forEach((swatch) => {
      swatch.addEventListener('click', () => {
        if (!applyThemeColor(swatch.dataset.color)) return;
        const customRow = document.getElementById('stgCustomColorRow');
        if (customRow) customRow.style.display = 'none';
      });
    });

    const customColorBtn = document.getElementById('stgCustomColorBtn');
    const customColorInput = document.getElementById('stgCustomColorInput');
    const customColorRow = document.getElementById('stgCustomColorRow');
    const customColorPreview = document.getElementById('stgCustomColorPreview');
    const customColorHex = document.getElementById('stgCustomColorHex');

    if (customColorBtn && customColorInput) {
      customColorBtn.addEventListener('click', () => {
        if (customColorRow) customColorRow.style.display = customColorRow.style.display === 'none' ? '' : 'none';
        const current = getSavedCustomThemeColor();
        customColorInput.value = current;
        if (customColorHex) customColorHex.value = current.toUpperCase();
        if (customColorPreview) customColorPreview.style.background = current;
      });

      customColorInput.addEventListener('input', () => {
        const color = customColorInput.value;
        if (customColorPreview) customColorPreview.style.background = color;
        if (customColorHex) customColorHex.value = color.toUpperCase();
      });

      if (customColorPreview) {
        customColorPreview.style.cursor = 'pointer';
        customColorPreview.addEventListener('click', () => customColorInput.click());
      }

      customColorHex?.addEventListener('input', () => {
        const normalized = normalizeThemeColorInput(customColorHex.value);
        if (!normalized) return;
        customColorInput.value = normalized;
        customColorHex.value = normalized.toUpperCase();
        if (customColorPreview) customColorPreview.style.background = normalized;
      });
    }

    document.getElementById('topCustomColorBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const customColor = getSavedCustomThemeColor();
      applyThemeColor(customColor, { customColor });
      colorPalette?.classList.remove('show');
    });

    document.getElementById('stgCustomColorApply')?.addEventListener('click', () => {
      const color = normalizeThemeColorInput(customColorHex?.value || customColorInput?.value);
      if (!color) {
        customColorHex?.focus();
        customColorHex?.select();
        return;
      }
      applyThemeColor(color, { customColor: color });
      if (customColorRow) customColorRow.style.display = 'none';
    });
  }

  // ── 字体 Profile ────────────────────────────────────────────
  const FONT_PROFILE_PRESETS = {
    default: {
      '--fw-page-title': '600', '--fw-page-subtitle': '400',
      '--fw-section-title': '600', '--fw-section-subtitle': '400',
      '--fw-section-label': '600', '--fw-row-title': '500',
      '--fw-row-desc': '400', '--fw-body-strong': '600',
      '--fw-value-strong': '700',
      '--tracking-section-label': '0.06em', '--tracking-label-caps': '0.07em'
    },
    cjkBalanced: {
      '--fw-page-title': '600', '--fw-page-subtitle': '420',
      '--fw-section-title': '580', '--fw-section-subtitle': '420',
      '--fw-section-label': '580', '--fw-row-title': '500',
      '--fw-row-desc': '420', '--fw-body-strong': '580',
      '--fw-value-strong': '650',
      '--tracking-section-label': '0.04em', '--tracking-label-caps': '0.05em'
    },
    uiNeutral: {
      '--fw-page-title': '650', '--fw-page-subtitle': '420',
      '--fw-section-title': '620', '--fw-section-subtitle': '420',
      '--fw-section-label': '620', '--fw-row-title': '520',
      '--fw-row-desc': '420', '--fw-body-strong': '620',
      '--fw-value-strong': '720',
      '--tracking-section-label': '0.06em', '--tracking-label-caps': '0.07em'
    },
    serifReadable: {
      '--fw-page-title': '680', '--fw-page-subtitle': '430',
      '--fw-section-title': '640', '--fw-section-subtitle': '430',
      '--fw-section-label': '640', '--fw-row-title': '520',
      '--fw-row-desc': '430', '--fw-body-strong': '620',
      '--fw-value-strong': '720',
      '--tracking-section-label': '0.03em', '--tracking-label-caps': '0.04em'
    }
  };

  const FONT_PROFILE_MATCHERS = [
    { name: 'cjkBalanced', pattern: /(yahei|微软雅黑|pingfang|苹方|hiragino sans|source han sans|思源黑体|noto sans cjk|harmonyos sans|misans|oppo sans|sarasa gothic|lxgw|wenkai)/i },
    { name: 'serifReadable', pattern: /(simsun|宋体|source han serif|思源宋体|noto serif|songti|times new roman|georgia)/i },
    { name: 'uiNeutral', pattern: /(segoe ui|aptos|inter|roboto|sf pro|helvetica neue|arial|ubuntu|fira sans)/i }
  ];

  function resolveUIFontProfile(font = '') {
    const name = String(font || '').trim();
    if (!name) return 'default';
    return FONT_PROFILE_MATCHERS.find(item => item.pattern.test(name))?.name || 'default';
  }

  function applyUIFontProfile(font = '') {
    const root = document.documentElement;
    const profileName = resolveUIFontProfile(font);
    const profile = FONT_PROFILE_PRESETS[profileName] || FONT_PROFILE_PRESETS.default;
    Object.entries(profile).forEach(([token, value]) => root.style.setProperty(token, value));
    root.dataset.fontProfile = profileName;
    root.dataset.uiFontName = font ? String(font) : 'system-default';
  }

  // ── 导出 ────────────────────────────────────────────────────
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.theme = {
    applyThemeMode,
    applyThemeColor,
    getCurrentThemeColor,
    normalizeThemeColorInput,
    getSavedCustomThemeColor,
    syncThemeColorUI,
    initThemeColorControls,
    parseColorRgb,
    applyUIFontProfile,
    resolveUIFontProfile,
    FONT_PROFILE_PRESETS,
  };
})();

/**
 * core/theme.js
 * 主题模式（深色/浅色/定时/跟随系统）和主题色彩管理
 *
 * 依赖：core/event-bus.js
 * 发射事件：theme:mode-changed / theme:color-changed
 */
(function () {
  const bus = window._nekoModules?.eventBus;
  const DEFAULT_THEME_COLOR = '#0ea5e9';

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
      document.dispatchEvent(new CustomEvent('neko:themeChange', { detail: { mode: actual, isDark } }));
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
    return { r: 14, g: 165, b: 233 };
  }

  function componentToHex(value) {
    return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  }

  function rgbToHex({ r, g, b }) {
    return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
  }

  function rgbToHsv({ r, g, b }) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = ((bn - rn) / d) + 2;
      else h = ((rn - gn) / d) + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: Math.round(h), s: max === 0 ? 0 : d / max, v: max };
  }

  function hsvToRgb({ h, s, v }) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (h < 60) [rp, gp, bp] = [c, x, 0];
    else if (h < 120) [rp, gp, bp] = [x, c, 0];
    else if (h < 180) [rp, gp, bp] = [0, c, x];
    else if (h < 240) [rp, gp, bp] = [0, x, c];
    else if (h < 300) [rp, gp, bp] = [x, 0, c];
    else [rp, gp, bp] = [c, 0, x];
    return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
  }

  function hexToHsv(color) {
    return rgbToHsv(parseColorRgb(color));
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
    ) || DEFAULT_THEME_COLOR;
  }

  function syncThemeColorUI(color, customColor = getSavedCustomThemeColor()) {
    const normalizedColor = normalizeThemeColorInput(color) || DEFAULT_THEME_COLOR;
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
    const topCustomColorHex = document.getElementById('topCustomColorHex');
    const topCustomColorPreview = document.getElementById('topCustomColorPreview');
    if (customColorInput) customColorInput.value = normalizedCustom;
    if (customColorHex) customColorHex.value = normalizedCustom.toUpperCase();
    if (customColorPreview) customColorPreview.style.background = normalizedCustom;
    if (topCustomColorHex) topCustomColorHex.value = normalizedCustom.toUpperCase();
    if (topCustomColorPreview) topCustomColorPreview.style.background = normalizedCustom;
  }

  /**
   * 应用主题色到 CSS 变量
   * @param {string} color - #hex 格式
   */
  function applyThemeColor(color, options = {}) {
    const normalizedColor = normalizeThemeColorInput(color);
    if (!normalizedColor) return false;
    const customColor = normalizeThemeColorInput(options.customColor || getSavedCustomThemeColor()) || normalizedColor;
    document.documentElement.style.setProperty('--theme-color-seed', normalizedColor);
    document.documentElement.style.removeProperty('--theme-color');
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
    const bodyColor = document.body
      ? getComputedStyle(document.body).getPropertyValue('--theme-color').trim()
      : '';
    return bodyColor
      || getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim()
      || DEFAULT_THEME_COLOR;
  }

  function initThemeColorControls() {
    if (document.documentElement.dataset.themeColorControlsBound === '1') return;
    document.documentElement.dataset.themeColorControlsBound = '1';

    const savedColor = normalizeThemeColorInput(localStorage.getItem('neko-theme-color')) || DEFAULT_THEME_COLOR;
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
    const topCustomColorBtn = document.getElementById('topCustomColorBtn');
    const topCustomColorEditor = document.getElementById('topCustomColorEditor');
    const topCustomColorPreview = document.getElementById('topCustomColorPreview');
    const topCustomColorHex = document.getElementById('topCustomColorHex');
    const topColorPickerPlane = document.getElementById('topColorPickerPlane');
    const topColorPickerHandle = document.getElementById('topColorPickerHandle');
    const topColorHue = document.getElementById('topColorHue');
    const stgColorPickerPlane = document.getElementById('stgColorPickerPlane');
    const stgColorPickerHandle = document.getElementById('stgColorPickerHandle');
    const stgColorHue = document.getElementById('stgColorHue');
    const topPickerState = hexToHsv(getSavedCustomThemeColor());
    const stgPickerState = hexToHsv(getSavedCustomThemeColor());

    function renderPicker(picker, pickerState) {
      if (picker.plane) {
        picker.plane.style.background = [
          'linear-gradient(to top, #000 0%, transparent 100%)',
          `linear-gradient(to right, #fff 0%, hsl(${pickerState.h} 100% 50%) 100%)`,
        ].join(', ');
      }
      if (picker.handle) {
        picker.handle.style.left = `${Math.round(pickerState.s * 100)}%`;
        picker.handle.style.top = `${Math.round((1 - pickerState.v) * 100)}%`;
      }
      if (picker.hue) picker.hue.value = String(pickerState.h);
    }

    const topPicker = { plane: topColorPickerPlane, handle: topColorPickerHandle, hue: topColorHue };
    const stgPicker = { plane: stgColorPickerPlane, handle: stgColorPickerHandle, hue: stgColorHue };

    function setCustomDraft(color) {
      const normalized = normalizeThemeColorInput(color) || getSavedCustomThemeColor();
      Object.assign(topPickerState, hexToHsv(normalized));
      Object.assign(stgPickerState, hexToHsv(normalized));
      if (customColorInput) customColorInput.value = normalized;
      if (customColorHex) customColorHex.value = normalized.toUpperCase();
      if (customColorPreview) customColorPreview.style.background = normalized;
      if (topCustomColorHex) topCustomColorHex.value = normalized.toUpperCase();
      if (topCustomColorPreview) topCustomColorPreview.style.background = normalized;
      [
        document.getElementById('stgCustomColorBtn'),
        topCustomColorBtn,
      ].filter(Boolean).forEach((btn) => btn.style.setProperty('--custom-swatch-color', normalized));
      renderPicker(topPicker, topPickerState);
      renderPicker(stgPicker, stgPickerState);
    }

    function syncCustomDraftColor(color) {
      if (customColorInput) customColorInput.value = color;
      if (customColorHex) customColorHex.value = color.toUpperCase();
      if (customColorPreview) customColorPreview.style.background = color;
      if (topCustomColorHex) topCustomColorHex.value = color.toUpperCase();
      if (topCustomColorPreview) topCustomColorPreview.style.background = color;
      [
        document.getElementById('stgCustomColorBtn'),
        topCustomColorBtn,
      ].filter(Boolean).forEach((btn) => btn.style.setProperty('--custom-swatch-color', color));
    }

    function setPickerDraftFromState(picker, pickerState) {
      const color = rgbToHex(hsvToRgb(pickerState));
      syncCustomDraftColor(color);
      renderPicker(picker, pickerState);
    }

    function updatePickerFromPoint(event, picker, pickerState) {
      if (!picker.plane) return;
      const rect = picker.plane.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      pickerState.s = x / rect.width;
      pickerState.v = 1 - (y / rect.height);
      setPickerDraftFromState(picker, pickerState);
    }

    function bindPickerPlane(picker, pickerState) {
      picker.plane?.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        picker.plane.setPointerCapture?.(event.pointerId);
        updatePickerFromPoint(event, picker, pickerState);
      });
      picker.plane?.addEventListener('pointermove', (event) => {
        if (event.buttons !== 1) return;
        updatePickerFromPoint(event, picker, pickerState);
      });
      picker.hue?.addEventListener('input', () => {
        pickerState.h = Number(picker.hue.value) || 0;
        setPickerDraftFromState(picker, pickerState);
      });
    }

    if (customColorBtn && customColorInput) {
      customColorBtn.addEventListener('click', () => {
        if (customColorRow) customColorRow.style.display = customColorRow.style.display === 'none' ? '' : 'none';
        setCustomDraft(getSavedCustomThemeColor());
      });

      customColorInput.addEventListener('input', () => {
        const color = customColorInput.value;
        setCustomDraft(color);
      });

      if (customColorPreview) {
        customColorPreview.style.cursor = 'pointer';
        customColorPreview.addEventListener('click', () => {
          customColorHex?.focus();
          customColorHex?.select();
        });
      }

      customColorHex?.addEventListener('input', () => {
        const normalized = normalizeThemeColorInput(customColorHex.value);
        if (!normalized) return;
        setCustomDraft(normalized);
      });
    }

    topCustomColorBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (topCustomColorEditor) {
        topCustomColorEditor.hidden = !topCustomColorEditor.hidden;
        setCustomDraft(getSavedCustomThemeColor());
      }
    });

    bindPickerPlane(topPicker, topPickerState);
    bindPickerPlane(stgPicker, stgPickerState);

    topCustomColorPreview?.addEventListener('click', (e) => {
      e.stopPropagation();
      topCustomColorHex?.focus();
      topCustomColorHex?.select();
    });

    topCustomColorHex?.addEventListener('input', () => {
      const normalized = normalizeThemeColorInput(topCustomColorHex.value);
      if (!normalized) return;
      setCustomDraft(normalized);
    });

    document.getElementById('topCustomColorApply')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = normalizeThemeColorInput(topCustomColorHex?.value);
      if (!color) {
        topCustomColorHex?.focus();
        topCustomColorHex?.select();
        return;
      }
      applyThemeColor(color, { customColor: color });
      if (topCustomColorEditor) topCustomColorEditor.hidden = true;
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

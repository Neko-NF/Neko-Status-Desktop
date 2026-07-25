/**
 * Local avatar fallbacks for offline startup and failed remote images.
 */
(function attachAvatarFallback() {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.components = window._nekoModules.components || {};

  const APP_ICON_URL = '../../assets/app_icon.png';
  const DEFAULT_COLOR = '#0ea5e9';

  function avatarColor() {
    const saved = localStorage.getItem('neko-theme-color') || '';
    return /^#[0-9a-f]{6}$/i.test(saved) ? saved : DEFAULT_COLOR;
  }

  function createInitialDataUrl(name = 'N') {
    const initial = Array.from(String(name || 'N').trim())[0]?.toUpperCase() || 'N';
    const safeInitial = initial
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${avatarColor()}"/><text x="64" y="70" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Segoe UI,Microsoft YaHei,sans-serif" font-size="56" font-weight="600">${safeInitial}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function fallbackUrl(image) {
    return image.dataset.avatarFallback === 'initial'
      ? createInitialDataUrl(image.dataset.avatarName || image.alt || 'N')
      : APP_ICON_URL;
  }

  function apply(image, { src = '', name = '', mode = 'initial' } = {}) {
    if (!image) return;
    image.dataset.avatarFallback = mode;
    image.dataset.avatarName = name;
    delete image.dataset.avatarFallbackApplied;
    image.src = src || fallbackUrl(image);
  }

  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.avatarFallback) return;
    if (image.dataset.avatarFallbackApplied === 'true') return;
    image.dataset.avatarFallbackApplied = 'true';
    image.src = fallbackUrl(image);
  }, true);

  window._nekoModules.components.avatarFallback = {
    APP_ICON_URL,
    apply,
    createInitialDataUrl,
  };
})();

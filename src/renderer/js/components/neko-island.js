/**
 * components/neko-island.js
 * 灵动岛通知组件
 *
 * 特性：
 * - 串行队列，同类型同内容去重
 * - 自动进出场动画
 * - 全局可用 window.showNekoIsland()
 */
(function () {
  const _queue = [];
  let _active = false;

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * 显示灵动岛通知
   * @param {string} text - 通知文本
   * @param {'success'|'warn'|'error'|'info'} [type='info']
   * @param {number} [durationMs=3000]
   */
  function showNekoIsland(text, type = 'info', durationMs = 3000) {
    if (_queue.some(q => q.text === text && q.type === type)) return;
    _queue.push({ text, type, durationMs });
    if (!_active) _drain();
  }

  function _drain() {
    const host = document.getElementById('nekoIsland');
    if (!host || !_queue.length) { _active = false; return; }
    _active = true;
    const { text, type, durationMs } = _queue.shift();
    const iconMap = { success: 'ph-check-circle', warn: 'ph-warning', error: 'ph-x-circle', info: 'ph-info' };
    const el = document.createElement('div');
    el.className = `neko-island ${type}`;
    el.title = String(text);
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.innerHTML = `<i class="ph ${iconMap[type] || 'ph-info'} neko-island-icon"></i><span class="neko-island-text">${escapeHtml(String(text))}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => { el.remove(); _drain(); }, 420);
    }, durationMs);
  }

  // 全局可用
  window.showNekoIsland = showNekoIsland;

  window._nekoModules = window._nekoModules || {};
  window._nekoModules.nekoIsland = { show: showNekoIsland };
})();

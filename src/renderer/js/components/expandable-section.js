/**
 * components/expandable-section.js
 * 展开/收起动画组件
 *
 * 从 app.js L32-109 提取，支持：
 * - 平滑展开/收起动画
 * - prefers-reduced-motion 适配
 * - 全局可用 window._nekoUIHelpers.setExpandableSectionState
 */
(function () {
  /**
   * 设置元素的展开/收起状态
   * @param {HTMLElement} el
   * @param {boolean} expanded
   * @param {Object} [options]
   * @param {string} [options.display='block'] - 展开时的 display 值
   * @param {number} [options.duration=280] - 动画时长 ms
   */
  function setExpandableSectionState(el, expanded, options = {}) {
    if (!el) return;
    const targetDisplay = options.display ?? el.dataset.expandedDisplay ?? 'block';
    const duration = options.duration ?? 280;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    el.dataset.expandedDisplay = targetDisplay;
    el.classList.add('ui-expandable');

    if (el._expandTimer) {
      clearTimeout(el._expandTimer);
      el._expandTimer = null;
    }

    if (reduceMotion) {
      el.style.display = expanded ? targetDisplay : 'none';
      el.style.maxHeight = expanded ? 'none' : '0px';
      el.style.opacity = expanded ? '1' : '0';
      el.style.transform = expanded ? 'translateY(0) scaleY(1)' : 'translateY(-6px) scaleY(0.98)';
      el.classList.toggle('is-expanded', expanded);
      el.classList.toggle('is-collapsed', !expanded);
      el.classList.remove('is-animating');
      return;
    }

    if (expanded) {
      el.style.display = targetDisplay;
      el.classList.add('is-animating');
      el.classList.remove('is-collapsed');
      el.classList.add('is-expanded');
      el.style.maxHeight = '0px';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px) scaleY(0.98)';

      requestAnimationFrame(() => {
        const fullHeight = el.scrollHeight;
        el.style.maxHeight = `${fullHeight}px`;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0) scaleY(1)';
      });

      el._expandTimer = setTimeout(() => {
        el.classList.remove('is-animating');
        el.style.maxHeight = 'none';
        el.style.opacity = '';
        el.style.transform = '';
        el._expandTimer = null;
      }, duration);
      return;
    }

    if (getComputedStyle(el).display === 'none') {
      el.classList.remove('is-expanded', 'is-animating');
      el.classList.add('is-collapsed');
      return;
    }

    el.classList.add('is-animating');
    el.classList.remove('is-expanded');
    el.style.display = targetDisplay;
    el.style.maxHeight = `${el.scrollHeight}px`;
    el.style.opacity = '1';
    el.style.transform = 'translateY(0) scaleY(1)';

    requestAnimationFrame(() => {
      el.style.maxHeight = '0px';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px) scaleY(0.98)';
    });

    el._expandTimer = setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('is-animating');
      el.classList.add('is-collapsed');
      el.style.maxHeight = '0px';
      el._expandTimer = null;
    }, duration);
  }

  // 兼容老代码
  window._nekoUIHelpers = window._nekoUIHelpers || {};
  window._nekoUIHelpers.setExpandableSectionState = setExpandableSectionState;

  window._nekoModules = window._nekoModules || {};
  window._nekoModules.expandableSection = { setExpandableSectionState };
})();

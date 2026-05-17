/**
 * components/modal.js
 * 通用模态框管理
 *
 * 支持：
 * - 点击背景关闭（mousedown 锚定防误关）
 * - 多模态框同时管理
 * - Escape 关闭最上层
 */
(function () {
  let _mouseDownTarget = null;

  /** 打开模态框 */
  function openModal(el) {
    if (!el) return;
    if (typeof el === 'string') el = document.getElementById(el);
    if (el) el.classList.add('show');
  }

  /** 关闭模态框 */
  function closeModal(el) {
    if (!el) return;
    if (typeof el === 'string') el = document.getElementById(el);
    if (el) el.classList.remove('show');
  }

  /** 注册模态框背景点击关闭 */
  function registerBackdropClose(...elements) {
    const els = elements.map(e => typeof e === 'string' ? document.getElementById(e) : e).filter(Boolean);
    document.addEventListener('mousedown', (e) => { _mouseDownTarget = e.target; });
    document.addEventListener('click', (e) => {
      els.forEach(el => {
        if (_mouseDownTarget === el && e.target === el) {
          closeModal(el);
        }
      });
      _mouseDownTarget = null;
    });
  }

  // 全局 Escape 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modals = document.querySelectorAll('.modal-overlay.show, .auth-modal-overlay.show');
    if (modals.length > 0) {
      closeModal(modals[modals.length - 1]);
    }
  });

  window._nekoModules = window._nekoModules || {};
  window._nekoModules.modal = { openModal, closeModal, registerBackdropClose };
})();

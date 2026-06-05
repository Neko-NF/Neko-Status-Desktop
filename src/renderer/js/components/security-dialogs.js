(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.components = window._nekoModules.components || {};

  const $ = (id) => document.getElementById(id);

  const defaultDeps = {
    escapeHtml: (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    showNotice: () => {},
    openConfig: () => {},
  };

  function create(deps = {}) {
    const api = {
      _deps: { ...defaultDeps, ...deps },
      _bound: false,

      init(nextDeps = {}) {
        this._deps = { ...this._deps, ...nextDeps };
        if (this._bound) return this;
        this._bound = true;

        $('takeoverWarningDismissBtn')?.addEventListener('click', () => this.hideWarning());
        $('takeoverWarningCloseBtn')?.addEventListener('click', () => this.hideWarning());
        $('takeoverWarningActionBtn')?.addEventListener('click', () => {
          this.hideWarning();
          this._deps.openConfig();
        });
        $('takeoverWarningModal')?.addEventListener('click', (event) => {
          if (event.target === event.currentTarget) this.hideWarning();
        });
        return this;
      },

      hideWarning() {
        $('takeoverWarningModal')?.classList.remove('show');
      },

      showWarning(title, desc, detail, showAction) {
        const modal = $('takeoverWarningModal');
        if (!modal) return false;

        const titleEl = $('takeoverWarningTitle');
        const descEl = $('takeoverWarningDesc');
        const detailBox = $('takeoverDetailBox');
        const actionBtn = $('takeoverWarningActionBtn');

        if (titleEl) titleEl.textContent = title;
        if (descEl) descEl.textContent = desc;
        if (detailBox) {
          detailBox.innerHTML = `<i class="ph ph-info" style="color: var(--error-coral); margin-right: 4px;"></i>${this._deps.escapeHtml(detail || '无附加信息')}`;
        }
        if (actionBtn) actionBtn.style.display = showAction ? '' : 'none';
        modal.classList.add('show');
        this._deps.showNotice(title, 'error', 5000);
        return true;
      },

      confirmTakeover() {
        return new Promise((resolve) => {
          const modal = $('takeoverConfirmModal');
          if (!modal) {
            resolve(true);
            return;
          }

          modal.classList.add('show');
          const okBtn = $('takeoverConfirmOkBtn');
          const cancelBtn = $('takeoverConfirmCancelBtn');
          const closeBtn = $('takeoverConfirmCloseBtn');

          const cleanup = () => {
            modal.classList.remove('show');
            okBtn?.removeEventListener('click', onOk);
            cancelBtn?.removeEventListener('click', onCancel);
            closeBtn?.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onOverlay);
          };
          const onOk = () => {
            cleanup();
            resolve(true);
          };
          const onCancel = () => {
            cleanup();
            resolve(false);
          };
          const onOverlay = (event) => {
            if (event.target !== modal) return;
            cleanup();
            resolve(false);
          };

          okBtn?.addEventListener('click', onOk);
          cancelBtn?.addEventListener('click', onCancel);
          closeBtn?.addEventListener('click', onCancel);
          modal.addEventListener('click', onOverlay);
        });
      },
    };

    return api.init();
  }

  window._nekoModules.components.SecurityDialogs = { create };
})();

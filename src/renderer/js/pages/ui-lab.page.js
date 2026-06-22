(function attachUiLabPage() {
  'use strict';

  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const byId = (id) => document.getElementById(id);
  const CONTEXT_META = Object.freeze({
    startup: Object.freeze({
      short: '启动',
      label: '启动与系统初始化',
      description: '用于用户明显需要等待、但没有百分比可显示的启动准备阶段。',
      previewLabel: '正在完成启动检查…',
      placements: Object.freeze(['启动更新检查', '系统初始化', '设备权限准备']),
    }),
    network: Object.freeze({
      short: '网络',
      label: '网络同步',
      description: '用于更新源检查、远端同步和跨端数据交换，不遮盖可计算下载进度。',
      previewLabel: '正在同步远端状态…',
      placements: Object.freeze(['更新源检查', '跨端同步', '公告详情加载']),
    }),
    search: Object.freeze({
      short: '诊断',
      label: '搜索与诊断',
      description: '用于扫描、探测、诊断类等待，让用户明确知道系统正在向外搜索。',
      previewLabel: '正在扫描可用结果…',
      placements: Object.freeze(['更新诊断', '窗口列表检查', '设备探测']),
    }),
    background: Object.freeze({
      short: '后台',
      label: '后台准备',
      description: '用于安静的后台准备和缓存刷新，动效需要克制，不能抢走注意力。',
      previewLabel: '正在安静准备…',
      placements: Object.freeze(['后台缓存刷新', '隐私窗口列表', '低优先级准备']),
    }),
  });

  function contextLabel(context) {
    return CONTEXT_META[context]?.short || '通用';
  }

  const UiLabPage = {
    _inited: false,
    _deps: {},
    _config: {
      enableExperimentalFeatures: false,
      enableExperimentalCurveLoaders: false,
      loadingCurveStyle: 'auto',
    },
    _previewContext: 'startup',
    _previewController: null,
    _diagnosticsTimer: 0,

    init(deps = {}) {
      this._deps = { ...this._deps, ...deps };
      if (this._inited) return;
      this._inited = true;
      this.renderCurveGrid();
      this.bindEvents();
      this.createPreview();
      this.syncUi();
      if (window._nekoModules?.router?.getCurrentPage?.() === 'page-ui-lab') this.activate();
    },

    curves() {
      return this._deps.curves || window._nekoModules?.components?.LoadingCurves;
    },

    loading() {
      return this._deps.loading || window._nekoModules?.components?.LoadingSystem;
    },

    configClient() {
      return this._deps.config || window._nekoModules?.services?.ConfigClient;
    },

    renderCurveGrid() {
      const grid = byId('uiLabCurveGrid');
      const curves = this.curves();
      const loading = this.loading();
      if (!grid || !curves || grid.dataset.rendered === '1') return;
      grid.textContent = '';
      curves.list().forEach((curve) => {
        const button = document.createElement('button');
        const visual = document.createElement('span');
        const copy = document.createElement('span');
        const name = document.createElement('strong');
        const family = document.createElement('small');
        const tags = document.createElement('span');
        const motion = document.createElement('span');
        button.type = 'button';
        button.className = 'ui-lab-curve-card';
        button.dataset.curveId = curve.id;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', `固定加载曲线为 ${curve.name}`);
        visual.className = 'ui-lab-curve-thumb';
        copy.className = 'ui-lab-curve-copy';
        tags.className = 'ui-lab-curve-tags';
        motion.className = 'ui-lab-curve-motion';
        name.textContent = curve.name;
        family.textContent = `${curve.family.toUpperCase()} · ${curve.id}`;
        (curve.recommendedFor || curve.contexts || ['generic']).slice(0, 3).forEach((context) => {
          const tag = document.createElement('span');
          tag.className = 'ui-lab-curve-tag';
          tag.textContent = contextLabel(context);
          tags.appendChild(tag);
        });
        motion.textContent = curve.motionSummary || curve.usage || curve.description;
        const svg = loading?.createStaticSvg?.(curve.id, { size: 'md' });
        if (svg) visual.appendChild(svg);
        copy.append(name, family, tags, motion);
        button.append(visual, copy);
        grid.appendChild(button);
      });
      grid.dataset.rendered = '1';
    },

    createPreview() {
      const stage = byId('uiLabPreviewStage');
      if (!stage || this._previewController) return;
      this._previewController = this.loading()?.create?.(stage, {
        preview: true,
        context: this._previewContext,
        mode: 'section',
        size: 'lg',
        label: CONTEXT_META[this._previewContext]?.previewLabel || 'UI 实验预览',
        delayMs: 0,
        minVisibleMs: 0,
      }) || null;
      this._previewController?.hide?.();
    },

    bindEvents() {
      byId('uiLabApplySwitch')?.addEventListener('click', (event) => {
        this.pulseControl(event.currentTarget);
        this.toggleApplication();
      });
      byId('uiLabAutoBtn')?.addEventListener('click', (event) => {
        this.pulseControl(event.currentTarget);
        this.saveStyle('auto');
      });
      byId('uiLabContextGroup')?.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-loading-context]');
        if (!button) return;
        this.pulseControl(button);
        this._previewContext = button.dataset.loadingContext || 'startup';
        this.syncPreview();
      });
      byId('uiLabCurveGrid')?.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-curve-id]');
        if (!button) return;
        this.pulseControl(button);
        this.saveStyle(button.dataset.curveId);
      });
      window._nekoModules?.eventBus?.on?.('router:page-changed', ({ page }) => {
        if (page === 'page-ui-lab') this.activate();
        else this.deactivate();
      });
    },

    async toggleApplication() {
      const next = !this._config.enableExperimentalCurveLoaders;
      await this.saveConfig('enableExperimentalCurveLoaders', next, next ? '曲线加载器已应用' : '已恢复经典加载器');
    },

    async saveStyle(style) {
      const normalized = this.curves()?.normalizeStyle?.(style) || 'auto';
      const curveName = this.curves()?.get?.(normalized)?.name;
      await this.saveConfig(
        'loadingCurveStyle',
        normalized,
        normalized === 'auto' ? '已恢复场景自动搭配' : `已固定为 ${curveName || normalized}`,
      );
    },

    async saveConfig(key, value, message) {
      const client = this.configClient();
      if (!client?.set) return;
      try {
        const result = await client.set(key, value);
        if (result?.ok === false) throw new Error(result.error || result.message || '保存失败');
        let cfg = { ...this._config, [key]: value };
        try { cfg = await client.getAll?.() || cfg; } catch {}
        this.applyConfig(cfg);
        this._deps.applyExperimentalFeatureState?.(cfg);
        this._deps.showNotice?.(message, 'success', 1800);
      } catch (error) {
        this._deps.showNotice?.(error.message || '实验设置保存失败', 'error', 2600);
      }
    },

    applyConfig(cfg = {}) {
      this._config = { ...this._config, ...cfg };
      this.loading()?.applyPreferences?.(this._config);
      this.syncUi();
    },

    syncUi() {
      const enabled = this._config.enableExperimentalFeatures === true
        && this._config.enableExperimentalCurveLoaders === true;
      byId('uiLabApplySwitch')?.classList.toggle('on', enabled);
      byId('uiLabApplySwitch')?.setAttribute('aria-checked', enabled ? 'true' : 'false');
      const applyText = byId('uiLabApplyState');
      if (applyText) applyText.textContent = enabled ? '已应用到正式界面' : '仅在实验室预览';
      this.syncPreview();
    },

    syncPreview() {
      const curves = this.curves();
      if (!curves) return;
      const style = curves.normalizeStyle(this._config.loadingCurveStyle);
      const resolved = curves.resolveStyle(style, this._previewContext);
      const definition = curves.get(resolved);
      const meta = CONTEXT_META[this._previewContext] || CONTEXT_META.startup;
      this._previewController?.setVariant?.(resolved);
      this._previewController?.setLabel?.(style === 'auto' ? meta.previewLabel : `${definition?.name || resolved} · ${meta.short}预览`);

      document.querySelectorAll('#uiLabContextGroup [data-loading-context]').forEach((button) => {
        const active = button.dataset.loadingContext === this._previewContext;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      byId('uiLabAutoBtn')?.classList.toggle('active', style === 'auto');
      byId('uiLabAutoBtn')?.setAttribute('aria-pressed', style === 'auto' ? 'true' : 'false');
      document.querySelectorAll('#uiLabCurveGrid [data-curve-id]').forEach((button) => {
        const active = style !== 'auto' && button.dataset.curveId === style;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      const title = byId('uiLabPreviewName');
      const desc = byId('uiLabPreviewDesc');
      const formula = byId('uiLabPreviewFormula');
      const mode = byId('uiLabPreviewMode');
      const where = byId('uiLabPreviewWhere');
      const motion = byId('uiLabMotionSummary');
      if (title) title.textContent = definition?.name || resolved;
      if (desc) desc.textContent = `${meta.description} 当前预览：${definition?.description || ''}`;
      if (formula) formula.textContent = `ID: ${definition?.id || resolved} · ${definition?.formula || ''}`;
      if (mode) mode.textContent = style === 'auto' ? `自动 · ${meta.label}` : `固定 · ${definition?.name || resolved}`;
      if (motion) motion.textContent = definition?.motionSummary || '非线性速度与轻量呼吸反馈。';
      this.renderChips(where, meta.placements);
    },

    contextLabel(context) {
      return CONTEXT_META[context]?.label || '通用';
    },

    renderChips(container, values = []) {
      if (!container) return;
      container.textContent = '';
      if (Array.isArray(container.children)) container.children.length = 0;
      values.forEach((value) => {
        const chip = document.createElement('span');
        chip.className = 'ui-lab-chip';
        chip.textContent = value;
        container.appendChild(chip);
      });
    },

    pulseControl(element) {
      if (!element?.classList) return;
      element.classList.remove('is-feedback');
      // Force the next style update to replay the micro feedback animation.
      void element.offsetWidth;
      element.classList.add('is-feedback');
      window.setTimeout?.(() => element.classList.remove('is-feedback'), 180);
    },

    activate() {
      this._previewController?.show?.();
      this.updateDiagnostics();
      if (!this._diagnosticsTimer) {
        this._diagnosticsTimer = window.setInterval(() => this.updateDiagnostics(), 750);
      }
    },

    deactivate() {
      this._previewController?.hide?.();
      if (this._diagnosticsTimer) window.clearInterval(this._diagnosticsTimer);
      this._diagnosticsTimer = 0;
    },

    updateDiagnostics() {
      const diagnostics = this.loading()?.getDiagnostics?.() || {};
      const values = {
        uiLabDiagActive: `${diagnostics.active || 0} / ${diagnostics.maxActive || 4}`,
        uiLabDiagPaused: `${diagnostics.paused || 0} 个`,
        uiLabDiagFrame: `${Number(diagnostics.frameCostMs || 0).toFixed(2)} ms`,
        uiLabDiagMotion: diagnostics.reducedMotion ? '减少动态' : '完整动态',
      };
      Object.entries(values).forEach(([id, value]) => {
        const element = byId(id);
        if (element) element.textContent = value;
      });
    },
  };

  window._nekoModules.pages.UiLabPage = UiLabPage;
})();

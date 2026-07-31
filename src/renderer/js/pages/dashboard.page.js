(function() {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const STORAGE_KEY = 'neko_layout_config';

  function $(id) {
    return document.getElementById(id);
  }

  function getDashboardSections() {
    return Array.from(document.querySelectorAll('.dashboard-section'));
  }

  function getDashboardCards() {
    return Array.from(document.querySelectorAll('.dashboard-section > .glass-card'));
  }

  function setCardViewState(card, swapped) {
    if (!card) return;
    const viewDefault = card.querySelector('.view-default');
    const viewSwapped = card.querySelector('.view-swapped');
    if (!viewDefault || !viewSwapped) return;
    card.dataset.viewState = swapped ? 'swapped' : 'default';
    const stack = card.querySelector('#replaceableViewStack, .dashboard-view-stack');
    const setter = window._nekoUIHelpers?.setViewStackState;
    const active = swapped ? viewSwapped : viewDefault;
    if (stack && typeof setter === 'function') {
      setter(stack, active, { selector: '[data-ui-view]', display: 'flex', duration: 220 });
    } else {
      viewDefault.style.display = swapped ? 'none' : 'flex';
      viewSwapped.style.display = swapped ? 'flex' : 'none';
      viewDefault.setAttribute?.('aria-hidden', swapped ? 'true' : 'false');
      viewSwapped.setAttribute?.('aria-hidden', swapped ? 'false' : 'true');
    }
  }

  function readLayoutFromStorage() {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (!savedConfig) return null;
    try {
      const layout = JSON.parse(savedConfig);
      return Array.isArray(layout) ? layout : null;
    } catch (error) {
      console.error('[DashboardPage] failed to load saved layout', error);
      return null;
    }
  }

  function persistLayoutToConfig(layout) {
    const promise = window._nekoModules?.services?.ConfigClient?.setDashboardLayout?.(layout);
    if (promise?.catch) promise.catch(() => {});
  }

  function escapeWith(deps, value) {
    const esc = deps?.escapeHtml;
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function firstPresent(...values) {
    return values.find((value) => value !== undefined && value !== null);
  }

  function normalizeLastReportedApp(data = {}) {
    const appName = firstPresent(
      data.appName,
      data.windowTitle,
      data.foregroundWindowTitle,
      data.activeWindowTitle,
      data.lastReportedApp,
      data.lastReportedAppName,
      data.currentAppName
    );
    const packageName = firstPresent(
      data.packageName,
      data.processName,
      data.foregroundProcessName,
      data.activeProcessName,
      data.lastReportedPackageName,
      data.lastReportedProcessName,
      data.currentProcessName
    );
    return { appName, packageName };
  }

  function resolveEventTimestamp(value) {
    const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(ts) ? ts : Date.now();
  }

  function formatTimeOnly(value) {
    const d = new Date(resolveEventTimestamp(value));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatDateTime(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return formatDateTime(Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function setScreenshotPreviewTime(value) {
    const el = document.querySelector('.screenshot-preview-time');
    if (el) el.textContent = value;
  }

  function parseColorRgb(colorStr) {
    const color = (colorStr || '').trim();
    const parseHex = (value) => ({
      r: parseInt(value.slice(1, 3), 16),
      g: parseInt(value.slice(3, 5), 16),
      b: parseInt(value.slice(5, 7), 16),
    });
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      return parseHex(color);
    }
    const mix = color.match(/^color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+([\d.]+)%,\s*(#[0-9a-f]{6})\s+([\d.]+)%\)$/i);
    if (mix) {
      const first = parseHex(mix[1]);
      const second = parseHex(mix[3]);
      const firstWeight = Number(mix[2]);
      const secondWeight = Number(mix[4]);
      const totalWeight = firstWeight + secondWeight || 100;
      return {
        r: Math.round((first.r * firstWeight + second.r * secondWeight) / totalWeight),
        g: Math.round((first.g * firstWeight + second.g * secondWeight) / totalWeight),
        b: Math.round((first.b * firstWeight + second.b * secondWeight) / totalWeight),
      };
    }
    const srgb = color.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (srgb) {
      return {
        r: Math.round(Number(srgb[1]) * 255),
        g: Math.round(Number(srgb[2]) * 255),
        b: Math.round(Number(srgb[3]) * 255),
      };
    }
    const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (match) return { r: +match[1], g: +match[2], b: +match[3] };
    return { r: 6, g: 182, b: 212 };
  }

  function isLightTheme() {
    return document.documentElement.hasAttribute('data-theme');
  }

  function isQuietProfile() {
    return document.documentElement.dataset?.uiProfile === 'quiet';
  }

  function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  }

  function setTrendChartStatus(message) {
    const wrap = document.querySelector('.chart-canvas-wrap');
    if (!wrap) return;
    let status = wrap.querySelector('.chart-runtime-status');
    if (!message) {
      status?.remove();
      return;
    }
    if (!status) {
      status = document.createElement('div');
      status.className = 'chart-runtime-status';
      wrap.appendChild(status);
    }
    status.textContent = message;
  }

  const TREND_RANGE_CONFIG = Object.freeze({
    '1m': Object.freeze({ totalMs: 60e3, buckets: 12 }),
    '1h': Object.freeze({ totalMs: 3600e3, buckets: 60 }),
    '12h': Object.freeze({ totalMs: 12 * 3600e3, buckets: 12 }),
  });

  function trendRangeConfig(rangeId) {
    const config = TREND_RANGE_CONFIG[rangeId] || TREND_RANGE_CONFIG['1m'];
    return { ...config, bucketMs: config.totalMs / config.buckets };
  }

  function alignTrendBucket(timestamp, bucketMs) {
    return Math.floor(Number(timestamp) / bucketMs) * bucketMs;
  }

  function formatTrendBucketLabel(timestamp, rangeId) {
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date(timestamp);
    return rangeId === '1m'
      ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function projectionValues(projection) {
    const average = (sum, count) => (count > 0 ? +(sum / count).toFixed(1) : null);
    return {
      labels: projection.bucketStarts.map((timestamp) => formatTrendBucketLabel(timestamp, projection.rangeId)),
      cpuData: projection.cpuSums.map((sum, index) => average(sum, projection.counts[index])),
      memData: projection.memSums.map((sum, index) => average(sum, projection.counts[index])),
    };
  }

  function addMetricToProjection(projection, metric) {
    const timestamp = Number(metric?.timestamp);
    if (!Number.isFinite(timestamp) || projection.bucketStarts.length === 0) return -1;
    const firstBucket = projection.bucketStarts[0];
    const index = Math.floor((timestamp - firstBucket) / projection.bucketMs);
    if (index < 0 || index >= projection.bucketStarts.length) return -1;
    projection.counts[index] += 1;
    projection.cpuSums[index] += Number(metric.cpuPct) || 0;
    projection.memSums[index] += Number(metric.memPct) || 0;
    return index;
  }

  function makeTrendChartData(metricsBuffer, rangeId, now = Date.now()) {
    const { buckets, bucketMs } = trendRangeConfig(rangeId);
    const currentBucket = alignTrendBucket(now, bucketMs);
    const firstBucket = currentBucket - (buckets - 1) * bucketMs;
    const projection = {
      rangeId: TREND_RANGE_CONFIG[rangeId] ? rangeId : '1m',
      bucketMs,
      bucketStarts: Array.from({ length: buckets }, (_, index) => firstBucket + index * bucketMs),
      counts: Array(buckets).fill(0),
      cpuSums: Array(buckets).fill(0),
      memSums: Array(buckets).fill(0),
    };
    (Array.isArray(metricsBuffer) ? metricsBuffer : []).forEach((metric) => {
      const timestamp = Number(metric?.timestamp);
      if (timestamp <= now) addMetricToProjection(projection, metric);
    });
    return { ...projectionValues(projection), projection };
  }

  const trendHoverLinePlugin = {
    id: 'nekoTrendHoverLine',
    afterDatasetsDraw(chart) {
      const active = chart.tooltip?.getActiveElements?.() || [];
      const x = active[0]?.element?.x;
      const area = chart.chartArea;
      if (!Number.isFinite(x) || !area) return;
      const ctx = chart.ctx;
      ctx.save?.();
      ctx.beginPath?.();
      ctx.moveTo?.(x, area.top);
      ctx.lineTo?.(x, area.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = isLightTheme() ? 'rgba(30, 35, 42, 0.24)' : 'rgba(235, 238, 244, 0.26)';
      ctx.stroke?.();
      ctx.restore?.();
    }
  };

  const DashboardPage = {
    _inited: false,
    _editMode: false,
    _draggedCard: null,
    _gridRects: new Map(),
    _preEditSnapshot: [],
    _serviceRunning: false,
    _healthStats: { total: 0, success: 0 },
    _trendChart: null,
    _trendRange: '1m',
    _trendProjection: null,
    _metricsBuffer: [],
    _lastChartUpdateTs: 0,
    _themeColorRgb: { r: 6, g: 182, b: 212 },
    _rebuildTimer: null,
    _trendRuntimeBound: false,
    _runtimeDeps: {
      escapeHtml: null,
      onUploadHealthChange: null,
    },

    init() {
      if (this._inited) return;
      this._inited = true;
      console.log('[DashboardPage] 初始化');
      this.bindEvents();
      this.loadLayoutConfig();
    },

    bindEvents() {
      this.bindReportToggleDemo();
      this.bindLayoutEditor();
    },

    bindReportToggleDemo() {
      const reportToggleBtn = $('reportToggleBtn');
      const deviceStatusDot = $('deviceStatusDot');
      if (!reportToggleBtn || reportToggleBtn.dataset.dashboardBound === '1') return;
      reportToggleBtn.dataset.dashboardBound = '1';

      let isReporting = true;
      reportToggleBtn.addEventListener('click', () => {
        if (reportToggleBtn.classList.contains('btn-pending')) return;

        if (isReporting) {
          reportToggleBtn.className = 'status-toggle-btn btn-pending';
          window._nekoUIHelpers?.setButtonBusy?.(reportToggleBtn, true, { label: '停止中…' });

          setTimeout(() => {
            window._nekoUIHelpers?.setButtonBusy?.(reportToggleBtn, false);
            isReporting = false;
            reportToggleBtn.className = 'status-toggle-btn btn-start';
            reportToggleBtn.innerHTML = '<i class="ph ph-play-circle"></i> 开始上报';
            deviceStatusDot?.classList.add('error');
          }, 800);
          return;
        }

        reportToggleBtn.className = 'status-toggle-btn btn-pending';
        window._nekoUIHelpers?.setButtonBusy?.(reportToggleBtn, true, { label: '连接中…' });

        setTimeout(() => {
          window._nekoUIHelpers?.setButtonBusy?.(reportToggleBtn, false);
          isReporting = true;
          reportToggleBtn.className = 'status-toggle-btn btn-stop';
          reportToggleBtn.innerHTML = '<i class="ph ph-stop-circle"></i> 停止上报';
          deviceStatusDot?.classList.remove('error');
        }, 1200);
      });
    },

    bindLayoutEditor() {
      const editLayoutBtn = $('editLayoutBtn');
      const saveEditBtn = $('saveEditBtn');
      const cancelEditBtn = $('cancelEditBtn');
      const restoreDefaultBtn = $('restoreDefaultBtn');
      const editActionBar = $('editActionBar');
      const mainArea = $('mainDashboardArea');

      if (!editLayoutBtn || !saveEditBtn || !cancelEditBtn || !restoreDefaultBtn || !editActionBar || !mainArea) {
        return;
      }

      getDashboardCards().forEach((card) => this.prepareEditableCard(card));
      getDashboardSections().forEach((section) => this.prepareDropSection(section));

      editLayoutBtn.addEventListener('click', () => this.toggleEditMode(true));
      cancelEditBtn.addEventListener('click', () => {
        this.restorePreEditSnapshot();
        this.toggleEditMode(false);
      });
      restoreDefaultBtn.addEventListener('click', () => this.restoreDefaultLayout());
      saveEditBtn.addEventListener('click', () => this.saveLayout(saveEditBtn));
    },

    prepareEditableCard(card) {
      if (!card || card.dataset.dashboardEditableBound === '1') return;
      card.dataset.dashboardEditableBound = '1';
      card.classList.add('editable-widget');

      const controls = document.createElement('div');
      controls.className = 'widget-controls';

      if (card.id === 'replaceableCard') {
        const replaceBtn = document.createElement('button');
        replaceBtn.type = 'button';
        replaceBtn.className = 'ctrl-btn danger';
        replaceBtn.innerHTML = '<i class="ph ph-arrows-left-right"></i>';
        replaceBtn.title = '切换卡片功能';
        replaceBtn.setAttribute('aria-label', '切换卡片功能');
        replaceBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          setCardViewState(card, card.dataset.viewState !== 'swapped');
        });
        controls.appendChild(replaceBtn);
      }

      card.appendChild(controls);
      this.addResizeHandle(card, 'corner', 'resize-handle resize-handle-corner');
      this.addResizeHandle(card, 'right', 'resize-handle resize-handle-right');
      this.addResizeHandle(card, 'bottom', 'resize-handle resize-handle-bottom');

      card.addEventListener('dragstart', (event) => this.onDragStart(event, card));
      card.addEventListener('dragend', () => this.onDragEnd(card));
    },

    addResizeHandle(card, mode, className) {
      const handle = document.createElement('div');
      handle.className = className;
      handle.addEventListener('mousedown', (event) => this.startResize(event, card, mode));
      card.appendChild(handle);
    },

    startResize(event, card, mode) {
      if (!this._editMode) return;
      event.preventDefault();
      event.stopPropagation();

      card.setAttribute('draggable', 'false');
      card.classList.add('resizing');
      const activeHandle = event.currentTarget;
      activeHandle.classList.add('active');

      const startX = event.clientX;
      const startY = event.clientY;
      const startDataW = parseInt(card.getAttribute('data-w') || 1, 10);
      const startDataH = parseInt(card.getAttribute('data-h') || 1, 10);
      const parentSection = card.closest('.dashboard-section');
      if (!parentSection) return;

      const sectionStyle = getComputedStyle(parentSection);
      const gap = parseFloat(sectionStyle.columnGap || sectionStyle.gap || '16') || 16;
      const rowGap = parseFloat(sectionStyle.rowGap || sectionStyle.gap || '16') || 16;
      const rowHeight = parseFloat(sectionStyle.gridAutoRows || '40') || 40;
      const colWidth = (parentSection.clientWidth - gap * 11) / 12;
      const colStep = colWidth + gap;
      const rowStep = rowHeight + rowGap;
      let lastW = startDataW;
      let lastH = startDataH;

      const onMove = (moveEvent) => {
        const addW = mode === 'bottom' ? 0 : Math.round((moveEvent.clientX - startX) / colStep);
        const addH = mode === 'right' ? 0 : Math.round((moveEvent.clientY - startY) / rowStep);
        const newW = Math.max(2, Math.min(12, startDataW + addW));
        const newH = Math.max(2, startDataH + addH);
        if (newW === lastW && newH === lastH) return;

        lastW = newW;
        lastH = newH;
        card.style.gridColumn = `span ${newW}`;
        card.style.gridRow = `span ${newH}`;
        card.setAttribute('data-w', newW);
        card.setAttribute('data-h', newH);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);

        if (this._editMode) card.setAttribute('draggable', 'true');
        card.classList.remove('resizing');
        activeHandle.classList.remove('active');
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    onDragStart(event, card) {
      if (!this._editMode) {
        event.preventDefault();
        return;
      }

      this._draggedCard = card;
      event.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('dragging'), 0);

      const parentSection = card.closest('.dashboard-section');
      Array.from(parentSection?.children || []).forEach((candidate) => {
        if (candidate.classList.contains('glass-card')) {
          this._gridRects.set(candidate, candidate.getBoundingClientRect());
        }
      });
    },

    onDragEnd(card) {
      card.classList.remove('dragging');
      this._draggedCard = null;
      this._gridRects.clear();
    },

    prepareDropSection(section) {
      if (!section || section.dataset.dashboardDropBound === '1') return;
      section.dataset.dashboardDropBound = '1';
      section.addEventListener('dragover', (event) => this.onSectionDragOver(event, section));
    },

    onSectionDragOver(event, section) {
      event.preventDefault();
      const draggedCard = this._draggedCard;
      if (!draggedCard || draggedCard.closest('.dashboard-section') !== section) return;

      const targetCard = event.target.closest('.glass-card');
      if (!targetCard || targetCard === draggedCard || targetCard.closest('.dashboard-section') !== section) return;

      const cards = Array.from(section.children).filter((card) => card.classList.contains('glass-card'));
      const draggedIdx = cards.indexOf(draggedCard);
      const targetIdx = cards.indexOf(targetCard);
      if (draggedIdx < targetIdx) {
        targetCard.after(draggedCard);
      } else {
        targetCard.before(draggedCard);
      }

      const newCards = Array.from(section.children).filter((card) => card.classList.contains('glass-card'));
      newCards.forEach((card) => {
        const oldRect = this._gridRects.get(card);
        const newRect = card.getBoundingClientRect();
        if (!oldRect) return;

        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        if (dx !== 0 || dy !== 0) {
          card.style.transition = 'none';
          card.style.transform = `translate(${dx}px, ${dy}px)`;
          card.offsetHeight;
          card.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
          card.style.transform = '';
          setTimeout(() => { card.style.transition = ''; }, 450);
        }
        this._gridRects.set(card, newRect);
      });
    },

    toggleEditMode(enable) {
      this._editMode = enable;
      $('editActionBar')?.classList.toggle('show', enable);
      document.body.classList.toggle('edit-mode', enable);

      if (enable) {
        this._preEditSnapshot = this.createLayoutSnapshot();
      }

      getDashboardCards().forEach((card) => {
        card.setAttribute('draggable', enable ? 'true' : 'false');
      });
    },

    createLayoutSnapshot() {
      const snapshot = [];
      getDashboardSections().forEach((section) => {
        const sectionName = section.getAttribute('data-section');
        Array.from(section.children).forEach((card, order) => {
          if (!card.classList.contains('glass-card') || !card.id) return;
          snapshot.push({
            id: card.id,
            w: card.getAttribute('data-w'),
            h: card.getAttribute('data-h'),
            section: sectionName,
            order,
            swapped: card.dataset.viewState === 'swapped',
          });
        });
      });
      return snapshot;
    },

    restorePreEditSnapshot() {
      const grouped = {};
      this._preEditSnapshot.forEach((snap) => {
        grouped[snap.section] = grouped[snap.section] || [];
        grouped[snap.section].push(snap);
      });

      Object.entries(grouped).forEach(([sectionName, items]) => {
        const section = document.querySelector(`.dashboard-section[data-section="${sectionName}"]`);
        if (!section) return;
        items
          .sort((a, b) => a.order - b.order)
          .forEach((snap) => {
            const card = $(snap.id);
            if (!card) return;
            card.setAttribute('data-w', snap.w);
            card.setAttribute('data-h', snap.h);
            card.style.gridColumn = `span ${snap.w}`;
            card.style.gridRow = `span ${snap.h}`;
            setCardViewState(card, !!snap.swapped);
            section.appendChild(card);
          });
      });
    },

    restoreDefaultLayout() {
      if (!confirm('确定要放弃所有的布局修改并恢复出厂默认布局吗？')) return;
      localStorage.removeItem(STORAGE_KEY);
      persistLayoutToConfig(null);
      window.location.reload();
    },

    saveLayout(saveButton) {
      const layout = this.createLayoutSnapshot().map(({ id, w, h, section, swapped }) => ({
        id,
        w,
        h,
        section,
        swapped,
      }));
      const originalHtml = saveButton.innerHTML;
      window._nekoUIHelpers?.setButtonBusy?.(saveButton, true, { label: '保存中…' });

      setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
        persistLayoutToConfig(layout);
        window._nekoUIHelpers?.setButtonBusy?.(saveButton, false);
        saveButton.innerHTML = '<i class="ph ph-check"></i> 保存成功';
        setTimeout(() => {
          this.toggleEditMode(false);
          saveButton.innerHTML = originalHtml;
        }, 500);
      }, 600);
    },

    loadLayoutConfig(layoutData) {
      const layout = Array.isArray(layoutData) ? layoutData : readLayoutFromStorage();
      if (!layout) return;

      try {
        layout.forEach((item) => {
          const card = $(item.id);
          const targetSection = document.querySelector(`.dashboard-section[data-section="${item.section}"]`);
          if (!card || !targetSection) return;
          card.setAttribute('data-w', item.w);
          card.setAttribute('data-h', item.h);
          card.style.gridColumn = `span ${item.w}`;
          card.style.gridRow = `span ${item.h}`;
          setCardViewState(card, !!item.swapped);
          targetSection.appendChild(card);
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
      } catch (error) {
        console.error('[DashboardPage] failed to apply layout', error);
      }
    },

    initRuntime(deps = {}) {
      this._runtimeDeps = { ...this._runtimeDeps, ...deps };
      this.init();
      this.initTrendRuntime();
      this._runtimeDeps.onUploadHealthChange?.({ ...this._healthStats });
    },

    initTrendRuntime() {
      if (!this._trendRuntimeBound) {
        this.bindTrendRuntime();
        this._trendRuntimeBound = true;
      }
      this.ensureTrendChart();
      this.updateTrendChart('none');
    },

    bindTrendRuntime() {
      document.querySelectorAll('.nav-item[data-target="mainDashboardArea"]').forEach((navItem) => {
        if (navItem.dataset.dashboardTrendNavBound === '1') return;
        navItem.dataset.dashboardTrendNavBound = '1';
        navItem.addEventListener('click', () => {
          setTimeout(() => {
            this.ensureTrendChart();
            this._lastChartUpdateTs = Date.now();
            this.updateTrendChart('none');
          }, 60);
        });
      });

      const rangeGroup = $('trendRangeGroup');
      if (!rangeGroup || rangeGroup.dataset.dashboardTrendRangeBound === '1') return;
      rangeGroup.dataset.dashboardTrendRangeBound = '1';
      rangeGroup.addEventListener('click', (event) => {
        const btn = event.target.closest('.toggle-btn');
        if (!btn) return;
        const range = btn.dataset.range;
        if (!range || range === this._trendRange) return;
        this._trendRange = range;
        this._lastChartUpdateTs = 0;
        document.querySelectorAll('#trendRangeGroup .toggle-btn').forEach((item) => {
          item.classList.toggle('active', item.dataset.range === range);
        });
        this.updateTrendChart('none', { forceProject: true });
      });
    },

    ensureTrendChart() {
      const canvas = $('trendChart');
      if (!canvas) return null;
      if (typeof Chart === 'undefined') {
        setTrendChartStatus('图表组件加载失败，请检查本地 Chart.js 资源。');
        return null;
      }
      if (this._trendChart) return this._trendChart;
      setTrendChartStatus('');

      this._trendChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'CPU',
              data: [],
              borderColor: '#0ea5e9',
              backgroundColor: 'transparent',
              fill: false,
              tension: 0.46,
              cubicInterpolationMode: 'monotone',
              spanGaps: true,
              pointRadius: 0,
              pointHoverRadius: 0,
              pointHitRadius: 10,
              borderWidth: 2,
            },
            {
              label: 'Memory',
              data: [],
              borderColor: 'rgba(160, 166, 176, 0.82)',
              backgroundColor: 'transparent',
              fill: false,
              tension: 0.46,
              cubicInterpolationMode: 'monotone',
              spanGaps: true,
              pointRadius: 0,
              pointHoverRadius: 0,
              pointHitRadius: 10,
              borderWidth: 2,
              borderDash: [6, 4],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          resizeDelay: 0,
          animation: { duration: 0 },
          transitions: {
            resize: { animation: { duration: 0 } },
            rollover: {
              animations: {
                x: { duration: 160, easing: 'easeOutCubic' },
                y: { duration: 0 },
              },
            },
          },
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: {
              grid: { display: false },
              ticks: { maxTicksLimit: 6, maxRotation: 0 },
            },
            y: {
              min: 0,
              max: 100,
              grid: { display: false },
              ticks: {
                callback: (v) => ({ 75: 'HIGH', 50: 'MID', 25: 'LOW' }[v] ?? null),
              },
            },
          },
          plugins: {
            legend: {
              position: 'top',
              align: 'start',
              labels: {
                usePointStyle: true,
                pointStyle: 'line',
                boxWidth: 28,
                boxHeight: 2,
                padding: 20,
                font: { size: 12, weight: '500' },
              },
            },
            tooltip: {
              borderWidth: 1,
              padding: 11,
              cornerRadius: 10,
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)}%`,
              },
            },
          },
        },
        plugins: [trendHoverLinePlugin],
      });
      this.applyTrendChartAppearance(false);
      return this._trendChart;
    },

    applyTrendChartAppearance(update = true) {
      const chart = this._trendChart;
      if (!chart) return;
      const bodyStyles = getComputedStyle(document.body);
      const rootStyles = getComputedStyle(document.documentElement);
      const themeColor = bodyStyles.getPropertyValue('--theme-color').trim()
        || rootStyles.getPropertyValue('--theme-color').trim()
        || '#0ea5e9';
      this._themeColorRgb = parseColorRgb(themeColor);
      const { r, g, b } = this._themeColorRgb;
      const light = isLightTheme();
      const quiet = isQuietProfile();
      const tickColor = light ? 'rgba(48, 54, 62, 0.62)' : 'rgba(190, 196, 205, 0.68)';
      const legendColor = light ? 'rgba(27, 29, 33, 0.76)' : 'rgba(225, 228, 234, 0.82)';
      const neutralLine = light ? 'rgba(81, 88, 98, 0.78)' : 'rgba(184, 190, 199, 0.76)';
      const tooltipBg = light ? 'rgba(255, 255, 255, 0.98)' : 'rgba(24, 27, 32, 0.98)';
      const tooltipTitle = light ? 'rgba(27, 29, 33, 0.58)' : 'rgba(210, 214, 222, 0.62)';
      const tooltipBody = light ? 'rgba(27, 29, 33, 0.92)' : 'rgba(242, 243, 245, 0.94)';
      const tooltipBorder = light ? 'rgba(27, 29, 33, 0.13)' : 'rgba(242, 243, 245, 0.12)';

      Chart.defaults.color = legendColor;
      chart.options.scales.x.grid.display = false;
      chart.options.scales.y.grid.display = false;
      chart.options.scales.x.ticks.color = tickColor;
      chart.options.scales.y.ticks.color = tickColor;
      chart.options.plugins.legend.labels.color = legendColor;
      Object.assign(chart.options.plugins.tooltip, {
        backgroundColor: tooltipBg,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        borderColor: tooltipBorder,
        cornerRadius: quiet ? 6 : 10,
      });

      const [cpu, memory] = chart.data.datasets;
      cpu.borderColor = `rgb(${r},${g},${b})`;
      cpu.borderWidth = quiet ? 2 : 3;
      cpu.borderDash = [];
      memory.borderWidth = quiet ? 2 : 3;
      memory.borderDash = quiet ? [6, 4] : [];
      if (quiet) {
        cpu.fill = false;
        cpu.backgroundColor = 'transparent';
        memory.borderColor = neutralLine;
        memory.fill = false;
        memory.backgroundColor = 'transparent';
      } else {
        cpu.fill = true;
        memory.fill = true;
        memory.borderColor = `rgba(${r},${g},${b},0.45)`;
        const area = chart.chartArea;
        const makeGradient = (alpha) => {
          if (!area || area.bottom <= area.top || !chart.ctx?.createLinearGradient) {
            return `rgba(${r},${g},${b},${alpha})`;
          }
          const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
          gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
          gradient.addColorStop(0.65, `rgba(${r},${g},${b},${+(alpha * 0.12).toFixed(3)})`);
          gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
          return gradient;
        };
        cpu.backgroundColor = makeGradient(0.30);
        memory.backgroundColor = makeGradient(0.12);
      }
      if (update) chart.update('none');
    },

    syncTrendProjectionToChart(updateMode = 'none') {
      const chart = this.ensureTrendChart();
      if (!chart || !this._trendProjection) return;
      const { labels, cpuData, memData } = projectionValues(this._trendProjection);
      chart.data.labels = labels;
      chart.data.datasets[0].data = cpuData;
      chart.data.datasets[1].data = memData;
      chart.update(updateMode);
    },

    updateTrendChart(updateMode = 'none', { forceProject = false, now = Date.now() } = {}) {
      const chart = this.ensureTrendChart();
      if (!chart) return;
      if (forceProject || !this._trendProjection || this._trendProjection.rangeId !== this._trendRange) {
        this._trendProjection = makeTrendChartData(this._metricsBuffer, this._trendRange, now).projection;
      }
      this.applyTrendChartAppearance(false);
      this.syncTrendProjectionToChart(updateMode);
    },

    rebuildTrendChartDeferred() {
      if (!this._trendChart) return;
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = setTimeout(() => {
        this.applyTrendChartAppearance(true);
      }, 0);
    },

    addMetricToTrendProjection(metric) {
      if (!this._trendProjection || this._trendProjection.rangeId !== this._trendRange) {
        this._trendProjection = makeTrendChartData(this._metricsBuffer, this._trendRange, metric.timestamp).projection;
        return { rolled: false, rebuilt: true };
      }
      const projection = this._trendProjection;
      const targetBucket = alignTrendBucket(metric.timestamp, projection.bucketMs);
      const lastBucket = projection.bucketStarts[projection.bucketStarts.length - 1];
      let rolled = false;
      if (targetBucket > lastBucket) {
        const steps = Math.floor((targetBucket - lastBucket) / projection.bucketMs);
        if (steps >= projection.bucketStarts.length) {
          this._trendProjection = makeTrendChartData(this._metricsBuffer, this._trendRange, metric.timestamp).projection;
          return { rolled: true, rebuilt: true };
        }
        for (let index = 0; index < steps; index += 1) {
          projection.bucketStarts.shift();
          projection.counts.shift();
          projection.cpuSums.shift();
          projection.memSums.shift();
          const nextStart = projection.bucketStarts[projection.bucketStarts.length - 1] + projection.bucketMs;
          projection.bucketStarts.push(nextStart);
          projection.counts.push(0);
          projection.cpuSums.push(0);
          projection.memSums.push(0);
        }
        rolled = true;
      }
      addMetricToProjection(projection, metric);
      return { rolled, rebuilt: false };
    },

    recordMetrics(metrics) {
      if (!metrics) return;
      const normalized = {
        ...metrics,
        timestamp: Number(metrics.timestamp) || Date.now(),
        cpuPct: Number(metrics.cpuPct) || 0,
        memPct: Number(metrics.memPct) || 0,
      };
      this._metricsBuffer.push(normalized);
      if (this._metricsBuffer.length > 8640) this._metricsBuffer.shift();

      const projectionUpdate = this.addMetricToTrendProjection(normalized);

      const dashArea = $('mainDashboardArea');
      if (!dashArea || dashArea.style.display === 'none') return;
      const updateMode = projectionUpdate.rolled && !prefersReducedMotion() ? 'rollover' : 'none';
      this.syncTrendProjectionToChart(updateMode);
    },

    setMetricsHistory(history) {
      const now = Date.now();
      this._metricsBuffer = Array.isArray(history)
        ? history.slice(-8640).map((item, index, list) => ({
            ...item,
            timestamp: Number(item?.timestamp) || now - (list.length - index) * 5000,
            cpuPct: Number(item?.cpuPct) || 0,
            memPct: Number(item?.memPct) || 0,
          }))
        : [];
      this.ensureTrendChart();
      this.updateTrendChart('none', { forceProject: true, now });
    },

    getHealthStats() {
      return { ...this._healthStats };
    },

    applyServiceState(isRunning, serviceState = (isRunning ? 'running' : 'stopped')) {
      this._serviceRunning = !!isRunning;

      const labels = { running: '运行中', waiting_network: '等待网络', rate_limited: '限流等待', credential_invalid: '凭据失效', stopped: '已停止' };

      const cardStatusValue = document.querySelector('#card-status .metric-value');
      if (cardStatusValue) {
        cardStatusValue.textContent = labels[serviceState] || labels.stopped;
      }

      const trendSpan = document.querySelector('#card-status .metric-trend span');
      if (trendSpan) {
        trendSpan.innerHTML = serviceState === 'running'
          ? '<i class="ph ph-check-circle"></i> 服务运行平稳'
          : `<i class="ph ph-warning-circle"></i> ${labels[serviceState] || labels.stopped}`;
        trendSpan.classList.toggle('text-error', serviceState === 'credential_invalid' || serviceState === 'stopped');
      }

      const toggleBtn = $('reportToggleBtn');
      if (toggleBtn) {
        toggleBtn.className = `status-toggle-btn ${isRunning ? 'btn-stop' : 'btn-start'}`;
        toggleBtn.innerHTML = isRunning
          ? '<i class="ph ph-stop-circle"></i> 停止上报'
          : '<i class="ph ph-play-circle"></i> 开始上报';
      }

      const liveBadge = $('activityLiveBadge');
      if (liveBadge) {
        if (isRunning) {
          liveBadge.className = 'status-badge success';
          liveBadge.innerHTML = '<i class="ph ph-pulse"></i> 实时';
        } else {
          liveBadge.className = 'status-badge';
          liveBadge.innerHTML = '<i class="ph ph-pause"></i> 已暂停';
        }
      }
    },

    updateCards(data, options = {}) {
      if (!data) return;
      const deps = this._runtimeDeps;
      const recordHealth = options.recordHealth !== false;

      const reportedApp = normalizeLastReportedApp(data);
      if (reportedApp.appName !== undefined || reportedApp.packageName !== undefined) {
        const appValue = document.querySelector('#card-app .metric-value');
        if (appValue) {
          const appName = reportedApp.appName || reportedApp.packageName || '-';
          appValue.textContent = appName;
          appValue.title = appName;
        }

        const appProcess = document.querySelector('#card-app .metric-trend');
        if (appProcess && reportedApp.packageName !== undefined) {
          appProcess.innerHTML = `<i class="ph ph-cpu"></i> 进程: ${escapeWith(deps, reportedApp.packageName || '-')}`;
        }
      }

      if (data.batteryLevel !== undefined) {
        const battValue = $('batteryValue');
        const isDesktopPower = data.hasBattery === false || data.deviceType === 'desktop';
        if (battValue) battValue.textContent = isDesktopPower ? 'AC' : `${data.batteryLevel}%`;

        const battIcon = $('batteryIcon');
        const battTrend = $('batteryTrend');
        if (battTrend) {
          if (isDesktopPower) {
            battTrend.innerHTML = '<i class="ph ph-desktop-tower"></i> 桌面供电 · 未检测到电池';
            if (battIcon) battIcon.className = 'ph ph-plug metric-icon theme';
          } else {
            battTrend.innerHTML = data.isCharging
              ? '<i class="ph ph-plug-charging"></i> 笔记本 · 交流电已连接'
              : '<i class="ph ph-battery-medium"></i> 笔记本 · 使用电池供电';
            if (battIcon) battIcon.className = data.isCharging
              ? 'ph ph-battery-charging metric-icon theme'
              : 'ph ph-battery-medium metric-icon theme';
          }
        }
      }

      const hasReportResult = data.success !== undefined || data.reason !== undefined;
      if (recordHealth && hasReportResult && data.reason !== 'no_key') {
        this._healthStats.total++;
        if (data.success) this._healthStats.success++;
        deps.onUploadHealthChange?.({ ...this._healthStats });
      }

      const healthPct = this._healthStats.total > 0
        ? (this._healthStats.success / this._healthStats.total * 100).toFixed(1)
        : '-';
      const healthValueEl = $('healthValue');
      if (healthValueEl) healthValueEl.textContent = `${healthPct}%`;

      const healthTrendEl = $('healthTrend');
      if (healthTrendEl) {
        if (!this._serviceRunning) {
          healthTrendEl.innerHTML = '<i class="ph ph-power"></i> 上报服务未运行';
        } else {
          const pct = parseFloat(healthPct);
          if (Number.isNaN(pct)) {
            healthTrendEl.innerHTML = '数据不足';
          } else if (pct >= 99) {
            healthTrendEl.innerHTML = '<i class="ph ph-check-circle"></i> 连接优秀';
          } else if (pct >= 90) {
            healthTrendEl.innerHTML = '<i class="ph ph-warning-circle"></i> 轻微丢失';
          } else {
            healthTrendEl.innerHTML = '<i class="ph ph-x-circle"></i> 上报异常，请检查网络';
          }
        }
      }

      if (data.success) {
        const displayApp = data.appName || data.packageName || '';
        const eventTs = resolveEventTimestamp(data.timestamp || Date.now());
        if (displayApp) {
          this.appendActivityItem('app', displayApp, data.packageName || '', formatTimeOnly(eventTs));
        }
        this.appendActivityItem('upload', '状态上报', data.packageName || '系统', formatTimeOnly(eventTs));
      }

      if (data.hasScreenshot && data.screenshotBase64) {
        const screenshotMime = data.screenshotMimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        const screenshotExt = data.screenshotExtension || (screenshotMime === 'image/jpeg' ? 'jpg' : 'png');
        const screenshotFormat = screenshotExt.toUpperCase();
        const url = `data:${screenshotMime};base64,${data.screenshotBase64}`;
        const isBlurred = !!data.screenshotBlurred;
        const sizeKB = ((data.screenshotSize || 0) / 1024).toFixed(0);
        const captureTs = resolveEventTimestamp(data.timestamp || Date.now());
        const captureTime = formatDateTime(captureTs);
        if (isBlurred) window._nekoActivityHelpers?.incrementBlurCount?.();

        const frame = document.querySelector('.screenshot-frame');
        if (frame) {
          frame.style.backgroundImage = `url(${url})`;
          frame.style.backgroundSize = 'cover';
          frame.style.backgroundPosition = 'center';
          frame.style.filter = isBlurred ? 'blur(20px)' : 'none';
          const placeholder = frame.querySelector('.screenshot-placeholder');
          if (placeholder) placeholder.style.display = 'none';
          const overlay = frame.querySelector('.screenshot-frame-overlay');
          if (overlay) overlay.style.display = 'flex';
        }

        const dashImg = $('dashScreenshotImg');
        const dashEmpty = $('dashScreenshotEmpty');
        if (dashImg) {
          dashImg.src = url;
          dashImg.style.display = '';
          dashImg.style.filter = isBlurred ? 'blur(20px)' : 'none';
        }
        if (dashEmpty) dashEmpty.style.display = 'none';
        const dashName = $('dashScreenshotName');
        const dashSize = $('dashScreenshotSize');
        if (dashName) dashName.innerHTML = `<i class="ph ph-hard-drive"></i> screenshot_${Date.now()}.${screenshotExt}`;
        if (dashSize) dashSize.innerHTML = `<i class="ph ph-arrows-out"></i> ${sizeKB} KB`;
        setScreenshotPreviewTime(captureTime);

        this.appendActivityItem('capture', isBlurred ? '自动截图（已模糊）' : '自动截图', `${sizeKB} KB · ${screenshotFormat}`, formatTimeOnly(captureTs));
      }
    },

    appendActivityItem(type, main, sub, time) {
      const list = $('activityList');
      if (!list) return;
      window._nekoActivityHelpers?.hideEmpty?.();

      const iconMap = { app: 'ph-app-window', capture: 'ph-camera', upload: 'ph-cloud-arrow-up' };
      const icon = iconMap[type] || 'ph-circle';
      const item = document.createElement('div');
      item.className = 'activity-item';
      item.dataset.type = type;
      item.innerHTML = `
        <div class="activity-icon ${type}"><i class="ph ${icon}"></i></div>
        <div class="activity-content">
          <div class="activity-main">${escapeWith(this._runtimeDeps, main)}</div>
          <div class="activity-sub">${escapeWith(this._runtimeDeps, sub)}</div>
        </div>
        <div class="activity-time">${time}</div>`;

      list.insertBefore(item, list.firstChild);
      while (list.children.length > 20) list.removeChild(list.lastChild);
    },

    formatDateTime,
    formatTimeOnly,

    render() {},
  };

  window._nekoModules.pages.DashboardPage = DashboardPage;
  window.loadLayoutConfig = (layoutData) => DashboardPage.loadLayoutConfig(layoutData);
})();

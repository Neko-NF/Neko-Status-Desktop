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
    viewDefault.style.display = swapped ? 'none' : 'flex';
    viewSwapped.style.display = swapped ? 'flex' : 'none';
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

  const DashboardPage = {
    _inited: false,
    _editMode: false,
    _draggedCard: null,
    _gridRects: new Map(),
    _preEditSnapshot: [],

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
          reportToggleBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 停止中...';

          setTimeout(() => {
            isReporting = false;
            reportToggleBtn.className = 'status-toggle-btn btn-start';
            reportToggleBtn.innerHTML = '<i class="ph ph-play-circle"></i> 开始上报';
            deviceStatusDot?.classList.add('error');
          }, 800);
          return;
        }

        reportToggleBtn.className = 'status-toggle-btn btn-pending';
        reportToggleBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 连接中...';

        setTimeout(() => {
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
        const replaceBtn = document.createElement('div');
        replaceBtn.className = 'ctrl-btn danger';
        replaceBtn.innerHTML = '<i class="ph ph-arrows-left-right"></i>';
        replaceBtn.title = '切换卡片功能';
        replaceBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          card.style.opacity = '0';
          card.style.transform = 'scale(0.95)';

          setTimeout(() => {
            setCardViewState(card, card.dataset.viewState !== 'swapped');
            card.style.opacity = '1';
            card.style.transform = 'scale(1)';
          }, 300);
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
      saveButton.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';

      setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
        persistLayoutToConfig(layout);
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

    render() {},
  };

  window._nekoModules.pages.DashboardPage = DashboardPage;
  window.loadLayoutConfig = (layoutData) => DashboardPage.loadLayoutConfig(layoutData);
})();

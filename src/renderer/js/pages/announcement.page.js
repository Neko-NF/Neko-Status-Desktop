(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const VALID_STATUSES = ['published', 'draft', 'archived'];
  const VALID_TYPES = ['info', 'warning', 'urgent'];
  const VALID_CATEGORIES = ['system', 'it', 'hr', 'security', 'event', 'finance'];
  const VALID_AUDIENCES = ['users', 'admins', 'all'];
  const AUDIENCE_META = {
    users: { label: '普通用户', total: 120 },
    admins: { label: '仅管理员', total: 8 },
    all: { label: '全员', total: 150 },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatRelativeTime(iso) {
    if (!iso) return '未记录';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '未记录';
    const diff = Date.now() - d.getTime();
    const minute = 60000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return '刚刚';
    if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}分钟前`;
    if (diff < day) return `${Math.floor(diff / hour)}小时前`;
    if (diff < day * 2) return `昨天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${Math.floor(diff / day)}天前`;
  }

  function relativeTimeRevision(iso) {
    const time = new Date(iso || '').getTime();
    return Number.isFinite(time) ? Math.floor((Date.now() - time) / 60000) : 0;
  }

  function toDateInputValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toIsoFromInput(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const d = new Date(text.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function dateKeyFromDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function dateFromKey(dateKey) {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(days) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return date;
  }

  function parseExpiryValue(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
    return match ? { dateKey: match[1], time: match[2] } : { dateKey: '', time: '' };
  }

  function normalizeAudience(value) {
    const text = String(value || '').trim().toLowerCase();
    if (VALID_AUDIENCES.includes(text)) return text;
    if (['admin', '管理员', '仅管理员'].includes(text)) return 'admins';
    if (['user', 'users', '普通用户'].includes(text)) return 'users';
    if (['全员', '全体员工', 'all', 'everyone'].includes(text)) return 'all';
    return 'all';
  }

  function audienceLabel(value) {
    const normalized = normalizeAudience(value);
    return AUDIENCE_META[normalized]?.label || AUDIENCE_META.all.label;
  }

  function isAdminUser(user) {
    if (!user) return false;
    const role = String(user.role || user.userRole || '').toLowerCase();
    return role === 'admin' || role === 'administrator' || user.isAdmin === true;
  }

  function normalizeId(id) {
    return String(id ?? '');
  }

  function getAuthorName(author) {
    if (!author) return '系统管理员';
    if (typeof author === 'string') return author;
    return author.username || author.name || author.nickname || author.displayName || '系统管理员';
  }

  function typeMeta(type) {
    const map = {
      info: { label: '普通信息', icon: 'ph-info', className: 'info' },
      warning: { label: '重要通知', icon: 'ph-warning-circle', className: 'warn' },
      urgent: { label: '紧急通知', icon: 'ph-warning', className: 'error' },
    };
    return map[type] || map.info;
  }

  function categoryMeta(category) {
    const map = {
      system: { label: '系统公告', icon: 'ph-sliders-horizontal', className: 'info' },
      it: { label: 'IT保障部', icon: 'ph-sliders-horizontal', className: 'info' },
      hr: { label: '行政部', icon: 'ph-user', className: 'warn' },
      security: { label: '安全中心', icon: 'ph-shield-check', className: 'error' },
      finance: { label: '财务系统组', icon: 'ph-receipt', className: 'info' },
      event: { label: '企业文化小组', icon: 'ph-sparkle', className: 'info' },
    };
    return map[category] || map.system;
  }

  function statusMeta(item) {
    if (item.expired) return { label: '已过期', className: '', icon: 'ph-clock-countdown' };
    const map = {
      published: { label: '已发布', className: 'is-active', icon: 'ph-check-circle' },
      draft: { label: '草稿', className: '', icon: 'tb-file-pencil' },
      archived: { label: '已归档', className: '', icon: 'ph-archive' },
    };
    return map[item.status] || map.published;
  }

  function priorityLabel(priority) {
    if (priority >= 9) return '高优先级';
    if (priority >= 5) return '重点通知';
    return '轻量通知';
  }

  function normalizeAnnouncement(item) {
    const type = VALID_TYPES.includes(item?.type) ? item.type : 'info';
    const category = VALID_CATEGORIES.includes(item?.category) ? item.category : 'system';
    const targetAudience = normalizeAudience(item?.targetAudience || item?.audience);
    const status = VALID_STATUSES.includes(item?.status)
      ? item.status
      : item?.isActive === false ? 'archived' : 'published';
    const expiresAt = item?.expiresAt || null;
    const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
    const totalAudience = Math.max(0, Number(item?.totalAudience || item?.audienceCount || 0));
    const acknowledges = Math.max(0, Number(item?.acknowledges || item?.acknowledgedCount || item?.readCount || 0));
    const views = Math.max(0, Number(item?.views || item?.viewCount || 0));

    return {
      ...item,
      id: item?.id,
      _id: normalizeId(item?.id),
      title: String(item?.title || ''),
      content: String(item?.content || ''),
      type,
      category,
      status,
      pinned: item?.pinned === true,
      priority: Math.max(1, Math.min(10, Number(item?.priority) || 1)),
      author: getAuthorName(item?.author || item?.sender || item?.createdBy),
      targetAudience,
      targetAudienceLabel: audienceLabel(targetAudience),
      createdAt: item?.createdAt || item?.updatedAt || null,
      expiresAt,
      expired,
      isActive: status === 'published' && !expired && item?.isActive !== false,
      showPopup: item?.showPopup !== false,
      pushNotification: item?.pushNotification === true,
      views,
      acknowledges,
      totalAudience,
    };
  }

  function extractAnnouncementList(raw) {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.announcements)) return raw.announcements;
    if (Array.isArray(raw?.data?.announcements)) return raw.data.announcements;
    if (raw?.ok === false || raw?.success === false) {
      throw new Error(raw.message || raw.error || '公告服务返回失败');
    }
    if (raw && typeof raw === 'object') {
      throw new Error('公告服务返回格式异常，未找到公告列表');
    }
    return [];
  }

  function getAnnouncementClient() {
    return window._nekoModules?.services?.AnnouncementClient || null;
  }

  function getConfigClient() {
    return window._nekoModules?.services?.ConfigClient || null;
  }

  function getSystemClient() {
    return window._nekoModules?.services?.SystemClient || null;
  }

  const DEFAULT_MOCK = [
    {
      id: 1,
      title: '核心业务数据库（MySQL-Cluster-A）临时升级维护公告',
      content: '为提升系统并发读取性能，IT运维团队计划于今晚 23:00 - 01:00 对核心业务数据库实施热升级与缓存扩容。届时部分 OA 审批及报销系统可能会有短暂 3-5 秒连接波动，其他业务不受影响。',
      type: 'warning',
      category: 'it',
      targetAudience: '技术部、运营部',
      status: 'published',
      pinned: true,
      author: 'IT保障部 - 许立',
      showPopup: true,
      pushNotification: false,
      priority: 9,
      expiresAt: new Date(Date.now() + 86400000 * 2).toISOString(),
      views: 45,
      acknowledges: 38,
      totalAudience: 52,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 2,
      title: '关于 2026 年端午节放假及值班安排的通知',
      content: '根据国家法定假期规定，公司 2026 年端午节放假时间为 6 月 13 日至 6 月 15 日，共 3 天。请各部门负责人提前安排安全检查与业务交接，关键岗位请保持手机畅通。',
      type: 'warning',
      category: 'hr',
      targetAudience: '全体员工',
      status: 'published',
      pinned: true,
      author: '行政部',
      showPopup: true,
      pushNotification: false,
      priority: 8,
      views: 142,
      acknowledges: 98,
      totalAudience: 150,
      createdAt: new Date(Date.now() - 600000).toISOString(),
    },
    {
      id: 3,
      title: '新版【企业报销助手2.5】小程序上线试运行说明',
      content: '本次更新大幅简化了差旅审批与发票 OCR 识别流程。即日起，员工上传电子发票后，系统将自动核对税号并完成去重校验，报销流转周期缩短至 3 个工作日以内。',
      type: 'info',
      category: 'finance',
      targetAudience: '全体员工',
      status: 'published',
      author: '财务系统组',
      showPopup: false,
      pushNotification: true,
      priority: 3,
      views: 98,
      acknowledges: 82,
      totalAudience: 150,
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 4,
      title: 'Q2 优秀员工评选投票通道正式开启',
      content: '2026 年第二季度评选已启动。本次共有 12 位来自不同业务线的候选人入围，欢迎各位同事查阅候选人业绩，并在 6 月 10 日前投出宝贵的一票。',
      type: 'info',
      category: 'event',
      targetAudience: '全体员工',
      status: 'draft',
      author: '企业文化小组',
      priority: 4,
      views: 0,
      acknowledges: 0,
      totalAudience: 150,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ];

  const AnnouncementPage = {
    _inited: false,
    _deps: {},
    _items: [],
    _selectedId: '',
    _editingId: null,
    _searchTimer: null,
    _runtimeStarted: false,
    _announcementPollTimer: null,
    _pendingDeleteId: null,
    _managementLoading: false,
    _loadRevision: 0,
    _hasLoadedManagement: false,
    _detailLoader: null,
    _renderedDetailId: '',
    _renderedDetailSignature: '',
    _formReturnFocus: null,
    _state: {
      search: '',
      type: 'all',
      category: 'all',
      status: 'published',
    },

    init(deps = {}) {
      if (this._inited) return;
      this._inited = true;
      this._deps = deps;
      this.bindEvents();
      this.syncMockBadge();
    },

    bindEvents() {
      $('announcementCreateBtn')?.addEventListener('click', () => this.showCreateForm());
      $('announcementCancelBtn')?.addEventListener('click', () => this.hideForm());
      $('announcementSaveBtn')?.addEventListener('click', () => this.handleSave());
      $('announcementDeleteCancelBtn')?.addEventListener('click', () => this.closeDeleteDialog());
      $('announcementDeleteConfirmBtn')?.addEventListener('click', () => this.confirmDelete());
      $('announcementDeleteOverlay')?.addEventListener('click', (event) => {
        if (event.target === $('announcementDeleteOverlay')) this.closeDeleteDialog();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && $('announcementFormWrapper')?.classList.contains('show')) {
          this.hideForm();
        }
      });
      $('announcementRefreshBtn')?.addEventListener('click', () => this.loadAnnouncements({ manual: true }));
      $('announcementMockToggleBtn')?.addEventListener('click', () => this.toggleMockMode());
      $('announcementList')?.addEventListener('click', (event) => this.handleListClick(event));
      $('announcementSearchInput')?.addEventListener('input', (event) => {
        // Invalidate a request for the previous query immediately, not after debounce.
        // Its response may otherwise replace the item pool while the new filter is visible.
        this._loadRevision += 1;
        this._state.search = event.target.value || '';
        this.renderWorkspace();
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this.loadAnnouncements(), 280);
      });

      document.querySelectorAll('[data-announcement-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._state.status = btn.dataset.announcementFilter || 'published';
          this.loadAnnouncements();
        });
      });

      document.querySelectorAll('[data-announcement-type-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._state.type = btn.dataset.announcementTypeFilter || 'all';
          this.loadAnnouncements();
        });
      });

      document.querySelectorAll('[data-announcement-category-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._state.category = btn.dataset.announcementCategoryFilter || 'all';
          this.loadAnnouncements();
        });
      });

      const popupToggle = $('announcementShowPopupToggle');
      const pushToggle = $('announcementPushNotificationToggle');
      const pinnedToggle = $('announcementPinnedToggle');
      popupToggle?.addEventListener('click', () => this.toggleCheckbox('announcementShowPopup', popupToggle));
      pushToggle?.addEventListener('click', () => this.toggleCheckbox('announcementPushNotification', pushToggle));
      pinnedToggle?.addEventListener('click', () => this.toggleCheckbox('announcementPinned', pinnedToggle));
      [popupToggle, pushToggle, pinnedToggle].filter(Boolean).forEach((toggle) => {
        toggle.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle.click();
        });
      });

      $('announcementTypeSegment')?.querySelectorAll('.segment-btn').forEach((btn) => {
        btn.addEventListener('click', () => this.setAnnouncementType(btn.dataset.value || 'info'));
      });
      this.initSelectControls();

      $('announcementPriorityDown')?.addEventListener('click', () => this.adjustPriority(-1));
      $('announcementPriorityUp')?.addEventListener('click', () => this.adjustPriority(1));
      $('announcementExpiresAtClear')?.addEventListener('click', () => {
        const input = $('announcementExpiresAt');
        if (input) input.value = '';
        this.renderExpiryPicker();
      });

      document.querySelectorAll('[data-announcement-expiry]').forEach((btn) => {
        btn.addEventListener('click', () => this.setExpiryPreset(btn.dataset.announcementExpiry));
      });

      $('announcementExpiryDateGrid')?.addEventListener('click', (event) => {
        const btn = event.target?.closest?.('[data-announcement-expiry-date]');
        if (!btn) return;
        this.setExpiryDate(btn.dataset.announcementExpiryDate);
      });

      $('announcementExpiryTimeRow')?.addEventListener('click', (event) => {
        const btn = event.target?.closest?.('[data-announcement-expiry-time]');
        if (!btn) return;
        this.setExpiryTime(btn.dataset.announcementExpiryTime);
      });

      this.renderExpiryPicker();
    },

    initSelectControls() {
      const enhance = window._nekoUIHelpers?.enhanceSelect;
      if (typeof enhance !== 'function') return;
      enhance($('announcementAudience'), {
        defaultIcon: 'ph-users-three',
        icons: {
          all: 'ph-users-three',
          users: 'ph-user',
          admins: 'ph-shield-check',
        },
      });
      enhance($('announcementStatus'), {
        defaultIcon: 'ph-check-circle',
        icons: {
          published: 'ph-check-circle',
          draft: 'tb-file-pencil',
          archived: 'ph-archive',
        },
      });
    },

    setExpiryPreset(preset) {
      const input = $('announcementExpiresAt');
      if (!input) return;
      if (preset === 'never') {
        input.value = '';
        this.renderExpiryPicker();
        return;
      }
      const days = Number(preset);
      if (!Number.isFinite(days) || days <= 0) return;
      const current = parseExpiryValue(input.value);
      input.value = `${dateKeyFromDate(addDays(days))} ${current.time || '18:00'}`;
      this.renderExpiryPicker();
    },

    setExpiryDate(dateKey) {
      const input = $('announcementExpiresAt');
      const date = dateFromKey(dateKey);
      if (!input || !date) return;
      const current = parseExpiryValue(input.value);
      input.value = `${dateKey} ${current.time || '18:00'}`;
      this.renderExpiryPicker();
    },

    setExpiryTime(time) {
      const input = $('announcementExpiresAt');
      if (!input || !/^\d{2}:\d{2}$/.test(String(time || ''))) return;
      const current = parseExpiryValue(input.value);
      const dateKey = current.dateKey || dateKeyFromDate(addDays(1));
      input.value = `${dateKey} ${time}`;
      this.renderExpiryPicker();
    },

    renderExpiryPicker() {
      const input = $('announcementExpiresAt');
      const grid = $('announcementExpiryDateGrid');
      const timeRow = $('announcementExpiryTimeRow');
      const current = parseExpiryValue(input?.value);
      const activeDate = current.dateKey;
      const activeTime = current.time || '';
      const weekday = ['日', '一', '二', '三', '四', '五', '六'];

      if (grid) {
        grid.innerHTML = Array.from({ length: 14 }).map((_, index) => {
          const days = index + 1;
          const date = addDays(days);
          const dateKey = dateKeyFromDate(date);
          const label = days === 1 ? '明天' : `周${weekday[date.getDay()]}`;
          return `
            <button type="button" class="${activeDate === dateKey ? 'active' : ''}" data-announcement-expiry-date="${dateKey}">
              <span>${label}</span>
              <strong>${date.getMonth() + 1}/${date.getDate()}</strong>
            </button>
          `;
        }).join('');
      }

      document.querySelectorAll('[data-announcement-expiry]').forEach((btn) => {
        const preset = btn.dataset.announcementExpiry;
        const dateKey = preset === 'never' ? '' : dateKeyFromDate(addDays(Number(preset) || 0));
        btn.classList.toggle('active', preset === 'never' ? !activeDate : activeDate === dateKey);
      });

      timeRow?.querySelectorAll('[data-announcement-expiry-time]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.announcementExpiryTime === activeTime);
      });
    },

    toggleCheckbox(inputId, toggleEl) {
      const input = $(inputId);
      if (!input) return;
      input.checked = !input.checked;
      toggleEl.classList.toggle('on', input.checked);
      toggleEl.setAttribute?.('aria-checked', input.checked ? 'true' : 'false');
    },

    setAnnouncementType(type) {
      const value = VALID_TYPES.includes(type) ? type : 'info';
      const hidden = $('announcementType');
      if (hidden) hidden.value = value;
      $('announcementTypeSegment')?.querySelectorAll('.segment-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.value === value);
      });
    },

    adjustPriority(delta) {
      const input = $('announcementPriority');
      if (!input) return;
      input.value = String(Math.max(1, Math.min(10, (Number(input.value) || 1) + delta)));
    },

    isMockMode() {
      return localStorage.getItem('announcement_use_mock') === 'true';
    },

    syncMockBadge() {
      const isMock = this.isMockMode();
      const badge = $('announcementMockBadge');
      if (badge) badge.style.display = isMock ? 'inline-flex' : 'none';
      const btn = $('announcementMockToggleBtn');
      if (btn) {
        btn.innerHTML = isMock
          ? '<i class="ph ph-cloud-arrow-up"></i> 返回服务端'
          : '<i class="ph ph-sparkle"></i> 本地模拟';
      }
    },

    toggleMockMode() {
      if (this.isMockMode()) localStorage.removeItem('announcement_use_mock');
      else localStorage.setItem('announcement_use_mock', 'true');
      this.syncMockBadge();
      this.loadAnnouncements();
    },

    getMockAnnouncements() {
      const data = localStorage.getItem('_neko_mock_announcements');
      if (!data) {
        localStorage.setItem('_neko_mock_announcements', JSON.stringify(DEFAULT_MOCK));
        return DEFAULT_MOCK.slice();
      }
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : DEFAULT_MOCK.slice();
      } catch {
        return DEFAULT_MOCK.slice();
      }
    },

    saveMockAnnouncements(list) {
      localStorage.setItem('_neko_mock_announcements', JSON.stringify(list));
    },

    renderLoading() {
      const listEl = $('announcementList');
      const detailEl = $('announcementDetail');
      if (listEl) {
        listEl.innerHTML = Array.from({ length: 4 }).map(() => `
          <div class="announcement-card announcement-skeleton-card">
            <div class="announcement-skeleton-line wide"></div>
            <div class="announcement-skeleton-line"></div>
            <div class="announcement-skeleton-line short"></div>
          </div>
        `).join('');
      }
      if (detailEl) {
        this._renderedDetailId = '';
        this._renderedDetailSignature = '';
        this._detailLoader?.destroy?.();
        detailEl.textContent = '';
        this._detailLoader = window._nekoModules?.components?.LoadingSystem?.create?.(detailEl, {
          context: 'network',
          mode: 'section',
          size: 'md',
          label: '加载公告中…',
        }) || null;
        this._detailLoader?.show?.();
      }
    },

    setLoadingState(loading) {
      const board = document.querySelector('.announcement-board');
      board?.classList.toggle('is-loading', !!loading);
      board?.setAttribute?.('aria-busy', String(!!loading));
      $('announcementList')?.setAttribute?.('aria-busy', String(!!loading));
      const status = $('announcementLoadStatus');
      if (status) status.textContent = loading ? '正在刷新公告' : '';
      const btn = $('announcementRefreshBtn');
      if (!btn) return;
      window._nekoUIHelpers?.setButtonBusy?.(btn, !!loading, { label: '刷新中' });
    },

    async canManageAnnouncements() {
      try {
        const authUser = await getConfigClient()?.get?.('authUser');
        return isAdminUser(authUser);
      } catch {
        return false;
      }
    },

    renderAccessDenied() {
      this._items = [];
      this._selectedId = '';
      this._renderedDetailId = '';
      this._renderedDetailSignature = 'access-denied';
      const listEl = $('announcementList');
      const detailEl = $('announcementDetail');
      if (listEl) {
        listEl.innerHTML = `
          <div class="announcement-error">
            <i class="ph ph-lock-key"></i>
            <strong>需要管理员权限</strong>
            <small>当前账号无权管理公告。请登录管理员账号后再打开此页面。</small>
          </div>
        `;
      }
      if (detailEl) {
        detailEl.innerHTML = '<div class="announcement-detail-empty"><i class="ph ph-shield-warning"></i><span>公告创建、编辑和删除仅对管理员开放。</span></div>';
      }
      this.renderStats();
    },

    async loadAnnouncements(options = {}) {
      const manual = options.manual === true;
      const revision = ++this._loadRevision;
      const requestState = { ...this._state };
      const coldStart = !this._hasLoadedManagement;
      this._managementLoading = true;
      this.syncMockBadge();
      this.renderFilterState();
      if (coldStart) this.renderLoading();
      this.setLoadingState(true);
      try {
        const canManage = await this.canManageAnnouncements();
        if (revision !== this._loadRevision) return;
        if (!canManage) {
          this._hasLoadedManagement = true;
          this.renderAccessDenied();
          return;
        }

        let list;
        if (this.isMockMode()) {
          list = this.getMockAnnouncements();
        } else {
          const client = getAnnouncementClient();
          if (!client?.isReady?.()) throw new Error('公告服务未就绪');
          const forceAll = requestState.status !== 'published'
            || requestState.type !== 'all'
            || requestState.category !== 'all'
            || requestState.search.trim() !== '';
          const raw = await client.fetch({
            all: forceAll,
            status: requestState.status === 'all' ? undefined : requestState.status,
            category: requestState.category === 'all' ? undefined : requestState.category,
            search: requestState.search || undefined,
            limit: 100,
          });
          list = extractAnnouncementList(raw);
        }

        if (revision !== this._loadRevision) return;
        this._items = list.map(normalizeAnnouncement).sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          if (b.priority !== a.priority) return b.priority - a.priority;
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        });
        this._hasLoadedManagement = true;

        const visibleItems = this.getVisibleItems();
        if (!visibleItems.some((item) => item._id === this._selectedId)) {
          this._selectedId = visibleItems[0]?._id || '';
        }
        this.renderWorkspace();
        if (manual) {
          const visibleCount = this.getVisibleItems().length;
          if (this._items.length === 0) {
            this._deps?.showNotice?.('刷新完成，但未加载到公告', 'warn');
          } else if (visibleCount === 0) {
            this._deps?.showNotice?.('刷新完成，当前筛选无匹配公告', 'warn');
          } else {
            this._deps?.showNotice?.(`公告已刷新，共 ${visibleCount} 条`, 'success');
          }
        }
      } catch (err) {
        if (revision !== this._loadRevision) return;
        if (!this._hasLoadedManagement) {
          this._items = [];
          this._selectedId = '';
          this._hasLoadedManagement = true;
          this.renderError(err);
        }
        this._deps?.showNotice?.(`公告刷新失败：${err?.message || '未知错误'}`, 'error', 4200);
      } finally {
        if (revision === this._loadRevision) {
          this._managementLoading = false;
          this.setLoadingState(false);
        }
      }
    },

    getVisibleItems() {
      const query = this._state.search.trim().toLowerCase();
      return this._items.filter((item) => {
        if (this._state.status !== 'all' && item.status !== this._state.status) return false;
        if (this._state.type !== 'all' && item.type !== this._state.type) return false;
        if (this._state.category !== 'all' && item.category !== this._state.category) return false;
        if (!query) return true;
        return [item.title, item.content, item.author, item.targetAudience, item.targetAudienceLabel].some((value) => String(value).toLowerCase().includes(query));
      });
    },

    renderWorkspace() {
      this.renderStats();
      this.renderFilterState();
      const list = this.getVisibleItems();
      if (!list.some((item) => item._id === this._selectedId)) {
        this._selectedId = list[0]?._id || '';
      }
      this.renderList(list);
      this.renderDetail(this._items.find((item) => item._id === this._selectedId) || null);
    },

    renderStats() {
      const setText = (id, value) => {
        const el = $(id);
        if (el) el.textContent = String(value);
      };
      setText('announcementStatActive', this._items.filter((item) => item.status === 'published' && !item.expired).length);
      setText('announcementStatUrgent', this._items.filter((item) => item.type === 'urgent').length);
      setText('announcementStatPopup', this._items.filter((item) => item.showPopup).length);
      setText('announcementStatExpired', this._items.filter((item) => item.status === 'archived' || item.expired).length);

      const hint = $('announcementResultHint');
      if (hint) {
        const count = this.getVisibleItems().length;
        hint.textContent = `${count} 条匹配`;
      }
    },

    renderFilterState() {
      document.querySelectorAll('[data-announcement-filter]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.announcementFilter === this._state.status);
      });
      document.querySelectorAll('[data-announcement-type-filter]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.announcementTypeFilter === this._state.type);
      });
      document.querySelectorAll('[data-announcement-category-filter]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.announcementCategoryFilter === this._state.category);
      });
    },

    getCardSignature(item) {
      return JSON.stringify([
        item._id, item.title, item.content, item.type, item.status, item.pinned,
        item.priority, item.author, item.targetAudienceLabel, item.createdAt,
        item.showPopup, item.pushNotification, item.expired, relativeTimeRevision(item.createdAt),
      ]);
    },

    renderCardMarkup(item) {
      const severity = typeMeta(item.type);
      const status = statusMeta(item);
      const title = escapeHtml(item.title || '未命名公告');
      const priorityClass = item.type === 'urgent' || item.priority >= 9
        ? 'is-critical'
        : item.priority >= 5 ? 'is-high' : 'is-low';
      const popupClass = item.showPopup ? 'is-on' : 'is-off';
      const pushClass = item.pushNotification ? 'is-on' : 'is-off';
      const pinLabel = item.pinned ? '取消置顶' : '置顶';
      const archiveLabel = item.status === 'archived' ? '恢复发布' : '快捷归档';

      return `
        <button type="button" class="announcement-card-select" data-announcement-select aria-label="查看公告：${title}"></button>
        <div class="announcement-card-top">
          <div class="announcement-card-source">
            <span class="announcement-card-icon ${severity.className}"><i class="ph ${severity.icon}"></i></span>
            <strong>${escapeHtml(severity.label)}</strong>
            <span>·</span>
            <em title="${escapeHtml(item.targetAudienceLabel)}">${escapeHtml(item.targetAudienceLabel)}</em>
          </div>
          <span class="announcement-card-time">${formatRelativeTime(item.createdAt)} ${item.pinned ? '<i class="ph ph-push-pin-simple"></i>' : ''}</span>
        </div>
        <h3 title="${title}">${title}</h3>
        <p title="${escapeHtml(item.content || '暂无正文')}">${escapeHtml(item.content || '暂无正文')}</p>
        <div class="announcement-card-foot">
          <div class="announcement-card-tags">
            <span class="announcement-priority-pill ${priorityClass}">${priorityLabel(item.priority)}</span>
            ${item.status !== 'published' ? `<span class="announcement-state ${status.className}"><i class="${status.icon.startsWith('tb-') ? 'tb' : 'ph'} ${status.icon}"></i>${status.label}</span>` : ''}
            <span class="announcement-delivery-pill ${popupClass}" title="${item.showPopup ? '客户端弹窗显示已开启' : '客户端弹窗显示已关闭'}">
              <i class="ph ${item.showPopup ? 'ph-chat-circle-text' : 'ph-chat-circle-dots'}"></i>${item.showPopup ? '弹窗' : '无弹窗'}
            </span>
            <span class="announcement-delivery-pill ${pushClass}" title="${item.pushNotification ? '系统通知已开启' : '系统通知已关闭'}">
              <i class="ph ${item.pushNotification ? 'ph-bell-ringing' : 'ph-bell-slash'}"></i>${item.pushNotification ? '通知' : '静默'}
            </span>
          </div>
          <div class="announcement-card-actions">
            <button type="button" class="announcement-icon-action" data-announcement-action="pin" title="${pinLabel}" aria-label="${pinLabel}"><i class="ph ${item.pinned ? 'ph-push-pin-simple-slash' : 'ph-push-pin-simple'}"></i></button>
            <button type="button" class="announcement-icon-action" data-announcement-action="edit" title="修改正文" aria-label="修改正文"><i class="ph ph-sliders-horizontal"></i></button>
            <button type="button" class="announcement-icon-action" data-announcement-action="archive" title="${archiveLabel}" aria-label="${archiveLabel}"><i class="ph ${item.status === 'archived' ? 'ph-arrow-counter-clockwise' : 'ph-archive'}"></i></button>
            <button type="button" class="announcement-icon-action danger" data-announcement-action="delete" title="删除公告" aria-label="删除公告"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      `;
    },

    handleListClick(event) {
      const actionButton = event.target?.closest?.('[data-announcement-action]');
      if (actionButton) {
        const card = actionButton.closest?.('[data-announcement-id]');
        const item = this._items.find((candidate) => candidate._id === card?.dataset?.announcementId);
        if (!item) return;
        const action = actionButton.dataset.announcementAction;
        if (action === 'pin') this.handleTogglePin(item);
        if (action === 'edit') this.showEditForm(item);
        if (action === 'archive') this.handleArchive(item);
        if (action === 'delete') this.handleDelete(item.id);
        return;
      }

      const selectButton = event.target?.closest?.('[data-announcement-select]');
      const card = selectButton?.closest?.('[data-announcement-id]');
      if (!card) return;
      this._selectedId = card.dataset.announcementId || '';
      this.renderWorkspace();
    },

    shouldAnimateList() {
      return !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    },

    renderList(list) {
      const listEl = $('announcementList');
      if (!listEl) return;

      const scrollTop = listEl.scrollTop || 0;
      const activeElement = document.activeElement;
      const activeCard = activeElement?.closest?.('[data-announcement-id]');
      const focusState = activeCard && listEl.contains?.(activeElement) ? {
        id: activeCard.dataset.announcementId,
        action: activeElement.dataset?.announcementAction || (activeElement.hasAttribute?.('data-announcement-select') ? 'select' : ''),
      } : null;
      const currentChildren = Array.from(listEl.children || []);
      const currentCards = currentChildren.filter((node) => node.dataset?.announcementId);
      const cardsById = new Map(currentCards.map((node) => [node.dataset.announcementId, node]));
      const firstRects = new Map(currentCards.map((node) => [node, node.getBoundingClientRect?.()]));
      const animate = this.shouldAnimateList();

      if (!list.length) {
        let empty = currentChildren.find((node) => node.dataset?.announcementEmpty === 'true');
        if (!empty) {
          empty = document.createElement('div');
          empty.dataset.announcementEmpty = 'true';
          empty.className = 'announcement-empty';
          empty.innerHTML = `
            <i class="ph ph-speaker-slash announcement-empty-icon"></i>
            <strong>暂无匹配公告</strong>
            <span>调整筛选条件或创建一条新公告。</span>
          `;
        }
        currentChildren.forEach((node) => {
          if (node !== empty) node.remove?.();
        });
        listEl.appendChild(empty);
        listEl.scrollTop = scrollTop;
        return;
      }

      const desiredCards = list.map((item) => {
        let card = cardsById.get(item._id);
        const isNew = !card;
        if (!card) {
          card = document.createElement('article');
          card.className = 'announcement-card';
          card.dataset.announcementId = item._id;
          if (animate) card.classList.add('is-entering');
        } else if (card.dataset.announcementLeaving === 'true') {
          delete card.dataset.announcementLeaving;
          card.removeAttribute?.('aria-hidden');
          if ('inert' in card) card.inert = false;
          card.removeAttribute?.('inert');
          card.getAnimations?.().forEach((animation) => animation.cancel());
        }

        const signature = this.getCardSignature(item);
        if (isNew || card.dataset.renderSignature !== signature) {
          card.innerHTML = this.renderCardMarkup(item);
          card.dataset.renderSignature = signature;
        }

        const selected = item._id === this._selectedId;
        card.classList.toggle('selected', selected);
        card.querySelector?.('[data-announcement-select]')?.setAttribute('aria-pressed', String(selected));
        return card;
      });

      const desiredSet = new Set(desiredCards);
      currentChildren.forEach((node) => {
        if (!node.dataset?.announcementId) node.remove?.();
      });
      desiredCards.forEach((card) => listEl.appendChild(card));

      currentCards.filter((card) => !desiredSet.has(card)).forEach((card) => {
        listEl.appendChild(card);
        if (!animate || typeof card.animate !== 'function') {
          card.remove();
          return;
        }
        card.dataset.announcementLeaving = 'true';
        card.setAttribute('aria-hidden', 'true');
        if ('inert' in card) card.inert = true;
        card.setAttribute?.('inert', '');
        const removal = card.animate([
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-4px)' },
        ], { duration: 180, easing: 'ease-out', fill: 'forwards' });
        removal.finished.then(() => {
          if (card.dataset.announcementLeaving === 'true') card.remove();
        }).catch(() => {});
      });

      if (animate) {
        const runFlip = () => desiredCards.forEach((card) => {
          const first = firstRects.get(card);
          const last = card.getBoundingClientRect?.();
          if (!first || !last || typeof card.animate !== 'function') return;
          const deltaX = first.left - last.left;
          const deltaY = first.top - last.top;
          if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
          card.animate([
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: 'translate(0, 0)' },
          ], { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
        });
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(runFlip);
        else runFlip();
      }

      listEl.scrollTop = scrollTop;
      if (focusState) {
        const focusCard = desiredCards.find((card) => card.dataset.announcementId === focusState.id);
        const focusTarget = focusState.action === 'select'
          ? focusCard?.querySelector?.('[data-announcement-select]')
          : focusCard?.querySelector?.(`[data-announcement-action="${focusState.action}"]`);
        focusTarget?.focus?.({ preventScroll: true });
        listEl.scrollTop = scrollTop;
      }
    },

    getDetailSignature(item) {
      if (!item) return 'empty';
      return JSON.stringify([
        item._id, item.title, item.content, item.author, item.targetAudienceLabel,
        item.createdAt, item.views, item.acknowledges, item.totalAudience,
        item.status, item.pinned, item.priority, item.showPopup, item.pushNotification,
        relativeTimeRevision(item.createdAt),
      ]);
    },

    renderDetail(item) {
      const detailEl = $('announcementDetail');
      if (!detailEl) return;
      const signature = this.getDetailSignature(item);
      if (signature === this._renderedDetailSignature) return;
      const nextId = item?._id || '';
      const sameItem = nextId !== '' && nextId === this._renderedDetailId;
      const scrollTop = sameItem ? (detailEl.scrollTop || 0) : 0;
      const hadPreviewFocus = sameItem && detailEl.contains?.(document.activeElement)
        && document.activeElement?.id === 'announcementContentPreviewBtn';
      this._detailLoader?.destroy?.();
      this._detailLoader = null;
      this._renderedDetailId = nextId;
      this._renderedDetailSignature = signature;

      if (!item) {
        detailEl.innerHTML = `
          <div class="announcement-detail-empty">
            <i class="ph ph-megaphone"></i>
            <span>选择左侧公告查看详情。</span>
          </div>
        `;
        detailEl.scrollTop = 0;
        return;
      }

      const denominator = item.totalAudience || item.views || 0;
      const rate = denominator > 0 ? Math.round((item.acknowledges / denominator) * 100) : 0;

      detailEl.innerHTML = `
        <div class="announcement-detail-head">
          <div class="announcement-detail-title">
            <i class="ph ph-layout"></i>
            <span>公告详情 & 触达分析</span>
          </div>
          <code>ID: ${escapeHtml(item._id)}</code>
        </div>
        <div class="announcement-detail-meta">
          <span><i class="ph ph-user"></i>发布责任人：<strong>${escapeHtml(item.author)}</strong></span>
          <span><i class="ph ph-users-three"></i>触达范围：<strong>${escapeHtml(item.targetAudienceLabel)}</strong></span>
          <span><i class="ph ph-calendar"></i>发布时间：${item.createdAt ? `${formatDate(item.createdAt)} (${formatRelativeTime(item.createdAt)})` : '未记录'}</span>
        </div>
        <button class="announcement-detail-content is-preview" id="announcementContentPreviewBtn" title="点击查看完整正文">
          <h2>${escapeHtml(item.title || '未命名公告')}</h2>
          <p>${escapeHtml(item.content || '暂无正文')}</p>
          <span><i class="ph ph-corners-out"></i> 查看完整正文</span>
        </button>
        <div class="announcement-progress">
          <div class="announcement-progress-head">
            <span>触达率统计</span>
            <strong>${denominator > 0 ? `${rate}%` : '待统计'}</strong>
          </div>
          <div class="announcement-progress-track">
            <div style="width:${Math.max(0, Math.min(100, rate))}%"></div>
          </div>
        </div>
        <div class="announcement-metric-grid">
          <div><span><i class="ph ph-eye"></i>累计浏览量</span><strong>${item.views} 次</strong></div>
          <div><span><i class="ph ph-bookmark-simple"></i>确认收到数</span><strong>${item.acknowledges} / ${item.totalAudience || '待定'}</strong></div>
        </div>
      `;

      $('announcementContentPreviewBtn')?.addEventListener('click', () => this.showPreviewPopup(item));
      detailEl.scrollTop = scrollTop;
      if (hadPreviewFocus) $('announcementContentPreviewBtn')?.focus?.({ preventScroll: true });
    },

    renderError(err) {
      const listEl = $('announcementList');
      const detailEl = $('announcementDetail');
      const message = escapeHtml(err?.message || '获取公告失败');
      this._renderedDetailId = '';
      this._renderedDetailSignature = `error:${message}`;
      if (listEl) {
        listEl.innerHTML = `
          <div class="announcement-error">
            <i class="ph ph-warning-circle"></i>
            <strong>公告服务连接失败</strong>
            <small>${message}</small>
            <button class="announcement-empty-btn" id="announcementErrorMockBtn"><i class="ph ph-sparkle"></i> 使用本地模拟数据</button>
          </div>
        `;
        $('announcementErrorMockBtn')?.addEventListener('click', () => {
          localStorage.setItem('announcement_use_mock', 'true');
          this.syncMockBadge();
          this.loadAnnouncements();
        });
      }
      if (detailEl) {
        detailEl.innerHTML = '<div class="announcement-detail-empty"><i class="ph ph-cloud-x"></i><span>联调失败时不会自动伪装成成功数据。</span></div>';
      }
      this.renderStats();
    },

    showCreateForm() {
      this._formReturnFocus = document.activeElement;
      this._editingId = null;
      this.setFormValues({
        title: '',
        content: '',
        type: 'info',
        category: 'system',
        targetAudience: 'all',
        status: 'published',
        pinned: false,
        showPopup: true,
        pushNotification: false,
        priority: 1,
        expiresAt: '',
      });
      const title = $('announcementFormTitle');
      if (title) title.textContent = '创建公告';
      const icon = $('announcementFormTitleIcon');
      if (icon) icon.className = 'ph ph-megaphone-simple';
      const formWrapper = $('announcementFormWrapper');
      formWrapper?.classList.add('show');
      formWrapper?.setAttribute('aria-hidden', 'false');
      formWrapper?.removeAttribute('inert');
      if (formWrapper) formWrapper.inert = false;
      const createBtn = $('announcementCreateBtn');
      createBtn?.classList.add('is-concealed');
      setTimeout(() => $('announcementTitle')?.focus?.(), 0);
    },

    showEditForm(item) {
      if (!item) return;
      this._formReturnFocus = document.activeElement;
      this._editingId = item.id;
      this.setFormValues(item);
      const title = $('announcementFormTitle');
      if (title) title.textContent = '编辑公告';
      const icon = $('announcementFormTitleIcon');
      if (icon) icon.className = 'ph ph-pencil-simple';
      const formWrapper = $('announcementFormWrapper');
      formWrapper?.classList.add('show');
      formWrapper?.setAttribute('aria-hidden', 'false');
      formWrapper?.removeAttribute('inert');
      if (formWrapper) formWrapper.inert = false;
      const createBtn = $('announcementCreateBtn');
      createBtn?.classList.add('is-concealed');
      setTimeout(() => $('announcementTitle')?.focus?.(), 0);
    },

    setFormValues(data) {
      const setValue = (id, value) => {
        const el = $(id);
        if (el) {
          el.value = value ?? '';
          el._nekoSelect?.sync?.();
        }
      };
      setValue('announcementTitle', data.title || '');
      setValue('announcementContent', data.content || '');
      setValue('announcementPriority', data.priority || 1);
      setValue('announcementExpiresAt', toDateInputValue(data.expiresAt));
      setValue('announcementCategory', data.category || 'system');
      setValue('announcementAudience', normalizeAudience(data.targetAudience || data.audience));
      setValue('announcementStatus', data.status || 'published');
      this.setAnnouncementType(data.type || 'info');

      const checkboxState = [
        ['announcementShowPopup', 'announcementShowPopupToggle', data.showPopup !== false],
        ['announcementPushNotification', 'announcementPushNotificationToggle', data.pushNotification === true],
        ['announcementPinned', 'announcementPinnedToggle', data.pinned === true],
      ];
      checkboxState.forEach(([inputId, toggleId, enabled]) => {
        const input = $(inputId);
        if (input) input.checked = enabled;
        const toggle = $(toggleId);
        toggle?.classList.toggle('on', enabled);
        toggle?.setAttribute?.('aria-checked', enabled ? 'true' : 'false');
      });
      this.renderExpiryPicker();
    },

    getFormValues() {
      const audience = normalizeAudience($('announcementAudience')?.value || 'all');
      return {
        title: $('announcementTitle')?.value?.trim() || '',
        content: $('announcementContent')?.value?.trim() || '',
        type: $('announcementType')?.value || 'info',
        category: 'system',
        targetAudience: audience,
        status: $('announcementStatus')?.value || 'published',
        pinned: $('announcementPinned')?.checked === true,
        showPopup: $('announcementShowPopup')?.checked === true,
        pushNotification: $('announcementPushNotification')?.checked === true,
        priority: Number($('announcementPriority')?.value) || 1,
        expiresAt: toIsoFromInput($('announcementExpiresAt')?.value),
        totalAudience: AUDIENCE_META[audience]?.total || AUDIENCE_META.all.total,
      };
    },

    hideForm() {
      const formWrapper = $('announcementFormWrapper');
      formWrapper?.classList.remove('show');
      formWrapper?.setAttribute('aria-hidden', 'true');
      formWrapper?.setAttribute('inert', '');
      if (formWrapper) formWrapper.inert = true;
      const createBtn = $('announcementCreateBtn');
      createBtn?.classList.remove('is-concealed');
      this._editingId = null;
      this.showFormError('');
      const returnFocus = this._formReturnFocus;
      this._formReturnFocus = null;
      setTimeout(() => returnFocus?.isConnected !== false && returnFocus?.focus?.({ preventScroll: true }), 0);
    },

    async handleSave() {
      const values = this.getFormValues();
      if (!values.title || !values.content) {
        this.showFormError('标题和正文不能为空');
        return;
      }

      const saveBtn = $('announcementSaveBtn');
      window._nekoUIHelpers?.setButtonBusy?.(saveBtn, true, { label: '保存中' });

      const wasEditing = this._editingId !== null && this._editingId !== undefined;
      try {
        if (this.isMockMode()) {
          this.saveMock(values);
        } else {
          const client = getAnnouncementClient();
          if (!client?.isReady?.()) throw new Error('公告服务未就绪');
          const payload = { ...values };
          if (!payload.expiresAt) delete payload.expiresAt;
          if (this._editingId) await client.update(this._editingId, payload);
          else await client.create(payload);
        }
        this.hideForm();
        await this.loadAnnouncements();
        this._deps?.showNotice?.(wasEditing ? '公告已更新' : '公告已发布', 'success');
      } catch (err) {
        this.showFormError(err?.message || '保存失败');
      } finally {
        window._nekoUIHelpers?.setButtonBusy?.(saveBtn, false);
      }
    },

    saveMock(values) {
      const list = this.getMockAnnouncements();
      if (this._editingId) {
        const index = list.findIndex((item) => normalizeId(item.id) === normalizeId(this._editingId));
        if (index >= 0) list[index] = { ...list[index], ...values, updatedAt: new Date().toISOString() };
      } else {
        const maxId = list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
        list.unshift({
          id: maxId + 1,
          ...values,
          author: '系统管理员',
          views: 0,
          acknowledges: 0,
          createdAt: new Date().toISOString(),
        });
      }
      this.saveMockAnnouncements(list);
    },

    async updateAnnouncement(item, payload, successMessage) {
      try {
        if (this.isMockMode()) {
          const list = this.getMockAnnouncements().map((entry) => (
            normalizeId(entry.id) === item._id ? { ...entry, ...payload, updatedAt: new Date().toISOString() } : entry
          ));
          this.saveMockAnnouncements(list);
        } else {
          const client = getAnnouncementClient();
          if (!client?.isReady?.()) throw new Error('公告服务未就绪');
          await client.update(item.id, payload);
        }
        await this.loadAnnouncements();
        this._deps?.showNotice?.(successMessage, 'success');
      } catch (err) {
        this._deps?.showNotice?.(`${successMessage}失败: ${err?.message || '未知错误'}`, 'error');
      }
    },

    handleTogglePin(item) {
      this.updateAnnouncement(item, { pinned: !item.pinned }, item.pinned ? '已取消置顶' : '公告已置顶');
    },

    handleArchive(item) {
      const nextStatus = item.status === 'archived' ? 'published' : 'archived';
      this.updateAnnouncement(item, { status: nextStatus }, nextStatus === 'archived' ? '公告已归档' : '公告已恢复发布');
    },

    handleSimulateAck(item) {
      const totalAudience = item.totalAudience || 150;
      this.updateAnnouncement(item, {
        views: totalAudience,
        acknowledges: totalAudience,
        totalAudience,
      }, '回执统计已更新');
    },

    handleDelete(id) {
      if (id === undefined || id === null || id === '') return;
      const item = this._items.find((candidate) => normalizeId(candidate.id) === normalizeId(id));
      this._pendingDeleteId = id;
      const target = $('announcementDeleteTarget');
      if (target) target.textContent = item?.title || `公告 #${id}`;
      $('announcementDeleteOverlay')?.classList.add('show');
    },

    closeDeleteDialog() {
      $('announcementDeleteOverlay')?.classList.remove('show');
      this._pendingDeleteId = null;
    },

    async confirmDelete() {
      const id = this._pendingDeleteId;
      if (id === undefined || id === null || id === '') return;

      const confirmBtn = $('announcementDeleteConfirmBtn');
      window._nekoUIHelpers?.setButtonBusy?.(confirmBtn, true, { label: '删除中' });

      try {
        if (this.isMockMode()) {
          this.saveMockAnnouncements(this.getMockAnnouncements().filter((item) => normalizeId(item.id) !== normalizeId(id)));
        } else {
          const client = getAnnouncementClient();
          if (!client?.isReady?.()) throw new Error('公告服务未就绪');
          await client.delete(id);
        }
        if (this._selectedId === normalizeId(id)) {
          const visible = this.getVisibleItems();
          const deletedIndex = visible.findIndex((item) => item._id === normalizeId(id));
          this._selectedId = visible[deletedIndex + 1]?._id || visible[deletedIndex - 1]?._id || '';
        }
        this.closeDeleteDialog();
        await this.loadAnnouncements();
        this._deps?.showNotice?.('公告已删除', 'success');
      } catch (err) {
        this._deps?.showNotice?.(`删除失败: ${err?.message || '未知错误'}`, 'error');
      } finally {
        window._nekoUIHelpers?.setButtonBusy?.(confirmBtn, false);
      }
    },

    showFormError(msg) {
      const el = $('announcementFormError');
      if (!el) return;
      el.textContent = msg || '';
      el.style.display = msg ? 'block' : 'none';
    },

    startRuntime(options = {}) {
      if (this._runtimeStarted) return;
      this._runtimeStarted = true;

      const initialDelayMs = Number(options.initialDelayMs ?? 2000);
      const intervalMs = Number(options.intervalMs ?? 60000);
      this.bindAnnouncementNavSync();
      this.bindManagementRouteSync();
      this.restoreAnnouncementNav();

      setTimeout(() => this.checkUnreadPopups(), initialDelayMs);
      this._announcementPollTimer = setInterval(() => this.checkUnreadPopups(), intervalMs);
    },

    bindManagementRouteSync() {
      if (this._routeSyncBound) return;
      this._routeSyncBound = true;
      const bus = window._nekoModules?.eventBus;
      bus?.on?.('router:page-changed', ({ page } = {}) => {
        if (page !== 'page-announcement') return;
        this.loadAnnouncements();
      });
    },

    bindAnnouncementNavSync() {
      if (this._navSyncBound) return;
      this._navSyncBound = true;
      document.addEventListener('neko:authChange', (event) => {
        const { loggedIn, user } = event.detail || {};
        this.syncAnnouncementNav(loggedIn && isAdminUser(user));
      });
    },

    async restoreAnnouncementNav() {
      try {
        const client = getConfigClient();
        const cfg = await client?.getAll?.().catch?.(() => null);
        const authUser = cfg?.authUser || await client?.get?.('authUser');
        const canManage = isAdminUser(authUser);
        this.syncAnnouncementNav(canManage);
        if (canManage && cfg?.restoreLastState && cfg?.lastPage === 'page-announcement') {
          window._nekoModules?.router?.navigateTo?.('page-announcement');
        }
      } catch {}
    },

    syncAnnouncementNav(show) {
      const navEl = $('navAnnouncement');
      if (!navEl) return;
      navEl.classList.toggle('show', !!show);
      navEl.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (show) navEl.removeAttribute('tabindex');
      else navEl.setAttribute('tabindex', '-1');
      if (!show && navEl.classList.contains('active')) {
        document.querySelector('.nav-menu .nav-item[data-target="mainDashboardArea"]')?.click();
      }
      if (show && window._nekoModules?.router?.getCurrentPage?.() === 'page-announcement') {
        this.loadAnnouncements();
      }
      window._nekoSyncNavIndicator?.();
    },

    async checkUnreadPopups() {
      try {
        const client = getAnnouncementClient();
        if (!client?.isReady?.()) return;

        const result = await client.fetch({});
        const rawList = Array.isArray(result?.announcements)
          ? result.announcements
          : Array.isArray(result?.data?.announcements)
            ? result.data.announcements
            : Array.isArray(result) ? result : [];
        if (!rawList.length) return;

        const cfg = await getConfigClient()?.getAll?.();
        const readIds = (cfg?.readAnnouncementIds || []).map(normalizeId);
        const list = rawList.map(normalizeAnnouncement);

        for (const announcement of list) {
          if (!announcement.showPopup) continue;
          if (readIds.includes(normalizeId(announcement.id))) continue;

          if (announcement.type === 'urgent' && announcement.pushNotification) {
            try {
              await getSystemClient()?.notify?.(announcement.title, announcement.content);
            } catch {}
          }

          this.showRuntimePopup(announcement);
          client.recordReceipt?.(announcement.id, 'view')?.catch?.(() => {});
          break;
        }
      } catch {
        // Announcement polling should never block the main renderer flow.
      }
    },

    showRuntimePopup(announcement) {
      const overlay = $('announcementPopupOverlay');
      if (!overlay || !announcement) return;
      const severity = typeMeta(announcement.type);
      const iconEl = $('announcementPopupIcon');
      const titleEl = $('announcementPopupTitle');
      const contentEl = $('announcementPopupContent');
      const metaEl = $('announcementPopupMeta');

      if (titleEl) titleEl.textContent = announcement.title;
      if (contentEl) contentEl.textContent = announcement.content;
      if (metaEl) {
        const dateStr = announcement.createdAt
          ? new Date(announcement.createdAt).toLocaleDateString('zh-CN')
          : '';
        metaEl.textContent = dateStr ? `发布于 ${dateStr}` : '';
      }
      if (iconEl) {
        iconEl.className = `announcement-popup-icon ${announcement.type === 'urgent' ? 'urgent' : announcement.type === 'warning' ? 'warning' : 'info'}`;
        iconEl.innerHTML = `<i class="ph ${severity.icon}"></i>`;
      }

      overlay.classList.add('show');

      const closeBtn = $('announcementPopupCloseBtn');
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        overlay.classList.remove('show');
        closeBtn?.removeEventListener('click', close);
        overlay.removeEventListener('click', closeOnOverlay);
        try {
          const cfg = await getConfigClient()?.getAll?.();
          const readIds = Array.isArray(cfg?.readAnnouncementIds) ? cfg.readAnnouncementIds.slice() : [];
          const id = normalizeId(announcement.id);
          if (!readIds.map(normalizeId).includes(id)) {
            readIds.push(announcement.id);
            await getConfigClient()?.set?.('readAnnouncementIds', readIds);
          }
          await getAnnouncementClient()?.recordReceipt?.(announcement.id, 'ack')?.catch?.(() => {});
        } catch {}
      };
      const closeOnOverlay = (event) => {
        if (event.target === overlay) close();
      };

      closeBtn?.addEventListener('click', close);
      overlay.addEventListener('click', closeOnOverlay);
    },

    showPreviewPopup(item) {
      const overlay = $('announcementPopupOverlay');
      if (!overlay || !item) return;
      const severity = typeMeta(item.type);
      const iconEl = $('announcementPopupIcon');
      const titleEl = $('announcementPopupTitle');
      const contentEl = $('announcementPopupContent');
      const metaEl = $('announcementPopupMeta');
      if (titleEl) titleEl.textContent = item.title;
      if (contentEl) contentEl.textContent = item.content;
      if (metaEl) metaEl.textContent = item.expiresAt ? `过期时间: ${formatDate(item.expiresAt)}` : '永久生效';
      if (iconEl) {
        iconEl.className = `announcement-popup-icon ${item.type === 'urgent' ? 'urgent' : item.type === 'warning' ? 'warning' : 'info'}`;
        iconEl.innerHTML = `<i class="ph ${severity.icon}"></i>`;
      }

      overlay.classList.add('show');
      const closeBtn = $('announcementPopupCloseBtn');
      const close = () => {
        overlay.classList.remove('show');
        closeBtn?.removeEventListener('click', close);
        overlay.removeEventListener('click', closeOnOverlay);
      };
      const closeOnOverlay = (event) => {
        if (event.target === overlay) close();
      };
      closeBtn?.addEventListener('click', close);
      overlay.addEventListener('click', closeOnOverlay);
    },
  };

  window._nekoModules.pages.AnnouncementPage = AnnouncementPage;
})();

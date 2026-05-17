/**
 * core/router.js
 * 页面导航路由管理
 *
 * 将 app.js 中的导航切换逻辑提取为独立模块，支持：
 * - 页面切换与标题/图标更新
 * - 导航指示器动画同步
 * - 最后访问页面持久化
 *
 * 依赖：core/event-bus.js
 * 发射事件：router:page-changed
 */
(function () {
  const bus = window._nekoModules?.eventBus;

  /** 页面定义：targetId → { icon, title, flexDisplay } */
  const PAGE_DEFS = {
    mainDashboardArea:    { icon: 'ph-squares-four',      title: '仪表盘 / Dashboard',             flex: true },
    consoleArea:          { icon: 'ph-terminal-window',   title: '开发者控制台 / Console',          flex: true },
    'page-device-status': { icon: 'ph-hard-drives',       title: '设备状态 / Device Status',        flex: false },
    'page-screenshot':    { icon: 'ph-image',             title: '截图与活动 / Screenshot & Activity', flex: false },
    'page-services':      { icon: 'ph-cpu',               title: '服务与自启动 / Services',          flex: false },
    'page-stream':        { icon: 'ph-broadcast',         title: '直播推流 / Live Stream',          flex: false },
    'page-update':        { icon: 'ph-cloud-arrow-down',  title: '更新中心 / Update Center',        flex: false },
    'page-settings':      { icon: 'ph-gear',              title: '设置 / Settings',                flex: false },
    'page-about':         { icon: 'ph-info',              title: '关于 / About',                   flex: false },
  };

  // 可被 lastPage 持久化的页面
  const RESTORABLE_PAGES = new Set([
    'mainDashboardArea', 'consoleArea', 'page-device-status', 'page-screenshot',
    'page-services', 'page-stream', 'page-update', 'page-about'
  ]);

  let _navMenu = null;
  let _navIndicator = null;
  let _currentPage = 'mainDashboardArea';

  /** 同步导航指示器位置 */
  function syncNavIndicator(target) {
    if (!_navMenu || !_navIndicator) return;
    const item = target || _navMenu.querySelector('.nav-item.active');
    if (!item || getComputedStyle(item).display === 'none') return;
    if (item.classList.contains('console-nav') && !item.classList.contains('show')) return;
    const menuRect = _navMenu.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    _navMenu.style.setProperty('--nav-indicator-y', `${itemRect.top - menuRect.top}px`);
    _navMenu.style.setProperty('--nav-indicator-h', `${itemRect.height}px`);
    _navIndicator.classList.add('is-ready');
  }

  /**
   * 导航到指定页面
   * @param {string} targetId - 目标区域 ID
   */
  function navigateTo(targetId) {
    const def = PAGE_DEFS[targetId];
    if (!def) return;

    _currentPage = targetId;

    // 持久化最后访问页面
    if (window.nekoIPC && RESTORABLE_PAGES.has(targetId)) {
      window.nekoIPC.setConfig('lastPage', targetId);
    }

    // 隐藏所有区域
    Object.keys(PAGE_DEFS).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // 显示目标区域
    const target = document.getElementById(targetId);
    if (target) {
      target.style.display = def.flex ? 'flex' : 'block';
    }

    // 更新标题
    const headerTitle = document.querySelector('.page-title');
    if (headerTitle) {
      headerTitle.innerHTML = `<i class="ph ${def.icon}" style="color: var(--theme-color);"></i>\n                    ${def.title}`;
    }

    // 编辑按钮可见性
    const editBtn = document.getElementById('editLayoutBtn');
    if (editBtn) {
      editBtn.classList.toggle('hidden-action', targetId !== 'mainDashboardArea');
    }

    bus?.emit('router:page-changed', { page: targetId });
  }

  /** 获取当前页面 ID */
  function getCurrentPage() { return _currentPage; }

  /** 初始化路由（绑定导航点击） */
  function init() {
    _navMenu = document.querySelector('.nav-menu');
    _navIndicator = document.getElementById('navActiveIndicator');
    const navItems = document.querySelectorAll('.nav-menu .nav-item');

    requestAnimationFrame(() => syncNavIndicator());
    window.addEventListener('resize', () => syncNavIndicator());

    navItems.forEach(item => {
      item.addEventListener('click', function () {
        const targetId = this.getAttribute('data-target');
        if (!targetId) return;
        if (this.classList.contains('console-nav') && !this.classList.contains('show')) return;

        navItems.forEach(nav => nav.classList.remove('active'));
        this.classList.add('active');
        syncNavIndicator(this);
        navigateTo(targetId);
      });
    });
  }

  window._nekoModules = window._nekoModules || {};
  window._nekoModules.router = {
    init,
    navigateTo,
    getCurrentPage,
    syncNavIndicator,
    PAGE_DEFS,
    RESTORABLE_PAGES,
  };
})();

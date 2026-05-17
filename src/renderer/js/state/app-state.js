/**
 * state/app-state.js
 * 轻量全局可观察状态
 *
 * 集中管理散落在 app-ipc.js 中的全局变量，
 * 提供 get/set/subscribe 接口
 *
 * 依赖：core/event-bus.js
 */
(function () {
  const bus = window._nekoModules?.eventBus;

  const _state = {
    serviceRunning: false,
    scalePercent: 100,
    healthStats: { total: 0, success: 0 },
    lastMetrics: null,
    lastTick: null,
    trendRange: '1m',
    metricsBuffer: [],
  };

  /**
   * 获取状态值
   * @param {string} key
   */
  function get(key) {
    return _state[key];
  }

  /**
   * 设置状态值，触发 state:{key} 事件
   * @param {string} key
   * @param {*} value
   */
  function set(key, value) {
    const old = _state[key];
    _state[key] = value;
    bus?.emit(`state:${key}`, { value, old });
  }

  /**
   * 批量更新多个状态
   * @param {Object} updates - { key: value }
   */
  function merge(updates) {
    Object.entries(updates).forEach(([key, value]) => set(key, value));
  }

  /**
   * 订阅状态变更
   * @param {string} key
   * @param {Function} handler - ({ value, old }) => void
   * @returns {Function} 取消订阅
   */
  function subscribe(key, handler) {
    return bus?.on(`state:${key}`, handler) || (() => {});
  }

  /** 获取所有状态的快照 */
  function snapshot() {
    return { ..._state };
  }

  window._nekoModules = window._nekoModules || {};
  window._nekoModules.appState = { get, set, merge, subscribe, snapshot };
})();

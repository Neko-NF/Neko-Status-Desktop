/**
 * core/event-bus.js
 * 简易发布-订阅事件总线
 * 替代当前散落的 CustomEvent / 全局函数调用模式
 */
(function () {
  const _listeners = {};

  const eventBus = {
    /**
     * 监听事件
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} 取消监听的函数
     */
    on(event, handler) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(handler);
      return () => {
        _listeners[event] = (_listeners[event] || []).filter(h => h !== handler);
      };
    },

    /**
     * 一次性监听
     * @param {string} event
     * @param {Function} handler
     */
    once(event, handler) {
      const off = eventBus.on(event, (...args) => {
        off();
        handler(...args);
      });
    },

    /**
     * 发射事件
     * @param {string} event
     * @param {...any} args
     */
    emit(event, ...args) {
      (_listeners[event] || []).forEach(h => {
        try { h(...args); } catch (e) { console.error(`[EventBus] ${event}:`, e); }
      });
    },

    /** 移除某事件的所有监听器 */
    off(event) {
      delete _listeners[event];
    },
  };

  window._nekoModules = window._nekoModules || {};
  window._nekoModules.eventBus = eventBus;
})();

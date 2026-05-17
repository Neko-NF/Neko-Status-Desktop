/**
 * Compatibility layer for older renderer code.
 * The actual IPC bridge now comes from `src/preload/index.js`.
 */
(function attachPreloadedIpcBridge() {
  if (window.nekoIPC) return;

  const fallback = {
    on() {
      console.warn('[ipc-bridge] preload bridge missing; event subscription skipped');
      return () => {};
    },
    once() {
      console.warn('[ipc-bridge] preload bridge missing; one-time event subscription skipped');
    },
  };

  window.nekoIPC = fallback;
  console.error('[ipc-bridge] preload bridge missing; renderer is running in degraded mode');
})();

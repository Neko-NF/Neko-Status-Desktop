/**
 * app-ipc.js
 * Compatibility bootstrap for the split renderer runtime.
 */
(function bootstrapRendererRuntime() {
  function startRuntime() {
    const runtime = window._nekoModules?.core?.AppRuntime;
    if (!runtime?.start) {
      console.error('[app-ipc] AppRuntime is not loaded');
      return;
    }
    runtime.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRuntime, { once: true });
    return;
  }

  startRuntime();
})();

/**
 * app.js
 * Thin renderer bootstrap entry.
 *
 * Shell DOM bindings live in components/app-shell-controls.js. Domain UI logic
 * belongs in pages/*, reusable behavior in components/*, and cross-page basics
 * in core/* or state/*.
 */
(function bootstrapRendererApp() {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.app = {
    startedAt: Date.now(),
    shellControls: () => window._nekoModules?.components?.AppShellControls || null,
  };
})();

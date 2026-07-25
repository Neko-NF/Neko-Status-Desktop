/** Compatibility bridge. The implementation lives in components/ui-helpers.js. */
(function () {
  const setExpandableSectionState = window._nekoUIHelpers?.setExpandableSectionState;
  if (typeof setExpandableSectionState !== 'function') return;

  window._nekoModules = window._nekoModules || {};
  window._nekoModules.expandableSection = { setExpandableSectionState };
  // One-cycle alias for integrations that consumed the original global function.
  window.setExpandableSectionState = setExpandableSectionState;
})();

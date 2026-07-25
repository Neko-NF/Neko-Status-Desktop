(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.components = window._nekoModules.components || {};

  function create(deps = {}) {
    const {
      setExpandableSectionState = (el, expanded, options = {}) => {
        if (!el) return;
        el.style.display = expanded ? (options.display || '') : 'none';
      },
      syncNavIndicator = () => window._nekoSyncNavIndicator?.(),
      stopStreamStatusPolling = () => {
        if (typeof window.stopStreamStatusPolling === 'function') window.stopStreamStatusPolling();
      },
    } = deps;

    function mountSettingsZone() {
      const zone = document.getElementById('settingsExperimentalZone');
      const settingsExperimentalLabel = document.getElementById('settingsExperimentalLabel');
      const settingsExperimental = document.getElementById('settings-experimental');
      const experimentalDesc = document.getElementById('stgExperimentalDesc');

      if (!zone || !settingsExperimental || zone.dataset.mounted === '1') return;

      if (settingsExperimentalLabel) zone.appendChild(settingsExperimentalLabel);
      else {
        const title = document.createElement('div');
        title.className = 'settings-group-label';
        title.innerHTML = '<i class="ph ph-flask"></i> 实验性功能';
        zone.appendChild(title);
      }

      settingsExperimental.classList.add('settings-experimental-shell');
      zone.appendChild(settingsExperimental);

      if (experimentalDesc) {
        experimentalDesc.textContent = '开启后可选择要显示的实验功能入口；具体功能设置仍在各自页面里完成。';
      }

      zone.dataset.mounted = '1';
    }

    function applyState(cfg = {}) {
      const enabled = !!cfg.enableExperimentalFeatures;
      const activityEntryEnabled = enabled && cfg.enableExperimentalActivityEntry === true;
      const streamEntryEnabled = enabled && cfg.enableExperimentalStreamEntry === true;
      const uiLabEntryEnabled = enabled && cfg.enableExperimentalUiLabEntry === true;
      const streamGate = document.getElementById('streamExperimentalGate');
      const streamContent = document.getElementById('streamExperimentalContent');
      const streamPage = document.getElementById('page-stream');
      const experimentalSwitch = document.getElementById('stgExperimentalSwitch');
      const activitySwitch = document.getElementById('stgExperimentalActivitySwitch');
      const streamSwitch = document.getElementById('stgExperimentalStreamSwitch');
      const uiLabSwitch = document.getElementById('stgExperimentalUiLabSwitch');
      const activityRow = document.getElementById('stgExperimentalActivityRow');
      const streamRow = document.getElementById('stgExperimentalStreamRow');
      const uiLabRow = document.getElementById('stgExperimentalUiLabRow');
      const experimentalDesc = document.getElementById('stgExperimentalDesc');
      const navStream = document.getElementById('navStream');
      const navActivity = document.getElementById('navActivity');
      const navUiLab = document.getElementById('navUiLab');
      const activityPage = document.getElementById('page-activity');
      const uiLabPage = document.getElementById('page-ui-lab');
      const settingsExperimental = document.getElementById('settings-experimental');

      if (experimentalSwitch) experimentalSwitch.classList.toggle('on', enabled);
      if (activitySwitch) activitySwitch.classList.toggle('on', activityEntryEnabled);
      if (streamSwitch) streamSwitch.classList.toggle('on', streamEntryEnabled);
      if (uiLabSwitch) uiLabSwitch.classList.toggle('on', uiLabEntryEnabled);
      if (settingsExperimental) {
        settingsExperimental.classList.toggle('is-experimental-expanded', enabled);
      }
      [activityRow, streamRow, uiLabRow].forEach((row) => {
        if (!row) return;
        row.setAttribute('aria-hidden', enabled ? 'false' : 'true');
        row.classList.toggle('is-expanded', enabled);
        row.classList.toggle('is-collapsed', !enabled);
        if (row.style) {
          row.style.removeProperty?.('display');
          row.style.removeProperty?.('max-height');
          row.style.removeProperty?.('opacity');
          row.style.removeProperty?.('transform');
        }
      });
      setExpandableSectionState(streamGate, !streamEntryEnabled, { display: 'flex' });
      if (streamContent) streamContent.style.display = streamEntryEnabled ? '' : 'none';
      if (experimentalDesc) {
        experimentalDesc.textContent = enabled
          ? '选择下方入口后，对应页面会出现在侧边栏；功能细节请进入对应页面设置。'
          : '关闭后会隐藏仍在验证中的功能入口，仅保留稳定功能。';
      }
      if (streamPage && !streamEntryEnabled) streamPage.style.display = 'none';
      if (activityPage && !activityEntryEnabled) activityPage.style.display = 'none';
      if (uiLabPage && !uiLabEntryEnabled) uiLabPage.style.display = 'none';

      [
        [navActivity, activityEntryEnabled],
        [navStream, streamEntryEnabled],
        [navUiLab, uiLabEntryEnabled],
      ].forEach(([navItem, visible]) => {
        if (!navItem) return;
        navItem.classList.toggle('show', visible);
        navItem.setAttribute('aria-hidden', visible ? 'false' : 'true');
        if (visible) navItem.setAttribute('tabindex', '0');
        else navItem.setAttribute('tabindex', '-1');
        navItem.classList.toggle('experimental-off', !visible);
      });
      syncNavIndicator();
      window.setTimeout?.(() => syncNavIndicator(), 340);
      const activeStreamNav = document.querySelector('.nav-item.active[data-target="page-stream"]');
      const activeActivityNav = document.querySelector('.nav-item.active[data-target="page-activity"]');
      const activeUiLabNav = document.querySelector('.nav-item.active[data-target="page-ui-lab"]');
      if ((activeStreamNav && !streamEntryEnabled)
        || (activeActivityNav && !activityEntryEnabled)
        || (activeUiLabNav && !uiLabEntryEnabled)) {
        document.querySelector('.nav-item[data-target="mainDashboardArea"]')?.click();
      }
      if (!streamEntryEnabled) stopStreamStatusPolling();
    }

    return { mountSettingsZone, applyState };
  }

  window._nekoModules.components.ExperimentalFeatures = { create };
})();

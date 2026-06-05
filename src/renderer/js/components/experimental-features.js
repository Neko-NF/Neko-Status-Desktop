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
      const streamSettingsLabel = document.getElementById('streamSettingsLabel');
      const streamSettings = document.getElementById('settings-stream');
      const streamSettingsDisabledNotice = document.getElementById('streamSettingsDisabledNotice');
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

      const featureStack = document.createElement('div');
      featureStack.id = 'settingsExperimentalFeatures';
      featureStack.className = 'settings-experimental-features';
      zone.appendChild(featureStack);

      if (streamSettingsLabel) featureStack.appendChild(streamSettingsLabel);
      if (streamSettingsDisabledNotice) streamSettingsDisabledNotice.remove();
      if (streamSettings) featureStack.appendChild(streamSettings);

      if (experimentalDesc) {
        experimentalDesc.textContent = '开启后会显示仍在验证中的新功能、配套入口和相关设置；关闭后这些内容会从侧边栏和设置页一起隐藏。';
      }

      zone.dataset.mounted = '1';
    }

    function applyState(cfg = {}) {
      const enabled = !!cfg.enableExperimentalFeatures;
      const streamGate = document.getElementById('streamExperimentalGate');
      const streamContent = document.getElementById('streamExperimentalContent');
      const streamSettings = document.getElementById('settings-stream');
      const settingsExperimentalFeatures = document.getElementById('settingsExperimentalFeatures');
      const streamSettingsLabel = document.getElementById('streamSettingsLabel');
      const streamSettingsDisabledNotice = document.getElementById('streamSettingsDisabledNotice');
      const streamPage = document.getElementById('page-stream');
      const experimentalSwitch = document.getElementById('stgExperimentalSwitch');
      const experimentalDesc = document.getElementById('stgExperimentalDesc');
      const navStream = document.getElementById('navStream');

      if (experimentalSwitch) experimentalSwitch.classList.toggle('on', enabled);
      setExpandableSectionState(streamGate, !enabled, { display: 'flex' });
      if (streamContent) streamContent.style.display = enabled ? '' : 'none';
      setExpandableSectionState(streamSettings, enabled, { display: 'flex' });
      setExpandableSectionState(settingsExperimentalFeatures, enabled, { display: 'flex' });
      setExpandableSectionState(streamSettingsLabel, enabled, { display: 'flex' });
      if (streamSettingsDisabledNotice) streamSettingsDisabledNotice.style.display = 'none';
      if (experimentalDesc) {
        experimentalDesc.textContent = enabled
          ? '实验性内容已开启，仍在验证中的新功能会显示对应入口、页面和设置项。'
          : '关闭后会隐藏所有仍在验证中的功能入口、页面和相关设置，仅保留稳定功能。';
      }
      if (streamPage && !enabled) streamPage.style.display = 'none';
      if (navStream) {
        navStream.classList.toggle('show', enabled);
        navStream.setAttribute('aria-hidden', enabled ? 'false' : 'true');
        if (enabled) navStream.removeAttribute('tabindex');
        else navStream.setAttribute('tabindex', '-1');
        navStream.classList.toggle('experimental-off', !enabled);
        syncNavIndicator();
      }
      if (!enabled && document.querySelector('.nav-item.active[data-target="page-stream"]')) {
        document.querySelector('.nav-item[data-target="mainDashboardArea"]')?.click();
      }
      if (!enabled) stopStreamStatusPolling();
    }

    return { mountSettingsZone, applyState };
  }

  window._nekoModules.components.ExperimentalFeatures = { create };
})();

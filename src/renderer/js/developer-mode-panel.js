(function () {
  const IPC_EVENTS = window.__NEKO_IPC_CONTRACTS__?.IPC_EVENTS || {};
  const bridge = window.nekoIPC || {};

  const state = {
    enabled: true,
    uiInspect: false,
    includeHidden: false,
    backend: null,
    selectedInfo: null,
    theme: null,
  };

  const els = {};

  function safeText(value, fallback = '--') {
    const text = value == null || value === '' ? fallback : String(value);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }

  async function sendCommand(action, extra = {}) {
    if (typeof bridge.sendDeveloperModePanelCommand !== 'function') return;
    await bridge.sendDeveloperModePanelCommand({ action, ...extra });
  }

  async function copyText(text) {
    const value = String(text || '');
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand?.('copy') !== false;
    input.remove();
    return ok;
  }

  function backendItems(snapshot = {}) {
    return [
      ['IPC 桥接', snapshot.ipcReady ? '就绪' : '缺失', snapshot.ipcReady ? 'ok' : 'error'],
      ['运行时', snapshot.version || '--', snapshot.version ? 'ok' : 'warn'],
      ['上报服务', snapshot.serviceRunning ? '运行中' : '已停止', snapshot.serviceRunning ? 'ok' : 'warn'],
      ['主进程', snapshot.processInfo ? `PID ${snapshot.processInfo.pid}` : '--', snapshot.processInfo ? 'ok' : 'warn'],
      ['性能指标', snapshot.metrics ? `CPU ${safeText(snapshot.metrics.cpuPct)} / MEM ${safeText(snapshot.metrics.memPct)}` : '--', snapshot.metrics ? 'ok' : 'warn'],
      ['API 探测', snapshot.api ? safeText(snapshot.api.ok === false ? snapshot.api.error : snapshot.api.latencyMs ? `${snapshot.api.latencyMs}ms` : 'OK') : '未测试', snapshot.api?.ok === false ? 'error' : snapshot.api ? 'ok' : 'warn'],
    ];
  }

  function renderBackend(snapshot) {
    if (!els.backendList) return;
    els.backendList.replaceChildren(...backendItems(snapshot).map(([label, value, status]) => {
      const row = document.createElement('div');
      row.className = `dev-backend-row ${status}`;
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const valueEl = document.createElement('strong');
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      return row;
    }));
  }

  function detailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'dev-detail-row';

    const text = document.createElement('div');
    text.className = 'dev-detail-copy';
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('strong');
    val.textContent = safeText(value);
    text.append(key, val);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'dev-copy-btn';
    copy.dataset.copyValue = String(value || '');
    copy.innerHTML = '<i class="ph ph-copy"></i><span>复制</span>';
    row.append(text, copy);
    return row;
  }

  function renderDetails(info) {
    if (!els.inspectDetails || !els.inspectEmpty) return;
    els.inspectDetails.hidden = !info;
    els.inspectEmpty.hidden = !!info;
    els.inspectDetails.innerHTML = '';
    if (!info) return;

    const title = document.createElement('div');
    title.className = 'dev-details-title';
    title.innerHTML = '<i class="ph ph-cursor-click"></i><span>已选中元素</span>';
    els.inspectDetails.appendChild(title);

    [
      ['代码特征', info.name],
      ['选择器', info.selector],
      ['实现位置', `${info.sourceOwner} -> ${info.sourceFile}`],
      ['角色/类型', info.role],
      ['尺寸', info.size],
      ['CSS 层级', info.features],
    ].forEach(([label, value]) => {
      els.inspectDetails.appendChild(detailRow(label, value));
    });
  }

  function render() {
    els.toggleInspectBtn?.classList.toggle('active', !!state.uiInspect);
    els.includeHiddenSwitch?.classList.toggle('active', !!state.includeHidden);
    els.includeHiddenSwitch?.setAttribute('aria-pressed', state.includeHidden ? 'true' : 'false');
    renderBackend(state.backend || {});
    renderDetails(state.selectedInfo || null);
  }

  function applyTheme(theme = {}) {
    if (Object.prototype.hasOwnProperty.call(theme, 'mode')) {
      if (theme.mode) document.documentElement.setAttribute('data-theme', theme.mode);
      else document.documentElement.removeAttribute('data-theme');
    }
    Object.entries(theme.cssVars || {}).forEach(([name, value]) => {
      if (/^--[a-z0-9-]+$/i.test(name) && value) document.body.style.setProperty(name, value);
    });
  }

  function applyState(payload = {}) {
    if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) state.enabled = !!payload.enabled;
    if (Object.prototype.hasOwnProperty.call(payload, 'uiInspect')) state.uiInspect = !!payload.uiInspect;
    if (Object.prototype.hasOwnProperty.call(payload, 'includeHidden')) state.includeHidden = !!payload.includeHidden;
    if (Object.prototype.hasOwnProperty.call(payload, 'backend')) state.backend = payload.backend;
    if (Object.prototype.hasOwnProperty.call(payload, 'selectedInfo')) state.selectedInfo = payload.selectedInfo;
    if (Object.prototype.hasOwnProperty.call(payload, 'theme')) {
      state.theme = payload.theme;
      applyTheme(state.theme || {});
    }
    render();
  }

  function bind() {
    els.closePanelBtn?.addEventListener('click', async () => {
      await sendCommand('disable');
      if (typeof bridge.closeDeveloperModePanel === 'function') await bridge.closeDeveloperModePanel();
    });
    els.toggleInspectBtn?.addEventListener('click', () => sendCommand('toggle-inspect'));
    els.includeHiddenSwitch?.addEventListener('click', () => sendCommand('toggle-include-hidden'));
    els.refreshBackendBtn?.addEventListener('click', async () => {
      els.refreshBackendBtn.classList.add('loading');
      await sendCommand('refresh-backend');
      setTimeout(() => els.refreshBackendBtn?.classList.remove('loading'), 900);
    });
    els.rescanBtn?.addEventListener('click', () => sendCommand('rescan'));

    els.inspectDetails?.addEventListener('click', async (event) => {
      const copyButton = event.target.closest('[data-copy-value]');
      if (!copyButton) return;
      await copyText(copyButton.dataset.copyValue || '');
      copyButton.classList.add('copied');
      const label = copyButton.querySelector('span');
      if (label) label.textContent = '已复制';
      setTimeout(() => {
        copyButton.classList.remove('copied');
        const nextLabel = copyButton.querySelector('span');
        if (nextLabel) nextLabel.textContent = '复制';
      }, 1100);
    });

    if (typeof bridge.on === 'function' && IPC_EVENTS.DEV_MODE_PANEL_STATE) {
      bridge.on(IPC_EVENTS.DEV_MODE_PANEL_STATE, applyState);
    }
  }

  function init() {
    [
      'closePanelBtn',
      'toggleInspectBtn',
      'refreshBackendBtn',
      'rescanBtn',
      'includeHiddenSwitch',
      'backendList',
      'inspectEmpty',
      'inspectDetails',
    ].forEach((id) => { els[id] = document.getElementById(id); });
    bind();
    render();
    sendCommand('request-state');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

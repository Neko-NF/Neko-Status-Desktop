(function () {
  const IPC_EVENTS = window.__NEKO_IPC_CONTRACTS__?.IPC_EVENTS || {};
  const bridge = window.nekoIPC || {};

  const state = {
    enabled: true,
    uiInspect: false,
    includeHidden: false,
    backend: null,
    selectedInfo: null,
    diagnostics: [],
    theme: null,
  };

  const els = {};
  let renderedSelectedSelector = '';

  function safeText(value, fallback = '--') {
    const text = value == null || value === '' ? fallback : String(value);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function boolText(value) {
    return value ? '开启' : '关闭';
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

  function statusRow(label, value, status = 'ok') {
    const row = document.createElement('div');
    row.className = `dev-backend-row ${status}`;
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const valueEl = document.createElement('strong');
    valueEl.textContent = safeText(value);
    row.append(labelEl, valueEl);
    return row;
  }

  function renderRows(container, rows) {
    if (!container) return;
    container.replaceChildren(...rows.map(([label, value, status]) => statusRow(label, value, status)));
  }

  function backendItems(snapshot = {}) {
    return [
      ['IPC', snapshot.ipcReady ? '就绪' : '缺失', snapshot.ipcReady ? 'ok' : 'error'],
      ['上报服务', snapshot.serviceRunning ? '运行中' : '已停止', snapshot.serviceRunning ? 'ok' : 'warn'],
      ['性能', snapshot.metrics ? `CPU ${safeText(snapshot.metrics.cpuPct)} / MEM ${safeText(snapshot.metrics.memPct)}` : '--', snapshot.metrics ? 'ok' : 'warn'],
      ['API', snapshot.api ? safeText(snapshot.api.ok === false ? snapshot.api.error : snapshot.api.latencyMs ? `${snapshot.api.latencyMs}ms` : '正常') : '未探测', snapshot.api?.ok === false ? 'error' : snapshot.api ? 'ok' : 'warn'],
    ];
  }

  function runtimeItems(snapshot = {}) {
    const runtime = snapshot.runtime || {};
    return [
      ['应用版本', snapshot.version || '--', snapshot.version ? 'ok' : 'warn'],
      ['Electron', runtime.electron || '--', runtime.electron ? 'ok' : 'warn'],
      ['进程', snapshot.processInfo ? `PID ${snapshot.processInfo.pid}` : '--', snapshot.processInfo ? 'ok' : 'warn'],
      ['缓存', formatBytes(snapshot.cacheSize), Number(snapshot.cacheSize || 0) > 0 ? 'warn' : 'ok'],
      ['运行模式', snapshot.configMode || '--', 'ok'],
      ['采样时间', snapshot.sampledAt ? new Date(snapshot.sampledAt).toLocaleTimeString() : '--', snapshot.sampledAt ? 'ok' : 'warn'],
    ];
  }

  function updateItems(snapshot = {}) {
    const update = snapshot.update || {};
    const pending = update.pending || {};
    return [
      ['通道', update.channel || '--', 'ok'],
      ['源模式', update.sourceMode === 'smart' ? '智能' : '手动', update.sourceMode === 'smart' ? 'ok' : 'warn'],
      ['当前源', update.activeSourceId || '--', update.activeSourceId ? 'ok' : 'warn'],
      ['自动检查', boolText(update.autoCheck), update.autoCheck ? 'ok' : 'warn'],
      ['自动下载', boolText(update.autoDownload), update.autoDownload ? 'ok' : 'warn'],
      ['待安装', pending.hasPending || pending.filePath ? (pending.version || '已就绪') : '无', pending.hasPending || pending.filePath ? 'warn' : 'ok'],
    ];
  }

  function setSwitch(el, on) {
    if (!el) return;
    el.classList.toggle('active', !!on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function renderSnapshot(snapshot) {
    renderRows(els.backendList, backendItems(snapshot));
    renderRows(els.runtimeList, runtimeItems(snapshot));
    renderRows(els.updateList, updateItems(snapshot));
    const update = snapshot.update || {};
    setSwitch(els.updateSourceModeSwitch, update.sourceMode === 'smart');
    setSwitch(els.autoCheckUpdateSwitch, update.autoCheck !== false);
    setSwitch(els.autoDownloadSwitch, update.autoDownload === true);
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
    copy.dataset.label = '复制';
    copy.innerHTML = '<i class="ph ph-copy"></i><span>复制</span>';
    row.append(text, copy);
    return row;
  }

  function renderDetails(info) {
    if (!els.inspectDetails || !els.inspectEmpty) return;
    const nextSelector = info?.selector || '';
    const shouldScroll = !!nextSelector && nextSelector !== renderedSelectedSelector;
    renderedSelectedSelector = nextSelector;
    els.inspectDetails.hidden = !info;
    els.inspectEmpty.hidden = !!info;
    els.inspectDetails.innerHTML = '';
    if (!info) return;

    const title = document.createElement('div');
    title.className = 'dev-details-title';
    title.innerHTML = '<i class="ph ph-cursor-click"></i><span>已选中元素</span>';
    els.inspectDetails.appendChild(title);

    [
      ['名称', info.name],
      ['选择器', info.selector],
      ['来源', `${info.sourceOwner} -> ${info.sourceFile}`],
      ['角色/类型', info.role],
      ['尺寸', info.size],
      ['CSS 层级', info.features],
    ].forEach(([label, value]) => {
      els.inspectDetails.appendChild(detailRow(label, value));
    });
    if (shouldScroll) {
      requestAnimationFrame(() => {
        els.inspectCard?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      });
    }
  }

  function renderDiagnostics(items = []) {
    if (!els.diagnosticsList) return;
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'dev-empty dev-empty-compact';
      empty.textContent = '暂无诊断结果';
      els.diagnosticsList.replaceChildren(empty);
      return;
    }
    els.diagnosticsList.replaceChildren(...items.map((item) => {
      const row = document.createElement('div');
      row.className = `dev-diagnostic-row ${item.status || 'ok'}`;
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = safeText(item.title, '诊断');
      const detail = document.createElement('span');
      detail.textContent = safeText(item.detail, '完成');
      text.append(title, detail);
      const time = document.createElement('small');
      time.textContent = item.at ? new Date(item.at).toLocaleTimeString() : '--';
      row.append(text, time);
      return row;
    }));
  }

  function snapshotText() {
    const snapshot = state.backend || {};
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      developerMode: {
        enabled: state.enabled,
        uiInspect: state.uiInspect,
        includeHidden: state.includeHidden,
      },
      backend: snapshot,
      diagnostics: state.diagnostics,
      selectedInfo: state.selectedInfo || null,
    }, null, 2);
  }

  function render() {
    els.toggleInspectBtn?.classList.toggle('active', !!state.uiInspect);
    setSwitch(els.includeHiddenSwitch, state.includeHidden);
    renderSnapshot(state.backend || {});
    renderDiagnostics(state.diagnostics || []);
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
    if (Object.prototype.hasOwnProperty.call(payload, 'diagnostics')) state.diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    if (Object.prototype.hasOwnProperty.call(payload, 'theme')) {
      state.theme = payload.theme;
      applyTheme(state.theme || {});
    }
    render();
  }

  function markCopied(button) {
    button.classList.add('copied');
    const label = button.querySelector('span');
    if (label) label.textContent = '已复制';
    setTimeout(() => {
      button.classList.remove('copied');
      const nextLabel = button.querySelector('span');
      if (nextLabel) nextLabel.textContent = button.dataset.label || '复制';
    }, 1100);
  }

  function bindCommandButton(id, action) {
    els[id]?.addEventListener('click', () => sendCommand(action));
  }

  function bindLoadingCommandButton(id, action) {
    els[id]?.addEventListener('click', async () => {
      els[id].classList.add('loading');
      await sendCommand(action);
      setTimeout(() => els[id]?.classList.remove('loading'), 900);
    });
  }

  function bind() {
    els.closePanelBtn?.addEventListener('click', async () => {
      await sendCommand('disable');
      if (typeof bridge.closeDeveloperModePanel === 'function') await bridge.closeDeveloperModePanel();
    });
    bindCommandButton('toggleInspectBtn', 'toggle-inspect');
    bindCommandButton('includeHiddenSwitch', 'toggle-include-hidden');
    bindLoadingCommandButton('refreshBackendBtn', 'refresh-backend');
    bindCommandButton('rescanBtn', 'rescan');
    bindCommandButton('openMainDevToolsBtn', 'open-main-devtools');
    bindCommandButton('openPanelDevToolsBtn', 'open-panel-devtools');
    bindCommandButton('reloadMainBtn', 'reload-main-window');
    bindCommandButton('reloadPanelBtn', 'reload-panel-window');
    bindCommandButton('focusMainBtn', 'focus-main-window');
    bindCommandButton('updateSourceModeSwitch', 'toggle-update-source-mode');
    bindCommandButton('autoCheckUpdateSwitch', 'toggle-auto-check-update');
    bindCommandButton('autoDownloadSwitch', 'toggle-auto-download');
    bindLoadingCommandButton('runHealthCheckBtn', 'run-health-check');
    bindLoadingCommandButton('runUpdateIntegrityBtn', 'run-update-integrity');
    bindLoadingCommandButton('clearCacheBtn', 'clear-cache');

    els.copySnapshotBtn?.addEventListener('click', async () => {
      await copyText(snapshotText());
      markCopied(els.copySnapshotBtn);
    });

    els.inspectDetails?.addEventListener('click', async (event) => {
      const copyButton = event.target.closest('[data-copy-value]');
      if (!copyButton) return;
      await copyText(copyButton.dataset.copyValue || '');
      markCopied(copyButton);
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
      'copySnapshotBtn',
      'includeHiddenSwitch',
      'updateSourceModeSwitch',
      'autoCheckUpdateSwitch',
      'autoDownloadSwitch',
      'openMainDevToolsBtn',
      'openPanelDevToolsBtn',
      'reloadMainBtn',
      'reloadPanelBtn',
      'focusMainBtn',
      'clearCacheBtn',
      'runHealthCheckBtn',
      'runUpdateIntegrityBtn',
      'backendList',
      'runtimeList',
      'updateList',
      'diagnosticsList',
      'inspectCard',
      'inspectEmpty',
      'inspectDetails',
    ].forEach((id) => { els[id] = document.getElementById(id); });
    els.copySnapshotBtn?.setAttribute('data-label', '复制快照');
    bind();
    render();
    sendCommand('request-state');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

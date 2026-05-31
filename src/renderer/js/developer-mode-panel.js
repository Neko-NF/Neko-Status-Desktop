(function () {
  const IPC_EVENTS = window.__NEKO_IPC_CONTRACTS__?.IPC_EVENTS || {};
  const bridge = window.nekoIPC || {};

  const state = {
    enabled: true,
    uiInspect: false,
    includeHidden: false,
    uiuxTuning: null,
    screenshotTuning: null,
    screenshotDebug: null,
    backend: null,
    selectedInfo: null,
    diagnostics: [],
    theme: null,
  };

  const els = {};
  let renderedSelectedSelector = '';
  const uiuxSendTimers = new Map();
  const screenshotSendTimers = new Map();

  const UIUX_DEFAULTS = Object.freeze({
    radiusCard: 24,
    radiusButton: 18,
    glassOpacity: 5,
    fontScale: 100,
    textOpacity: 60,
  });

  const UIUX_CONTROLS = Object.freeze({
    radiusCard: { inputId: 'uiuxRadiusCard', valueId: 'uiuxRadiusCardValue', suffix: 'px' },
    radiusButton: { inputId: 'uiuxRadiusButton', valueId: 'uiuxRadiusButtonValue', suffix: 'px' },
    glassOpacity: { inputId: 'uiuxGlassOpacity', valueId: 'uiuxGlassOpacityValue', suffix: '%' },
    fontScale: { inputId: 'uiuxFontScale', valueId: 'uiuxFontScaleValue', suffix: '%' },
    textOpacity: { inputId: 'uiuxTextOpacity', valueId: 'uiuxTextOpacityValue', suffix: '%' },
  });

  const SCREENSHOT_DEFAULTS = Object.freeze({
    uploadFormat: 'auto',
    captureWidth: 1920,
    captureHeight: 1080,
    targetKb: 2253,
    maxKb: 4710,
    uploadLimitKb: 5120,
    jpegQuality: 88,
    minQuality: 64,
    resizeFloor: 50,
  });

  const SCREENSHOT_CONTROLS = Object.freeze({
    captureWidth: { inputId: 'screenshotCaptureWidth', valueId: 'screenshotCaptureWidthValue', suffix: 'px' },
    captureHeight: { inputId: 'screenshotCaptureHeight', valueId: 'screenshotCaptureHeightValue', suffix: 'px' },
    targetKb: { inputId: 'screenshotTargetKb', valueId: 'screenshotTargetKbValue', suffix: 'KB' },
    maxKb: { inputId: 'screenshotMaxKb', valueId: 'screenshotMaxKbValue', suffix: 'KB' },
    uploadLimitKb: { inputId: 'screenshotUploadLimitKb', valueId: 'screenshotUploadLimitKbValue', suffix: 'KB' },
    jpegQuality: { inputId: 'screenshotJpegQuality', valueId: 'screenshotJpegQualityValue', suffix: '' },
    minQuality: { inputId: 'screenshotMinQuality', valueId: 'screenshotMinQualityValue', suffix: '' },
    resizeFloor: { inputId: 'screenshotResizeFloor', valueId: 'screenshotResizeFloorValue', suffix: '%' },
  });

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

  function uiuxRows(info) {
    const uiux = info?.uiux;
    if (!uiux) return [];
    return [
      ['圆角/透明度', `${uiux.radius || '--'} / ${uiux.opacity || '--'}`],
      ['字体', `${uiux.fontSize || '--'} / ${uiux.fontWeight || '--'} / ${uiux.lineHeight || '--'}`],
      ['间距', `padding ${uiux.padding || '--'} / margin ${uiux.margin || '--'} / gap ${uiux.gap || '--'}`],
      ['色彩', `fg ${uiux.color || '--'} / bg ${uiux.background || '--'}`],
      ['布局', `${uiux.display || '--'}`],
    ];
  }

  function renderUiuxPanel(info) {
    if (!els.uiuxDetails || !els.uiuxEmpty) return;
    const rows = uiuxRows(info);
    els.uiuxDetails.hidden = rows.length === 0;
    els.uiuxEmpty.hidden = rows.length > 0;
    els.uiuxDetails.innerHTML = '';
    if (!rows.length) return;

    const title = document.createElement('div');
    title.className = 'dev-details-title';
    title.innerHTML = '<i class="ph ph-sliders-horizontal"></i><span>UIUX 样式参数</span>';
    els.uiuxDetails.appendChild(title);
    rows.forEach(([label, value]) => {
      els.uiuxDetails.appendChild(detailRow(label, value));
    });
  }

  function normalizedUiuxTuning(source = {}) {
    return Object.fromEntries(Object.entries(UIUX_DEFAULTS).map(([token, fallback]) => {
      const value = Number(source?.[token]);
      return [token, Number.isFinite(value) ? value : fallback];
    }));
  }

  function renderUiuxControls() {
    const tuning = normalizedUiuxTuning(state.uiuxTuning);
    Object.entries(UIUX_CONTROLS).forEach(([token, meta]) => {
      const input = els[meta.inputId];
      const valueEl = els[meta.valueId];
      const value = tuning[token];
      if (input && document.activeElement !== input) input.value = String(value);
      if (valueEl) valueEl.textContent = `${value}${meta.suffix}`;
    });
  }

  function queueUiuxTokenUpdate(token, value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    state.uiuxTuning = { ...normalizedUiuxTuning(state.uiuxTuning), [token]: numericValue };
    renderUiuxControls();
    clearTimeout(uiuxSendTimers.get(token));
    uiuxSendTimers.set(token, setTimeout(() => {
      uiuxSendTimers.delete(token);
      sendCommand('set-uiux-token', { token, value: numericValue });
    }, 70));
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function normalizedScreenshotTuning(source = {}) {
    const targetKb = Math.round(clampNumber(source.targetKb, 256, 8192, SCREENSHOT_DEFAULTS.targetKb));
    const maxKb = Math.round(Math.max(targetKb, clampNumber(source.maxKb, 512, 9216, SCREENSHOT_DEFAULTS.maxKb)));
    const uploadLimitKb = Math.round(Math.max(maxKb, clampNumber(source.uploadLimitKb, 512, 10240, SCREENSHOT_DEFAULTS.uploadLimitKb)));
    const uploadFormat = ['auto', 'jpeg', 'png'].includes(source.uploadFormat) ? source.uploadFormat : SCREENSHOT_DEFAULTS.uploadFormat;
    const jpegQuality = Math.round(clampNumber(source.jpegQuality, 45, 94, SCREENSHOT_DEFAULTS.jpegQuality));
    return {
      uploadFormat,
      captureWidth: Math.round(clampNumber(source.captureWidth, 800, 3840, SCREENSHOT_DEFAULTS.captureWidth)),
      captureHeight: Math.round(clampNumber(source.captureHeight, 450, 2160, SCREENSHOT_DEFAULTS.captureHeight)),
      targetKb,
      maxKb,
      uploadLimitKb,
      jpegQuality,
      minQuality: Math.min(jpegQuality, Math.round(clampNumber(source.minQuality, 45, 92, SCREENSHOT_DEFAULTS.minQuality))),
      resizeFloor: Math.round(clampNumber(source.resizeFloor, 35, 100, SCREENSHOT_DEFAULTS.resizeFloor)),
    };
  }

  function renderScreenshotControls() {
    const tuning = normalizedScreenshotTuning(state.screenshotTuning);
    const format = tuning.uploadFormat;
    [els.screenshotFormatAuto, els.screenshotFormatJpeg, els.screenshotFormatPng].forEach((button) => {
      if (!button) return;
      button.classList.toggle('active', button.dataset.screenshotFormat === format);
      button.setAttribute('aria-pressed', button.dataset.screenshotFormat === format ? 'true' : 'false');
    });
    Object.entries(SCREENSHOT_CONTROLS).forEach(([token, meta]) => {
      const input = els[meta.inputId];
      const valueEl = els[meta.valueId];
      const value = tuning[token];
      if (input && document.activeElement !== input) input.value = String(value);
      if (valueEl) valueEl.textContent = `${value}${meta.suffix}`;
      const control = input?.closest?.('[data-format-scope]');
      if (control) {
        const enabled = format !== 'png';
        control.classList.toggle('is-disabled', !enabled);
        if (input) input.disabled = !enabled;
      }
    });
  }

  function screenshotDebugRows() {
    const latest = state.screenshotDebug || state.backend?.lastResult || {};
    const compression = latest.screenshotCompression || {};
    const hasCompression = Object.keys(compression).length > 0;
    const skipped = latest.screenshotSkippedReason;
    const requestedFormat = normalizedScreenshotTuning(state.screenshotTuning).uploadFormat.toUpperCase();
    const format = (compression.format || latest.screenshotExtension || '--').toString().toUpperCase();
    const ratio = Number(compression.ratio || 0);
    const ratioText = ratio > 0 ? `${Math.round(ratio * 100)}%` : '--';
    return [
      ['最近截图', latest.hasScreenshot ? `${formatBytes(latest.screenshotSize)} · ${format}` : (skipped ? `已跳过 · ${skipped}` : '暂无'), latest.hasScreenshot ? 'ok' : skipped ? 'warn' : 'warn'],
      ['上传格式', `${requestedFormat} → ${format}`, latest.hasScreenshot || hasCompression ? 'ok' : 'warn'],
      ['压缩结果', hasCompression ? `${formatBytes(compression.originalBytes)} → ${formatBytes(compression.compressedBytes)} · ${ratioText}` : '--', hasCompression ? 'ok' : 'warn'],
      ['分辨率', hasCompression ? `${compression.width || '--'}x${compression.height || '--'} · ${Math.round((Number(compression.scale) || 1) * 100)}%` : '--', hasCompression ? 'ok' : 'warn'],
      ['质量', hasCompression ? `q${compression.quality || '--'} / min q${compression.minQuality || '--'}` : '--', hasCompression ? 'ok' : 'warn'],
      ['目标/降级', hasCompression ? `${formatBytes(compression.targetBytes)} / ${formatBytes(compression.maxBytes)}` : '--', hasCompression ? 'ok' : 'warn'],
      ['上报上限', hasCompression ? formatBytes(compression.uploadLimitBytes) : `${normalizedScreenshotTuning(state.screenshotTuning).uploadLimitKb} KB`, skipped ? 'warn' : 'ok'],
    ];
  }

  function renderScreenshotDebug() {
    renderRows(els.screenshotDebugList, screenshotDebugRows());
  }

  function queueScreenshotTokenUpdate(token, value) {
    const nextValue = token === 'uploadFormat' ? value : Number(value);
    if (token !== 'uploadFormat' && !Number.isFinite(nextValue)) return;
    state.screenshotTuning = { ...normalizedScreenshotTuning(state.screenshotTuning), [token]: nextValue };
    state.screenshotTuning = normalizedScreenshotTuning(state.screenshotTuning);
    renderScreenshotControls();
    renderScreenshotDebug();
    clearTimeout(screenshotSendTimers.get(token));
    screenshotSendTimers.set(token, setTimeout(() => {
      screenshotSendTimers.delete(token);
      sendCommand('set-screenshot-token', { token, value: state.screenshotTuning[token] });
    }, 100));
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
      ...uiuxRows(info),
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
      screenshotTuning: normalizedScreenshotTuning(state.screenshotTuning),
      screenshotDebug: state.screenshotDebug || null,
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
    renderUiuxControls();
    renderScreenshotControls();
    renderScreenshotDebug();
    renderUiuxPanel(state.selectedInfo || null);
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
    if (Object.prototype.hasOwnProperty.call(payload, 'uiuxTuning')) state.uiuxTuning = normalizedUiuxTuning(payload.uiuxTuning);
    if (Object.prototype.hasOwnProperty.call(payload, 'screenshotTuning')) state.screenshotTuning = normalizedScreenshotTuning(payload.screenshotTuning);
    if (Object.prototype.hasOwnProperty.call(payload, 'screenshotDebug')) state.screenshotDebug = payload.screenshotDebug;
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

    els.uiuxDetails?.addEventListener('click', async (event) => {
      const copyButton = event.target.closest('[data-copy-value]');
      if (!copyButton) return;
      await copyText(copyButton.dataset.copyValue || '');
      markCopied(copyButton);
    });

    Object.entries(UIUX_CONTROLS).forEach(([token, meta]) => {
      els[meta.inputId]?.addEventListener('input', (event) => {
        queueUiuxTokenUpdate(token, event.target.value);
      });
    });

    els.uiuxResetBtn?.addEventListener('click', async () => {
      state.uiuxTuning = { ...UIUX_DEFAULTS };
      renderUiuxControls();
      await sendCommand('reset-uiux-tokens');
    });

    Object.entries(SCREENSHOT_CONTROLS).forEach(([token, meta]) => {
      els[meta.inputId]?.addEventListener('input', (event) => {
        queueScreenshotTokenUpdate(token, event.target.value);
      });
    });

    [els.screenshotFormatAuto, els.screenshotFormatJpeg, els.screenshotFormatPng].forEach((button) => {
      button?.addEventListener('click', () => {
        queueScreenshotTokenUpdate('uploadFormat', button.dataset.screenshotFormat || 'auto');
      });
    });

    els.screenshotResetBtn?.addEventListener('click', async () => {
      state.screenshotTuning = { ...SCREENSHOT_DEFAULTS };
      renderScreenshotControls();
      renderScreenshotDebug();
      await sendCommand('reset-screenshot-tokens');
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
      'uiuxCard',
      'uiuxRadiusCard',
      'uiuxRadiusCardValue',
      'uiuxRadiusButton',
      'uiuxRadiusButtonValue',
      'uiuxGlassOpacity',
      'uiuxGlassOpacityValue',
      'uiuxFontScale',
      'uiuxFontScaleValue',
      'uiuxTextOpacity',
      'uiuxTextOpacityValue',
      'uiuxResetBtn',
      'uiuxEmpty',
      'uiuxDetails',
      'screenshotTuningCard',
      'screenshotDebugList',
      'screenshotFormatAuto',
      'screenshotFormatJpeg',
      'screenshotFormatPng',
      'screenshotCaptureWidth',
      'screenshotCaptureWidthValue',
      'screenshotCaptureHeight',
      'screenshotCaptureHeightValue',
      'screenshotTargetKb',
      'screenshotTargetKbValue',
      'screenshotMaxKb',
      'screenshotMaxKbValue',
      'screenshotUploadLimitKb',
      'screenshotUploadLimitKbValue',
      'screenshotJpegQuality',
      'screenshotJpegQualityValue',
      'screenshotMinQuality',
      'screenshotMinQualityValue',
      'screenshotResizeFloor',
      'screenshotResizeFloorValue',
      'screenshotResetBtn',
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

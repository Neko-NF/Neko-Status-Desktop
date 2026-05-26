(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.components = window._nekoModules.components || {};

  const CONFIG_KEYS = Object.freeze({
    MODE: 'debugEnabled',
    UI_INSPECT: 'developerUiInspectEnabled',
    INCLUDE_HIDDEN: 'developerUiInspectIncludeHidden',
  });

  const INSPECT_SELECTOR = [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'canvas',
    'img',
    'svg',
    'i[class*="ph-"]',
    'i.ph',
    '[class*="icon"]',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'label',
    'legend',
    'small',
    'strong',
    'em',
    'code',
    'kbd',
    'span',
    'li',
    'td',
    'th',
    'dt',
    'dd',
    '[role]',
    '[data-target]',
    '[data-section]',
    '[data-dev-name]',
    '[data-component]',
    '[aria-label]',
    '[title]',
    '.glass-card',
    '.metric-card',
    '.kpi-value',
    '.kpi-label',
    '.section-title',
    '.page-title',
    '.settings-title',
    '.settings-desc',
    '.action-btn',
    '.toggle-switch',
    '.modal-container',
    '.modal-overlay.show',
    '.dashboard-section',
    '.topbar',
    '.sidebar',
    '.dock-pill',
    '.color-swatch',
  ].join(',');

  const TEXT_NODE_SKIP_SELECTOR = [
    'script',
    'style',
    'noscript',
    'template',
    '#developerModeHost',
    '#developerModeHost *',
  ].join(',');

  const SOURCE_HINTS = [
    { selector: '#mainDashboardArea, #mainDashboardArea *', file: 'src/renderer/js/pages/dashboard.page.js', owner: 'DashboardPage' },
    { selector: '#consoleArea, #consoleArea *', file: 'src/renderer/js/components/developer-console.js', owner: 'DeveloperConsole' },
    { selector: '#page-device-status, #page-device-status *', file: 'src/renderer/js/pages/device-status.page.js', owner: 'DeviceStatusPage' },
    { selector: '#page-screenshot, #page-screenshot *', file: 'src/renderer/js/pages/screenshot.page.js', owner: 'ScreenshotPage' },
    { selector: '#page-stream, #page-stream *', file: 'src/renderer/js/pages/stream.page.js', owner: 'StreamPage' },
    { selector: '#page-update, #page-update *', file: 'src/renderer/js/pages/update.page.js', owner: 'UpdatePage' },
    { selector: '#page-settings, #page-settings *', file: 'src/renderer/js/pages/settings.page.js', owner: 'SettingsPage' },
    { selector: '#authModal, #authModal *', file: 'src/renderer/js/pages/auth.page.js', owner: 'AuthPage' },
    { selector: '.nav-item, .topbar, .topbar *', file: 'src/renderer/js/core/router.js + src/renderer/js/app.js', owner: 'Shell/Router' },
  ];

  function normalizeBool(value) {
    return value === true || value === 'true' || value === 1;
  }

  function safeText(value, fallback = '--') {
    const text = value == null || value === '' ? fallback : String(value);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }

  function normalizeInlineText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isInspectable(el, options = {}) {
    const includeHidden = !!options.includeHidden;
    if (!el || el.nodeType !== 1) return false;
    if (el.closest?.('#developerModeHost')) return false;
    if (!includeHidden && (el.hidden || el.getAttribute?.('aria-hidden') === 'true')) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width < 4 || rect.height < 4) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
    let current = el;
    while (current && current.nodeType === 1) {
      if (!includeHidden && (current.hidden || current.getAttribute?.('aria-hidden') === 'true')) return false;
      if (!includeHidden && current.classList?.contains('modal-overlay') && !current.classList.contains('show')) return false;
      const style = window.getComputedStyle?.(current);
      if (style) {
        if (style.display === 'none') return false;
        if (!includeHidden && (style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
        if (!includeHidden && Number(style.opacity) === 0) return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  function isVisible(el) {
    return isInspectable(el, { includeHidden: false });
  }

  function isRectInspectable(rect) {
    return !!rect
      && rect.width >= 4
      && rect.height >= 4
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth;
  }

  function selectorFor(el) {
    if (!el) return '';
    if (el.id) return `#${el.id}`;
    const tag = el.tagName?.toLowerCase?.() || 'element';
    const dataName = el.dataset?.devName || el.dataset?.component || el.dataset?.target || el.dataset?.section;
    if (dataName) {
      const key = el.dataset.devName ? 'dev-name' : el.dataset.component ? 'component' : el.dataset.target ? 'target' : 'section';
      return `${tag}[data-${key}="${dataName}"]`;
    }
    const classes = Array.from(el.classList || []).filter(Boolean).slice(0, 3);
    const base = classes.length ? `${tag}.${classes.join('.')}` : tag;
    const siblings = Array.from(el.parentElement?.children || []).filter((child) => child.tagName === el.tagName);
    if (siblings.length <= 1) return base;
    const index = siblings.indexOf(el);
    return index >= 0 ? `${base}:nth-of-type(${index + 1})` : base;
  }

  function textSelectorFor(node, parent) {
    const base = selectorFor(parent);
    if (!node || !parent) return `${base}::text`;
    const textSiblings = Array.from(parent.childNodes || []).filter((child) => child.nodeType === 3);
    const index = Math.max(0, textSiblings.indexOf(node));
    return `${base}::text(${index + 1})`;
  }

  function codeNameFor(el) {
    return (
      el.dataset?.devName ||
      el.dataset?.component ||
      el.dataset?.target ||
      el.dataset?.section ||
      el.getAttribute?.('aria-label') ||
      el.getAttribute?.('title') ||
      el.getAttribute?.('name') ||
      el.id ||
      el.classList?.[0] ||
      el.tagName?.toLowerCase?.() ||
      'element'
    );
  }

  function codeNameForText(node, parent) {
    const text = normalizeInlineText(node?.nodeValue || '');
    return text ? `text:${safeText(text, '').slice(0, 48)}` : `text:${codeNameFor(parent)}`;
  }

  function sourceFor(el) {
    const match = SOURCE_HINTS.find((hint) => {
      try { return el.matches(hint.selector); } catch { return false; }
    });
    if (match) return match;
    const page = el.closest?.('.content-safe-area');
    if (page?.id) return { owner: page.id, file: 'src/renderer/index.html + page module' };
    return { owner: 'RendererShell', file: 'src/renderer/index.html / src/renderer/js/app-ipc.js' };
  }

  function featureSummary(el) {
    const style = window.getComputedStyle?.(el) || {};
    const parts = [];
    if (style.position && style.position !== 'static') parts.push(`position=${style.position}`);
    if (style.zIndex && style.zIndex !== 'auto') parts.push(`z=${style.zIndex}`);
    if (style.transitionDuration && style.transitionDuration !== '0s') parts.push(`transition=${style.transitionDuration}`);
    if (style.animationName && style.animationName !== 'none') parts.push(`animation=${style.animationName}`);
    if (style.backdropFilter && style.backdropFilter !== 'none') parts.push('backdrop-filter');
    if (style.maskImage && style.maskImage !== 'none') parts.push('mask');
    if (style.overflow && style.overflow !== 'visible') parts.push(`overflow=${style.overflow}`);
    return parts.length ? parts.join(' | ') : 'static visual layer';
  }

  function textFeatureSummary(parent) {
    const style = window.getComputedStyle?.(parent) || {};
    const parts = ['text-node'];
    if (style.fontSize) parts.push(`font=${style.fontSize}`);
    if (style.fontWeight) parts.push(`weight=${style.fontWeight}`);
    if (style.lineHeight) parts.push(`line-height=${style.lineHeight}`);
    return parts.join(' | ');
  }

  function inspectElement(el) {
    const rect = el.getBoundingClientRect();
    const source = sourceFor(el);
    return {
      name: codeNameFor(el),
      selector: selectorFor(el),
      tag: el.tagName?.toLowerCase?.() || 'element',
      role: el.getAttribute?.('role') || el.getAttribute?.('type') || el.getAttribute?.('aria-label') || '--',
      sourceOwner: source.owner,
      sourceFile: source.file,
      size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      features: featureSummary(el),
    };
  }

  function inspectTextNode(node, parent, rect) {
    const source = sourceFor(parent);
    return {
      name: codeNameForText(node, parent),
      selector: textSelectorFor(node, parent),
      tag: '#text',
      role: 'text',
      sourceOwner: source.owner,
      sourceFile: source.file,
      size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      features: textFeatureSummary(parent),
    };
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

  function createDeveloperMode(deps = {}) {
    const state = {
      enabled: false,
      uiInspect: false,
      includeHidden: false,
      inited: false,
      scanning: false,
      boxes: [],
      inspectTargets: [],
      selectedBox: null,
      selectedInfo: null,
      lastBackendSnapshot: null,
      diagnostics: [],
    };

    const api = {
      getConfig: deps.getConfig || (async () => undefined),
      setConfig: deps.setConfig || (async () => true),
      getBackendSnapshot: deps.getBackendSnapshot || (async () => ({})),
      addLogLine: deps.addLogLine || (() => {}),
      notify: deps.notify || (() => {}),
      openPanel: deps.openPanel || (async () => {}),
      closePanel: deps.closePanel || (async () => {}),
      updatePanel: deps.updatePanel || (async () => {}),
      onPanelCommand: deps.onPanelCommand || (() => () => {}),
      runHealthCheck: deps.runHealthCheck || (async () => []),
      runUpdateIntegrity: deps.runUpdateIntegrity || (async () => []),
      clearCache: deps.clearCache || (async () => ({})),
    };

    let host;
    let dock;
    let overlay;
    let tooltip;
    let backendList;
    let inspectDetails;
    let scanRaf = 0;
    let themeSyncRaf = 0;

    function ensureHost() {
      if (host) return host;
      host = document.getElementById('developerModeHost') || document.createElement('div');
      host.id = 'developerModeHost';
      host.className = 'developer-mode-host';
      host.replaceChildren();

      overlay = document.createElement('div');
      overlay.className = 'developer-mode-overlay';

      tooltip = document.createElement('div');
      tooltip.className = 'developer-mode-tooltip';
      tooltip.hidden = true;

      dock = document.createElement('section');
      dock.className = 'developer-mode-dock';
      dock.hidden = true;

      host.append(overlay, tooltip);
      document.body.appendChild(host);

      return host;
    }

    function getPanelTheme() {
      const bodyStyles = getComputedStyle(document.body);
      const rootStyles = getComputedStyle(document.documentElement);
      const readVar = (name) => bodyStyles.getPropertyValue(name).trim() || rootStyles.getPropertyValue(name).trim();
      const cssVars = {};
      [
        '--theme-color',
        '--accent-cyan',
        '--success-mint',
        '--warning-amber',
        '--error-coral',
        '--text-main',
        '--text-secondary',
        '--text-muted',
        '--dropdown-bg',
        '--dock-blur',
        '--shadow-lg',
        '--fw-medium',
        '--fw-semibold',
      ].forEach((name) => {
        const value = readVar(name);
        if (value) cssVars[name] = value;
      });
      const uiFont = document.documentElement.style.getPropertyValue('--ui-font').trim();
      if (uiFont) cssVars['--ui-font'] = uiFont;
      return {
        mode: document.documentElement.getAttribute('data-theme') || '',
        cssVars,
      };
    }

    function sendPanelState() {
      if (!state.enabled) return;
      api.updatePanel({
        enabled: state.enabled,
        uiInspect: state.uiInspect,
        includeHidden: state.includeHidden,
        backend: state.lastBackendSnapshot,
        selectedInfo: state.selectedInfo,
        diagnostics: state.diagnostics,
        theme: getPanelTheme(),
      });
    }

    function summarizeResult(result) {
      if (Array.isArray(result)) {
        const failed = result.filter((item) => item && item.ok === false).length;
        return `${result.length} 项，${failed} 项异常`;
      }
      if (result && typeof result === 'object') {
        if (result.message) return String(result.message);
        if (result.path) return String(result.path);
        if (Object.prototype.hasOwnProperty.call(result, 'ok')) return result.ok ? '通过' : '异常';
        if (Object.prototype.hasOwnProperty.call(result, 'success')) return result.success ? '完成' : '失败';
      }
      return result == null ? '完成' : safeText(result);
    }

    function pushDiagnostic(title, status, detail) {
      state.diagnostics = [{
        title,
        status,
        detail: safeText(detail, '完成'),
        at: new Date().toISOString(),
      }, ...state.diagnostics].slice(0, 8);
      sendPanelState();
    }

    async function toggleConfigSwitch(key, nextValue, title, detail) {
      await api.setConfig(key, nextValue);
      pushDiagnostic(title, 'ok', detail(nextValue));
      await refreshBackend(false);
    }

    function schedulePanelThemeSync() {
      if (themeSyncRaf) return;
      themeSyncRaf = window.requestAnimationFrame(() => {
        themeSyncRaf = 0;
        sendPanelState();
      });
    }

    async function handlePanelCommand(payload = {}) {
      const action = payload.action;
      if (action === 'disable' || action === 'panel-closed') {
        if (state.enabled) await setEnabled(false);
        return;
      }
      if (action === 'request-state') {
        sendPanelState();
        return;
      }
      if (action === 'toggle-inspect') {
        await setUiInspect(!state.uiInspect);
        return;
      }
      if (action === 'toggle-include-hidden') {
        await setIncludeHidden(!state.includeHidden);
        return;
      }
      if (action === 'refresh-backend') {
        await refreshBackend(true);
        return;
      }
      if (action === 'rescan') {
        requestScan();
        api.addLogLine('INFO', '开发者模式已重新扫描 UIUX 辅助线');
        pushDiagnostic('UIUX 辅助线', 'ok', '已重新扫描当前界面');
        return;
      }
      if (action === 'toggle-update-source-mode') {
        const current = state.lastBackendSnapshot?.update?.sourceMode === 'smart' ? 'smart' : 'selected';
        await toggleConfigSwitch(
          'updateSourceMode',
          current === 'smart' ? 'selected' : 'smart',
          '更新源模式',
          (next) => (next === 'smart' ? '已切换为智能探测' : '已切换为手动选择'),
        );
        return;
      }
      if (action === 'toggle-auto-check-update') {
        const current = state.lastBackendSnapshot?.update?.autoCheck !== false;
        await toggleConfigSwitch('autoCheckUpdate', !current, '自动检查更新', (next) => (next ? '已开启' : '已关闭'));
        return;
      }
      if (action === 'toggle-auto-download') {
        const current = state.lastBackendSnapshot?.update?.autoDownload === true;
        await toggleConfigSwitch('autoDownload', !current, '自动下载更新', (next) => (next ? '已开启' : '已关闭'));
        return;
      }
      if (action === 'run-health-check') {
        try {
          const result = await api.runHealthCheck();
          const summary = summarizeResult(result);
          pushDiagnostic('服务体检', Array.isArray(result) && result.some((item) => item?.ok === false) ? 'warn' : 'ok', summary);
          api.addLogLine('INFO', `开发者模式服务体检完成: ${summary}`);
          await refreshBackend(false);
        } catch (error) {
          pushDiagnostic('服务体检', 'error', error.message);
          api.addLogLine('ERROR', `开发者模式服务体检失败: ${error.message}`);
        }
        return;
      }
      if (action === 'run-update-integrity') {
        try {
          const result = await api.runUpdateIntegrity();
          const summary = summarizeResult(result);
          pushDiagnostic('更新完整性', Array.isArray(result) && result.some((item) => item?.ok === false) ? 'warn' : 'ok', summary);
          api.addLogLine('INFO', `开发者模式更新完整性检查完成: ${summary}`);
          await refreshBackend(false);
        } catch (error) {
          pushDiagnostic('更新完整性', 'error', error.message);
          api.addLogLine('ERROR', `开发者模式更新完整性检查失败: ${error.message}`);
        }
        return;
      }
      if (action === 'clear-cache') {
        try {
          const result = await api.clearCache();
          const summary = summarizeResult(result);
          pushDiagnostic('缓存清理', 'ok', summary);
          api.addLogLine('INFO', `开发者模式缓存清理完成: ${summary}`);
          await refreshBackend(false);
        } catch (error) {
          pushDiagnostic('缓存清理', 'error', error.message);
          api.addLogLine('ERROR', `开发者模式缓存清理失败: ${error.message}`);
        }
      }
    }

    function setToggle(id, on, disabled = false) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('on', !!on);
      el.classList.toggle('disabled', !!disabled);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }

    function renderSettingsGate() {
      const row = document.getElementById('stgDeveloperUiInspectRow');
      const desc = document.getElementById('stgDeveloperUiInspectDesc');
      if (row) {
        row.hidden = !state.enabled;
        row.classList.toggle('is-disabled', !state.enabled);
      }
      if (desc) {
        desc.textContent = state.enabled
          ? '框选页面元素，点击方框可锁定信息并复制定位字段。'
          : '需要先开启开发者模式，才可框选页面元素并查看定位信息。';
      }
    }

    function render() {
      ensureHost();
      host.classList.toggle('is-enabled', state.enabled);
      host.classList.toggle('is-inspecting', state.enabled && state.uiInspect);
      document.body.classList.toggle('developer-ui-inspect-enabled', state.enabled && state.uiInspect);
      setToggle('toggleDeveloperMode', state.enabled);
      setToggle('toggleDeveloperUiInspect', state.enabled && state.uiInspect, !state.enabled);
      setToggle('stgDeveloperModeSwitch', state.enabled);
      setToggle('stgDeveloperUiInspectSwitch', state.enabled && state.uiInspect, !state.enabled);
      renderSettingsGate();

      if (state.enabled && state.uiInspect) {
        requestScan();
        window.setTimeout(requestScan, 180);
      }
      else clearBoxes();
      sendPanelState();
    }

    function clearBoxes() {
      state.boxes.forEach((box) => box.remove());
      state.boxes = [];
      state.inspectTargets = [];
      state.selectedBox = null;
      state.selectedInfo = null;
      if (tooltip) tooltip.hidden = true;
      renderInspectDetails(null);
    }

    function renderBackendSnapshot(snapshot) {
      state.lastBackendSnapshot = snapshot || {};
      sendPanelState();
      if (!backendList) return;
      const items = [
        ['IPC 桥接', snapshot.ipcReady ? '就绪' : '缺失', snapshot.ipcReady ? 'ok' : 'error'],
        ['运行时', snapshot.version || '--', snapshot.version ? 'ok' : 'warn'],
        ['上报服务', snapshot.serviceRunning ? '运行中' : '已停止', snapshot.serviceRunning ? 'ok' : 'warn'],
        ['主进程', snapshot.processInfo ? `PID ${snapshot.processInfo.pid}` : '--', snapshot.processInfo ? 'ok' : 'warn'],
        ['性能指标', snapshot.metrics ? `CPU ${safeText(snapshot.metrics.cpuPct)} / MEM ${safeText(snapshot.metrics.memPct)}` : '--', snapshot.metrics ? 'ok' : 'warn'],
        ['API 探测', snapshot.api ? safeText(snapshot.api.ok === false ? snapshot.api.error : snapshot.api.latencyMs ? `${snapshot.api.latencyMs}ms` : 'OK') : '未测试', snapshot.api?.ok === false ? 'error' : snapshot.api ? 'ok' : 'warn'],
      ];

      backendList.replaceChildren(...items.map(([label, value, stateName]) => {
        const row = document.createElement('div');
        row.className = `developer-mode-backend-row ${stateName}`;
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        const valueEl = document.createElement('strong');
        valueEl.textContent = value;
        row.append(labelEl, valueEl);
        return row;
      }));
    }

    async function refreshBackend(includeNetwork = false, button) {
      ensureHost();
      button?.classList.add('loading');
      renderBackendSnapshot({ ...state.lastBackendSnapshot, version: '刷新中...' });
      try {
        const snapshot = await api.getBackendSnapshot({ includeNetwork });
        renderBackendSnapshot(snapshot || {});
        api.addLogLine('INFO', `开发者模式后端状态已刷新${includeNetwork ? '（包含 API 探测）' : ''}`);
      } catch (error) {
        renderBackendSnapshot({ ipcReady: false, version: '错误', api: { ok: false, error: error.message } });
        api.addLogLine('ERROR', `开发者模式后端状态刷新失败: ${error.message}`);
      } finally {
        button?.classList.remove('loading');
      }
    }

    function placeTooltip(info, x, y) {
      if (!tooltip || state.selectedInfo) return;
      tooltip.hidden = false;
      tooltip.innerHTML = '';
      [
        ['名称', info.name],
        ['选择器', info.selector],
        ['角色', info.role],
        ['来源', `${info.sourceOwner} -> ${info.sourceFile}`],
        ['尺寸', info.size],
        ['层级', info.features],
      ].forEach(([label, value]) => {
        const row = document.createElement('div');
        const key = document.createElement('span');
        const val = document.createElement('strong');
        key.textContent = label;
        val.textContent = safeText(value);
        row.append(key, val);
        tooltip.appendChild(row);
      });
      const maxLeft = Math.max(12, window.innerWidth - 360);
      const left = Math.min(maxLeft, Math.max(12, x + 14));
      const top = Math.min(window.innerHeight - 180, Math.max(12, y + 14));
      tooltip.style.transform = `translate(${left}px, ${top}px)`;
    }

    function renderInspectDetails(info) {
      sendPanelState();
      if (!inspectDetails) return;
      inspectDetails.hidden = !info;
      inspectDetails.innerHTML = '';
      if (!info) return;

      const title = document.createElement('div');
      title.className = 'developer-mode-details-title';
      title.innerHTML = '<i class="ph ph-cursor-click"></i><span>已选中元素</span>';
      inspectDetails.appendChild(title);

      [
        ['代码特征', info.name],
        ['选择器', info.selector],
        ['实现位置', `${info.sourceOwner} -> ${info.sourceFile}`],
        ['角色/类型', info.role],
        ['尺寸', info.size],
        ['CSS 层级', info.features],
      ].forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'developer-mode-detail-row';
        const text = document.createElement('div');
        text.className = 'developer-mode-detail-copy';
        const key = document.createElement('span');
        key.textContent = label;
        const val = document.createElement('strong');
        val.textContent = safeText(value);
        text.append(key, val);
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'developer-mode-copy-btn';
        copy.dataset.copyValue = String(value || '');
        copy.innerHTML = '<i class="ph ph-copy"></i><span>复制</span>';
        row.append(text, copy);
        inspectDetails.appendChild(row);
      });
    }

    function selectElement(box, info) {
      state.selectedBox?.classList.remove('selected');
      state.selectedBox = box;
      state.selectedInfo = info;
      box?.classList.add('selected');
      if (tooltip) tooltip.hidden = true;
      renderInspectDetails(info);
      api.addLogLine('INFO', `已选中 UI 元素: ${info.selector} (${info.sourceFile})`);
    }

    function findTopInspectableAtPoint(x, y) {
      if (state.includeHidden || typeof document.elementsFromPoint !== 'function') return null;
      const previousDisplay = host?.style.display || '';
      if (host) host.style.display = 'none';
      let stack = [];
      try {
        stack = document.elementsFromPoint(x, y) || [];
      } finally {
        if (host) host.style.display = previousDisplay;
      }
      for (const el of stack) {
        if (!el || el.closest?.('#developerModeHost')) continue;
        const target = el.matches?.(INSPECT_SELECTOR) ? el : el.closest?.(INSPECT_SELECTOR);
        if (!target || target.closest?.('#developerModeHost')) continue;
        try {
          if (isInspectable(target, { includeHidden: false })) return target;
        } catch {
          // Ignore elements that cannot be inspected in the current DOM state.
        }
      }
      return null;
    }

    function targetElement(target) {
      return target?.el || target;
    }

    function targetRect(target) {
      if (target?.kind === 'text') return target.rect;
      return targetElement(target)?.getBoundingClientRect?.();
    }

    function targetSelector(target) {
      return target?.kind === 'text'
        ? textSelectorFor(target.node, target.el)
        : selectorFor(targetElement(target));
    }

    function inspectTarget(target) {
      if (target?.kind === 'text') return inspectTextNode(target.node, target.el, target.rect);
      return inspectElement(targetElement(target));
    }

    function collectElementTargets() {
      return Array.from(document.querySelectorAll(INSPECT_SELECTOR))
        .filter((el) => isInspectable(el, { includeHidden: state.includeHidden }))
        .map((el) => ({ kind: 'element', el }));
    }

    function collectTextNodeTargets() {
      const nodeFilter = window.NodeFilter || (typeof NodeFilter !== 'undefined' ? NodeFilter : null);
      const RangeCtor = window.Range || (typeof Range !== 'undefined' ? Range : null);
      if (typeof document.createTreeWalker !== 'function' || !nodeFilter || !RangeCtor) return [];
      const targets = [];
      const acceptNode = (node) => {
        const text = normalizeInlineText(node.nodeValue || '');
        if (text.length < 2) return nodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest?.(TEXT_NODE_SKIP_SELECTOR)) return nodeFilter.FILTER_REJECT;
        if (!isInspectable(parent, { includeHidden: state.includeHidden })) return nodeFilter.FILTER_REJECT;
        return nodeFilter.FILTER_ACCEPT;
      };
      const walker = document.createTreeWalker(document.body, nodeFilter.SHOW_TEXT, { acceptNode });
      let node = walker.nextNode();
      while (node && targets.length < 180) {
        const parent = node.parentElement;
        const range = document.createRange();
        try {
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (isRectInspectable(rect)) {
            targets.push({ kind: 'text', node, el: parent, rect });
          }
        } catch {
          // Skip text nodes whose layout range cannot be measured.
        } finally {
          range.detach?.();
        }
        node = walker.nextNode();
      }
      return targets;
    }

    function collectInspectTargets() {
      const seen = new Set();
      const targets = [...collectElementTargets(), ...collectTextNodeTargets()];
      return targets.filter((target) => {
        const selector = targetSelector(target);
        if (!selector || seen.has(selector)) return false;
        seen.add(selector);
        return true;
      }).slice(0, 420);
    }

    function selectAtPoint(fallbackBox, fallbackInfo, x, y) {
      if (fallbackInfo?.role === 'text') {
        selectElement(fallbackBox, fallbackInfo);
        return;
      }
      const topElement = findTopInspectableAtPoint(x, y);
      if (!topElement) {
        selectElement(fallbackBox, fallbackInfo);
        return;
      }
      const selector = selectorFor(topElement);
      const target = state.inspectTargets.find((item) => item.el === topElement || item.info.selector === selector);
      selectElement(target?.box || fallbackBox, target?.info || inspectElement(topElement));
    }

    function drawBox(target, index) {
      const rect = targetRect(target);
      const info = inspectTarget(target);
      const box = document.createElement('button');
      box.type = 'button';
      box.className = `developer-mode-box developer-mode-box-${target.kind || 'element'}`;
      box.dataset.devName = info.name;
      box.dataset.devSelector = info.selector;
      box.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
      box.style.width = `${Math.round(rect.width)}px`;
      box.style.height = `${Math.round(rect.height)}px`;
      box.style.setProperty('--dev-box-index', index);
      box.setAttribute('aria-label', `检查 ${info.name}`);
      box.addEventListener('mouseenter', (event) => placeTooltip(info, event.clientX, event.clientY));
      box.addEventListener('mousemove', (event) => placeTooltip(info, event.clientX, event.clientY));
      box.addEventListener('mouseleave', () => { if (tooltip && !state.selectedInfo) tooltip.hidden = true; });
      box.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectAtPoint(box, info, event.clientX, event.clientY);
      });
      overlay.appendChild(box);
      state.boxes.push(box);
      state.inspectTargets.push({ ...target, box, info });
    }

    function scan() {
      scanRaf = 0;
      if (!state.enabled || !state.uiInspect || state.scanning) return;
      state.scanning = true;
      const previousSelector = state.selectedInfo?.selector;
      state.boxes.forEach((box) => box.remove());
      state.boxes = [];
      state.inspectTargets = [];
      state.selectedBox = null;
      state.selectedInfo = null;
      renderInspectDetails(null);
      const targets = collectInspectTargets();
      targets.forEach(drawBox);
      if (previousSelector) {
        const found = state.boxes.find((box) => box.dataset.devSelector === previousSelector);
        if (found) {
          const target = targets.find((item) => targetSelector(item) === previousSelector);
          if (target) selectElement(found, inspectTarget(target));
        }
      }
      state.scanning = false;
    }

    function requestScan() {
      ensureHost();
      if (scanRaf) return;
      scanRaf = window.requestAnimationFrame(scan);
    }

    async function setEnabled(next, options = {}) {
      state.enabled = !!next;
      if (!state.enabled) state.uiInspect = false;
      render();
      if (state.enabled) await api.openPanel();
      else await api.closePanel();
      if (!options.silent) {
        await api.setConfig(CONFIG_KEYS.MODE, state.enabled);
        await api.setConfig(CONFIG_KEYS.UI_INSPECT, state.uiInspect);
        api.addLogLine(state.enabled ? 'SUCCESS' : 'INFO', `开发者模式${state.enabled ? '已开启' : '已关闭'}`);
      }
      if (state.enabled) {
        sendPanelState();
        refreshBackend(false);
      }
    }

    async function setUiInspect(next, options = {}) {
      if (next && !state.enabled) {
        state.uiInspect = false;
        render();
        await api.setConfig(CONFIG_KEYS.UI_INSPECT, false);
        api.notify('请先开启开发者模式，再打开 UIUX 辅助线', 'warn', 2400);
        api.addLogLine('WARN', 'UIUX 辅助线被开发者模式门控拦截');
        return;
      }

      state.uiInspect = !!next;
      render();
      if (!options.silent) {
        await api.setConfig(CONFIG_KEYS.UI_INSPECT, state.uiInspect);
        api.addLogLine(state.uiInspect ? 'SUCCESS' : 'INFO', `UIUX 辅助线${state.uiInspect ? '已开启' : '已关闭'}`);
      }
      sendPanelState();
    }

    async function setIncludeHidden(next, options = {}) {
      state.includeHidden = !!next;
      requestScan();
      sendPanelState();
      if (!options.silent) {
        await api.setConfig(CONFIG_KEYS.INCLUDE_HIDDEN, state.includeHidden);
        api.addLogLine(state.includeHidden ? 'INFO' : 'INFO', `UIUX 辅助线${state.includeHidden ? '已包含隐藏层' : '仅扫描可见层'}`);
      }
    }

    function bindToggle(id, handler) {
      const el = document.getElementById(id);
      if (!el || el.dataset.developerModeBound === '1') return;
      el.dataset.developerModeBound = '1';
      el.addEventListener('click', handler);
      el.setAttribute('role', 'switch');
    }

    function bindControls() {
      bindToggle('toggleDeveloperMode', () => setEnabled(!state.enabled));
      bindToggle('toggleDeveloperUiInspect', () => setUiInspect(!state.uiInspect));
      bindToggle('stgDeveloperModeSwitch', () => setEnabled(!state.enabled));
      bindToggle('stgDeveloperUiInspectSwitch', () => setUiInspect(!state.uiInspect));
      api.onPanelCommand(handlePanelCommand);
      const themeObserver = new MutationObserver(schedulePanelThemeSync);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
      window.addEventListener('resize', requestScan);
      document.addEventListener('scroll', requestScan, true);
      document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
          event.preventDefault();
          setEnabled(!state.enabled);
        }
      });
    }

    async function init() {
      if (state.inited) return apiPublic;
      state.inited = true;
      ensureHost();
      bindControls();
      try {
        const [mode, inspect, includeHidden] = await Promise.all([
          api.getConfig(CONFIG_KEYS.MODE),
          api.getConfig(CONFIG_KEYS.UI_INSPECT),
          api.getConfig(CONFIG_KEYS.INCLUDE_HIDDEN),
        ]);
        state.enabled = normalizeBool(mode);
        state.uiInspect = state.enabled && normalizeBool(inspect);
        state.includeHidden = normalizeBool(includeHidden);
        if (!state.enabled && normalizeBool(inspect)) await api.setConfig(CONFIG_KEYS.UI_INSPECT, false);
      } catch {
        state.enabled = false;
        state.uiInspect = false;
      }
      render();
      if (state.enabled) {
        await api.openPanel();
        sendPanelState();
        refreshBackend(false);
      }
      return apiPublic;
    }

    const apiPublic = {
      init,
      setEnabled,
      setUiInspect,
      setIncludeHidden,
      refreshBackend,
      requestScan,
      inspectElement,
      inspectTextNode,
      getState: () => ({ enabled: state.enabled, uiInspect: state.uiInspect, includeHidden: state.includeHidden, boxes: state.boxes.length }),
      CONFIG_KEYS,
    };

    return apiPublic;
  }

  window._nekoModules.components.DeveloperMode = {
    create: createDeveloperMode,
    inspectElement,
    inspectTextNode,
    CONFIG_KEYS,
  };
})();

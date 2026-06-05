(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const SPARK_MAX = 30;
  const DIAG_MAX = 20;
  const DASH_EVENT_MAX = 20;

  const state = {
    initialized: false,
    sparkData: { cpu: [], mem: [], net: [], battery: [] },
    sparkCharts: {},
    diagEntries: [],
    lastMemWarn: 0,
    lastCpuWarn: 0,
    deps: {
      notify: async () => {},
      addLogLine: () => {},
      showNotice: () => {},
      config: null,
      service: null,
      escapeHtml: (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n.toFixed(0)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatBps(bps) {
    return `${formatBytes(bps)}/s`;
  }

  function clampNumber(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function getNetworkLevel(latency) {
    if (latency == null || latency < 0) return { level: 'warn', text: '检测中' };
    if (latency < 80) return { level: 'ok', text: '优秀' };
    if (latency < 180) return { level: 'warn', text: '一般' };
    return { level: 'error', text: '拥堵' };
  }

  function getNetworkTrendValue(metrics) {
    if (!metrics) return 0;
    const latencyScore = 100 - clampNumber(metrics.networkLatency, 0, 300) / 3;
    const trafficBps = Math.max(0, Number(metrics.netDownBps || 0) + Number(metrics.netUpBps || 0));
    const trafficBoost = trafficBps > 0 ? Math.min(18, Math.log10(trafficBps + 1) * 2.4) : 0;
    return clampNumber(latencyScore + trafficBoost, 0, 100);
  }

  function getBatteryLevelInfo(level, isCharging, hasBattery, powerInfo = {}) {
    const isDesktopPower = hasBattery === false || powerInfo.deviceType === 'desktop';
    if (isDesktopPower) return { text: '桌面供电', icon: 'ph-plug-charging', level: 'ok', footer: '台式机 / 外接电源 · 无电池读数' };
    if (isCharging) return { text: '交流电', icon: 'ph-plug-charging', level: 'ok', footer: '笔记本 · 交流电已连接' };
    if (level <= 20) return { text: '低电量', icon: 'ph-battery-low', level: 'error', footer: '笔记本 · 使用电池供电' };
    if (level <= 50) return { text: '电池', icon: 'ph-battery-medium', level: 'warn', footer: '笔记本 · 使用电池供电' };
    return { text: '电池', icon: 'ph-battery-full', level: 'ok', footer: '笔记本 · 使用电池供电' };
  }

  function getSparklineThemeColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() || 'rgb(99,102,241)';
  }

  function sparklineFillColor(color, alpha = 0.12) {
    const probe = document.createElement('span');
    probe.style.color = color;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const nums = resolved.match(/\d+(\.\d+)?/g) || [];
    const [r, g, b] = nums.map(Number);
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
      ? `rgba(${r}, ${g}, ${b}, ${alpha})`
      : `rgba(99, 102, 241, ${alpha})`;
  }

  function applySparklineTheme() {
    const themeColor = getSparklineThemeColor();
    Object.values(state.sparkCharts).forEach((chart) => {
      if (!chart) return;
      chart.data.datasets[0].borderColor = themeColor;
      chart.data.datasets[0].backgroundColor = sparklineFillColor(themeColor);
      chart.update('none');
    });
  }

  function createSparkline(canvasId) {
    const canvas = $(canvasId);
    if (!canvas || typeof Chart !== 'function') return null;
    const themeColor = getSparklineThemeColor();
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: Array(SPARK_MAX).fill(''),
        datasets: [{
          data: [],
          borderColor: themeColor,
          backgroundColor: sparklineFillColor(themeColor),
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, min: 0, max: 100 },
        },
        animation: { duration: 300 },
        elements: { line: { borderCapStyle: 'round' } },
      },
    });
  }

  function initSparklines() {
    if (state.sparkCharts.cpu) return;
    state.sparkCharts.cpu = createSparkline('sparkCpu');
    state.sparkCharts.mem = createSparkline('sparkMem');
    state.sparkCharts.net = createSparkline('sparkNet');
    state.sparkCharts.battery = createSparkline('sparkBattery');
    applySparklineTheme();
  }

  function setSparklineData(key, value) {
    initSparklines();
    if (value != null) state.sparkData[key].push(clampNumber(value, 0, 100));
    if (state.sparkData[key].length > SPARK_MAX) state.sparkData[key].shift();
    const chart = state.sparkCharts[key];
    if (!chart) return;
    chart.data.labels = state.sparkData[key].map(() => '');
    chart.data.datasets[0].data = [...state.sparkData[key]];
    chart.update('none');
  }

  function updateBatterySparkline(level) {
    if (level == null) return;
    initSparklines();
    const value = clampNumber(level, 0, 100);
    if (state.sparkData.battery.length === 0) {
      state.sparkData.battery = Array(SPARK_MAX).fill(value);
      const chart = state.sparkCharts.battery;
      if (!chart) return;
      chart.data.labels = state.sparkData.battery.map(() => '');
      chart.data.datasets[0].data = [...state.sparkData.battery];
      chart.update('none');
      return;
    }
    setSparklineData('battery', value);
  }

  function syncBatterySparklineFromCard() {
    if (state.sparkData.battery.length > 0) return;
    const valueEl = document.querySelector('#sparkBattery')?.closest('.kpi-card')?.querySelector('.kpi-value');
    const value = parseFloat(valueEl?.textContent || '');
    updateBatterySparkline(Number.isFinite(value) ? value : 100);
  }

  function updateSparklines(metrics) {
    setSparklineData('cpu', metrics.cpuPct);
    setSparklineData('mem', metrics.memPct);
    setSparklineData('net', getNetworkTrendValue(metrics));
  }

  function updatePowerKpi(level, isCharging, hasBattery, footerText, powerInfo = {}) {
    const kpiCards = document.querySelectorAll('#page-device-status .kpi-card');
    const card = kpiCards[3];
    if (!card) return;

    const isDesktopPower = hasBattery === false || powerInfo.deviceType === 'desktop';
    const displayLevel = isDesktopPower ? 100 : clampNumber(level, 0, 100);
    const batValue = card.querySelector('.kpi-value');
    const batBadge = card.querySelector('.kpi-badge');
    const batFooter = card.querySelector('.kpi-footer');
    const info = getBatteryLevelInfo(displayLevel, isCharging, hasBattery, powerInfo);

    if (batValue) batValue.textContent = isDesktopPower ? 'AC' : `${displayLevel.toFixed(0)}%`;
    if (batBadge) {
      batBadge.className = `kpi-badge ${info.level}`;
      batBadge.innerHTML = `<i class="ph ${info.icon}"></i> ${info.text}`;
    }
    if (batFooter) batFooter.textContent = footerText || info.footer;
    updateBatterySparkline(displayLevel);
  }

  function updateMetrics(metrics = {}) {
    const kpiCards = document.querySelectorAll('#page-device-status .kpi-card');
    if (!kpiCards || kpiCards.length < 4) {
      updateSparklines(metrics);
      checkMetricThresholds(metrics);
      return;
    }

    const cpuValue = kpiCards[0].querySelector('.kpi-value');
    const cpuBadge = kpiCards[0].querySelector('.kpi-badge');
    if (cpuValue && metrics.cpuPct != null) cpuValue.textContent = `${Number(metrics.cpuPct).toFixed(1)}%`;
    if (cpuBadge && metrics.cpuPct != null) {
      const level = metrics.cpuPct > 90 ? 'error' : metrics.cpuPct > 70 ? 'warn' : 'info';
      const text = metrics.cpuPct > 90 ? '过高' : metrics.cpuPct > 70 ? '偏高' : '正常';
      cpuBadge.className = `kpi-badge ${level}`;
      cpuBadge.textContent = text;
    }

    const cpuFooter = kpiCards[0].querySelector('.kpi-footer');
    if (cpuFooter && metrics.cpuModel) cpuFooter.textContent = metrics.cpuModel;

    const memValue = kpiCards[1].querySelector('.kpi-value');
    const memBadge = kpiCards[1].querySelector('.kpi-badge');
    if (memValue && metrics.memPct != null) memValue.textContent = `${Number(metrics.memPct).toFixed(1)}%`;
    if (memBadge && metrics.memPct != null) {
      const level = metrics.memPct > 90 ? 'error' : metrics.memPct > 80 ? 'warn' : 'info';
      const text = metrics.memPct > 90 ? '危险' : metrics.memPct > 80 ? '警告' : '正常';
      memBadge.className = `kpi-badge ${level}`;
      memBadge.textContent = text;
    }

    const memFooter = kpiCards[1].querySelector('.kpi-footer');
    if (memFooter && metrics.memUsed != null && metrics.memTotal != null) {
      memFooter.textContent = `${formatBytes(metrics.memUsed)} / ${formatBytes(metrics.memTotal)}`;
    }

    const netValue = kpiCards[2].querySelector('.kpi-value') || kpiCards[2].querySelector('.kpi-value-sm');
    const netBadge = kpiCards[2].querySelector('.kpi-badge');
    if (netValue && metrics.networkLatency != null) {
      const latency = metrics.networkLatency;
      netValue.textContent = latency >= 0 ? `${Math.round(latency)} ms` : '--';
    }
    if (netBadge) {
      const netState = getNetworkLevel(metrics.networkLatency);
      netBadge.className = `kpi-badge ${netState.level}`;
      netBadge.textContent = netState.text;
    }

    const netSpeedFooter = $('netSpeedFooter');
    if (netSpeedFooter && (metrics.netDownBps != null || metrics.netUpBps != null)) {
      const down = formatBps(metrics.netDownBps || 0);
      const up = formatBps(metrics.netUpBps || 0);
      netSpeedFooter.innerHTML = `<i class="ph ph-arrow-down"></i> ${down} &nbsp;&nbsp; <i class="ph ph-arrow-up"></i> ${up}`;
    }

    if (metrics.uptime) {
      const hr = Math.floor(metrics.uptime / 3600);
      const min = Math.floor((metrics.uptime % 3600) / 60);
      const batFooter = kpiCards[3].querySelector('.kpi-footer');
      if (batFooter && !batFooter.textContent.includes('供电') && !batFooter.textContent.includes('电池')) {
        batFooter.textContent = `系统运行: ${hr}h ${min}m`;
      }
    }

    const metaOSEl = $('metaOS');
    if (metaOSEl && metrics.osFriendlyName) metaOSEl.textContent = `${metrics.osFriendlyName} (${metrics.arch})`;
    else if (metaOSEl && metrics.osRelease) metaOSEl.textContent = `Windows ${metrics.osRelease} (${metrics.arch})`;

    updateSparklines(metrics);
    checkMetricThresholds(metrics);
  }

  function formatDiagTime(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function pushDashboardEvent(status, text) {
    const list = $('dashEventList');
    if (!list) return;
    const emptyHint = list.querySelector('.event-empty-hint');
    if (emptyHint) emptyHint.remove();

    const dotClass = status === 'success' ? 'info' : status === 'warn' ? 'warn' : 'error';
    const timeStr = new Date().toTimeString().slice(0, 5);
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `<span class="event-time">${timeStr}</span><div class="event-dot ${dotClass}"></div><span class="event-desc">${state.deps.escapeHtml(text)}</span>`;
    list.insertBefore(item, list.firstChild);
    while (list.children.length > DASH_EVENT_MAX) list.removeChild(list.lastChild);
  }

  function applyHistoryFilter() {
    const activeBtn = document.querySelector('#historyFilterGroup .filter-segmented-btn.active');
    const filter = activeBtn ? activeBtn.dataset.filter : 'all';
    document.querySelectorAll('#historyTableBody tr').forEach((row) => {
      row.style.display = (filter === 'all' || row.dataset.status === filter) ? '' : 'none';
    });
  }

  function renderDiagTable() {
    const tbody = $('historyTableBody');
    if (!tbody) return;
    tbody.innerHTML = state.diagEntries.map((entry) => `
      <tr data-status="${entry.status}">
        <td>${formatDiagTime(entry.time)}</td>
        <td>${state.deps.escapeHtml(entry.module)}</td>
        <td><span class="status-badge ${entry.status}">${entry.status === 'success' ? '正常' : entry.status === 'warn' ? '警告' : '错误'}</span></td>
        <td>${state.deps.escapeHtml(entry.detail)}</td>
        <td class="col-action">${entry.actionHtml}</td>
      </tr>`).join('');
    applyHistoryFilter();
  }

  function addDiagnosticEntry(module, status, detail, actionHtml) {
    const entry = { time: Date.now(), module, status, detail, actionHtml: actionHtml || '-' };
    state.diagEntries.unshift(entry);
    if (state.diagEntries.length > DIAG_MAX) state.diagEntries.pop();
    renderDiagTable();
    pushDashboardEvent(status, `[${module}] ${detail}`);
  }

  function checkMetricThresholds(metrics = {}) {
    const now = Date.now();
    if (metrics.memPct > 85 && now - state.lastMemWarn > 180000) {
      state.lastMemWarn = now;
      addDiagnosticEntry('内存监控', 'warn', `系统内存占用超阈值 (${metrics.memPct}%)`, '<button class="action-btn x-small">忽略</button>');
      state.deps.notify('内存警告', `系统内存占用 ${metrics.memPct}%，已超过 85% 阈值`);
    }

    if (metrics.cpuPct > 90 && now - state.lastCpuWarn > 180000) {
      state.lastCpuWarn = now;
      addDiagnosticEntry('CPU 监控', 'warn', `CPU 负载过高 (${metrics.cpuPct}%)`, '<button class="action-btn x-small">忽略</button>');
      state.deps.notify('CPU 警告', `CPU 负载 ${metrics.cpuPct}%，已超过 90% 阈值`);
    }
  }

  function bindHistoryFilter() {
    const historyFilterGroup = $('historyFilterGroup');
    if (!historyFilterGroup || historyFilterGroup.dataset.deviceStatusBound === '1') return;
    historyFilterGroup.dataset.deviceStatusBound = '1';

    historyFilterGroup.querySelectorAll('.filter-segmented-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        historyFilterGroup.querySelectorAll('.filter-segmented-btn').forEach((item) => item.classList.remove('active'));
        btn.classList.add('active');
        applyHistoryFilter();

        const pill = $('historyFilterPill');
        if (pill) {
          const rect = btn.getBoundingClientRect();
          const parentRect = historyFilterGroup.getBoundingClientRect();
          pill.style.width = `${rect.width}px`;
          pill.style.transform = `translateX(${rect.left - parentRect.left}px)`;
        }
      });
    });
  }

  function bindNavSparklineWarmup() {
    const nav = document.querySelector('.nav-item[data-target="page-device-status"]');
    if (!nav || nav.dataset.deviceStatusSparkBound === '1') return;
    nav.dataset.deviceStatusSparkBound = '1';
    nav.addEventListener('click', () => {
      requestAnimationFrame(() => {
        initSparklines();
        syncBatterySparklineFromCard();
      });
    });
  }

  function syncAuthExpandedState() {
    const authList = $('metaAuthList');
    const grid = document.querySelector('#page-device-status .device-status-grid');
    if (grid && authList) {
      grid.classList.toggle('auth-expanded', !authList.classList.contains('collapsed'));
    }
  }

  function bindAuthListToggle() {
    const toggle = $('authListToggle');
    if (!toggle || toggle.dataset.deviceStatusAuthBound === '1') return;
    toggle.dataset.deviceStatusAuthBound = '1';
    toggle.addEventListener('click', () => {
      const authList = $('metaAuthList');
      const collapseIcon = $('authCollapseIcon');
      if (authList) authList.classList.toggle('collapsed');
      if (collapseIcon) collapseIcon.classList.toggle('collapsed');
      requestAnimationFrame(syncAuthExpandedState);
      const isCollapsed = authList ? authList.classList.contains('collapsed') : false;
      state.deps.config?.set?.('authListCollapsed', isCollapsed)?.catch?.(() => {});
    });
    syncAuthExpandedState();
  }

  async function runPermissionDiagnosis() {
    const service = state.deps.service;
    const [perms, running, autoStart] = await Promise.all([
      service?.checkPermissions?.() || {},
      service?.isRunning?.() || false,
      service?.isAutoStartEnabled?.() || false,
    ]);

    let grantedCount = 0;
    const deniedNames = [];
    const permUI = {
      metaAuthScreenCapture: perms.screenCapture,
      metaAuthProcessEnum: perms.processEnum,
      metaAuthPowerControl: perms.powerControl,
      metaAuthNetwork: perms.network,
      metaAuthFileIO: perms.fileIO,
    };
    const permNameMap = {
      metaAuthScreenCapture: '屏幕捕获',
      metaAuthProcessEnum: '进程遍历',
      metaAuthPowerControl: '电源控制',
      metaAuthNetwork: '网络访问',
      metaAuthFileIO: '文件读写',
    };
    const totalPerm = Object.keys(permUI).length + 1;

    for (const [elId, status] of Object.entries(permUI)) {
      const el = $(elId);
      if (!el) continue;
      const icon = el.querySelector('i');
      if (!icon) continue;
      if (status === 'granted') {
        icon.className = 'ph ph-check-circle text-theme';
        el.classList.add('granted');
        grantedCount++;
      } else {
        icon.className = 'ph ph-x-circle text-error';
        el.classList.remove('granted');
        deniedNames.push(permNameMap[elId] || elId);
      }
    }

    const autoStartEl = $('metaAuthAutoStart');
    if (autoStartEl) {
      const icon = autoStartEl.querySelector('i');
      if (icon) {
        if (autoStart) {
          icon.className = 'ph ph-check-circle text-theme';
          autoStartEl.classList.add('granted');
          grantedCount++;
        } else {
          icon.className = 'ph ph-warning text-warn';
          autoStartEl.classList.remove('granted');
          deniedNames.push('开机自启');
        }
      }
    }

    const denied = totalPerm - grantedCount;
    const countEl = $('authGrantedCount');
    if (countEl) {
      if (denied === 0) {
        countEl.textContent = '已全部授权';
        countEl.className = 'auth-count-ok';
      } else {
        countEl.textContent = `${denied}项未授权`;
        countEl.className = 'auth-count-warn';
      }
    }

    const ratingBadge = document.querySelector('.rating-badge');
    if (ratingBadge) {
      if (grantedCount >= totalPerm) ratingBadge.textContent = '评级: S';
      else if (grantedCount >= totalPerm - 1) ratingBadge.textContent = '评级: A';
      else if (grantedCount >= totalPerm - 2) ratingBadge.textContent = '评级: B';
      else ratingBadge.textContent = '评级: C';
    }

    const permDescEl = $('dashPermDesc');
    if (permDescEl) {
      permDescEl.textContent = denied === 0
        ? '所需权限均已授予并检测通过。'
        : `有 ${denied} 项权限未授权，可能影响部分功能。点击下方按钮重新诊断。`;
    }

    const deniedListEl = $('dashDeniedList');
    const deniedItemsEl = $('dashDeniedItems');
    if (deniedListEl && deniedItemsEl) {
      if (denied > 0) {
        const displayNames = deniedNames.length > 3
          ? deniedNames.slice(0, 3).concat(`+${deniedNames.length - 3} 项`)
          : deniedNames;
        deniedItemsEl.innerHTML = displayNames.map((name) =>
          `<span class="denied-tag">${state.deps.escapeHtml(name)}</span>`
        ).join('');
        deniedListEl.style.display = '';
      } else {
        deniedListEl.style.display = 'none';
      }
    }

    requestAnimationFrame(syncAuthExpandedState);
    return { grantedCount, totalPerm, denied, running };
  }

  function bindPermissionDiagnosisButton() {
    const btn = $('dashDiagBtn');
    if (!btn || btn.dataset.deviceStatusDiagBound === '1') return;
    btn.dataset.deviceStatusDiagBound = '1';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const origHTML = btn.innerHTML;
      btn.innerHTML = '<i class="ph ph-circle-notch diag-spinner"></i> 诊断中...';
      btn.classList.add('diag-running');

      try {
        const { grantedCount, totalPerm, denied, running } = await runPermissionDiagnosis();
        state.deps.addLogLine('INFO', `权限诊断完成: ${grantedCount}/${totalPerm} 已授权，服务${running ? '运行中' : '已停止'}`);
        addDiagnosticEntry('权限诊断', denied === 0 ? 'success' : 'warn', `${grantedCount}/${totalPerm} 权限已授权`);
        state.deps.showNotice(denied === 0 ? '权限诊断通过' : `${denied} 项权限未授权`, denied === 0 ? 'success' : 'warn', 2500);

        btn.innerHTML = '<i class="ph ph-check-circle"></i> 诊断完成';
        setTimeout(() => { btn.innerHTML = origHTML; btn.disabled = false; btn.classList.remove('diag-running'); }, 2000);
      } catch (error) {
        state.deps.addLogLine('ERROR', `权限诊断失败: ${error.message}`);
        btn.innerHTML = '<i class="ph ph-x-circle"></i> 诊断失败';
        setTimeout(() => { btn.innerHTML = origHTML; btn.disabled = false; btn.classList.remove('diag-running'); }, 2000);
      }
    });
  }

  const DeviceStatusPage = {
    init(deps = {}) {
      state.deps = { ...state.deps, ...deps };
      if (state.initialized) return;
      state.initialized = true;
      bindNavSparklineWarmup();
      bindHistoryFilter();
      bindAuthListToggle();
      bindPermissionDiagnosisButton();
    },
    updateMetrics,
    updatePowerKpi,
    addDiagnosticEntry,
    runPermissionDiagnosis,
    syncAuthExpandedState,
    applySparklineTheme,
    initSparklines,
    syncBatterySparklineFromCard,
    checkMetricThresholds,
    formatBytes,
    formatBps,
  };

  window._nekoModules.pages.DeviceStatusPage = DeviceStatusPage;
})();

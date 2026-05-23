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

  function getBatteryLevelInfo(level, isCharging, hasBattery) {
    if (hasBattery === false) return { text: 'AC', icon: 'ph-plug-charging', level: 'ok' };
    if (isCharging) return { text: 'AC', icon: 'ph-plug-charging', level: 'ok' };
    if (level <= 20) return { text: 'Low', icon: 'ph-battery-low', level: 'error' };
    if (level <= 50) return { text: 'Battery', icon: 'ph-battery-medium', level: 'warn' };
    return { text: 'Battery', icon: 'ph-battery-full', level: 'ok' };
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

  function updatePowerKpi(level, isCharging, hasBattery, footerText) {
    const kpiCards = document.querySelectorAll('#page-device-status .kpi-card');
    const card = kpiCards[3];
    if (!card) return;

    const displayLevel = hasBattery === false ? 100 : clampNumber(level, 0, 100);
    const batValue = card.querySelector('.kpi-value');
    const batBadge = card.querySelector('.kpi-badge');
    const batFooter = card.querySelector('.kpi-footer');
    const info = getBatteryLevelInfo(displayLevel, isCharging, hasBattery);

    if (batValue) batValue.textContent = hasBattery === false ? 'AC' : `${displayLevel.toFixed(0)}%`;
    if (batBadge) {
      batBadge.className = `kpi-badge ${info.level}`;
      batBadge.innerHTML = `<i class="ph ${info.icon}"></i> ${info.text}`;
    }
    if (batFooter && footerText) batFooter.textContent = footerText;
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
      if (batFooter) batFooter.textContent = `系统运行: ${hr}h ${min}m`;
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

  const DeviceStatusPage = {
    init(deps = {}) {
      state.deps = { ...state.deps, ...deps };
      if (state.initialized) return;
      state.initialized = true;
      bindNavSparklineWarmup();
      bindHistoryFilter();
    },
    updateMetrics,
    updatePowerKpi,
    addDiagnosticEntry,
    applySparklineTheme,
    initSparklines,
    syncBatterySparklineFromCard,
    checkMetricThresholds,
    formatBytes,
    formatBps,
  };

  window._nekoModules.pages.DeviceStatusPage = DeviceStatusPage;
})();

/**
 * app-ipc.js
 * UI 与后端的连接层：
 *  - 从主进程加载真实配置并填入界面
 *  - 将仪表盘按钮、开关等绑定到真实 IPC 调用
 *  - 响应主进程推送（service:tick、log:entry 等）实时更新 UI
 *
 * 此文件在 app.js 之后加载，通过 clone-replace 技术覆盖 app.js 中的模拟处理器
 */

document.addEventListener('DOMContentLoaded', () => {
  // nekoIPC 由 ipc-bridge.js 挂载到 window.nekoIPC
  const ipc = window.nekoIPC;
  if (!ipc) {
    console.error('[app-ipc] 找不到 nekoIPC，请确认 ipc-bridge.js 已在本文件之前加载');
    return;
  }

  // ══════════════════════════════════════════════════════════════
  //  工具函数
  // ══════════════════════════════════════════════════════════════

  /** 克隆元素并替换，以清除 app.js 注册的旧处理器 */
  function replaceHandler(id, handler) {
    const el = document.getElementById(id);
    if (!el) return null;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', handler);
    return clone;
  }

  /** 获取当前时间字符串 HH:mm:ss */
  function nowStr() {
    return new Date().toTimeString().slice(0, 8);
  }

  // ── 主题模式应用（支持定时自动） ─────────────────────────────────────
  let _darkModeTimer = null;
  let _systemThemeHandler = null;

  // ── 界面缩放步进器 ────────────────────────────────────────────────────
  const SCALE_STEPS = [75, 90, 100, 110, 125, 150, 175, 200];
  let _scaleIdx = SCALE_STEPS.indexOf(100); // 默认 100%

  // ── 上传健康度追踪 ─────────────────────────────────────────────────────
  const _healthStats = { total: 0, success: 0 };

  // ── 趋势图表 ──────────────────────────────────────────────────────────
  let _trendChart    = null;
  let _trendRange    = '1m';
  let _metricsBuffer = []; // 本地指标历史缓存（cpuPct / memPct / timestamp）
  let _lastChartUpdateTs = 0; // 图表上次刷新时间戳（节流用）
  let _themeColorRgb = { r: 6, g: 182, b: 212 }; // 缓存主题色 RGB

  // 将 CSS 颜色字符串（#hex 或 rgb(...)）解析为 {r,g,b}
  function _parseColorRgb(colorStr) {
    const hex = (colorStr || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
    }
    const m = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return { r: 6, g: 182, b: 212 };
  }

  // 防抖重建图表（避免 setDark / themeChange 与 init 竞争）
  let _rebuildTimer = null;
  function _rebuildTrendChartDeferred() {
    if (!_trendChart) return; // 图表尚未创建，跳过（init 阶段由 app:init 统一创建）
    clearTimeout(_rebuildTimer);
    _trendChart.destroy(); _trendChart = null;
    _rebuildTimer = setTimeout(() => { _initTrendChart(); _updateTrendChart(); }, 120);
  }

  // 按时间范围过滤 _metricsBuffer
  function _filterByRange(rangeId) {
    const now = Date.now();
    const totalMs = { '1m': 60e3, '1h': 3600e3, '12h': 12 * 3600e3 }[rangeId] || 60e3;
    return _metricsBuffer.filter(m => m.timestamp >= now - totalMs);
  }

  function _subSample(arr, maxPts) {
    if (arr.length <= maxPts) return arr;
    const step = Math.floor(arr.length / maxPts);
    return arr.filter((_, i) => i % step === 0);
  }

  // 按时间范围将 _metricsBuffer 分桶聚合
  // 左侧为最早时间，右侧为当前时间，仅绘制有数据的区间
  function _buildChartData(rangeId) {
    const pad = n => String(n).padStart(2, '0');
    const now = Date.now();
    const cfgMap = {
      '1m':  { totalMs: 60e3,         buckets: 12 },  // 5s/格，每 5s 一条
      '1h':  { totalMs: 3600e3,       buckets: 60 },  // 1min/格，每 1min 一条
      '12h': { totalMs: 12 * 3600e3,  buckets: 12 },  // 1h/格，每 1h 一条
    };
    const { totalMs, buckets } = cfgMap[rangeId] || cfgMap['1m'];
    const from     = now - totalMs;
    const bucketMs = totalMs / buckets;
    const raw      = _metricsBuffer.filter(m => m.timestamp >= from && m.timestamp <= now);
    // 找到最早数据点，仅从该时间开始绘制
    const earliest = raw.length > 0 ? raw[0].timestamp : now;
    const labels = [], cpuData = [], memData = [];
    for (let i = 0; i < buckets; i++) {
      const bucketStart = from + i * bucketMs;
      const bucketEnd   = from + (i + 1) * bucketMs;
      // 跳过无数据的时段（早于最早数据点的桶）
      if (bucketEnd < earliest) continue;
      const tMid = bucketStart + bucketMs * 0.5;
      const d    = new Date(tMid);
      if (rangeId === '1m') {
        labels.push(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
      } else {
        labels.push(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      }
      const pts = raw.filter(m => m.timestamp >= bucketStart && m.timestamp < bucketEnd);
      if (pts.length > 0) {
        const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
        cpuData.push(+(avg(pts.map(m => m.cpuPct ?? 0))).toFixed(1));
        memData.push(+(avg(pts.map(m => m.memPct ?? 0))).toFixed(1));
      } else {
        cpuData.push(null);
        memData.push(null);
      }
    }
    return { labels, cpuData, memData };
  }

  function _initTrendChart() {
    const canvas = document.getElementById('trendChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
    // 从 CSS 变量读取颜色，以响应深/浅色模式和主题色变更
    const cs = getComputedStyle(document.documentElement);
    const themeColor = cs.getPropertyValue('--theme-color').trim() || '#06b6d4';
    _themeColorRgb = _parseColorRgb(themeColor);
    const isLight = document.documentElement.hasAttribute('data-theme');
    const { r, g, b } = _themeColorRgb;
    // 设置 Chart.js 全局默认文本色，防止 fallback 到黑色
    Chart.defaults.color = isLight ? 'rgba(30, 60, 100, 0.72)' : 'rgba(195, 228, 248, 0.82)';
    const tickColor    = isLight ? 'rgba(30, 60, 100, 0.60)'    : 'rgba(170, 210, 232, 0.68)';
    const gridColor    = isLight ? 'rgba(0, 0, 0, 0.07)'        : 'rgba(255, 255, 255, 0.05)';
    const legendColor  = isLight ? 'rgba(15, 23, 42, 0.72)'     : 'rgba(195, 228, 248, 0.82)';
    const tooltipBg    = isLight ? 'rgba(245, 250, 255, 0.97)'  : 'rgba(6, 12, 24, 0.94)';
    const tooltipTitle = isLight ? 'rgba(15, 23, 42, 0.55)'     : 'rgba(190, 225, 248, 0.60)';
    const tooltipBody  = isLight ? 'rgba(15, 23, 42, 0.88)'     : 'rgba(215, 240, 255, 0.92)';
    const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.10)'       : 'rgba(255, 255, 255, 0.07)';
    _trendChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'CPU',
            data: [],
            borderColor: themeColor,
            backgroundColor: `rgba(${r},${g},${b},0.15)`,
            fill: true, tension: 0.42,
            cubicInterpolationMode: 'monotone',
            spanGaps: true,
            pointRadius: 0, pointHoverRadius: 5, borderWidth: 3,
          },
          {
            label: '内存',
            data: [],
            borderColor: `rgba(${r},${g},${b},0.45)`,
            backgroundColor: `rgba(${r},${g},${b},0.06)`,
            fill: true, tension: 0.42,
            cubicInterpolationMode: 'monotone',
            spanGaps: true,
            pointRadius: 0, pointHoverRadius: 5, borderWidth: 3,
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 380, easing: 'easeInOutQuart' },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: tickColor, maxTicksLimit: 7, maxRotation: 0 },
          },
          y: {
            min: 0, max: 100,
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              callback: v => ({ 75: 'HIGH', 50: 'MID', 25: 'LOW' }[v] ?? null),
            },
          }
        },
        plugins: {
          legend: {
            position: 'top', align: 'start',
            labels: {
              color: legendColor, usePointStyle: true,
              pointStyle: 'line', boxWidth: 26, boxHeight: 2, padding: 20,
              font: { size: 12, weight: '500' }
            }
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipTitle,
            bodyColor:  tooltipBody,
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 11, cornerRadius: 10,
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)}%` }
          }
        }
      }
    });
  }

  function _updateTrendChart() {
    if (!_trendChart) _initTrendChart();
    if (!_trendChart) return;
    const { labels, cpuData, memData } = _buildChartData(_trendRange);
    _trendChart.data.labels           = labels;
    _trendChart.data.datasets[0].data = cpuData;
    _trendChart.data.datasets[1].data = memData;
    // 同步深浅模式文本色
    const isLight = document.documentElement.hasAttribute('data-theme');
    const tickColor   = isLight ? 'rgba(30, 60, 100, 0.60)'   : 'rgba(170, 210, 232, 0.68)';
    const legendColor = isLight ? 'rgba(15, 23, 42, 0.72)'    : 'rgba(195, 228, 248, 0.82)';
    _trendChart.options.scales.x.ticks.color = tickColor;
    _trendChart.options.scales.y.ticks.color = tickColor;
    _trendChart.options.plugins.legend.labels.color = legendColor;
    // 每次刷新时重建渐变，确保响应式缩放后颜色正确
    const ca = _trendChart.chartArea;
    if (ca && ca.bottom > ca.top) {
      const ctx2d = _trendChart.ctx;
      const mkGrad = (r, g, b, a0) => {
        const grd = ctx2d.createLinearGradient(0, ca.top, 0, ca.bottom);
        grd.addColorStop(0,    `rgba(${r},${g},${b},${a0})`);
        grd.addColorStop(0.65, `rgba(${r},${g},${b},${+(a0 * 0.12).toFixed(3)})`);
        grd.addColorStop(1,    `rgba(${r},${g},${b},0)`);
        return grd;
      };
      const { r, g, b } = _themeColorRgb || { r: 6, g: 182, b: 212 };
      _trendChart.data.datasets[0].borderColor = `rgb(${r},${g},${b})`;
      _trendChart.data.datasets[0].backgroundColor = mkGrad(r, g, b, 0.30);
      _trendChart.data.datasets[1].borderColor = `rgba(${r},${g},${b},0.45)`;
      _trendChart.data.datasets[1].backgroundColor = mkGrad(r, g, b, 0.12);
    }
    _trendChart.update('active');
  }

  function applyThemeMode(mode, startTime, endTime) {
    clearInterval(_darkModeTimer);
    _darkModeTimer = null;
    // 清理之前的 system 模式 matchMedia 监听器
    if (_systemThemeHandler) {
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', _systemThemeHandler);
      _systemThemeHandler = null;
    }

    function setDark(isDark) {
      const actual = isDark ? 'dark' : 'light';
      if (isDark) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('neko-theme-mode', actual);
      // 同步 dock 按钮图标
      const icon = document.getElementById('themeModeIcon');
      if (icon) {
        icon.classList.remove('ph-sun', 'ph-moon');
        icon.classList.add(isDark ? 'ph-moon' : 'ph-sun');
      }
      const desc = document.getElementById('stgDarkModeDesc');
      if (desc) {
        const labels = { dark: '当前：深色模式', light: '当前：浅色模式', auto: `定时自动 (${startTime}–${endTime})`, system: '跟随系统外观' };
        desc.textContent = labels[mode] || '';
      }
      // 深/浅模式变更后重建图表，使轴线/背景色跟随模式
      _rebuildTrendChartDeferred();
    }

    if (mode === 'dark') { setDark(true); return; }
    if (mode === 'light') { setDark(false); return; }
    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setDark(mq.matches);
      _systemThemeHandler = e => setDark(e.matches);
      mq.addEventListener('change', _systemThemeHandler, { once: false });
      return;
    }
    // auto（定时）
    function isInDarkRange() {
      const now = new Date();
      const curr = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = (startTime || '18:00').split(':').map(Number);
      const [eh, em] = (endTime || '07:00').split(':').map(Number);
      const start = sh * 60 + sm;
      const end   = eh * 60 + em;
      if (start <= end) return curr >= start && curr < end;  // 同日
      return curr >= start || curr < end;                    // 跨日
    }
    setDark(isInDarkRange());
    _darkModeTimer = setInterval(() => setDark(isInDarkRange()), 60000);
  }

  // ══════════════════════════════════════════════════════════════
  //  控制台日志
  // ══════════════════════════════════════════════════════════════
  const consoleOutput = document.getElementById('consoleOutput');
  let currentLogFilter = 'ALL';
  let autoScroll = true;

  document.getElementById('consoleAutoScroll')?.addEventListener('change', (e) => {
    autoScroll = e.target.checked;
  });

  function addLogLine(level, msg, time) {
    if (!consoleOutput) return;

    const timeStr = time ? new Date(time).toTimeString().slice(0, 8) : nowStr();
    const levelClass = level.toLowerCase();

    const line = document.createElement('div');
    line.className = 'log-line';
    line.dataset.level = level;
    line.innerHTML =
      `<span class="log-time">[${timeStr}]</span> ` +
      `<span class="log-level ${levelClass}">[${level}]</span> ` +
      `<span class="log-msg">${escapeHtml(msg)}</span>`;

    const show = currentLogFilter === 'ALL' || currentLogFilter === level;
    if (!show) line.style.display = 'none';

    consoleOutput.appendChild(line);
    if (autoScroll) consoleOutput.scrollTop = consoleOutput.scrollHeight;

    // 上限 500 条，避免内存无限增长
    while (consoleOutput.children.length > 500) {
      consoleOutput.removeChild(consoleOutput.firstChild);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 灵动岛通知（type: 'success'|'warn'|'error'|'info'） */
  // ── 灵动岛通知队列（串行、去重，保证等宽统一呈现）─────────────────────
  const _islandQueue = [];
  let   _islandActive = false;

  function showNekoIsland(text, type = 'info', durationMs = 3000) {
    // 同类型、同内容去重：队列中已存在则跳过
    if (_islandQueue.some(q => q.text === text && q.type === type)) return;
    _islandQueue.push({ text, type, durationMs });
    if (!_islandActive) _drainIslandQueue();
  }
  // 暴露为全局，供 app.js 内的推流页函数调用
  window.showNekoIsland = showNekoIsland;

  function _drainIslandQueue() {
    const host = document.getElementById('nekoIsland');
    if (!host || !_islandQueue.length) { _islandActive = false; return; }
    _islandActive = true;
    const { text, type, durationMs } = _islandQueue.shift();
    const iconMap = { success: 'ph-check-circle', warn: 'ph-warning', error: 'ph-x-circle', info: 'ph-info' };
    const el = document.createElement('div');
    el.className = `neko-island ${type}`;
    el.innerHTML = `<i class="ph ${iconMap[type] || 'ph-info'} neko-island-icon"></i><span>${escapeHtml(String(text))}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => { el.remove(); _drainIslandQueue(); }, 420);
    }, durationMs);
  }

  // 日志级别过滤器
  document.querySelectorAll('.console-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.console-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentLogFilter = btn.dataset.level || 'ALL';
      consoleOutput?.querySelectorAll('.log-line').forEach((line) => {
        const show = currentLogFilter === 'ALL' || line.dataset.level === currentLogFilter;
        line.style.display = show ? '' : 'none';
      });
    });
  });

  // 清空控制台
  replaceHandler('consoleClearBtn', () => {
    if (consoleOutput) consoleOutput.innerHTML = '';
  });

  // 控制台输入执行
  const consoleInput = document.getElementById('consoleInput');
  function handleConsoleCommand() {
    const cmd = consoleInput?.value?.trim();
    if (!cmd) return;
    addLogLine('INFO', `> ${cmd}`);
    consoleInput.value = '';
    // 基础命令处理
    if (cmd === 'help') {
      const cmds = ['help - 显示帮助', 'version - 当前版本', 'config - 显示当前配置', 'start - 启动上报服务', 'stop - 停止上报服务', 'clear - 清空控制台', 'capture - 立即截图'];
      cmds.forEach((c) => addLogLine('INFO', c));
    } else if (cmd === 'version') {
      ipc.getVersion().then((v) => addLogLine('INFO', `Neko Status v${v}`));
    } else if (cmd === 'config') {
      ipc.getAllConfig().then((cfg) => addLogLine('INFO', JSON.stringify(cfg, null, 2)));
    } else if (cmd === 'start') {
      ipc.startService().then(() => addLogLine('SUCCESS', '上报服务已启动'));
    } else if (cmd === 'stop') {
      ipc.stopService().then(() => addLogLine('INFO', '上报服务已停止'));
    } else if (cmd === 'clear') {
      if (consoleOutput) consoleOutput.innerHTML = '';
    } else if (cmd === 'capture') {
      triggerScreenshot();
    } else {
      addLogLine('WARN', `未知指令: ${cmd}，输入 help 查看可用指令`);
    }
  }
  document.getElementById('consoleSendBtn')?.addEventListener('click', handleConsoleCommand);
  consoleInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleConsoleCommand(); });

  // ══════════════════════════════════════════════════════════════
  //  服务状态指示器更新
  // ══════════════════════════════════════════════════════════════
  const deviceStatusDot = document.getElementById('deviceStatusDot');
  let _serviceRunning = false;

  function applyServiceState(isRunning) {
    _serviceRunning = isRunning;
    // 顶栏状态点 — 需动态查询，因 app:init 会重建 badge innerHTML
    const dot = document.getElementById('deviceStatusDot');
    if (dot) {
      dot.classList.toggle('error', !isRunning);
    }

    // 仪表盘"当前状态"卡片
    const cardStatusValue = document.querySelector('#card-status .metric-value');
    if (cardStatusValue) {
      cardStatusValue.textContent = isRunning ? '在线上报中' : '服务已停止';
    }

    const trendSpan = document.querySelector('#card-status .metric-trend span');
    if (trendSpan) {
      trendSpan.innerHTML = isRunning
        ? '<i class="ph ph-check-circle"></i> 服务运行平稳'
        : '<i class="ph ph-warning-circle"></i> 服务未运行';
      trendSpan.classList.toggle('text-error', !isRunning);
    }

    // 服务页面各服务丸状态
    const reporterStatusEl = document.getElementById('reporterStatus');
    if (reporterStatusEl) {
      reporterStatusEl.className = `svc-pill-status ${isRunning ? 'running' : 'error'}`;
      reporterStatusEl.innerHTML = isRunning
        ? '<i class="ph ph-check-circle"></i> 上报中'
        : '<i class="ph ph-x-circle"></i> 已停止';
    }

    // 上报切换按钮（仪表盘）
    const toggleBtn = document.getElementById('reportToggleBtn');
    if (toggleBtn) {
      toggleBtn.className = `status-toggle-btn ${isRunning ? 'btn-stop' : 'btn-start'}`;
      toggleBtn.innerHTML = isRunning
        ? '<i class="ph ph-stop-circle"></i> 停止上报'
        : '<i class="ph ph-play-circle"></i> 开始上报';
    }

    // 活动流实时标记
    const liveBadge = document.getElementById('activityLiveBadge');
    if (liveBadge) {
      if (isRunning) {
        liveBadge.className = 'status-badge success';
        liveBadge.innerHTML = '<i class="ph ph-pulse"></i> 实时';
      } else {
        liveBadge.className = 'status-badge';
        liveBadge.innerHTML = '<i class="ph ph-pause"></i> 已暂停';
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  仪表盘卡片实时数据
  // ══════════════════════════════════════════════════════════════
  function updateDashboardCards(data) {
    if (!data) return;

    // 最后上报应用卡
    if (data.appName !== undefined) {
      const appValue = document.querySelector('#card-app .metric-value');
      if (appValue) appValue.textContent = data.appName || '—';

      const appProcess = document.querySelector('#card-app .metric-trend');
      if (appProcess && data.packageName) {
        appProcess.innerHTML = `<i class="ph ph-cpu"></i> 进程: ${escapeHtml(data.packageName)}`;
      }
    }

    // 电量卡 — 使用 ID 精确更新
    if (data.batteryLevel !== undefined) {
      const battValue = document.getElementById('batteryValue');
      if (battValue) battValue.textContent = `${data.batteryLevel}%`;

      const battIcon = document.getElementById('batteryIcon');
      const battTrend = document.getElementById('batteryTrend');
      if (battTrend) {
        if (data.hasBattery === false) {
          battTrend.innerHTML = '<i class="ph ph-plug"></i> 桌面供电 · 无电池';
          if (battIcon) battIcon.className = 'ph ph-plug metric-icon theme';
        } else {
          battTrend.innerHTML = data.isCharging
            ? '<i class="ph ph-plug"></i> 交流电已连接'
            : '<i class="ph ph-battery-medium"></i> 使用电池供电';
          if (battIcon) battIcon.className = data.isCharging
            ? 'ph ph-battery-charging metric-icon theme'
            : 'ph ph-battery-medium metric-icon theme';
        }
      }
    }

    // 上传健康度 — 滚动成功率计算（忽略密钥未配置的 tick）
    if (data.reason !== 'no_key') {
      _healthStats.total++;
      if (data.success) _healthStats.success++;
    }
    const healthPct = _healthStats.total > 0
      ? (_healthStats.success / _healthStats.total * 100).toFixed(1)
      : '—';
    const healthValueEl = document.getElementById('healthValue');
    if (healthValueEl) healthValueEl.textContent = `${healthPct}%`;
    const healthTrendEl = document.getElementById('healthTrend');
    if (healthTrendEl) {
      if (!_serviceRunning) {
        healthTrendEl.innerHTML = '<i class="ph ph-power"></i> 上报服务未运行';
      } else {
        const pct = parseFloat(healthPct);
        if (isNaN(pct)) {
          healthTrendEl.innerHTML = '数据不足';
        } else if (pct >= 99) {
          healthTrendEl.innerHTML = '<i class="ph ph-check-circle"></i> 连接优秀';
        } else if (pct >= 90) {
          healthTrendEl.innerHTML = '<i class="ph ph-warning-circle"></i> 轻微丢失';
        } else {
          healthTrendEl.innerHTML = '<i class="ph ph-x-circle"></i> 上报异常，请检查网络';
        }
      }
    }

    // 活动流 — 追加新条目
    if (data.success) {
      const displayApp = data.appName || data.packageName || '';
      if (displayApp) {
        appendActivityItem('app', displayApp, data.packageName || '', nowStr());
      }
      // 追加上传活动记录
      appendActivityItem('upload', '状态上报', data.packageName || '系统', nowStr());
    }

    // 自动截图同步到 UI 预览卡片
    if (data.hasScreenshot && data.screenshotBase64) {
      const url = `data:image/png;base64,${data.screenshotBase64}`;
      const isBlurred = !!data.screenshotBlurred;
      const sizeKB = ((data.screenshotSize || 0) / 1024).toFixed(0);

      // 截图&活动页大预览
      const frame = document.querySelector('.screenshot-frame');
      if (frame) {
        frame.style.backgroundImage = `url(${url})`;
        frame.style.backgroundSize = 'cover';
        frame.style.backgroundPosition = 'center';
        frame.style.filter = isBlurred ? 'blur(20px)' : 'none';
        const placeholder = frame.querySelector('.screenshot-placeholder');
        if (placeholder) placeholder.style.display = 'none';
        const overlay = frame.querySelector('.screenshot-frame-overlay');
        if (overlay) overlay.style.display = 'flex';
      }

      // 仪表盘截图缩略卡
      const dashImg = document.getElementById('dashScreenshotImg');
      const dashEmpty = document.getElementById('dashScreenshotEmpty');
      if (dashImg) {
        dashImg.src = url;
        dashImg.style.display = '';
        dashImg.style.filter = isBlurred ? 'blur(20px)' : 'none';
      }
      if (dashEmpty) dashEmpty.style.display = 'none';
      const dashName = document.getElementById('dashScreenshotName');
      const dashSize = document.getElementById('dashScreenshotSize');
      if (dashName) dashName.innerHTML = `<i class="ph ph-hard-drive"></i> screenshot_${Date.now()}.png`;
      if (dashSize) dashSize.innerHTML = `<i class="ph ph-arrows-out"></i> ${sizeKB} KB`;

      // 活动流追加截图记录
      appendActivityItem('capture', isBlurred ? '自动截图（已模糊）' : '自动截图', `${sizeKB} KB · PNG`, nowStr());
    }
  }

  function appendActivityItem(type, main, sub, time) {
    const list = document.getElementById('activityList');
    if (!list) return;

    // 隐藏空态提示
    if (window._nekoActivityHelpers) window._nekoActivityHelpers.hideEmpty();

    const iconMap = { app: 'ph-app-window', capture: 'ph-camera', upload: 'ph-cloud-arrow-up' };
    const icon = iconMap[type] || 'ph-circle';

    const item = document.createElement('div');
    item.className = 'activity-item';
    item.dataset.type = type;
    item.innerHTML = `
      <div class="activity-icon ${type}"><i class="ph ${icon}"></i></div>
      <div class="activity-content">
        <div class="activity-main">${escapeHtml(main)}</div>
        <div class="activity-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="activity-time">${time}</div>`;

    // 插入到列表顶部，保持最新在上
    list.insertBefore(item, list.firstChild);

    // 超过 20 条则移除末尾
    while (list.children.length > 20) list.removeChild(list.lastChild);
  }

  // ══════════════════════════════════════════════════════════════
  //  覆盖上报切换按钮（替换 app.js 中的模拟逻辑）
  // ══════════════════════════════════════════════════════════════
  replaceHandler('reportToggleBtn', async () => {
    const btn = document.getElementById('reportToggleBtn');
    if (!btn || btn.classList.contains('btn-pending')) return;

    const running = await ipc.isRunning();
    btn.className = 'status-toggle-btn btn-pending';
    btn.innerHTML = running
      ? '<i class="ph ph-spinner ph-spin"></i> 停止中...'
      : '<i class="ph ph-spinner ph-spin"></i> 连接中...';

    try {
      if (running) {
        await ipc.stopService();
        addLogLine('INFO', '已手动停止上报服务');
        showNekoIsland('上报服务已停止', 'info', 2000);
      } else {
        const cfg = await ipc.getAllConfig();
        if (!cfg.deviceKey) {
          addLogLine('WARN', '请先在配置中填写设备密钥，再启动上报服务');
          showNekoIsland('请先配置设备密钥', 'warn', 3000);
          applyServiceState(false);
          return;
        }
        await ipc.startService();
        addLogLine('INFO', '已手动启动上报服务');
        showNekoIsland('上报服务已启动', 'success', 2000);
      }
      applyServiceState(!running);
    } catch (e) {
      addLogLine('ERROR', `服务切换失败: ${e.message}`);
      showNekoIsland('服务切换失败', 'error', 3000);
      applyServiceState(await ipc.isRunning());
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  覆盖配置弹窗保存按钮
  // ══════════════════════════════════════════════════════════════
  async function loadConfigToModal() {
    const cfg = await ipc.getAllConfig();
    if (!cfg) return;

    const urlInput = document.getElementById('configUrlInput');
    const keyInput = document.getElementById('configApiKeyInput');

    // 根据当前模式显示对应 URL
    const isLocal = cfg.serverMode === 'local';
    if (urlInput) urlInput.value = isLocal ? cfg.serverUrlLocal : cfg.serverUrlProd;
    if (keyInput) keyInput.value = cfg.deviceKey || '';

    // 同步模式切换器状态
    const switcher = document.getElementById('configModeSwitcher');
    if (switcher) {
      switcher.querySelectorAll('.modal-mode-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === (isLocal ? 'local' : 'server'));
      });
    }
  }

  // 每次打开弹窗时加载最新配置
  document.getElementById('btnConfigKey')?.addEventListener('click', loadConfigToModal);
  document.getElementById('stgConfigBtn')?.addEventListener('click', loadConfigToModal);

  // 覆盖保存按钮
  replaceHandler('saveConfigBtn', async () => {
    const saveBtn = document.getElementById('saveConfigBtn');
    if (!saveBtn) return;

    const urlInput = document.getElementById('configUrlInput');
    const keyInput = document.getElementById('configApiKeyInput');
    const serverUrl = urlInput?.value?.trim() || '';
    const deviceKey = keyInput?.value?.trim() || '';

    if (!serverUrl) {
      addLogLine('WARN', '请填写服务器地址');
      return;
    }

    const originalHtml = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 测试连接中...';
    saveBtn.disabled = true;

    try {
      // 测试连通性
      const connResult = await ipc.testConnection(serverUrl);

      if (!connResult.ok) {
        saveBtn.innerHTML = '<i class="ph ph-wifi-slash"></i> 连接失败';
        saveBtn.classList.add('btn-feedback-error');
        addLogLine('ERROR', `服务器连接失败: ${connResult.error || '无法连接'}`);
        showNekoIsland('服务器连接失败', 'error', 3500);
        setTimeout(() => {
          saveBtn.innerHTML = originalHtml;
          saveBtn.classList.remove('btn-feedback-error');
          saveBtn.disabled = false;
        }, 2500);
        return;
      }

      // ── 密钥变更安全检查：如果新密钥不同于当前密钥，预验证是否会触发接管 ──
      const oldKey = await ipc.getConfig('deviceKey');
      if (deviceKey && deviceKey !== oldKey) {
        saveBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 验证密钥中...';
        addLogLine('INFO', '检测到密钥变更，正在预验证...');

        let validationResult;
        try {
          // 使用预验证（不发送指纹），服务器会返回 warning 而非 403
          // 设定 5 秒竞赛超时，避免预验证阻塞保存流程
          validationResult = await Promise.race([
            ipc.preValidateKey(deviceKey, serverUrl),
            new Promise(resolve => setTimeout(() => resolve(null), 5000)),
          ]);
        } catch (preErr) {
          addLogLine('WARN', `密钥预验证失败: ${preErr.message || '未知错误'}，继续保存`);
          validationResult = null;
        }

        // 密钥已绑定到其他设备 → 弹出确认框
        if (validationResult && validationResult.warning === 'KEY_BOUND_TO_OTHER_DEVICE') {
          saveBtn.innerHTML = originalHtml;
          saveBtn.disabled = false;
          const userConfirmed = await showTakeoverConfirmDialog();
          if (!userConfirmed) {
            addLogLine('INFO', '用户取消了密钥变更');
            return;
          }
          addLogLine('WARN', '用户确认接管密钥，继续保存');
          saveBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';
          saveBtn.disabled = true;
        } else {
          // 预验证通过或跳过，继续保存
          saveBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';
        }
      }

      // 判断是本地还是生产模式
      const isLocal = serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1');
      const configUpdate = {
        deviceKey,
        serverMode: isLocal ? 'local' : 'production',
        serverConfigured: true,   // 标记服务器已成功配置
      };
      if (isLocal) configUpdate.serverUrlLocal = serverUrl;
      else configUpdate.serverUrlProd = serverUrl;

      await ipc.setManyConfig(configUpdate);

      saveBtn.innerHTML = '<i class="ph ph-check"></i> 已保存';
      saveBtn.classList.add('btn-feedback-success');
      addLogLine('SUCCESS', `配置已保存，服务器延迟 ${connResult.latencyMs || '—'}ms`);
      showNekoIsland('配置已保存', 'success', 2000);

      setTimeout(() => {
        document.getElementById('configModal')?.classList.remove('show');
        setTimeout(() => {
          saveBtn.innerHTML = originalHtml;
          saveBtn.classList.remove('btn-feedback-success');
          saveBtn.disabled = false;
        }, 300);

        // auth modal 内来的配置请求：配置成功后重新打开 auth modal
        if (window._authPendingAfterConfig) {
          window._authPendingAfterConfig = false;
          setTimeout(() => openAuthModal('login'), 400);
        }
      }, 800);

    } catch (e) {
      saveBtn.innerHTML = '<i class="ph ph-x-circle"></i> 出错了';
      saveBtn.classList.add('btn-feedback-error');
      addLogLine('ERROR', `保存配置出错: ${e.message}`);
      setTimeout(() => {
        saveBtn.innerHTML = originalHtml;
        saveBtn.classList.remove('btn-feedback-error');
        saveBtn.disabled = false;
      }, 2000);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  开机自启开关联动（设置页 + 服务页）
  // ══════════════════════════════════════════════════════════════
  async function syncAutoStartToggles(enabled) {
    ['stgAutoStartSwitch', 'autoStartSwitch'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('on', enabled);
    });
  }

  // 服务页自启开关
  document.getElementById('autoStartSwitch')?.addEventListener('click', async function () {
    const newState = this.classList.contains('on');  // app.js 已经切换过了，读新状态
    try {
      if (newState) await ipc.enableAutoStart();
      else await ipc.disableAutoStart();
      addLogLine('INFO', `开机自启 → ${newState ? '已启用' : '已禁用'}`);
      showNekoIsland(newState ? '开机自启已启用' : '开机自启已禁用', newState ? 'success' : 'info', 2000);
      // 同步到设置页
      const stgSwitch = document.getElementById('stgAutoStartSwitch');
      if (stgSwitch) stgSwitch.classList.toggle('on', newState);
      // 自动刷新权限诊断
      runPermissionDiagnosis().catch(() => {});
    } catch (e) {
      addLogLine('ERROR', `自启设置失败: ${e.message}`);
      showNekoIsland('自启设置失败', 'error', 3000);
    }
  });

  // 设置页自启开关
  document.getElementById('stgAutoStartSwitch')?.addEventListener('click', async function () {
    const newState = this.classList.contains('on');
    try {
      if (newState) await ipc.enableAutoStart();
      else await ipc.disableAutoStart();
      addLogLine('INFO', `开机自启 → ${newState ? '已启用' : '已禁用'}`);
      showNekoIsland(newState ? '开机自启已启用' : '开机自启已禁用', newState ? 'success' : 'info', 2000);
      const svcSwitch = document.getElementById('autoStartSwitch');
      if (svcSwitch) svcSwitch.classList.toggle('on', newState);
      // 自动刷新权限诊断
      runPermissionDiagnosis().catch(() => {});
    } catch (e) {
      addLogLine('ERROR', `自启设置失败: ${e.message}`);
      showNekoIsland('自启设置失败', 'error', 3000);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  服务页：上报服务操作按钮
  // ══════════════════════════════════════════════════════════════
  document.getElementById('btnRestartReporter')?.addEventListener('click', async () => {
    try {
      addLogLine('INFO', '正在重启上报服务...');
      showNekoIsland('正在重启上报服务...', 'info', 2000);
      await ipc.restartService();
      addLogLine('SUCCESS', '上报服务已重启');
      showNekoIsland('上报服务已重启', 'success', 2000);
    } catch (e) {
      addLogLine('ERROR', `重启失败: ${e.message}`);
      showNekoIsland('重启失败', 'error', 3000);
    }
  });

  document.getElementById('btnStopReporter')?.addEventListener('click', async () => {
    const running = await ipc.isRunning();
    if (!running) { showNekoIsland('上报服务未在运行', 'info', 2000); return; }
    try {
      await ipc.stopService();
      addLogLine('INFO', '已手动停止上报服务');
      showNekoIsland('上报服务已停止', 'info', 2000);
    } catch (e) {
      addLogLine('ERROR', `停止失败: ${e.message}`);
      showNekoIsland('操作失败', 'error', 3000);
    }
  });

  // 屏幕捕获测试按钮
  document.getElementById('btnTestCapture')?.addEventListener('click', async () => {
    const captureStatusEl = document.getElementById('captureStatus');
    try {
      addLogLine('INFO', '正在测试屏幕捕获...');
      const result = await ipc.captureScreen();
      if (result) {
        if (captureStatusEl) {
          captureStatusEl.className = 'svc-pill-status running';
          captureStatusEl.innerHTML = '<i class="ph ph-check-circle"></i> <span>可用</span>';
        }
        showNekoIsland('屏幕捕获测试成功', 'success', 2000);
      } else {
        if (captureStatusEl) {
          captureStatusEl.className = 'svc-pill-status error';
          captureStatusEl.innerHTML = '<i class="ph ph-x-circle"></i> <span>API 不可用</span>';
        }
        showNekoIsland('屏幕捕获不可用', 'error', 3000);
      }
    } catch (e) {
      if (captureStatusEl) {
        captureStatusEl.className = 'svc-pill-status error';
        captureStatusEl.innerHTML = '<i class="ph ph-x-circle"></i> <span>异常</span>';
      }
      addLogLine('ERROR', `截图测试异常: ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  服务页：上报服务自启开关
  // ══════════════════════════════════════════════════════════════
  document.getElementById('reportAutoStartSwitch')?.addEventListener('click', async function () {
    const enabled = this.classList.contains('on');
    await ipc.setConfig('enableAutoServiceStart', enabled);
    const delayRow = document.getElementById('reportAutoDelayRow');
    if (delayRow) delayRow.style.display = enabled ? '' : 'none';
    addLogLine('INFO', `启动后自动上报 → ${enabled ? '已启用' : '已禁用'}`);
  });

  // ══════════════════════════════════════════════════════════════
  //  服务页：故障恢复配置持久化
  // ══════════════════════════════════════════════════════════════
  document.getElementById('autoRestartSwitch')?.addEventListener('click', async function () {
    const enabled = this.classList.contains('on');
    await ipc.setConfig('enableAutoRestart', enabled);
    addLogLine('INFO', `崩溃自动重启 → ${enabled ? '已启用' : '已禁用'}`);
  });

  // 数值输入变更保存
  const svcNumberInputs = [
    { id: 'reportAutoDelayInput', key: 'reportInterval',     label: '上报延迟' },
    { id: 'startDelayInput',      key: 'startupDelayMs',     label: '启动延迟', multiplier: 1000 },
    { id: 'maxRestartsInput',     key: 'maxRestarts',        label: '最大重启次数' },
    { id: 'restartIntervalInput', key: 'restartIntervalSec', label: '重启间隔' },
    { id: 'watchdogTimeoutInput', key: 'watchdogTimeoutSec', label: '看门狗超时' },
  ];
  svcNumberInputs.forEach(({ id, key, label, multiplier }) => {
    const el = document.getElementById(id);
    if (!el) return;
    let saveTimer = null;
    el.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        const val = parseInt(el.value, 10);
        if (isNaN(val)) return;
        const min = parseInt(el.min, 10) || 0;
        const max = parseInt(el.max, 10) || Infinity;
        const clamped = Math.max(min, Math.min(max, val));
        el.value = clamped;
        await ipc.setConfig(key, multiplier ? clamped * multiplier : clamped);
        addLogLine('INFO', `${label} → ${clamped}${multiplier ? 'ms' : ''}`);
      }, 600);
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  服务页：一键体检（覆盖 app.js 中的占位逻辑）
  // ══════════════════════════════════════════════════════════════
  replaceHandler('runHealthCheckBtn', async () => {
    const btn = document.getElementById('runHealthCheckBtn');
    const list = document.getElementById('healthResultsList');
    if (!btn || !list) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> 检测中...';
    list.innerHTML = '';

    try {
      const results = await ipc.runHealthCheck();
      results.forEach((item, i) => {
        const el = document.createElement('div');
        el.className = 'health-result-item';
        el.style.animationDelay = (i * 0.08) + 's';
        const iconClass = item.ok === true ? 'ph-check-circle ok'
          : item.ok === 'warn' ? 'ph-warning warn'
          : 'ph-x-circle fail';
        el.innerHTML = `
          <i class="ph ${iconClass} health-result-icon"></i>
          <div class="health-result-name">${escapeHtml(item.name)}</div>
          <div class="health-result-desc">${escapeHtml(item.text)}</div>`;
        list.appendChild(el);
      });
    } catch (e) {
      list.innerHTML = `<div class="health-result-item">
        <i class="ph ph-x-circle health-result-icon fail"></i>
        <div class="health-result-name">检测异常</div>
        <div class="health-result-desc">${escapeHtml(e.message)}</div>
      </div>`;
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-heartbeat"></i> 重新体检';
  });

  // ══════════════════════════════════════════════════════════════
  //  服务页：初始化（进程信息 + 权限检测）
  // ══════════════════════════════════════════════════════════════
  async function initServicePage(initData) {
    // 主进程名称 + PID
    const nameEl = document.getElementById('daemonProcessName');
    const pidEl = document.getElementById('daemonPidBadge');
    if (nameEl) nameEl.textContent = initData.processName || 'Neko Status';
    if (pidEl) pidEl.textContent = `PID ${initData.pid || '—'}`;

    // 主进程始终运行
    const daemonStatusEl = document.getElementById('daemonStatus');
    if (daemonStatusEl) {
      daemonStatusEl.className = 'svc-pill-status running';
      daemonStatusEl.innerHTML = '<i class="ph ph-check-circle"></i> <span>运行中</span>';
    }

    // 权限级别
    const privBadge = document.getElementById('privLevelBadge');
    if (privBadge) {
      const isAdmin = initData.isAdmin;
      privBadge.textContent = isAdmin ? '管理员' : '标准用户';
      privBadge.className = `status-badge ${isAdmin ? 'success' : 'info'}`;
    }

    // 异步检测权限
    try {
      const perms = await ipc.checkPermissions();
      const permMap = {
        screenCapture: 'permScreenCapture',
        processEnum: 'permProcessEnum',
        powerControl: 'permPowerControl',
        network: 'permNetwork',
        fileIO: 'permFileIO',
      };
      for (const [key, elId] of Object.entries(permMap)) {
        const el = document.getElementById(elId);
        if (!el) continue;
        const status = perms[key];
        if (status === 'granted') {
          el.className = 'perm-status success';
          el.innerHTML = '<i class="ph ph-check-circle"></i> 已授权';
        } else {
          el.className = 'perm-status error';
          el.innerHTML = '<i class="ph ph-x-circle"></i> 拒绝';
        }
      }
      // 屏幕捕获 pill 联动
      const captureStatusEl = document.getElementById('captureStatus');
      if (captureStatusEl) {
        if (perms.screenCapture === 'granted') {
          captureStatusEl.className = 'svc-pill-status running';
          captureStatusEl.innerHTML = '<i class="ph ph-check-circle"></i> <span>可用</span>';
        } else {
          captureStatusEl.className = 'svc-pill-status error';
          captureStatusEl.innerHTML = '<i class="ph ph-x-circle"></i> <span>不可用</span>';
        }
      }
    } catch (e) {
      addLogLine('WARN', `权限检测失败: ${e.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  截图开关联动
  // ══════════════════════════════════════════════════════════════
  document.getElementById('toggleScreenshot')?.addEventListener('click', async function () {
    const enabled = this.classList.contains('on');
    await ipc.setConfig('enableScreenshot', enabled);
    // 同步截图页上传开关 UI
    const upload = document.getElementById('uploadSwitch');
    if (upload) upload.classList.toggle('on', enabled);
    addLogLine('INFO', `截图上报 → ${enabled ? '已启用' : '已禁用'}`);
    ipc.syncMeta().catch(() => {}); // 同步元数据到 Web
  });

  // 截图页上传开关
  document.getElementById('uploadSwitch')?.addEventListener('click', async function () {
    const enabled = this.classList.contains('on');
    await ipc.setConfig('enableScreenshot', enabled);
    // 同步快捷操作自动捕获开关 UI
    const toggle = document.getElementById('toggleScreenshot');
    if (toggle) toggle.classList.toggle('on', enabled);
    ipc.syncMeta().catch(() => {}); // 同步元数据到 Web
  });

  // ══════════════════════════════════════════════════════════════
  //  "立即截图"按钮
  // ══════════════════════════════════════════════════════════════
  async function triggerScreenshot() {
    addLogLine('INFO', '正在截图...');
    const result = await ipc.captureScreen();
    if (!result) {
      addLogLine('ERROR', '截图失败或功能不可用');
      showNekoIsland('截图失败', 'error', 3000);
      return null;
    }
    const bytes = new Uint8Array(result.data);
    const blob = new Blob([bytes], { type: result.type });
    let url = URL.createObjectURL(blob);
    let isBlurred = false;

    // 隐私模糊检测（仅在隐身模式开启时生效）
    const helpers = window._nekoActivityHelpers;
    const incognitoOn = helpers && helpers.isIncognitoOn();
    // 1) 全局截图模糊：仅在隐身模式开启时生效
    if (incognitoOn) {
      const blurAllEl = document.getElementById('blurAllSwitch');
      if (blurAllEl && blurAllEl.classList.contains('on')) {
        isBlurred = true;
        addLogLine('INFO', '全局截图模糊已启用，截图已模糊');
        if (helpers) helpers.incrementBlurCount();
      }
    }
    // 2) 隐身模式 + 前台应用匹配规则 → 模糊截图
    if (!isBlurred && incognitoOn) {
      try {
        const activeWin = await ipc.getActiveWindow();
        const rules = helpers.getPrivacyRules();
        if (activeWin && activeWin.processName && rules.length > 0) {
          const procLower = activeWin.processName.toLowerCase();
          const matched = rules.some(r => procLower === r.toLowerCase());
          if (matched) {
            isBlurred = true;
            addLogLine('INFO', `隐私规则命中: ${activeWin.processName}，截图已模糊`);
            helpers.incrementBlurCount();
          }
        }
      } catch { /* 获取前台窗口失败，跳过模糊 */ }
    }

    addLogLine('SUCCESS', `截图完成${isBlurred ? '（已模糊）' : ''}，大小 ${(bytes.length / 1024).toFixed(1)} KB`);
    showNekoIsland(isBlurred ? '截图完成（隐私模糊）' : '截图完成', 'success', 2000);
    appendActivityItem('capture', isBlurred ? '截图完成（已模糊）' : '截图完成', `${(bytes.length / 1024).toFixed(0)} KB · PNG`, nowStr());

    // 更新截图预览
    const frame = document.querySelector('.screenshot-frame');
    if (frame) {
      frame.style.backgroundImage = `url(${url})`;
      frame.style.backgroundSize = 'cover';
      frame.style.backgroundPosition = 'center';
      frame.style.filter = isBlurred ? 'blur(20px)' : 'none';
      const placeholder = frame.querySelector('.screenshot-placeholder');
      if (placeholder) placeholder.style.display = 'none';
      const overlay = frame.querySelector('.screenshot-frame-overlay');
      if (overlay) overlay.style.display = 'flex';
    }

    // 更新仪表盘截图卡片预览
    const dashImg = document.getElementById('dashScreenshotImg');
    const dashEmpty = document.getElementById('dashScreenshotEmpty');
    if (dashImg) {
      dashImg.src = url;
      dashImg.style.display = '';
      dashImg.style.filter = isBlurred ? 'blur(20px)' : 'none';
    }
    if (dashEmpty) dashEmpty.style.display = 'none';
    const dashName = document.getElementById('dashScreenshotName');
    const dashSize = document.getElementById('dashScreenshotSize');
    if (dashName) dashName.innerHTML = `<i class="ph ph-hard-drive"></i> screenshot_${Date.now()}.png`;
    if (dashSize) dashSize.innerHTML = `<i class="ph ph-arrows-out"></i> ${(bytes.length / 1024).toFixed(0)} KB`;

    return { url, isBlurred };
  }

  document.getElementById('captureNowBtn')?.addEventListener('click', triggerScreenshot);

  // ══════════════════════════════════════════════════════════════
  //  仪表盘「立即截图」按钮
  // ══════════════════════════════════════════════════════════════
  document.getElementById('dashCaptureNowBtn')?.addEventListener('click', triggerScreenshot);

  // ══════════════════════════════════════════════════════════════
  //  关键权限详情折叠切换
  // ══════════════════════════════════════════════════════════════
  document.getElementById('authListToggle')?.addEventListener('click', () => {
    const authList = document.getElementById('metaAuthList');
    const collapseIcon = document.getElementById('authCollapseIcon');
    if (authList) authList.classList.toggle('collapsed');
    if (collapseIcon) collapseIcon.classList.toggle('collapsed');
    // 持久化折叠状态
    const isCollapsed = authList ? authList.classList.contains('collapsed') : false;
    ipc.setConfig('authListCollapsed', isCollapsed);
  });

  // ══════════════════════════════════════════════════════════════
  //  仪表盘权限诊断按钮
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  //  权限诊断核心逻辑（可复用）
  // ══════════════════════════════════════════════════════════════
  async function runPermissionDiagnosis() {
    const [perms, running, autoStart] = await Promise.all([
      ipc.checkPermissions(),
      ipc.isRunning(),
      ipc.isAutoStartEnabled(),
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
      const el = document.getElementById(elId);
      if (!el) continue;
      const icon = el.querySelector('i');
      if (icon) {
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
    }
    const autoStartEl = document.getElementById('metaAuthAutoStart');
    if (autoStartEl) {
      const icon = autoStartEl.querySelector('i');
      if (icon) {
        if (autoStart) { icon.className = 'ph ph-check-circle text-theme'; autoStartEl.classList.add('granted'); grantedCount++; }
        else { icon.className = 'ph ph-warning text-warn'; autoStartEl.classList.remove('granted'); deniedNames.push('开机自启'); }
      }
    }

    const denied = totalPerm - grantedCount;
    // 更新计数
    const countEl = document.getElementById('authGrantedCount');
    if (countEl) {
      if (denied === 0) {
        countEl.textContent = '已全部授权';
        countEl.className = 'auth-count-ok';
      } else {
        countEl.textContent = `${denied}项未授权`;
        countEl.className = 'auth-count-warn';
      }
    }
    // 评级
    const ratingBadge = document.querySelector('.rating-badge');
    if (ratingBadge) {
      if (grantedCount >= totalPerm) ratingBadge.textContent = '评级: S';
      else if (grantedCount >= totalPerm - 1) ratingBadge.textContent = '评级: A';
      else if (grantedCount >= totalPerm - 2) ratingBadge.textContent = '评级: B';
      else ratingBadge.textContent = '评级: C';
    }
    const permDescEl = document.getElementById('dashPermDesc');
    if (permDescEl) {
      permDescEl.textContent = denied === 0
        ? '所需权限（开机自启、屏幕捕获、进程读取、网络隧道）均已授予并检测通过。'
        : `有 ${denied} 项权限未授权，可能影响部分功能。`;
    }
    // 展示未授权权限列表
    const deniedListEl = document.getElementById('dashDeniedList');
    const deniedItemsEl = document.getElementById('dashDeniedItems');
    if (deniedListEl && deniedItemsEl) {
      if (denied > 0) {
        const displayNames = deniedNames.length > 3
          ? deniedNames.slice(0, 3).concat(`+${deniedNames.length - 3} 项`)
          : deniedNames;
        deniedItemsEl.innerHTML = displayNames.map(n =>
          `<span class="denied-tag">${escapeHtml(n)}</span>`
        ).join('');
        deniedListEl.style.display = '';
      } else {
        deniedListEl.style.display = 'none';
      }
    }
    return { grantedCount, totalPerm, denied, running };
  }

  // ══════════════════════════════════════════════════════════════
  //  仪表盘权限诊断按钮
  // ══════════════════════════════════════════════════════════════
  replaceHandler('dashDiagBtn', async () => {
    const btn = document.getElementById('dashDiagBtn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    const origHTML = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-circle-notch diag-spinner"></i> 诊断中...';
    btn.classList.add('diag-running');

    try {
      const { grantedCount, totalPerm, denied, running } = await runPermissionDiagnosis();

      addLogLine('INFO', `权限诊断完成: ${grantedCount}/${totalPerm} 已授权，服务${running ? '运行中' : '已停止'}`);
      addDiagnosticEntry('权限诊断', denied === 0 ? 'success' : 'warn', `${grantedCount}/${totalPerm} 权限已授权`);
      showNekoIsland(denied === 0 ? '权限诊断通过' : `${denied} 项权限未授权`, denied === 0 ? 'success' : 'warn', 2500);

      btn.innerHTML = '<i class="ph ph-check-circle"></i> 诊断完成';
      setTimeout(() => { btn.innerHTML = origHTML; btn.disabled = false; btn.classList.remove('diag-running'); }, 2000);
    } catch (e) {
      addLogLine('ERROR', `权限诊断失败: ${e.message}`);
      btn.innerHTML = '<i class="ph ph-x-circle"></i> 诊断失败';
      setTimeout(() => { btn.innerHTML = origHTML; btn.disabled = false; btn.classList.remove('diag-running'); }, 2000);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  更新中心按钮
  // ══════════════════════════════════════════════════════════════

  // 保存最近一次更新检查结果，供"强制更新"和"跳过版本"使用
  let _lastUpdateResult = null;

  /** 根据当前安装的版本号解析所属通道（徽章应反映实际安装版本，而非通道选择） */
  function getInstalledChannel(version) {
    const v = (version || '').toLowerCase();
    if (v.includes('-nightly')) return 'nightly';
    if (v.includes('-beta')) return 'beta';
    return 'stable';
  }
  const _installedChannelNameMap = { stable: '稳定版', beta: 'Beta', nightly: 'Nightly' };

  /** 将 Markdown 风格的 release notes 渲染为更新日志时间线 */
  function renderReleaseNotes(result) {
    if (!result || !result.latestVersion) return;

    // 更新版本卡上的通道标签 — 基于当前安装版本，而非更新通道选择
    const channelBadge = document.querySelector('.update-channel-badge');
    if (channelBadge) {
      const instCh = getInstalledChannel(result.currentVersion);
      channelBadge.className = `update-channel-badge ${instCh}`;
      channelBadge.textContent = _installedChannelNameMap[instCh] || '稳定版';
    }
    const verTag = document.querySelector('.update-ver-tag');
    if (verTag) {
      const tagMap = { stable: 'Stable', beta: 'Beta', nightly: 'Nightly' };
      verTag.textContent = tagMap[result.channel] || 'Stable';
    }

    // 渲染 release notes 到时间线
    const timeline = document.querySelector('.update-timeline');
    if (!timeline || !result.releaseNotes) return;

    const notes = result.releaseNotes;
    // 简单解析为列表项
    const lines = notes.split('\n').filter(l => l.trim()).map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);

    const dateStr = result.publishedAt ? new Date(result.publishedAt).toISOString().slice(0, 10) : '';
    const isCurrent = !result.hasUpdate;

    const item = document.createElement('div');
    item.className = 'update-tl-item';
    item.innerHTML = `
      <div class="update-tl-track">
        <div class="update-tl-dot ${isCurrent ? '' : 'current'}"></div>
        <div class="update-tl-line"></div>
      </div>
      <div class="update-tl-body">
        <div class="update-tl-header">
          <span class="update-tl-ver">v${escapeHtml(result.latestVersion)}</span>
          ${result.hasUpdate ? '<span class="update-tl-badge latest">NEW</span>' : '<span class="update-tl-badge latest">CURRENT</span>'}
          <span class="update-tl-date">${escapeHtml(dateStr)}</span>
        </div>
        <div class="update-tl-block">
          <ul class="update-tl-list">
            ${lines.slice(0, 20).map(l => `<li>${escapeHtml(l)}</li>`).join('')}
          </ul>
        </div>
      </div>`;

    // 插入到时间线最前面
    timeline.insertBefore(item, timeline.firstChild);
  }

  /** 渲染在线获取的多版本更新日志（替换时间线静态数据） */
  function renderChangelogEntries(entries) {
    const timeline = document.querySelector('.update-timeline');
    if (!timeline || !entries || !entries.length) return;
    timeline.innerHTML = '';
    entries.forEach((entry, i) => {
      const isCurrent = i === 0;
      const isLast    = i === entries.length - 1;
      const lines = (entry.notes || '').split('\n')
        .filter(l => l.trim())
        .map(l => l.replace(/^#+\s*|^[-*•]\s*/g, '').trim())
        .filter(Boolean)
        .slice(0, 15);
      const item = document.createElement('div');
      item.className = 'update-tl-item';
      item.innerHTML = `
        <div class="update-tl-track">
          <div class="update-tl-dot${isCurrent ? ' current' : ''}"></div>
          <div class="update-tl-line${isLast ? ' last' : ''}"></div>
        </div>
        <div class="update-tl-body">
          <div class="update-tl-header">
            <span class="update-tl-ver">v${escapeHtml(entry.version)}</span>
            ${isCurrent ? '<span class="update-tl-badge latest">LATEST</span>' : ''}
            ${entry.isPreRelease ? '<span class="update-tl-badge pre">PRE</span>' : ''}
            <span class="update-tl-date">${escapeHtml(entry.date)}</span>
          </div>
          <div class="update-tl-block">
            <ul class="update-tl-list">
              ${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('') || '<li>（暂无说明）</li>'}
            </ul>
          </div>
        </div>`;
      timeline.appendChild(item);
    });
  }

  replaceHandler('checkUpdateBtn', async () => {
    const btn   = document.getElementById('checkUpdateBtn');
    const icon  = document.getElementById('checkUpdateIcon');
    const label = document.getElementById('checkUpdateLabel');
    const badge = document.getElementById('updateStatusBadge');
    if (!btn || btn.disabled) return;

    // ── 模式：立刻更新（已找到新版本，点击开始下载）─────────────────
    if (btn._updateMode === 'download' && _lastUpdateResult?.hasUpdate) {
      btn.disabled = true;
      if (icon)  { icon.className = 'ph ph-circle-notch'; icon.style.animation = 'spin 0.8s linear infinite'; }
      if (label) label.textContent = '下载中...';
      await doDownloadAndInstall(_lastUpdateResult);
      btn.disabled = false;
      if (icon)  { icon.className = 'ph ph-download-simple'; icon.style.animation = ''; }
      if (label) label.textContent = '立刻更新';
      return;
    }

    // ── 模式：安装回滚版本 ────────────────────────────────────────────
    if (btn._updateMode === 'rollback-install' && btn._rollbackData) {
      btn.disabled = true;
      if (icon)  { icon.className = 'ph ph-circle-notch'; icon.style.animation = 'spin 0.8s linear infinite'; }
      if (label) label.textContent = '安装中...';
      await doDownloadAndInstall(btn._rollbackData);
      return;
    }

    // ── 模式：检查更新 ────────────────────────────────────────────────
    const progressRow   = document.getElementById('updateProgressRow');
    const progressBar   = document.getElementById('updateProgressBar');
    const progressLabel = document.getElementById('updateProgressLabel');
    if (progressRow)   progressRow.style.display   = '';
    if (progressBar)   { progressBar.style.display = ''; progressBar.classList.add('indeterminate'); }
    if (progressLabel) progressLabel.textContent   = '检查中...';

    btn.disabled = true;
    btn._updateMode = 'check';
    if (icon)  { icon.className = 'ph ph-circle-notch'; icon.style.animation = 'spin 0.8s linear infinite'; }
    if (label) label.textContent = '检查中...';

    function _hideProgress() {
      if (progressBar) { progressBar.style.display = 'none'; progressBar.classList.remove('indeterminate'); }
      if (progressRow) progressRow.style.display = 'none';
    }

    try {
      const result = await ipc.checkUpdate();
      _lastUpdateResult = result;
      btn.disabled = false;
      _hideProgress();

      if (result.error) {
        const isUncfg = result.error.includes('未配置');
        if (icon)  { icon.className = 'ph ph-arrows-clockwise'; icon.style.animation = ''; }
        if (label) label.textContent = '检查更新';
        if (badge) {
          badge.className = 'update-status-badge error';
          badge.innerHTML = isUncfg
            ? '<i class="ph ph-gear"></i> 请先配置更新源'
            : '<i class="ph ph-warning"></i> 检查失败';
        }
        showNekoIsland(isUncfg ? '请先在右侧配置 GitHub 仓库地址' : `检查更新失败: ${result.error}`, 'error', 4000);
        addLogLine('ERROR', `检查更新失败: ${result.error}`);
        return;
      }

      // 强制更新
      if (result.hasUpdate && result.forceUpdate) {
        if (icon)  { icon.className = 'ph ph-circle-notch'; icon.style.animation = 'spin 0.8s linear infinite'; }
        if (label) label.textContent = '强制安装中...';
        if (badge) { badge.className = 'update-status-badge error'; badge.innerHTML = `<i class="ph ph-warning"></i> 强制更新 v${result.latestVersion}`; }
        showNekoIsland(`检测到强制更新 v${result.latestVersion}，正在自动下载...`, 'warn', 6000);
        addLogLine('WARN', `检测到强制更新 v${result.latestVersion}，必须安装`);
        renderReleaseNotes(result);
        btn.disabled = true;
        await doDownloadAndInstall(result);
        return;
      }

      // 跳过版本
      const skipped = await ipc.getConfig('skippedVersion');
      if (result.hasUpdate && skipped === result.latestVersion) {
        if (icon)  { icon.className = 'ph ph-arrows-clockwise'; icon.style.animation = ''; }
        if (label) label.textContent = '检查更新';
        if (badge) { badge.className = 'update-status-badge success'; badge.innerHTML = `<i class="ph ph-check-circle"></i> 已跳过 v${result.latestVersion}`; }
        addLogLine('INFO', `已跳过版本 v${result.latestVersion}`);
        renderReleaseNotes(result);
        return;
      }

      if (result.hasUpdate) {
        btn._updateMode = 'download';
        btn.classList.remove('rollback-install-btn');
        btn.classList.add('primary');
        if (icon)  { icon.className = 'ph ph-download-simple'; icon.style.animation = ''; }
        if (label) label.textContent = '立刻更新';
        if (badge) { badge.className = 'update-status-badge warn'; badge.innerHTML = `<i class="ph ph-arrow-circle-up"></i> 发现新版本 v${result.latestVersion}`; }
        showNekoIsland(`发现新版本 v${result.latestVersion}，点击「立刻更新」下载安装`, 'info', 5000);
        addLogLine('INFO', `发现新版本 v${result.latestVersion}（当前 v${result.currentVersion}）`);
        // 导航栏脉冲提示
        const navUpd = document.querySelector('.nav-item[data-target="page-update"]');
        if (navUpd) navUpd.classList.add('has-update');
      } else {
        btn._updateMode = 'check';
        btn.classList.remove('rollback-install-btn');
        btn.classList.add('primary');
        if (icon)  { icon.className = 'ph ph-check-circle'; icon.style.animation = ''; }
        if (label) label.textContent = '已是最新';
        if (badge) { badge.className = 'update-status-badge success'; badge.innerHTML = `<i class="ph ph-check-circle"></i> 已是最新`; }
        showNekoIsland(`当前已是最新版本 v${result.currentVersion}`, 'success', 2500);
        addLogLine('INFO', `当前已是最新版本 v${result.currentVersion}`);
        // 5s 后恢复检查按钮文字
        setTimeout(() => {
          if (btn._updateMode !== 'check') return;
          if (icon)  icon.className = 'ph ph-arrows-clockwise';
          if (label) label.textContent = '检查更新';
        }, 5000);
      }

      const verNumber = document.querySelector('.update-ver-number');
      if (verNumber && result.currentVersion) verNumber.textContent = `v${result.currentVersion}`;
      renderReleaseNotes(result);

    } catch (e) {
      btn.disabled = false;
      if (icon)  { icon.className = 'ph ph-arrows-clockwise'; icon.style.animation = ''; }
      if (label) label.textContent = '检查更新';
      _hideProgress();
      addLogLine('ERROR', `检查更新异常: ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  强制更新按钮（下载 → 进度 → 安装完整流程）
  // ══════════════════════════════════════════════════════════════
  // 防重入锁：避免并发多次触发下载
  let _isDownloading = false;

  async function doDownloadAndInstall(result) {
    if (_isDownloading) {
      showNekoIsland('已有下载任务正在进行中，请稍候', 'warn', 3000);
      addLogLine('WARN', '已有下载任务进行中，防止重复触发');
      return;
    }
    _isDownloading = true;

    const downloadUrl = result.exeDownloadUrl || result.zipDownloadUrl;
    if (!downloadUrl) {
      addLogLine('ERROR', '没有找到可用的下载链接');
      return;
    }

    // 显示并重置进度条
    const progressRow   = document.getElementById('updateProgressRow');
    const progressBar   = document.getElementById('updateProgressBar');
    const progressLabel = document.getElementById('updateProgressLabel');
    const progressPct   = document.getElementById('updateProgressPct');
    const progressFill  = document.getElementById('updateProgressFill');
    if (progressRow)  progressRow.style.display  = '';
    if (progressBar)  { progressBar.style.display = ''; progressBar.classList.remove('indeterminate'); }
    if (progressLabel) progressLabel.textContent  = '下载中...';
    if (progressPct)   progressPct.textContent    = '0%';
    if (progressFill)  progressFill.style.width   = '0%';

    addLogLine('INFO', `开始下载更新 v${result.latestVersion}...`);

    const dlResult = await ipc.downloadUpdate(downloadUrl);
    if (!dlResult.success) {
      addLogLine('ERROR', `下载失败: ${dlResult.error}`);
      if (progressLabel) progressLabel.textContent = '下载失败';
      return;
    }

    addLogLine('SUCCESS', `下载完成，SHA256: ${dlResult.sha256.slice(0, 12)}...`);
    if (progressLabel) progressLabel.textContent = '校验完成';
    if (progressPct)   progressPct.textContent   = '100%';
    if (progressFill)  progressFill.style.width  = '100%';

    // 自动安装
    addLogLine('INFO', '正在启动安装...');
    const installResult = await ipc.installUpdate(dlResult.filePath, dlResult.sha256);
    if (!installResult.success) {
      addLogLine('ERROR', `安装失败: ${installResult.error}`);
      if (progressLabel) progressLabel.textContent = '安装失败';
    } else {
      addLogLine('SUCCESS', '安装程序已启动，应用即将关闭');
    }
    _isDownloading = false;
  }


  replaceHandler('forceUpdateBtn', async () => {
    const btn = document.getElementById('forceUpdateBtn');
    if (!btn) return;
    btn.disabled = true;
    const origHtml = btn.innerHTML;
    btn.querySelector('.update-ctrl-label').textContent = '检查中...';

    try {
      // 先检查更新
      let result = _lastUpdateResult;
      if (!result || !result.hasUpdate) {
        result = await ipc.checkUpdate();
        _lastUpdateResult = result;
      }

      if (result.error) {
        addLogLine('ERROR', `强制更新检查失败: ${result.error}`);
        btn.innerHTML = origHtml;
        btn.disabled = false;
        return;
      }

      if (!result.hasUpdate) {
        addLogLine('INFO', '当前已是最新版本，无需强制更新');
        btn.innerHTML = origHtml;
        btn.disabled = false;
        return;
      }

      // 清除跳过的版本
      await ipc.setConfig('skippedVersion', '');

      btn.querySelector('.update-ctrl-label').textContent = '下载中...';
      await doDownloadAndInstall(result);
    } catch (e) {
      addLogLine('ERROR', `强制更新失败: ${e.message}`);
    } finally {
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  完整性检查（结果通过灵动岛通知展示）
  // ══════════════════════════════════════════════════════════════
  replaceHandler('updateIntegrityBtn', async () => {
    const btn = document.getElementById('updateIntegrityBtn');
    if (!btn) return;
    const labelSpan = btn.querySelector('span');
    btn.disabled = true;
    if (labelSpan) labelSpan.textContent = '检查中...';
    try {
      const results = await ipc.checkIntegrity();
      const failCount = results.filter(r => !r.ok).length;
      if (failCount === 0) {
        showNekoIsland('系统完整性正常，所有项目通过检查', 'success', 3500);
      } else {
        const fails  = results.filter(r => !r.ok);
        const detail = fails.length === 1
          ? `${fails[0].name}: ${fails[0].text}`
          : `${fails[0].name} 等 ${fails.length} 项`;
        showNekoIsland(`完整性检查 — ${detail}`, 'error', 5000);
      }
      const badge = document.getElementById('updateStatusBadge');
      if (badge) {
        badge.className = `update-status-badge ${failCount ? 'warn' : 'success'}`;
        badge.innerHTML = failCount
          ? `<i class="ph ph-warning"></i> ${failCount} 项异常`
          : `<i class="ph ph-seal-check"></i> 完整性正常`;
      }
      results.forEach(r => addLogLine(r.ok ? 'INFO' : 'WARN', `[完整性] ${r.name}: ${r.text}`));
    } catch (e) {
      showNekoIsland(`完整性检查失败: ${e.message}`, 'error', 4000);
      addLogLine('ERROR', `完整性检查失败: ${e.message}`);
    } finally {
      if (labelSpan) labelSpan.textContent = '完整性检查';
      btn.disabled = false;
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  版本回滚（二次确认 → 下载历史版本 → 主按钮变为「安装回滚版本」）
  // ══════════════════════════════════════════════════════════════
  replaceHandler('rollbackBtn', async () => {
    const btn    = document.getElementById('rollbackBtn');
    const cbtn   = document.getElementById('checkUpdateBtn');
    const cicon  = document.getElementById('checkUpdateIcon');
    const clabel = document.getElementById('checkUpdateLabel');
    if (!btn) return;
    const labelSpan = btn.querySelector('span');

    if (!btn.classList.contains('confirming')) {
      btn.classList.add('confirming');
      if (labelSpan) labelSpan.textContent = '确认回滚？';
      btn._confirmTimer = setTimeout(() => {
        btn.classList.remove('confirming');
        if (labelSpan) labelSpan.textContent = '版本回滚';
      }, 3500);
      return;
    }

    // 二次确认触发
    clearTimeout(btn._confirmTimer);
    btn.classList.remove('confirming');
    btn.disabled = true;
    if (labelSpan) labelSpan.textContent = '查询中...';

    try {
      const result = await ipc.rollbackInfo();
      if (!result.success) {
        showNekoIsland(`无法查询回滚版本: ${result.error}`, 'error', 4000);
        addLogLine('ERROR', `无法回滚: ${result.error}`);
        return;
      }

      addLogLine('INFO', `找到历史版本 v${result.version}，开始下载...`);
      showNekoIsland(`正在下载回滚版本 v${result.version}...`, 'warn', 4000);

      // 主按钮改为「安装回滚版本」（琥珀色）
      if (cbtn) {
        cbtn._updateMode  = 'rollback-install';
        cbtn._rollbackData = { latestVersion: result.version, exeDownloadUrl: result.downloadUrl, zipDownloadUrl: null };
        cbtn.classList.remove('primary');
        cbtn.classList.add('rollback-install-btn');
        if (cicon)  { cicon.className = 'ph ph-package'; cicon.style.animation = ''; }
        if (clabel) clabel.textContent = '下载中...';
        cbtn.disabled = true;
      }

      await doDownloadAndInstall({ latestVersion: result.version, exeDownloadUrl: result.downloadUrl, zipDownloadUrl: null });

    } catch (e) {
      showNekoIsland(`版本回滚失败: ${e.message}`, 'error', 4000);
      addLogLine('ERROR', `版本回滚失败: ${e.message}`);
      // 恢复主按钮
      if (cbtn) {
        cbtn.classList.remove('rollback-install-btn');
        cbtn.classList.add('primary');
        cbtn.disabled = false;
        if (cicon)  { cicon.className = 'ph ph-arrows-clockwise'; }
        if (clabel) clabel.textContent = '检查更新';
        cbtn._updateMode = 'check';
      }
    } finally {
      btn.disabled = false;
      if (labelSpan) labelSpan.textContent = '版本回滚';
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  更新通道 Radio 按钮 → IPC
  // ══════════════════════════════════════════════════════════════
  document.querySelectorAll('input[name="updateChannel"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      if (!radio.checked) return;
      const channel = radio.value;
      const ok = await ipc.setUpdateChannel(channel);
      if (ok) {
        addLogLine('INFO', `更新通道已切换为 ${channel}`);
        // 注意：通道切换不改变版本卡上的徽章（徽章反映当前安装版本）
        // 仅更新版本号旁的通道标签以反映订阅通道
        const verTag = document.querySelector('.update-ver-tag');
        if (verTag) {
          const tagMap = { stable: 'Stable', beta: 'Beta', nightly: 'Nightly' };
          verTag.textContent = tagMap[channel] || channel;
        }
      }
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  保存更新源（GitHub 仓库地址）
  // ══════════════════════════════════════════════════════════════
  replaceHandler('saveUpdateSourceBtn', async () => {
    const btn = document.getElementById('saveUpdateSourceBtn');
    const input = document.getElementById('updateSourceInput');
    const currentWrap = document.getElementById('updateSourceCurrent');
    if (!btn || !input) return;

    const raw = input.value.trim();
    if (!raw) { addLogLine('WARN', '请输入 GitHub 仓库地址'); return; }

    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-circle-notch" style="animation:spin 0.8s linear infinite"></i> 验证中...';
    btn.disabled = true;

    try {
      // 解析 owner/repo，支持完整 URL 或 owner/repo 格式
      let owner, repo;
      try {
        const url = new URL(raw);
        const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
        owner = parts[0]; repo = parts[1];
      } catch {
        const parts = raw.split('/');
        owner = parts[0]; repo = parts[1];
      }

      if (!owner || !repo) {
        addLogLine('ERROR', '无法识别仓库信息，请输入 https://github.com/owner/repo 或 owner/repo');
        btn.innerHTML = origHtml;
        btn.disabled = false;
        return;
      }

      await ipc.setManyConfig({ githubOwner: owner, githubRepo: repo });

      const currentUrlSpan = currentWrap?.querySelector('.update-source-current-url');
      if (currentUrlSpan) currentUrlSpan.textContent = `github.com/${owner}/${repo}`;

      btn.innerHTML = '<i class="ph ph-check-circle"></i> 已保存';
      addLogLine('SUCCESS', `更新源已保存: ${owner}/${repo}`);
      input.value = '';

      setTimeout(() => { btn.innerHTML = origHtml; btn.disabled = false; }, 1500);
    } catch (e) {
      addLogLine('ERROR', `更新源保存失败: ${e.message}`);
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  更新下载进度事件
  // ══════════════════════════════════════════════════════════════
  ipc.on('update:progress', (data) => {
    const progressRow   = document.getElementById('updateProgressRow');
    const progressBar   = document.getElementById('updateProgressBar');
    const progressPct   = document.getElementById('updateProgressPct');
    const progressFill  = document.getElementById('updateProgressFill');
    const progressLabel = document.getElementById('updateProgressLabel');
    if (progressRow) progressRow.style.display = '';
    if (progressBar) { progressBar.style.display = ''; progressBar.classList.remove('indeterminate'); }
    if (data.pct >= 0) {
      if (progressPct)   progressPct.textContent   = `${data.pct}%`;
      if (progressFill)  progressFill.style.width  = `${data.pct}%`;
      if (progressLabel) progressLabel.textContent = '下载中...';
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  更新弹窗辅助函数
  // ══════════════════════════════════════════════════════════════

  /** 简易 Markdown → HTML 转换（仅处理更新日志常用语法） */
  function simpleMarkdownToHtml(md) {
    if (!md) return '<p>暂无更新说明</p>';
    // 移除 FORCE_UPDATE 标记
    let text = md.replace(/<!--\s*FORCE_UPDATE\s*-->/gi, '').trim();
    // 标题
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    // 列表项
    text = text.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    // 将连续 <li> 包在 <ul> 中
    text = text.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    // 段落：非空行且非标签开头的视为段落
    text = text.replace(/^([^<\n].+)$/gm, '<p>$1</p>');
    // 清理多余空行
    text = text.replace(/\n{2,}/g, '\n');
    return text || '<p>暂无更新说明</p>';
  }

  /** 格式化文件大小 */
  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /** 打开更新弹窗 */
  function showUpdateDialog(result) {
    const overlay = document.getElementById('updateDialogOverlay');
    if (!overlay) return;

    // 填充版本号
    const curVerEl = document.getElementById('updateDialogCurrentVer');
    const newVerEl = document.getElementById('updateDialogNewVer');
    if (curVerEl) curVerEl.textContent = `v${result.currentVersion}`;
    if (newVerEl) newVerEl.textContent = `v${result.latestVersion}`;

    // 填充元信息
    const sizeEl = document.getElementById('updateDialogSize');
    const dateEl = document.getElementById('updateDialogDate');
    const channelEl = document.getElementById('updateDialogChannel');
    if (sizeEl) sizeEl.innerHTML = `<i class="ph ph-hard-drive"></i> ${formatFileSize(result.downloadSize)}`;
    if (dateEl) {
      const dateStr = result.publishedAt
        ? new Date(result.publishedAt).toLocaleDateString('zh-CN')
        : '--';
      dateEl.innerHTML = `<i class="ph ph-calendar"></i> ${dateStr}`;
    }
    if (channelEl) {
      const ch = (result.channel || 'stable').charAt(0).toUpperCase() + (result.channel || 'stable').slice(1);
      channelEl.innerHTML = `<i class="ph ph-tag"></i> ${ch}`;
    }

    // 填充更新日志
    const notesEl = document.getElementById('updateDialogNotes');
    if (notesEl) notesEl.innerHTML = simpleMarkdownToHtml(result.releaseNotes);

    // 强制更新模式
    const forceBanner = document.getElementById('updateDialogForceBanner');
    const closeBtn = document.getElementById('updateDialogClose');
    const skipBtn = document.getElementById('updateDialogSkipBtn');
    if (result.forceUpdate) {
      if (forceBanner) forceBanner.style.display = '';
      if (closeBtn) closeBtn.style.display = 'none';
      if (skipBtn) skipBtn.style.display = 'none';
    } else {
      if (forceBanner) forceBanner.style.display = 'none';
      if (closeBtn) closeBtn.style.display = '';
      if (skipBtn) skipBtn.style.display = '';
    }

    // 存储当前更新信息供按钮回调使用
    overlay._updateResult = result;

    // 显示弹窗
    overlay.classList.add('show');
  }

  /** 关闭更新弹窗 */
  function hideUpdateDialog() {
    const overlay = document.getElementById('updateDialogOverlay');
    if (overlay) overlay.classList.remove('show');
  }

  // ── 更新弹窗按钮事件 ───────────────────────────────────────
  // 关闭按钮
  document.getElementById('updateDialogClose')?.addEventListener('click', hideUpdateDialog);

  // 点击遮罩关闭（非强制更新时）
  document.getElementById('updateDialogOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'updateDialogOverlay') {
      const overlay = document.getElementById('updateDialogOverlay');
      const result = overlay?._updateResult;
      if (result && result.forceUpdate) return; // 强制更新不允许点击遮罩关闭
      hideUpdateDialog();
    }
  });

  // 跳过此版本
  document.getElementById('updateDialogSkipBtn')?.addEventListener('click', async () => {
    const overlay = document.getElementById('updateDialogOverlay');
    const result = overlay?._updateResult;
    if (result && result.latestVersion) {
      await ipc.setConfig('skippedVersion', result.latestVersion);
      addLogLine('INFO', `已跳过版本 v${result.latestVersion}，下一版本发布前不再提醒`);
      showNekoIsland(`已跳过 v${result.latestVersion}`, 'info', 3000);
    }
    hideUpdateDialog();
  });

  // 立即更新
  document.getElementById('updateDialogInstallBtn')?.addEventListener('click', async () => {
    const overlay = document.getElementById('updateDialogOverlay');
    const result = overlay?._updateResult;
    if (!result) return;
    hideUpdateDialog();
    // 清除跳过记录
    await ipc.setConfig('skippedVersion', '');
    showNekoIsland(`开始下载 v${result.latestVersion}...`, 'info', 3000);
    addLogLine('INFO', `用户确认更新 v${result.latestVersion}，开始下载`);
    doDownloadAndInstall(result);
  });

  // 后台自动下载完成通知
  ipc.on('update:autoDownloaded', (data) => {
    const badge = document.getElementById('updateStatusBadge');
    if (badge) { badge.className = 'update-status-badge info'; badge.innerHTML = `<i class="ph ph-download-simple"></i> 已下载 v${data.version}，下次启动时安装`; }
    showNekoIsland(`更新 v${data.version} 已在后台下载完成，下次启动时自动安装`, 'info', 6000);
    addLogLine('SUCCESS', `自动下载更新 v${data.version} 完成，等待下次启动安装`);
    // 导航栏脉冲提示
    const navUpd = document.querySelector('.nav-item[data-target="page-update"]');
    if (navUpd) navUpd.classList.add('has-update');
  });

  // 强制更新即将安装通知
  ipc.on('update:forceInstallStarted', (data) => {
    const badge = document.getElementById('updateStatusBadge');
    if (badge) { badge.className = 'update-status-badge error'; badge.innerHTML = `<i class="ph ph-warning"></i> 强制更新安装中...`; }
    showNekoIsland(`强制更新 v${data.version} 安装程序已启动，应用即将关闭`, 'warn', 6000);
    addLogLine('WARN', `强制更新 v${data.version} 安装程序已启动`);
  });

  // 后台自动下载失败通知
  ipc.on('update:autoDownloadFailed', (data) => {
    addLogLine('ERROR', `后台自动下载 v${data.version} 失败: ${data.error}`);
    showNekoIsland(`更新 v${data.version} 后台下载失败，请手动检查更新`, 'error', 5000);
  });

  // 启动时推送的新版本可用事件
  ipc.on('update:available', (result) => {
    _lastUpdateResult = result;
    const btn   = document.getElementById('checkUpdateBtn');
    const icon  = document.getElementById('checkUpdateIcon');
    const label = document.getElementById('checkUpdateLabel');
    const badge = document.getElementById('updateStatusBadge');
    if (result.hasUpdate) {
      // 更新中心页面状态同步
      if (result.forceUpdate) {
        if (badge) { badge.className = 'update-status-badge error'; badge.innerHTML = `<i class="ph ph-warning"></i> 强制更新 v${result.latestVersion}`; }
        addLogLine('WARN', `强制更新触发: v${result.latestVersion}`);
      } else {
        if (badge) { badge.className = 'update-status-badge warn'; badge.innerHTML = `<i class="ph ph-arrow-circle-up"></i> 发现新版本 v${result.latestVersion}`; }
        if (btn) {
          btn._updateMode = 'download';
          btn.classList.remove('rollback-install-btn');
          btn.classList.add('primary');
          if (icon)  { icon.className = 'ph ph-download-simple'; icon.style.animation = ''; }
          if (label) label.textContent = '立刻更新';
        }
        addLogLine('INFO', `后台检查发现新版本 v${result.latestVersion}`);
      }
      renderReleaseNotes(result);
      // 导航栏脉冲提示
      const navUpd = document.querySelector('.nav-item[data-target="page-update"]');
      if (navUpd) navUpd.classList.add('has-update');
      // 弹出更新弹窗
      showUpdateDialog(result);
    }
  });
  ['aboutGithubBtn', 'aboutReleaseBtn'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      e.preventDefault();
      const url = e.currentTarget.href || e.currentTarget.getAttribute('href');
      if (url && url !== '#') ipc.openExternal(url);
    });
  });

  // 更新日志“查看全部”按钮 → 跳转GitHub Releases
  document.querySelector('.update-see-all-btn')?.addEventListener('click', () => {
    const cfg = ipc.getConfigSync?.() || {};
    const owner = cfg.githubOwner || 'Neko-NF';
    const repo  = cfg.githubRepo  || 'Neko-Status-Desktop';
    ipc.openExternal(`https://github.com/${owner}/${repo}/releases`);
  });

  // ══════════════════════════════════════════════════════════════
  //  服务页一键体检（真实检查）
  // ══════════════════════════════════════════════════════════════
  replaceHandler('runHealthCheckBtn', async () => {
    const btn = document.getElementById('runHealthCheckBtn');
    const list = document.getElementById('healthResultsList');
    if (!btn || !list) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-circle-notch" style="animation:spin 0.8s linear infinite;"></i> 检测中...';
    list.innerHTML = '';

    async function runCheck(name, checkFn) {
      const item = document.createElement('div');
      item.className = 'health-result-item';
      item.innerHTML = `<i class="ph ph-circle-notch health-result-icon checking" style="animation:spin 0.8s linear infinite;"></i><div class="health-result-name">${name}</div><div class="health-result-desc">检测中...</div>`;
      list.appendChild(item);

      try {
        const { ok, text } = await checkFn();
        const icon = ok === true ? 'ph-check-circle ok' : ok === 'warn' ? 'ph-warning warn' : 'ph-x-circle fail';
        item.innerHTML = `<i class="ph ${icon} health-result-icon"></i><div class="health-result-name">${name}</div><div class="health-result-desc">${escapeHtml(text)}</div>`;
      } catch (e) {
        item.innerHTML = `<i class="ph ph-x-circle fail health-result-icon"></i><div class="health-result-name">${name}</div><div class="health-result-desc">${escapeHtml(e.message)}</div>`;
      }
    }

    const cfg = await ipc.getAllConfig();

    await runCheck('设备密钥配置', async () => {
      const key = cfg.deviceKey;
      return key ? { ok: true, text: `密钥已配置（末尾: ...${key.slice(-6)}）` } : { ok: false, text: '设备密钥未配置，请在服务器配置中填写' };
    });

    await runCheck('上报服务状态', async () => {
      const running = await ipc.isRunning();
      return running ? { ok: true, text: '上报服务运行中' } : { ok: 'warn', text: '上报服务未启动' };
    });

    await runCheck('服务器连通性', async () => {
      const result = await ipc.testConnection();
      return result.ok ? { ok: true, text: `服务器在线，延迟 ${result.latencyMs}ms` } : { ok: false, text: `无法连接服务器: ${result.error}` };
    });

    await runCheck('开机自启配置', async () => {
      const enabled = await ipc.isAutoStartEnabled();
      return enabled ? { ok: true, text: '开机自启已启用' } : { ok: 'warn', text: '开机自启未启用（可在"服务与自启动"中开启）' };
    });

    await runCheck('截图功能', async () => {
      const enabled = cfg.enableScreenshot;
      return { ok: enabled ? true : 'warn', text: enabled ? '截图上报已启用' : '截图上报已禁用（可在设置中启用）' };
    });

    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-heartbeat"></i> 重新体检';
  });

  // ══════════════════════════════════════════════════════════════
  //  主进程事件监听
  // ══════════════════════════════════════════════════════════════

  // 应用初始化
  ipc.on('app:init', async (data) => {
    addLogLine('INFO', `Neko Status v${data.version} 初始化完成`);
    addLogLine('INFO', `设备: ${data.deviceName} | 平台: ${data.platform}`);

    applyServiceState(data.isRunning);

    // 检查是否有已下载（等待安装）的更新
    try {
      const pending = await ipc.invoke('update:getPendingInstall');
      if (pending && pending.hasPending) {
        showNekoIsland(
          `发现已预下载的更新 v${pending.version}，点击「立即安装」完成更新`,
          'info', 0 // 0 = 不自动关闭
        );
        addLogLine('INFO', `检测到待安装更新 v${pending.version}，已在后台下载完成`);
        // 更新中心页面按钮也同步变为「安装待更新」
        const btn = document.getElementById('checkUpdateBtn');
        const icon = document.getElementById('checkUpdateIcon');
        const label = document.getElementById('checkUpdateLabel');
        const badge = document.getElementById('updateStatusBadge');
        if (btn) {
          btn._updateMode = 'install-pending';
          btn.classList.remove('rollback-install-btn');
          btn.classList.add('primary');
        }
        if (icon) { icon.className = 'ph ph-package'; icon.style.animation = ''; }
        if (label) label.textContent = '立即安装';
        if (badge) { badge.className = 'update-status-badge warn'; badge.innerHTML = `<i class="ph ph-arrow-circle-up"></i> 已下载 v${pending.version}，等待安装`; }
        // 按钮点击 → 安装
        replaceHandler('checkUpdateBtn', async () => {
          if (btn && btn._updateMode === 'install-pending') {
            btn.disabled = true;
            if (label) label.textContent = '安装中...';
            const res = await ipc.invoke('update:installPending');
            if (!res.success) {
              addLogLine('ERROR', `安装失败: ${res.error}`);
              btn.disabled = false;
              if (label) label.textContent = '立即安装';
            } else {
              addLogLine('SUCCESS', '安装程序已启动，应用即将关闭');
            }
          }
        });
      }
    } catch (e) {
      console.warn('[Init] 检查待安装更新失败:', e.message);
    }

    // 更新顶栏设备徽标
    const badge = document.querySelector('.device-badge');
    if (badge && data.deviceName) {
      badge.innerHTML = `<div class="status-dot" id="deviceStatusDot"></div>${escapeHtml(data.deviceName)}`;
      // 重新应用状态灯（badge 重建导致旧 DOM 元素被替换）
      applyServiceState(data.isRunning);
    }

    // 初始化开关状态
    const cfg = data.config;
    const autoStartEnabled = await ipc.isAutoStartEnabled();
    syncAutoStartToggles(autoStartEnabled);

    if (cfg.enableScreenshot !== undefined) {
      ['toggleScreenshot', 'uploadSwitch'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('on', cfg.enableScreenshot);
      });
    }

    // ── 设置页所有开关初始化 ──────────────────────────────────────────
    // 最小化到托盘（closeAction === 'minimize' 时为 on）
    const traySwitch = document.getElementById('stgTraySwitch');
    if (traySwitch) traySwitch.classList.toggle('on', cfg.closeAction === 'minimize');

    // 恢复状态
    const restoreSwitch = document.getElementById('stgRestoreSwitch');
    if (restoreSwitch) restoreSwitch.classList.toggle('on', !!cfg.restoreLastState);

    // 自动下载
    const autoDownloadSwitch = document.getElementById('stgAutoDownloadSwitch');
    if (autoDownloadSwitch) autoDownloadSwitch.classList.toggle('on', !!cfg.autoDownload);

    // 上报间隔模式初始化
    const reportMode = cfg.reportIntervalMode || 'auto';
    document.querySelectorAll('#stgReportModeGroup .toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === reportMode);
    });
    const customRow = document.getElementById('stgCustomIntervalRow');
    if (customRow) customRow.style.display = reportMode === 'custom' ? '' : 'none';
    const stgIntervalInput = document.getElementById('stgReportIntervalInput');
    if (stgIntervalInput) stgIntervalInput.value = cfg.reportInterval || 10;
    const stgIntervalDesc = document.getElementById('stgReportIntervalDesc');
    if (stgIntervalDesc) {
      stgIntervalDesc.textContent = reportMode === 'auto'
        ? '自动模式: 每 10s 自动上报'
        : `自定义模式: 每 ${cfg.reportInterval || 10}s 上报`;
    }
    // 快捷操作上报间隔
    const quickInput = document.getElementById('quickIntervalInput');
    const quickLabel = document.getElementById('quickIntervalLabel');
    const quickStepper = document.getElementById('quickIntervalStepper');
    if (quickInput) quickInput.value = cfg.reportInterval || 10;
    const quickHint = document.getElementById('quickIntervalHint');
    if (reportMode === 'auto') {
      if (quickLabel) quickLabel.textContent = '自动';
      if (quickStepper) quickStepper.style.display = 'none';
      if (quickHint) quickHint.style.display = '';
    } else {
      if (quickLabel) quickLabel.textContent = `${cfg.reportInterval || 10}s · 自定义`;
      if (quickStepper) quickStepper.style.display = '';
      if (quickHint) quickHint.style.display = 'none';
    }

    // 截图间隔同步开关
    const syncSwitch = document.getElementById('stgSyncScreenshotSwitch');
    if (syncSwitch) syncSwitch.classList.toggle('on', cfg.syncScreenshotInterval !== false);

    // 截图自动模式提示：同步显示当前上报间隔
    const hintValEl = document.getElementById('intervalAutoHintValue');
    if (hintValEl) hintValEl.textContent = cfg.reportInterval || 10;

    // 通知开关
    const notifySwitch = document.getElementById('stgNotifySwitch');
    if (notifySwitch) notifySwitch.classList.toggle('on', cfg.enableNotification !== false);

    // 勿扰模式 — 从 Windows 免打扰实际状态同步
    const dndSwitch = document.getElementById('stgDndSwitch');
    (async () => {
      const fa = await ipc.getFocusAssist();
      const winDnd = fa && fa.ok ? fa.enabled : !!cfg.doNotDisturb;
      if (dndSwitch) dndSwitch.classList.toggle('on', winDnd);
      if (winDnd !== !!cfg.doNotDisturb) await ipc.setConfig('doNotDisturb', winDnd);
      // 勿扰开启时强制关闭通知开关
      if (winDnd && notifySwitch) {
        notifySwitch.classList.remove('on');
        if (cfg.enableNotification !== false) await ipc.setConfig('enableNotification', false);
      }
    })();

    // 隐身模式
    const incognitoSwitch = document.getElementById('stgIncognitoSwitch');
    if (incognitoSwitch) incognitoSwitch.classList.toggle('on', !!cfg.enableIncognito);

    // 全局截图模糊
    const blurAllSwitch = document.getElementById('blurAllSwitch');
    if (blurAllSwitch) blurAllSwitch.classList.toggle('on', !!cfg.blurAllScreenshots);

    // 从 config 恢复隐私规则到 localStorage 以确保同步
    if (cfg.privacyRules && Array.isArray(cfg.privacyRules)) {
      localStorage.setItem('neko_privacy_rules', JSON.stringify(cfg.privacyRules));
    }

    // 隐身模式关闭时隐藏「设置隐私规则」按钮，卡片始终可见
    setTimeout(() => {
      const privacyRulesBtn = document.getElementById('openPrivacyRulesBtn');
      if (privacyRulesBtn) privacyRulesBtn.style.display = cfg.enableIncognito ? '' : 'none';
      const privacyBarTitle = document.getElementById('privacyBarTitle');
      const privacyBarDesc = document.getElementById('privacyBarDesc');
      const privacyBarIcon = document.getElementById('privacyBarIcon');
      if (privacyBarTitle) privacyBarTitle.textContent = cfg.enableIncognito ? '隐私防护已启用' : '隐私防护未启用';
      if (privacyBarDesc) privacyBarDesc.textContent = cfg.enableIncognito
        ? '匹配隐私规则的前台应用截图将自动模糊后再上传，截图仅上传至已配置的自有服务器。'
        : '隐身模式未开启，截图将正常上传。开启隐身模式后可配置隐私规则。';
      if (privacyBarIcon) privacyBarIcon.innerHTML = cfg.enableIncognito
        ? '<i class="ph ph-shield-check"></i>'
        : '<i class="ph ph-shield-slash"></i>';
    }, 50);

    // 双重认证
    const twoFASwitch = document.getElementById('stg2FASwitch');
    if (twoFASwitch) twoFASwitch.classList.toggle('on', !!cfg.enable2FA);

    // 玻璃拟态
    const glassSwitch = document.getElementById('stgGlassSwitch');
    if (glassSwitch) glassSwitch.classList.toggle('on', cfg.glassEffect !== false);

    // 深色模式 → 两个独立开关（手动深色 + 定时调度）
    const isDark = (cfg.themeMode === 'dark') || (cfg.themeMode === 'auto');
    const isSchedule = (cfg.themeMode === 'auto');
    const darkSwitch = document.getElementById('stgDarkSwitch');
    const darkSched  = document.getElementById('stgDarkScheduleSwitch');
    const darkTimeRow = document.getElementById('stgDarkTimeRow');
    if (darkSwitch) darkSwitch.classList.toggle('on', isDark);
    if (darkSched)  darkSched.classList.toggle('on', isSchedule);
    if (darkTimeRow) darkTimeRow.style.display = isSchedule ? '' : 'none';
    const darkStart = document.getElementById('stgDarkStartTime');
    const darkEnd   = document.getElementById('stgDarkEndTime');
    if (darkStart) darkStart.value = cfg.darkModeStart || '18:00';
    if (darkEnd)   darkEnd.value   = cfg.darkModeEnd   || '07:00';
    // 应用主题（auto=定时 / dark=手动深 / light=手动浅）
    applyThemeMode(cfg.themeMode || 'light', cfg.darkModeStart || '18:00', cfg.darkModeEnd || '07:00');

    // 崩溃自动重启
    const autoRestartSw = document.getElementById('autoRestartSwitch');
    if (autoRestartSw) autoRestartSw.classList.toggle('on', cfg.enableAutoRestart !== false);

    // ── 服务页数值输入初始化 ──────────────────────────────────────────
    const reportDelayInput = document.getElementById('reportAutoDelayInput');
    if (reportDelayInput) reportDelayInput.value = cfg.reportInterval || 10;

    const startDelayInput = document.getElementById('startDelayInput');
    if (startDelayInput) startDelayInput.value = Math.round((cfg.startupDelayMs || 5000) / 1000);

    const maxRestartsInput = document.getElementById('maxRestartsInput');
    if (maxRestartsInput) maxRestartsInput.value = cfg.maxRestarts || 3;

    const restartIntervalInput = document.getElementById('restartIntervalInput');
    if (restartIntervalInput) restartIntervalInput.value = cfg.restartIntervalSec || 30;

    const watchdogTimeoutInput = document.getElementById('watchdogTimeoutInput');
    if (watchdogTimeoutInput) watchdogTimeoutInput.value = cfg.watchdogTimeoutSec || 60;

    // ── 上报服务自启开关 & 延迟行可见性 ──────────────────────────────
    const rptAutoSw = document.getElementById('reportAutoStartSwitch');
    const rptDelayRow = document.getElementById('reportAutoDelayRow');
    if (rptAutoSw) rptAutoSw.classList.toggle('on', !!cfg.enableAutoServiceStart);
    if (rptDelayRow) rptDelayRow.style.display = (cfg.enableAutoServiceStart) ? '' : 'none';

    // ── 服务页：进程 + 权限初始化 ──────────────────────────────────────
    initServicePage(data);

    // ── 截图模式初始化 ────────────────────────────────────────────────
    const ssMode = cfg.screenshotMode || 'auto';
    const ssModeGroup = document.getElementById('screenshotModeGroup');
    if (ssModeGroup) {
      ssModeGroup.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === ssMode);
      });
    }

    // ── 界面缩放初始化（步进器） ──────────────────────────────────────────
    {
      const idx = SCALE_STEPS.indexOf(cfg.uiScale || 100);
      _scaleIdx = idx >= 0 ? idx : SCALE_STEPS.indexOf(100);
      const scaleLabel = document.getElementById('stgScaleLabel');
      const scaleDown  = document.getElementById('stgScaleDown');
      const scaleUp    = document.getElementById('stgScaleUp');
      if (scaleLabel) scaleLabel.textContent = SCALE_STEPS[_scaleIdx] + '%';
      if (scaleDown)  scaleDown.disabled  = _scaleIdx <= 0;
      if (scaleUp)    scaleUp.disabled    = _scaleIdx >= SCALE_STEPS.length - 1;
    }

    // ── 界面字体初始化（同步 config → CSS 变量） ─────────────────────
    if (cfg.uiFont) {
      localStorage.setItem('neko-ui-font', cfg.uiFont);
      document.documentElement.style.setProperty('--ui-font', `"${cfg.uiFont}"`);
      const stgFontSel = document.getElementById('stgFontSelect');
      if (stgFontSel) stgFontSel.value = cfg.uiFont;
    }

    // ── 强调色初始化（同步 config → localStorage） ────────────────────
    if (cfg.seedColor) {
      document.documentElement.style.setProperty('--theme-color', cfg.seedColor);
      localStorage.setItem('neko-theme-color', cfg.seedColor);
      const builtinSwatches = document.querySelectorAll('.settings-swatch, .color-swatch');
      let matchedBuiltin = false;
      builtinSwatches.forEach(s => {
        const isMatch = s.dataset.color === cfg.seedColor;
        s.classList.toggle('active', isMatch);
        if (isMatch) matchedBuiltin = true;
      });
      // 自定义颜色按钮高亮
      const customBtn = document.getElementById('stgCustomColorBtn');
      if (customBtn) {
        customBtn.classList.toggle('active', !matchedBuiltin);
        if (!matchedBuiltin) customBtn.style.setProperty('--custom-swatch-color', cfg.seedColor);
      }
      // 回填自定义取色器预览（保留用户的自定义色）
      if (cfg.customSeedColor) {
        const cInput = document.getElementById('stgCustomColorInput');
        const cHex   = document.getElementById('stgCustomColorHex');
        const cPrev  = document.getElementById('stgCustomColorPreview');
        if (cInput) cInput.value = cfg.customSeedColor;
        if (cHex)   cHex.value   = cfg.customSeedColor;
        if (cPrev)  cPrev.style.background = cfg.customSeedColor;
      }
    }

    // ── 仪表盘布局从 configStore 恢复（比 localStorage 更可靠）────────
    if (cfg.dashboardLayout && Array.isArray(cfg.dashboardLayout) && cfg.dashboardLayout.length) {
      if (typeof loadLayoutConfig === 'function') {
        loadLayoutConfig(cfg.dashboardLayout);
      }
    }

    // ── 玻璃拟态效果初始化 ────────────────────────────────────────────
    if (cfg.glassEffect === false) {
      document.documentElement.classList.add('no-glass');
    }

    // ── 缓存大小显示 ─────────────────────────────────────────────────
    try {
      const cacheSize = await ipc.getCacheSize();
      const cacheSizeMB = (cacheSize / 1024 / 1024).toFixed(1);
      const cacheDesc = document.getElementById('cacheSizeDesc');
      if (cacheDesc) cacheDesc.textContent = `会话缓存（图片、脚本等）· 当前 ${cacheSizeMB} MB`;
    } catch {}

    // ── 缩放描述（DPI 提示） ─────────────────────────────────────────
    const scaleDesc = document.getElementById('stgScaleDesc');
    if (scaleDesc) {
      const dpr = window.devicePixelRatio || 1;
      const suggested = dpr >= 2 ? '建议 ≥150%（当前屏幕 DPI×' + dpr + '）' : '高清屏可调至 150%–200%';
      scaleDesc.textContent = suggested;
    }

    // ── 服务器地址描述初始化 ──────────────────────────────────────────
    const serverDesc = document.querySelector('#stgConfigBtn')?.closest('.settings-row')?.querySelector('.settings-row-desc');
    if (serverDesc) {
      const mode = cfg.serverMode || 'production';
      const url = mode === 'local' ? (cfg.serverUrlLocal || '127.0.0.1:3000') : (cfg.serverUrlProd || 'nf.koirin.com');
      serverDesc.textContent = url.replace(/^https?:\/\//, '');
    }

    // ── 界面缩放应用 ─────────────────────────────────────────────────
    if (cfg.uiScale && cfg.uiScale !== 100) {
      await ipc.setZoom(cfg.uiScale / 100);
    }

    // ── 恢复上次页面 ─────────────────────────────────────────────────
    if (cfg.restoreLastState && cfg.lastPage) {
      const navItem = document.querySelector(`.nav-item[data-target="${cfg.lastPage}"]`);
      if (navItem) navItem.click();
    }

    // ── 更新通道 Radio 初始化 ─────────────────────────────────────────
    const channelRadio = document.querySelector(`input[name="updateChannel"][value="${cfg.updateChannel || 'stable'}"]`);
    if (channelRadio) channelRadio.checked = true;

    // 更新通道徽章 — 基于当前安装版本号，而非通道选择
    const channelBadge = document.querySelector('.update-channel-badge');
    if (channelBadge) {
      const instCh = getInstalledChannel(data.version);
      channelBadge.className = `update-channel-badge ${instCh}`;
      channelBadge.textContent = _installedChannelNameMap[instCh] || '稳定版';
    }
    // 版本号旁的通道标签（反映订阅通道）
    const verTag = document.querySelector('.update-ver-tag');
    if (verTag) {
      const ch = cfg.updateChannel || 'stable';
      const tagMap = { stable: 'Stable', beta: 'Beta', nightly: 'Nightly' };
      verTag.textContent = tagMap[ch] || 'Stable';
    }

    // 导航栏「更新中心」点击时移除脉冲动效
    const navUpdateItem = document.querySelector('.nav-item[data-target="page-update"]');
    if (navUpdateItem) {
      navUpdateItem.addEventListener('click', () => navUpdateItem.classList.remove('has-update'));
    }
    const currentUrlSpan = document.querySelector('#updateSourceCurrent .update-source-current-url');
    if (currentUrlSpan && cfg.githubOwner && cfg.githubRepo) {
      currentUrlSpan.textContent = `github.com/${cfg.githubOwner}/${cfg.githubRepo}`;
    }

    // ── 在线获取更新日志（异步，不阻塞 init）──────────────────────────
    ipc.getChangelog().then((entries) => {
      if (entries && entries.length > 0) renderChangelogEntries(entries);
    }).catch(() => {});

    // ── 趋势图表：预加载历史指标数据 ──────────────────────────────────
    ipc.getMetricsHistory().then(history => {
      if (history && history.length) _metricsBuffer = history;
      _initTrendChart();
      _updateTrendChart();
    }).catch(() => _initTrendChart());

    // 更新关于页版本
    const aboutVerEl = document.getElementById('aboutVersionValue');
    if (aboutVerEl) aboutVerEl.textContent = `v${data.version}`;
    const aboutSubEl = document.getElementById('aboutVersionSub');
    if (aboutSubEl) {
      const ch = (cfg.updateChannel || 'stable').charAt(0).toUpperCase() + (cfg.updateChannel || 'stable').slice(1);
      aboutSubEl.textContent = `${ch} · ${new Date().toLocaleDateString('zh-CN')}`;
    }
    const updateVerEl = document.getElementById('updateVerNumber');
    if (updateVerEl) updateVerEl.textContent = `v${data.version}`;

    // 更新中心描述文本 — 反映实际运行环境
    const updateVerDesc = document.getElementById('updateVerDesc');
    if (updateVerDesc) {
      const lastCheck = cfg.lastUpdateCheck;
      const lastCheckStr = lastCheck
        ? `上次检查：${new Date(lastCheck).toLocaleDateString()}`
        : '尚未检查更新';
      updateVerDesc.textContent = `运行在 Electron ${process.versions?.electron || 'N/A'} · Node ${process.versions?.node || 'N/A'}。${lastCheckStr}。`;
    }

    // P2-10: 关于页面动态化 — 运行环境信息
    const aboutCards = document.querySelectorAll('.about-info-card');
    aboutCards.forEach((card) => {
      const label = card.querySelector('.about-info-label')?.textContent || '';
      const valueEl = card.querySelector('.about-info-value');
      const subEl = card.querySelector('.about-info-sub');
      if (label.includes('运行环境') && valueEl) {
        valueEl.textContent = `Electron ${process.versions?.electron || ''}`;
        if (subEl) subEl.textContent = `Node.js ${process.versions?.node || ''} · Chromium ${process.versions?.chrome || ''}`;
      }
    });

    // ── 关于页 GitHub 链接动态化 ──────────────────────────────────────
    const ghOwner = cfg.githubOwner || 'Neko-NF';
    const ghRepo = cfg.githubRepo || 'Neko-Status-Desktop';
    const ghRepoUrl = `https://github.com/${ghOwner}/${ghRepo}`;
    const aboutGithubBtn = document.getElementById('aboutGithubBtn');
    const aboutReleaseBtn = document.getElementById('aboutReleaseBtn');
    if (aboutGithubBtn) aboutGithubBtn.href = ghRepoUrl;
    if (aboutReleaseBtn) aboutReleaseBtn.href = `${ghRepoUrl}/releases`;

    // ── 关于页开发者信息从 GitHub 获取 ────────────────────────────────
    (async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const repoData = await res.json();
        const aboutCards2 = document.querySelectorAll('.about-info-card');
        aboutCards2.forEach((card) => {
          const label = card.querySelector('.about-info-label')?.textContent || '';
          const valueEl2 = card.querySelector('.about-info-value');
          const subEl2 = card.querySelector('.about-info-sub');
          if (label.includes('开发者') && valueEl2 && repoData.owner) {
            valueEl2.textContent = repoData.owner.login || ghOwner;
            if (subEl2) subEl2.textContent = repoData.organization?.login || repoData.owner.login || 'GitHub';
          }
          if (label.includes('开源协议') && valueEl2 && repoData.license?.spdx_id) {
            valueEl2.textContent = repoData.license.spdx_id;
          }
        });
      } catch { /* GitHub API 失败，保留默认值 */ }
    })();

    // 初始设备状态页加载一次
    try {
      const metrics = await ipc.getMetrics();
      updateDeviceStatusPage(metrics);

      // 设备元信息卡：使用 ID 选择器填充真实数据
      // 操作系统 — 由 updateDeviceStatusPage 处理
      // 设备指纹 — 获取真实 SHA256 指纹（与服务端通信一致）
      try {
        const fp = await ipc.getFingerprint();
        const fpEl = document.getElementById('metaFingerprint');
        if (fpEl && fp) fpEl.textContent = fp.substring(0, 16) + '…';
        if (fpEl && fp) fpEl.title = fp; // 完整指纹 tooltip
      } catch {}
      // 核心服务进程
      const metaProcEl = document.getElementById('metaProcess');
      if (metaProcEl && data.processName) {
        metaProcEl.innerHTML = `${escapeHtml(data.processName)} <span class="meta-pid">PID ${data.pid}</span> <span class="status-dot info"></span>`;
      }
      // 运行权限
      const metaPrivEl = document.getElementById('metaPrivilege');
      if (metaPrivEl) {
        metaPrivEl.innerHTML = data.isAdmin
          ? '<span class="privilege-tag success">管理员</span><span class="privilege-tag success">后台常驻</span>'
          : '<span class="privilege-tag warn">普通用户</span><span class="privilege-tag success">后台常驻</span>';
      }

      // 关键权限详情 — 真实检测 + 折叠逻辑
      try {
        const perms = await ipc.checkPermissions();
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
        let grantedCount = 0;
        const deniedNames = [];
        const totalPerm = Object.keys(permUI).length + 1; // +1 for autoStart
        for (const [elId, status] of Object.entries(permUI)) {
          const el = document.getElementById(elId);
          if (!el) continue;
          const icon = el.querySelector('i');
          if (icon) {
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
        }
        // 开机自启权限
        try {
          const autoStartEl = document.getElementById('metaAuthAutoStart');
          if (autoStartEl) {
            const icon = autoStartEl.querySelector('i');
            if (icon) {
              if (data.isAutoStart) {
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
        } catch {}

        // 更新折叠提示计数
        const countEl = document.getElementById('authGrantedCount');
        const denied = totalPerm - grantedCount;
        if (countEl) {
          if (denied === 0) {
            countEl.textContent = '已全部授权';
            countEl.className = 'auth-count-ok';
          } else {
            countEl.textContent = `${denied}项未授权`;
            countEl.className = 'auth-count-warn';
          }
        }

        // 默认折叠；如果有未授权权限且用户未主动折叠，则展开
        const authList = document.getElementById('metaAuthList');
        const collapseIcon = document.getElementById('authCollapseIcon');
        if (grantedCount >= totalPerm) {
          if (authList) authList.classList.add('collapsed');
          if (collapseIcon) collapseIcon.classList.add('collapsed');
        } else if (cfg.authListCollapsed !== false) {
          // 默认折叠
          if (authList) authList.classList.add('collapsed');
          if (collapseIcon) collapseIcon.classList.add('collapsed');
        } else {
          if (authList) authList.classList.remove('collapsed');
          if (collapseIcon) collapseIcon.classList.remove('collapsed');
        }

        // 更新仪表盘权限评级
        const ratingBadge = document.querySelector('.rating-badge');
        if (ratingBadge) {
          if (grantedCount >= totalPerm) ratingBadge.textContent = '评级: S';
          else if (grantedCount >= totalPerm - 1) ratingBadge.textContent = '评级: A';
          else if (grantedCount >= totalPerm - 2) ratingBadge.textContent = '评级: B';
          else ratingBadge.textContent = '评级: C';
        }
        const permDescEl = document.getElementById('dashPermDesc');
        if (permDescEl) {
          permDescEl.textContent = denied === 0
            ? '所需权限（开机自启、屏幕捕获、进程读取、网络隧道）均已授予并检测通过。'
            : `有 ${denied} 项权限未授权，可能影响部分功能。点击下方按钮重新诊断。`;
        }
        // 展示未授权权限列表
        const deniedListEl = document.getElementById('dashDeniedList');
        const deniedItemsEl = document.getElementById('dashDeniedItems');
        if (deniedListEl && deniedItemsEl) {
          if (denied > 0) {
            const displayNames = deniedNames.length > 3
              ? deniedNames.slice(0, 3).concat(`+${deniedNames.length - 3} 项`)
              : deniedNames;
            deniedItemsEl.innerHTML = displayNames.map(n =>
              `<span class="denied-tag">${escapeHtml(n)}</span>`
            ).join('');
            deniedListEl.style.display = '';
          } else {
            deniedListEl.style.display = 'none';
          }
        }
      } catch {}

      // 初始电量更新 (设备状态页 + 仪表盘)
      const bat = await ipc.getBattery();
      // 设备状态页 KPI 卡
      const batCards = document.querySelectorAll('#page-device-status .kpi-card');
      if (batCards[3]) {
        const batValue = batCards[3].querySelector('.kpi-value');
        const batBadge = batCards[3].querySelector('.kpi-badge');
        if (bat.hasBattery === false) {
          if (batValue) batValue.innerHTML = `100<small>%</small>`;
          if (batBadge) { batBadge.className = 'kpi-badge info'; batBadge.textContent = '桌面供电'; }
        } else {
          if (batValue) batValue.innerHTML = `${bat.level}<small>%</small>`;
          if (batBadge) {
            batBadge.className = `kpi-badge ${bat.isCharging ? 'info' : bat.level < 20 ? 'error' : 'success'}`;
            batBadge.textContent = bat.isCharging ? '充电中' : bat.level < 20 ? '电量低' : '使用电池';
          }
        }
      }
      // 仪表盘电量卡
      updateDashboardCards({
        batteryLevel: bat.hasBattery === false ? 100 : bat.level,
        isCharging: bat.isCharging,
        hasBattery: bat.hasBattery,
      });
    } catch { /* 初始指标获取失败 */ }

    // 清空硬编码演示行，添加初始诊断条目
    const historyBody = document.getElementById('historyTableBody');
    if (historyBody) historyBody.innerHTML = '';
    addDiagnosticEntry('守护进程', 'success', `Neko Status v${data.version} 初始化完成 (PID ${data.pid})`);
    if (data.isRunning) addDiagnosticEntry('上报服务', 'success', '上报服务正在运行');
    if (data.isAutoStart) addDiagnosticEntry('系统权限', 'success', '开机自启已启用');
    if (data.isAdmin) addDiagnosticEntry('系统权限', 'success', '以管理员权限运行');
    else addDiagnosticEntry('系统权限', 'warn', '以普通用户权限运行，部分功能可能受限');

    // 应用启动时立即同步当前状态到服务端
    // 无论用户是否开启上报或截图，确保网页端能立即看到真实的开关状态
    // 不依赖用户操作，不依赖主进程 10s 延迟定时器
    if (cfg.deviceKey) {
      ipc.syncMeta().catch(() => {});
    }
  });

  // 上报成功 Tick
  ipc.on('service:tick', (data) => {
    updateDashboardCards(data);
    if (data.success === false && data.reason === 'no_key') {
      // 密钥未配置时不打印过多日志
    }
  });

  // ── 主题色板切换时重绘图表（响应 app.js 发出的自定义事件）──────────────
  document.addEventListener('neko:themeChange', () => _rebuildTrendChartDeferred());

  // ── 系统指标更新 → 按区间节流图表刷新 ─────────────────────────────────
  // 1m 区间: 每 5s 刷新, 1h 区间: 每 60s 刷新, 12h 区间: 每 3600s 刷新
  const _trendThrottleMs = { '1m': 5000, '1h': 60000, '12h': 3600000 };
  ipc.on('system:metricsUpdate', (m) => {
    _metricsBuffer.push(m);
    if (_metricsBuffer.length > 8640) _metricsBuffer.shift(); // 保留 24h
    // 仅在仪表盘页可见时刷新，且遵守当前区间节流间隔
    const dashArea = document.getElementById('mainDashboardArea');
    if (dashArea && dashArea.style.display !== 'none') {
      const now = Date.now();
      const interval = _trendThrottleMs[_trendRange] || 5000;
      if (now - _lastChartUpdateTs >= interval) {
        _lastChartUpdateTs = now;
        _updateTrendChart();
      }
    }
  });

  // ── 仪表盘导航时确保图表已初始化/调整尺寸 ────────────────────────────
  document.querySelectorAll('.nav-item[data-target="page-dashboard"]').forEach(navItem => {
    navItem.addEventListener('click', () => {
      setTimeout(() => {
        if (!_trendChart) _initTrendChart();
        else _trendChart.resize();
        _updateTrendChart();
      }, 60);
    });
  });

  // ── 趋势图表时间范围切换（1h / 6h / 24h）────────────────────────────
  document.getElementById('trendRangeGroup')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const range = btn.dataset.range;
    if (!range || range === _trendRange) return;
    _trendRange = range;
    _lastChartUpdateTs = 0; // 切换区间时立即刷新
    document.querySelectorAll('#trendRangeGroup .toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.range === range);
    });
    _updateTrendChart();
  });

  // 服务启停状态变化
  ipc.on('service:statusChanged', (data) => {
    applyServiceState(data.isRunning);
    addDiagnosticEntry('守护进程', 'success',
      data.isRunning ? '上报服务已启动' : '上报服务已停止');
    ipc.syncMeta().catch(() => {}); // 服务状态变化时同步元数据
  });

  // 日志条目（来自主进程 StatusService）
  ipc.on('log:entry', (data) => {
    addLogLine(data.level, data.msg, data.time);
    // 将 ERROR / WARN 级别同步到诊断日志表
    const lvl = (data.level || '').toUpperCase();
    if (lvl === 'ERROR') {
      addDiagnosticEntry('服务日志', 'error', data.msg);
    } else if (lvl === 'WARN') {
      addDiagnosticEntry('服务日志', 'warn', data.msg);
    }
  });

  // 密钥状态事件（密钥失效/设备删除/接管）— 弹出醒目警告弹窗
  ipc.on('service:keyStatus', (data) => {
    const { code, message } = data;
    if (code === 'KEY_REVOKED') {
      addLogLine('ERROR', `密钥已被撤销: ${message}`);
      addDiagnosticEntry('认证系统', 'error', `密钥已被撤销: ${message}`);
      applyServiceState(false);
      showTakeoverWarning('密钥已被撤销', '当前设备密钥已被服务器撤销，上报服务已自动停止。可能原因：密钥在网页端被手动删除，或被其他设备接管。', message, true);
    } else if (code === 'DEVICE_NOT_FOUND') {
      addLogLine('ERROR', `设备已被删除: ${message}`);
      addDiagnosticEntry('认证系统', 'error', `设备已被删除: ${message}`);
      applyServiceState(false);
      showTakeoverWarning('设备已从服务器删除', '该设备已被从服务器端移除，上报服务已自动停止。请重新配置密钥或登录账号重新生成。', message, true);
    } else if (code === 'TAKEOVER_SUCCESS') {
      addLogLine('WARN', `设备接管: ${message}`);
      addDiagnosticEntry('认证系统', 'warn', `设备接管: ${message}`);
      showTakeoverWarning('设备接管已发生', '当前密钥已被新设备接管，该密钥之前绑定的上报数据已被服务器清除。如果这不是您的操作，请立即更换密钥。', message, true);
    }
  });

  /** 显示密钥接管/安全事件警告弹窗 */
  function showTakeoverWarning(title, desc, detail, showAction) {
    const modal = document.getElementById('takeoverWarningModal');
    const titleEl = document.getElementById('takeoverWarningTitle');
    const descEl = document.getElementById('takeoverWarningDesc');
    const detailBox = document.getElementById('takeoverDetailBox');
    const actionBtn = document.getElementById('takeoverWarningActionBtn');
    if (!modal) return;
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (detailBox) detailBox.innerHTML = `<i class="ph ph-info" style="color: var(--error-coral); margin-right: 4px;"></i>${escapeHtml(detail || '无附加信息')}`;
    if (actionBtn) actionBtn.style.display = showAction ? '' : 'none';
    modal.classList.add('show');
    showNekoIsland(title, 'error', 5000);
  }

  // 密钥警告弹窗按钮
  document.getElementById('takeoverWarningDismissBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('takeoverWarningModal');
    if (modal) modal.classList.remove('show');
  });
  document.getElementById('takeoverWarningCloseBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('takeoverWarningModal');
    if (modal) modal.classList.remove('show');
  });
  document.getElementById('takeoverWarningActionBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('takeoverWarningModal');
    if (modal) modal.classList.remove('show');
    // 打开配置弹窗重新设置密钥
    document.getElementById('btnConfigKey')?.click();
  });
  // 点击遮罩关闭
  document.getElementById('takeoverWarningModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
  });

  /** 显示接管确认弹窗（Promise，用户确认返回 true，取消返回 false） */
  function showTakeoverConfirmDialog() {
    return new Promise((resolve) => {
      const modal = document.getElementById('takeoverConfirmModal');
      if (!modal) { resolve(true); return; } // 弹窗不存在则默认放行
      modal.classList.add('show');

      const okBtn     = document.getElementById('takeoverConfirmOkBtn');
      const cancelBtn = document.getElementById('takeoverConfirmCancelBtn');
      const closeBtn  = document.getElementById('takeoverConfirmCloseBtn');

      function cleanup() {
        modal.classList.remove('show');
        okBtn?.removeEventListener('click', onOk);
        cancelBtn?.removeEventListener('click', onCancel);
        closeBtn?.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onOverlay);
      }
      function onOk()      { cleanup(); resolve(true); }
      function onCancel()   { cleanup(); resolve(false); }
      function onOverlay(e) { if (e.target === modal) { cleanup(); resolve(false); } }

      okBtn?.addEventListener('click', onOk);
      cancelBtn?.addEventListener('click', onCancel);
      closeBtn?.addEventListener('click', onCancel);
      modal.addEventListener('click', onOverlay);
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  设置页开关 → 持久化到配置
  // ══════════════════════════════════════════════════════════════

  // 最小化到托盘
  document.getElementById('stgTraySwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    await ipc.setConfig('closeAction', isOn ? 'minimize' : 'ask');
    addLogLine('INFO', `关闭行为 → ${isOn ? '最小化到托盘' : '每次询问'}`);
  });

  // 恢复上次状态
  document.getElementById('stgRestoreSwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    await ipc.setConfig('restoreLastState', isOn);
  });

  // 自动下载最新安装包
  document.getElementById('stgAutoDownloadSwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    await ipc.setConfig('autoDownload', isOn);
    addLogLine('INFO', `自动下载更新 → ${isOn ? '开启（后台静默下载，下次启动时安装）' : '已关闭'}`);
  });


  // ── 设置页：上报间隔模式切换 ─────────────────────────────
  document.getElementById('stgReportModeGroup')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn || !btn.dataset.mode) return;
    const mode = btn.dataset.mode;
    document.querySelectorAll('#stgReportModeGroup .toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    await ipc.setConfig('reportIntervalMode', mode);
    const customRow = document.getElementById('stgCustomIntervalRow');
    if (customRow) customRow.style.display = mode === 'custom' ? '' : 'none';
    const descEl = document.getElementById('stgReportIntervalDesc');
    if (mode === 'auto') {
      await ipc.setConfig('reportInterval', 10);
      if (descEl) descEl.textContent = '自动模式: 每 10s 自动上报';
      const qi = document.getElementById('quickIntervalInput');
      if (qi) qi.value = 10;
      const ql = document.getElementById('quickIntervalLabel');
      if (ql) ql.textContent = '自动';
      const qs = document.getElementById('quickIntervalStepper');
      if (qs) qs.style.display = 'none';
      const qh = document.getElementById('quickIntervalHint');
      if (qh) qh.style.display = '';
      const hv = document.getElementById('intervalAutoHintValue');
      if (hv) hv.textContent = '10';
    } else {
      const val = parseInt(document.getElementById('stgReportIntervalInput')?.value, 10) || 10;
      if (descEl) descEl.textContent = `自定义模式: 每 ${val}s 上报`;
      const ql = document.getElementById('quickIntervalLabel');
      if (ql) ql.textContent = `${val}s · 自定义`;
      const qs = document.getElementById('quickIntervalStepper');
      if (qs) qs.style.display = '';
      const qh = document.getElementById('quickIntervalHint');
      if (qh) qh.style.display = 'none';
    }
    addLogLine('INFO', `上报模式 → ${mode === 'auto' ? '自动 (10s)' : '自定义'}`);
  });

  // ── 设置页：自定义间隔保存按钮 ─────────────────────────────
  document.getElementById('stgSaveIntervalBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('stgReportIntervalInput');
    const val = parseInt(input?.value, 10);
    if (isNaN(val) || val < 5) { showNekoIsland('间隔不能小于 5 秒', 'warn', 2000); return; }
    await ipc.setConfig('reportInterval', val);
    const descEl = document.getElementById('stgReportIntervalDesc');
    if (descEl) descEl.textContent = `自定义模式: 每 ${val}s 上报`;
    const qi = document.getElementById('quickIntervalInput');
    if (qi) qi.value = val;
    const ql = document.getElementById('quickIntervalLabel');
    if (ql) ql.textContent = `${val}s · 自定义`;
    const hv = document.getElementById('intervalAutoHintValue');
    if (hv) hv.textContent = val;
    addLogLine('INFO', `上报间隔已保存: ${val}s`);
    showNekoIsland(`上报间隔已设为 ${val} 秒`, 'success', 2000);
  });

  // ── 设置页：截图间隔同步开关 ─────────────────────────────
  document.getElementById('stgSyncScreenshotSwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    await ipc.setConfig('syncScreenshotInterval', isOn);
    // 联动截图页模式
    const modeGroup = document.getElementById('screenshotModeGroup');
    if (modeGroup) {
      const targetMode = isOn ? 'auto' : 'interval';
      await ipc.setConfig('screenshotMode', targetMode);
      modeGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === targetMode));
    }
    addLogLine('INFO', `截图间隔同步 → ${isOn ? '已启用 (跟随上报)' : '已关闭 (独立间隔)'}`);
  });

  // ── 快捷操作：上报间隔 ─────────────────────────────
  // 自动模式下点击卡片 → 跳转设置页并高亮上报间隔行引导用户修改
  document.getElementById('quickIntervalCard')?.addEventListener('click', async (e) => {
    // 如果点击的是 stepper 内部元素（自定义模式），不触发导航
    if (e.target.closest('.neko-stepper')) return;
    const cfg = await ipc.getAllConfig();
    if ((cfg.reportIntervalMode || 'auto') !== 'auto') return;
    // 切换到设置页
    const settingsNav = document.querySelector('.nav-item[data-target="page-settings"]');
    if (settingsNav) settingsNav.click();
    // 高亮上报间隔行
    setTimeout(() => {
      const modeGroup = document.getElementById('stgReportModeGroup');
      const targetRow = modeGroup?.closest('.settings-row');
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetRow.classList.add('highlight-flash');
        setTimeout(() => targetRow.classList.remove('highlight-flash'), 2000);
      }
    }, 300);
  });

  function _quickIntervalChange(dir) {
    const input = document.getElementById('quickIntervalInput');
    if (!input) return;
    let val = parseInt(input.value, 10) || 10;
    val = Math.max(5, Math.min(3600, val + dir * 5));
    input.value = val;
  }
  document.getElementById('quickIntervalDown')?.addEventListener('click', () => _quickIntervalChange(-1));
  document.getElementById('quickIntervalUp')?.addEventListener('click', () => _quickIntervalChange(1));
  document.getElementById('quickIntervalInput')?.addEventListener('change', async function () {
    const val = parseInt(this.value, 10);
    if (isNaN(val) || val < 5) return;
    await ipc.setConfig('reportInterval', val);
    await ipc.setConfig('reportIntervalMode', 'custom');
    // 同步设置页
    document.querySelectorAll('#stgReportModeGroup .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'custom'));
    const customRow = document.getElementById('stgCustomIntervalRow');
    if (customRow) customRow.style.display = '';
    const stgInput = document.getElementById('stgReportIntervalInput');
    if (stgInput) stgInput.value = val;
    const descEl = document.getElementById('stgReportIntervalDesc');
    if (descEl) descEl.textContent = `自定义模式: 每 ${val}s 上报`;
    const ql = document.getElementById('quickIntervalLabel');
    if (ql) ql.textContent = `${val}s · 自定义`;
    const hv = document.getElementById('intervalAutoHintValue');
    if (hv) hv.textContent = val;
    addLogLine('INFO', `上报间隔快捷修改: ${val}s`);
  });

  // 通知开关
  document.getElementById('stgNotifySwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    // 如果勿扰模式已开启，阻止用户手动开启通知
    const dndSw = document.getElementById('stgDndSwitch');
    if (isOn && dndSw && dndSw.classList.contains('on')) {
      this.classList.remove('on');
      addLogLine('WARN', '勿扰模式已开启，无法开启通知');
      return;
    }
    await ipc.setConfig('enableNotification', isOn);
  });

  // 勿扰模式（同步 Windows 免打扰）
  let _dndUserAction = false; // 用户手动操作标记，跳过下一次轮询
  document.getElementById('stgDndSwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    _dndUserAction = true;
    await ipc.setConfig('doNotDisturb', isOn);
    const result = await ipc.setFocusAssist(isOn);
    // 勿扰开启时自动关闭通知开关，关闭时自动恢复
    const notifySw = document.getElementById('stgNotifySwitch');
    if (notifySw) {
      if (isOn) {
        notifySw.classList.remove('on');
        await ipc.setConfig('enableNotification', false);
      } else {
        notifySw.classList.add('on');
        await ipc.setConfig('enableNotification', true);
      }
    }
    if (result && result.ok) {
      addLogLine('INFO', `勿扰模式 → ${isOn ? '已开启（Windows 免打扰已同步，通知已自动关闭）' : '已关闭（通知已自动恢复）'}`);
    } else {
      addLogLine('WARN', `勿扰模式 → ${isOn ? '已开启' : '已关闭'}（Windows 免打扰同步失败）`);
    }
  });

  // 定时轮询 Windows 免打扰状态（每 30s），跟随系统侧变更
  setInterval(async () => {
    if (_dndUserAction) { _dndUserAction = false; return; }
    try {
      const fa = await ipc.getFocusAssist();
      if (!fa || !fa.ok) return;
      const sw = document.getElementById('stgDndSwitch');
      const curOn = sw ? sw.classList.contains('on') : false;
      if (fa.enabled !== curOn) {
        if (sw) sw.classList.toggle('on', fa.enabled);
        await ipc.setConfig('doNotDisturb', fa.enabled);
        // 同步通知开关状态
        const notifySw = document.getElementById('stgNotifySwitch');
        if (notifySw) {
          if (fa.enabled) {
            notifySw.classList.remove('on');
            await ipc.setConfig('enableNotification', false);
          } else {
            notifySw.classList.add('on');
            await ipc.setConfig('enableNotification', true);
          }
        }
      }
    } catch { /* ignore */ }
  }, 30000);

  // 隐身模式
  document.getElementById('stgIncognitoSwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    await ipc.setConfig('enableIncognito', isOn);
    addLogLine('INFO', `隐身模式 → ${isOn ? '已启用（截图将模糊处理）' : '已禁用'}`);
    // 隐身模式关闭时隐藏「设置隐私规则」按钮，卡片始终可见
    const privacyRulesBtn = document.getElementById('openPrivacyRulesBtn');
    if (privacyRulesBtn) privacyRulesBtn.style.display = isOn ? '' : 'none';
    const privacyBarTitle = document.getElementById('privacyBarTitle');
    const privacyBarDesc = document.getElementById('privacyBarDesc');
    const privacyBarIcon = document.getElementById('privacyBarIcon');
    if (privacyBarTitle) privacyBarTitle.textContent = isOn ? '隐私防护已启用' : '隐私防护未启用';
    if (privacyBarDesc) privacyBarDesc.textContent = isOn
      ? '匹配隐私规则的前台应用截图将自动模糊后再上传，截图仅上传至已配置的自有服务器。'
      : '隐身模式未开启，截图将正常上传。开启隐身模式后可配置隐私规则。';
    if (privacyBarIcon) privacyBarIcon.innerHTML = isOn
      ? '<i class="ph ph-shield-check"></i>'
      : '<i class="ph ph-shield-slash"></i>';
  });

  // 全局截图模糊开关（在隐私规则弹窗中）
  document.getElementById('blurAllSwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    await ipc.setConfig('blurAllScreenshots', isOn);
    addLogLine('INFO', `全局截图模糊 → ${isOn ? '已启用' : '已禁用'}`);
  });

  // 双重认证
  document.getElementById('stg2FASwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    await ipc.setConfig('enable2FA', isOn);
    addLogLine('INFO', `双重认证 → ${isOn ? '已启用' : '已禁用'}`);
  });

  // 玻璃拟态效果
  document.getElementById('stgGlassSwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    await ipc.setConfig('glassEffect', isOn);
    document.documentElement.classList.toggle('no-glass', !isOn);
    addLogLine('INFO', `玻璃拟态 → ${isOn ? '已启用' : '已禁用'}`);
  });

  // 深色模式手动开关
  document.getElementById('stgDarkSwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    const schedSwitch = document.getElementById('stgDarkScheduleSwitch');
    const isSchedule = schedSwitch?.classList.contains('on');
    // 手动切换时关闭定时
    if (isSchedule) {
      schedSwitch.classList.remove('on');
      document.getElementById('stgDarkTimeRow').style.display = 'none';
      await ipc.setConfig('themeMode', isOn ? 'dark' : 'light');
    } else {
      await ipc.setConfig('themeMode', isOn ? 'dark' : 'light');
    }
    applyThemeMode(isOn ? 'dark' : 'light',
      document.getElementById('stgDarkStartTime')?.value || '18:00',
      document.getElementById('stgDarkEndTime')?.value || '07:00');
  });

  // 定时自动切换开关
  document.getElementById('stgDarkScheduleSwitch')?.addEventListener('click', async function () {
    const isOn = this.classList.contains('on');
    const timeRow = document.getElementById('stgDarkTimeRow');
    if (timeRow) timeRow.style.display = isOn ? '' : 'none';
    const start = document.getElementById('stgDarkStartTime')?.value || '18:00';
    const end   = document.getElementById('stgDarkEndTime')?.value   || '07:00';
    const mode  = isOn ? 'auto' : (document.getElementById('stgDarkSwitch')?.classList.contains('on') ? 'dark' : 'light');
    await ipc.setConfig('themeMode', mode);
    applyThemeMode(mode, start, end);
    addLogLine('INFO', `定时深色模式 → ${isOn ? `${start}–${end}` : '已关闭'}`);
  });
  document.getElementById('stgDarkStartTime')?.addEventListener('change', async function () {
    await ipc.setConfig('darkModeStart', this.value);
    applyThemeMode('auto', this.value, document.getElementById('stgDarkEndTime')?.value || '07:00');
  });
  document.getElementById('stgDarkEndTime')?.addEventListener('change', async function () {
    await ipc.setConfig('darkModeEnd', this.value);
    applyThemeMode('auto', document.getElementById('stgDarkStartTime')?.value || '18:00', this.value);
  });

  // 界面缩放 — 步进按钮
  function _doScale(dir) {
    const newIdx = _scaleIdx + dir;
    if (newIdx < 0 || newIdx >= SCALE_STEPS.length) return;
    _scaleIdx = newIdx;
    const pct = SCALE_STEPS[_scaleIdx];
    const scaleLabel = document.getElementById('stgScaleLabel');
    const scaleDown  = document.getElementById('stgScaleDown');
    const scaleUp    = document.getElementById('stgScaleUp');
    if (scaleLabel) scaleLabel.textContent = pct + '%';
    if (scaleDown)  scaleDown.disabled  = _scaleIdx <= 0;
    if (scaleUp)    scaleUp.disabled    = _scaleIdx >= SCALE_STEPS.length - 1;
    ipc.setConfig('uiScale', pct);
    ipc.setZoom(pct / 100);
    addLogLine('INFO', `界面缩放 → ${pct}%`);
  }
  document.getElementById('stgScaleDown')?.addEventListener('click', () => _doScale(-1));
  document.getElementById('stgScaleUp')?.addEventListener('click',  () => _doScale(1));

  // 清理缓存（带旋转动画）
  document.getElementById('clearCacheBtn')?.addEventListener('click', async function () {
    if (this.classList.contains('loading')) return;
    this.classList.add('loading');
    const icon = document.getElementById('clearCacheIcon');
    if (icon) { icon.className = 'ph ph-spinner'; icon.classList.add('spinning'); }
    const label = this.childNodes[this.childNodes.length - 1];
    if (label) label.textContent = ' 清理中…';
    try {
      const result = await ipc.clearCache();
      if (result.success) {
        addLogLine('SUCCESS', '缓存已清理');
        if (icon) { icon.className = 'ph ph-check-circle'; icon.classList.remove('spinning'); }
        if (label) label.textContent = ' 已完成';
        const cacheDesc = document.getElementById('cacheSizeDesc');
        if (cacheDesc) cacheDesc.textContent = '会话缓存（图片、脚本等）· 当前 0 MB';
        await new Promise(r => setTimeout(r, 1200));
      } else {
        addLogLine('ERROR', `清理失败: ${result.error}`);
      }
    } catch (e) {
      addLogLine('ERROR', `清理失败: ${e.message}`);
    }
    if (icon) { icon.className = 'ph ph-broom'; icon.classList.remove('spinning'); }
    if (label) label.textContent = ' 清理缓存';
    this.classList.remove('loading');
  });

  // 启动延迟
  document.getElementById('startDelayInput')?.addEventListener('change', async function () {
    const val = parseInt(this.value, 10);
    if (!isNaN(val) && val >= 0) {
      await ipc.setConfig('startupDelayMs', val * 1000);
      addLogLine('INFO', `启动延迟已设为 ${val} 秒`);
    }
  });

  // 最大重启次数
  document.getElementById('maxRestartsInput')?.addEventListener('change', async function () {
    const val = parseInt(this.value, 10);
    if (!isNaN(val) && val >= 1) {
      await ipc.setConfig('maxRestarts', val);
    }
  });

  // 重启间隔
  document.getElementById('restartIntervalInput')?.addEventListener('change', async function () {
    const val = parseInt(this.value, 10);
    const unit = document.getElementById('restartIntervalUnit')?.value || 's';
    const sec = unit === 'm' ? val * 60 : val;
    if (!isNaN(sec) && sec >= 5) {
      await ipc.setConfig('restartIntervalSec', sec);
    }
  });
  document.getElementById('restartIntervalUnit')?.addEventListener('change', () => {
    document.getElementById('restartIntervalInput')?.dispatchEvent(new Event('change'));
  });

  // 看门狗超时
  document.getElementById('watchdogTimeoutInput')?.addEventListener('change', async function () {
    const val = parseInt(this.value, 10);
    const unit = document.getElementById('watchdogUnit')?.value || 's';
    const sec = unit === 'm' ? val * 60 : val;
    if (!isNaN(sec) && sec >= 10) {
      await ipc.setConfig('watchdogTimeoutSec', sec);
    }
  });
  document.getElementById('watchdogUnit')?.addEventListener('change', () => {
    document.getElementById('watchdogTimeoutInput')?.dispatchEvent(new Event('change'));
  });

  // 截图模式持久化
  document.getElementById('screenshotModeGroup')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn || !btn.dataset.mode) return;
    await ipc.setConfig('screenshotMode', btn.dataset.mode);
    // 同步截图间隔设定
    if (btn.dataset.mode === 'auto') {
      await ipc.setConfig('syncScreenshotInterval', true);
    } else if (btn.dataset.mode === 'interval') {
      await ipc.setConfig('syncScreenshotInterval', false);
    }
  });

  // 截图间隔（预设按钮 + 自定义输入）持久化
  document.getElementById('intervalSelector')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.interval-btn');
    if (!btn || !btn.dataset.value) return;
    const sec = parseInt(btn.dataset.value, 10);
    if (!isNaN(sec) && sec >= 10) {
      await ipc.setConfig('screenshotInterval', sec);
    }
  });

  document.getElementById('customIntervalValue')?.addEventListener('change', async function () {
    const val = parseInt(this.value, 10);
    const unit = document.getElementById('customIntervalUnit')?.value || 's';
    let sec = val;
    if (unit === 'm') sec = val * 60;
    else if (unit === 'h') sec = val * 3600;
    if (!isNaN(sec) && sec >= 10) {
      await ipc.setConfig('screenshotInterval', sec);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  本地文件安装按钮
  // ══════════════════════════════════════════════════════════════
  document.getElementById('localInstallBtn')?.addEventListener('click', async () => {
    try {
      const filePath = await ipc.selectFile({
        title: '选择更新安装包',
        filters: [{ name: '安装包', extensions: ['exe', 'zip', '7z'] }],
      });
      if (!filePath) return;
      addLogLine('INFO', `选择本地安装包: ${filePath}`);
      const result = await ipc.installUpdate(filePath);
      if (result.success) {
        addLogLine('SUCCESS', '安装程序已启动');
      } else {
        addLogLine('ERROR', `安装失败: ${result.error}`);
      }
    } catch (e) {
      addLogLine('ERROR', `本地安装失败: ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  设置页 — 上报间隔 Stepper 同步到配置
  // ══════════════════════════════════════════════════════════════
  const reportIntervalInput = document.getElementById('reportAutoDelayInput');
  if (reportIntervalInput) {
    reportIntervalInput.addEventListener('change', async () => {
      const val = parseInt(reportIntervalInput.value, 10);
      if (!isNaN(val) && val >= 0) {
        await ipc.setConfig('reportInterval', val);
        addLogLine('INFO', `上报间隔已设为 ${val} 秒`);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  P2-8: 设备状态页面实时数据
  // ══════════════════════════════════════════════════════════════

  // 格式化字节数为人类可读
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }

  // 格式化网络速率 (bps → KB/s, MB/s)
  function formatBps(bps) {
    if (bps < 1024) return bps.toFixed(0) + ' B/s';
    if (bps < 1024 * 1024) return (bps / 1024).toFixed(1) + ' KB/s';
    return (bps / 1024 / 1024).toFixed(1) + ' MB/s';
  }

  function updateDeviceStatusPage(m) {
    if (!m) return;
    const kpiCards = document.querySelectorAll('#page-device-status .kpi-card');
    if (kpiCards.length < 4) return;

    // CPU
    const cpuValue = kpiCards[0].querySelector('.kpi-value');
    const cpuBadge = kpiCards[0].querySelector('.kpi-badge');
    if (cpuValue) cpuValue.innerHTML = `${m.cpuPct}<small>%</small>`;
    if (cpuBadge) {
      const level = m.cpuPct > 90 ? 'error' : m.cpuPct > 70 ? 'warn' : 'info';
      const text = m.cpuPct > 90 ? '过高' : m.cpuPct > 70 ? '偏高' : '正常';
      cpuBadge.className = `kpi-badge ${level}`;
      cpuBadge.textContent = text;
    }
    const cpuFooter = kpiCards[0].querySelector('.kpi-footer');
    if (cpuFooter && m.cpuModel) cpuFooter.textContent = `${m.cpuCores} 核 · ${m.cpuModel.split('@')[0].trim().slice(0, 30)}`;

    // 内存
    const memValue = kpiCards[1].querySelector('.kpi-value');
    const memBadge = kpiCards[1].querySelector('.kpi-badge');
    if (memValue) memValue.innerHTML = `${m.memPct}<small>%</small>`;
    if (memBadge) {
      const level = m.memPct > 90 ? 'error' : m.memPct > 80 ? 'warn' : 'info';
      const text = m.memPct > 90 ? '危险' : m.memPct > 80 ? '警告' : '正常';
      memBadge.className = `kpi-badge ${level}`;
      memBadge.textContent = text;
    }
    const memFooter = kpiCards[1].querySelector('.kpi-footer');
    if (memFooter) memFooter.textContent = `${formatBytes(m.memUsed)} / ${formatBytes(m.memTotal)}`;

    // 网络
    const netValue = kpiCards[2].querySelector('.kpi-value') || kpiCards[2].querySelector('.kpi-value-sm');
    const netBadge = kpiCards[2].querySelector('.kpi-badge');
    if (netValue) {
      const lat = m.networkLatency;
      netValue.innerHTML = lat >= 0 ? `${lat} <span class="kpi-value-unit">ms 延迟</span>` : `— <span class="kpi-value-unit">不可达</span>`;
    }
    if (netBadge) {
      const level = m.networkLatency < 0 ? 'error' : m.networkLatency > 200 ? 'warn' : 'success';
      const text = m.networkLatency < 0 ? '离线' : m.networkLatency > 200 ? '延迟高' : '正常';
      netBadge.className = `kpi-badge ${level}`;
      netBadge.textContent = text;
    }
    // 网络上传/下载速度
    const netSpeedFooter = document.getElementById('netSpeedFooter');
    if (netSpeedFooter && (m.netDownBps != null || m.netUpBps != null)) {
      const down = formatBps(m.netDownBps || 0);
      const up   = formatBps(m.netUpBps || 0);
      netSpeedFooter.innerHTML = `<i class="ph ph-arrow-down"></i> ${down} &nbsp;&nbsp; <i class="ph ph-arrow-up"></i> ${up}`;
    }

    // 电量 — 从最近的 service:tick 或 battery 查询获取，这里仅更新运行时间
    const batFooter = kpiCards[3].querySelector('.kpi-footer');
    if (batFooter && m.uptime) {
      const hr = Math.floor(m.uptime / 3600);
      const min = Math.floor((m.uptime % 3600) / 60);
      batFooter.textContent = `系统运行: ${hr}h ${min}m`;
    }

    // 设备元信息 — 仅更新操作系统，指纹由 init 时设置
    const metaOSEl = document.getElementById('metaOS');
    if (metaOSEl && m.osFriendlyName) metaOSEl.textContent = `${m.osFriendlyName} (${m.arch})`;
    else if (metaOSEl && m.osRelease) metaOSEl.textContent = `Windows ${m.osRelease} (${m.arch})`;

    // 更新迷你 Sparkline
    _updateSparklines(m);
  }

  // ══════════════════════════════════════════════════════════════
  //  迷你 Sparkline 折线（KPI 卡片内嵌小图表）
  // ══════════════════════════════════════════════════════════════
  const SPARK_MAX = 30; // 保留最近 30 个点
  const _sparkData = { cpu: [], mem: [] };
  const _sparkCharts = {};

  function _createSparkline(canvasId, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: Array(SPARK_MAX).fill(''),
        datasets: [{
          data: [],
          borderColor: color,
          backgroundColor: color.replace(')', ', 0.12)').replace('rgb', 'rgba'),
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, min: 0, max: 100 }
        },
        animation: { duration: 300 },
        elements: { line: { borderCapStyle: 'round' } },
      }
    });
  }

  function _initSparklines() {
    if (_sparkCharts.cpu) return; // 已初始化
    const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() || 'rgb(99,102,241)';
    _sparkCharts.cpu = _createSparkline('sparkCpu', themeColor);
    _sparkCharts.mem = _createSparkline('sparkMem', 'rgb(245, 158, 11)');
  }

  function _updateSparklines(m) {
    _initSparklines();
    if (m.cpuPct != null) _sparkData.cpu.push(m.cpuPct);
    if (m.memPct != null) _sparkData.mem.push(m.memPct);
    if (_sparkData.cpu.length > SPARK_MAX) _sparkData.cpu.shift();
    if (_sparkData.mem.length > SPARK_MAX) _sparkData.mem.shift();

    if (_sparkCharts.cpu) {
      _sparkCharts.cpu.data.labels = _sparkData.cpu.map(() => '');
      _sparkCharts.cpu.data.datasets[0].data = [..._sparkData.cpu];
      _sparkCharts.cpu.update('none');
    }
    if (_sparkCharts.mem) {
      _sparkCharts.mem.data.labels = _sparkData.mem.map(() => '');
      _sparkCharts.mem.data.datasets[0].data = [..._sparkData.mem];
      _sparkCharts.mem.update('none');
    }
  }

  // 监听指标推送
  ipc.on('system:metricsUpdate', (m) => {
    updateDeviceStatusPage(m);
    // 指标阈值 → 诊断日志
    _checkMetricThresholds(m);
  });

  // ══════════════════════════════════════════════════════════════
  //  历史状态诊断日志（动态渲染至 #historyTableBody）
  // ══════════════════════════════════════════════════════════════
  const _diagEntries = [];
  const DIAG_MAX = 20;
  let _lastMemWarn = 0;
  let _lastCpuWarn = 0;

  function _formatDiagTime(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function addDiagnosticEntry(module, status, detail, actionHtml) {
    const entry = { time: Date.now(), module, status, detail, actionHtml: actionHtml || '—' };
    _diagEntries.unshift(entry);
    if (_diagEntries.length > DIAG_MAX) _diagEntries.pop();
    _renderDiagTable();
    _pushDashboardEvent(status, `[${module}] ${detail}`);
  }

  // 仪表盘最近事件卡片同步
  const DASH_EVENT_MAX = 20;
  function _pushDashboardEvent(status, text) {
    const list = document.getElementById('dashEventList');
    if (!list) return;
    // 首次清除空态
    const emptyHint = list.querySelector('.event-empty-hint');
    if (emptyHint) emptyHint.remove();
    // 创建事件行
    const dotClass = status === 'success' ? 'info' : status === 'warn' ? 'warn' : 'error';
    const timeStr = new Date().toTimeString().slice(0, 5);
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `<span class="event-time">${timeStr}</span><div class="event-dot ${dotClass}"></div><span class="event-desc">${escapeHtml(text)}</span>`;
    list.insertBefore(item, list.firstChild);
    while (list.children.length > DASH_EVENT_MAX) list.removeChild(list.lastChild);
  }

  function _renderDiagTable() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    tbody.innerHTML = _diagEntries.map(e => `
      <tr data-status="${e.status}">
        <td>${_formatDiagTime(e.time)}</td>
        <td>${escapeHtml(e.module)}</td>
        <td><span class="status-badge ${e.status}">${e.status === 'success' ? '正常' : e.status === 'warn' ? '警告' : '错误'}</span></td>
        <td>${escapeHtml(e.detail)}</td>
        <td class="col-action">${e.actionHtml}</td>
      </tr>`).join('');
    // 重新应用当前筛选
    _applyHistoryFilter();
  }

  function _applyHistoryFilter() {
    const activeBtn = document.querySelector('#historyFilterGroup .filter-segmented-btn.active');
    const filter = activeBtn ? activeBtn.dataset.filter : 'all';
    const rows = document.querySelectorAll('#historyTableBody tr');
    rows.forEach(row => {
      row.style.display = (filter === 'all' || row.dataset.status === filter) ? '' : 'none';
    });
  }

  function _checkMetricThresholds(m) {
    const now = Date.now();
    // 内存超过 85% 且距上次警告 > 3 分钟
    if (m.memPct > 85 && now - _lastMemWarn > 180000) {
      _lastMemWarn = now;
      addDiagnosticEntry('内存监控', 'warn', `系统内存占用超阈值 (${m.memPct}%)`, '<button class="action-btn x-small">忽略</button>');
      ipc.notify('内存警告', `系统内存占用 ${m.memPct}%，已超过 85% 阈值`);
    }
    // CPU 超过 90%
    if (m.cpuPct > 90 && now - _lastCpuWarn > 180000) {
      _lastCpuWarn = now;
      addDiagnosticEntry('CPU 监控', 'warn', `CPU 负载过高 (${m.cpuPct}%)`, '<button class="action-btn x-small">忽略</button>');
      ipc.notify('CPU 警告', `CPU 负载 ${m.cpuPct}%，已超过 90% 阈值`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  P2-9: 仪表盘图表（Chart.js 简易实现 — 使用 Canvas 绘制）
  // ══════════════════════════════════════════════════════════════
  const CHART_MAX_POINTS = 60;
  const chartData = { cpu: [], mem: [], timestamps: [] };
  let chartTimeRange = '1h'; // '1h' | '6h' | '24h'

  function drawChart() {
    const container = document.querySelector('#card-chart .chart-placeholder');
    if (!container) return;

    // 用 canvas 替换占位文字
    let canvas = container.querySelector('canvas');
    if (!canvas) {
      container.innerHTML = '';
      canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      container.appendChild(canvas);
    }

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    const W = rect.width, H = rect.height;

    ctx.clearRect(0, 0, W, H);

    const data = chartData;
    if (data.cpu.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('等待数据采集...', W / 2, H / 2);
      return;
    }

    const pad = { top: 20, right: 16, bottom: 28, left: 40 };
    const cW = W - pad.left - pad.right;
    const cH = H - pad.top - pad.bottom;

    // Y 轴 0-100%
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let v = 0; v <= 100; v += 25) {
      const y = pad.top + cH - (v / 100 * cH);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillText(v + '%', pad.left - 6, y + 3);
    }

    function drawLine(arr, color) {
      if (arr.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const step = cW / (arr.length - 1);
      arr.forEach((v, i) => {
        const x = pad.left + i * step;
        const y = pad.top + cH - (v / 100 * cH);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    drawLine(data.cpu, 'rgba(6,182,212,0.9)');  // 青色 = CPU
    drawLine(data.mem, 'rgba(168,85,247,0.9)');  // 紫色 = 内存

    // 图例
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(6,182,212,0.9)';
    ctx.textAlign = 'left';
    ctx.fillText('● CPU', pad.left + 4, H - 6);
    ctx.fillStyle = 'rgba(168,85,247,0.9)';
    ctx.fillText('● 内存', pad.left + 60, H - 6);
  }

  // 接收指标推送 → 更新图表数据
  ipc.on('system:metricsUpdate', (m) => {
    chartData.cpu.push(m.cpuPct);
    chartData.mem.push(m.memPct);
    chartData.timestamps.push(m.timestamp || Date.now());

    // 根据时间范围限制点数
    const maxMap = { '1h': 360, '6h': 2160, '24h': 8640 };
    const max = maxMap[chartTimeRange] || 360;
    while (chartData.cpu.length > max) { chartData.cpu.shift(); chartData.mem.shift(); chartData.timestamps.shift(); }

    drawChart();
  });

  // 时间范围切换按钮
  document.querySelectorAll('#card-chart .toggle-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#card-chart .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chartTimeRange = btn.textContent.trim().toLowerCase();

      // 从主进程获取历史数据
      const history = await ipc.getMetricsHistory();
      chartData.cpu = history.map(h => h.cpuPct);
      chartData.mem = history.map(h => h.memPct);
      chartData.timestamps = history.map(h => h.timestamp);
      drawChart();
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  P2-11: 历史诊断筛选器交互
  // ══════════════════════════════════════════════════════════════
  const historyFilterGroup = document.getElementById('historyFilterGroup');
  if (historyFilterGroup) {
    historyFilterGroup.querySelectorAll('.filter-segmented-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        historyFilterGroup.querySelectorAll('.filter-segmented-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const filter = btn.dataset.filter;
        const rows = document.querySelectorAll('#historyTableBody tr');
        rows.forEach((row) => {
          if (filter === 'all') { row.style.display = ''; return; }
          row.style.display = row.dataset.status === filter ? '' : 'none';
        });

        // 动画化 pill 滑块
        const pill = document.getElementById('historyFilterPill');
        if (pill) {
          const rect = btn.getBoundingClientRect();
          const parentRect = historyFilterGroup.getBoundingClientRect();
          pill.style.width = rect.width + 'px';
          pill.style.transform = `translateX(${rect.left - parentRect.left}px)`;
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  用户认证系统
  // ══════════════════════════════════════════════════════════════

  // ── 辅助：灵动岛通知（复用已有逻辑或简易版）──────────────────
  function showAuthNotice(msg, type = 'info') {
    // 尝试使用已有的灵动岛
    const island = document.getElementById('nekoIsland');
    if (island && typeof window._showIslandNotice === 'function') {
      window._showIslandNotice(msg, type);
      return;
    }
    // 降级方案：控制台
    addLogLine(type === 'error' ? 'ERROR' : 'INFO', msg);
  }

  // ── UI 状态更新 ────────────────────────────────────────────────
  function updateAuthUI(isLoggedIn, user) {
    const avatar = document.getElementById('userAvatar');
    const nameEl = document.getElementById('dropdownUsername');
    const roleEl = document.getElementById('dropdownRole');
    const loginBtn = document.getElementById('btnOpenLogin');
    const profileBtn = document.getElementById('btnProfileSettings');
    const logoutBtn = document.getElementById('btnLogout');
    const logoutDiv = document.getElementById('logoutDivider');
    const settingsAvatar = document.getElementById('settingsAvatar');
    const settingsName = document.querySelector('.settings-profile-name');
    const settingsSub = document.querySelector('.settings-profile-sub');

    if (isLoggedIn && user) {
      const displayName = user.username || 'User';
      const avatarUrl = user.avatar
        ? user.avatar
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=06b6d4&color=fff`;

      if (avatar) avatar.src = avatarUrl;
      if (nameEl) nameEl.textContent = displayName;
      if (roleEl) roleEl.textContent = user.role === 'admin' ? '管理员' : '已登录';
      if (loginBtn) loginBtn.style.display = 'none';
      if (profileBtn) profileBtn.style.display = '';
      if (logoutBtn) logoutBtn.style.display = '';
      if (logoutDiv) logoutDiv.style.display = '';
      if (settingsAvatar) settingsAvatar.src = avatarUrl;
      if (settingsName) settingsName.textContent = displayName;
      if (settingsSub) settingsSub.textContent = `已登录 · ${user.role === 'admin' ? '管理员' : '普通用户'}`;
    } else {
      if (avatar) avatar.src = 'https://api.dicebear.com/7.x/notionists/svg?seed=Guest&backgroundColor=0f172a';
      if (nameEl) nameEl.textContent = '未登录';
      if (roleEl) roleEl.textContent = '设备密钥模式';
      if (loginBtn) loginBtn.style.display = '';
      if (profileBtn) profileBtn.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (logoutDiv) logoutDiv.style.display = 'none';
      if (settingsName) settingsName.textContent = 'Neko User';
      if (settingsSub) settingsSub.textContent = '设备监控本地账户';
    }
  }

  // ── 认证弹窗逻辑 ──────────────────────────────────────────────
  const authModal = document.getElementById('authModal');
  const authLoginView = document.getElementById('authLoginView');
  const authRegisterView = document.getElementById('authRegisterView');

  function openAuthModal(mode = 'login') {
    if (!authModal) return;

    // 检查服务器配置状态，更新警告/标识显示
    (async () => {
      const state = await ipc.authGetState();
      const warningEl = document.getElementById('authServerWarning');
      const localBadge = document.getElementById('authLocalBadge');
      const loginBtn = document.getElementById('authLoginBtn');
      const regBtn = document.getElementById('authRegBtn');

      if (state.serverMode === 'local' && !state.serverConfigured) {
        // 本地测试模式，未连接服务器
        if (warningEl) warningEl.style.display = 'none';
        if (localBadge) localBadge.style.display = '';
        if (loginBtn) loginBtn.disabled = false;
        if (regBtn) regBtn.disabled = false;
      } else if (!state.serverConfigured) {
        // 生产模式但未配置服务器
        if (warningEl) warningEl.style.display = '';
        if (localBadge) localBadge.style.display = 'none';
        if (loginBtn) loginBtn.disabled = true;
        if (regBtn) regBtn.disabled = true;
      } else {
        // 服务器已配置
        if (warningEl) warningEl.style.display = 'none';
        if (localBadge) localBadge.style.display = 'none';
        if (loginBtn) loginBtn.disabled = false;
        if (regBtn) regBtn.disabled = false;
      }
    })();

    authModal.style.display = 'flex';
    if (mode === 'register') {
      authLoginView.style.display = 'none';
      authRegisterView.style.display = '';
    } else {
      authLoginView.style.display = '';
      authRegisterView.style.display = 'none';
    }
    // 清空错误和输入
    const errLogin = document.getElementById('authLoginError');
    const errReg = document.getElementById('authRegError');
    if (errLogin) errLogin.style.display = 'none';
    if (errReg) errReg.style.display = 'none';
  }

  function closeAuthModal() {
    if (authModal) authModal.style.display = 'none';
  }

  // ===== MOCK IPC — 直播推流（仅显式开启时使用）=====
  // 默认走真实主进程 IPC，只有手动设置 window.__NEKO_ENABLE_STREAM_MOCK__ = true 时才启用本地 Mock。
  if (window.__NEKO_ENABLE_STREAM_MOCK__ === true && window.nekoIPC) {
    // Mock 内存存储
    window._mockStreamConfig = {
      srsHost: '',
      srsRtmpPort: 1935,
      srsApp: 'live',
      srsApiPort: 1985,
      streamKey: '',
      obsWsHost: '127.0.0.1',
      obsWsPort: 4455,
      obsWsPassword: '',
    };

    window.nekoIPC.getStreamConfig = async () => ({ ...window._mockStreamConfig });

    window.nekoIPC.saveStreamConfig = async (cfg) => {
      Object.assign(window._mockStreamConfig, cfg);
      return { ok: true };
    };

    window.nekoIPC.getStreamKey = async () => ({ stream_key: window._mockStreamConfig.streamKey || '' });

    window.nekoIPC.resetStreamKey = async () => {
      const newKey = 'nk_mock_' + Math.random().toString(36).slice(2, 10);
      window._mockStreamConfig.streamKey = newKey;
      return { stream_key: newKey };
    };

    window.nekoIPC.getStreamLiveStatus = async () => 'idle';

    window.nekoIPC.testSrsConnection = async () => ({
      ok: false,
      reason: 'Mock 模式：尚无真实 SRS 服务器',
      rtmp_reachable: false,
      api_reachable: false,
    });

    window.nekoIPC.testObsWebSocket = async () => ({
      connected: false,
      reason: 'Mock 模式：尚无真实 OBS 进程',
    });

    window.nekoIPC.applyStreamConfigToObs = async () => ({
      ok: false,
      error: 'Mock 模式：尚无真实 OBS 进程',
    });

    window.nekoIPC.exportObsServiceConfig = async () =>
      'C:\\Users\\Demo\\Desktop\\neko-obs-stream-config.json';
  }
  // ===== END MOCK =====

  // 关闭按钮
  const closeAuthBtn = document.getElementById('closeAuthModal');
  if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuthModal);
  // 切换到注册
  const switchToReg = document.getElementById('switchToRegister');
  if (switchToReg) switchToReg.addEventListener('click', (e) => { e.preventDefault(); openAuthModal('register'); });
  // 切换到登录
  const switchToLog = document.getElementById('switchToLogin');
  if (switchToLog) switchToLog.addEventListener('click', (e) => { e.preventDefault(); openAuthModal('login'); });
  // 点击遮罩关闭
  if (authModal) authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });

  // auth modal 内「去配置」按钮 → 关闭 auth modal，打开 configModal
  const authOpenConfigBtn = document.getElementById('authOpenConfigBtn');
  if (authOpenConfigBtn) {
    authOpenConfigBtn.addEventListener('click', () => {
      closeAuthModal();
      // 标记来源，以便配置成功后重新打开 authModal
      window._authPendingAfterConfig = true;
      document.getElementById('stgConfigBtn')?.click();  // 触发已有的 loadConfigToModal + open modal 逻辑
      const cm = document.getElementById('configModal');
      if (cm) cm.classList.add('show');
    });
  }

  // 导航栏 "登录/注册" 按钮
  const btnOpenLogin = document.getElementById('btnOpenLogin');
  if (btnOpenLogin) btnOpenLogin.addEventListener('click', () => openAuthModal('login'));

  // ── 登录提交 ──────────────────────────────────────────────────
  const authLoginBtn = document.getElementById('authLoginBtn');
  if (authLoginBtn) {
    authLoginBtn.addEventListener('click', async () => {
      const username = document.getElementById('authLoginUsername')?.value?.trim();
      const password = document.getElementById('authLoginPassword')?.value;
      const errEl = document.getElementById('authLoginError');

      if (!username || !password) {
        if (errEl) { errEl.textContent = '请填写用户名和密码'; errEl.style.display = ''; }
        return;
      }

      authLoginBtn.disabled = true;
      authLoginBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 登录中...';

      const result = await ipc.authLogin(username, password);

      if (result.success) {
        closeAuthModal();
        updateAuthUI(true, result.user);
        const localHint = result.isLocal ? '（本地测试模式）' : '';
        showAuthNotice(`欢迎回来，${result.user.username}！${localHint}`, 'info');
        // 登录后自动检查设备密钥（仅在线模式）
        if (!result.isLocal) await autoProvisionDeviceKey();
      } else {
        const errMsg = result.message || '登录失败';
        if (errEl) { errEl.textContent = errMsg; errEl.style.display = ''; }
        addLogLine('ERROR', `登录失败: ${errMsg}`);
      }

      authLoginBtn.disabled = false;
      authLoginBtn.innerHTML = '<i class="ph ph-sign-in"></i> 登录';
    });
  }

  // Enter 键提交登录
  ['authLoginUsername', 'authLoginPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') authLoginBtn?.click(); });
  });

  // ── 注册提交 ──────────────────────────────────────────────────
  const authRegBtn = document.getElementById('authRegBtn');
  if (authRegBtn) {
    authRegBtn.addEventListener('click', async () => {
      const username = document.getElementById('authRegUsername')?.value?.trim();
      const password = document.getElementById('authRegPassword')?.value;
      const confirm = document.getElementById('authRegConfirm')?.value;
      const errEl = document.getElementById('authRegError');

      if (!username || !password) {
        if (errEl) { errEl.textContent = '请填写用户名和密码'; errEl.style.display = ''; }
        return;
      }
      if (password !== confirm) {
        if (errEl) { errEl.textContent = '两次输入的密码不一致'; errEl.style.display = ''; }
        return;
      }

      authRegBtn.disabled = true;
      authRegBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 注册中...';

      const result = await ipc.authRegister(username, password);

      if (result.success) {
        closeAuthModal();
        updateAuthUI(true, result.user);
        const localHint = result.isLocal ? '（本地测试模式）' : '';
        showAuthNotice(`注册成功！欢迎，${result.user.username}${localHint}`, 'info');
        // 注册后自动生成设备密钥（仅在线模式）
        if (!result.isLocal) await autoProvisionDeviceKey();
      } else {
        const errMsg = result.message || '注册失败';
        if (errEl) { errEl.textContent = errMsg; errEl.style.display = ''; }
        addLogLine('ERROR', `注册失败: ${errMsg}`);
      }

      authRegBtn.disabled = false;
      authRegBtn.innerHTML = '<i class="ph ph-user-plus"></i> 注册';
    });
  }

  // Enter 键提交注册
  ['authRegUsername', 'authRegPassword', 'authRegConfirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') authRegBtn?.click(); });
  });

  // ── 退出登录 ──────────────────────────────────────────────────
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await ipc.authLogout();
      updateAuthUI(false, null);
      showAuthNotice('已退出登录，当前使用设备密钥模式', 'info');
    });
  }

  // ── 自动配置设备密钥 ──────────────────────────────────────────
  async function autoProvisionDeviceKey() {
    const currentKey = await ipc.getConfig('deviceKey');

    // 已有密钥 → 先验证其有效性，有效则直接跳过
    if (currentKey) {
      try {
        const validation = await ipc.validateKey();
        if (validation.valid) {
          addLogLine('INFO', '当前设备密钥有效，跳过自动生成');
          return;
        }
        // 密钥无效（被撤销、设备已删除等）→ 继续生成新密钥
        addLogLine('WARN', `当前密钥已失效（${validation.error || '未知原因'}），将为当前账户重新生成`);
      } catch {
        // 验证请求失败（网络等问题）→ 保守处理，保留现有密钥
        addLogLine('WARN', '无法验证现有密钥（网络异常），保留当前密钥');
        return;
      }
    } else {
      addLogLine('INFO', '检测到未配置设备密钥，正在自动为当前设备生成...');
    }

    const result = await ipc.authGenerateDeviceKey();
    if (result.success && result.deviceKey) {
      // deviceKey 已由主进程 IPC handler 自动写入 configStore
      const keyInputEl = document.getElementById('inputDeviceKey');
      if (keyInputEl) keyInputEl.value = result.deviceKey;

      const msg = result.isExisting
        ? `已自动恢复此设备的密钥: ${result.deviceKey}`
        : `已自动为此设备生成新密钥: ${result.deviceKey}`;

      addLogLine('INFO', msg);
      showAuthNotice(`${msg}，已自动填入服务器配置`, 'info');

      // 通知系统
      ipc.notify('设备密钥已自动配置', msg);
    } else {
      addLogLine('WARN', '自动生成设备密钥失败: ' + (result.message || '未知错误'));
    }
  }

  // ── 个人信息编辑（对接服务端同步）───────────────────────────
  const profileModal = document.getElementById('profileModal');
  const openProfileBtns = [
    document.getElementById('btnProfileSettings'),
    document.getElementById('openProfileBtnSettings'),
  ].filter(Boolean);

  openProfileBtns.forEach(btn => {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', async () => {
      // 先从服务端刷新用户信息
      const state = await ipc.authGetState();
      if (!state.isLoggedIn) {
        showAuthNotice('请先登录后再编辑个人信息', 'info');
        openAuthModal('login');
        return;
      }

      const me = await ipc.authGetMe();
      if (me.success && me.user) {
        const u = me.user;
        const pUsername = document.getElementById('profileUsername');
        const pEmail = document.getElementById('profileEmail');
        const pAvatar = document.getElementById('profileModalAvatar');
        if (pUsername) pUsername.value = u.username || '';
        if (pEmail) pEmail.value = u.email || '';
        if (pAvatar && u.avatar) pAvatar.src = u.avatar;
        else if (pAvatar) pAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}&background=06b6d4&color=fff`;
      }

      if (profileModal) profileModal.classList.add('show');
    });
  });

  // 保存个人信息
  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) {
    const clone = saveProfileBtn.cloneNode(true);
    saveProfileBtn.parentNode.replaceChild(clone, saveProfileBtn);
    clone.addEventListener('click', async () => {
      const username = document.getElementById('profileUsername')?.value?.trim();
      const email = document.getElementById('profileEmail')?.value?.trim();
      const currentPassword = document.getElementById('profileCurrentPassword')?.value;
      const newPassword = document.getElementById('profileNewPassword')?.value;

      const data = {};
      if (username) data.username = username;
      if (email !== undefined) data.email = email;
      if (currentPassword && newPassword) {
        data.currentPassword = currentPassword;
        data.newPassword = newPassword;
      }

      clone.disabled = true;
      clone.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';

      const result = await ipc.authUpdateProfile(data);

      if (result.success) {
        showAuthNotice('个人信息已更新并同步到服务器', 'info');
        if (result.user) updateAuthUI(true, result.user);
        if (profileModal) profileModal.classList.remove('show');
        // 清空密码字段
        const cp = document.getElementById('profileCurrentPassword');
        const np = document.getElementById('profileNewPassword');
        if (cp) cp.value = '';
        if (np) np.value = '';
      } else {
        showAuthNotice(result.message || '保存失败', 'error');
      }

      clone.disabled = false;
      clone.innerHTML = '<i class="ph ph-check-circle"></i> 保存更改';
    });
  }

  // ── 首次使用引导提示 ──────────────────────────────────────────
  async function checkFirstTimeAuthPrompt() {
    const state = await ipc.authGetState();
    if (state.isLoggedIn) {
      // 已登录 — 更新 UI，验证 token 有效性
      updateAuthUI(true, state.user);
      // 本地测试 token 无需远程验证
      if (state.user?.id?.startsWith('local-')) return;
      // 静默刷新用户信息
      const me = await ipc.authGetMe();
      if (me.success && me.user) {
        updateAuthUI(true, me.user);
      } else if (!me.success) {
        // token 过期了
        updateAuthUI(false, null);
        showAuthNotice('登录已过期，请重新登录', 'info');
      }
      return;
    }

    updateAuthUI(false, null);

    // 未登录且未曾关闭提示
    if (!state.promptDismissed) {
      const prompt = document.getElementById('firstTimeAuthPrompt');
      const step1 = document.getElementById('firstTimeStep1');
      const step2 = document.getElementById('firstTimeStep2');
      if (prompt) {
        prompt.style.display = 'flex';
        if (state.serverConfigured) {
          // 服务器已配置，直接展示 Step 2（登录/注册）
          if (step1) step1.style.display = 'none';
          if (step2) step2.style.display = '';
        } else {
          // 服务器未配置，展示 Step 1（配置服务器）
          if (step1) step1.style.display = '';
          if (step2) step2.style.display = 'none';
          // 预填充默认服务器地址
          const urlInput = document.getElementById('firstTimeServerUrl');
          if (urlInput) {
            const cfg = await ipc.getAllConfig();
            if (cfg) {
              urlInput.value = cfg.serverMode === 'local'
                ? (cfg.serverUrlLocal || '')
                : (cfg.serverUrlProd || '');
            }
          }
        }
      }
    }
  }

  // Step 1 — "跳过" 按钮
  const firstTimeSkipBtn = document.getElementById('firstTimeSkipBtn');
  if (firstTimeSkipBtn) {
    firstTimeSkipBtn.addEventListener('click', async () => {
      await ipc.authDismissPrompt();
      const prompt = document.getElementById('firstTimeAuthPrompt');
      if (prompt) prompt.style.display = 'none';
    });
  }

  // Step 1 — "测试并继续" 按钮（内嵌服务器地址测试）
  const firstTimeTestBtn = document.getElementById('firstTimeTestBtn');
  if (firstTimeTestBtn) {
    firstTimeTestBtn.addEventListener('click', async () => {
      const urlInput = document.getElementById('firstTimeServerUrl');
      const statusEl = document.getElementById('firstTimeServerStatus');
      const serverUrl = urlInput?.value?.trim();

      if (!serverUrl) {
        if (statusEl) {
          statusEl.textContent = '请输入服务器地址';
          statusEl.className = 'first-time-server-status first-time-status-error';
        }
        return;
      }

      firstTimeTestBtn.disabled = true;
      firstTimeTestBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 测试中...';
      if (statusEl) {
        statusEl.textContent = '正在测试连接...';
        statusEl.className = 'first-time-server-status first-time-status-testing';
      }

      try {
        const connResult = await ipc.testConnection(serverUrl);

        if (connResult.ok) {
          // 保存到配置（与 configModal 同步）
          const isLocal = serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1');
          const configUpdate = {
            serverMode: isLocal ? 'local' : 'production',
            serverConfigured: true,
          };
          if (isLocal) configUpdate.serverUrlLocal = serverUrl;
          else configUpdate.serverUrlProd = serverUrl;
          await ipc.setManyConfig(configUpdate);

          if (statusEl) {
            statusEl.textContent = `连接成功！延迟 ${connResult.latencyMs || '—'}ms`;
            statusEl.className = 'first-time-server-status first-time-status-success';
          }
          addLogLine('SUCCESS', `服务器连接成功，延迟 ${connResult.latencyMs || '—'}ms`);

          // 延迟后过渡到 Step 2
          setTimeout(() => {
            const step1 = document.getElementById('firstTimeStep1');
            const step2 = document.getElementById('firstTimeStep2');
            if (step1) step1.style.display = 'none';
            if (step2) step2.style.display = '';
          }, 800);
        } else {
          if (statusEl) {
            statusEl.textContent = `连接失败: ${connResult.error || '无法连接'}`;
            statusEl.className = 'first-time-server-status first-time-status-error';
          }
          addLogLine('ERROR', `服务器连接失败: ${connResult.error || '无法连接'}`);
        }
      } catch (e) {
        if (statusEl) {
          statusEl.textContent = `错误: ${e.message}`;
          statusEl.className = 'first-time-server-status first-time-status-error';
        }
      }

      firstTimeTestBtn.disabled = false;
      firstTimeTestBtn.innerHTML = '<i class="ph ph-plugs"></i> 测试并继续';
    });
  }

  // Enter 键提交服务器地址
  const firstTimeUrlInput = document.getElementById('firstTimeServerUrl');
  if (firstTimeUrlInput) {
    firstTimeUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') firstTimeTestBtn?.click();
    });
  }

  // Step 2 — "跳过" 按钮
  const firstTimeSkipStep2Btn = document.getElementById('firstTimeSkipStep2Btn');
  if (firstTimeSkipStep2Btn) {
    firstTimeSkipStep2Btn.addEventListener('click', async () => {
      await ipc.authDismissPrompt();
      const prompt = document.getElementById('firstTimeAuthPrompt');
      if (prompt) prompt.style.display = 'none';
    });
  }

  // Step 2 — "登录/注册" 按钮
  const firstTimeLoginBtn = document.getElementById('firstTimeLoginBtn');
  if (firstTimeLoginBtn) {
    firstTimeLoginBtn.addEventListener('click', async () => {
      await ipc.authDismissPrompt();
      const prompt = document.getElementById('firstTimeAuthPrompt');
      if (prompt) prompt.style.display = 'none';
      openAuthModal('login');
    });
  }

  // 启动时检查认证状态
  checkFirstTimeAuthPrompt();

  addLogLine('INFO', 'UI 后端连接初始化完成，等待主进程推送...');
});

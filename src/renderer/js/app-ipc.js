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
    const colorMap = { INFO: 'var(--theme-color)', WARN: 'var(--warning-amber)', ERROR: 'var(--error-coral)', SUCCESS: 'var(--success-mint)' };
    const color = colorMap[level] || 'var(--text-secondary)';

    const line = document.createElement('div');
    line.className = 'log-line';
    line.dataset.level = level;
    line.innerHTML =
      `<span class="log-time">[${timeStr}]</span> ` +
      `<span class="log-level" style="color:${color};">[${level}]</span> ` +
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

  function applyServiceState(isRunning) {
    // 顶栏状态点
    if (deviceStatusDot) {
      deviceStatusDot.classList.toggle('error', !isRunning);
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

    // 电量卡
    if (data.batteryLevel !== undefined) {
      const battValue = document.querySelector('#card-battery .metric-value');
      if (battValue) battValue.textContent = `${data.batteryLevel}%`;

      const battTrend = document.querySelector('#card-battery .metric-trend');
      if (battTrend) {
        battTrend.innerHTML = data.isCharging
          ? '<i class="ph ph-plug"></i> 交流电已连接'
          : '<i class="ph ph-battery-medium"></i> 使用电池供电';
      }
    }

    // 活动流 — 追加新条目
    if (data.success && data.appName) {
      appendActivityItem('app', data.appName, data.packageName || '', 'NOW');
    }
  }

  function appendActivityItem(type, main, sub, time) {
    const list = document.getElementById('activityList');
    if (!list) return;

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

    // 超过 50 条则移除末尾
    while (list.children.length > 50) list.removeChild(list.lastChild);
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
      } else {
        const cfg = await ipc.getAllConfig();
        if (!cfg.deviceKey) {
          addLogLine('WARN', '请先在配置中填写设备密钥，再启动上报服务');
          applyServiceState(false);
          return;
        }
        await ipc.startService();
        addLogLine('INFO', '已手动启动上报服务');
      }
    } catch (e) {
      addLogLine('ERROR', `服务切换失败: ${e.message}`);
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
        saveBtn.style.cssText = 'background:rgba(239,68,68,0.15);border-color:rgba(239,68,68,0.3);color:#ff6b6b;';
        addLogLine('ERROR', `服务器连接失败: ${connResult.error || '无法连接'}`);
        setTimeout(() => {
          saveBtn.innerHTML = originalHtml;
          saveBtn.style.cssText = '';
          saveBtn.disabled = false;
        }, 2500);
        return;
      }

      // 判断是本地还是生产模式
      const isLocal = serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1');
      const configUpdate = {
        deviceKey,
        serverMode: isLocal ? 'local' : 'production',
      };
      if (isLocal) configUpdate.serverUrlLocal = serverUrl;
      else configUpdate.serverUrlProd = serverUrl;

      await ipc.setManyConfig(configUpdate);

      saveBtn.innerHTML = '<i class="ph ph-check"></i> 已保存';
      saveBtn.style.cssText = 'background:rgba(var(--theme-color-rgb,6,182,212),0.15);border-color:rgba(var(--theme-color-rgb,6,182,212),0.4);color:var(--theme-color);';
      addLogLine('SUCCESS', `配置已保存，服务器延迟 ${connResult.latencyMs || '—'}ms`);

      setTimeout(() => {
        document.getElementById('configModal')?.classList.remove('show');
        setTimeout(() => {
          saveBtn.innerHTML = originalHtml;
          saveBtn.style.cssText = '';
          saveBtn.disabled = false;
        }, 300);
      }, 800);

    } catch (e) {
      saveBtn.innerHTML = '<i class="ph ph-x-circle"></i> 出错了';
      addLogLine('ERROR', `保存配置出错: ${e.message}`);
      setTimeout(() => {
        saveBtn.innerHTML = originalHtml;
        saveBtn.style.cssText = '';
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
      // 同步到设置页
      const stgSwitch = document.getElementById('stgAutoStartSwitch');
      if (stgSwitch) stgSwitch.classList.toggle('on', newState);
    } catch (e) {
      addLogLine('ERROR', `自启设置失败: ${e.message}`);
    }
  });

  // 设置页自启开关
  document.getElementById('stgAutoStartSwitch')?.addEventListener('click', async function () {
    const newState = this.classList.contains('on');
    try {
      if (newState) await ipc.enableAutoStart();
      else await ipc.disableAutoStart();
      addLogLine('INFO', `开机自启 → ${newState ? '已启用' : '已禁用'}`);
      const svcSwitch = document.getElementById('autoStartSwitch');
      if (svcSwitch) svcSwitch.classList.toggle('on', newState);
    } catch (e) {
      addLogLine('ERROR', `自启设置失败: ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  截图开关联动
  // ══════════════════════════════════════════════════════════════
  document.getElementById('toggleScreenshot')?.addEventListener('click', async function () {
    const enabled = this.classList.contains('on');
    await ipc.setConfig('enableScreenshot', enabled);
    addLogLine('INFO', `截图上报 → ${enabled ? '已启用' : '已禁用'}`);
  });

  // 截图页上传开关
  document.getElementById('uploadSwitch')?.addEventListener('click', async function () {
    const enabled = this.classList.contains('on');
    await ipc.setConfig('enableScreenshot', enabled);
  });

  // ══════════════════════════════════════════════════════════════
  //  "立即截图"按钮
  // ══════════════════════════════════════════════════════════════
  async function triggerScreenshot() {
    addLogLine('INFO', '正在截图...');
    const result = await ipc.captureScreen();
    if (!result) {
      addLogLine('ERROR', '截图失败或功能不可用');
      return null;
    }
    const bytes = new Uint8Array(result.data);
    const blob = new Blob([bytes], { type: result.type });
    const url = URL.createObjectURL(blob);

    addLogLine('SUCCESS', `截图完成，大小 ${(bytes.length / 1024).toFixed(1)} KB`);
    appendActivityItem('capture', '截图完成', `${(bytes.length / 1024).toFixed(0)} KB · PNG`, nowStr());

    // 更新截图预览
    const frame = document.querySelector('.screenshot-frame');
    if (frame) {
      frame.style.backgroundImage = `url(${url})`;
      frame.style.backgroundSize = 'cover';
      frame.style.backgroundPosition = 'center';
      const placeholder = frame.querySelector('.screenshot-placeholder');
      if (placeholder) placeholder.style.display = 'none';
      const overlay = frame.querySelector('.screenshot-frame-overlay');
      if (overlay) overlay.style.display = 'flex';
    }
    return url;
  }

  document.getElementById('captureNowBtn')?.addEventListener('click', triggerScreenshot);

  // ══════════════════════════════════════════════════════════════
  //  更新中心按钮
  // ══════════════════════════════════════════════════════════════
  replaceHandler('checkUpdateBtn', async () => {
    const btn = document.getElementById('checkUpdateBtn');
    const icon = document.getElementById('checkUpdateIcon');
    const badge = document.getElementById('updateStatusBadge');
    if (!btn) return;

    btn.disabled = true;
    if (icon) icon.className = 'ph ph-circle-notch';
    if (icon) icon.style.animation = 'spin 0.8s linear infinite';

    try {
      const result = await ipc.checkUpdate();
      btn.disabled = false;
      if (icon) { icon.className = 'ph ph-arrows-clockwise'; icon.style.animation = ''; }

      if (result.error) {
        if (badge) { badge.className = 'update-status-badge error'; badge.innerHTML = `<i class="ph ph-warning"></i> 检查失败`; }
        addLogLine('ERROR', `检查更新失败: ${result.error}`);
        return;
      }

      if (result.hasUpdate) {
        if (badge) { badge.className = 'update-status-badge warn'; badge.innerHTML = `<i class="ph ph-arrow-circle-up"></i> 发现新版本 v${result.latestVersion}`; }
        addLogLine('INFO', `发现新版本 v${result.latestVersion}（当前 v${result.currentVersion}）`);
      } else {
        if (badge) { badge.className = 'update-status-badge success'; badge.innerHTML = `<i class="ph ph-check-circle"></i> 已是最新`; }
        addLogLine('INFO', `当前已是最新版本 v${result.currentVersion}`);
      }

      // 更新版本显示
      const verNumber = document.querySelector('.update-ver-number');
      if (verNumber && result.currentVersion) verNumber.textContent = `v${result.currentVersion}`;

    } catch (e) {
      btn.disabled = false;
      if (icon) { icon.className = 'ph ph-arrows-clockwise'; icon.style.animation = ''; }
      addLogLine('ERROR', `检查更新异常: ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  About 页面外部链接
  // ══════════════════════════════════════════════════════════════
  ['aboutGithubBtn', 'aboutReleaseBtn'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      e.preventDefault();
      const url = e.currentTarget.href || e.currentTarget.getAttribute('href');
      if (url && url !== '#') ipc.openExternal(url);
    });
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

    // 更新顶栏设备徽标
    const badge = document.querySelector('.device-badge');
    if (badge && data.deviceName) {
      badge.innerHTML = `<div class="status-dot" id="deviceStatusDot"></div>${escapeHtml(data.deviceName)}`;
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

    // 更新关于页版本
    const aboutVerEl = document.querySelector('.about-info-value');
    if (aboutVerEl && aboutVerEl.closest('.about-info-card')?.querySelector('.about-info-label')?.textContent.includes('版本')) {
      aboutVerEl.textContent = `v${data.version}`;
    }
    const updateVerEl = document.querySelector('.update-ver-number');
    if (updateVerEl) updateVerEl.textContent = `v${data.version}`;
  });

  // 上报成功 Tick
  ipc.on('service:tick', (data) => {
    updateDashboardCards(data);
    if (data.success === false && data.reason === 'no_key') {
      // 密钥未配置时不打印过多日志
    }
  });

  // 服务启停状态变化
  ipc.on('service:statusChanged', (data) => {
    applyServiceState(data.isRunning);
  });

  // 日志条目（来自主进程 StatusService）
  ipc.on('log:entry', (data) => {
    addLogLine(data.level, data.msg, data.time);
  });

  // ══════════════════════════════════════════════════════════════
  //  设置页 — 保存设置按钮（上报间隔等）
  // ══════════════════════════════════════════════════════════════
  // 上报间隔 Stepper 同步到配置
  const reportIntervalInput = document.getElementById('reportAutoDelayInput');
  if (reportIntervalInput) {
    reportIntervalInput.addEventListener('change', async () => {
      const val = parseInt(reportIntervalInput.value, 10);
      if (!isNaN(val) && val >= 0) {
        await ipc.setConfig('startupDelayMs', val * 1000);
      }
    });
  }

  addLogLine('INFO', 'UI 后端连接初始化完成，等待主进程推送...');
});

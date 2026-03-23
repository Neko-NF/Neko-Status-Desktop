const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, dialog, Notification, shell,
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// ─── 热重载（仅开发环境）────────────────────────────────────────────
if (!app.isPackaged) { try { require('electron-reload')(__dirname); } catch (_) {} }

// ─── Windows 通知通道身份标识（必须在 app.whenReady 前设置）─────────
app.setAppUserModelId('com.neko.neko-status');

// ─── 核心服务 ────────────────────────────────────────────────────────
const configStore   = require('./config-store');
const statusService = require('./status-service');
const systemUtils   = require('./system-utils');
const apiService    = require('./api-service');

// ─── 常量 ─────────────────────────────────────────────────────────────
const APP_NAME    = 'Neko Status';
const APP_VERSION = app.getVersion();

// 检测是否为开机自启动模式
const isAutoStart = process.argv.includes('--autostart');

// 缓存管理员状态检测
let _isAdminCached = null;
function isRunAsAdmin() {
  if (_isAdminCached !== null) return _isAdminCached;
  if (process.platform !== 'win32') return (_isAdminCached = false);
  try {
    require('child_process').execFileSync('net', ['session'], {
      stdio: 'ignore', timeout: 3000, windowsHide: true,
    });
    return (_isAdminCached = true);
  } catch {
    return (_isAdminCached = false);
  }
}

// ─── 全局状态 ──────────────────────────────────────────────────────────
let mainWindow = null;
let tray       = null;
let isQuitting = false;

// 指标历史环形缓冲区（最多保存 360 条 = 1h @ 10s间隔）
const MAX_METRICS_HISTORY = 8640; // 24h @ 10s 采样间隔
const metricsHistory = [];

// ═══════════════════════════════════════════════════════════════════════
//  单 实 例 运 行
// ═══════════════════════════════════════════════════════════════════════
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  窗 口 管 理
// ═══════════════════════════════════════════════════════════════════════
function createWindow() {
  // 从配置读取缩放，以正确初始化 zoomFactor
  const savedScale = configStore.get('uiScale') || 100;
  const zoomFactor = Math.max(0.5, Math.min(3.0, savedScale / 100));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1180,
    minHeight: 700,
    show: false,  // 先隐藏，ready-to-show 后再显示（防白屏闪烁）
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      zoomFactor,              // 启动时直接应用已保存缩放，避免内容闪跳
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!isAutoStart) mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    pushInitialState();
  });

  // 处理关闭事件
  mainWindow.on('close', (e) => {
    if (isQuitting) return;

    const action = configStore.get('closeAction');
    if (action === 'exit') {
      isQuitting = true;
      return; // 允许关闭→window-all-closed 会调用 app.quit()
    }

    e.preventDefault();

    if (action === 'minimize') {
      mainWindow.hide();
      return;
    }

    // 'ask' — 弹窗询问
    const iconPath = getTrayIconPath();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['最小化到托盘', '退出程序'],
      defaultId: 0,
      cancelId: 0,
      title: APP_NAME,
      message: '选择关闭行为',
      detail: '最小化到系统托盘继续后台运行，还是完全退出？',
      ...(iconPath ? { icon: iconPath } : {}),
    });

    if (choice === 0) {
      mainWindow.hide();
    } else {
      isQuitting = true;
      app.quit();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ═══════════════════════════════════════════════════════════════════════
//  系 统 托 盘
// ═══════════════════════════════════════════════════════════════════════
function getTrayIconPath() {
  const candidates = [
    path.join(__dirname, '../../assets/app_icon.ico'),
    path.join(__dirname, '../../assets/app_icon.png'),
  ];
  return candidates.find((p) => { try { fs.accessSync(p); return true; } catch { return false; } }) || null;
}

function createTray() {
  const iconPath = getTrayIconPath();
  let icon = iconPath
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  refreshTrayMenu();

  tray.on('click', () => showWindow());
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    // 用户主动触发，确保窗口可见（覆盖 isAutoStart 门控）
    if (mainWindow) {
      mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
      });
    }
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function refreshTrayMenu() {
  if (!tray) return;
  const running = statusService.isRunning;
  const menu = Menu.buildFromTemplate([
    {
      label: running ? '⏹  停止上报服务' : '▶  启动上报服务',
      click: () => {
        if (running) statusService.stop();
        else statusService.start();
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    { label: '🖥  显示窗口', click: () => showWindow() },
    { type: 'separator' },
    { label: '❌  退出', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

// ═══════════════════════════════════════════════════════════════════════
//  渲 染 进 程 通 信
// ═══════════════════════════════════════════════════════════════════════
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}

function pushInitialState() {
  sendToRenderer('app:init', {
    config: configStore.getAll(),
    isRunning: statusService.isRunning,
    version: APP_VERSION,
    deviceName: os.hostname(),
    platform: os.platform(),
    isAutoStart,
    processName: path.basename(process.execPath),
    pid: process.pid,
    isAdmin: isRunAsAdmin(),
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  系 统 通 知（受 enableNotification + doNotDisturb 控制）
// ═══════════════════════════════════════════════════════════════════════
function showNotification(title, body) {
  if (!configStore.get('enableNotification')) return;
  if (configStore.get('doNotDisturb')) return;
  const notification = new Notification({
    title: title || APP_NAME,
    body,
    silent: false,
    toastXml: undefined, // 使用 Windows 原生通知通道
  });
  notification.show();
}

// ═══════════════════════════════════════════════════════════════════════
//  I P C  处 理 器
// ═══════════════════════════════════════════════════════════════════════
function setupIPC() {
  // ── 配置存取 ──────────────────────────────────────────────────────────
  ipcMain.handle('config:get',     (_, key)  => configStore.get(key));
  ipcMain.handle('config:set',     (_, k, v) => { configStore.set(k, v); return true; });
  ipcMain.handle('config:setMany', (_, obj)  => { configStore.setMany(obj); return true; });
  ipcMain.handle('config:getAll',  ()        => configStore.getAll());

  // ── 上报服务控制 ────────────────────────────────────────────────────────
  ipcMain.handle('service:start', () => {
    statusService.start();
    refreshTrayMenu();
    return { isRunning: statusService.isRunning };
  });
  ipcMain.handle('service:stop', () => {
    statusService.stop();
    refreshTrayMenu();
    return { isRunning: statusService.isRunning };
  });
  ipcMain.handle('service:isRunning',  () => statusService.isRunning);
  ipcMain.handle('service:restart', () => { statusService.restart(); return true; });
  ipcMain.handle('service:lastResult', () => statusService.lastResult);

  // ── 开机自启 ──────────────────────────────────────────────────────────
  ipcMain.handle('autostart:enable', () => {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--autostart'] });
    configStore.set('enableAutoStart', true);
    return true;
  });
  ipcMain.handle('autostart:disable', () => {
    app.setLoginItemSettings({ openAtLogin: false });
    configStore.set('enableAutoStart', false);
    return true;
  });
  ipcMain.handle('autostart:isEnabled', () => {
    const loginSettings = app.getLoginItemSettings();
    // 开发模式下 openAtLogin 可能不准确，回退到配置存储
    return loginSettings.openAtLogin || configStore.get('enableAutoStart') === true;
  });

  // ── 服务页：进程信息 ──────────────────────────────────────────────────
  ipcMain.handle('service:getProcessInfo', () => ({
    processName: path.basename(process.execPath),
    pid: process.pid,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    uptimeSec: Math.round(process.uptime()),
    isAdmin: isRunAsAdmin(),
    recoveryStats: statusService.getRecoveryStats(),
  }));

  // ── 服务页：权限检测 ──────────────────────────────────────────────────
  ipcMain.handle('service:checkPermissions', async () => {
    const perms = {};
    // 屏幕捕获 — Windows 上 desktopCapturer 通常无需额外授权
    try {
      const { desktopCapturer } = require('electron');
      const sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: 1, height: 1 },
      });
      perms.screenCapture = sources.length > 0 ? 'granted' : 'denied';
    } catch {
      perms.screenCapture = 'denied';
    }
    // WMI 进程遍历
    try {
      const { execFileSync } = require('child_process');
      execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-Process -Id $PID | Out-Null',
      ], { timeout: 5000, windowsHide: true, stdio: 'ignore' });
      perms.processEnum = 'granted';
    } catch {
      perms.processEnum = 'denied';
    }
    // 系统电源 — Electron powerMonitor 始终可用
    perms.powerControl = 'granted';
    // 网络 — Electron 不受限
    perms.network = 'granted';
    // 文件 IO — 测试 userData 目录可写性
    try {
      const testFile = path.join(app.getPath('userData'), '.perm-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      perms.fileIO = 'granted';
    } catch {
      perms.fileIO = 'denied';
    }
    return perms;
  });

  // ── 服务页：一键体检 ──────────────────────────────────────────────────
  ipcMain.handle('service:healthCheck', async () => {
    const results = [];
    // 1. 主进程
    results.push({
      name: '主进程状态',
      ok: true,
      text: `${path.basename(process.execPath)} 运行正常，PID ${process.pid}`,
    });
    // 2. 上报服务
    results.push({
      name: '上报服务状态',
      ok: statusService.isRunning,
      text: statusService.isRunning ? '上报服务运行中' : '上报服务未启动',
    });
    // 3. 屏幕捕获
    try {
      const sources = await require('electron').desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: 1, height: 1 },
      });
      results.push({
        name: '屏幕捕获权限',
        ok: sources.length > 0,
        text: sources.length > 0 ? '屏幕捕获 API 可用' : '无法获取屏幕源',
      });
    } catch (e) {
      results.push({ name: '屏幕捕获权限', ok: false, text: `异常: ${e.message}` });
    }
    // 4. WMI
    try {
      require('child_process').execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-Process -Id $PID | Out-Null',
      ], { timeout: 5000, windowsHide: true, stdio: 'ignore' });
      results.push({ name: '进程遍历 (WMI)', ok: true, text: 'PowerShell 进程查询正常' });
    } catch (e) {
      results.push({ name: '进程遍历 (WMI)', ok: false, text: `查询失败: ${e.message}` });
    }
    // 5. 网络连通性
    const cfg = configStore.getAll();
    const serverUrl = cfg.serverMode === 'local' ? cfg.serverUrlLocal : cfg.serverUrlProd;
    try {
      const connResult = await apiService.testConnection(serverUrl);
      results.push({
        name: '网络连通性',
        ok: connResult.ok,
        text: connResult.ok
          ? `服务器在线，延迟 ${connResult.latencyMs}ms`
          : `连接失败: ${connResult.error}`,
      });
    } catch (e) {
      results.push({ name: '网络连通性', ok: false, text: `连接异常: ${e.message}` });
    }
    // 6. 开机自启
    const autoStartOn = app.getLoginItemSettings().openAtLogin;
    results.push({
      name: '开机自启配置',
      ok: autoStartOn ? true : 'warn',
      text: autoStartOn ? '注册表启动项已配置' : '开机自启未启用',
    });
    // 7. 本地存储
    try {
      const udp = app.getPath('userData');
      const testFile = path.join(udp, '.health-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      results.push({ name: '本地存储空间', ok: true, text: `数据目录可写 (${udp})` });
    } catch (e) {
      results.push({ name: '本地存储空间', ok: false, text: `写入失败: ${e.message}` });
    }
    // 8. 故障恢复
    const recoveryOn = cfg.enableAutoRestart !== false;
    results.push({
      name: '故障恢复策略',
      ok: recoveryOn ? true : 'warn',
      text: recoveryOn
        ? `已启用，最大重启 ${cfg.maxRestarts || 3} 次`
        : '未启用自动重启',
    });
    return results;
  });

  // ── 截图 ──────────────────────────────────────────────────────────────
  ipcMain.handle('screenshot:capture', async () => {
    const buf = await systemUtils.captureScreen();
    if (!buf) return null;
    return { data: Array.from(buf), type: 'image/png' };
  });

  // ── 前台窗口 ────────────────────────────────────────────────────────
  ipcMain.handle('system:activeWindow', () => systemUtils.getActiveWindow());

  // ── 系统信息 ──────────────────────────────────────────────────────────
  ipcMain.handle('system:info', async () => {
    const battery = await systemUtils.getBatteryInfo().catch(() => ({}));
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      osType: os.type(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      battery,
    };
  });
  ipcMain.handle('system:battery', () => systemUtils.getBatteryInfo());
  ipcMain.handle('system:metrics', () => systemUtils.getSystemMetrics());
  ipcMain.handle('system:metricsHistory', () => [...metricsHistory]);

  // ── 设备指纹 ──────────────────────────────────────────────────────────
  ipcMain.handle('system:fingerprint', () => statusService.getDeviceFingerprint());

  // ── 设备配对 ──────────────────────────────────────────────────────────
  ipcMain.handle('pairing:handshake', async (_, { token, model }) => {
    const result = await apiService.performHandshake({ token, model: model || os.hostname() });
    if (result.success && result.key) {
      configStore.setMany({ deviceKey: result.key, deviceId: result.deviceId });
    }
    return result;
  });

  // ── 连接测试 ──────────────────────────────────────────────────────────
  ipcMain.handle('api:testConnection', (_, serverUrl) => apiService.testConnection(serverUrl));

  // ── 设备密钥验证 ──────────────────────────────────────────────────────
  ipcMain.handle('api:validateKey', async () => {
    const deviceKey = configStore.get('deviceKey');
    if (!deviceKey) return { valid: false, error: '未配置设备密钥' };
    try {
      const fingerprint = Buffer.from(
        `${os.hostname()}-${os.platform()}-${os.arch()}`
      ).toString('base64');
      return await apiService.validateDeviceKey(deviceKey, fingerprint);
    } catch (err) {
      return { valid: false, errorCode: err.code, error: err.message };
    }
  });

  // ── 密钥预检（不发送指纹，用于保存前检测接管风险）─────────────────────
  ipcMain.handle('api:preValidateKey', async (_, key, serverUrl) => {
    if (!key) return { valid: false, error: '密钥为空' };
    try {
      const url = serverUrl || configStore.getServerUrl();
      return await apiService.validateDeviceKeyAt(key, url);
    } catch (err) {
      return { valid: false, errorCode: err.code, error: err.message };
    }
  });

  // ── 更新检查与通道管理 ────────────────────────────────────────────────
  ipcMain.handle('update:check',      () => checkForUpdates());

  // ── 用户认证 ──────────────────────────────────────────────────────────

  // 本地测试认证辅助函数
  function _localLogin(username, password) {
    const accounts = configStore.get('localTestAccounts') || [];
    const found = accounts.find(a => a.username === username && a.password === password);
    if (!found) return { success: false, message: '用户名或密码错误（本地测试模式）' };
    const user = { id: 'local-' + username, username, email: '', avatar: '', role: 'user' };
    configStore.setMany({ authToken: 'local-test-token', authUser: user });
    return { success: true, token: 'local-test-token', user, isLocal: true };
  }
  function _localRegister(username, password) {
    const accounts = configStore.get('localTestAccounts') || [];
    if (accounts.some(a => a.username === username)) {
      return { success: false, message: '用户名已存在（本地测试模式）' };
    }
    accounts.push({ username, password, createdAt: new Date().toISOString() });
    configStore.set('localTestAccounts', accounts);
    const user = { id: 'local-' + username, username, email: '', avatar: '', role: 'user' };
    configStore.setMany({ authToken: 'local-test-token', authUser: user });
    return { success: true, token: 'local-test-token', user, isLocal: true };
  }

  ipcMain.handle('auth:login', async (_, { username, password }) => {
    const serverMode = configStore.get('serverMode');
    const serverConfigured = configStore.get('serverConfigured');
    // 本地测试模式：服务器未配置时使用本地账户
    if (serverMode === 'local' && !serverConfigured) {
      return _localLogin(username, password);
    }
    try {
      const result = await apiService.authLogin(username, password);
      if (result.success && result.token) {
        configStore.setMany({ authToken: result.token, authUser: result.user });
      }
      return result;
    } catch (err) {
      console.error('[Auth] 登录请求失败:', err.message);
      // 本地模式下服务器不可用时回退到本地认证
      if (serverMode === 'local') {
        return _localLogin(username, password);
      }
      // 网络错误给出友好提示
      const isNetworkError = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|abort/i.test(err.message);
      const friendlyMsg = isNetworkError
        ? `无法连接到服务器 (${configStore.getServerUrl()})，请检查网络或服务器地址配置`
        : (err.message || '登录失败');
      return { success: false, message: friendlyMsg };
    }
  });

  ipcMain.handle('auth:register', async (_, { username, password }) => {
    const serverMode = configStore.get('serverMode');
    const serverConfigured = configStore.get('serverConfigured');
    if (serverMode === 'local' && !serverConfigured) {
      return _localRegister(username, password);
    }
    try {
      const result = await apiService.authRegister(username, password);
      if (result.success && result.token) {
        configStore.setMany({ authToken: result.token, authUser: result.user });
      }
      return result;
    } catch (err) {
      console.error('[Auth] 注册请求失败:', err.message);
      if (serverMode === 'local') {
        return _localRegister(username, password);
      }
      const isNetworkError = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|abort/i.test(err.message);
      const friendlyMsg = isNetworkError
        ? `无法连接到服务器 (${configStore.getServerUrl()})，请检查网络或服务器地址配置`
        : (err.message || '注册失败');
      return { success: false, message: friendlyMsg };
    }
  });

  ipcMain.handle('auth:me', async () => {
    const token = configStore.get('authToken');
    if (!token) return { success: false, message: '未登录' };
    try {
      const result = await apiService.authGetMe(token);
      if (result.success && result.user) {
        configStore.set('authUser', result.user);
      }
      return result;
    } catch (err) {
      // token 过期则清除本地认证状态
      if (err.status === 401) {
        configStore.setMany({ authToken: '', authUser: null });
      }
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('auth:updateProfile', async (_, data) => {
    const token = configStore.get('authToken');
    if (!token) return { success: false, message: '未登录' };
    try {
      const result = await apiService.authUpdateProfile(token, data);
      if (result.success && result.user) {
        configStore.set('authUser', result.user);
      }
      return result;
    } catch (err) {
      if (err.status === 401) {
        configStore.setMany({ authToken: '', authUser: null });
      }
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('auth:logout', () => {
    configStore.setMany({ authToken: '', authUser: null });
    return { success: true };
  });

  ipcMain.handle('auth:generateDeviceKey', async () => {
    const token = configStore.get('authToken');
    if (!token) return { success: false, message: '未登录' };
    try {
      const fingerprint = statusService.getDeviceFingerprint
        ? statusService.getDeviceFingerprint()
        : Buffer.from(`${os.hostname()}-${os.platform()}-${os.arch()}`).toString('base64');
      const result = await apiService.authGenerateDeviceKey(token, {
        deviceName: os.hostname(),
        platform: 'Windows',
        deviceFingerprint: fingerprint,
      });
      if (result.success && result.deviceKey) {
        configStore.setMany({ deviceKey: result.deviceKey, deviceId: result.deviceId });
      }
      return result;
    } catch (err) {
      if (err.status === 401) {
        configStore.setMany({ authToken: '', authUser: null });
      }
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('auth:getState', () => {
    return {
      isLoggedIn: !!configStore.get('authToken'),
      user: configStore.get('authUser'),
      promptDismissed: configStore.get('authPromptDismissed'),
      serverConfigured: configStore.get('serverConfigured'),
      serverMode: configStore.get('serverMode'),
    };
  });

  ipcMain.handle('auth:dismissPrompt', () => {
    configStore.set('authPromptDismissed', true);
    return true;
  });
  ipcMain.handle('update:getChannel', () => configStore.get('updateChannel') || 'stable');
  ipcMain.handle('update:setChannel', (_, channel) => {
    if (!['stable', 'beta', 'nightly'].includes(channel)) return false;
    configStore.set('updateChannel', channel);
    return true;
  });

  // ── 更新下载（流式，推送进度至渲染进程）──────────────────────────────
  ipcMain.handle('update:download', async (_, { url }) => {
    if (!url || !/^https?:\/\//i.test(url)) {
      return { success: false, error: '无效下载链接' };
    }
    try {
      const tmpDir = path.join(os.tmpdir(), 'neko-update');
      fs.mkdirSync(tmpDir, { recursive: true });

      // 私有仓库支持：GitHub API asset URL 需要 auth + Accept: application/octet-stream
      const headers = {};
      const isGhApi = url.includes('api.github.com');
      if (isGhApi) {
        const token = configStore.get('githubToken') || '';
        if (token) headers['Authorization'] = `token ${token}`;
        headers['Accept'] = 'application/octet-stream';
      }

      // 从 API URL 中无法直接提取文件名，需要从重定向响应中获取
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(300000), redirect: 'follow' });
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);

      // 从 Content-Disposition 或 URL 提取文件名
      let fileName;
      const cd = res.headers.get('content-disposition') || '';
      const cdMatch = cd.match(/filename[*]?=['"]?([^'"\s;]+)/i);
      if (cdMatch) {
        fileName = cdMatch[1];
      } else {
        // 回退：从最终 URL 提取
        fileName = (res.url || url).split('/').pop().split('?')[0] || 'NekoStatus-update.exe';
      }
      const filePath = path.join(tmpDir, fileName);

      const total = parseInt(res.headers.get('content-length') || '0', 10);
      let received = 0;
      const chunks = [];
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        received += value.length;
        sendToRenderer('update:progress', {
          received, total,
          pct: total > 0 ? Math.round(received / total * 100) : -1,
        });
      }

      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(filePath, buffer);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
      return { success: true, filePath, sha256 };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 更新安装（SHA256 校验 → 启动安装包 → 退出）────────────────────────
  ipcMain.handle('update:install', async (_, { filePath, expectedSha256 }) => {
    const resolvedPath = path.resolve(filePath);
    const tmpDir = path.resolve(os.tmpdir());
    // 安全校验：安装包必须在系统临时目录下
    if (!resolvedPath.startsWith(tmpDir)) {
      return { success: false, error: '非法文件路径，拒绝执行' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: '安装文件不存在' };
    }
    // SHA256 可选校验
    if (expectedSha256) {
      const data = fs.readFileSync(resolvedPath);
      const actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase();
      if (actual !== expectedSha256.toLowerCase()) {
        return { success: false, error: `SHA256 校验失败（期望 ${expectedSha256}，实际 ${actual}）` };
      }
    }
    // 启动安装程序，1s 后退出当前应用
    shell.openPath(resolvedPath).then(() => {
      setTimeout(() => { isQuitting = true; app.quit(); }, 1000);
    });
    return { success: true };
  });

  // ── 应用控制 ──────────────────────────────────────────────────────────
  ipcMain.handle('app:getVersion',    () => APP_VERSION);
  ipcMain.handle('app:getDeviceName', () => os.hostname());
  ipcMain.handle('app:quit',  () => { isQuitting = true; app.quit(); });
  ipcMain.handle('app:hide',  () => { if (mainWindow) mainWindow.hide(); });
  ipcMain.handle('app:show',  () => showWindow());
  ipcMain.handle('app:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.handle('app:openExternal', (_, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // ── 系统通知 ─────────────────────────────────────────────────────────
  ipcMain.handle('notification:show', (_, { title, body }) => {
    showNotification(title, body);
  });

  // ── Windows 免打扰 (Focus Assist) ───────────────────────────────────
  const FA_REG_PATH = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';

  ipcMain.handle('system:getFocusAssist', async () => {
    if (process.platform !== 'win32') return { ok: false, enabled: false, reason: 'not-windows' };
    try {
      const { execSync } = require('child_process');
      // Windows 11 使用 NOC_GLOBAL_SETTING_TOASTS_ENABLED (0=DND开, 1=DND关)
      // Windows 10 使用 NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK
      let dndEnabled = false;
      try {
        const out1 = execSync(
          `reg query "${FA_REG_PATH}" /v NOC_GLOBAL_SETTING_TOASTS_ENABLED`,
          { windowsHide: true, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const m1 = out1.match(/0x([0-9a-fA-F]+)/);
        if (m1) dndEnabled = parseInt(m1[1], 16) === 0;
      } catch {
        // fallback: Windows 10 key
        try {
          const out2 = execSync(
            `reg query "${FA_REG_PATH}" /v NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK`,
            { windowsHide: true, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          );
          const m2 = out2.match(/0x([0-9a-fA-F]+)/);
          if (m2) dndEnabled = parseInt(m2[1], 16) === 0;
        } catch { /* 键不存在 = DND 关闭 */ }
      }
      return { ok: true, enabled: dndEnabled };
    } catch {
      return { ok: true, enabled: false };
    }
  });

  ipcMain.handle('system:setFocusAssist', async (_, enabled) => {
    if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' };
    try {
      const { execSync } = require('child_process');
      // 写入 Windows 11 + Windows 10 两个键以最大兼容
      try {
        execSync(
          `reg add "${FA_REG_PATH}" /v NOC_GLOBAL_SETTING_TOASTS_ENABLED /t REG_DWORD /d ${enabled ? 0 : 1} /f`,
          { windowsHide: true }
        );
      } catch { /* Win10 可能无此键 */ }
      try {
        execSync(
          `reg add "${FA_REG_PATH}" /v NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK /t REG_DWORD /d ${enabled ? 0 : 1} /f`,
          { windowsHide: true }
        );
        execSync(
          `reg add "${FA_REG_PATH}" /v NOC_GLOBAL_SETTING_ALLOW_CRITICAL_TOASTS_ABOVE_LOCK /t REG_DWORD /d ${enabled ? 0 : 1} /f`,
          { windowsHide: true }
        );
      } catch { /* ignore */ }
      console.log(`[FocusAssist] ${enabled ? '已开启' : '已关闭'}`);
      return { ok: true };
    } catch (err) {
      console.warn('[FocusAssist] 设置失败:', err.message);
      return { ok: false, reason: err.message };
    }
  });

  // ── 文件选择对话框 ────────────────────────────────────────────────────
  ipcMain.handle('dialog:selectFile', async (_, options) => {
    const filters = options?.filters || [{ name: '安装包', extensions: ['exe', 'zip', '7z'] }];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || '选择文件',
      filters,
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // ── 缓存清理 ──────────────────────────────────────────────────────────
  ipcMain.handle('cache:clear', async () => {
    try {
      const ses = mainWindow?.webContents?.session;
      if (!ses) return { success: false, error: '无法获取 session' };
      await ses.clearCache();
      await ses.clearStorageData({ storages: ['cachestorage', 'shadercache', 'serviceworkers'] });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── 缓存大小查询 ────────────────────────────────────────────────────
  ipcMain.handle('cache:getSize', async () => {
    try {
      const ses = mainWindow?.webContents?.session;
      if (!ses) return 0;
      return await ses.getCacheSize();
    } catch {
      return 0;
    }
  });

  // ── 界面缩放 ──────────────────────────────────────────────────────────
  ipcMain.handle('app:setZoom', (_, factor) => {
    if (mainWindow?.webContents) {
      // setZoomFactor 适用于全部可见内容（含 HiDPI）
      mainWindow.webContents.setZoomFactor(Math.max(0.5, Math.min(3.0, factor)));
    }
    return true;
  });

  // ── 系统安装字体枚举 ──────────────────────────────────────────────────
  ipcMain.handle('system:fonts', async () => {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);
      // PowerShell: 强制 UTF-8 输出，防止中文字体名乱码
      const { stdout } = await execFileAsync('powershell', [
        '-NonInteractive', '-NoProfile', '-Command',
        '$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);' +
        '[System.Reflection.Assembly]::LoadWithPartialName("System.Drawing") | Out-Null;' +
        '[System.Drawing.FontFamily]::Families | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'
      ], { timeout: 8000, windowsHide: true, encoding: 'buffer' });
      const text = stdout.toString('utf8').trim();
      const list = JSON.parse(text);
      return Array.isArray(list) ? list : [list];
    } catch {
      return [];
    }
  });

  // ── 多版本更新日志（在线获取，回落本地缓存）────────────────────────────
  ipcMain.handle('update:getChangelog', async () => {
    const owner = configStore.get('githubOwner') || 'Neko-NF';
    const repo  = configStore.get('githubRepo') || 'Neko-Status-Desktop';
    if (!owner || !repo) return configStore.get('changelogCache') || [];
    const token   = configStore.get('githubToken') || '';
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=6`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const releases = await res.json();
      const entries = releases.map((r) => ({
        version:     (r.tag_name || '').replace(/^v/, ''),
        date:        (r.published_at || '').slice(0, 10),
        notes:       r.body || '',
        isPreRelease: r.prerelease,
      }));
      configStore.set('changelogCache', entries);
      return entries;
    } catch {
      return configStore.get('changelogCache') || [];
    }
  });

  // ── 完整性检查 ───────────────────────────────────────────────────────
  ipcMain.handle('update:integrity', async () => {
    const results = [];
    // 配置文件
    try {
      const cfg = configStore.store;
      results.push({ name: '配置文件',   ok: true,  text: `完好，共 ${Object.keys(cfg).length} 项` });
    } catch (e) {
      results.push({ name: '配置文件',   ok: false, text: `损坏: ${e.message}` });
    }
    // 临时目录可写
    try {
      const tmpDir = path.join(os.tmpdir(), 'neko-update');
      fs.mkdirSync(tmpDir, { recursive: true });
      results.push({ name: '临时目录',   ok: true,  text: `可写 (${tmpDir})` });
    } catch (e) {
      results.push({ name: '临时目录',   ok: false, text: `不可写: ${e.message}` });
    }
    // 主进程
    results.push({ name: '主进程',       ok: true,  text: `运行正常，PID ${process.pid}` });
    // 更新源配置
    const owner = configStore.get('githubOwner');
    const repo  = configStore.get('githubRepo');
    results.push({ name: '更新源配置',   ok: !!(owner && repo), text: owner && repo ? `github.com/${owner}/${repo}` : '未配置（请先设置更新源）' });
    return results;
  });

  // ── 版本回滚（获取 GitHub 上一个稳定版信息）─────────────────────────
  ipcMain.handle('update:rollback', async () => {
    const owner = configStore.get('githubOwner');
    const repo  = configStore.get('githubRepo');
    if (!owner || !repo) return { success: false, error: '未配置更新源，无法查询历史版本' };
    const token   = configStore.get('githubToken') || '';
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const releases = await res.json();
      const stable = releases.filter((r) => !r.prerelease);
      if (stable.length < 2) return { success: false, error: '没有可回滚的历史稳定版本' };
      const prev = stable[1];
      const prevVersion = (prev.tag_name || '').replace(/^v/, '');
      const exeAsset = (prev.assets || []).find((a) => a.name.endsWith('.exe'));
      const zipAsset = (prev.assets || []).find((a) => a.name.endsWith('.zip') && a.name.toLowerCase().includes('win'));
      // 私有仓库使用 asset API URL
      const pickUrl = (a) => a ? (token ? a.url : a.browser_download_url) : null;
      const downloadUrl = pickUrl(exeAsset) || pickUrl(zipAsset);
      if (!downloadUrl) return { success: false, error: `找不到 v${prevVersion} 的安装包` };
      return { success: true, version: prevVersion, downloadUrl };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  版 本 比 较 与 通 道 过 滤
// ═══════════════════════════════════════════════════════════════════════

/**
 * 解析版本字符串为结构体，支持 nightly / beta 后缀
 * 例：v1.2.3-beta.2 → { major:1, minor:2, patch:3, preWeight:1, preN:2 }
 * preWeight: nightly=0, beta=1, stable=2（数值越高越稳定/越新）
 */
function parseVersionFull(v) {
  const str = (v || '').replace(/^v/, '');
  const dashIdx = str.indexOf('-');
  const main = dashIdx >= 0 ? str.slice(0, dashIdx) : str;
  const pre  = dashIdx >= 0 ? str.slice(dashIdx + 1) : '';
  const [major, minor, patch] = main.split('.').map((x) => parseInt(x, 10) || 0);
  let preWeight = 2, preN = 0; // 无 pre-release = stable
  if (pre.startsWith('nightly')) { preWeight = 0; preN = parseInt(pre.split('.')[1] || '0', 10); }
  else if (pre.startsWith('beta')) { preWeight = 1; preN = parseInt(pre.split('.')[1] || '0', 10); }
  return { major, minor, patch, preWeight, preN };
}

/** 比较两个版本字符串，返回 1 / 0 / -1（nightly < beta < stable） */
function compareVersionsFull(a, b) {
  const va = parseVersionFull(a), vb = parseVersionFull(b);
  for (const k of ['major', 'minor', 'patch', 'preWeight', 'preN']) {
    if (va[k] > vb[k]) return 1;
    if (va[k] < vb[k]) return -1;
  }
  return 0;
}

/**
 * 判断 release tag 是否属于指定通道：
 * stable  → 仅正式版（无 pre-release 后缀）
 * beta    → 正式版 + beta（含 -beta.N）
 * nightly → 全部（含 -nightly.YYYYMMDD）
 */
function isTagInChannel(tag, channel) {
  const t = (tag || '').replace(/^v/, '');
  const isNightly = t.includes('-nightly');
  const isBeta    = t.includes('-beta');
  if (channel === 'stable') return !isNightly && !isBeta;
  if (channel === 'beta')   return !isNightly;
  return true; // nightly：接受全部
}

// ─── 兼容旧代码的简单 compareVersions（仅用于三位纯数字版本） ──────────
function compareVersions(a, b) {
  return compareVersionsFull(a, b);
}

// ═══════════════════════════════════════════════════════════════════════
//  GitHub 三 通 道 更 新 检 查
// ═══════════════════════════════════════════════════════════════════════
async function checkForUpdates() {
  const owner   = configStore.get('githubOwner') || 'Neko-NF';
  const repo    = configStore.get('githubRepo') || 'Neko-Status-Desktop';
  const channel = configStore.get('updateChannel') || 'stable';

  if (!owner || !repo) {
    return { hasUpdate: false, channel, error: '未配置 GitHub 仓库（githubOwner / githubRepo）' };
  }

  const token   = configStore.get('githubToken') || '';
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `token ${token}`;

  try {
    let release;

    // 统一使用列表 API，按通道过滤
    // （/releases/latest 不返回 pre-release，仓库只有 beta 时会 404）
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) {
      if (res.status === 404) throw new Error(`仓库 ${owner}/${repo} 不存在`);
      throw new Error(`GitHub API 返回 ${res.status}`);
    }
    const all = await res.json();
    if (!all.length) {
      return { hasUpdate: false, channel, currentVersion: APP_VERSION, latestVersion: APP_VERSION,
               error: '仓库尚无已发布的 Release' };
    }

    if (channel === 'stable') {
      // 稳定版：仅匹配非 pre-release
      const stableReleases = all.filter((r) => !r.prerelease);
      if (stableReleases.length === 0) {
        return { hasUpdate: false, channel, currentVersion: APP_VERSION, latestVersion: APP_VERSION,
                 error: '当前无正式版 Release，请切换至 Beta 通道获取最新版本' };
      }
      release = stableReleases[0]; // GitHub API 默认按时间倒序
    } else {
      // beta / nightly：按通道过滤后取 semver 最高
      const filtered = all.filter((r) => isTagInChannel(r.tag_name, channel));
      if (filtered.length === 0) {
        return { hasUpdate: false, channel, currentVersion: APP_VERSION, latestVersion: APP_VERSION };
      }
      release = filtered.reduce((best, cur) =>
        compareVersionsFull(cur.tag_name, best.tag_name) > 0 ? cur : best
      );
    }

    const latestVersion = (release.tag_name || '').replace(/^v/, '');
    const hasUpdate = compareVersionsFull(latestVersion, APP_VERSION) > 0;

    const assets     = release.assets || [];
    const exeAsset   = assets.find((a) => a.name.endsWith('.exe'));
    const zipAsset   = assets.find(
      (a) => a.name.endsWith('.zip') &&
        (a.name.toLowerCase().includes('win') || a.name.toLowerCase().includes('windows'))
    );
    const sumsAsset  = assets.find((a) => a.name === 'SHA256SUMS.txt');

    // 私有仓库使用 asset API URL （配合 Accept: application/octet-stream 下载）
    // 公开仓库使用 browser_download_url（直接下载）
    const pickUrl = (a) => a ? (token ? a.url : a.browser_download_url) : null;

    configStore.set('lastUpdateCheck', Date.now());

    // 解析强制更新标记
    const releaseBody = release.body || '';
    const forceUpdate = releaseBody.includes('<!-- FORCE_UPDATE -->');

    // 获取下载文件大小（优先 exe，否则 zip）
    const primaryAsset = exeAsset || zipAsset;
    const downloadSize = primaryAsset ? primaryAsset.size : 0;

    return {
      hasUpdate,
      channel,
      latestVersion,
      currentVersion: APP_VERSION,
      releaseNotes:   releaseBody,
      forceUpdate,
      exeDownloadUrl: pickUrl(exeAsset),
      zipDownloadUrl: pickUrl(zipAsset),
      sha256sumsUrl:  pickUrl(sumsAsset),
      publishedAt:    release.published_at,
      downloadSize,
    };
  } catch (err) {
    return { hasUpdate: false, channel, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  网 络 等 待（开机自启动时使用）
// ═══════════════════════════════════════════════════════════════════════
const dns = require('dns');
const { promisify } = require('util');
const dnsLookup = promisify(dns.lookup);

async function waitForNetwork(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await dnsLookup('api.github.com');
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
//  应 用 生 命 周 期
// ═══════════════════════════════════════════════════════════════════════
app.whenReady().then(async () => {
  setupIPC();
  createWindow();
  createTray();

  // StatusService 日志/Tick/状态变更 → 推送到渲染进程
  statusService.setLogCallback((level, msg, time) => {
    sendToRenderer('log:entry', { level, msg, time });
  });
  statusService.setTickCallback((data) => {
    sendToRenderer('service:tick', data);
    refreshTrayMenu();
  });
  statusService.setStatusChangeCallback((isRunning) => {
    sendToRenderer('service:statusChanged', { isRunning });
    refreshTrayMenu();
    showNotification('服务状态变更', isRunning ? '上报服务已启动' : '上报服务已停止');
  });
  statusService.setKeyStatusCallback((code, message) => {
    sendToRenderer('service:keyStatus', { code, message });
    if (code === 401) showNotification('密钥失效', message || '设备密钥已被吊销，请重新配对');
    if (code === 429) showNotification('请求限流', message || '上报频率过高，已被服务器限流');
  });

  // 开机自启动逻辑（含网络等待）
  if (isAutoStart) {
    const delayMs = configStore.get('startupDelayMs') || 5000;
    console.log(`[Main] 开机自启，延迟 ${delayMs}ms 后启动`);
    setTimeout(async () => {
      // 等待网络就绪
      const networkReady = await waitForNetwork(30000);
      if (!networkReady) {
        console.log('[Main] 网络等待超时，仍尝试启动服务');
      }
      showWindow();
      if (configStore.get('deviceKey')) statusService.start();
    }, delayMs);
  } else if (configStore.get('enableAutoServiceStart') && configStore.get('deviceKey')) {
    setTimeout(() => statusService.start(), 1500);
  }

  // 兜底自启服务：30秒后若服务未运行且配置齐全则自动启动
  if (configStore.get('enableAutoServiceStart')) {
    setTimeout(() => {
      if (!statusService.isRunning && configStore.get('deviceKey')) {
        console.log('[Main] 兜底自启：30s 后服务仍未运行，自动启动');
        statusService.start();
      }
    }, 30000);
  }

  // 启动时始终检查更新（不受「自动下载」开关影响）— 延迟 15s 避免影响首屏加载
  setTimeout(async () => {
    try {
      const result = await checkForUpdates();
      if (result.hasUpdate) {
        // 非强制更新时检查跳过版本
        const skipped = configStore.get('skippedVersion');
        if (!result.forceUpdate && skipped === result.latestVersion) {
          console.log(`[Main] 版本 v${result.latestVersion} 已被用户跳过`);
          return;
        }
        sendToRenderer('update:available', result);
        console.log(`[Main] 发现新版本 v${result.latestVersion}`);
      }
    } catch { /* 更新检查失败静默处理 */ }
  }, 15000);

  // 长期运行时每 30 分钟轮询一次更新
  setInterval(async () => {
    try {
      const result = await checkForUpdates();
      if (result.hasUpdate) {
        // 非强制更新时检查跳过版本
        const skipped = configStore.get('skippedVersion');
        if (!result.forceUpdate && skipped === result.latestVersion) {
          return;
        }
        sendToRenderer('update:available', result);
        console.log(`[Main] 定期检查 - 发现新版本 v${result.latestVersion}`);
      }
    } catch { /* 定期更新检查失败静默处理 */ }
  }, 30 * 60 * 1000);

  // 定期采集系统指标（5s 一次，配合 1m 区间每 5s 刷新），延迟首次采集等窗口渲染完成
  setTimeout(() => {
    setInterval(async () => {
      try {
        const m = await systemUtils.getSystemMetrics();
        m.timestamp = Date.now();
        metricsHistory.push(m);
        if (metricsHistory.length > MAX_METRICS_HISTORY) metricsHistory.shift();
        sendToRenderer('system:metricsUpdate', m);
      } catch { /* 指标采集失败静默处理 */ }
    }, 5000);
  }, 3000);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Windows/Linux: 关闭所有窗口后处理
app.on('window-all-closed', () => {
  // 明确退出时结束进程，否则保持托盘驻留
  if (isQuitting) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  statusService.stop();
});

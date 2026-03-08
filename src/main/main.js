const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, dialog, Notification, shell,
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// ─── 热重载（仅开发环境）────────────────────────────────────────────
try { require('electron-reload')(__dirname); } catch (_) {}

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

// ─── 全局状态 ──────────────────────────────────────────────────────────
let mainWindow = null;
let tray       = null;
let isQuitting = false;

// ═══════════════════════════════════════════════════════════════════════
//  窗 口 管 理
// ═══════════════════════════════════════════════════════════════════════
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1180,
    minHeight: 700,
    show: false,  // 先隐藏，ready-to-show 后再显示（防白屏闪烁）
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
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
    if (action === 'exit') return; // 允许直接退出

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
  if (!mainWindow) return;
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
  });
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
  ipcMain.handle('autostart:isEnabled', () => app.getLoginItemSettings().openAtLogin);

  // ── 截图 ──────────────────────────────────────────────────────────────
  ipcMain.handle('screenshot:capture', async () => {
    const buf = await systemUtils.captureScreen();
    if (!buf) return null;
    return { data: Array.from(buf), type: 'image/png' };
  });

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

  // ── 更新检查与通道管理 ────────────────────────────────────────────────
  ipcMain.handle('update:check',      () => checkForUpdates());
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
      const fileName = url.split('/').pop().split('?')[0];
      const filePath = path.join(tmpDir, fileName);

      const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);

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

  // ── 系统通知 ──────────────────────────────────────────────────────────
  ipcMain.handle('notification:show', (_, { title, body }) => {
    new Notification({ title: title || APP_NAME, body }).show();
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
  const owner   = configStore.get('githubOwner');
  const repo    = configStore.get('githubRepo');
  const channel = configStore.get('updateChannel') || 'stable';

  if (!owner || !repo) {
    return { hasUpdate: false, channel, error: '未配置 GitHub 仓库（githubOwner / githubRepo）' };
  }

  const token   = configStore.get('githubToken') || '';
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `token ${token}`;

  try {
    let release;

    if (channel === 'stable') {
      // 稳定版：使用 /releases/latest（GitHub 自动返回最新非 pre-release）
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`);
      release = await res.json();
    } else {
      // beta / nightly：获取最近 30 条 release，按通道过滤后取 semver 最高
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`);
      const all = await res.json();
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

    configStore.set('lastUpdateCheck', Date.now());

    return {
      hasUpdate,
      channel,
      latestVersion,
      currentVersion: APP_VERSION,
      releaseNotes:   release.body || '',
      exeDownloadUrl: exeAsset?.browser_download_url  || null,
      zipDownloadUrl: zipAsset?.browser_download_url  || null,
      sha256sumsUrl:  sumsAsset?.browser_download_url || null,
      publishedAt:    release.published_at,
    };
  } catch (err) {
    return { hasUpdate: false, channel, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  应 用 生 命 周 期
// ═══════════════════════════════════════════════════════════════════════
app.whenReady().then(() => {
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
  });

  // 开机自启动逻辑
  if (isAutoStart) {
    const delayMs = configStore.get('startupDelayMs') || 5000;
    console.log(`[Main] 开机自启，延迟 ${delayMs}ms 后启动`);
    setTimeout(() => {
      showWindow();
      if (configStore.get('deviceKey')) statusService.start();
    }, delayMs);
  } else if (configStore.get('enableAutoServiceStart') && configStore.get('deviceKey')) {
    setTimeout(() => statusService.start(), 1500);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Windows/Linux: 关闭所有窗口后保持进程存活（已最小化到托盘）
app.on('window-all-closed', () => { /* 不退出 */ });

app.on('before-quit', () => {
  isQuitting = true;
  statusService.stop();
});

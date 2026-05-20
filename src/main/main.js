const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, dialog, Notification, shell, screen, desktopCapturer,
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { IPC_CHANNELS, IPC_EVENTS } = require('../shared/ipc-contracts');
const { configureUserDataPath } = require('./user-data-path');

// ─── 应用身份（必须尽早设置，影响 Windows 任务栏/任务管理器展示）─────────
const IS_DEV_RUNTIME = !!process.env.NEKO_DEV_RUNTIME_EXE;
const APP_NAME = IS_DEV_RUNTIME ? 'Neko Status Dev' : 'Neko Status';
const APP_USER_MODEL_ID = IS_DEV_RUNTIME ? 'com.koirin.neko-status.dev' : 'com.koirin.neko-status';
app.setName(APP_NAME);
app.setAppUserModelId(APP_USER_MODEL_ID);
configureUserDataPath({ app, isDevRuntime: IS_DEV_RUNTIME, displayName: APP_NAME });

if (process.env.NEKO_DISABLE_HW_ACCEL === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}



// ─── 热重载（仅开发环境）────────────────────────────────────────────
// 监听整个 src/ 目录（含 renderer）；传入 electron 可执行文件路径使主进程变更时硬重启
if (!app.isPackaged) {
  try {
    require('electron-reload')(path.join(__dirname, '../../src'), {
      electron: require('electron'),  // electron 包导出的即是 exe 绝对路径
      hardResetMethod: 'exit',        // Windows 下 exit 比 quit 更干净
    });
  } catch (_) {}
}

// ─── 核心服务 ────────────────────────────────────────────────────────
const configStore   = require('./config-store');
const statusService = require('./status-service');
const systemUtils   = require('./system-utils');
const apiService    = require('./api-service');
const streamService = require('./stream-service');
const { createAppShell } = require('./app-shell');
const {
  registerConfigIpc,
  registerStreamIpc,
  registerSystemIpc,
  registerApiIpc,
  registerAuthIpc,
  registerServiceIpc,
  registerUpdateIpc,
} = require('./ipc');
const {
  runStartupUpdateGate,
  runBackgroundUpdateCheck,
} = require('./startup-update-gate');
const {
  getActiveUpdateSource,
  getSavedUpdateSources,
  getUpdateSourceMode,
  buildReleaseHeaders,
  buildDownloadHeadersForUrl,
  pickAssetDownloadUrl,
} = require('./update-source');
const {
  estimateDownloadSpeed,
} = require('./update-speed');
const {
  launchInstaller: launchUpdateInstaller,
} = require('./update-installer');
const {
  getAssetPath: resolveAppAssetPath,
  getAppIconPath: resolveAppIconPath,
  ensureWindowsAppIdentityShortcuts,
} = require('./windows-app-identity');

// ─── 常量 ─────────────────────────────────────────────────────────────
const APP_VERSION = app.getVersion();

function writeStartupDiagnostic(label, error) {
  const message = [
    `[${new Date().toISOString()}] ${label}`,
    error?.stack || error?.message || String(error || 'unknown error'),
    '',
  ].join('\n');
  const candidates = [];
  try { candidates.push(path.join(app.getPath('userData'), 'startup-diagnostics.log')); } catch {}
  try { candidates.push(path.join(path.dirname(process.execPath), 'startup-diagnostics.log')); } catch {}
  for (const filePath of candidates) {
    try {
      fs.appendFileSync(filePath, message, 'utf8');
      return;
    } catch {}
  }
}

function traceStartup(message, extra = '') {
  if (process.env.NEKO_STARTUP_TRACE !== '1') return;
  writeStartupDiagnostic(`trace: ${message}`, extra ? { message: String(extra) } : null);
}

process.on('uncaughtException', (error) => {
  writeStartupDiagnostic('uncaughtException', error);
  console.error('[Startup] uncaughtException:', error);
});

process.on('unhandledRejection', (error) => {
  writeStartupDiagnostic('unhandledRejection', error);
  console.error('[Startup] unhandledRejection:', error);
});

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
let privacyPickerWindow = null;
let startupUpdateWindow = null;
let pendingStartupStatus = null;

const CACHE_DIR_NAMES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
  'GrShaderCache',
  'blob_storage',
  path.join('Service Worker', 'CacheStorage'),
  path.join('Service Worker', 'ScriptCache'),
  path.join('Network', 'Cache'),
  path.join('Network', 'Code Cache'),
];

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter((p) => {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function getCacheTargets(sessionRef) {
  const roots = [app.getPath('userData')];
  try {
    if (sessionRef && typeof sessionRef.getStoragePath === 'function') {
      const storagePath = sessionRef.getStoragePath();
      if (storagePath) roots.push(storagePath);
    }
  } catch { /* ignore */ }

  const targets = [];
  for (const root of uniquePaths(roots)) {
    for (const dir of CACHE_DIR_NAMES) {
      const target = path.resolve(root, dir);
      if (isInside(root, target)) targets.push(target);
    }
  }
  return uniquePaths(targets);
}

async function getPathSize(target) {
  try {
    const stat = await fs.promises.stat(target);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    const sizes = await Promise.all(entries.map((entry) => getPathSize(path.join(target, entry.name))));
    return sizes.reduce((sum, n) => sum + n, 0);
  } catch {
    return 0;
  }
}

async function getCacheDiskSize(sessionRef) {
  const sesSize = sessionRef && typeof sessionRef.getCacheSize === 'function'
    ? await sessionRef.getCacheSize().catch(() => 0)
    : 0;
  const dirSize = (await Promise.all(getCacheTargets(sessionRef).map(getPathSize)))
    .reduce((sum, n) => sum + n, 0);
  return Math.max(sesSize, dirSize);
}

async function removeCacheTargets(sessionRef) {
  const removed = [];
  const failed = [];
  for (const target of getCacheTargets(sessionRef)) {
    try {
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 80 });
      removed.push(path.basename(target));
    } catch (err) {
      failed.push({ path: target, error: err.message });
    }
  }
  return { removed, failed };
}

function launchInstaller(filePath, { silent = true, relaunchAfterInstall = true } = {}) {
  return launchUpdateInstaller(filePath, {
    silent,
    relaunchAfterInstall,
    shell,
    platform: process.platform,
  });
}

/**
 * 自动下载互斥状态（防止并发重入）
 * null = 空闲
 * { stage: 'downloading', version, url } = 正在下载
 * { stage: 'ready', version, filePath, sha256 } = 已下载，等待用户下次启动时安装
 */
let _autoDownloadState = null;

// 指标历史环形缓冲区（最多保存 360 条 = 1h @ 10s间隔）
const MAX_METRICS_HISTORY = 8640; // 24h @ 10s 采样间隔
const metricsHistory = [];

const appShell = createAppShell({
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  dialog,
  screen,
  desktopCapturer,
  ipcMain,
  path,
  fs,
  os,
  configStore,
  statusService,
  systemUtils,
  APP_NAME,
  APP_VERSION,
  isAutoStart,
  isRunAsAdmin,
  getMainWindow: () => mainWindow,
  setMainWindow: (value) => { mainWindow = value; },
  getTray: () => tray,
  setTray: (value) => { tray = value; },
  getIsQuitting: () => isQuitting,
  setIsQuitting: (value) => { isQuitting = value; },
  getPrivacyPickerWindow: () => privacyPickerWindow,
  setPrivacyPickerWindow: (value) => { privacyPickerWindow = value; },
});

const {
  createWindow,
  showWindow,
  createTray,
  refreshTrayMenu,
  sendToRenderer,
  pushInitialState,
  getTrayIconPath,
  createAppIconImage,
  pickPrivacyWindow,
} = appShell;

function createStartupUpdateWindow() {
  if (startupUpdateWindow && !startupUpdateWindow.isDestroyed()) return startupUpdateWindow;
  const icon = createAppIconImage();
  startupUpdateWindow = new BrowserWindow({
    width: 460,
    height: 330,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    title: `${APP_NAME} Update`,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (icon && typeof startupUpdateWindow.setIcon === 'function') {
    startupUpdateWindow.setIcon(icon);
  }

  startupUpdateWindow.setMenuBarVisibility(false);
  startupUpdateWindow.loadFile(path.join(__dirname, '../renderer/startup-update.html'));
  startupUpdateWindow.once('ready-to-show', () => {
    if (startupUpdateWindow && !startupUpdateWindow.isDestroyed()) {
      startupUpdateWindow.show();
      if (pendingStartupStatus) {
        startupUpdateWindow.webContents.send(IPC_EVENTS.STARTUP_UPDATE_STATUS, pendingStartupStatus);
      }
    }
  });
  startupUpdateWindow.on('closed', () => {
    startupUpdateWindow = null;
  });
  return startupUpdateWindow;
}

function sendStartupUpdateStatus(payload) {
  const themePayload = {
    ...payload,
    themeColor: configStore.get('seedColor') || configStore.get('themeColor') || '#06b6d4',
    customThemeColor: configStore.get('customSeedColor') || '',
    themeMode: configStore.get('themeMode') || 'dark',
  };
  pendingStartupStatus = themePayload;
  if (startupUpdateWindow && !startupUpdateWindow.isDestroyed() && startupUpdateWindow.webContents) {
    startupUpdateWindow.webContents.send(IPC_EVENTS.STARTUP_UPDATE_STATUS, themePayload);
  }
}

function sendStartupUpdateProgress(payload) {
  if (startupUpdateWindow && !startupUpdateWindow.isDestroyed() && startupUpdateWindow.webContents) {
    startupUpdateWindow.webContents.send(IPC_EVENTS.UPDATE_PROGRESS, payload);
  }
  sendToRenderer(IPC_EVENTS.UPDATE_PROGRESS, payload);
}

function closeStartupUpdateWindow() {
  if (startupUpdateWindow && !startupUpdateWindow.isDestroyed()) {
    startupUpdateWindow.close();
  }
  startupUpdateWindow = null;
  pendingStartupStatus = null;
}

// ═══════════════════════════════════════════════════════════════════════
//  单 实 例 运 行
// ═══════════════════════════════════════════════════════════════════════
const gotTheLock = app.requestSingleInstanceLock();
traceStartup('single-instance lock result', gotTheLock ? 'granted' : 'denied');
if (!gotTheLock) {
  writeStartupDiagnostic('single-instance lock denied', {
    message: 'Another Neko Status instance is already running or holding the lock.',
  });
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  窗 口 / 托 盘 / UI 壳 层
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
//  系 统 通 知（受 enableNotification + doNotDisturb 控制）
// ═══════════════════════════════════════════════════════════════════════
function getAssetPath(...relativePaths) {
  const appExePath = process.env.NEKO_DEV_RUNTIME_EXE || app.getPath('exe') || process.execPath;
  return resolveAppAssetPath({
    app,
    fs,
    relativePaths,
    dirname: __dirname,
    execPath: appExePath,
  });
}

function getAppIconPath() {
  const appExePath = process.env.NEKO_DEV_RUNTIME_EXE || app.getPath('exe') || process.execPath;
  return resolveAppIconPath({
    app,
    fs,
    dirname: __dirname,
    execPath: appExePath,
  });
}

function ensureWindowsAppIdentity() {
  const appExePath = process.env.NEKO_DEV_RUNTIME_EXE || app.getPath('exe') || process.execPath;
  const isDevRuntime = !!process.env.NEKO_DEV_RUNTIME_EXE;
  return ensureWindowsAppIdentityShortcuts({
    app,
    shell,
    fs,
    appName: 'NekoStatus',
    appUserModelId: APP_USER_MODEL_ID,
    dirname: __dirname,
    execPath: appExePath,
    isPackaged: app.isPackaged && !isDevRuntime,
    spawnImpl: spawn,
  });
}

function showNotification(title, body) {
  if (!configStore.get('enableNotification')) return { shown: false, reason: 'disabled' };
  if (configStore.get('doNotDisturb')) return { shown: false, reason: 'do-not-disturb' };
  if (!Notification.isSupported()) return { shown: false, reason: 'unsupported' };
  const shortcut = ensureWindowsAppIdentity();
  const notification = new Notification({
    title: title || APP_NAME,
    body,
    icon: getAppIconPath(),
    silent: false,
    timeoutType: 'default',
  });
  notification.on('failed', (_, error) => {
    console.warn('[Notification] show failed:', error || 'unknown');
  });
  notification.show();
  return { shown: true, shortcutReady: shortcut.ok, shortcutError: shortcut.error || null };
}

// ═══════════════════════════════════════════════════════════════════════
//  I P C  处 理 器
// ═══════════════════════════════════════════════════════════════════════
function setupIPC() {
  // ── 配置存取 ──────────────────────────────────────────────────────────
  registerConfigIpc({ ipcMain, configStore });

  // ── 上报服务、开机自启、进程信息、权限检测与体检 ──────────────────────
  registerServiceIpc({
    ipcMain,
    app,
    configStore,
    statusService,
    apiService,
    isRunAsAdmin,
    refreshTrayMenu,
  });

  // ── 系统、应用与窗口能力 ───────────────────────────────────────────────
  registerSystemIpc({
    ipcMain,
    app,
    dialog,
    shell,
    os,
    systemUtils,
    statusService,
    metricsHistory,
    getMainWindow: () => mainWindow,
    showWindow,
    setIsQuitting: (value) => { isQuitting = value; },
    pickPrivacyWindow,
    showNotification,
    getCacheDiskSize,
    removeCacheTargets,
  });

  // ── API、设备配对与设备元数据 ──────────────────────────────────────────
  registerApiIpc({ ipcMain, os, configStore, statusService, apiService });

  // ── 直播推流 ──────────────────────────────────────────────────────────
  registerStreamIpc({ ipcMain, streamService });

  // ── 用户认证 ──────────────────────────────────────────────────────────
  registerAuthIpc({ ipcMain, os, configStore, statusService, apiService });

  // ── 更新检查、通道、下载、安装、Changelog、回滚 ──────────────────────
  registerUpdateIpc({
    ipcMain,
    app,
    shell,
    configStore,
    sendToRenderer,
    checkForUpdates,
    launchInstaller,
    getAutoDownloadState: () => _autoDownloadState,
    setAutoDownloadState: (v) => { _autoDownloadState = v; },
    setIsQuitting: (v) => { isQuitting = v; },
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  后 台 自 动 下 载（主进程内部，独立于渲染进程）
// ═══════════════════════════════════════════════════════════════════════
/**
 * 在主进程后台执行下载，不依赖渲染进程 IPC。
 * 下载成功后：
 *   - 强制更新(force=true)：直接调用 install 并退出
 *   - 普通更新：存储到 _autoDownloadState，等待用户下次启动时安装
 */
async function autoDownloadUpdate(result) {
  if (_autoDownloadState && _autoDownloadState.stage === 'downloading') {
    console.log('[AutoDL] 已有下载任务，跳过');
    return;
  }
  const downloadUrl = result.exeDownloadUrl || result.zipDownloadUrl;
  if (!downloadUrl) {
    console.warn('[AutoDL] 无可用下载链接，跳过自动下载');
    return;
  }

  _autoDownloadState = { stage: 'downloading', version: result.latestVersion, url: downloadUrl };
  console.log(`[AutoDL] 开始后台下载 v${result.latestVersion}...`);

  try {
    const headers = buildDownloadHeadersForUrl(downloadUrl, configStore);
    const res = await fetch(downloadUrl, { headers, signal: AbortSignal.timeout(300000), redirect: 'follow' });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);

    let fileName;
    const cd = res.headers.get('content-disposition') || '';
    const cdMatch = cd.match(/filename[*]?=['"']?([^'"\s;]+)/i);
    if (cdMatch) {
      fileName = cdMatch[1];
    } else {
      fileName = (res.url || downloadUrl).split('/').pop().split('?')[0] || 'NekoStatus-update.exe';
    }

    const tmpDir = path.join(os.tmpdir(), 'neko-update');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, fileName);

    const total = parseInt(res.headers.get('content-length') || '0', 10);
    let received = 0;
    const chunks = [];
    const reader = res.body.getReader();
    const startedAt = Date.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      received += value.length;
      const elapsed = (Date.now() - startedAt) / 1000;
      const speed = elapsed > 0 ? Math.round(received / elapsed) : 0;
      // 后台下载也推送进度（渲染进程可选择展示）
      sendToRenderer(IPC_EVENTS.UPDATE_PROGRESS, {
        received, total,
        pct: total > 0 ? Math.round(received / total * 100) : -1,
        speed,
      });
    }

    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(filePath, buffer);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();

    console.log(`[AutoDL] 下载完成: ${filePath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

    if (result.forceUpdate) {
      // 强制更新：立即安装
      console.log('[AutoDL] 强制更新，立即启动安装程序...');
      _autoDownloadState = null;
      sendToRenderer(IPC_EVENTS.UPDATE_FORCE_INSTALL_STARTED, { version: result.latestVersion });
      const installError = await launchInstaller(filePath, { silent: true });
      if (installError) console.error('[AutoDL] installer launch failed:', installError);
      setTimeout(() => { isQuitting = true; app.quit(); }, 1500);
    } else {
      // 普通自动下载：持久化到配置文件（跨进程存活），内存状态同步保留
      // 持久化是修复死循环的关键：重启后能识别已下载版本，不再重复下载
      configStore.set('pendingInstall', { version: result.latestVersion, filePath, sha256 });
      _autoDownloadState = { stage: 'ready', version: result.latestVersion, filePath, sha256 };
      console.log(`[AutoDL] 普通更新 v${result.latestVersion} 已下载并持久化，下次启动将自动安装`);
      sendToRenderer(IPC_EVENTS.UPDATE_AUTO_DOWNLOADED, { version: result.latestVersion, filePath, sha256 });
    }
  } catch (err) {
    console.error('[AutoDL] 后台下载失败:', err.message);
    _autoDownloadState = null;
    sendToRenderer(IPC_EVENTS.UPDATE_AUTO_DOWNLOAD_FAILED, { version: result.latestVersion, error: err.message });
  }
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

function extractVersionFromAssetName(name) {
  const text = String(name || '');
  const match = text.match(/(?:NekoStatus(?:-Setup)?-)?v?(\d+\.\d+\.\d+(?:-(?:beta|nightly)[\w.-]*)?)/i);
  return match ? match[1] : '';
}

function buildPersonalRawUrl(source, name) {
  if (!source || source.type !== 'personal' || !source.owner || !source.repo || !source.baseUrl || !name) return null;
  return `${source.baseUrl}/${source.owner}/${source.repo}/raw/branch/main/${encodeURIComponent(name)}`;
}

function normalizeReleaseAsset(asset, source) {
  const name = String(asset.name || asset.path || '').split(/[\\/]/).pop();
  const rawDownloadUrl = asset.browser_download_url || asset.download_url || asset.url || null;
  const isPersonalContentApi = source?.type === 'personal' && /\/api\/v1\/repos\/.+\/contents\//i.test(rawDownloadUrl || '');
  const downloadUrl = source?.type === 'personal' && (!rawDownloadUrl || isPersonalContentApi || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(rawDownloadUrl))
    ? buildPersonalRawUrl(source, name)
    : rawDownloadUrl;
  return {
    ...asset,
    name,
    size: Number(asset.size) || 0,
    browser_download_url: downloadUrl,
  };
}

function synthesizeReleasesFromFiles(files, source, releaseNotes = '') {
  const releasesByVersion = new Map();
  for (const file of files || []) {
    if (file.type && file.type !== 'file') continue;
    const asset = normalizeReleaseAsset(file, source);
    if (!/\.(exe|zip|txt)$/i.test(asset.name)) continue;
    const version = extractVersionFromAssetName(asset.name);
    if (!version && asset.name !== 'SHA256SUMS.txt') continue;
    const key = version || 'checksums';
    if (!releasesByVersion.has(key)) {
      releasesByVersion.set(key, {
        tag_name: version ? `v${version}` : key,
        prerelease: /-(beta|nightly)/i.test(version),
        published_at: new Date().toISOString(),
        body: releaseNotes || 'Synthesized from personal update repository files.',
        assets: [],
      });
    }
    releasesByVersion.get(key).assets.push(asset);
  }

  const checksumRelease = releasesByVersion.get('checksums');
  const checksumAsset = checksumRelease?.assets?.find((asset) => asset.name === 'SHA256SUMS.txt');
  const releases = Array.from(releasesByVersion.entries())
    .filter(([version]) => version !== 'checksums')
    .map(([, release]) => {
      if (checksumAsset && !release.assets.some((asset) => asset.name === 'SHA256SUMS.txt')) {
        release.assets.push(checksumAsset);
      }
      return release;
    });
  return releases.sort((a, b) => compareVersionsFull(b.tag_name, a.tag_name));
}

async function fetchPersonalReleaseNotesFromFiles(files, source, options = {}) {
  const notesFile = (files || []).find((file) => {
    const name = String(file.name || file.path || '').split(/[\\/]/).pop().toLowerCase();
    return name === 'release_notes.txt';
  });
  if (!notesFile) return '';

  const asset = normalizeReleaseAsset(notesFile, source);
  const url = asset.browser_download_url;
  if (!url) return '';

  try {
    const res = await fetch(url, {
      headers: buildReleaseHeaders(source),
      signal: AbortSignal.timeout(options.releaseFetchTimeoutMs || 10000),
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function fetchPersonalFileReleases(source, options = {}) {
  if (source.type !== 'personal' || !source.contentsUrl) return [];
  const res = await fetch(source.contentsUrl, {
    headers: buildReleaseHeaders(source),
    signal: AbortSignal.timeout(options.releaseFetchTimeoutMs || 10000),
  });
  if (!res.ok) throw new Error(`Personal update file listing returned HTTP ${res.status}`);
  const files = await res.json();
  const fileList = Array.isArray(files) ? files : [];
  const releaseNotes = await fetchPersonalReleaseNotesFromFiles(fileList, source, options);
  return synthesizeReleasesFromFiles(fileList, source, releaseNotes);
}

// ═══════════════════════════════════════════════════════════════════════
//  GitHub 三 通 道 更 新 检 查
// ═══════════════════════════════════════════════════════════════════════
async function buildUpdateResultFromReleaseList(all, source, channel) {
  if (!Array.isArray(all) || !all.length) {
    return {
      hasUpdate: false,
      channel,
      sourceType: source.type,
      sourceId: source.id,
      sourceLabel: source.label,
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      error: 'No releases or update files were found in the active update source.',
    };
  }

  let release;
  if (channel === 'stable') {
    const stableReleases = all.filter((r) => !r.prerelease);
    if (stableReleases.length === 0) {
      return {
        hasUpdate: false,
        channel,
        sourceType: source.type,
        sourceId: source.id,
        sourceLabel: source.label,
        currentVersion: APP_VERSION,
        latestVersion: APP_VERSION,
        error: 'No stable release exists in the active update source. Switch to beta or nightly if needed.',
      };
    }
    release = stableReleases[0];
  } else {
    const filtered = all.filter((r) => isTagInChannel(r.tag_name, channel));
    if (filtered.length === 0) {
      return {
        hasUpdate: false,
        channel,
        sourceType: source.type,
        sourceId: source.id,
        sourceLabel: source.label,
        currentVersion: APP_VERSION,
        latestVersion: APP_VERSION,
      };
    }
    release = filtered.reduce((best, cur) =>
      compareVersionsFull(cur.tag_name, best.tag_name) > 0 ? cur : best
    );
  }

  const latestVersion = (release.tag_name || '').replace(/^v/, '');
  const hasUpdate = compareVersionsFull(latestVersion, APP_VERSION) > 0;
  const assets = release.assets || [];
  const exeAsset = assets.find((a) => String(a.name || '').toLowerCase().endsWith('.exe'));
  const zipAsset = assets.find((a) => {
    const name = String(a.name || '').toLowerCase();
    return name.endsWith('.zip') && (name.includes('win') || name.includes('windows'));
  });
  const sumsAsset = assets.find((a) => a.name === 'SHA256SUMS.txt');
  const releaseBody = release.body || '';
  const primaryAsset = exeAsset || zipAsset;

  return {
    hasUpdate,
    channel,
    sourceType: source.type,
    sourceId: source.id,
    sourceLabel: source.label,
    releasePageUrl: source.releasePageUrl,
    latestVersion,
    currentVersion: APP_VERSION,
    releaseNotes: releaseBody,
    forceUpdate: releaseBody.includes('<!-- FORCE_UPDATE -->'),
    exeDownloadUrl: pickAssetDownloadUrl(exeAsset, source),
    zipDownloadUrl: pickAssetDownloadUrl(zipAsset, source),
    sha256sumsUrl: pickAssetDownloadUrl(sumsAsset, source),
    publishedAt: release.published_at,
    downloadSize: primaryAsset ? primaryAsset.size : 0,
  };
}

async function checkSourceForUpdates(source, channel, options = {}) {
  const {
    estimateSpeed: shouldEstimateSpeed = true,
    releaseFetchTimeoutMs = 10000,
  } = options || {};
  if (!source.owner || !source.repo || !source.releasesUrl) {
    return {
      hasUpdate: false,
      channel,
      sourceType: source.type,
      sourceId: source.id,
      sourceLabel: source.label,
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      error: source.type === 'personal'
        ? 'Personal update source is missing owner/repo. Use a repository URL such as https://git.koirin.com:39520/owner/repo.'
        : 'GitHub update source is missing owner/repo.',
    };
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(`${source.releasesUrl}?per_page=30`, {
      headers: buildReleaseHeaders(source),
      signal: AbortSignal.timeout(releaseFetchTimeoutMs),
    });
    if (!res.ok) {
      const prefix = source.type === 'personal' ? 'Personal update source' : 'GitHub API';
      if (source.type === 'personal' && res.status === 404) {
          const fallback = await fetchPersonalFileReleases(source, options);
        if (fallback.length) {
          const result = await buildUpdateResultFromReleaseList(fallback, source, channel);
          
          const downloadUrl = result.exeDownloadUrl || result.zipDownloadUrl;
          let speedEstimate = { bytesPerSecond: 0 };
          if (downloadUrl && shouldEstimateSpeed) {
            speedEstimate = await estimateDownloadSpeed(downloadUrl, configStore);
          }

          return {
            ...result,
            sourceLatencyMs: Date.now() - startedAt,
            downloadSpeedBytesPerSecond: speedEstimate.bytesPerSecond || 0,
            downloadSpeedSampleBytes: speedEstimate.sampledBytes || 0,
            downloadSpeedSampleMs: speedEstimate.durationMs || 0,
            downloadSpeedProbeMethod: speedEstimate.method || 'failed',
            sourceMode: 'selected'
          };
        }
      }
      if (res.status === 404) throw new Error(`${prefix} repository not found: ${source.label}`);
      throw new Error(`${prefix} returned HTTP ${res.status}`);
    }

    const text = await res.text();
    let all;
    try {
      all = JSON.parse(text);
    } catch (parseErr) {
      throw new Error(`Failed to parse release JSON: ${parseErr.message}`);
    }

    if (source.type === 'personal' && (!Array.isArray(all) || all.length === 0)) {
      all = await fetchPersonalFileReleases(source, options);
    }
    const result = await buildUpdateResultFromReleaseList(all, source, channel);

    // 进行高精度的实际包采样测速
    const downloadUrl = result.exeDownloadUrl || result.zipDownloadUrl;
    let speedEstimate = { bytesPerSecond: 0 };
    if (downloadUrl && shouldEstimateSpeed) {
      speedEstimate = await estimateDownloadSpeed(downloadUrl, configStore);
    }

    return {
      ...result,
      sourceLatencyMs: Date.now() - startedAt,
      downloadSpeedBytesPerSecond: speedEstimate.bytesPerSecond || 0,
      downloadSpeedSampleBytes: speedEstimate.sampledBytes || 0,
      downloadSpeedSampleMs: speedEstimate.durationMs || 0,
      downloadSpeedProbeMethod: speedEstimate.method || 'failed',
      sourceMode: 'selected'
    };
  } catch (err) {
    return {
      hasUpdate: false,
      channel,
      sourceType: source.type,
      sourceId: source.id,
      sourceLabel: source.label,
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      error: err.message,
      sourceLatencyMs: Date.now() - startedAt,
      downloadSpeedBytesPerSecond: 0,
      sourceMode: 'selected',
    };
  }
}

function scoreUpdateSourceResult(result) {
  if (!result || result.error) return Number.POSITIVE_INFINITY;
  const latency = Number(result.sourceLatencyMs) || 999999;
  const hasInstaller = result.exeDownloadUrl || result.zipDownloadUrl;
  const updateBonus = result.hasUpdate ? -100000 : 0;
  const installerPenalty = hasInstaller ? 0 : 50000;
  return latency + installerPenalty + updateBonus;
}

async function checkForUpdates(options = {}) {
  const channel = configStore.get('updateChannel') || 'stable';
  const mode = getUpdateSourceMode(configStore);

  if (mode === 'smart') {
    const sources = getSavedUpdateSources(configStore);
    if (!sources.length) {
      return {
        hasUpdate: false,
        channel,
        sourceMode: 'smart',
        currentVersion: APP_VERSION,
        latestVersion: APP_VERSION,
        error: 'No update sources are configured.',
      };
    }

    const results = options.parallelSources === false
      ? []
      : await Promise.all(sources.map(async (source) => ({
        ...(await checkSourceForUpdates(source, channel, options)),
        sourceMode: 'smart',
      })));
    if (options.parallelSources === false) {
      for (const source of sources) {
        const result = await checkSourceForUpdates(source, channel, options);
        results.push({ ...result, sourceMode: 'smart' });
      }
    }

    const healthy = results.filter((result) => !result.error);
    const best = (healthy.length ? healthy : results)
      .slice()
      .sort((a, b) => scoreUpdateSourceResult(a) - scoreUpdateSourceResult(b))[0];

    return {
      ...best,
      sourceMode: 'smart',
      smartSources: results.map((result) => ({
        sourceId: result.sourceId,
        sourceType: result.sourceType,
        sourceLabel: result.sourceLabel,
        latencyMs: result.sourceLatencyMs,
        downloadSpeedBytesPerSecond: result.downloadSpeedBytesPerSecond || 0,
        downloadSpeedSampleBytes: result.downloadSpeedSampleBytes || 0,
        downloadSpeedSampleMs: result.downloadSpeedSampleMs || 0,
        downloadSpeedProbeMethod: result.downloadSpeedProbeMethod || '',
        hasUpdate: !!result.hasUpdate,
        latestVersion: result.latestVersion,
        hasInstaller: !!(result.exeDownloadUrl || result.zipDownloadUrl),
        error: result.error || '',
      })),
    };
  }

  const source = getActiveUpdateSource(configStore);
  return await checkSourceForUpdates(source, channel, options);
}

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
  traceStartup('whenReady entered', `packaged=${app.isPackaged}`);
  ensureWindowsAppIdentity();
  setupIPC();
  const shouldAutoDownload = configStore.get('autoDownload') === true;
  const pendingInstall = configStore.get('pendingInstall');
  const isDevScenario = !app.isPackaged && !!process.env.NEKO_DEV_STARTUP_UPDATE_SCENARIO;
  traceStartup('startup gate flags', `autoDownload=${shouldAutoDownload}; pending=${!!pendingInstall}; devScenario=${isDevScenario}`);

  if (shouldAutoDownload || pendingInstall || isDevScenario) {
    traceStartup('startup gate begin');
    createStartupUpdateWindow();
    const startupUpdate = await runStartupUpdateGate({
      configStore,
      checkForUpdates,
      launchInstaller,
      sendToRenderer: sendStartupUpdateProgress,
      onStatus: sendStartupUpdateStatus,
      setIsQuitting: (value) => { isQuitting = value; },
      quitApp: () => app.quit(),
      showNotification,
      isPackaged: app.isPackaged,
    });
    traceStartup('startup gate result', JSON.stringify(startupUpdate || {}));
    if (startupUpdate.action === 'installing') return;
    closeStartupUpdateWindow();
  }

  traceStartup('create main window begin');
  createWindow();
  traceStartup('create tray begin');
  createTray();
  traceStartup('shell created');

  // StatusService 日志/Tick/状态变更 → 推送到渲染进程
  statusService.setLogCallback((level, msg, time) => {
    sendToRenderer(IPC_EVENTS.LOG_ENTRY, { level, msg, time });
  });
  statusService.setTickCallback((data) => {
    sendToRenderer(IPC_EVENTS.SERVICE_TICK, data);
    refreshTrayMenu();
  });
  statusService.setStatusChangeCallback((isRunning) => {
    sendToRenderer(IPC_EVENTS.SERVICE_STATUS_CHANGED, { isRunning });
    refreshTrayMenu();
    showNotification('服务状态变更', isRunning ? '上报服务已启动' : '上报服务已停止');
  });
  statusService.setKeyStatusCallback((code, message) => {
    sendToRenderer(IPC_EVENTS.SERVICE_KEY_STATUS, { code, message });
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
      if (configStore.get('minimizeOnAutoStart')) {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.minimize();
        }
      } else {
        showWindow();
      }
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

  // 首屏完成后再补一次后台检查：启动门禁失败或开发模式跳过安装时，仍可提示用户。
  setTimeout(async () => {
    await runBackgroundUpdateCheck({
      configStore,
      checkForUpdates,
      autoDownloadUpdate,
      sendToRenderer,
      label: 'post-startup',
    });
  }, 15000);

  // 长期运行时每 30 分钟轮询一次更新
  setInterval(async () => {
    await runBackgroundUpdateCheck({
      configStore,
      checkForUpdates,
      autoDownloadUpdate,
      sendToRenderer,
      label: 'interval',
    });
  }, 30 * 60 * 1000);

  // 应用启动后同步设备元数据（兜底机制，防止渲染进程未能正常触发 syncMeta）
  // 正常情况下 app:init 回调已在渲染进程侧完成首次同步，此处仅在延迟后补发一次确保万无一失
  setTimeout(() => {
    const deviceKey = configStore.get('deviceKey');
    if (deviceKey) {
      const serverUrl = configStore.getServerUrl();
      const reportEnabled = statusService.isRunning;
      const captureEnabled = configStore.get('enableScreenshot') === true;
      fetch(`${serverUrl}/api/device/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceKey, reportEnabled, captureEnabled }),
        signal: AbortSignal.timeout(8000),
      }).then(r => {
        if (r.ok) console.log('[Meta] 启动元数据同步成功');
        else console.warn(`[Meta] 启动元数据同步失败: HTTP ${r.status}`);
      }).catch(e => console.warn('[Meta] 启动元数据同步异常:', e.message));
    }
  }, 10000);

  // 定期采集系统指标（5s 一次，配合 1m 区间每 5s 刷新），延迟首次采集等窗口渲染完成
  setTimeout(() => {
    setInterval(async () => {
      try {
        const m = await systemUtils.getSystemMetrics();
        m.timestamp = Date.now();
        metricsHistory.push(m);
        if (metricsHistory.length > MAX_METRICS_HISTORY) metricsHistory.shift();
        sendToRenderer(IPC_EVENTS.SYSTEM_METRICS_UPDATE, m);
      } catch { /* 指标采集失败静默处理 */ }
    }, 5000);
  }, 3000);
}).catch((error) => {
  writeStartupDiagnostic('whenReady failed', error);
  console.error('[Startup] whenReady failed:', error);
  app.quit();
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
  streamService.disconnectObs();
});

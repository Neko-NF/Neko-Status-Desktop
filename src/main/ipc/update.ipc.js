/**
 * src/main/ipc/update.ipc.js
 * 更新检查、通道管理、下载、安装、Changelog、完整性与版本回滚 IPC
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const {
  IPC_CHANNELS,
  IPC_EVENTS,
  createIpcSuccess,
  createIpcError,
} = require('../../shared/ipc-contracts');
const {
  validateUpdateDownloadPayload,
  validateUpdateInstallPayload,
} = require('../../shared/schemas');
const {
  buildDownloadHeadersForUrl,
} = require('../update-source');

const INSTALLABLE_EXTENSIONS = new Set(['.exe', '.zip', '.7z']);

/**
 * @param {Object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {import('electron').App} deps.app
 * @param {import('electron').Shell} deps.shell
 * @param {Object} deps.configStore
 * @param {Function} deps.sendToRenderer        — 推送事件给渲染进程
 * @param {Function} deps.checkForUpdates        — 更新检查核心逻辑
 * @param {Function} deps.launchInstaller        — 启动安装包
 * @param {Function} deps.getAutoDownloadState   — () => _autoDownloadState
 * @param {Function} deps.setAutoDownloadState   — (value) => void
 * @param {Function} deps.setIsQuitting          — (value) => void
 */
function registerUpdateIpc({
  ipcMain,
  app,
  shell,
  configStore,
  sendToRenderer,
  checkForUpdates,
  launchInstaller,
  getAutoDownloadState,
  setAutoDownloadState,
  setIsQuitting,
}) {
  const APP_VERSION = app.getVersion();

  // ── 更新检查 ──────────────────────────────────────────────────────────
  // checkForUpdates already returns a structured { hasUpdate, latestVersion, error, ... } object.
  // Do NOT wrap with createIpcSuccess — the renderer consumes this format directly.
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => await checkForUpdates());

  // ── 更新通道管理 ──────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_CHANNEL, () => createIpcSuccess(configStore.get('updateChannel') || 'stable'));
  ipcMain.handle(IPC_CHANNELS.UPDATE_SET_CHANNEL, (_, channel) => {
    if (!['stable', 'beta', 'nightly'].includes(channel)) {
      return createIpcError('INVALID_UPDATE_CHANNEL', 'Invalid update channel');
    }
    configStore.set('updateChannel', channel);
    return createIpcSuccess(true);
  });

  // ── 获取待安装的已下载更新 ──────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_PENDING_INSTALL, () => {
    const state = getAutoDownloadState();
    if (state && state.stage === 'ready') {
      return createIpcSuccess({ hasPending: true, version: state.version, filePath: state.filePath, sha256: state.sha256 });
    }
    // 回退：检查跨会话持久化的待安装记录（重启后内存状态已清空时使用）
    const persisted = configStore.get('pendingInstall');
    if (persisted && persisted.filePath && fs.existsSync(persisted.filePath)) {
      return createIpcSuccess({ hasPending: true, version: persisted.version, filePath: persisted.filePath, sha256: persisted.sha256 });
    }
    return createIpcSuccess({ hasPending: false });
  });

  // ── 安装已下载的待安装更新 ────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL_PENDING, async () => {
    // 优先使用内存状态，回退到持久化记录
    const state = (() => {
      const mem = getAutoDownloadState();
      return (mem && mem.stage === 'ready') ? mem : configStore.get('pendingInstall');
    })();
    if (!state || !state.filePath) {
      return createIpcError('NO_PENDING_INSTALL', '没有待安装的更新');
    }
    const { filePath, sha256 } = state;
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      setAutoDownloadState(null);
      configStore.set('pendingInstall', null);
      return createIpcError('INSTALLER_MISSING', '安装文件已不存在，请重新下载');
    }
    if (sha256) {
      const data = fs.readFileSync(resolvedPath);
      const actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase();
      if (actual !== sha256.toLowerCase()) {
        setAutoDownloadState(null);
        configStore.set('pendingInstall', null);
        return createIpcError('SHA256_MISMATCH', 'SHA256 校验失败，文件可能已损坏');
      }
    }
    let installError;
    try {
      installError = await launchInstaller(resolvedPath, { silent: true });
    } catch (error) {
      installError = error.message;
    }
    if (installError) {
      console.error('[Update] installer launch failed:', installError);
      return createIpcError('INSTALL_LAUNCH_FAILED', installError);
    }
    configStore.set('pendingInstall', null);
    setAutoDownloadState(null);
    setTimeout(() => { setIsQuitting(true); app.quit(); }, 1000);
    return createIpcSuccess({ success: true });
  });

  // ── 更新下载（流式，推送进度至渲染进程）──────────────────────────────
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async (_, payload) => {
    const validation = validateUpdateDownloadPayload(payload);
    if (!validation.ok) {
      return createIpcError('INVALID_DOWNLOAD_PAYLOAD', validation.reason);
    }
    const { url } = payload;
    if (!/^https?:\/\//i.test(url)) {
      return createIpcError('INVALID_DOWNLOAD_URL', '无效下载链接');
    }
    // 防重入检查
    const currentState = getAutoDownloadState();
    if (currentState && currentState.stage === 'downloading') {
      return createIpcError('', '已有下载任务进行中，请稍候');
    }
    try {
      const tmpDir = path.join(os.tmpdir(), 'neko-update');
      fs.mkdirSync(tmpDir, { recursive: true });

      // 私有仓库支持
      const headers = buildDownloadHeadersForUrl(url, configStore);
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(300000), redirect: 'follow' });
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);

      // 从 Content-Disposition 或 URL 提取文件名
      let fileName;
      const cd = res.headers.get('content-disposition') || '';
      const cdMatch = cd.match(/filename[*]?=['"]?([^'"\s;]+)/i);
      if (cdMatch) {
        fileName = cdMatch[1];
      } else {
        fileName = (res.url || url).split('/').pop().split('?')[0] || 'NekoStatus-update.exe';
      }
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
        sendToRenderer(IPC_EVENTS.UPDATE_PROGRESS, {
          received, total,
          pct: total > 0 ? Math.round(received / total * 100) : -1,
          speed,
        });
      }

      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(filePath, buffer);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
      return createIpcSuccess({ success: true, filePath, sha256 });
    } catch (err) {
      return createIpcError('DOWNLOAD_FAILED', err.message);
    }
  });

  // ── 更新安装（SHA256 校验 → 启动安装包 → 退出）────────────────────────
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, async (_, payload) => {
    const validation = validateUpdateInstallPayload(payload);
    if (!validation.ok) {
      return createIpcError('INVALID_INSTALL_PAYLOAD', validation.reason);
    }
    const { filePath, expectedSha256, manual } = payload;
    const resolvedPath = path.resolve(filePath);
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!INSTALLABLE_EXTENSIONS.has(ext)) {
      return createIpcError('UNSUPPORTED_INSTALLER_TYPE', 'Only .exe, .zip and .7z update packages are supported');
    }
    if (!fs.existsSync(resolvedPath)) {
      return createIpcError('INSTALLER_MISSING', '安装文件不存在');
    }
    // SHA256 可选校验
    if (expectedSha256) {
      const data = fs.readFileSync(resolvedPath);
      const actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase();
      if (actual !== expectedSha256.toLowerCase()) {
        return createIpcError('SHA256_MISMATCH', `SHA256 校验失败（期望 ${expectedSha256}，实际 ${actual}）`);
      }
    }
    // 仅在安装器确认启动后退出；Agent 停止或安装器启动失败时留在应用内重试。
    let installError;
    try {
      installError = await launchInstaller(resolvedPath, { silent: !manual });
    } catch (error) {
      installError = error.message;
    }
    if (installError) {
      console.error('[Update] installer launch failed:', installError);
      return createIpcError('INSTALL_LAUNCH_FAILED', installError);
    }
    setTimeout(() => { setIsQuitting(true); app.quit(); }, 1000);
    return createIpcSuccess({ success: true });
  });

  // ── 多版本更新日志（在线获取，回落本地缓存）────────────────────────────
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_CHANGELOG, async () => {
    const owner = configStore.get('githubOwner') || 'Neko-NF';
    const repo  = configStore.get('githubRepo') || 'Neko-Status-Desktop';
    if (!owner || !repo) return createIpcSuccess(configStore.get('changelogCache') || []);
    const token   = configStore.get('githubToken') || '';
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=15`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const releases = await res.json();
      const currentVersion = String(APP_VERSION || '').replace(/^v/, '');
      const currentRelease = releases.find((r) => String(r.tag_name || '').replace(/^v/, '') === currentVersion);
      const result = currentRelease ? [{
        version: currentVersion,
        date: (currentRelease.published_at || '').slice(0, 10),
        notes: currentRelease.body || '',
        isPreRelease: !!currentRelease.prerelease,
        isCurrent: true,
      }] : [];
      configStore.set('changelogCache', result);
      return createIpcSuccess(result);
    } catch {
      // 网络不可用 → 返回本地缓存（仅当前版本）
      return createIpcSuccess(configStore.get('changelogCache') || []);
    }
  });

  // ── 完整性检查 ───────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.UPDATE_INTEGRITY, async () => {
    const results = [];
    // 配置文件
    try {
      const cfg = configStore.getAll();
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
    return createIpcSuccess(results);
  });

  // ── 版本回滚（获取 GitHub 上一个稳定版信息）─────────────────────────
  ipcMain.handle(IPC_CHANNELS.UPDATE_ROLLBACK, async () => {
    const owner = configStore.get('githubOwner');
    const repo  = configStore.get('githubRepo');
    if (!owner || !repo) return createIpcError('UPDATE_SOURCE_MISSING', '未配置更新源，无法查询历史版本');
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
      if (stable.length < 2) return createIpcError('NO_ROLLBACK_VERSION', '没有可回滚的历史稳定版本');
      const prev = stable[1];
      const prevVersion = (prev.tag_name || '').replace(/^v/, '');
      const exeAsset = (prev.assets || []).find((a) => a.name.endsWith('.exe'));
      const zipAsset = (prev.assets || []).find((a) => a.name.endsWith('.zip') && a.name.toLowerCase().includes('win'));
      // 私有仓库使用 asset API URL
      const pickUrl = (a) => a ? (token ? a.url : a.browser_download_url) : null;
      const exeDownloadUrl = pickUrl(exeAsset);
      const zipDownloadUrl = pickUrl(zipAsset);
      const downloadUrl = exeDownloadUrl || zipDownloadUrl;
      if (!downloadUrl) return createIpcError('ROLLBACK_ASSET_MISSING', `找不到 v${prevVersion} 的安装包`);
      return createIpcSuccess({ success: true, version: prevVersion, downloadUrl, exeDownloadUrl, zipDownloadUrl });
    } catch (err) {
      return createIpcError('ROLLBACK_FAILED', err.message);
    }
  });
}

module.exports = { registerUpdateIpc };

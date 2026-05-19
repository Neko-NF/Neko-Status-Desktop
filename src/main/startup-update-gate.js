const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { IPC_EVENTS } = require('../shared/ipc-contracts');
const {
  buildDownloadHeadersForUrl,
} = require('./update-source');

const DEFAULT_STARTUP_CHECK_TIMEOUT_MS = 12000;
const DEFAULT_STARTUP_CHECK_OPTIONS = {
  estimateSpeed: false,
  releaseFetchTimeoutMs: 4000,
  parallelSources: true,
  reason: 'startup',
};
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 300000;
const DEV_STARTUP_UPDATE_SCENARIOS = new Set([
  'checking',
  'available',
  'download',
  'installing',
  'failed',
  'offline',
  'up-to-date',
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label || 'operation'} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function getInstallerUrl(result) {
  return result && result.exeDownloadUrl ? result.exeDownloadUrl : null;
}

function normalizeDevStartupUpdateScenario(value) {
  const scenario = String(value || '').trim().toLowerCase();
  return DEV_STARTUP_UPDATE_SCENARIOS.has(scenario) ? scenario : '';
}

async function runDevStartupUpdateScenario(scenario, deps) {
  const {
    onStatus = () => {},
    sendToRenderer = () => {},
    scenarioStepMs = 350,
    logger = console,
  } = deps;

  const wait = async () => {
    if (scenarioStepMs > 0) await delay(scenarioStepMs);
  };

  const status = async (payload) => {
    onStatus(payload);
    await wait();
  };

  const progress = async (pct) => {
    const payload = { received: pct, total: 100, pct };
    sendToRenderer(IPC_EVENTS.UPDATE_PROGRESS, payload);
    await status({
      title: 'Dev startup update test',
      message: 'Simulating a startup update download in development mode.',
      detail: `Download progress ${pct}%`,
      pct,
      devScenario: scenario,
    });
  };

  logger.log?.(`[StartupUpdate] running dev startup update scenario: ${scenario}`);

  await status({
    title: 'Dev startup update test',
    message: 'Checking for updates before opening the app.',
    detail: 'Using a deterministic development scenario.',
    pct: -1,
    devScenario: scenario,
  });

  if (scenario === 'checking') {
    await status({
      title: 'Dev startup update test',
      message: 'The startup update check UI is visible.',
      detail: 'Opening the app after the test hold.',
      pct: 100,
      devScenario: scenario,
    });
    return { action: 'open', reason: 'dev-startup-update-scenario', scenario };
  }

  if (scenario === 'failed' || scenario === 'offline') {
    await status({
      title: 'Dev startup update test',
      message: 'The update source cannot be reached. The app will continue opening.',
      detail: scenario === 'offline' ? 'Simulated offline state.' : 'Simulated update failure.',
      pct: 100,
      devScenario: scenario,
    });
    return { action: 'open', reason: 'dev-startup-update-scenario', scenario };
  }

  if (scenario === 'up-to-date') {
    await status({
      title: 'Dev startup update test',
      message: 'No update is available. The app will continue opening.',
      detail: 'Simulated latest-version state.',
      pct: 100,
      devScenario: scenario,
    });
    return { action: 'open', reason: 'dev-startup-update-scenario', scenario };
  }

  await status({
    title: 'Dev startup update test',
    message: 'A new version was found before the app opened.',
    detail: 'Simulated version v9.9.9.',
    pct: -1,
    devScenario: scenario,
  });

  if (scenario === 'available') {
    sendToRenderer(IPC_EVENTS.UPDATE_AVAILABLE, {
      hasUpdate: true,
      latestVersion: '9.9.9',
      releaseNotes: 'Development startup update scenario.',
    });
    await status({
      title: 'Dev startup update test',
      message: 'Development mode will not run an installer.',
      detail: 'Opening the app with update availability forwarded to the renderer.',
      pct: 100,
      devScenario: scenario,
    });
    return { action: 'open', reason: 'dev-startup-update-scenario', scenario };
  }

  if (scenario === 'download') {
    for (const pct of [0, 25, 50, 75, 100]) {
      await progress(pct);
    }
  }

  await status({
    title: 'Dev startup update test',
    message: 'The installer handoff state is being shown without launching an installer.',
    detail: 'Opening the app after the simulated installer handoff.',
    pct: 100,
    devScenario: scenario,
  });

  return { action: 'open', reason: 'dev-startup-update-scenario', scenario };
}

function buildDownloadHeaders(url, configStore) {
  return buildDownloadHeadersForUrl(url, configStore);
}

function inferFileName(response, fallbackUrl) {
  const contentDisposition = response.headers.get('content-disposition') || '';
  const match = contentDisposition.match(/filename[*]?=['"]?([^'"\s;]+)/i);
  if (match) return match[1];
  return (response.url || fallbackUrl).split('/').pop().split('?')[0] || 'NekoStatus-update.exe';
}

async function downloadInstaller(result, deps) {
  const {
    configStore,
    sendToRenderer = () => {},
    onStatus = () => {},
    fetchImpl = fetch,
    tempRoot = os.tmpdir(),
    downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  } = deps;

  const url = getInstallerUrl(result);
  if (!url) throw new Error('No executable installer asset is available for this update');
  if (!/^https?:\/\//i.test(url)) throw new Error('Invalid installer download URL');

  const response = await fetchImpl(url, {
    headers: buildDownloadHeaders(url, configStore),
    signal: AbortSignal.timeout(downloadTimeoutMs),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Download failed HTTP ${response.status}`);

  onStatus({
    title: '正在下载更新',
    message: `Neko Status v${result.latestVersion} 下载完成后将自动安装。`,
    detail: '正在接收安装包...',
    pct: -1,
  });

  const tmpDir = path.join(tempRoot, 'neko-update');
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, inferFileName(response, url));

  const total = parseInt(response.headers.get('content-length') || '0', 10);
  let received = 0;
  const chunks = [];

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const startedAt = Date.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      received += value.length;
      const elapsed = (Date.now() - startedAt) / 1000;
      const speed = elapsed > 0 ? Math.round(received / elapsed) : 0;
      sendToRenderer(IPC_EVENTS.UPDATE_PROGRESS, {
        received,
        total,
        pct: total > 0 ? Math.round((received / total) * 100) : -1,
        speed,
      });
      onStatus({
        title: '正在下载更新',
        message: `Neko Status v${result.latestVersion} 下载完成后将自动安装。`,
        detail: total > 0 ? `下载进度 ${Math.round((received / total) * 100)}%` : '正在接收安装包...',
        pct: total > 0 ? Math.round((received / total) * 100) : -1,
        speed,
      });
    }
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    chunks.push(buffer);
    received = buffer.length;
    sendToRenderer(IPC_EVENTS.UPDATE_PROGRESS, {
      received,
      total: total || received,
      pct: 100,
      speed: 0,
    });
    onStatus({
      title: '正在下载更新',
      message: `Neko Status v${result.latestVersion} 下载完成后将自动安装。`,
      detail: '下载进度 100%',
      pct: 100,
      speed: 0,
    });
  }

  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(filePath, buffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
  return { filePath, sha256, version: result.latestVersion };
}

function resolvePendingInstall(configStore) {
  const pending = configStore.get('pendingInstall');
  if (!pending || !pending.filePath) return null;

  const resolvedPath = path.resolve(pending.filePath);
  if (!fs.existsSync(resolvedPath)) {
    configStore.set('pendingInstall', null);
    return null;
  }

  if (pending.sha256) {
    const data = fs.readFileSync(resolvedPath);
    const actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase();
    if (actual !== String(pending.sha256).toLowerCase()) {
      configStore.set('pendingInstall', null);
      return null;
    }
  }

  return { ...pending, filePath: resolvedPath };
}

async function launchAndQuitForInstall(update, deps) {
  const {
    configStore,
    launchInstaller,
    setIsQuitting = () => {},
    quitApp = () => {},
    showNotification = () => {},
    onStatus = () => {},
    quitDelayMs = 1200,
    logger = console,
  } = deps;

  configStore.set('pendingInstall', null);
  onStatus({
    title: '正在启动安装',
    message: `Neko Status v${update.version || ''} 正在交给安装程序处理。`,
    detail: '安装完成后软件会自动重新打开。',
    pct: 100,
  });
  const installError = await launchInstaller(update.filePath, { silent: true, relaunchAfterInstall: true });
  if (installError) {
    logger.warn?.('[StartupUpdate] installer launch failed:', installError);
    return { action: 'open', reason: 'installer-launch-failed', error: installError };
  }

  showNotification('正在自动更新', `Neko Status v${update.version || ''} 正在安装，完成后将自动重新打开。`);
  setIsQuitting(true);
  setTimeout(() => quitApp(), quitDelayMs);
  return { action: 'installing', version: update.version, filePath: update.filePath };
}

async function runStartupUpdateGate(deps) {
  const {
    configStore,
    checkForUpdates,
    sendToRenderer = () => {},
    startupCheckTimeoutMs = DEFAULT_STARTUP_CHECK_TIMEOUT_MS,
    startupCheckOptions = DEFAULT_STARTUP_CHECK_OPTIONS,
    isPackaged = true,
    logger = console,
    onStatus = () => {},
    devStartupUpdateScenario = process.env.NEKO_DEV_STARTUP_UPDATE_SCENARIO,
  } = deps;

  onStatus({
    title: '正在检查更新',
    message: '启动前确认是否有新版可用，失败时会自动继续打开软件。',
    detail: '连接更新源...',
    pct: -1,
  });

  const scenario = normalizeDevStartupUpdateScenario(devStartupUpdateScenario);
  if (!isPackaged && scenario) {
    return await runDevStartupUpdateScenario(scenario, deps);
  }

  const pending = resolvePendingInstall(configStore);
  if (pending) {
    onStatus({
      title: '发现已下载更新',
      message: `Neko Status v${pending.version || ''} 已准备好，将优先安装。`,
      detail: '正在校验安装包...',
      pct: 100,
    });
    logger.log?.(`[StartupUpdate] pending installer found for v${pending.version || 'unknown'}`);
    return await launchAndQuitForInstall(pending, deps);
  }

  if (configStore.get('autoCheckUpdate') === false) {
    onStatus({
      title: '跳过启动更新',
      message: '自动检查更新已关闭，正在打开软件。',
      detail: '继续启动...',
      pct: 100,
    });
    return { action: 'open', reason: 'auto-check-disabled' };
  }

  let result;
  try {
    result = await withTimeout(checkForUpdates(startupCheckOptions), startupCheckTimeoutMs, 'startup update check');
  } catch (err) {
    logger.warn?.('[StartupUpdate] update check failed before window open:', err.message);
    onStatus({
      title: '更新检查失败',
      message: '无法连接更新源，正在继续打开软件。',
      detail: err.message,
      pct: 100,
    });
    return { action: 'open', reason: 'check-failed', error: err.message };
  }

  if (!result || !result.hasUpdate) {
    onStatus({
      title: '已是最新版本',
      message: '未发现需要安装的更新，正在打开软件。',
      detail: '继续启动...',
      pct: 100,
    });
    return { action: 'open', reason: result && result.error ? 'check-error' : 'up-to-date', result };
  }

  const skipped = configStore.get('skippedVersion');
  if (!result.forceUpdate && skipped === result.latestVersion) {
    return { action: 'open', reason: 'version-skipped', result };
  }

  if (!getInstallerUrl(result)) {
    logger.warn?.(`[StartupUpdate] v${result.latestVersion} has no executable installer asset; opening app`);
    onStatus({
      title: '更新暂不可自动安装',
      message: `发现 v${result.latestVersion}，但没有可用的 Windows 安装包。`,
      detail: '继续启动...',
      pct: 100,
    });
    return { action: 'open', reason: 'installer-asset-missing', result };
  }

  if (!isPackaged && process.env.NEKO_ALLOW_DEV_AUTO_UPDATE !== '1') {
    logger.log?.(`[StartupUpdate] v${result.latestVersion} found in dev mode; skipping automatic install`);
    onStatus({
      title: '发现新版本',
      message: `开发版不会自动运行安装器，已将 v${result.latestVersion} 交给更新中心提示。`,
      detail: '继续启动...',
      pct: 100,
    });
    sendToRenderer(IPC_EVENTS.UPDATE_AVAILABLE, result);
    return { action: 'open', reason: 'dev-auto-install-disabled', result };
  }

  try {
    onStatus({
      title: '发现新版本',
      message: `正在准备 Neko Status v${result.latestVersion}。`,
      detail: '开始下载...',
      pct: -1,
    });
    const downloaded = await downloadInstaller(result, { ...deps, sendToRenderer });
    return await launchAndQuitForInstall(downloaded, deps);
  } catch (err) {
    logger.warn?.('[StartupUpdate] pre-window update failed; opening app:', err.message);
    onStatus({
      title: '更新失败',
      message: '本次更新未完成，正在继续打开当前版本。',
      detail: err.message,
      pct: 100,
    });
    return { action: 'open', reason: 'download-or-install-failed', error: err.message, result };
  }
}

async function handleBackgroundUpdateResult(result, deps) {
  const {
    configStore,
    autoDownloadUpdate,
    sendToRenderer = () => {},
    logger = console,
  } = deps;

  if (!result || !result.hasUpdate) return { action: 'none', reason: 'up-to-date' };

  const skipped = configStore.get('skippedVersion');
  if (!result.forceUpdate && skipped === result.latestVersion) {
    return { action: 'none', reason: 'version-skipped' };
  }

  const shouldAutoDownload = result.forceUpdate || configStore.get('autoDownload') === true;
  if (!shouldAutoDownload) {
    sendToRenderer(IPC_EVENTS.UPDATE_AVAILABLE, result);
    return { action: 'notify', version: result.latestVersion };
  }

  const pending = configStore.get('pendingInstall');
  const alreadyDownloaded = pending && pending.version === result.latestVersion
    && pending.filePath && fs.existsSync(pending.filePath);
  if (alreadyDownloaded) {
    logger.log?.(`[Update] v${result.latestVersion} already downloaded; skipping duplicate download`);
    return { action: 'none', reason: 'already-downloaded' };
  }

  await autoDownloadUpdate(result);
  return { action: 'download', version: result.latestVersion };
}

async function runBackgroundUpdateCheck(deps) {
  const {
    configStore,
    checkForUpdates,
    logger = console,
    label = 'background',
  } = deps;

  if (configStore.get('autoCheckUpdate') === false) {
    return { action: 'none', reason: 'auto-check-disabled' };
  }

  try {
    const result = await checkForUpdates();
    return await handleBackgroundUpdateResult(result, deps);
  } catch (err) {
    logger.warn?.(`[Update] ${label} update check failed:`, err.message);
    return { action: 'none', reason: 'check-failed', error: err.message };
  }
}

module.exports = {
  DEFAULT_STARTUP_CHECK_TIMEOUT_MS,
  DEFAULT_STARTUP_CHECK_OPTIONS,
  DEV_STARTUP_UPDATE_SCENARIOS,
  downloadInstaller,
  normalizeDevStartupUpdateScenario,
  resolvePendingInstall,
  runDevStartupUpdateScenario,
  runStartupUpdateGate,
  handleBackgroundUpdateResult,
  runBackgroundUpdateCheck,
  delay,
  withTimeout,
};

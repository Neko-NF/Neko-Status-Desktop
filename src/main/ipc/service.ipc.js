/**
 * src/main/ipc/service.ipc.js
 * 上报服务控制、开机自启、进程信息、权限检测与一键体检 IPC
 */

const path = require('path');
const fs = require('fs');
const { IPC_CHANNELS, createIpcSuccess } = require('../../shared/ipc-contracts');

/**
 * @param {Object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {import('electron').App} deps.app
 * @param {Object} deps.configStore
 * @param {Object} deps.statusService
 * @param {Object} deps.apiService
 * @param {Function} deps.isRunAsAdmin
 * @param {Function} deps.refreshTrayMenu
 */
function registerServiceIpc({
  ipcMain,
  app,
  configStore,
  statusService,
  apiService,
  isRunAsAdmin,
  refreshTrayMenu,
}) {
  // ── 上报服务控制 ──────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERVICE_START, () => {
    statusService.start();
    refreshTrayMenu();
    return createIpcSuccess({ isRunning: statusService.isRunning, serviceState: statusService.serviceState });
  });
  ipcMain.handle(IPC_CHANNELS.SERVICE_STOP, () => {
    statusService.stop();
    refreshTrayMenu();
    return createIpcSuccess({ isRunning: statusService.isRunning, serviceState: statusService.serviceState });
  });
  ipcMain.handle(IPC_CHANNELS.SERVICE_IS_RUNNING, () => createIpcSuccess(statusService.isRunning));
  ipcMain.handle(IPC_CHANNELS.SERVICE_RESTART, () => {
    statusService.restart();
    return createIpcSuccess(true);
  });
  ipcMain.handle(IPC_CHANNELS.SERVICE_LAST_RESULT, () => createIpcSuccess(statusService.lastResult));

  // ── 开机自启 ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AUTOSTART_ENABLE, () => {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--autostart'] });
    configStore.set('enableAutoStart', true);
    return createIpcSuccess(true);
  });
  ipcMain.handle(IPC_CHANNELS.AUTOSTART_DISABLE, () => {
    app.setLoginItemSettings({ openAtLogin: false });
    configStore.set('enableAutoStart', false);
    return createIpcSuccess(true);
  });
  ipcMain.handle(IPC_CHANNELS.AUTOSTART_IS_ENABLED, () => {
    const loginSettings = app.getLoginItemSettings();
    // 开发模式下 openAtLogin 可能不准确，回退到配置存储
    return createIpcSuccess(loginSettings.openAtLogin || configStore.get('enableAutoStart') === true);
  });

  // ── 服务页：进程信息 ──────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERVICE_GET_PROCESS_INFO, () => createIpcSuccess({
    processName: path.basename(process.execPath),
    pid: process.pid,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    uptimeSec: Math.round(process.uptime()),
    isAdmin: isRunAsAdmin(),
    recoveryStats: statusService.getRecoveryStats(),
  }));

  // ── 服务页：权限检测 ──────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERVICE_CHECK_PERMISSIONS, async () => {
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
    return createIpcSuccess(perms);
  });

  // ── 服务页：一键体检 ──────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERVICE_HEALTH_CHECK, async () => {
    const results = [];
    const cfg = configStore.getAll();
    const serverUrl = cfg.serverMode === 'local' ? cfg.serverUrlLocal : cfg.serverUrlProd;
    const owner = cfg.githubOwner || '';
    const repo = cfg.githubRepo || '';

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
    // 3. 设备密钥
    results.push({
      name: '设备密钥配置',
      ok: !!cfg.deviceKey,
      text: cfg.deviceKey ? `已配置（末尾 ...${String(cfg.deviceKey).slice(-6)}）` : '未配置设备密钥',
    });
    // 4. 更新源
    results.push({
      name: '更新源配置',
      ok: !!(owner && repo),
      text: owner && repo ? `github.com/${owner}/${repo}` : '未配置 GitHub 更新源',
    });
    // 5. 服务器连通性 / 网络延迟
    try {
      const connResult = await apiService.testConnection(serverUrl);
      const latencyText = connResult.ok
        ? `服务器在线，延迟 ${connResult.latencyMs}ms`
        : `连接失败: ${connResult.error}`;
      results.push({
        name: '服务器连通性',
        ok: connResult.ok,
        text: latencyText,
      });
      results.push({
        name: '网络延迟基线',
        ok: connResult.ok ? (connResult.latencyMs > 200 ? 'warn' : true) : false,
        text: connResult.ok
          ? `设备状态页同源采样，当前 ${connResult.latencyMs}ms`
          : '无法生成延迟基线',
      });
    } catch (e) {
      results.push({ name: '服务器连通性', ok: false, text: `连接异常: ${e.message}` });
      results.push({ name: '网络延迟基线', ok: false, text: '连接异常，无法生成延迟基线' });
    }
    // 6. 屏幕捕获
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
    // 7. WMI
    try {
      require('child_process').execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-Process -Id $PID | Out-Null',
      ], { timeout: 5000, windowsHide: true, stdio: 'ignore' });
      results.push({ name: '进程遍历 (WMI)', ok: true, text: 'PowerShell 进程查询正常' });
    } catch (e) {
      results.push({ name: '进程遍历 (WMI)', ok: false, text: `查询失败: ${e.message}` });
    }
    // 8. 开机自启
    const autoStartOn = app.getLoginItemSettings().openAtLogin;
    results.push({
      name: '开机自启配置',
      ok: autoStartOn ? true : 'warn',
      text: autoStartOn ? '注册表启动项已配置' : '开机自启未启用',
    });
    // 9. 本地存储
    try {
      const udp = app.getPath('userData');
      const testFile = path.join(udp, '.health-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      results.push({ name: '本地存储空间', ok: true, text: `数据目录可写 (${udp})` });
    } catch (e) {
      results.push({ name: '本地存储空间', ok: false, text: `写入失败: ${e.message}` });
    }
    // 10. 截图上报配置
    results.push({
      name: '截图上报配置',
      ok: cfg.enableScreenshot ? true : 'warn',
      text: cfg.enableScreenshot ? '截图采集已启用' : '截图采集未启用',
    });
    // 11. 故障恢复
    const recoveryOn = cfg.enableAutoRestart !== false;
    results.push({
      name: '故障恢复策略',
      ok: recoveryOn ? true : 'warn',
      text: recoveryOn
        ? `已启用，最大重启 ${cfg.maxRestarts || 3} 次`
        : '未启用自动重启',
    });
    return createIpcSuccess(results);
  });
}

module.exports = { registerServiceIpc };

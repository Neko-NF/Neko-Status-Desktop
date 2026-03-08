/**
 * status-service.js
 * 核心上报服务：定时获取系统状态并上传至服务端
 */
const { getActiveWindow, getBatteryInfo, getIdleTimeMs, captureScreen } = require('./system-utils');
const apiService = require('./api-service');
const configStore = require('./config-store');
const os = require('os');
const crypto = require('crypto');

// 设备指纹（基于主机名+平台，稳定不变）
const DEVICE_FINGERPRINT = Buffer.from(
  `${os.hostname()}-${os.platform()}-${os.arch()}`
).toString('base64');

// away 状态的空闲阈值（毫秒）
const AWAY_THRESHOLD_MS = 5 * 60 * 1000; // 5分钟

class StatusService {
  constructor() {
    this._timer = null;
    this._isRunning = false;
    this._userStatus = 'online'; // 'online' | 'away'
    this._lastTickResult = null;
    this._onLog = null;    // (level: 'INFO'|'WARN'|'ERROR'|'SUCCESS', msg: string) => void
    this._onTick = null;   // (tickData: object) => void
    this._onStatusChange = null; // (isRunning: boolean) => void
  }

  get isRunning() {
    return this._isRunning;
  }

  get lastResult() {
    return this._lastTickResult;
  }

  /** 设置日志回调 */
  setLogCallback(fn) { this._onLog = fn; }
  /** 设置每次上报后的回调（用于更新UI） */
  setTickCallback(fn) { this._onTick = fn; }
  /** 设置服务启停时的回调 */
  setStatusChangeCallback(fn) { this._onStatusChange = fn; }

  _log(level, msg) {
    const time = new Date().toISOString();
    console.log(`[StatusService][${level}] ${msg}`);
    if (this._onLog) this._onLog(level, msg, time);
  }

  /** 启动上报服务 */
  start() {
    if (this._isRunning) return;
    this._isRunning = true;

    const intervalSeconds = Math.max(5, configStore.get('reportInterval') || 10);
    this._log('INFO', `上报服务启动，间隔: ${intervalSeconds}s`);

    if (this._onStatusChange) this._onStatusChange(true);

    // 立即执行一次
    this._tick();
    this._timer = setInterval(() => this._tick(), intervalSeconds * 1000);
  }

  /** 停止上报服务 */
  stop() {
    if (!this._isRunning) return;
    this._isRunning = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._log('INFO', '上报服务已停止');
    if (this._onStatusChange) this._onStatusChange(false);
  }

  /** 重启服务（应用新间隔设置时使用） */
  restart() {
    this.stop();
    setTimeout(() => this.start(), 500);
  }

  /** 核心上报逻辑 */
  async _tick() {
    const deviceKey = configStore.get('deviceKey');
    if (!deviceKey) {
      this._log('WARN', '设备密钥未配置，跳过上报（请在配置中填写密钥）');
      if (this._onTick) {
        this._onTick({ success: false, reason: 'no_key' });
      }
      return;
    }

    try {
      // 1. 检测用户空闲状态
      let idleMs = 0;
      try {
        idleMs = await getIdleTimeMs();
      } catch { /* 空闲检测失败不影响上报 */ }

      const wasAway = this._userStatus === 'away';
      if (idleMs >= AWAY_THRESHOLD_MS) {
        if (!wasAway) {
          this._userStatus = 'away';
          this._log('INFO', `用户已空闲 ${Math.round(idleMs / 60000)} 分钟，状态 → away`);
        }
      } else {
        if (wasAway) {
          this._userStatus = 'online';
          this._log('INFO', '用户恢复活动，状态 → online');
        }
      }

      // 2. 获取前台窗口信息
      const winInfo = await getActiveWindow().catch(() => ({ title: '', processName: '' }));

      // 3. 获取电池信息
      const battery = await getBatteryInfo().catch(() => ({ level: 100, isCharging: true, hasBattery: false }));

      // 4. 截图（若已启用）
      let screenshotBuffer = null;
      if (configStore.get('enableScreenshot')) {
        screenshotBuffer = await captureScreen().catch(() => null);
      }

      // 5. 调用上报 API
      const result = await apiService.reportStatusV2({
        deviceKey,
        deviceFingerprint: DEVICE_FINGERPRINT,
        appName: winInfo.title || '',
        packageName: winInfo.processName || '',
        batteryLevel: battery.level,
        isCharging: battery.isCharging,
        status: this._userStatus,
        screenshotBuffer,
      });

      this._lastTickResult = {
        success: true,
        timestamp: new Date(),
        appName: winInfo.title,
        packageName: winInfo.processName,
        batteryLevel: battery.level,
        isCharging: battery.isCharging,
        userStatus: this._userStatus,
      };

      const batteryStr = battery.hasBattery
        ? `电量 ${battery.level}%${battery.isCharging ? ' ⚡' : ''}`
        : '桌面模式';
      this._log('INFO', `上报成功 | ${winInfo.processName || '—'} | ${batteryStr}`);

      if (this._onTick) {
        this._onTick({ ...this._lastTickResult, result });
      }

      // 处理密钥被撤销的情况
      if (result && result.keyRevoked) {
        this._log('ERROR', '设备密钥已被服务器撤销，服务停止');
        this.stop();
        configStore.set('deviceKey', '');
      }

    } catch (err) {
      this._log('ERROR', `上报失败: ${err.message}`);
      if (this._onTick) {
        this._onTick({ success: false, error: err.message, timestamp: new Date() });
      }

      // 密钥失效时停止服务
      if (err.status === 403) {
        this._log('ERROR', '设备密钥无效（403），上报服务已停止');
        this.stop();
      }
    }
  }
}

const statusService = new StatusService();
module.exports = statusService;

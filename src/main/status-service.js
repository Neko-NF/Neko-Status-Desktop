/**
 * status-service.js
 * 核心上报服务：定时获取系统状态并上传至服务端
 */
const { getActiveWindow, getBatteryInfo, getIdleTimeMs, captureScreen, getMediaInfo, formatDuration, extractAppName } = require('./system-utils');
const apiService = require('./api-service');
const configStore = require('./config-store');
const os = require('os');
const crypto = require('crypto');

// 设备指纹（SHA256 哈希，融合多维度硬件特征，稳定不变）
const DEVICE_FINGERPRINT = crypto.createHash('sha256')
  .update(`${os.hostname()}-${os.platform()}-${os.arch()}-${os.cpus().length}-${os.totalmem()}`)
  .digest('hex');

// away 状态的空闲阈值（毫秒）
const AWAY_THRESHOLD_MS = 5 * 60 * 1000; // 5分钟

class StatusService {
  constructor() {
    this._timer = null;
    this._isRunning = false;
    this._userStatus = 'online'; // 'online' | 'away'
    this._lastTickResult = null;
    this._lastScreenshotTime = 0; // 截图间隔独立控制
    this._onLog = null;    // (level: 'INFO'|'WARN'|'ERROR'|'SUCCESS', msg: string) => void
    this._onTick = null;   // (tickData: object) => void
    this._onStatusChange = null; // (isRunning: boolean) => void
    this._onKeyStatus = null; // (code: string, message: string) => void
    // 故障恢复 —— 看门狗
    this._consecutiveFailures = 0;
    this._autoRestartCount = 0;
    this._watchdogTimer = null;
    this._startedAt = Date.now();
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
  /** 设置密钥状态变更回调 */
  setKeyStatusCallback(fn) { this._onKeyStatus = fn; }

  /** 获取故障恢复统计 */
  getRecoveryStats() {
    return {
      consecutiveFailures: this._consecutiveFailures,
      autoRestartCount: this._autoRestartCount,
      uptimeSec: this._isRunning ? Math.round((Date.now() - this._startedAt) / 1000) : 0,
    };
  }

  /** 重置故障恢复计数器 */
  resetRecoveryCounters() {
    this._consecutiveFailures = 0;
    this._autoRestartCount = 0;
  }

  _log(level, msg) {
    const time = new Date().toISOString();
    console.log(`[StatusService][${level}] ${msg}`);
    if (this._onLog) this._onLog(level, msg, time);
  }

  /** 启动上报服务 */
  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._startedAt = Date.now();
    this._consecutiveFailures = 0;

    const intervalSeconds = Math.max(5, configStore.get('reportInterval') || 10);
    this._log('INFO', `上报服务启动，间隔: ${intervalSeconds}s`);

    if (this._onStatusChange) this._onStatusChange(true);

    // 启动看门狗
    this._startWatchdog();

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
    this._stopWatchdog();
    this._log('INFO', '上报服务已停止');
    if (this._onStatusChange) this._onStatusChange(false);
  }

  /** 重启服务（应用新间隔设置时使用） */
  restart() {
    this.stop();
    setTimeout(() => this.start(), 500);
  }

  // ─── 看门狗 & 故障恢复 ───────────────────────────────────────────
  _startWatchdog() {
    this._stopWatchdog();
    const timeoutSec = configStore.get('watchdogTimeoutSec') || 60;
    this._watchdogTimer = setInterval(() => {
      if (!this._isRunning) return;
      // 看门狗仅在启用自动重启时触发恢复
      if (this._consecutiveFailures >= 3) {
        this._tryAutoRestart('看门狗检测到连续失败');
      }
    }, timeoutSec * 1000);
  }

  _stopWatchdog() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  _tryAutoRestart(reason) {
    if (!configStore.get('enableAutoRestart')) return;
    const maxRestarts = configStore.get('maxRestarts') || 3;
    if (this._autoRestartCount >= maxRestarts) {
      this._log('ERROR', `已达最大自动重启次数 (${maxRestarts})，停止自动恢复，请手动处理`);
      this.stop();
      return;
    }
    const intervalSec = configStore.get('restartIntervalSec') || 30;
    this._autoRestartCount++;
    this._log('WARN', `${reason}，${intervalSec}s 后自动重启 (第 ${this._autoRestartCount}/${maxRestarts} 次)`);
    this.stop();
    setTimeout(() => {
      this._consecutiveFailures = 0;
      this.start();
    }, intervalSec * 1000);
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

      // 4. 获取媒体信息（SMTC）
      let musicPayload = null;
      try {
        const mediaRaw = await getMediaInfo();
        if (mediaRaw && mediaRaw.isPlaying) {
          musicPayload = {
            title: mediaRaw.title || '',
            artist: mediaRaw.artist || '',
            appName: extractAppName(mediaRaw.appName),
            isPlaying: true,
            progress: formatDuration(mediaRaw.positionMs),
            duration: formatDuration(mediaRaw.durationMs),
          };
        }
      } catch { /* 媒体检测失败不影响上报 */ }

      // 5. 隐身模式检查
      const isIncognito = configStore.get('enableIncognito');
      const blurAll = configStore.get('blurAllScreenshots');

      // 5b. 截图（若已启用，支持独立间隔）
      let screenshotBuffer = null;
      if (configStore.get('enableScreenshot')) {
        const syncInterval = configStore.get('syncScreenshotInterval');
        const ssInterval = syncInterval ? configStore.get('reportInterval') : configStore.get('screenshotInterval');
        const now = Date.now();
        const elapsed = (now - this._lastScreenshotTime) / 1000;
        if (elapsed >= (ssInterval || 60)) {
          screenshotBuffer = await captureScreen().catch(() => null);
          // 截图压缩：如果 PNG 超过 3MB，转为 JPEG 降质
          if (screenshotBuffer && screenshotBuffer.length > 3 * 1024 * 1024) {
            this._log('INFO', `截图 ${(screenshotBuffer.length / 1024 / 1024).toFixed(1)}MB 超限，已跳过压缩（需 sharp 库）`);
          }
          if (screenshotBuffer) this._lastScreenshotTime = now;

          // 全局模糊：仅在隐身模式开启时生效
          if (screenshotBuffer && blurAll && isIncognito) {
            try {
              const { nativeImage } = require('electron');
              const img = nativeImage.createFromBuffer(screenshotBuffer);
              const { width, height } = img.getSize();
              const tiny = img.resize({ width: Math.round(width / 20), height: Math.round(height / 20) });
              const blurred = tiny.resize({ width, height });
              screenshotBuffer = blurred.toPNG();
              this._log('INFO', '全局模糊已应用');
            } catch { /* 模糊失败则上传原图 */ }
          }
        }
      }

      // 6. 提取应用图标（通过 Electron app.getFileIcon）
      let iconBuffer = null;
      try {
        if (winInfo.processName) {
          const { app: electronApp, nativeImage } = require('electron');
          // 通过 PowerShell 获取进程路径
          const { execFile: execFileSync } = require('child_process');
          const procPath = await new Promise((resolve) => {
            execFileSync('powershell', [
              '-NoProfile', '-NonInteractive', '-Command',
              `(Get-Process -Name '${winInfo.processName.replace('.exe', '')}' -ErrorAction SilentlyContinue | Select-Object -First 1).Path`
            ], { timeout: 3000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
              resolve(err ? '' : (stdout || '').trim());
            });
          });
          if (procPath) {
            const icon = await electronApp.getFileIcon(procPath, { size: 'normal' });
            if (icon && !icon.isEmpty()) {
              iconBuffer = icon.toPNG();
            }
          }
        }
      } catch { /* 图标提取失败不影响上报 */ }

      // 7. 体积校验（图标 ≤1MB，截图 ≤5MB）
      if (iconBuffer && iconBuffer.length > 1 * 1024 * 1024) {
        this._log('WARN', `应用图标 ${(iconBuffer.length / 1024 / 1024).toFixed(1)}MB 超过 1MB 限制，已跳过`);
        iconBuffer = null;
      }
      if (screenshotBuffer && screenshotBuffer.length > 5 * 1024 * 1024) {
        this._log('WARN', `截图 ${(screenshotBuffer.length / 1024 / 1024).toFixed(1)}MB 超过 5MB 限制，已跳过`);
        screenshotBuffer = null;
      }

      // 9. 调用上报 API（隐身模式下隐藏窗口标题和进程名）
      const reportAppName = isIncognito ? '隐身模式' : (winInfo.title || '');
      const reportPkgName = isIncognito ? '' : (winInfo.processName || '');
      const result = await apiService.reportStatusV2({
        deviceKey,
        deviceFingerprint: DEVICE_FINGERPRINT,
        appName: reportAppName,
        packageName: reportPkgName,
        batteryLevel: battery.level,
        isCharging: battery.isCharging,
        status: this._userStatus,
        screenshotBuffer,
        music: isIncognito ? null : musicPayload,
        iconBuffer: isIncognito ? null : iconBuffer,
      });

      this._lastTickResult = {
        success: true,
        timestamp: new Date(),
        appName: winInfo.title,
        packageName: winInfo.processName,
        batteryLevel: battery.level,
        isCharging: battery.isCharging,
        userStatus: this._userStatus,
        music: musicPayload,
        hasScreenshot: !!screenshotBuffer,
        screenshotSize: screenshotBuffer ? screenshotBuffer.length : 0,
        screenshotBase64: screenshotBuffer ? screenshotBuffer.toString('base64') : null,
        screenshotBlurred: !!(screenshotBuffer && blurAll && isIncognito),
      };

      const batteryStr = battery.hasBattery
        ? `电量 ${battery.level}%${battery.isCharging ? ' ⚡' : ''}`
        : '桌面模式';
      const mediaStr = musicPayload ? ` | 🎵 ${musicPayload.title}` : '';
      this._log('INFO', `上报成功 | ${winInfo.processName || '—'} | ${batteryStr}${mediaStr}`);

      if (this._onTick) {
        this._onTick({ ...this._lastTickResult, result });
      }

      // 上报成功 → 重置连续失败计数
      this._consecutiveFailures = 0;

      // 处理密钥状态
      if (result) {
        if (result.keyRevoked || result.code === 'KEY_REVOKED') {
          this._log('ERROR', '设备密钥已被服务器撤销，服务停止');
          if (this._onKeyStatus) this._onKeyStatus('KEY_REVOKED', result.message || '密钥已被其他设备使用');
          this.stop();
          configStore.set('deviceKey', '');
        } else if (result.code === 'DEVICE_NOT_FOUND') {
          this._log('ERROR', '设备已被服务端删除，服务停止');
          if (this._onKeyStatus) this._onKeyStatus('DEVICE_NOT_FOUND', result.message || '设备不存在');
          this.stop();
          configStore.set('deviceKey', '');
        } else if (result.takeover && result.takeover.occurred) {
          this._log('WARN', '设备接管发生');
          if (this._onKeyStatus) this._onKeyStatus('TAKEOVER_SUCCESS', '设备已成功接管');
        }
      }

    } catch (err) {
      // 5xx 瞬时错误（代理网关异常等）→ 仅警告，不计入连续失败
      if (err.transient) {
        this._log('WARN', err.message);
        if (this._onTick) {
          this._onTick({ success: false, error: err.message, transient: true, timestamp: new Date() });
        }
        return;
      }

      this._consecutiveFailures++;
      this._log('ERROR', `上报失败 (连续第 ${this._consecutiveFailures} 次): ${err.message}`);
      if (this._onTick) {
        this._onTick({ success: false, error: err.message, timestamp: new Date() });
      }

      // 非致命性网络错误 → 交给看门狗自动恢复
      const isFatal = err.status === 401 || err.status === 403 || (err.status === 404 && err.code === 'DEVICE_NOT_FOUND');
      if (!isFatal && this._consecutiveFailures >= 3) {
        this._tryAutoRestart(`连续上报失败 ${this._consecutiveFailures} 次`);
        return;
      }

      // 完整的错误码处理
      if (err.status === 401) {
        this._log('ERROR', `设备密钥无效（401），上报服务已停止`);
        if (this._onKeyStatus) this._onKeyStatus('INVALID_KEY', err.message);
        this.stop();
        configStore.set('deviceKey', '');
      } else if (err.status === 403) {
        const code = err.code || 'KEY_REVOKED';
        this._log('ERROR', `设备密钥无效（403 - ${code}），上报服务已停止`);
        if (this._onKeyStatus) this._onKeyStatus(code, err.message);
        this.stop();
        if (code === 'KEY_REVOKED') configStore.set('deviceKey', '');
      } else if (err.status === 404 && err.code === 'DEVICE_NOT_FOUND') {
        this._log('ERROR', '设备不存在（404），上报服务已停止');
        if (this._onKeyStatus) this._onKeyStatus('DEVICE_NOT_FOUND', err.message);
        this.stop();
        configStore.set('deviceKey', '');
      } else if (err.status === 429) {
        const retryAfter = err.retryAfter || 60;
        this._log('WARN', `被服务器限流（429），${retryAfter}s 后恢复`);
        this.stop();
        setTimeout(() => {
          this._log('INFO', '限流等待结束，恢复上报服务');
          this.start();
        }, retryAfter * 1000);
      }
    }
  }
}

const statusService = new StatusService();
statusService.getDeviceFingerprint = () => DEVICE_FINGERPRINT;
module.exports = statusService;

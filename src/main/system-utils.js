/**
 * system-utils.js
 * Windows 系统工具：活动窗口、电池信息、截图
 */
const { execFile } = require('child_process');
const { desktopCapturer } = require('electron');

/**
 * 运行 PowerShell 脚本，返回 stdout 字符串
 */
function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-Command', script],
      {
        timeout: 8000,
        windowsHide: true,
        encoding: 'buffer', // 返回原始 Buffer，避免 Node.js 按系统代码页(GBK)解码
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      },
      (err, stdout) => {
        if (err) reject(err);
        else {
          // PowerShell 内已通过 [Console]::OutputEncoding = UTF8 输出，
          // 这里强制按 UTF-8 解码，确保中文名称不会因系统代码页不同而乱码
          const text = Buffer.isBuffer(stdout)
            ? stdout.toString('utf8')
            : String(stdout);
          resolve(text.trim());
        }
      }
    );
  });
}

/**
 * 获取当前前台活动窗口信息
 * 返回 { title: string, processName: string }
 * 注：使用 Win32 GetForegroundWindow API 精确获取当前前台窗口
 */
async function getActiveWindow() {
  const script = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  Add-Type @"
    using System;
    using System.Text;
    using System.Runtime.InteropServices;
    public class FGWin {
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
      [DllImport("user32.dll", CharSet = CharSet.Unicode)]
      public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int maxCount);
    }
"@
  $hwnd = [FGWin]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][FGWin]::GetWindowText($hwnd, $sb, 512)
  $title = $sb.ToString()
  $procPid = 0
  [void][FGWin]::GetWindowThreadProcessId($hwnd, [ref]$procPid)
  $procName = ''
  if ($procPid -gt 0) {
    $p = Get-Process -Id $procPid -ErrorAction SilentlyContinue
    if ($p) { $procName = $p.ProcessName + '.exe' }
  }
  @{ title = $title; processName = $procName } | ConvertTo-Json -Compress
} catch {
  '{"title":"","processName":""}'
}
`.trim();

  try {
    const raw = await runPowerShell(script);
    const obj = JSON.parse(raw);
    return { title: obj.title || '', processName: obj.processName || '' };
  } catch {
    return { title: '', processName: '' };
  }
}

/**
 * 获取电池状态
 * 返回 { level: number, isCharging: boolean, hasBattery: boolean }
 */
async function getBatteryInfo() {
  const script = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $b = Get-WmiObject Win32_Battery -ErrorAction SilentlyContinue
  if ($b) {
    # BatteryStatus: 1=放电, 2=交流供电充电, 3=充满, 4=低, 5=临界, 6=AC(充电中), 7=AC(充电中), 8=AC(充电中)
    $charging = ($b.BatteryStatus -eq 2) -or ($b.BatteryStatus -ge 6)
    @{ level = [int]$b.EstimatedChargeRemaining; isCharging = [bool]$charging; hasBattery = $true } | ConvertTo-Json -Compress
  } else {
    @{ level = 100; isCharging = $true; hasBattery = $false } | ConvertTo-Json -Compress
  }
} catch {
  @{ level = 100; isCharging = $true; hasBattery = $false } | ConvertTo-Json -Compress
}
`.trim();

  try {
    const raw = await runPowerShell(script);
    return JSON.parse(raw);
  } catch {
    return { level: 100, isCharging: true, hasBattery: false };
  }
}

/**
 * 获取用户空闲时长（毫秒），使用 GetLastInputInfo Win32 API
 */
async function getIdleTimeMs() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class IdleDetector {
  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint GetIdleMs() {
    var lii = new LASTINPUTINFO();
    lii.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(lii);
    GetLastInputInfo(ref lii);
    return (uint)Environment.TickCount - lii.dwTime;
  }
}
'@ -ErrorAction SilentlyContinue
try { [IdleDetector]::GetIdleMs() } catch { 0 }
`.trim();

  try {
    const raw = await runPowerShell(script);
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * 使用 Electron desktopCapturer 截取主屏幕
 * 返回 PNG Buffer 或 null
 */
async function captureScreen() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (sources.length === 0) return null;
    // 首选主屏幕
    const source = sources[0];
    const pngBuffer = source.thumbnail.toPNG();
    return pngBuffer.length > 0 ? pngBuffer : null;
  } catch (e) {
    console.error('[Screenshot] 截图失败:', e.message);
    return null;
  }
}

/**
 * 获取当前正在播放的媒体信息（SMTC）
 * 通过 PowerShell 调用 Windows Runtime GlobalSystemMediaTransportControlsSessionManager
 * 返回 { isPlaying, title, artist, appName, position, duration } 或 null
 */
async function getMediaInfo() {
  const script = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]

  # 异步获取 SessionManager
  $asyncOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
  $taskType = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod
  } | Select-Object -First 1
  $task = $taskType.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]).Invoke($null, @($asyncOp))
  $null = $task.Wait(3000)
  $mgr = $task.Result
  if (-not $mgr) { '{}'; exit }

  $session = $mgr.GetCurrentSession()
  if (-not $session) { '{}'; exit }

  # 获取播放状态
  $pbInfo = $session.GetPlaybackInfo()
  $isPlaying = $pbInfo.PlaybackStatus -eq 'Playing'

  # 获取媒体属性
  $asyncMedia = $session.TryGetMediaPropertiesAsync()
  $taskMedia = $taskType.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]).Invoke($null, @($asyncMedia))
  $null = $taskMedia.Wait(2000)
  $media = $taskMedia.Result

  # 获取时间线
  $tl = $session.GetTimelineProperties()
  $posMs  = [int]$tl.Position.TotalMilliseconds
  $durMs  = [int]$tl.EndTime.TotalMilliseconds

  $appId = $session.SourceAppUserModelId
  @{
    isPlaying   = [bool]$isPlaying
    title       = [string]$media.Title
    artist      = [string]$media.Artist
    album       = [string]$media.AlbumTitle
    appName     = [string]$appId
    positionMs  = $posMs
    durationMs  = $durMs
  } | ConvertTo-Json -Compress
} catch {
  '{}'
}
`.trim();

  try {
    const raw = await runPowerShell(script);
    const obj = JSON.parse(raw);
    if (!obj || !obj.title) return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * 将毫秒转换为 mm:ss 字符串
 */
function formatDuration(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 提取友好的应用名称
 */
function extractAppName(pkgName) {
  if (!pkgName) return 'Unknown';
  if (pkgName.endsWith('.exe')) return pkgName.slice(0, -4);
  const parts = pkgName.split('_');
  if (parts.length > 1) {
    const app = parts[0];
    if (app.includes('.')) return app.split('.').pop() || app;
    return app;
  }
  return pkgName;
}

/**
 * 获取系统实时指标（CPU 负载、内存、网络延迟、网络速度）
 */
let _prevNetStats = null;
let _prevNetTime = 0;

async function getSystemMetrics() {
  const os = require('os');
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPct = Math.round(usedMem / totalMem * 1000) / 10;

  // CPU 使用率：两次采样间隔 500ms 的差值
  const cpuPct = await new Promise((resolve) => {
    const cpus1 = os.cpus();
    setTimeout(() => {
      const cpus2 = os.cpus();
      let idleDelta = 0, totalDelta = 0;
      for (let i = 0; i < cpus2.length; i++) {
        const t1 = cpus1[i].times, t2 = cpus2[i].times;
        idleDelta += t2.idle - t1.idle;
        totalDelta += (t2.user + t2.nice + t2.sys + t2.irq + t2.idle) -
                      (t1.user + t1.nice + t1.sys + t1.irq + t1.idle);
      }
      resolve(totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 1000) / 10 : 0);
    }, 500);
  });

  // 网络延迟：ping 配置的服务器
  let networkLatency = -1;
  try {
    const configStore = require('./config-store');
    const serverUrl = configStore.getServerUrl();
    const { URL } = require('url');
    const host = new URL(serverUrl).hostname;
    const start = Date.now();
    const dns = require('dns');
    await new Promise((resolve, reject) => {
      dns.lookup(host, (err) => err ? reject(err) : resolve());
    });
    networkLatency = Date.now() - start;
  } catch { /* 网络检测失败 */ }

  // 网络速度：通过 PowerShell 读取网络接口计数器
  let netDownBps = 0, netUpBps = 0;
  try {
    const netScript = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $stats = Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Where-Object { $_.ReceivedBytes -gt 0 } | Select-Object -First 1
  if ($stats) {
    @{ rx = [long]$stats.ReceivedBytes; tx = [long]$stats.SentBytes } | ConvertTo-Json -Compress
  } else { '{"rx":0,"tx":0}' }
} catch { '{"rx":0,"tx":0}' }
`.trim();
    const raw = await runPowerShell(netScript);
    const cur = JSON.parse(raw);
    const now = Date.now();
    if (_prevNetStats && _prevNetTime > 0) {
      const dt = (now - _prevNetTime) / 1000;
      if (dt > 0) {
        netDownBps = Math.max(0, (cur.rx - _prevNetStats.rx) / dt);
        netUpBps = Math.max(0, (cur.tx - _prevNetStats.tx) / dt);
      }
    }
    _prevNetStats = cur;
    _prevNetTime = now;
  } catch { /* 网络速度检测失败 */ }

  return {
    cpuPct,
    memPct,
    memUsed: usedMem,
    memTotal: totalMem,
    networkLatency,
    netDownBps,
    netUpBps,
    cpuModel: os.cpus()[0]?.model || '',
    cpuCores: os.cpus().length,
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    osFriendlyName: _getWindowsFriendlyName(),
  };
}

// 解析 Windows 版本号 — Build >= 22000 为 Win 11
function _getWindowsFriendlyName() {
  const os = require('os');
  if (os.platform() !== 'win32') return `${os.platform()} ${os.release()}`;
  const rel = os.release(); // e.g. '10.0.22631'
  const parts = rel.split('.');
  const build = parseInt(parts[2], 10) || 0;
  if (parts[0] === '10' && build >= 22000) return `Windows 11 (${rel})`;
  if (parts[0] === '10') return `Windows 10 (${rel})`;
  return `Windows ${rel}`;
}

module.exports = { getActiveWindow, getBatteryInfo, getIdleTimeMs, captureScreen, getMediaInfo, formatDuration, extractAppName, getSystemMetrics };

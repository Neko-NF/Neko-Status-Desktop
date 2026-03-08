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
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      }
    );
  });
}

/**
 * 获取当前前台活动窗口信息
 * 返回 { title: string, processName: string }
 * 注：通过 MainWindowHandle 排序近似前台窗口，无需 C# 编译
 */
async function getActiveWindow() {
  const script = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $procs = Get-Process | Where-Object { $_.MainWindowTitle -ne "" -and $_.MainWindowHandle -ne 0 }
  if ($procs) {
    # 取最高句柄值的进程（近似最新弹到前台的窗口）
    $p = $procs | Sort-Object { $_.MainWindowHandle.ToInt64() } -Descending | Select-Object -First 1
    @{ title = $p.MainWindowTitle; processName = ($p.ProcessName + ".exe") } | ConvertTo-Json -Compress
  } else {
    '{"title":"","processName":""}'
  }
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

module.exports = { getActiveWindow, getBatteryInfo, getIdleTimeMs, captureScreen };

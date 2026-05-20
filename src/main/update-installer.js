const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

function quotePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildRelaunchWatcherScript({
  installerPid,
  appPid = process.pid,
  exePath = process.execPath,
  fallbackDelaySeconds = 45,
  deadlineMinutes = 5,
} = {}) {
  const workingDirectory = path.dirname(exePath);
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$installerPid = ${Number(installerPid) || 0}`,
    `$appPid = ${Number(appPid) || 0}`,
    `$exePath = ${quotePowerShellString(exePath)}`,
    `$workingDirectory = ${quotePowerShellString(workingDirectory)}`,
    '$baselineVersion = ""',
    '$baselineWriteTicks = 0',
    'try {',
    '  if (Test-Path -LiteralPath $exePath) {',
    '    $baselineItem = Get-Item -LiteralPath $exePath',
    '    $baselineVersion = [string]$baselineItem.VersionInfo.ProductVersion',
    '    $baselineWriteTicks = [int64]$baselineItem.LastWriteTimeUtc.Ticks',
    '  }',
    '} catch {}',
    'if ($appPid -gt 0) { try { Wait-Process -Id $appPid -ErrorAction SilentlyContinue } catch {} }',
    'if ($installerPid -gt 0) { try { Wait-Process -Id $installerPid -ErrorAction SilentlyContinue } catch {} }',
    `$fallbackAt = (Get-Date).AddSeconds(${Number(fallbackDelaySeconds) || 45})`,
    `$deadline = (Get-Date).AddMinutes(${Number(deadlineMinutes) || 5})`,
    'function Test-ExecutableReady {',
    '  param([string] $Path)',
    '  if (-not (Test-Path -LiteralPath $Path)) { return $false }',
    '  $stream = $null',
    '  try {',
    '    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)',
    '    return $true',
    '  } catch {',
    '    return $false',
    '  } finally {',
    '    if ($stream) { $stream.Close() }',
    '  }',
    '}',
    'function Start-NekoStatus {',
    '  if (Test-Path -LiteralPath $exePath) {',
    '    Start-Process -FilePath $exePath -WorkingDirectory $workingDirectory',
    '    exit 0',
    '  }',
    '}',
    'do {',
    '  Start-Sleep -Seconds 2',
    '  if (-not (Test-ExecutableReady $exePath)) { continue }',
    '  try {',
    '    $candidateItem = Get-Item -LiteralPath $exePath',
    '    $candidateVersion = [string]$candidateItem.VersionInfo.ProductVersion',
    '    $candidateWriteTicks = [int64]$candidateItem.LastWriteTimeUtc.Ticks',
    '    $versionChanged = $candidateVersion -and ($candidateVersion -ne $baselineVersion)',
    '    $fileChanged = $candidateWriteTicks -and ($candidateWriteTicks -ne $baselineWriteTicks)',
    '    if ($versionChanged -or $fileChanged -or ((Get-Date) -ge $fallbackAt)) { Start-NekoStatus }',
    '  } catch {}',
    '} while ((Get-Date) -lt $deadline)',
    'if (Test-ExecutableReady $exePath) { Start-NekoStatus }',
  ].join('; ');
}

function scheduleRelaunchAfterInstaller(installerPid, options = {}) {
  const {
    platform = process.platform,
    exePath = process.execPath,
    appPid = process.pid,
    spawnImpl = spawn,
    logger = console,
    fallbackDelaySeconds,
    deadlineMinutes,
  } = options;

  if (!installerPid || platform !== 'win32') return false;

  const script = buildRelaunchWatcherScript({
    installerPid,
    appPid,
    exePath,
    fallbackDelaySeconds,
    deadlineMinutes,
  });

  try {
    const helper = spawnImpl('powershell.exe', [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-Command', script,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (helper && typeof helper.unref === 'function') helper.unref();
    return true;
  } catch (err) {
    logger.error?.('[Update] failed to schedule relaunch:', err.message);
    return false;
  }
}

function findExecutableRecursive(rootDir) {
  const matches = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.exe') {
        matches.push(fullPath);
      }
    }
  };
  walk(rootDir);
  return matches.sort((a, b) => {
    const an = path.basename(a).toLowerCase();
    const bn = path.basename(b).toLowerCase();
    const score = (name) => (name.includes('setup') || name.includes('installer') ? 0 : name.includes('neko') ? 1 : 2);
    return score(an) - score(bn) || an.localeCompare(bn);
  })[0] || null;
}

async function expandZipPackage(zipPath, options = {}) {
  const {
    platform = process.platform,
    spawnImpl = spawn,
    tempRoot = os.tmpdir(),
  } = options;

  if (platform !== 'win32') {
    throw new Error('ZIP update packages can only be prepared automatically on Windows');
  }
  const extractRoot = path.join(tempRoot, 'neko-update', `zip-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(extractRoot, { recursive: true });
  await new Promise((resolve, reject) => {
    const script = [
      '$ErrorActionPreference = "Stop"',
      `Expand-Archive -LiteralPath ${quotePowerShellString(zipPath)} -DestinationPath ${quotePowerShellString(extractRoot)} -Force`,
    ].join('; ');
    const child = spawnImpl('powershell.exe', [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-Command', script,
    ], { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Expand-Archive exited with code ${code}`));
    });
  });
  const exePath = findExecutableRecursive(extractRoot);
  if (!exePath) throw new Error('No executable file was found in the ZIP update package');
  return exePath;
}

async function resolveLaunchTarget(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const ext = path.extname(resolvedPath).toLowerCase();
  if (ext === '.zip') {
    return {
      filePath: await expandZipPackage(resolvedPath, options),
      fromArchive: true,
    };
  }
  return { filePath: resolvedPath, fromArchive: false };
}

function launchInstaller(filePath, options = {}) {
  const {
    silent = true,
    relaunchAfterInstall = true,
    platform = process.platform,
    spawnImpl = spawn,
    shell,
    scheduleRelaunch = scheduleRelaunchAfterInstaller,
  } = options;

  return resolveLaunchTarget(filePath, options).then(({ filePath: resolvedPath, fromArchive }) => {
    const ext = path.extname(resolvedPath).toLowerCase();

    if (platform === 'win32' && ext === '.exe') {
      const args = silent && !fromArchive ? ['/S'] : [];
      const child = spawnImpl(resolvedPath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      if (relaunchAfterInstall && !fromArchive) {
        scheduleRelaunch(child.pid, { platform, exePath: process.execPath, appPid: process.pid, spawnImpl });
      }
      if (child && typeof child.unref === 'function') child.unref();
      return '';
    }

    if (!shell || typeof shell.openPath !== 'function') {
      throw new Error('shell.openPath is required to launch this update package');
    }
    return shell.openPath(resolvedPath);
  });
}

module.exports = {
  quotePowerShellString,
  buildRelaunchWatcherScript,
  scheduleRelaunchAfterInstaller,
  findExecutableRecursive,
  expandZipPackage,
  resolveLaunchTarget,
  launchInstaller,
};

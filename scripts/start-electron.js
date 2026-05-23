const { spawn } = require('child_process');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const electronBinary = require('electron');
const projectRoot = path.resolve(__dirname, '..');
const childEnv = { ...process.env };
const extraArgs = [];
const WATCHED_SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json']);
let didRetryWithGpuFallback = false;
let activeChild = null;
let restartTimer = null;
let restartingForFileChange = false;
let currentUseGpuFallback = false;
let watcherStarted = false;
let watcherReadyAt = 0;
let watchedFileMtimes = new Map();

function findRcedit() {
  if (process.env.RCEDIT_PATH && fs.existsSync(process.env.RCEDIT_PATH)) return process.env.RCEDIT_PATH;
  if (process.platform !== 'win32') return '';

  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0', 'rcedit-x64.exe'),
    path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0', 'rcedit-ia32.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function getDevElectronBinary() {
  if (process.platform !== 'win32' || process.env.NEKO_USE_STOCK_ELECTRON === '1') {
    return electronBinary;
  }

  const source = electronBinary;
  const target = path.join(path.dirname(source), 'NekoStatusDev.exe');
  const markerPath = `${target}.neko.json`;
  const iconPath = path.join(projectRoot, 'assets', 'app_icon.ico');
  const rcedit = findRcedit();
  const hasRcedit = !!rcedit;

  try {
    const sourceStat = fs.statSync(source);
    const iconStat = fs.statSync(iconPath);
    const marker = {
      source,
      sourceSize: sourceStat.size,
      sourceMtimeMs: sourceStat.mtimeMs,
      iconSize: iconStat.size,
      iconMtimeMs: iconStat.mtimeMs,
    };
    let currentMarker = null;
    try {
      currentMarker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch {}

    const needsRefresh = !fs.existsSync(target)
      || !currentMarker
      || currentMarker.source !== marker.source
      || currentMarker.sourceSize !== marker.sourceSize
      || currentMarker.sourceMtimeMs !== marker.sourceMtimeMs
      || currentMarker.iconSize !== marker.iconSize
      || currentMarker.iconMtimeMs !== marker.iconMtimeMs
      || currentMarker.rcedit !== hasRcedit;

    if (needsRefresh) {
      fs.copyFileSync(source, target);
      if (rcedit) {
        cp.execFileSync(rcedit, [
          target,
          '--set-icon', iconPath,
          '--set-version-string', 'FileDescription', 'Neko Status Dev',
          '--set-version-string', 'ProductName', 'Neko Status',
          '--set-version-string', 'InternalName', 'NekoStatusDev',
          '--set-version-string', 'OriginalFilename', 'NekoStatusDev.exe',
        ], { stdio: 'ignore' });
      } else {
        console.warn('[start-electron] rcedit not found; dev process name may still use Electron resources.');
      }
      fs.writeFileSync(markerPath, JSON.stringify({ ...marker, rcedit: hasRcedit }, null, 2));
      try {
        const child = spawn('ie4uinit.exe', ['-show'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      } catch {}
    }

    return target;
  } catch (err) {
    console.warn(`[start-electron] failed to prepare NekoStatusDev.exe; falling back to Electron: ${err.message}`);
    return electronBinary;
  }
}

for (const arg of process.argv.slice(2)) {
  const startupUpdatePrefix = '--dev-startup-update=';
  const updateScenarioPrefix = '--dev-update-scenario=';

  if (arg.startsWith(startupUpdatePrefix)) {
    childEnv.NEKO_DEV_STARTUP_UPDATE_SCENARIO = arg.slice(startupUpdatePrefix.length);
    continue;
  }

  if (arg.startsWith(updateScenarioPrefix)) {
    childEnv.NEKO_DEV_STARTUP_UPDATE_SCENARIO = arg.slice(updateScenarioPrefix.length);
    continue;
  }

  extraArgs.push(arg);
}

// Some Windows environments leave ELECTRON_RUN_AS_NODE=1 globally set,
// which makes `electron .` boot as plain Node and breaks Electron APIs.
delete childEnv.ELECTRON_RUN_AS_NODE;

function getGpuFallbackSwitches() {
  return [
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-gpu-rasterization',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu-sandbox',
    '--use-angle=swiftshader',
    '--in-process-gpu',
  ];
}

function shouldRetryWithGpuFallback(code, stderrText) {
  if (didRetryWithGpuFallback || childEnv.NEKO_DISABLE_HW_ACCEL === '1') return false;
  if (code === 0) return false;
  return /GPU process isn't usable|gpu_process_host|exit_code=-1073741515/i.test(stderrText);
}

function isWatchableSourceFile(relativeFile) {
  const normalized = String(relativeFile || '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('/.') || normalized.startsWith('.')) return false;
  const ext = path.extname(normalized).toLowerCase();
  return WATCHED_SOURCE_EXTENSIONS.has(ext);
}

function getSourceFileMtime(watchRoot, relativeFile) {
  const absoluteFile = path.join(watchRoot, relativeFile);
  try {
    const stat = fs.statSync(absoluteFile);
    return stat.isFile() ? stat.mtimeMs : 0;
  } catch {
    return 0;
  }
}

function snapshotSourceMtimes(watchRoot) {
  const mtimes = new Map();
  const stack = [''];
  while (stack.length) {
    const current = stack.pop();
    const absoluteDir = path.join(watchRoot, current);
    let entries = [];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relativePath = current ? path.join(current, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) stack.push(relativePath);
        continue;
      }
      if (!entry.isFile() || !isWatchableSourceFile(relativePath)) continue;
      mtimes.set(relativePath.replace(/\\/g, '/'), getSourceFileMtime(watchRoot, relativePath));
    }
  }
  return mtimes;
}

function didSourceFileReallyChange(watchRoot, relativeFile) {
  if (!isWatchableSourceFile(relativeFile)) return false;
  if (Date.now() < watcherReadyAt) return false;
  const normalized = String(relativeFile || '').replace(/\\/g, '/');
  const mtime = getSourceFileMtime(watchRoot, normalized);
  const previous = watchedFileMtimes.get(normalized) || 0;
  if (!mtime || Math.abs(mtime - previous) < 1) return false;
  watchedFileMtimes.set(normalized, mtime);
  return true;
}

function setupDevWatcher() {
  if (watcherStarted || childEnv.NEKO_DISABLE_DEV_WATCH === '1') return;
  watcherStarted = true;

  const watchRoot = path.join(projectRoot, 'src');
  watchedFileMtimes = snapshotSourceMtimes(watchRoot);
  watcherReadyAt = Date.now() + 900;
  try {
    fs.watch(watchRoot, { recursive: true }, (_eventType, filename) => {
      const changedFile = String(filename || '').replace(/\\/g, '/');
      if (!didSourceFileReallyChange(watchRoot, changedFile)) return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (!activeChild || activeChild.killed) return;
        restartingForFileChange = true;
        console.log(`[start-electron] source changed: ${changedFile}; restarting Electron...`);
        activeChild.kill();
        if (process.platform === 'win32') {
          const pid = activeChild.pid;
          setTimeout(() => {
            if (activeChild && activeChild.pid === pid && !activeChild.killed) {
              try {
                cp.execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
              } catch {}
            }
          }, 1500).unref?.();
        }
      }, 280);
    });
    console.log(`[start-electron] watching ${watchRoot} for dev restarts.`);
  } catch (err) {
    console.warn(`[start-electron] failed to watch ${watchRoot}: ${err.message}`);
  }
}

function startElectron(useGpuFallback = childEnv.NEKO_DISABLE_HW_ACCEL === '1') {
  const env = { ...childEnv };
  currentUseGpuFallback = useGpuFallback;
  const args = [];
  if (useGpuFallback) {
    env.NEKO_DISABLE_HW_ACCEL = '1';
    args.push(...getGpuFallbackSwitches());
  }
  args.push(projectRoot, ...extraArgs);
  const runtimeBinary = getDevElectronBinary();
  env.NEKO_DEV_RUNTIME_EXE = runtimeBinary;
  env.NEKO_PARENT_DEV_WATCH = '1';

  const child = spawn(runtimeBinary, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: false,
    env,
  });
  activeChild = child;
  setupDevWatcher();

  let stderrText = '';
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => {
    stderrText += chunk.toString();
    if (stderrText.length > 12000) stderrText = stderrText.slice(-12000);
    process.stderr.write(chunk);
  });

  child.on('exit', (code, signal) => {
    if (restartingForFileChange) {
      restartingForFileChange = false;
      activeChild = null;
      startElectron(currentUseGpuFallback);
      return;
    }

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    if (shouldRetryWithGpuFallback(code, stderrText)) {
      didRetryWithGpuFallback = true;
      console.warn('[start-electron] GPU startup failed; retrying with software rendering fallback.');
      startElectron(true);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error('[start-electron] failed to launch Electron:', err.message);
    process.exit(1);
  });
}

process.on('SIGINT', () => {
  if (activeChild && !activeChild.killed) activeChild.kill();
  process.exit(130);
});

process.on('SIGTERM', () => {
  if (activeChild && !activeChild.killed) activeChild.kill();
  process.exit(143);
});

startElectron();

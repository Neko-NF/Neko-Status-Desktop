const { spawn } = require('child_process');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const electronBinary = require('electron');
const projectRoot = path.resolve(__dirname, '..');
const childEnv = { ...process.env };
const extraArgs = [];
let didRetryWithGpuFallback = false;

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

function startElectron(useGpuFallback = childEnv.NEKO_DISABLE_HW_ACCEL === '1') {
  const env = { ...childEnv };
  const args = [];
  if (useGpuFallback) {
    env.NEKO_DISABLE_HW_ACCEL = '1';
    args.push(...getGpuFallbackSwitches());
  }
  args.push(projectRoot, ...extraArgs);
  const runtimeBinary = getDevElectronBinary();
  env.NEKO_DEV_RUNTIME_EXE = runtimeBinary;

  const child = spawn(runtimeBinary, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: false,
    env,
  });

  let stderrText = '';
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => {
    stderrText += chunk.toString();
    if (stderrText.length > 12000) stderrText = stderrText.slice(-12000);
    process.stderr.write(chunk);
  });

  child.on('exit', (code, signal) => {
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

startElectron();

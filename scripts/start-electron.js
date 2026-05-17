const { spawn } = require('child_process');
const path = require('path');

const electronBinary = require('electron');
const projectRoot = path.resolve(__dirname, '..');
const childEnv = { ...process.env };
const extraArgs = [];
let didRetryWithGpuFallback = false;

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

  const child = spawn(electronBinary, args, {
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

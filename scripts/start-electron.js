const { spawn } = require('child_process');
const path = require('path');

const electronBinary = require('electron');
const projectRoot = path.resolve(__dirname, '..');
const childEnv = { ...process.env };
const extraArgs = [];

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

const child = spawn(electronBinary, [projectRoot, ...extraArgs], {
  stdio: 'inherit',
  windowsHide: false,
  env: childEnv,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('[start-electron] failed to launch Electron:', err.message);
  process.exit(1);
});

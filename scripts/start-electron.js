const { spawn } = require('child_process');
const path = require('path');

const electronBinary = require('electron');
const projectRoot = path.resolve(__dirname, '..');
const extraArgs = process.argv.slice(2);
const childEnv = { ...process.env };

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

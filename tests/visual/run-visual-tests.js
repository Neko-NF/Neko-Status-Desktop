const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const electron = require('electron');
const appPath = path.join(__dirname, 'electron-visual-app.js');
const passthroughArgs = process.argv.slice(2).filter((arg) => ['--update', '--ci-smoke'].includes(arg));
const childEnv = {
  ...process.env,
  ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  NEKO_VISUAL_TEST: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [appPath, ...passthroughArgs], {
  cwd: ROOT,
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '';
let stderr = '';
let result = null;

function consume(chunk, target) {
  const text = chunk.toString('utf8');
  if (target === 'stdout') stdout += text;
  else stderr += text;
  text.split(/\r?\n/).forEach((line) => {
    if (!line.startsWith('NEKO_VISUAL_RESULT:')) return;
    try {
      result = JSON.parse(line.slice('NEKO_VISUAL_RESULT:'.length));
    } catch (_) {
      // The child exit handler reports malformed output with full context.
    }
  });
}

child.stdout.on('data', (chunk) => consume(chunk, 'stdout'));
child.stderr.on('data', (chunk) => consume(chunk, 'stderr'));

const timeout = setTimeout(() => {
  child.kill();
  console.error('[visual] Electron process exceeded 250 seconds and was terminated.');
  process.exitCode = 1;
}, 250000);

child.on('error', (error) => {
  clearTimeout(timeout);
  console.error(`[visual] failed to start Electron: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code) => {
  clearTimeout(timeout);
  if (!result) {
    console.error('[visual] Electron did not return a structured result.');
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    process.exitCode = 1;
    return;
  }

  const mode = result.updated ? 'baseline update' : result.smoke ? 'CI smoke' : 'comparison';
  console.log(`[visual] ${mode}: ${result.assertions} assertions, ${result.screenshots} screenshots`);
  if (result.artifacts?.length) {
    console.log(`[visual] artifacts: ${result.artifacts.join(', ')}`);
  }
  if (result.failures?.length) {
    result.failures.forEach((failure) => console.error(`  - ${failure}`));
  }
  if (stderr.trim() && code !== 0) console.error(stderr.trim());
  process.exitCode = code || (result.failures?.length ? 1 : 0);
});

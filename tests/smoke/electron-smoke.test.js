const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('electron smoke boots preload bridge in an isolated renderer', async () => {
  const electron = require('electron');
  const appPath = path.resolve(__dirname, 'electron-smoke-app.js');

  const result = await new Promise((resolve) => {
    const childEnv = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    const child = spawn(electron, [appPath], {
      cwd: path.resolve(__dirname, '..', '..'),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 1, stdout, stderr: `${stderr}\n[smoke] test process timed out` });
    }, 20000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /preload bridge ok/);
});

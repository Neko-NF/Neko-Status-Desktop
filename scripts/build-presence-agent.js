const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const agentDir = path.join(root, 'native', 'presence-agent');
const source = path.join(agentDir, 'target', 'release', 'NekoPresenceAgent.exe');
const outputDir = path.join(root, 'build', 'native');
const output = path.join(outputDir, 'NekoPresenceAgent.exe');

const result = spawnSync('cargo', ['build', '--release', '--locked'], {
  cwd: agentDir,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env },
});
if (result.status !== 0) process.exit(result.status || 1);
if (!fs.existsSync(source)) throw new Error(`Presence Agent build output missing: ${source}`);
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(source, output);
const size = fs.statSync(output).size;
if (size < 100 * 1024) throw new Error(`Presence Agent output is unexpectedly small: ${size} bytes`);
console.log(`[PresenceAgent] ready: ${output} (${(size / 1024 / 1024).toFixed(2)} MiB)`);

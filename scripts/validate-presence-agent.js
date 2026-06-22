const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const AGENT_EXE = path.join(ROOT, 'build', 'native', 'NekoPresenceAgent.exe');
const PIPE_NAME = '\\\\.\\pipe\\NekoStatusPresenceAgent-v1';
const SECRET_TOKEN = 'nk_act_validation_secret_token';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve({ exited: true, code: child.exitCode });
    const timer = setTimeout(() => resolve({ exited: false, code: child.exitCode }), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ exited: true, code });
    });
  });
}

function sendPipe(command, payload = {}, protocolVersion = 1, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(PIPE_NAME);
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error(`pipe command timed out: ${command}`));
    }, timeoutMs);
    let buffer = Buffer.alloc(0);
    let expected = null;

    client.once('connect', () => {
      const body = Buffer.from(JSON.stringify({ protocolVersion, command, payload }), 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32LE(body.length, 0);
      client.write(Buffer.concat([length, body]));
    });
    client.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (expected === null && buffer.length >= 4) {
        expected = buffer.readUInt32LE(0);
      }
      if (expected !== null && buffer.length >= expected + 4) {
        clearTimeout(timer);
        const raw = buffer.subarray(4, 4 + expected).toString('utf8');
        client.end();
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      }
    });
    client.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function sendPipeRetry(command, payload = {}, protocolVersion = 1, timeoutMs = 2500, attempts = 20) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await sendPipe(command, payload, protocolVersion, timeoutMs);
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw lastError || new Error(`pipe command failed: ${command}`);
}

async function waitForPipe(timeoutMs = 6000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await sendPipe('hello', {}, 1, 1000);
    } catch (error) {
      lastError = error;
      await sleep(200);
    }
  }
  throw lastError || new Error('agent pipe did not become ready');
}

async function waitForAgentPipe(child, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`agent exited before pipe became ready; code=${child.exitCode}; output=${child.outputText || '<empty>'}`);
    }
    try {
      return await sendPipe('hello', {}, 1, 1000);
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`agent pipe did not become ready; exitCode=${child.exitCode}; output=${child.outputText || '<empty>'}`);
}

function startFakeServer() {
  const stats = {
    bootstrapRequests: 0,
    streamRequests: 0,
    pollRequests: 0,
    requestLog: [],
  };
  const server = http.createServer((request, response) => {
    stats.requestLog.push(`${request.method} ${request.url}`);
    if (!request.headers.authorization?.startsWith('Bearer ')) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED' } }));
      return;
    }

    if (request.url.startsWith('/api/activity/agent/bootstrap')) {
      stats.bootstrapRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: true, data: { latestEventId: '0', follows: [], active: [] } }));
      return;
    }

    if (request.url.startsWith('/api/activity/events/stream')) {
      stats.streamRequests += 1;
      if (stats.streamRequests <= 2) {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ success: false, error: { code: 'SSE_TEST_FAILURE' } }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(':\n\n');
      response.end();
      return;
    }

    if (request.url.startsWith('/api/activity/events')) {
      stats.pollRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: true, data: { events: [], cursor: '7' } }));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND' } }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        stats,
        url: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function startAgent(localAppData) {
  const env = { ...process.env, LOCALAPPDATA: localAppData };
  const child = spawn(AGENT_EXE, ['--background'], {
    cwd: ROOT,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.outputText = '';
  child.stdout.on('data', (chunk) => { child.outputText += chunk; });
  child.stderr.on('data', (chunk) => { child.outputText += chunk; });
  return child;
}

function getProcessWorkingSetBytes(pid) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).WorkingSet64`,
  ], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`failed to read agent RSS: ${result.stderr || result.stdout}`);
  }
  const value = Number(String(result.stdout || '').trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid agent RSS value: ${result.stdout}`);
  }
  return value;
}

function readProfile(localAppData) {
  const profilePath = path.join(localAppData, 'NekoStatus', 'presence-agent', 'profile.v1.json');
  return {
    profilePath,
    raw: fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf8') : '',
    json: fs.existsSync(profilePath) ? JSON.parse(fs.readFileSync(profilePath, 'utf8')) : null,
  };
}

function writeProfile(localAppData, profile) {
  const profilePath = path.join(localAppData, 'NekoStatus', 'presence-agent', 'profile.v1.json');
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
}

async function waitForCondition(label, predicate, timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Presence Agent validation is Windows-only');
  }
  if (!fs.existsSync(AGENT_EXE)) {
    throw new Error(`Agent executable missing: ${AGENT_EXE}. Run npm run build:agent first.`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-agent-validation-'));
  const localAppData = path.join(tempRoot, 'localappdata');
  fs.mkdirSync(localAppData, { recursive: true });
  const fake = await startFakeServer();
  const results = [];
  let agent = null;

  try {
    writeProfile(localAppData, {
      protocolVersion: 1,
      serverUrl: fake.url,
      deviceId: 101,
      deviceName: 'Codex Agent Validation Device',
      userId: 202,
      mainExecutable: process.execPath,
      featureEnabled: true,
      publishEnabled: false,
      backgroundEnabled: true,
      autoStartEnabled: false,
      notificationsEnabled: false,
      encryptedAgentToken: '',
      eventCursor: '0',
    });

    agent = startAgent(localAppData);
    const hello = await waitForAgentPipe(agent);
    assert.equal(hello.ok, true);
    results.push('pipe hello ok');

    const mismatch = await sendPipeRetry('hello', {}, 999);
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.data.code, 'UNSUPPORTED_PROTOCOL');
    results.push('protocol mismatch rejected');

    const provisionPayload = {
      protocolVersion: 1,
      serverUrl: fake.url,
      deviceId: 101,
      deviceName: 'Codex Agent Validation Device',
      userId: 202,
      mainExecutable: process.execPath,
      featureEnabled: true,
      publishEnabled: false,
      backgroundEnabled: true,
      autoStartEnabled: false,
      notificationsEnabled: false,
      eventCursor: '0',
      agentToken: SECRET_TOKEN,
    };
    const provision = await sendPipeRetry('provision', provisionPayload);
    assert.equal(provision.ok, true);
    assert.equal(provision.data.provisioned, true);
    results.push('provision ok');

    const profile = readProfile(localAppData);
    assert(profile.raw && !profile.raw.includes(SECRET_TOKEN), 'plaintext token must not be written to profile');
    assert(profile.json.encryptedAgentToken, 'encryptedAgentToken should be present');
    results.push('DPAPI profile written without plaintext token');

    const pause = await sendPipeRetry('pause');
    assert.equal(pause.ok, true);
    assert.equal(pause.data.paused, true);
    const resume = await sendPipeRetry('resume');
    assert.equal(resume.ok, true);
    assert.equal(resume.data.paused, false);
    results.push('pause/resume ok');

    const claim = await sendPipeRetry('claim_tray');
    assert.equal(claim.ok, true);
    assert.equal(claim.data.claimed, true);
    const release = await sendPipeRetry('release_tray');
    assert.equal(release.ok, true);
    results.push(`tray lease ok (trayRemoved=${claim.data.trayRemoved})`);

    const duplicate = startAgent(localAppData);
    const duplicateExit = await waitForExit(duplicate, 1500);
    assert.equal(duplicateExit.exited, true, 'second agent should exit because mutex is held');
    results.push('mutex single-instance ok');

    await waitForCondition('SSE failure to polling fallback', () => {
      return fake.stats.bootstrapRequests >= 1
        && fake.stats.streamRequests >= 2
        && fake.stats.pollRequests >= 1;
    });
    results.push('SSE failure triggered cursor polling fallback');

    const rssBytes = getProcessWorkingSetBytes(agent.pid);
    assert(rssBytes <= 30 * 1024 * 1024, `agent RSS should stay under 30 MiB during validation, got ${rssBytes}`);
    results.push(`resource smoke RSS ${(rssBytes / 1024 / 1024).toFixed(1)} MiB <= 30 MiB`);

    const shutdown = await sendPipeRetry('shutdown', { reason: 'session' });
    assert.equal(shutdown.ok, true);
    const exit = await waitForExit(agent, 5000);
    assert.equal(exit.exited, true);
    results.push('session shutdown exits agent');
    agent = null;

    const persisted = readProfile(localAppData).json;
    assert.equal(persisted.backgroundEnabled, true);
    assert.equal(persisted.encryptedAgentToken.length > 0, true);
    results.push('session shutdown preserves next-login configuration');

    persisted.encryptedAgentToken = 'not-base64-token';
    fs.writeFileSync(readProfile(localAppData).profilePath, JSON.stringify(persisted, null, 2));
    agent = startAgent(localAppData);
    await waitForAgentPipe(agent);
    await waitForCondition('corrupted token recovery', async () => {
      const status = await sendPipeRetry('get_status');
      return status.ok && status.data.connection === 'unprovisioned';
    }, 5000);
    results.push('corrupted DPAPI token does not crash agent');

    const disable = await sendPipeRetry('shutdown', { reason: 'disable' });
    assert.equal(disable.ok, true);
    const disableExit = await waitForExit(agent, 5000);
    assert.equal(disableExit.exited, true);
    agent = null;
    const disabledProfile = readProfile(localAppData).json;
    assert.equal(disabledProfile.featureEnabled, false);
    assert.equal(disabledProfile.backgroundEnabled, false);
    assert.equal(disabledProfile.autoStartEnabled, false);
    assert.equal(disabledProfile.encryptedAgentToken, '');
    results.push('disable shutdown clears token/background/autostart config');

    console.log(JSON.stringify({
      ok: true,
      checks: results,
      fakeServer: {
        bootstrapRequests: fake.stats.bootstrapRequests,
        streamRequests: fake.stats.streamRequests,
        pollRequests: fake.stats.pollRequests,
      },
    }, null, 2));
  } finally {
    if (agent && agent.exitCode === null) {
      try {
        await sendPipeRetry('shutdown', { reason: 'session' }, 1, 1000, 5);
      } catch {}
      agent.kill();
    }
    await new Promise((resolve) => fake.server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[validate-presence-agent] ${error.stack || error.message}`);
  process.exit(1);
});

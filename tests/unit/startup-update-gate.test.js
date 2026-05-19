const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  runStartupUpdateGate,
  runBackgroundUpdateCheck,
} = require('../../src/main/startup-update-gate');

function createConfig(initial = {}) {
  return {
    data: {
      autoCheckUpdate: true,
      autoDownload: true,
      skippedVersion: '',
      githubToken: '',
      pendingInstall: null,
      ...initial,
    },
    get(key) { return this.data[key]; },
    set(key, value) { this.data[key] = value; },
  };
}

function createDeps(overrides = {}) {
  const configStore = overrides.configStore || createConfig();
  return {
    configStore,
    checkForUpdates: mock.fn(async () => ({ hasUpdate: false })),
    launchInstaller: mock.fn(async () => null),
    sendToRenderer: mock.fn(),
    setIsQuitting: mock.fn(),
    quitApp: mock.fn(),
    showNotification: mock.fn(),
    isPackaged: true,
    quitDelayMs: 0,
    logger: { log: mock.fn(), warn: mock.fn() },
    ...overrides,
  };
}

describe('startup update gate', () => {
  it('installs a valid pending installer before opening the window', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-update-test-'));
    const installer = path.join(tmpDir, 'NekoStatus-update.exe');
    fs.writeFileSync(installer, 'installer');
    const sha256 = crypto.createHash('sha256').update('installer').digest('hex');
    const configStore = createConfig({
      pendingInstall: { version: '1.2.5', filePath: installer, sha256 },
    });

    const deps = createDeps({ configStore });
    const result = await runStartupUpdateGate(deps);

    assert.equal(result.action, 'installing');
    assert.equal(deps.launchInstaller.mock.callCount(), 1);
    assert.equal(configStore.get('pendingInstall'), null);
    assert.equal(deps.setIsQuitting.mock.callCount(), 1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('opens the app when the startup update check cannot connect', async () => {
    const deps = createDeps({
      checkForUpdates: mock.fn(async () => { throw new Error('network down'); }),
    });

    const result = await runStartupUpdateGate(deps);

    assert.equal(result.action, 'open');
    assert.equal(result.reason, 'check-failed');
    assert.equal(deps.launchInstaller.mock.callCount(), 0);
  });

  it('uses fast update checks before opening the window', async () => {
    const deps = createDeps({
      startupCheckOptions: {
        estimateSpeed: false,
        releaseFetchTimeoutMs: 4000,
        parallelSources: true,
        reason: 'startup',
      },
    });

    const result = await runStartupUpdateGate(deps);

    assert.equal(result.action, 'open');
    assert.equal(deps.checkForUpdates.mock.callCount(), 1);
    assert.deepEqual(deps.checkForUpdates.mock.calls[0].arguments[0], deps.startupCheckOptions);
  });

  it('downloads and launches an installer before opening when an update exists', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-update-test-'));
    const body = Buffer.from('installer-binary');
    const deps = createDeps({
      tempRoot: tmpDir,
      checkForUpdates: mock.fn(async () => ({
        hasUpdate: true,
        latestVersion: '1.2.5',
        exeDownloadUrl: 'https://example.com/NekoStatus-1.2.5.exe',
      })),
      fetchImpl: mock.fn(async () => ({
        ok: true,
        url: 'https://example.com/NekoStatus-1.2.5.exe',
        headers: { get: () => String(body.length) },
        body: null,
        arrayBuffer: async () => body,
      })),
    });

    const result = await runStartupUpdateGate(deps);

    assert.equal(result.action, 'installing');
    assert.equal(deps.fetchImpl.mock.callCount(), 1);
    assert.equal(deps.launchInstaller.mock.callCount(), 1);
    assert.match(deps.launchInstaller.mock.calls[0].arguments[0], /NekoStatus-1\.2\.5\.exe$/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not auto-install in dev mode unless explicitly allowed', async () => {
    const deps = createDeps({
      isPackaged: false,
      checkForUpdates: mock.fn(async () => ({
        hasUpdate: true,
        latestVersion: '1.2.5',
        exeDownloadUrl: 'https://example.com/NekoStatus-1.2.5.exe',
      })),
    });

    const result = await runStartupUpdateGate(deps);

    assert.equal(result.action, 'open');
    assert.equal(result.reason, 'dev-auto-install-disabled');
    assert.equal(deps.launchInstaller.mock.callCount(), 0);
  });

  it('runs deterministic startup update scenarios in dev mode only', async () => {
    const deps = createDeps({
      isPackaged: false,
      devStartupUpdateScenario: 'download',
      scenarioStepMs: 0,
      checkForUpdates: mock.fn(async () => {
        throw new Error('real update check should not run');
      }),
      onStatus: mock.fn(),
    });

    const result = await runStartupUpdateGate(deps);

    assert.equal(result.action, 'open');
    assert.equal(result.reason, 'dev-startup-update-scenario');
    assert.equal(result.scenario, 'download');
    assert.equal(deps.checkForUpdates.mock.callCount(), 0);
    assert.equal(deps.launchInstaller.mock.callCount(), 0);
    assert.equal(deps.sendToRenderer.mock.callCount(), 5);
    assert.ok(deps.onStatus.mock.calls.some((call) => call.arguments[0].devScenario === 'download'));
  });
});

describe('background update check', () => {
  it('honors autoCheckUpdate=false for scheduled checks', async () => {
    const deps = createDeps({
      configStore: createConfig({ autoCheckUpdate: false }),
      autoDownloadUpdate: mock.fn(),
    });

    const result = await runBackgroundUpdateCheck(deps);

    assert.equal(result.reason, 'auto-check-disabled');
    assert.equal(deps.checkForUpdates.mock.callCount(), 0);
  });

  it('starts one background download for a new version', async () => {
    const autoDownloadUpdate = mock.fn(async () => {});
    const deps = createDeps({
      autoDownloadUpdate,
      checkForUpdates: mock.fn(async () => ({
        hasUpdate: true,
        latestVersion: '1.2.5',
        exeDownloadUrl: 'https://example.com/NekoStatus-1.2.5.exe',
      })),
    });

    const result = await runBackgroundUpdateCheck(deps);

    assert.equal(result.action, 'download');
    assert.equal(autoDownloadUpdate.mock.callCount(), 1);
  });
});

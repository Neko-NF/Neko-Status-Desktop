const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildRelaunchWatcherScript,
  launchInstaller,
  quotePowerShellString,
  scheduleRelaunchAfterInstaller,
} = require('../../src/main/update-installer');

describe('update installer relaunch watcher', () => {
  it('quotes PowerShell strings safely', () => {
    assert.equal(quotePowerShellString("C:\\Apps\\Neko's Status\\NekoStatus.exe"), "'C:\\Apps\\Neko''s Status\\NekoStatus.exe'");
  });

  it('waits for the old app process and detects same-version reinstall changes', () => {
    const script = buildRelaunchWatcherScript({
      installerPid: 2468,
      appPid: 1357,
      exePath: 'C:\\Program Files\\NekoStatus\\NekoStatus.exe',
      fallbackDelaySeconds: 12,
      deadlineMinutes: 2,
    });

    assert.match(script, /\$installerPid = 2468/);
    assert.match(script, /\$appPid = 1357/);
    assert.match(script, /Wait-Process -Id \$appPid/);
    assert.match(script, /Wait-Process -Id \$installerPid/);
    assert.match(script, /VersionInfo\.ProductVersion/);
    assert.match(script, /LastWriteTimeUtc\.Ticks/);
    assert.match(script, /\$fileChanged/);
    assert.match(script, /AddSeconds\(12\)/);
    assert.match(script, /Start-Process -FilePath \$exePath -WorkingDirectory \$workingDirectory/);

    assert.ok(
      script.indexOf('Wait-Process -Id $appPid') < script.indexOf('Wait-Process -Id $installerPid'),
      'old app process should be allowed to exit before installer completion is interpreted'
    );
  });

  it('spawns a hidden detached PowerShell watcher on Windows', () => {
    const unref = mock.fn();
    const spawnImpl = mock.fn(() => ({ unref }));

    const scheduled = scheduleRelaunchAfterInstaller(99, {
      platform: 'win32',
      exePath: 'C:\\Apps\\NekoStatus\\NekoStatus.exe',
      appPid: 88,
      spawnImpl,
      logger: { error: mock.fn() },
    });

    assert.equal(scheduled, true);
    assert.equal(spawnImpl.mock.callCount(), 1);
    const [command, args, options] = spawnImpl.mock.calls[0].arguments;
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-WindowStyle'));
    assert.ok(args.includes('Hidden'));
    assert.equal(options.detached, true);
    assert.equal(options.windowsHide, true);
    assert.equal(unref.mock.callCount(), 1);
  });

  it('does not schedule a watcher outside Windows', () => {
    const spawnImpl = mock.fn();
    const scheduled = scheduleRelaunchAfterInstaller(99, {
      platform: 'linux',
      spawnImpl,
    });

    assert.equal(scheduled, false);
    assert.equal(spawnImpl.mock.callCount(), 0);
  });
});

describe('launchInstaller', () => {
  it('runs NSIS installers silently and asks the installer to relaunch the app', async () => {
    const childUnref = mock.fn();
    const spawnImpl = mock.fn(() => ({ pid: 4321, unref: childUnref }));
    const scheduleRelaunch = mock.fn();
    const installerPath = path.join('C:\\Temp', 'NekoStatus-Setup-1.2.11.exe');

    const result = await launchInstaller(installerPath, {
      platform: 'win32',
      silent: true,
      spawnImpl,
      scheduleRelaunch,
    });

    assert.equal(result, '');
    assert.equal(spawnImpl.mock.callCount(), 1);
    assert.deepEqual(spawnImpl.mock.calls[0].arguments[1], ['/S', '--force-run']);
    assert.equal(scheduleRelaunch.mock.callCount(), 0);
    assert.equal(childUnref.mock.callCount(), 1);
  });

  it('keeps the PowerShell relaunch watcher as an explicit fallback strategy', async () => {
    const spawnImpl = mock.fn(() => ({ pid: 4321, unref: mock.fn() }));
    const scheduleRelaunch = mock.fn();

    await launchInstaller('C:\\Temp\\NekoStatus-Setup-1.2.11.exe', {
      platform: 'win32',
      silent: true,
      relaunchStrategy: 'watcher',
      spawnImpl,
      scheduleRelaunch,
    });

    assert.deepEqual(spawnImpl.mock.calls[0].arguments[1], ['/S']);
    assert.equal(scheduleRelaunch.mock.callCount(), 1);
    assert.equal(scheduleRelaunch.mock.calls[0].arguments[0], 4321);
  });

  it('does not pass silent flags for manual installer launches', async () => {
    const spawnImpl = mock.fn(() => ({ pid: 4321, unref: mock.fn() }));
    const scheduleRelaunch = mock.fn();

    await launchInstaller('C:\\Temp\\NekoStatus-Setup-1.2.11.exe', {
      platform: 'win32',
      silent: false,
      spawnImpl,
      scheduleRelaunch,
    });

    assert.deepEqual(spawnImpl.mock.calls[0].arguments[1], []);
  });
});

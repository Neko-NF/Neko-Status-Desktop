const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ensureWindowsAppIdentityShortcuts,
  refreshShellIconCache,
  shortcutNeedsWrite,
} = require('../../src/main/windows-app-identity');

function createFs(existing = new Set()) {
  const removed = [];
  const madeDirs = [];
  return {
    existing,
    removed,
    madeDirs,
    accessSync(filePath) {
      if (!existing.has(filePath)) throw new Error('missing');
    },
    existsSync(filePath) {
      return existing.has(filePath);
    },
    mkdirSync(dirPath) {
      madeDirs.push(dirPath);
      existing.add(dirPath);
    },
    unlinkSync(filePath) {
      removed.push(filePath);
      existing.delete(filePath);
    },
  };
}

function createApp({ packaged = true } = {}) {
  return {
    isPackaged: packaged,
    getAppPath: () => 'D:\\VScode project\\Neko_Status',
    getPath(name) {
      if (name === 'appData') return 'C:\\Users\\qwe\\AppData\\Roaming';
      if (name === 'desktop') return 'C:\\Users\\qwe\\Desktop';
      return '';
    },
  };
}

describe('Windows app identity shortcuts', () => {
  it('rewrites shortcuts when the app icon or AppUserModelID is missing', () => {
    assert.equal(shortcutNeedsWrite({
      target: 'C:\\Program Files\\NekoStatus\\NekoStatus.exe',
      args: '',
      appUserModelId: '',
      icon: '',
      iconIndex: 0,
    }, {
      target: 'C:\\Program Files\\NekoStatus\\NekoStatus.exe',
      args: '',
      appUserModelId: 'com.koirin.neko-status',
      icon: 'C:\\Program Files\\NekoStatus\\resources\\app_icon.ico',
      iconIndex: 0,
    }), true);
  });

  it('creates packaged Start Menu and Desktop shortcuts with the app icon and identity id', () => {
    const resourcesPath = 'C:\\Program Files\\NekoStatus\\resources';
    const icon = path.join(resourcesPath, 'app_icon.ico');
    const existing = new Set([
      icon,
      'C:\\Users\\qwe\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Neko Status.lnk',
      'C:\\Users\\qwe\\Desktop\\Neko Status.lnk',
    ]);
    const fs = createFs(existing);
    const writes = [];
    const shell = {
      readShortcutLink: mock.fn(() => {
        throw new Error('missing shortcut');
      }),
      writeShortcutLink: mock.fn((shortcutPath, operation, options) => {
        writes.push({ shortcutPath, operation, options });
        existing.add(shortcutPath);
        return true;
      }),
    };

    const result = ensureWindowsAppIdentityShortcuts({
      app: createApp({ packaged: true }),
      shell,
      fs,
      appName: 'NekoStatus',
      appUserModelId: 'com.koirin.neko-status',
      platform: 'win32',
      execPath: 'C:\\Program Files\\NekoStatus\\NekoStatus.exe',
      resourcesPath,
    });

    assert.equal(result.ok, true);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].shortcutPath, 'C:\\Users\\qwe\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\NekoStatus.lnk');
    assert.equal(writes[1].shortcutPath, 'C:\\Users\\qwe\\Desktop\\NekoStatus.lnk');
    assert.equal(writes[0].options.icon, icon);
    assert.equal(writes[0].options.appUserModelId, 'com.koirin.neko-status');
    assert.equal(writes[0].options.cwd, 'C:\\Program Files\\NekoStatus');
    assert.ok(fs.removed.includes('C:\\Users\\qwe\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Neko Status.lnk'));
    assert.ok(fs.removed.includes('C:\\Users\\qwe\\Desktop\\Neko Status.lnk'));
  });

  it('creates a dev Start Menu shortcut pointing at electron with project args', () => {
    const appPath = 'D:\\VScode project\\Neko_Status';
    const icon = path.join(appPath, 'assets', 'app_icon.ico');
    const existing = new Set([icon]);
    const fs = createFs(existing);
    const writes = [];
    const shell = {
      readShortcutLink: mock.fn(() => {
        throw new Error('missing shortcut');
      }),
      writeShortcutLink: mock.fn((shortcutPath, operation, options) => {
        writes.push({ shortcutPath, operation, options });
        return true;
      }),
    };

    const result = ensureWindowsAppIdentityShortcuts({
      app: createApp({ packaged: false }),
      shell,
      fs,
      appName: 'NekoStatus',
      appUserModelId: 'com.koirin.neko-status',
      platform: 'win32',
      execPath: 'D:\\VScode project\\Neko_Status\\node_modules\\electron\\dist\\electron.exe',
      resourcesPath: 'D:\\VScode project\\Neko_Status\\node_modules\\electron\\dist\\resources',
    });

    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].shortcutPath, 'C:\\Users\\qwe\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\NekoStatus Dev.lnk');
    assert.equal(writes[0].options.target, 'D:\\VScode project\\Neko_Status\\node_modules\\electron\\dist\\electron.exe');
    assert.equal(writes[0].options.args, `"${appPath}"`);
    assert.equal(writes[0].options.icon, icon);
    assert.equal(writes[0].options.appUserModelId, 'com.koirin.neko-status');
  });

  it('honors explicit dev mode when the renamed runtime makes Electron look packaged', () => {
    const appPath = 'D:\\VScode project\\Neko_Status';
    const icon = path.join(appPath, 'assets', 'app_icon.ico');
    const existing = new Set([
      icon,
      'C:\\Users\\qwe\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\NekoStatus.lnk',
    ]);
    const fs = createFs(existing);
    const writes = [];
    const shell = {
      readShortcutLink: mock.fn(() => {
        throw new Error('missing shortcut');
      }),
      writeShortcutLink: mock.fn((shortcutPath, operation, options) => {
        writes.push({ shortcutPath, operation, options });
        return true;
      }),
    };

    const result = ensureWindowsAppIdentityShortcuts({
      app: createApp({ packaged: true }),
      shell,
      fs,
      appName: 'NekoStatus',
      appUserModelId: 'com.koirin.neko-status',
      platform: 'win32',
      isPackaged: false,
      execPath: 'D:\\VScode project\\Neko_Status\\node_modules\\electron\\dist\\NekoStatusDev.exe',
      resourcesPath: 'D:\\VScode project\\Neko_Status\\node_modules\\electron\\dist\\resources',
    });

    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].shortcutPath, 'C:\\Users\\qwe\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\NekoStatus Dev.lnk');
    assert.equal(writes[0].options.target, 'D:\\VScode project\\Neko_Status\\node_modules\\electron\\dist\\NekoStatusDev.exe');
    assert.equal(writes[0].options.args, `"${appPath}"`);
    assert.ok(fs.removed.includes('C:\\Users\\qwe\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\NekoStatus.lnk'));
  });

  it('refreshes the Windows shell icon cache after shortcut changes', () => {
    const unref = mock.fn();
    const spawnImpl = mock.fn(() => ({ unref }));

    assert.equal(refreshShellIconCache({ spawnImpl, platform: 'win32' }), true);
    assert.equal(spawnImpl.mock.callCount(), 1);
    assert.equal(spawnImpl.mock.calls[0].arguments[0], 'ie4uinit.exe');
    assert.deepEqual(spawnImpl.mock.calls[0].arguments[1], ['-show']);
    assert.equal(spawnImpl.mock.calls[0].arguments[2].windowsHide, true);
    assert.equal(unref.mock.callCount(), 1);
  });
});

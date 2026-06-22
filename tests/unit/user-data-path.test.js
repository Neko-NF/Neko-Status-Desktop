const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  configureUserDataPath,
  PACKAGED_USER_DATA_DIR,
  DEV_USER_DATA_DIR,
} = require('../../src/main/user-data-path');

const tempDirs = [];

function makeTempAppData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-user-data-'));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(appDataDir, dirName, data) {
  const dir = path.join(appDataDir, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'neko-config.json'), JSON.stringify(data), 'utf8');
}

function readConfig(appDataDir, dirName) {
  return JSON.parse(fs.readFileSync(path.join(appDataDir, dirName, 'neko-config.json'), 'utf8'));
}

function createApp(appDataDir) {
  const paths = {};
  return {
    getPath(name) {
      if (name === 'appData') return appDataDir;
      return paths[name] || '';
    },
    setPath(name, value) {
      paths[name] = value;
    },
    paths,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('user data path compatibility', () => {
  it('keeps packaged config in the historical package-name directory', () => {
    const appDataDir = makeTempAppData();
    const app = createApp(appDataDir);

    const result = configureUserDataPath({
      app,
      isDevRuntime: false,
      displayName: 'Neko Status',
    });

    assert.equal(result.userDataPath, path.join(appDataDir, PACKAGED_USER_DATA_DIR));
    assert.equal(app.paths.userData, path.join(appDataDir, PACKAGED_USER_DATA_DIR));
  });

  it('migrates config written under the spaced display name back to the historical directory', () => {
    const appDataDir = makeTempAppData();
    const app = createApp(appDataDir);
    writeConfig(appDataDir, 'Neko Status', { deviceKey: 'legacy-key' });

    const result = configureUserDataPath({
      app,
      isDevRuntime: false,
      displayName: 'Neko Status',
    });

    assert.equal(result.migration.copied, true);
    assert.deepEqual(readConfig(appDataDir, PACKAGED_USER_DATA_DIR), { deviceKey: 'legacy-key' });
    assert.equal(
      fs.existsSync(path.join(appDataDir, 'Neko Status', 'neko-config.json')),
      true
    );
  });

  it('migrates config from a product-name directory when no historical config exists', () => {
    const appDataDir = makeTempAppData();
    const app = createApp(appDataDir);
    writeConfig(appDataDir, 'NekoStatus', { deviceKey: 'product-name-key' });

    const result = configureUserDataPath({
      app,
      isDevRuntime: false,
      displayName: 'Neko Status',
    });

    assert.equal(result.migration.copied, true);
    assert.deepEqual(readConfig(appDataDir, PACKAGED_USER_DATA_DIR), { deviceKey: 'product-name-key' });
  });

  it('does not overwrite an existing historical config', () => {
    const appDataDir = makeTempAppData();
    const app = createApp(appDataDir);
    writeConfig(appDataDir, PACKAGED_USER_DATA_DIR, { deviceKey: 'old-key' });
    writeConfig(appDataDir, 'Neko Status', { deviceKey: 'new-key' });

    const result = configureUserDataPath({
      app,
      isDevRuntime: false,
      displayName: 'Neko Status',
    });

    assert.equal(result.migration.copied, false);
    assert.deepEqual(readConfig(appDataDir, PACKAGED_USER_DATA_DIR), { deviceKey: 'old-key' });
  });

  it('keeps dev runtime config separate from packaged config', () => {
    const appDataDir = makeTempAppData();
    const app = createApp(appDataDir);

    const result = configureUserDataPath({
      app,
      isDevRuntime: true,
      displayName: 'Neko Status Dev',
    });

    assert.equal(result.userDataPath, path.join(appDataDir, DEV_USER_DATA_DIR));
    assert.equal(app.paths.userData, path.join(appDataDir, DEV_USER_DATA_DIR));
  });

  it('uses an explicit absolute directory without migrating existing config', () => {
    const appDataDir = makeTempAppData();
    const overrideDir = makeTempAppData();
    const app = createApp(appDataDir);
    writeConfig(appDataDir, 'Neko Status Dev', { deviceKey: 'personal-key' });

    const result = configureUserDataPath({
      app,
      isDevRuntime: true,
      displayName: 'Neko Status Dev',
      userDataDir: overrideDir,
    });

    assert.equal(result.userDataPath, overrideDir);
    assert.equal(app.paths.userData, overrideDir);
    assert.equal(result.migration.copied, false);
    assert.equal(fs.existsSync(path.join(overrideDir, 'neko-config.json')), false);
  });
});

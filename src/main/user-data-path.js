const fs = require('fs');
const path = require('path');

const CONFIG_FILE_NAME = 'neko-config.json';
const PACKAGED_USER_DATA_DIR = 'neko-status-desktop';
const DEV_USER_DATA_DIR = 'NekoStatus Dev';

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    if (!candidate) return false;
    const key = path.resolve(candidate).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function copyConfigIfMissing({ fsImpl = fs, targetDir, sourceDirs, logger = console }) {
  const targetConfig = path.join(targetDir, CONFIG_FILE_NAME);
  if (fsImpl.existsSync(targetConfig)) return { copied: false, targetConfig };

  const sourceConfig = uniquePaths(sourceDirs)
    .map((sourceDir) => path.join(sourceDir, CONFIG_FILE_NAME))
    .find((candidate) => fsImpl.existsSync(candidate));

  if (!sourceConfig) return { copied: false, targetConfig };

  try {
    fsImpl.mkdirSync(targetDir, { recursive: true });
    fsImpl.copyFileSync(sourceConfig, targetConfig);
    return { copied: true, sourceConfig, targetConfig };
  } catch (error) {
    logger.warn?.('[UserData] Failed to migrate config:', error.message);
    return { copied: false, sourceConfig, targetConfig, error: error.message };
  }
}

function configureUserDataPath({
  app,
  fsImpl = fs,
  isDevRuntime = false,
  displayName,
  logger = console,
}) {
  const appDataDir = app.getPath('appData');
  const targetName = isDevRuntime ? DEV_USER_DATA_DIR : PACKAGED_USER_DATA_DIR;
  const targetDir = path.join(appDataDir, targetName);
  const fallbackNames = [
    isDevRuntime ? 'Electron' : 'NekoStatus',
    isDevRuntime ? 'Neko Status Dev' : 'Neko Status',
    displayName,
    isDevRuntime ? 'NekoStatusDev' : 'neko_status',
  ].filter((name) => name && name !== targetName);
  const sourceDirs = fallbackNames.map((name) => path.join(appDataDir, name));

  try {
    fsImpl.mkdirSync(targetDir, { recursive: true });
  } catch (error) {
    logger.warn?.('[UserData] Failed to prepare userData directory:', error.message);
  }
  const migration = copyConfigIfMissing({ fsImpl, targetDir, sourceDirs, logger });
  app.setPath('userData', targetDir);
  return { userDataPath: targetDir, migration };
}

module.exports = {
  CONFIG_FILE_NAME,
  PACKAGED_USER_DATA_DIR,
  DEV_USER_DATA_DIR,
  copyConfigIfMissing,
  configureUserDataPath,
};

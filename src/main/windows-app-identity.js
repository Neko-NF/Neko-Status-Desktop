const path = require('path');

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

function getAssetPath({
  app,
  fs,
  relativePaths,
  resourcesPath = process.resourcesPath,
  execPath = process.execPath,
  dirname = __dirname,
}) {
  const roots = [
    resourcesPath,
    execPath ? path.dirname(execPath) : '',
    app.getAppPath(),
    path.join(dirname, '..', '..'),
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    for (const rel of relativePaths) {
      candidates.push(path.join(root, rel));
    }
  }
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

function getAppIconPath(deps) {
  return getAssetPath({
    ...deps,
    relativePaths: ['app_icon.ico', 'assets/app_icon.ico', 'app_icon.png', 'assets/app_icon.png'],
  });
}

function normalizeShortcutValue(value) {
  return String(value || '');
}

function shortcutNeedsWrite(current, expected) {
  return normalizeShortcutValue(current.target) !== normalizeShortcutValue(expected.target)
    || normalizeShortcutValue(current.args) !== normalizeShortcutValue(expected.args)
    || normalizeShortcutValue(current.appUserModelId) !== normalizeShortcutValue(expected.appUserModelId)
    || normalizeShortcutValue(current.icon) !== normalizeShortcutValue(expected.icon)
    || Number(current.iconIndex || 0) !== Number(expected.iconIndex || 0);
}

function writeShortcutIfNeeded({
  shell,
  fs,
  shortcutPath,
  target,
  args,
  cwd,
  icon,
  description,
  appUserModelId,
}) {
  const expected = {
    target,
    args,
    appUserModelId,
    icon: icon && fs.existsSync(icon) ? icon : target,
    iconIndex: 0,
  };

  let shouldWrite = true;
  try {
    const current = shell.readShortcutLink(shortcutPath);
    shouldWrite = shortcutNeedsWrite(current, expected);
  } catch {
    shouldWrite = true;
  }

  if (!shouldWrite) return { ok: true, changed: false, shortcutPath };

  const operation = fs.existsSync(shortcutPath) ? 'replace' : 'create';
  const ok = shell.writeShortcutLink(shortcutPath, operation, {
    target,
    args,
    cwd,
    description,
    icon: expected.icon,
    iconIndex: expected.iconIndex,
    appUserModelId,
  });
  return { ok, changed: ok, shortcutPath };
}

function refreshShellIconCache({ spawnImpl, platform = process.platform } = {}) {
  if (platform !== 'win32' || typeof spawnImpl !== 'function') return false;
  try {
    const child = spawnImpl('ie4uinit.exe', ['-show'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  } catch {
    return false;
  }
}

function removeShortcutIfExists(fs, shortcutPath) {
  if (!shortcutPath || !fs.existsSync(shortcutPath)) return false;
  try {
    fs.unlinkSync(shortcutPath);
    return true;
  } catch {
    return false;
  }
}

function getShortcutTargets({ app, pathModule = path, appName, isPackaged = app.isPackaged }) {
  const programsDir = pathModule.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs'
  );
  const desktopDir = app.getPath('desktop');
  const suffix = isPackaged ? '' : ' Dev';
  const primaryName = `${appName}${suffix}.lnk`;
  return {
    programsDir,
    desktopDir,
    primary: pathModule.join(programsDir, primaryName),
    desktop: desktopDir ? pathModule.join(desktopDir, primaryName) : null,
    legacy: [
      pathModule.join(programsDir, 'Neko Status.lnk'),
      pathModule.join(programsDir, 'NekoStatus.lnk'),
      desktopDir ? pathModule.join(desktopDir, 'Neko Status.lnk') : null,
      desktopDir ? pathModule.join(desktopDir, 'NekoStatus.lnk') : null,
    ],
  };
}

function ensureWindowsAppIdentityShortcuts({
  app,
  shell,
  fs,
  appName,
  appUserModelId,
  isPackaged = app.isPackaged,
  logger = console,
  platform = process.platform,
  execPath = process.execPath,
  dirname = __dirname,
  resourcesPath = process.resourcesPath,
  spawnImpl = null,
  ensureDesktopShortcut = false,
}) {
  if (platform !== 'win32') return { ok: true, skipped: true };

  try {
    const pathModule = path.win32;
    const targets = getShortcutTargets({ app, appName, isPackaged, pathModule });
    fs.mkdirSync(targets.programsDir, { recursive: true });

    const icon = getAppIconPath({ app, fs, dirname, resourcesPath, execPath });
    const target = execPath;
    const args = isPackaged ? '' : `"${app.getAppPath()}"`;
    const cwd = isPackaged ? pathModule.dirname(execPath) : app.getAppPath();
    const description = appName;

    const removedLegacy = [];
    const protectedShortcuts = uniquePaths([targets.primary, targets.desktop])
      .map((item) => path.resolve(item).toLowerCase());
    for (const legacy of uniquePaths(targets.legacy).filter((item) => !protectedShortcuts.includes(path.resolve(item).toLowerCase()))) {
      if (removeShortcutIfExists(fs, legacy)) removedLegacy.push(legacy);
    }

    const primary = writeShortcutIfNeeded({
      shell,
      fs,
      shortcutPath: targets.primary,
      target,
      args,
      cwd,
      icon,
      description,
      appUserModelId,
    });
    if (!primary.ok) {
      return { ok: false, error: 'shortcut-write-failed', shortcutPath: targets.primary };
    }

    let desktop = { ok: true, changed: false, skipped: true };
    if (isPackaged && ensureDesktopShortcut && targets.desktop) {
      desktop = writeShortcutIfNeeded({
        shell,
        fs,
        shortcutPath: targets.desktop,
        target,
        args,
        cwd,
        icon,
        description,
        appUserModelId,
      });
      if (!desktop.ok) {
        return { ok: false, error: 'desktop-shortcut-write-failed', shortcutPath: targets.desktop };
      }
    }

    const changed = primary.changed || desktop.changed || removedLegacy.length > 0;
    if (changed) refreshShellIconCache({ spawnImpl, platform });

    return {
      ok: true,
      shortcutPath: targets.primary,
      desktopShortcutPath: isPackaged && ensureDesktopShortcut ? targets.desktop : null,
      icon,
      changed,
      removedLegacy,
    };
  } catch (err) {
    logger.warn?.('[WindowsIdentity] Failed to prepare app identity shortcut:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  uniquePaths,
  getAssetPath,
  getAppIconPath,
  shortcutNeedsWrite,
  writeShortcutIfNeeded,
  refreshShellIconCache,
  getShortcutTargets,
  ensureWindowsAppIdentityShortcuts,
};

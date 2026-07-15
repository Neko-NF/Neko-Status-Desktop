const { IPC_EVENTS } = require('../shared/ipc-contracts');

function createAppShell(deps) {
  const {
    app,
    BrowserWindow,
    Tray,
    Menu,
    nativeImage,
    dialog,
    screen,
    desktopCapturer,
    ipcMain,
    path,
    fs,
    os,
    configStore,
    statusService,
    systemUtils,
    APP_NAME,
    APP_VERSION,
    isAutoStart,
    isRunAsAdmin,
    getMainWindow,
    setMainWindow,
    getTray,
    setTray,
    getIsQuitting,
    setIsQuitting,
    getPrivacyPickerWindow,
    setPrivacyPickerWindow,
    activityAgent,
    startupPage,
    requestActivityQuit,
  } = deps;

  function getAssetPath(...relativePaths) {
    const roots = [
      process.resourcesPath,
      path.dirname(process.execPath),
      app.getAppPath(),
      path.join(__dirname, '..', '..'),
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

  function getTrayIconPath() {
    return getAssetPath('app_icon.ico', 'app_icon.png', 'assets/app_icon.ico', 'assets/app_icon.png');
  }

  function createIconImage(...relativePaths) {
    for (const rel of relativePaths) {
      const iconPath = getAssetPath(rel);
      if (!iconPath) continue;
      const image = nativeImage.createFromPath(iconPath);
      if (image && !image.isEmpty()) return image;
    }
    return null;
  }

  function createAppIconImage() {
    return createIconImage('app_icon.ico', 'app_icon.png', 'assets/app_icon.ico', 'assets/app_icon.png');
  }

  function sendToRenderer(channel, data) {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  }

  function pushInitialState() {
    sendToRenderer(IPC_EVENTS.APP_INIT, {
      config: configStore.getAll(),
      isRunning: statusService.isRunning,
      version: APP_VERSION,
      deviceName: os.hostname(),
      platform: os.platform(),
      isAutoStart,
      processName: path.basename(process.execPath),
      pid: process.pid,
      isAdmin: isRunAsAdmin(),
      startupPage,
    });
  }

  function isDevToolsShortcut(input = {}) {
    if (input.type !== 'keyDown') return false;
    const key = String(input.key || '').toLowerCase();
    const code = String(input.code || '').toLowerCase();
    const primary = !!(input.control || input.meta);
    if (key === 'f12' || code === 'f12') return true;
    if (primary && input.shift && (key === 'i' || code === 'keyi')) return true;
    if (primary && input.shift && (key === 'j' || code === 'keyj')) return true;
    if (primary && input.shift && (key === 'c' || code === 'keyc')) return true;
    return false;
  }

  function attachMainWindowShortcutPolicy(win) {
    if (!win?.webContents) return;
    win.webContents.on('before-input-event', (event, input) => {
      if (isDevToolsShortcut(input)) {
        event.preventDefault();
      }
    });
  }

  let developerModeWindow = null;
  let syncingDeveloperModeBounds = false;
  let allowDeveloperModeWindowClose = false;
  const DEVELOPER_MODE_PANEL_WIDTH = 380;
  const DEVELOPER_MODE_PANEL_GAP = 8;

  function getDeveloperModeWindow() {
    return developerModeWindow && !developerModeWindow.isDestroyed() ? developerModeWindow : null;
  }

  function syncDeveloperModeWindowBounds() {
    const panel = getDeveloperModeWindow();
    const mainWindow = getMainWindow();
    if (!panel || !mainWindow || mainWindow.isDestroyed() || syncingDeveloperModeBounds) return;

    syncingDeveloperModeBounds = true;
    try {
      const mainBounds = mainWindow.getBounds();
      const display = screen.getDisplayMatching(mainBounds);
      const workArea = display.workArea;
      const panelWidth = DEVELOPER_MODE_PANEL_WIDTH;
      const panelHeight = mainBounds.height;
      let mainX = mainBounds.x;
      let mainY = mainBounds.y;

      if (mainX + mainBounds.width + DEVELOPER_MODE_PANEL_GAP + panelWidth > workArea.x + workArea.width) {
        mainX = Math.max(workArea.x, workArea.x + workArea.width - mainBounds.width - panelWidth - DEVELOPER_MODE_PANEL_GAP);
      }
      if (mainY + panelHeight > workArea.y + workArea.height) {
        mainY = Math.max(workArea.y, workArea.y + workArea.height - panelHeight);
      }

      if (mainX !== mainBounds.x || mainY !== mainBounds.y) {
        mainWindow.setBounds({ x: mainX, y: mainY, width: mainBounds.width, height: mainBounds.height }, false);
      }

      if (typeof panel.setMinimumSize === 'function') panel.setMinimumSize(panelWidth, panelHeight);
      if (typeof panel.setMaximumSize === 'function') panel.setMaximumSize(panelWidth, panelHeight);
      panel.setBounds({
        x: mainX + mainBounds.width + DEVELOPER_MODE_PANEL_GAP,
        y: mainY,
        width: panelWidth,
        height: panelHeight,
      }, false);
    } finally {
      syncingDeveloperModeBounds = false;
    }
  }

  function closeDeveloperModeWindow() {
    const panel = getDeveloperModeWindow();
    if (panel) {
      allowDeveloperModeWindowClose = true;
      panel.close();
      allowDeveloperModeWindowClose = false;
    }
    developerModeWindow = null;
  }

  function openDeveloperModeWindow() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return null;

    if (developerModeWindow && !developerModeWindow.isDestroyed()) {
      syncDeveloperModeWindowBounds();
      developerModeWindow.show();
      return developerModeWindow;
    }

    const icon = createAppIconImage();
    developerModeWindow = new BrowserWindow({
      width: DEVELOPER_MODE_PANEL_WIDTH,
      height: mainWindow.getBounds().height,
      minWidth: DEVELOPER_MODE_PANEL_WIDTH,
      maxWidth: DEVELOPER_MODE_PANEL_WIDTH,
      minHeight: mainWindow.getBounds().height,
      maxHeight: mainWindow.getBounds().height,
      title: `${APP_NAME} 开发者模式`,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      movable: false,
      skipTaskbar: true,
      parent: mainWindow,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });

    developerModeWindow.setMenuBarVisibility(false);
    developerModeWindow.loadFile(path.join(__dirname, '../renderer/developer-mode-panel.html'));
    developerModeWindow.once('ready-to-show', () => {
      syncDeveloperModeWindowBounds();
      if (developerModeWindow && !developerModeWindow.isDestroyed()) developerModeWindow.show();
      sendToRenderer(IPC_EVENTS.DEV_MODE_PANEL_COMMAND, { action: 'request-state' });
    });
    developerModeWindow.on('closed', () => {
      developerModeWindow = null;
      const currentMainWindow = getMainWindow();
      if (currentMainWindow && !currentMainWindow.isDestroyed() && currentMainWindow.webContents && !currentMainWindow.webContents.isDestroyed()) {
        currentMainWindow.webContents.send(IPC_EVENTS.DEV_MODE_PANEL_COMMAND, { action: 'panel-closed' });
      }
    });
    developerModeWindow.on('close', (event) => {
      if (allowDeveloperModeWindowClose) return;
      event.preventDefault();
      sendToRenderer(IPC_EVENTS.DEV_MODE_PANEL_COMMAND, { action: 'request-state' });
    });
    return developerModeWindow;
  }

  function createWindow() {
    const savedScale = configStore.get('uiScale') || 100;
    const zoomFactor = Math.max(0.5, Math.min(3.0, savedScale / 100));

    const icon = createAppIconImage();
    const mainWindow = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 1180,
      minHeight: 700,
      show: false,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        zoomFactor,
      },
    });

    if (icon && typeof mainWindow.setIcon === 'function') {
      mainWindow.setIcon(icon);
    }

    setMainWindow(mainWindow);
    attachMainWindowShortcutPolicy(mainWindow);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    const revealIfNeeded = () => {
      const currentWindow = getMainWindow();
      if (isAutoStart || !currentWindow || currentWindow.isDestroyed()) return;
      if (currentWindow.isMinimized()) currentWindow.restore();
      currentWindow.show();
      currentWindow.focus();
    };

    mainWindow.once('ready-to-show', revealIfNeeded);
    mainWindow.webContents.on('did-finish-load', () => {
      if (process.env.NEKO_STARTUP_TRACE === '1') {
        console.log('[StartupTrace] main window did-finish-load');
      }
      pushInitialState();
      if (configStore.get('debugEnabled')) openDeveloperModeWindow();
    });

    if (!app.isPackaged) {
      mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        console.log(`[Renderer:${level}] ${message} (${sourceId}:${line})`);
      });
    }

    setTimeout(revealIfNeeded, 1800);

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[MainWindow] renderer process gone:', details?.reason || 'unknown');
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('[MainWindow] failed to load renderer:', errorCode, errorDescription);
    });

    mainWindow.on('closed', () => {
      if (process.env.NEKO_STARTUP_TRACE === '1') {
        console.log('[StartupTrace] main window closed');
      }
      closeDeveloperModeWindow();
      setMainWindow(null);
    });

    mainWindow.on('move', syncDeveloperModeWindowBounds);
    mainWindow.on('resize', syncDeveloperModeWindowBounds);
    mainWindow.on('restore', () => {
      if (configStore.get('debugEnabled')) openDeveloperModeWindow();
    });
    mainWindow.on('show', () => {
      if (configStore.get('debugEnabled')) openDeveloperModeWindow();
    });
    mainWindow.on('minimize', () => {
      const panel = getDeveloperModeWindow();
      if (panel) panel.hide();
    });
    mainWindow.on('hide', () => {
      const panel = getDeveloperModeWindow();
      if (panel) panel.hide();
    });

    mainWindow.on('close', (event) => {
      if (getIsQuitting()) return;

      const action = configStore.get('closeAction');
      if (action === 'exit') {
        setIsQuitting(true);
        return;
      }

      event.preventDefault();

      if (action === 'minimize') {
        mainWindow.hide();
        return;
      }

      const promptIconPath = getTrayIconPath();
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['最小化到托盘', '退出程序'],
        defaultId: 0,
        cancelId: 0,
        title: APP_NAME,
        message: '选择关闭行为',
        detail: '最小化到系统托盘继续后台运行，还是完全退出？',
        ...(promptIconPath ? { icon: promptIconPath } : {}),
      });

      if (choice === 0) {
        mainWindow.hide();
      } else {
        setIsQuitting(true);
        app.quit();
      }
    });

  }

  function showWindow() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      setTimeout(() => {
        const currentWindow = getMainWindow();
        if (currentWindow && !currentWindow.isDestroyed()) {
          if (currentWindow.isMinimized()) currentWindow.restore();
          currentWindow.show();
          currentWindow.focus();
        }
      }, 250);
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function refreshTrayMenu() {
    const tray = getTray();
    if (!tray) return;
    const running = statusService.isRunning;
    const activityEnabled = activityAgent?.isEnabled?.() === true;
    const activityStatus = activityAgent?.lastStatus || { state: 'disabled' };
    const activityPaused = activityStatus.state === 'paused' || activityStatus.paused === true;
    const template = [
      {
        label: running ? '停止上报服务' : '启动上报服务',
        click: () => {
          if (running) statusService.stop();
          else statusService.start();
          refreshTrayMenu();
        },
      },
    ];
    if (activityEnabled) {
      const connectionLabel = activityStatus.connection === 'online'
        ? '已连接'
        : activityStatus.connection === 'reconnecting' || activityStatus.state === 'reconnecting'
          ? '重连中'
          : '连接中';
      template.push(
        { type: 'separator' },
        { label: `活动提醒：${activityPaused ? '已暂停' : connectionLabel}`, enabled: false },
        {
          label: activityPaused ? '恢复活动功能' : '临时暂停活动功能',
          click: async () => {
            if (activityPaused) await activityAgent.resume();
            else await activityAgent.pause();
            refreshTrayMenu();
          },
        },
      );
    }
    template.push(
      { type: 'separator' },
      { label: '打开 Neko Status', click: () => showWindow() },
      { type: 'separator' },
    );
    if (activityEnabled && configStore.get('enableActivityBackground') === true) {
      template.push({ label: '退出客户端，后台继续', click: () => requestActivityQuit?.(false) });
      template.push({ label: '退出全部（本次）', click: () => requestActivityQuit?.(true) });
    } else {
      template.push({
        label: '退出',
        click: () => {
          if (requestActivityQuit) requestActivityQuit(true);
          else { setIsQuitting(true); app.quit(); }
        },
      });
    }
    const menu = Menu.buildFromTemplate(template);
    tray.setContextMenu(menu);
  }

  function createTray() {
    const icon = createAppIconImage() || nativeImage.createEmpty();

    const tray = new Tray(icon);
    setTray(tray);
    tray.setToolTip(APP_NAME);
    refreshTrayMenu();
    tray.on('click', () => showWindow());
  }

  function getVirtualScreenBounds() {
    const displays = screen.getAllDisplays();
    const left = Math.min(...displays.map((display) => display.bounds.x));
    const top = Math.min(...displays.map((display) => display.bounds.y));
    const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
    const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function normalizePickerWindows(windows) {
    const seen = new Set();
    return windows
      .filter((win) => win && win.processName && win.bounds && win.bounds.width > 40 && win.bounds.height > 40)
      .map((win) => ({
        title: String(win.title || win.processName),
        processName: String(win.processName),
        pid: Number(win.pid) || 0,
        path: String(win.path || ''),
        bounds: {
          x: Math.round(Number(win.bounds.x) || 0),
          y: Math.round(Number(win.bounds.y) || 0),
          width: Math.round(Number(win.bounds.width) || 0),
          height: Math.round(Number(win.bounds.height) || 0),
        },
      }))
      .filter((win) => {
        const key = `${win.processName.toLowerCase()}|${win.title.toLowerCase()}|${win.bounds.x},${win.bounds.y},${win.bounds.width},${win.bounds.height}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function getPickerThemeColor() {
    const color = String(configStore.get('seedColor') || '#0ea5e9').trim();
    return /^#[0-9a-f]{6}$/i.test(color) || /^rgb/i.test(color) ? color : '#0ea5e9';
  }

  function pickerColorToRgb(color) {
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      return {
        r: parseInt(color.slice(1, 3), 16),
        g: parseInt(color.slice(3, 5), 16),
        b: parseInt(color.slice(5, 7), 16),
      };
    }
    const nums = color.match(/\d+(\.\d+)?/g) || [];
    const [r, g, b] = nums.map(Number);
    return {
      r: Number.isFinite(r) ? r : 6,
      g: Number.isFinite(g) ? g : 182,
      b: Number.isFinite(b) ? b : 212,
    };
  }

  async function getPrivacyPickerWindows() {
    let windows = [];
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      });
      const handles = sources
        .map((source) => {
          const match = String(source.id || '').match(/^window:(\d+):/);
          return match ? Number(match[1]) : 0;
        })
        .filter(Boolean);
      const byHandle = await systemUtils.getWindowsByHandles(handles);
      const sourceNameByHandle = new Map();
      sources.forEach((source) => {
        const match = String(source.id || '').match(/^window:(\d+):/);
        if (match) sourceNameByHandle.set(Number(match[1]), source.name || '');
      });
      windows = byHandle.map((win) => ({
        ...win,
        title: win.title || sourceNameByHandle.get(win.handle) || win.processName,
      }));
    } catch {}

    if (windows.length === 0) {
      windows = await systemUtils.listVisibleWindows();
    }
    return normalizePickerWindows(windows);
  }

  function createPrivacyPickerHtml({ windows, bounds, token, themeColor, hintText }) {
    const rgb = pickerColorToRgb(themeColor);
    const payload = JSON.stringify({
      windows,
      bounds,
      token,
      themeColor,
      rgb,
      hintText: hintText || '移动鼠标点选要加入隐私规则的窗口，单击确认，Esc 取消',
    }).replace(/</g, '\\u003c');
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: rgba(0,0,0,0.10); cursor: crosshair; font-family: "Segoe UI", system-ui, sans-serif; user-select: none; }
    #frame { position: absolute; display: none; box-sizing: border-box; border: 3px solid ${themeColor}; background: rgba(${rgb.r},${rgb.g},${rgb.b},0.10); box-shadow: 0 0 0 9999px rgba(0,0,0,0.16), 0 0 24px rgba(${rgb.r},${rgb.g},${rgb.b},0.55); pointer-events: none; }
    #label { position: absolute; left: 0; top: -34px; max-width: min(520px, 100vw - 24px); padding: 7px 10px; border-radius: 7px; background: rgba(15,23,42,0.92); color: #fff; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #hint { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); padding: 9px 14px; border-radius: 8px; background: rgba(15,23,42,0.92); color: #fff; font-size: 13px; box-shadow: 0 10px 30px rgba(0,0,0,0.28); }
    #empty { display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 14px 18px; border-radius: 8px; background: rgba(15,23,42,0.92); color: #fff; font-size: 13px; }
  </style>
</head>
<body>
  <div id="hint"></div>
  <div id="empty">未找到可框选窗口</div>
  <div id="frame"><div id="label"></div></div>
  <script>
    const payload = ${payload};
    const windows = payload.windows
      .slice()
      .sort((a, b) => (a.bounds.width * a.bounds.height) - (b.bounds.width * b.bounds.height));
    const origin = payload.bounds;
    const frame = document.getElementById('frame');
    const label = document.getElementById('label');
    const empty = document.getElementById('empty');
    const hint = document.getElementById('hint');
    let selected = null;
    hint.textContent = payload.hintText;
    if (!windows.length) empty.style.display = 'block';
    function contains(win, x, y) {
      const b = win.bounds;
      return x >= b.x && y >= b.y && x <= b.x + b.width && y <= b.y + b.height;
    }
    function setSelected(win) {
      selected = win || null;
      if (!selected) {
        frame.style.display = 'none';
        return;
      }
      const b = selected.bounds;
      frame.style.display = 'block';
      frame.style.left = (b.x - origin.x) + 'px';
      frame.style.top = (b.y - origin.y) + 'px';
      frame.style.width = b.width + 'px';
      frame.style.height = b.height + 'px';
      label.textContent = selected.title + ' · ' + selected.processName;
    }
    function submitSelection(value) {
      window.nekoPrivacyPicker.submitSelection(payload.token, value || null);
    }
    window.addEventListener('mousemove', (event) => {
      const hit = windows.find((win) => contains(win, event.screenX, event.screenY));
      if (hit !== selected) setSelected(hit);
    });
    window.addEventListener('click', () => {
      if (selected) submitSelection(selected);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') submitSelection(null);
      if (event.key === 'Enter' && selected) submitSelection(selected);
    });
  </script>
</body>
</html>`;
  }

  async function pickPrivacyWindow(options = {}) {
    const currentPicker = getPrivacyPickerWindow();
    if (currentPicker && !currentPicker.isDestroyed()) return null;

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const windows = await getPrivacyPickerWindows();
    const bounds = getVirtualScreenBounds();
    const themeColor = getPickerThemeColor();
    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return new Promise((resolve) => {
      let settled = false;
      const cleanup = (value) => {
        if (settled) return;
        settled = true;
        ipcMain.removeAllListeners(`privacy-picker-result-${token}`);
        const picker = getPrivacyPickerWindow();
        if (picker && !picker.isDestroyed()) picker.destroy();
        setPrivacyPickerWindow(null);
        showWindow();
        resolve(value || null);
      };

      const pickerWindow = new BrowserWindow({
        ...bounds,
        frame: false,
        transparent: true,
        show: false,
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        fullscreenable: false,
        hasShadow: false,
        webPreferences: {
          preload: path.join(__dirname, '../preload/privacy-picker.js'),
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      setPrivacyPickerWindow(pickerWindow);
      pickerWindow.setAlwaysOnTop(true, 'screen-saver');
      pickerWindow.setMenuBarVisibility(false);
      pickerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createPrivacyPickerHtml({
        windows,
        bounds,
        token,
        themeColor,
        hintText: options.hintText,
      }))}`);
      pickerWindow.once('ready-to-show', () => {
        pickerWindow.show();
        pickerWindow.focus();
      });
      pickerWindow.on('closed', () => cleanup(null));
      ipcMain.once(`privacy-picker-result-${token}`, (_event, value) => cleanup(value));
    });
  }

  return {
    createWindow,
    showWindow,
    createTray,
    refreshTrayMenu,
    sendToRenderer,
    pushInitialState,
    getTrayIconPath,
    createAppIconImage,
    pickPrivacyWindow,
    getDeveloperModeWindow,
    openDeveloperModeWindow,
    closeDeveloperModeWindow,
    syncDeveloperModeWindowBounds,
  };
}

module.exports = {
  createAppShell,
};

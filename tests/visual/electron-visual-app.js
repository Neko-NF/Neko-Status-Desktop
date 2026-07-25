const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_HTML = path.join(ROOT, 'src', 'renderer', 'index.html');
const PRELOAD = path.join(__dirname, 'visual-preload.js');
const BASELINE_DIR = path.join(__dirname, 'baselines', process.platform);
const ARTIFACT_DIR = path.join(__dirname, 'artifacts');
const UPDATE = process.argv.includes('--update');
const CI_SMOKE = process.argv.includes('--ci-smoke');
const PIXEL_THRESHOLD = 24;
const MAX_PIXEL_DIFF_RATIO = 0.01;
const WAIT_LIMIT_MS = 15000;

const PAGE_CASES = [
  ['mainDashboardArea', 'dashboard'],
  ['consoleArea', 'console'],
  ['page-device-status', 'device-status'],
  ['page-screenshot', 'screenshot'],
  ['page-services', 'services'],
  ['page-activity', 'activity'],
  ['page-stream', 'stream'],
  ['page-update', 'update'],
  ['page-settings', 'settings'],
  ['page-about', 'about'],
  ['page-announcement', 'announcement'],
  ['page-ui-lab', 'ui-lab'],
];

const VIEWPORTS = CI_SMOKE
  ? [
    { width: 1180, height: 700 },
    { width: 1280, height: 840 },
  ]
  : [
    { width: 1180, height: 700 },
    { width: 1280, height: 840 },
    { width: 1600, height: 900 },
  ];

const report = {
  updated: UPDATE,
  smoke: CI_SMOKE,
  assertions: 0,
  screenshots: 0,
  failures: [],
  artifacts: [],
};

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('hide-scrollbars', 'false');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertVisual(condition, message, details = null) {
  report.assertions += 1;
  if (condition) return;
  report.failures.push(details ? `${message}: ${JSON.stringify(details)}` : message);
}

async function emulateMediaFeatures(win, theme, reducedMotion) {
  const features = [
    { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
    { name: 'prefers-color-scheme', value: theme },
  ];
  if (typeof win.webContents.emulateMediaFeatures === 'function') {
    await win.webContents.emulateMediaFeatures(features);
    return;
  }

  const debuggerApi = win.webContents.debugger;
  if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
  await debuggerApi.sendCommand('Emulation.setEmulatedMedia', {
    media: 'screen',
    features,
  });
}

function destroyHarnessWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    if (win.webContents?.debugger?.isAttached?.()) win.webContents.debugger.detach();
  } catch (_) {
    // The renderer may already have gone away during a failed visual case.
  }
  win.destroy();
}

function cleanArtifacts() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  for (const entry of fs.readdirSync(ARTIFACT_DIR)) {
    if (entry === '.gitignore') continue;
    fs.rmSync(path.join(ARTIFACT_DIR, entry), { recursive: true, force: true });
  }
  if (UPDATE) fs.mkdirSync(BASELINE_DIR, { recursive: true });
}

async function waitFor(win, expression, label, timeoutMs = WAIT_LIMIT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await win.webContents.executeJavaScript(expression, true)) return;
    } catch (_) {
      // A navigation can briefly invalidate the execution context.
    }
    await sleep(40);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function initPayload(theme, profile = 'classic') {
  return {
    version: '1.4.1',
    deviceName: 'Visual Test Device',
    platform: 'win32',
    isRunning: true,
    isAutoStart: true,
    isAdmin: true,
    startupPage: 'mainDashboardArea',
    config: {
      authUser: { id: 1001, username: 'Visual Admin', nickname: 'Visual Admin', role: 'admin', isAdmin: true },
      restoreLastState: false,
      lastPage: 'mainDashboardArea',
      themeMode: theme,
      seedColor: '#0ea5e9',
      customSeedColor: '#0ea5e9',
      uiScale: 100,
      uiFont: '',
      glassEffect: true,
      debugEnabled: false,
      enableExperimentalFeatures: true,
      enableExperimentalActivityEntry: true,
      enableExperimentalStreamEntry: true,
      enableActivityPublishing: true,
      enableActivityBackground: true,
      enableExperimentalUiLabEntry: true,
      enableExperimentalCurveLoaders: false,
      loadingCurveStyle: 'auto',
      uiAppearanceProfile: profile,
      serverUrl: 'https://visual.invalid',
      deviceKey: 'visual-device-key',
    },
  };
}

async function createHarnessWindow({ width, height, theme, profile = 'classic', reducedMotion = false, zoom = 1 }) {
  const rendererErrors = [];
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    focusable: false,
    width,
    height,
    useContentSize: true,
    backgroundColor: theme === 'light' ? '#f4f7fb' : '#0b1120',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
      spellcheck: false,
    },
  });

  win.webContents.on('console-message', (_event, details) => {
    const level = typeof details === 'object' ? details.level : Number(details);
    const message = typeof details === 'object' ? details.message : String(details || '');
    const line = typeof details === 'object' ? details.lineNumber : 0;
    const sourceId = typeof details === 'object' ? details.sourceId : 'renderer';
    if (level >= 3 && !/Autofill|DevTools/.test(message)) {
      rendererErrors.push(`${message} (${sourceId}:${line})`);
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    rendererErrors.push(`renderer process gone: ${details?.reason || 'unknown'}`);
  });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    rendererErrors.push(`load failed ${code}: ${description}`);
  });

  await win.loadFile(INDEX_HTML);
  await emulateMediaFeatures(win, theme, reducedMotion);
  await waitFor(
    win,
    "document.readyState === 'complete' && document.documentElement.dataset.appRuntimeBound === '1' && !!window.__nekoVisual",
    'renderer runtime',
  );

  await win.webContents.insertCSS(`
    html.visual-test-mode *, html.visual-test-mode *::before, html.visual-test-mode *::after {
      caret-color: transparent !important;
    }
  `);

  const payload = JSON.stringify(initPayload(theme, profile));
  await win.webContents.executeJavaScript(`
    (async () => {
      const NativeDate = Date;
      const fixedNow = Date.parse('2026-01-15T08:00:00.000Z');
      class VisualDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [fixedNow])); }
        static now() { return fixedNow; }
      }
      VisualDate.parse = NativeDate.parse;
      VisualDate.UTC = NativeDate.UTC;
      window.Date = VisualDate;
      document.documentElement.classList.add('visual-test-mode');
      localStorage.setItem('neko-theme-mode', ${JSON.stringify(theme)});
      localStorage.setItem('neko-ui-appearance-profile', ${JSON.stringify(profile)});
      localStorage.removeItem('announcement_use_mock');
      document.querySelectorAll('.conditional-nav, .console-nav').forEach((item) => {
        item.classList.add('show');
        item.setAttribute('aria-hidden', 'false');
        item.removeAttribute('tabindex');
      });
      window.__nekoVisual.setScenario('default');
      await window.__nekoVisual.emit('app:init', ${payload});
      await new Promise((resolve) => setTimeout(resolve, 120));
      document.querySelectorAll('.conditional-nav, .console-nav').forEach((item) => {
        item.classList.add('show');
        item.setAttribute('aria-hidden', 'false');
        item.removeAttribute('tabindex');
      });
      window._nekoModules?.theme?.applyThemeMode?.(${JSON.stringify(theme)});
      window._nekoModules?.theme?.applyThemeColor?.('#0ea5e9', {
        persistSeed: false,
        persistCustom: false,
        emitEvent: false,
      });
      window._nekoModules?.router?.navigateTo?.('mainDashboardArea');
      return true;
    })()
  `, true);

  // A fully hidden BrowserWindow can retain the previous compositor frame on
  // Windows. Keep it off-screen and out of the taskbar while allowing Chromium
  // to submit frames continuously; the window never takes focus.
  win.setPosition(-10000, -10000, false);
  win.showInactive();
  win.webContents.setZoomFactor(zoom);
  await sleep(320);
  return { win, rendererErrors };
}

async function preparePage(win, pageId, scenario = 'default') {
  const activityScenario = pageId === 'page-activity' && scenario === 'default' ? 'activity-healthy' : scenario;
  const announcementScenario = pageId === 'page-announcement' && scenario === 'default' ? 'announcement-default' : activityScenario;
  await win.webContents.executeJavaScript(`
    (async () => {
      window.__nekoVisual.setScenario(${JSON.stringify(announcementScenario)});
      window._nekoModules?.router?.navigateTo?.(${JSON.stringify(pageId)});
      if (${JSON.stringify(pageId)} === 'page-activity') {
        await window._nekoModules?.pages?.ActivityPage?.refresh?.(true);
        if (${JSON.stringify(scenario)} === 'activity-share-long') {
          document.getElementById('activityTabShare')?.click();
        } else if (${JSON.stringify(scenario)} === 'activity-people-long') {
          document.getElementById('activityTabPeople')?.click();
        }
      }
      if (${JSON.stringify(pageId)} === 'page-announcement') {
        await window._nekoModules?.pages?.AnnouncementPage?.loadAnnouncements?.();
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })()
  `, true);
  win.webContents.invalidate?.();
  await sleep(300);
}

async function collectPageMetrics(win, pageId) {
  return win.webContents.executeJavaScript(`
    (() => {
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const roundedRect = (element) => {
        const rect = element?.getBoundingClientRect?.();
        return rect ? {
          left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: rect.width, height: rect.height,
        } : null;
      };
      const root = document.documentElement;
      const body = document.body;
      const content = document.querySelector('.content');
      const page = document.getElementById(${JSON.stringify(pageId)});
      const topbar = document.querySelector('.topbar');
      const iconButtons = Array.from(page?.querySelectorAll?.('button') || []).filter((button) => {
        if (!visible(button)) return false;
        const hasIcon = !!button.querySelector('.ph, .tb');
        const text = (button.innerText || '').replace(/\\s+/g, ' ').trim();
        return hasIcon && text === '';
      }).map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          id: button.id || button.className,
          name: button.getAttribute('aria-label') || button.getAttribute('title') || '',
          width: rect.width,
          height: rect.height,
        };
      });
      const activityCards = ${JSON.stringify(pageId)} === 'page-activity'
        ? Array.from(page.querySelectorAll('.activity-section-panel:not([hidden]) > .activity-card')).filter(visible).map(roundedRect)
        : [];
      return {
        currentPage: window._nekoModules?.router?.getCurrentPage?.() || '',
        targetPage: page?.id || '',
        pageVisible: visible(page),
        viewport: { width: root.clientWidth, height: root.clientHeight },
        overflow: {
          document: Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth,
          content: content ? content.scrollWidth - content.clientWidth : 0,
          page: page ? page.scrollWidth - page.clientWidth : 0,
        },
        page: roundedRect(page),
        content: roundedRect(content),
        topbar: roundedRect(topbar),
        crashOverlay: !!document.getElementById('rendererCrashOverlay'),
        iconButtons,
        activityCards,
      };
    })()
  `, true);
}

function assertPageMetrics(metrics, label) {
  assertVisual(metrics.pageVisible, `${label} target page is visible`, { currentPage: metrics.currentPage });
  assertVisual(metrics.currentPage === metrics.targetPage, `${label} router points at the captured page`, {
    currentPage: metrics.currentPage,
    targetPage: metrics.targetPage,
  });
  assertVisual(!metrics.crashOverlay, `${label} rendered without the crash overlay`);
  assertVisual(metrics.overflow.document <= 1, `${label} has no document horizontal overflow`, metrics.overflow);
  assertVisual(metrics.overflow.content <= 1, `${label} has no content horizontal overflow`, metrics.overflow);
  assertVisual(metrics.overflow.page <= 1, `${label} has no page horizontal overflow`, metrics.overflow);
  if (metrics.page && metrics.topbar) {
    assertVisual(metrics.page.top >= metrics.topbar.bottom - 1, `${label} is not covered by the top bar`, {
      pageTop: metrics.page.top,
      topbarBottom: metrics.topbar.bottom,
    });
  }
  metrics.iconButtons.forEach((button) => {
    assertVisual(!!button.name, `${label} icon-only control has an accessible name`, button);
    assertVisual(button.width >= 35.5 && button.height >= 35.5, `${label} icon-only control has a 36x36 target`, button);
  });
  if (metrics.activityCards.length > 1) {
    const lefts = metrics.activityCards.map((card) => card.left);
    const rights = metrics.activityCards.map((card) => card.right);
    assertVisual(Math.max(...lefts) - Math.min(...lefts) <= 1, `${label} activity cards align on the left edge`, lefts);
    assertVisual(Math.max(...rights) - Math.min(...rights) <= 1, `${label} activity cards align on the right edge`, rights);
  }
}

function compareImages(actual, expected) {
  const actualSize = actual.getSize();
  const expectedSize = expected.getSize();
  if (actualSize.width !== expectedSize.width || actualSize.height !== expectedSize.height) {
    return { ratio: 1, changed: actualSize.width * actualSize.height, total: actualSize.width * actualSize.height, diff: actual };
  }

  const actualPixels = actual.toBitmap();
  const expectedPixels = expected.toBitmap();
  const diffPixels = Buffer.alloc(actualPixels.length);
  let changed = 0;
  const total = actualSize.width * actualSize.height;

  for (let offset = 0; offset < actualPixels.length; offset += 4) {
    const db = Math.abs(actualPixels[offset] - expectedPixels[offset]);
    const dg = Math.abs(actualPixels[offset + 1] - expectedPixels[offset + 1]);
    const dr = Math.abs(actualPixels[offset + 2] - expectedPixels[offset + 2]);
    const da = Math.abs(actualPixels[offset + 3] - expectedPixels[offset + 3]);
    if (Math.max(db, dg, dr, da) > PIXEL_THRESHOLD) {
      changed += 1;
      diffPixels[offset] = 32;
      diffPixels[offset + 1] = 32;
      diffPixels[offset + 2] = 240;
      diffPixels[offset + 3] = 255;
    } else {
      const gray = Math.round((actualPixels[offset] + actualPixels[offset + 1] + actualPixels[offset + 2]) / 3);
      diffPixels[offset] = gray;
      diffPixels[offset + 1] = gray;
      diffPixels[offset + 2] = gray;
      diffPixels[offset + 3] = 90;
    }
  }

  return {
    ratio: total ? changed / total : 0,
    changed,
    total,
    diff: nativeImage.createFromBitmap(diffPixels, { width: actualSize.width, height: actualSize.height, scaleFactor: 1 }),
  };
}

function pixelMatches(image, x, y, { r, g, b }, tolerance = 12) {
  const size = image.getSize();
  if (x < 0 || y < 0 || x >= size.width || y >= size.height) return false;
  const bitmap = image.toBitmap();
  const offset = (Math.floor(y) * size.width + Math.floor(x)) * 4;
  return Math.abs(bitmap[offset] - b) <= tolerance
    && Math.abs(bitmap[offset + 1] - g) <= tolerance
    && Math.abs(bitmap[offset + 2] - r) <= tolerance;
}

async function captureCurrentFrame(win, name) {
  const marker = await win.webContents.executeJavaScript(`
    (() => {
      document.getElementById('__nekoVisualFrameMarker')?.remove();
      const element = document.createElement('div');
      element.id = '__nekoVisualFrameMarker';
      element.setAttribute('aria-hidden', 'true');
      element.style.cssText = [
        'position:fixed', 'right:6px', 'bottom:6px', 'width:12px', 'height:12px',
        'z-index:2147483647', 'background:rgb(255,0,255)', 'pointer-events:none',
        'box-shadow:none', 'border:0', 'border-radius:0', 'opacity:1',
      ].join(';');
      document.body.appendChild(element);
      const rect = element.getBoundingClientRect();
      return { x: Math.floor(rect.left + rect.width / 2), y: Math.floor(rect.top + rect.height / 2) };
    })()
  `, true);

  let image = null;
  let markerPainted = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    win.webContents.invalidate?.();
    await sleep(35);
    image = await win.webContents.capturePage();
    if (pixelMatches(image, marker.x, marker.y, { r: 255, g: 0, b: 255 })) {
      markerPainted = true;
      break;
    }
  }
  assertVisual(markerPainted, `${name} compositor accepted the current DOM frame`);

  await win.webContents.executeJavaScript(`document.getElementById('__nekoVisualFrameMarker')?.remove()`, true);
  let markerCleared = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    win.webContents.invalidate?.();
    await sleep(35);
    image = await win.webContents.capturePage();
    if (!pixelMatches(image, marker.x, marker.y, { r: 255, g: 0, b: 255 })) {
      markerCleared = true;
      break;
    }
  }
  assertVisual(markerCleared, `${name} compositor cleared the frame marker`);
  return image;
}

async function captureBaseline(win, name) {
  const image = await captureCurrentFrame(win, name);
  report.screenshots += 1;
  const baselinePath = path.join(BASELINE_DIR, `${name}.png`);
  if (UPDATE) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, image.toPNG());
    return;
  }

  if (!fs.existsSync(baselinePath)) {
    const actualPath = path.join(ARTIFACT_DIR, `${name}.actual.png`);
    fs.writeFileSync(actualPath, image.toPNG());
    report.artifacts.push(path.relative(ROOT, actualPath));
    assertVisual(false, `${name} baseline exists`, { baselinePath: path.relative(ROOT, baselinePath) });
    return;
  }

  const expected = nativeImage.createFromPath(baselinePath);
  const comparison = compareImages(image, expected);
  assertVisual(comparison.ratio <= MAX_PIXEL_DIFF_RATIO, `${name} pixel diff is at most 1%`, {
    ratio: Number(comparison.ratio.toFixed(6)),
    changed: comparison.changed,
    total: comparison.total,
  });
  if (comparison.ratio > MAX_PIXEL_DIFF_RATIO) {
    const actualPath = path.join(ARTIFACT_DIR, `${name}.actual.png`);
    const diffPath = path.join(ARTIFACT_DIR, `${name}.diff.png`);
    fs.writeFileSync(actualPath, image.toPNG());
    fs.writeFileSync(diffPath, comparison.diff.toPNG());
    report.artifacts.push(path.relative(ROOT, actualPath), path.relative(ROOT, diffPath));
  }
}

async function checkBusyGeometry(win, buttonId, label) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const button = document.getElementById(${JSON.stringify(buttonId)});
      const helper = window._nekoUIHelpers?.setButtonBusy;
      if (!button || !helper) return { skipped: true };
      const rect = () => {
        const value = button.getBoundingClientRect();
        return { width: value.width, height: value.height, left: value.left, top: value.top };
      };
      const before = rect();
      helper(button, true, { label: '刷新中' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const busy = rect();
      helper(button, false);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const after = rect();
      return { before, busy, after };
    })()
  `, true);
  assertVisual(!result.skipped, `${label} busy helper is available`);
  if (result.skipped) return;
  const drift = (a, b) => Math.max(
    Math.abs(a.width - b.width), Math.abs(a.height - b.height),
  );
  assertVisual(drift(result.before, result.busy) <= 1, `${label} busy geometry drift is at most 1px`, result);
  assertVisual(drift(result.before, result.after) <= 1, `${label} restored geometry drift is at most 1px`, result);
}

async function checkAnnouncementRefreshStability(win, scenario = 'announcement-refresh') {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const page = window._nekoModules?.pages?.AnnouncementPage;
      const board = document.querySelector('.announcement-board');
      const list = document.getElementById('announcementList');
      const button = document.getElementById('announcementRefreshBtn');
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { width: value.width, height: value.height, left: value.left, top: value.top };
      };
      const before = { board: rect(board), list: rect(list), button: rect(button) };
      let cls = 0;
      let observer = null;
      if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) {
        observer = new PerformanceObserver((entryList) => {
          entryList.getEntries().forEach((entry) => {
            if (!entry.hadRecentInput) cls += entry.value;
          });
        });
        observer.observe({ type: 'layout-shift', buffered: false });
      }
      window.__nekoVisual.setScenario(${JSON.stringify(scenario)});
      await page.loadAnnouncements({ manual: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      observer?.disconnect();
      const after = { board: rect(board), list: rect(list), button: rect(button) };
      return { before, after, cls };
    })()
  `, true);
  const drift = (a, b) => Math.max(
    Math.abs(a.width - b.width), Math.abs(a.height - b.height),
  );
  assertVisual(result.cls < 0.01, `${scenario} CLS is below 0.01`, result);
  assertVisual(drift(result.before.board, result.after.board) <= 1, `${scenario} board geometry drift is at most 1px`, result);
  assertVisual(drift(result.before.button, result.after.button) <= 1, `${scenario} button geometry drift is at most 1px`, result);
}

async function checkAnnouncementStatePreservation(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const page = window._nekoModules?.pages?.AnnouncementPage;
      window.__nekoVisual.setScenario('announcement-long');
      await page.loadAnnouncements();
      const list = document.getElementById('announcementList');
      const cards = Array.from(list.querySelectorAll('[data-announcement-id]'));
      const selectedButton = cards[2]?.querySelector('[data-announcement-select]');
      selectedButton?.click();
      selectedButton?.focus({ preventScroll: true });
      list.scrollTop = Math.min(180, Math.max(0, list.scrollHeight - list.clientHeight));
      const before = {
        selected: list.querySelector('.announcement-card.selected')?.dataset.announcementId || '',
        focused: document.activeElement?.closest?.('[data-announcement-id]')?.dataset.announcementId || '',
        scrollTop: list.scrollTop,
      };
      await page.loadAnnouncements({ manual: true });
      const after = {
        selected: list.querySelector('.announcement-card.selected')?.dataset.announcementId || '',
        focused: document.activeElement?.closest?.('[data-announcement-id]')?.dataset.announcementId || '',
        scrollTop: list.scrollTop,
      };
      return { before, after };
    })()
  `, true);
  assertVisual(result.after.selected === result.before.selected, 'announcement refresh preserves selectedId', result);
  assertVisual(result.after.focused === result.before.focused, 'announcement refresh preserves card focus', result);
  assertVisual(Math.abs(result.after.scrollTop - result.before.scrollTop) <= 1, 'announcement refresh preserves list scrollTop', result);
}

async function checkActivityStatePreservation(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const page = window._nekoModules?.pages?.ActivityPage;
      const root = document.getElementById('activityFollowsList');
      const card = root?.querySelector?.('[data-activity-key]');
      const input = card?.querySelector?.('[data-field="app-key"]');
      if (!page?.refresh || !root || !card || !input) return { skipped: true };
      input.value = 'FocusPreserved.exe';
      input.focus({ preventScroll: true });
      window.__nekoVisual.setScenario('activity-healthy');
      await page.refresh(true, { forceBusiness: true });
      const nextCard = root.querySelector('[data-activity-key]');
      const nextInput = nextCard?.querySelector?.('[data-field="app-key"]');
      return {
        sameCard: nextCard === card,
        sameInput: nextInput === input,
        focused: document.activeElement === nextInput,
        value: nextInput?.value || '',
      };
    })()
  `, true);
  assertVisual(!result.skipped, 'activity keyed list exposes an editable rule row', result);
  if (result.skipped) return;
  assertVisual(result.sameCard && result.sameInput, 'activity refresh reuses stable keyed controls', result);
  assertVisual(result.focused, 'activity refresh preserves focused control', result);
  assertVisual(result.value === 'FocusPreserved.exe', 'activity refresh preserves typed input', result);
}

async function checkActivityListBoundaries(win) {
  const cases = [
    ['activity-long', 'activityFollowsList', 'activityFollowsCount'],
    ['activity-share-long', 'activityAppsList', 'activityAppsCount'],
    ['activity-people-long', 'activityFollowersList', 'activityFollowersCount'],
    ['activity-people-long', 'activityBlocksList', 'activityBlocksCount'],
  ];
  for (const [scenario, listId, countId] of cases) {
    await preparePage(win, 'page-activity', scenario);
    const result = await win.webContents.executeJavaScript(`
      (() => {
        const list = document.getElementById(${JSON.stringify(listId)});
        const count = document.getElementById(${JSON.stringify(countId)});
        const card = list?.closest?.('.activity-card');
        const grid = card?.parentElement;
        const sibling = grid?.classList?.contains('activity-grid')
          ? Array.from(grid.children).find((item) => item !== card)
          : null;
        const rect = (element) => element?.getBoundingClientRect?.().toJSON?.() || null;
        return {
          list: rect(list),
          card: rect(card),
          sibling: rect(sibling),
          scrollable: !!list && list.scrollHeight > list.clientHeight,
          overflowY: list ? getComputedStyle(list).overflowY : '',
          horizontalOverflow: list ? list.scrollWidth - list.clientWidth : 0,
          count: count?.textContent || '',
          itemCount: list?.querySelectorAll?.('[data-activity-key]')?.length || 0,
        };
      })()
    `, true);
    assertVisual(result.scrollable && result.overflowY === 'auto', `${scenario} ${listId} uses an internal scroll viewport`, result);
    assertVisual(result.horizontalOverflow <= 1, `${scenario} ${listId} has no horizontal overflow`, result);
    assertVisual(Number(result.count) === result.itemCount, `${scenario} ${listId} count matches rendered items`, result);
    if (result.sibling) {
      assertVisual(Math.abs(result.card.top - result.sibling.top) <= 1, `${scenario} cards stay top aligned`, result);
      if (scenario === 'activity-share-long') {
        assertVisual(result.card.height !== result.sibling.height, `${scenario} neighboring card does not stretch to list height`, result);
      }
    }
  }
}

async function assertQuietProfile(win, theme, pageId) {
  const result = await win.webContents.executeJavaScript(`
    (() => {
      const chart = window._nekoModules?.pages?.DashboardPage?._trendChart;
      const card = document.querySelector(${JSON.stringify(`#${pageId} .glass-card, #${pageId}.glass-card`)})
        || document.querySelector('.glass-card');
      const cardStyle = card ? getComputedStyle(card) : null;
      return {
        profile: document.documentElement.dataset.uiProfile,
        cardRadius: cardStyle ? parseFloat(cardStyle.borderRadius) : null,
        cardBackdrop: cardStyle?.backdropFilter || cardStyle?.webkitBackdropFilter || '',
        chartExists: !!chart,
        sameNoGrid: !chart || (chart.options.scales.x.grid.display === false && chart.options.scales.y.grid.display === false),
        cpuWidth: chart?.data?.datasets?.[0]?.borderWidth,
        memoryDash: chart?.data?.datasets?.[1]?.borderDash || [],
      };
    })()
  `, true);
  assertVisual(result.profile === 'quiet', `${pageId} ${theme} applies quiet profile`, result);
  assertVisual(result.cardRadius === null || result.cardRadius <= 8.1, `${pageId} ${theme} quiet cards use 8px radius`, result);
  assertVisual(!result.cardBackdrop || result.cardBackdrop === 'none', `${pageId} ${theme} quiet cards disable backdrop blur`, result);
  assertVisual(result.sameNoGrid, `${pageId} ${theme} trend chart has no grid lines`, result);
  if (result.chartExists) {
    assertVisual(result.cpuWidth === 2, `${pageId} ${theme} CPU trend uses a 2px line`, result);
    assertVisual(JSON.stringify(result.memoryDash) === '[6,4]', `${pageId} ${theme} memory trend uses a dashed line`, result);
  }
}

async function checkRouterScrollIsolation(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const router = window._nekoModules?.router;
      const content = document.querySelector('.content');
      const addSpacer = (pageId) => {
        const page = document.getElementById(pageId);
        let spacer = page.querySelector('[data-visual-scroll-spacer]');
        if (!spacer) {
          spacer = document.createElement('div');
          spacer.dataset.visualScrollSpacer = 'true';
          spacer.style.height = '1600px';
          spacer.style.pointerEvents = 'none';
          page.appendChild(spacer);
        }
        return spacer;
      };
      router.navigateTo('page-activity');
      addSpacer('page-activity');
      content.scrollTop = 310;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const activityBefore = content.scrollTop;
      router.navigateTo('page-about');
      const firstAbout = content.scrollTop;
      addSpacer('page-about');
      content.scrollTop = 125;
      router.navigateTo('page-activity');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const activityAfter = content.scrollTop;
      router.navigateTo('page-about');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const aboutAfter = content.scrollTop;
      document.querySelectorAll('[data-visual-scroll-spacer]').forEach((node) => node.remove());
      content.scrollTop = 0;
      return { activityBefore, activityAfter, firstAbout, aboutAfter };
    })()
  `, true);
  assertVisual(result.firstAbout <= 1, 'first route visit starts at the top', result);
  assertVisual(Math.abs(result.activityAfter - result.activityBefore) <= 1, 'activity route restores its own scroll position', result);
  assertVisual(Math.abs(result.aboutAfter - 125) <= 1, 'about route restores its own scroll position', result);
}

async function checkExpandableMotion(win, reducedMotion) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const setter = window._nekoModules?.expandableSection?.setExpandableSectionState
        || window._nekoUIHelpers?.setExpandableSectionState;
      if (!setter) return { skipped: true };
      const trigger = document.createElement('button');
      trigger.type = 'button';
      const panel = document.createElement('div');
      panel.className = 'ui-expandable';
      panel.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;';
      panel.innerHTML = '<div class="ui-expandable-track"><div class="ui-expandable-content" style="height:144px;padding:12px"><div style="height:120px"></div></div></div>';
      document.body.append(trigger, panel);
      // Start expanded so the first sampled transition does not depend on a
      // hidden-window rAF wake-up. The same API is then exercised in both
      // directions and under a rapid reversal.
      setter(panel, true, { trigger, initial: true });
      const sample = () => panel.getBoundingClientRect().height;
      const samples = [{ at: 0, height: sample() }];
      setter(panel, false, { trigger });
      for (const at of [40, 80, 120, 160, 200, 240, 280, 320]) {
        const previousAt = samples[samples.length - 1].at;
        await new Promise((resolve) => setTimeout(resolve, at - previousAt));
        samples.push({ at, height: sample() });
      }
      const collapsedHeight = sample();
      const collapsedHidden = panel.hidden;
      setter(panel, true, { trigger, initial: true });
      setter(panel, false, { trigger });
      await new Promise((resolve) => setTimeout(resolve, 60));
      const reversingHeight = sample();
      setter(panel, true, { trigger });
      await new Promise((resolve) => setTimeout(resolve, 40));
      setter(panel, false, { trigger });
      await new Promise((resolve) => setTimeout(resolve, ${reducedMotion ? 60 : 380}));
      const finalHeight = sample();
      const response = {
        samples,
        expandedHeight: samples[0].height,
        collapsedHeight,
        collapsedHidden,
        reversingHeight,
        finalHeight,
        ariaExpanded: trigger.getAttribute('aria-expanded'),
        ariaHidden: panel.getAttribute('aria-hidden'),
        hidden: panel.hidden,
        debug: {
          panelStyle: getComputedStyle(panel).cssText,
          panelDisplay: getComputedStyle(panel).display,
          panelRows: getComputedStyle(panel).gridTemplateRows,
          panelClass: panel.className,
          trackRect: panel.querySelector('.ui-expandable-track')?.getBoundingClientRect?.().toJSON?.(),
          contentRect: panel.querySelector('.ui-expandable-content')?.getBoundingClientRect?.().toJSON?.(),
        },
      };
      trigger.remove();
      panel.remove();
      return response;
    })()
  `, true);
  assertVisual(!result.skipped, 'expandable component is available');
  if (result.skipped) return;
  const heights = result.samples.map((item) => item.height);
  const monotonic = heights.every((height, index) => index === 0 || height <= heights[index - 1] + 1);
  assertVisual(monotonic, 'expandable height collapses monotonically', result.samples);
  assertVisual(result.collapsedHidden, 'expandable normal collapse applies hidden state', result);
  assertVisual(result.finalHeight <= 1, 'expandable rapid reversal ends collapsed', result);
  assertVisual(result.ariaExpanded === 'false' && result.ariaHidden === 'true' && result.hidden, 'expandable ARIA and hidden state stay synchronized', result);
  if (reducedMotion) {
    assertVisual(result.collapsedHeight <= 1, 'reduced motion collapse completes without interpolation', result.samples);
    return;
  }
  const settled = result.samples.find((item) => item.at >= 180 && item.height <= 1);
  assertVisual(!!settled && settled.at >= 180 && settled.at <= 280, 'expandable duration stays between 180ms and 280ms', {
    settledAt: settled?.at,
    samples: result.samples,
  });
}

async function captureCriticalStates(win, theme) {
  await preparePage(win, 'page-activity', 'activity-healthy');
  await captureBaseline(win, `activity-healthy-${theme}`);

  await preparePage(win, 'page-activity', 'activity-error');
  await captureBaseline(win, `activity-error-${theme}`);

  await preparePage(win, 'page-activity', 'activity-long');
  await captureBaseline(win, `activity-long-${theme}`);

  await preparePage(win, 'page-activity', 'activity-share-long');
  await captureBaseline(win, `activity-share-long-${theme}`);

  await preparePage(win, 'page-activity', 'activity-people-long');
  await captureBaseline(win, `activity-people-long-${theme}`);

  await win.webContents.executeJavaScript(`
    (() => {
      const page = window._nekoModules?.pages?.AnnouncementPage;
      page._hasLoadedManagement = false;
      page._items = [];
      page._selectedId = '';
      window.__nekoVisual.setScenario('announcement-cold');
      window._nekoModules?.router?.navigateTo?.('page-announcement');
      page.loadAnnouncements();
    })()
  `, true);
  await sleep(70);
  await captureBaseline(win, `announcement-cold-${theme}`);
  await sleep(300);

  await preparePage(win, 'page-announcement', 'announcement-empty');
  await captureBaseline(win, `announcement-empty-${theme}`);

  await win.webContents.executeJavaScript(`
    (async () => {
      const page = window._nekoModules?.pages?.AnnouncementPage;
      page._hasLoadedManagement = false;
      page._items = [];
      page._selectedId = '';
      window.__nekoVisual.setScenario('announcement-error');
      await page.loadAnnouncements();
    })()
  `, true);
  await sleep(260);
  await captureBaseline(win, `announcement-error-${theme}`);

  await preparePage(win, 'page-announcement', 'announcement-long');
  await captureBaseline(win, `announcement-long-${theme}`);
  await win.webContents.executeJavaScript(`
    document.querySelector('[data-announcement-action="delete"]')?.click();
  `, true);
  await sleep(240);
  await captureBaseline(win, `announcement-delete-${theme}`);
  await win.webContents.executeJavaScript(`document.getElementById('announcementDeleteCancelBtn')?.click()`, true);
}

async function runQuietProfileChecks() {
  if (CI_SMOKE) return;
  for (const theme of ['light', 'dark']) {
    const { win, rendererErrors } = await createHarnessWindow({
      width: 1280,
      height: 840,
      theme,
      profile: 'quiet',
    });
    try {
      const pages = [
        ['mainDashboardArea', 'dashboard', 'default'],
        ['page-activity', 'activity-share', 'activity-share-long'],
        ['page-settings', 'settings', 'default'],
        ['page-ui-lab', 'ui-lab', 'default'],
      ];
      for (const [pageId, slug, scenario] of pages) {
        await preparePage(win, pageId, scenario);
        await assertQuietProfile(win, theme, pageId);
        await captureBaseline(win, `quiet-${slug}-${theme}`);
      }
      assertVisual(rendererErrors.length === 0, `quiet ${theme} renderer has no errors`, rendererErrors);
    } finally {
      destroyHarnessWindow(win);
    }
  }
}

async function runPageMatrix() {
  const themes = ['light', 'dark'];
  const pages = CI_SMOKE ? PAGE_CASES.filter(([id]) => ['mainDashboardArea', 'page-activity', 'page-announcement'].includes(id)) : PAGE_CASES;

  for (const theme of themes) {
    for (const viewport of VIEWPORTS) {
      const { win, rendererErrors } = await createHarnessWindow({ ...viewport, theme });
      try {
        for (const [pageId, slug] of pages) {
          await preparePage(win, pageId);
          const label = `${slug} ${theme} ${viewport.width}x${viewport.height}`;
          const metrics = await collectPageMetrics(win, pageId);
          assertPageMetrics(metrics, label);
          if (viewport.width === 1280 && viewport.height === 840) {
            await captureBaseline(win, `${slug}-${theme}`);
          }
        }
        assertVisual(rendererErrors.length === 0, `${theme} ${viewport.width}x${viewport.height} renderer has no errors`, rendererErrors);
      } finally {
        destroyHarnessWindow(win);
      }
    }
  }
}

async function runInteractionAndStateChecks() {
  const { win, rendererErrors } = await createHarnessWindow({ width: 1280, height: 840, theme: 'dark' });
  try {
    await preparePage(win, 'page-announcement', 'announcement-default');
    await checkBusyGeometry(win, 'announcementRefreshBtn', 'announcement refresh button');
    await checkAnnouncementRefreshStability(win);
    await preparePage(win, 'page-announcement', 'announcement-empty');
    await checkAnnouncementRefreshStability(win, 'announcement-empty');
    await checkAnnouncementStatePreservation(win);
    await checkRouterScrollIsolation(win);
    await preparePage(win, 'page-activity', 'activity-healthy');
    await checkActivityStatePreservation(win);
    await checkActivityListBoundaries(win);
    await checkExpandableMotion(win, false);
    if (!CI_SMOKE) await captureCriticalStates(win, 'dark');
    assertVisual(rendererErrors.length === 0, 'interaction renderer has no errors', rendererErrors);
  } finally {
    destroyHarnessWindow(win);
  }

  if (!CI_SMOKE) {
    const light = await createHarnessWindow({ width: 1280, height: 840, theme: 'light' });
    try {
      await captureCriticalStates(light.win, 'light');
    } finally {
      destroyHarnessWindow(light.win);
    }
  }

  const reduced = await createHarnessWindow({ width: 1280, height: 840, theme: 'dark', reducedMotion: true });
  try {
    await preparePage(reduced.win, 'page-activity', 'activity-healthy');
    await checkExpandableMotion(reduced.win, true);
    assertVisual(reduced.rendererErrors.length === 0, 'reduced-motion renderer has no errors', reduced.rendererErrors);
  } finally {
    destroyHarnessWindow(reduced.win);
  }
}

async function runZoomMatrix() {
  if (CI_SMOKE) return;
  for (const reducedMotion of [false, true]) {
    const { win, rendererErrors } = await createHarnessWindow({
      width: 1280,
      height: 840,
      theme: 'dark',
      reducedMotion,
    });
    try {
      for (const zoom of [0.8, 1.25, 1.5, 2]) {
        win.webContents.setZoomFactor(zoom);
        await sleep(180);
        for (const pageId of ['page-activity', 'page-announcement']) {
          await preparePage(win, pageId, pageId === 'page-activity' ? 'activity-long' : 'announcement-long');
          const metrics = await collectPageMetrics(win, pageId);
          assertPageMetrics(metrics, `${pageId} zoom ${zoom} reduced=${reducedMotion}`);
        }
      }
      assertVisual(rendererErrors.length === 0, `zoom renderer reduced=${reducedMotion} has no errors`, rendererErrors);
    } finally {
      destroyHarnessWindow(win);
    }
  }
}

async function main() {
  cleanArtifacts();
  await runPageMatrix();
  await runInteractionAndStateChecks();
  await runQuietProfileChecks();
  await runZoomMatrix();
}

const watchdog = setTimeout(() => {
  report.failures.push('visual harness exceeded its 240 second watchdog');
  console.log(`NEKO_VISUAL_RESULT:${JSON.stringify(report)}`);
  app.exit(1);
}, 240000);

app.whenReady().then(async () => {
  try {
    await main();
  } catch (error) {
    report.failures.push(error?.stack || error?.message || String(error));
  } finally {
    clearTimeout(watchdog);
    console.log(`NEKO_VISUAL_RESULT:${JSON.stringify(report)}`);
    app.exit(report.failures.length ? 1 : 0);
  }
});

app.on('window-all-closed', () => {});

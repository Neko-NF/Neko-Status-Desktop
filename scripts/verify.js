/**
 * scripts/verify.js
 * Neko Status Desktop — 自动化验证脚本
 *
 * 用法:
 *   node scripts/verify.js          # 运行全部检查
 *
 * 检查项:
 *   1. 源文件语法验证（JSON / JS 基本语法）
 *   2. HTML 结构完整性（关键 ID 是否存在）
 *   3. IPC 通道一致性（主进程注册的 handle/on 与渲染进程调用匹配）
 *   4. 配置完整性（config-store 默认值 vs 实际使用）
 *   5. 版本号一致性（package.json 与代码中引用）
 *   6. 更新弹窗 DOM 完整性检查
 *   7. 文本文件编码污染扫描
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC_MAIN = path.join(ROOT, 'src', 'main');
const SRC_RENDERER = path.join(ROOT, 'src', 'renderer');

let totalChecks = 0;
let passed = 0;
let failed = 0;
let warnings = 0;

// ── 颜色输出辅助 ─────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function pass(msg) { totalChecks++; passed++; console.log(`  ${C.green}✔${C.reset} ${msg}`); }
function fail(msg) { totalChecks++; failed++; console.log(`  ${C.red}✘${C.reset} ${msg}`); }
function warn(msg) { warnings++; console.log(`  ${C.yellow}⚠${C.reset} ${msg}`); }
function section(title) { console.log(`\n${C.cyan}▸ ${title}${C.reset}`); }

// ── 辅助 ─────────────────────────────────────────────────────
function readFile(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function walkTextFiles(dir, files = []) {
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'releases', '_archive_electron_v1']);
  const textExts = new Set([
    '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.txt', '.yml', '.yaml',
  ]);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTextFiles(abs, files);
      continue;
    }
    if (entry.isFile() && textExts.has(path.extname(entry.name).toLowerCase())) {
      files.push(abs);
    }
  }

  return files;
}

// ═══════════════════════════════════════════════════════════════
//  1. 基础文件存在性 & JSON 语法
// ═══════════════════════════════════════════════════════════════
function checkFileStructure() {
  section('文件结构验证');

  const required = [
    'package.json',
    'src/main/main.js',
    'src/main/config-store.js',
    'src/main/user-data-path.js',
    'src/main/status-service.js',
    'src/main/system-utils.js',
    'src/main/activity-agent-controller.js',
    'src/main/api-service.js',
    'src/main/ipc/api.ipc.js',
    'src/main/ipc/auth.ipc.js',
    'src/main/ipc/config.ipc.js',
    'src/main/ipc/stream.ipc.js',
    'src/main/ipc/system.ipc.js',
    'src/main/ipc/service.ipc.js',
    'src/main/ipc/update.ipc.js',
    'src/main/ipc/announcement.ipc.js',
    'src/main/ipc/activity.ipc.js',
    'src/renderer/index.html',
    'src/renderer/developer-mode-panel.html',
    'src/renderer/css/main.css',
    'src/renderer/js/app.js',
    'src/renderer/js/app-ipc.js',
    'src/renderer/js/ipc-bridge.js',
    'src/renderer/js/services/ipc-client.js',
    'src/renderer/js/services/api-client.js',
    'src/renderer/js/services/config-client.js',
    'src/renderer/js/services/auth-client.js',
    'src/renderer/js/services/service-client.js',
    'src/renderer/js/services/system-client.js',
    'src/renderer/js/services/stream-client.js',
    'src/renderer/js/services/update-client.js',
    'src/renderer/js/services/announcement-client.js',
    'src/renderer/js/services/activity-client.js',
    'src/renderer/js/components/ui-helpers.js',
    'src/renderer/js/components/loading-curves.js',
    'src/renderer/js/components/loading-system.js',
    'src/renderer/js/core/event-bus.js',
    'src/renderer/js/core/theme.js',
    'src/renderer/js/core/router.js',
    'src/renderer/js/core/app-init-runtime.js',
    'src/renderer/js/core/app-event-runtime.js',
    'src/renderer/js/core/app-runtime.js',
    'src/renderer/js/components/neko-island.js',
    'src/renderer/js/components/expandable-section.js',
    'src/renderer/js/components/modal.js',
    'src/renderer/js/components/developer-console.js',
    'src/renderer/js/components/developer-mode.js',
    'src/renderer/js/components/console-runtime.js',
    'src/renderer/js/components/experimental-features.js',
    'src/renderer/js/components/security-dialogs.js',
    'src/renderer/js/components/app-shell-controls.js',
    'src/renderer/js/developer-mode-panel.js',
    'src/renderer/js/state/app-state.js',
    'src/renderer/js/pages/settings.page.js',
    'src/renderer/js/pages/config.page.js',
    'src/renderer/js/pages/service.page.js',
    'src/renderer/js/pages/stream.page.js',
    'src/renderer/js/pages/dashboard.page.js',
    'src/renderer/js/pages/device-status.page.js',
    'src/renderer/js/pages/screenshot.page.js',
    'src/renderer/js/pages/update.page.js',
    'src/renderer/js/pages/auth.page.js',
    'src/renderer/js/pages/announcement.page.js',
    'src/renderer/js/pages/about.page.js',
    'src/renderer/js/pages/activity.page.js',
    'src/renderer/js/pages/ui-lab.page.js',
    'src/renderer/css/tokens.css',
    'src/renderer/css/base.css',
    'src/renderer/css/layout.css',
    'src/renderer/css/components.css',
    'src/renderer/css/developer-mode-panel.css',
    'src/renderer/css/pages.css',
    'src/renderer/css/legacy.css',
    'src/renderer/css/loading-system.css',
    'scripts/build-presence-agent.js',
    'scripts/validate-presence-agent.js',
    'native/presence-agent/Cargo.toml',
  ];

  for (const f of required) {
    if (fileExists(f)) pass(`${f} 存在`);
    else fail(`${f} 缺失`);
  }

  // package.json 语法
  try {
    const pkg = JSON.parse(readFile('package.json'));
    if (pkg.version) pass(`package.json version: ${pkg.version}`);
    else fail('package.json 缺少 version 字段');
    if (pkg.main) pass(`package.json main: ${pkg.main}`);
    else fail('package.json 缺少 main 字段');
  } catch (e) {
    fail(`package.json 解析失败: ${e.message}`);
  }
}

function checkRendererSplitSyntax() {
  section('Renderer split module syntax');

  const modules = [
    'src/renderer/js/services/ipc-client.js',
    'src/renderer/js/services/api-client.js',
    'src/renderer/js/services/config-client.js',
    'src/renderer/js/services/auth-client.js',
    'src/renderer/js/services/service-client.js',
    'src/renderer/js/services/system-client.js',
    'src/renderer/js/services/stream-client.js',
    'src/renderer/js/services/update-client.js',
    'src/renderer/js/services/announcement-client.js',
    'src/renderer/js/services/activity-client.js',
    'src/renderer/js/components/ui-helpers.js',
    'src/renderer/js/components/loading-curves.js',
    'src/renderer/js/components/loading-system.js',
    'src/renderer/js/core/event-bus.js',
    'src/renderer/js/core/theme.js',
    'src/renderer/js/core/router.js',
    'src/renderer/js/core/app-init-runtime.js',
    'src/renderer/js/core/app-event-runtime.js',
    'src/renderer/js/core/app-runtime.js',
    'src/renderer/js/components/neko-island.js',
    'src/renderer/js/components/expandable-section.js',
    'src/renderer/js/components/modal.js',
    'src/renderer/js/components/developer-console.js',
    'src/renderer/js/components/developer-mode.js',
    'src/renderer/js/components/console-runtime.js',
    'src/renderer/js/components/experimental-features.js',
    'src/renderer/js/components/security-dialogs.js',
    'src/renderer/js/components/app-shell-controls.js',
    'src/renderer/js/developer-mode-panel.js',
    'src/renderer/js/state/app-state.js',
    'src/renderer/js/pages/settings.page.js',
    'src/renderer/js/pages/config.page.js',
    'src/renderer/js/pages/service.page.js',
    'src/renderer/js/pages/stream.page.js',
    'src/renderer/js/pages/dashboard.page.js',
    'src/renderer/js/pages/device-status.page.js',
    'src/renderer/js/pages/screenshot.page.js',
    'src/renderer/js/pages/update.page.js',
    'src/renderer/js/pages/auth.page.js',
    'src/renderer/js/pages/announcement.page.js',
    'src/renderer/js/pages/about.page.js',
    'src/renderer/js/pages/activity.page.js',
    'src/renderer/js/pages/ui-lab.page.js',
  ];

  for (const relPath of modules) {
    const source = readFile(relPath);
    if (!source) {
      fail(`${relPath} is not readable`);
      continue;
    }
    try {
      new vm.Script(source, { filename: relPath });
      pass(`${relPath} parses`);
    } catch (e) {
      fail(`${relPath} syntax error: ${e.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  2. HTML 关键 ID 检查
// ═══════════════════════════════════════════════════════════════
function checkHtmlIds() {
  section('HTML 关键 ID 验证');
  const html = readFile('src/renderer/index.html');
  if (!html) { fail('index.html 不可读'); return; }

  const requiredIds = [
    // 关于页
    'aboutVersionValue',
    'aboutVersionSub',
    // 更新中心
    'updateVerNumber',
    'updateVerDesc',
    'checkUpdateBtn',
    'updateStatusBadge',
    // 更新弹窗
    'updateDialogOverlay',
    'updateDialogCurrentVer',
    'updateDialogNewVer',
    'updateDialogSize',
    'updateDialogDate',
    'updateDialogChannel',
    'updateDialogForceBanner',
    'updateDialogNotes',
    'updateDialogClose',
    'updateDialogSkipBtn',
    'updateDialogInstallBtn',
    // 活动流
    'activityList',
    // 关注动态
    'navActivity',
    'page-activity',
    'activityEnabledSwitch',
    'activityAgentBadge',
    'activityUserSearchInput',
    // 仪表盘
    'batteryValue',
    'healthValue',
    // UI 实验室
    'navUiLab',
    'page-ui-lab',
    'uiLabCurveGrid',
    'uiLabPreviewStage',
    'stgExperimentalUiLabSwitch',
  ];

  for (const id of requiredIds) {
    if (html.includes(`id="${id}"`)) pass(`id="${id}" 存在`);
    else fail(`id="${id}" 缺失`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  3. CSS 类名一致性（HTML 中使用的关键类名在 CSS 中有定义）
// ═══════════════════════════════════════════════════════════════
function checkCssConsistency() {
  section('CSS 关键类名验证');
  const cssFiles = [
    'src/renderer/css/tokens.css',
    'src/renderer/css/base.css',
    'src/renderer/css/layout.css',
    'src/renderer/css/components.css',
    'src/renderer/css/pages.css',
    'src/renderer/css/legacy.css',
    'src/renderer/css/loading-system.css',
    'src/renderer/css/main.css'
  ];
  let css = '';
  for (const f of cssFiles) {
    const content = readFile(f);
    if (content) css += content + '\n';
  }

  if (!css) { fail('CSS 文件全不可读'); return; }

  const criticalClasses = [
    'modal-overlay',
    'modal-container',
    'modal-header',
    'modal-footer',
    'update-dialog-container',
    'update-dialog-version-row',
    'update-dialog-force-banner',
    'update-dialog-notes',
    'glass-card',
    'toggle-switch',
    'neko-island',
    'neko-loading',
    'ui-lab-layout',
  ];

  for (const cls of criticalClasses) {
    if (css.includes(`.${cls}`)) pass(`.${cls} 已定义`);
    else fail(`.${cls} 未定义`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  4. 编码安全检查（system-utils.js）
// ═══════════════════════════════════════════════════════════════
function checkEncodingSafety() {
  section('编码安全检查');
  const utils = readFile('src/main/system-utils.js');
  if (!utils) { fail('system-utils.js 不可读'); return; }

  // runPowerShell 应该使用 encoding: 'buffer'
  if (utils.includes("encoding: 'buffer'")) {
    pass("runPowerShell 使用 encoding: 'buffer'（安全）");
  } else if (utils.includes("encoding: 'utf8'")) {
    fail("runPowerShell 仍使用 encoding: 'utf8'（可能导致中文乱码）");
  } else {
    warn("runPowerShell encoding 设置未找到");
  }

  // 检查 OutputEncoding 设置
  if (utils.includes('[Console]::OutputEncoding = [Text.Encoding]::UTF8')) {
    pass('PowerShell 脚本设置了 UTF8 OutputEncoding');
  } else {
    warn('PowerShell 脚本未设置 OutputEncoding');
  }
}

// ═══════════════════════════════════════════════════════════════
//  4b. 文本文件编码污染扫描
// ═══════════════════════════════════════════════════════════════
function checkTextEncodingPollution() {
  section('文本文件编码污染扫描');

  const suspiciousPattern = /�|锟|Ã|Â|â€|鈥|鉁|鐩|鍙|涓€|寮€|鏂囨|浠诲|绌|攢/;
  const hits = [];

  for (const abs of walkTextFiles(ROOT)) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (rel === 'scripts/verify.js' || rel === 'original_app.js') continue;
    const text = fs.readFileSync(abs, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (suspiciousPattern.test(line)) {
        hits.push(`${rel}:${index + 1}`);
      }
    });
  }

  if (hits.length === 0) {
    pass('未发现常见 UTF-8/GBK 乱码特征');
    return;
  }

  fail(`发现疑似编码污染: ${hits.slice(0, 12).join(', ')}${hits.length > 12 ? ' ...' : ''}`);
}

// ═══════════════════════════════════════════════════════════════
//  5. 配置默认值完整性检查
// ═══════════════════════════════════════════════════════════════
function checkConfigDefaults() {
  section('配置默认值检查');
  const config = readFile('src/main/config-store.js');
  const configHelper = readFile('src/main/config-store.helpers.js');
  const configSource = `${config || ''}\n${configHelper || ''}`;
  if (!configSource.trim()) { fail('config-store.js 不可读'); return; }

  const requiredKeys = [
    'deviceKey', 'reportInterval', 'enableScreenshot',
    'autoCheckUpdate', 'updateChannel', 'skippedVersion',
    'githubOwner', 'githubRepo',
    'enableActivityFeature', 'enableActivityPublishing', 'enableActivitySnapshots',
    'enableActivityBackground', 'enableActivityAutoStart',
    'activityInstallationId', 'activityDeviceBindings', 'activityBoundUserId',
    'activityDeviceId', 'activityDeviceName',
    'enableExperimentalUiLabEntry', 'enableExperimentalCurveLoaders',
    'loadingCurveStyle',
  ];

  for (const key of requiredKeys) {
    if (configSource.includes(`${key}:`)) pass(`默认配置包含 ${key}`);
    else fail(`默认配置缺少 ${key}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  6. 更新系统完整性检查
// ═══════════════════════════════════════════════════════════════
function checkUpdateSystem() {
  section('更新系统完整性检查');
  const main = readFile('src/main/main.js');
  const startupUpdate = readFile('src/main/startup-update-gate.js') || '';
  const runtime = readFile('src/renderer/js/core/app-runtime.js');
  const updatePage = readFile('src/renderer/js/pages/update.page.js');
  if (!main || !runtime || !updatePage) { fail('主进程或渲染进程文件不可读'); return; }

  // 主进程 checkForUpdates 返回 downloadSize
  if (main.includes('downloadSize')) pass('checkForUpdates 返回 downloadSize');
  else fail('checkForUpdates 缺少 downloadSize 字段');

  // 主进程 skippedVersion 过滤
  const updateOrchestration = `${main}\n${startupUpdate}`;
  if (
    updateOrchestration.includes("skippedVersion") &&
    updateOrchestration.includes('configStore.get(\'skippedVersion\')')
  ) {
    pass('启动/轮询中包含 skippedVersion 过滤');
  } else {
    fail('启动/轮询中缺少 skippedVersion 过滤');
  }

  // 主进程 FORCE_UPDATE 检测
  if (main.includes('FORCE_UPDATE')) pass('支持 FORCE_UPDATE 标记检测');
  else fail('缺少 FORCE_UPDATE 标记检测');

  // 渲染进程更新弹窗函数由 UpdatePage 负责。
  if (updatePage.includes('showDialog(result')) pass('UpdatePage 包含 showDialog 函数');
  else fail('UpdatePage 缺少 showDialog 函数');

  if (updatePage.includes('hideDialog()')) pass('UpdatePage 包含 hideDialog 函数');
  else fail('UpdatePage 缺少 hideDialog 函数');

  const aboutPage = readFile('src/renderer/js/pages/about.page.js');
  const aboutSource = `${runtime}\n${aboutPage || ''}`;

  // 版本号动态化
  if (aboutPage && aboutPage.includes('aboutVersionValue') && runtime.includes('AboutPage')) pass('关于页版本号由 AboutPage 接管');
  else fail('关于页版本号更新方式不正确');

  if (aboutPage && aboutPage.includes('aboutVersionSub') && aboutSource.includes('toLocaleDateString')) pass('关于页版本日期由 AboutPage 动态化');
  else fail('关于页版本日期未动态化');
}

// ═══════════════════════════════════════════════════════════════
//  7. 活动流检查
// ═══════════════════════════════════════════════════════════════
function checkActivityFeed() {
  section('活动流完整性检查');
  const runtime = readFile('src/renderer/js/core/app-runtime.js');
  const dashboardPage = readFile('src/renderer/js/pages/dashboard.page.js');
  if (!runtime || !dashboardPage) { fail('renderer runtime 或 dashboard.page.js 不可读'); return; }
  const activitySource = `${runtime}\n${dashboardPage}`;

  // 检查活动流是否有 app 类型
  if (activitySource.includes("appendActivityItem('app'")) pass("活动流包含 'app' 类型条目");
  else fail("活动流缺少 'app' 类型条目");

  // 检查活动流是否有 upload 类型
  if (activitySource.includes("appendActivityItem('upload'")) pass("活动流包含 'upload' 类型条目");
  else fail("活动流缺少 'upload' 类型条目");

  // 检查活动流是否有 capture 类型
  if (activitySource.includes("appendActivityItem('capture'")) pass("活动流包含 'capture' 类型条目");
  else fail("活动流缺少 'capture' 类型条目");

  // 检查 appName 回退逻辑
  if (activitySource.includes('data.appName || data.packageName')) pass('活动流有 appName 回退到 packageName 逻辑');
  else fail('活动流缺少 appName 回退逻辑');
}

// ═══════════════════════════════════════════════════════════════
//  7b. 用户关注活动功能检查
// ═══════════════════════════════════════════════════════════════
function checkActivityPresenceFeature() {
  section('用户关注活动功能完整性检查');
  const contracts = readFile('src/shared/ipc-contracts.js') || '';
  const schemas = readFile('src/shared/schemas.js') || '';
  const main = readFile('src/main/main.js') || '';
  const controller = readFile('src/main/activity-agent-controller.js') || '';
  const ipc = readFile('src/main/ipc/activity.ipc.js') || '';
  const configIpc = readFile('src/main/ipc/config.ipc.js') || '';
  const preload = readFile('src/preload/index.js') || '';
  const html = readFile('src/renderer/index.html') || '';
  const page = readFile('src/renderer/js/pages/activity.page.js') || '';
  const settingsPage = readFile('src/renderer/js/pages/settings.page.js') || '';
  const service = readFile('src/renderer/js/services/activity-client.js') || '';
  const css = readFile('src/renderer/css/pages.css') || '';
  const pkg = readFile('package.json') || '';

  if (contracts.includes('ACTIVITY_GET_STATE') && contracts.includes('ACTIVITY_STATE_CHANGED') && contracts.includes('ACTIVITY_PICK_APP_WINDOW')) pass('Activity IPC 契约已集中定义');
  else fail('Activity IPC 契约缺失');

  if (schemas.includes('validateActivitySettingsPayload') && schemas.includes('validateActivityManagePayload')) pass('Activity payload schema 已定义');
  else fail('Activity payload schema 缺失');

  if (main.includes('activityAgent') && ipc.includes('registerActivityIpc')) pass('主进程注册 Activity IPC 和 Agent 控制器');
  else fail('主进程 Activity 注册不完整');

  if (preload.includes('getActivityState') && service.includes('ActivityClient')) pass('preload 与 renderer service 暴露 Activity API');
  else fail('Activity renderer 调用链不完整');

  if (page.includes('ActivityPage') && page.includes('activityAgentBadge')) pass('关注动态页面已接入 ActivityPage');
  else fail('关注动态页面缺少核心绑定');

  if (!page.includes('window.nekoIPC') && service.includes('IpcClient')) pass('Activity renderer 遵循 service 分层，不直接调用底层 IPC');
  else fail('Activity renderer 可能绕过 service 层直接调用 IPC');

  if (page.includes('confirmActivityDanger') && page.includes('window.confirm') && page.includes('toggle-app')) pass('关注动态危险操作包含二次确认');
  else fail('关注动态危险操作缺少确认保护');

  if (html.includes('id="activityEnabledSwitch"')
    && html.includes('role="switch"')
    && html.includes('aria-labelledby="activityEnabledLabel"')
    && html.includes('aria-live="polite"')
    && page.includes('aria-pressed')) pass('关注动态 UI 包含基础可访问性语义');
  else fail('关注动态 UI 可访问性语义不完整');

  if (html.includes('activity-empty') && html.includes('activity-security-note') && page.includes('没有找到匹配的用户')) pass('关注动态包含空状态、安全说明和搜索失败状态');
  else fail('关注动态缺少必要状态文案');

  if (html.includes('activity-guide-strip') && html.includes('activity-app-composer') && html.includes('activityPageStatus') && html.includes('activityActiveAppBtn')) pass('关注动态包含引导步骤、主动公开应用和保存状态反馈');
  else fail('关注动态缺少新的用户引导或主动公开应用入口');

  if (page.includes('pickActivityAppWindow') && !page.includes('getActiveWindow')) pass('公开应用选择复用窗口框选，不读取点击后的当前前台窗口');
  else fail('公开应用选择仍可能读取 Neko 自身作为当前前台窗口');

  const settingsStart = html.indexOf('id="page-settings"');
  const aboutStart = html.indexOf('id="page-about"');
  const streamStart = html.indexOf('id="page-stream"');
  const settingsSection = settingsStart >= 0 && aboutStart > settingsStart ? html.slice(settingsStart, aboutStart) : '';
  const streamSection = streamStart >= 0 && settingsStart > streamStart ? html.slice(streamStart, settingsStart) : '';
  if (
    html.includes('stgExperimentalActivitySwitch')
    && html.includes('stgExperimentalStreamSwitch')
    && !settingsSection.includes('id="settings-stream"')
    && !settingsSection.includes('id="srsHost"')
    && streamSection.includes('id="settings-stream"')
  ) pass('实验性设置页只保留入口开关，直播推流配置位于直播推流页');
  else fail('实验性设置页仍混入直播推流配置或缺少独立入口开关');

  if (
    css.includes('.settings-row.settings-experimental-entry-row')
    && css.includes('.settings-experimental-shell.is-experimental-expanded .settings-row.settings-experimental-entry-row')
    && css.includes('border-bottom-width: 0')
  ) pass('实验性入口开关使用高优先级折叠动画样式，避免被通用设置行覆盖');
  else fail('实验性入口开关折叠样式可能被通用 settings-row 覆盖');

  if (
    configIpc.includes('enableExperimentalFeatures: false')
    && configIpc.includes('enableExperimentalActivityEntry: false')
    && configIpc.includes('enableExperimentalStreamEntry: false')
    && configIpc.includes('enableActivityPublishing: false')
    && configIpc.includes('enableActivityBackground: false')
    && settingsPage.includes('setMany?.(payload)')
  ) pass('实验总开关关闭会清理实验入口和关注动态运行状态');
  else fail('实验总开关关闭未兜底清理子功能状态');

  const configDefaults = readFile('src/main/config-store.helpers.js') || '';
  const runtimeInit = readFile('src/renderer/js/core/app-init-runtime.js') || '';
  if (configDefaults.includes('https://nekostatus.koirin.com') && runtimeInit.includes('https://nekostatus.koirin.com')) pass('Dev 默认测试服务器地址固定为 nekostatus.koirin.com');
  else fail('默认测试服务器地址可能回退到旧地址');

  if (
    html.includes('默认不上传截图，快照提醒需单独开启')
    && html.includes('id="activitySnapshotsSwitch"')
    && controller.includes('activityDeviceId')
    && controller.includes('snapshotProfileFields')
    && !controller.includes('请先生成设备密钥')
  ) pass('关注动态的活动快照与完整截图上报在文案、配置和设备身份上解耦');
  else fail('关注动态仍可能与截图/完整状态上报产生耦合感');

  if (schemas.includes("'upsertApp'") && ipc.includes("case 'upsertApp'") && service.includes('upsertApp') && page.includes('setPageStatus')) pass('关注动态支持发布者主动公开应用，并具备弱网保存反馈');
  else fail('关注动态缺少主动公开应用或弱网保存反馈链路');

  const activityCssStart = css.indexOf('/* 用户关注与前台应用在线提醒 */');
  const activityCssEnd = css.indexOf('/* 禁用表格行缩放', activityCssStart);
  const activityCss = activityCssStart >= 0 && activityCssEnd > activityCssStart
    ? css.slice(activityCssStart, activityCssEnd)
    : '';
  const hardcodedColors = activityCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  if (activityCss.includes('.activity-page-shell .action-btn.x-small') && activityCss.includes('min-height: 40px') && activityCss.includes('focus-visible')) pass('关注动态样式满足触达尺寸和键盘焦点要求');
  else fail('关注动态样式缺少触达尺寸或焦点态');

  if (activityCss && hardcodedColors.length === 0) pass('关注动态样式使用主题变量，未新增硬编码颜色');
  else fail(`关注动态样式存在硬编码颜色: ${hardcodedColors.join(', ')}`);

  if (controller.includes('NekoPresenceAgent.exe') && controller.includes('claim_tray')) pass('Agent 控制器包含代理路径和托盘租约');
  else fail('Agent 控制器缺少代理路径或托盘租约');

  if (pkg.includes('build:agent') && pkg.includes('test:agent') && pkg.includes('validate:agent') && pkg.includes('build/native/NekoPresenceAgent.exe')) pass('package 构建配置包含 Agent 构建与打包资源');
  else fail('package 构建配置缺少 Agent 集成');
}

// ═══════════════════════════════════════════════════════════════
//  7c. 数学曲线加载系统检查
// ═══════════════════════════════════════════════════════════════
function checkCurveLoadingSystem() {
  section('数学曲线加载系统完整性检查');
  const curves = readFile('src/renderer/js/components/loading-curves.js') || '';
  const loading = readFile('src/renderer/js/components/loading-system.js') || '';
  const runtime = readFile('src/renderer/js/core/app-runtime.js') || '';
  const html = readFile('src/renderer/index.html') || '';
  const configDefaults = readFile('src/main/config-store.helpers.js') || '';
  const configIpc = readFile('src/main/ipc/config.ipc.js') || '';
  const startupMain = readFile('src/main/main.js') || '';
  const startupRenderer = readFile('src/renderer/js/startup-update.js') || '';

  const presetIds = [
    'neko-head', 'neko-paw', 'neko-tail', 'rose-five', 'rose-seven',
    'lissajous-drift', 'lemniscate-bloom', 'hypotrochoid-loop',
    'cardioid-pulse', 'spiral-search', 'butterfly-phase', 'fourier-flow',
  ];
  const missingPresets = presetIds.filter((id) => !curves.includes(`id: '${id}'`));
  if (missingPresets.length === 0) pass('曲线注册表包含首发 12 个稳定预设 ID');
  else fail(`曲线注册表缺少预设: ${missingPresets.join(', ')}`);

  if (loading.includes('MAX_ACTIVE = 4') && loading.includes('requestAnimationFrame') && loading.includes('IntersectionObserver')) {
    pass('加载系统包含共享 RAF、4 实例上限与离屏暂停');
  } else {
    fail('加载系统调度器性能门禁不完整');
  }

  if (loading.includes('prefers-reduced-motion: reduce') && loading.includes("role', 'status'") && loading.includes("aria-live', 'polite'")) {
    pass('加载系统包含减少动态效果和状态可访问性语义');
  } else {
    fail('加载系统可访问性门禁不完整');
  }

  if (runtime.includes('loadingSystem()?.applyPreferences') && runtime.includes('UiLabPage')) pass('AppRuntime 接入加载偏好与 UI 实验室');
  else fail('AppRuntime 未完整接入曲线加载系统');

  if (html.includes('data-target="page-ui-lab"') && html.includes('ui-lab-curve-grid') && html.includes('uiLabDiagActive')) pass('UI 实验室包含入口、静态画廊与性能诊断');
  else fail('UI 实验室结构不完整');

  if (
    configDefaults.includes('enableExperimentalUiLabEntry: false')
    && configDefaults.includes('enableExperimentalCurveLoaders: false')
    && configDefaults.includes("loadingCurveStyle: 'auto'")
    && configIpc.includes('enableExperimentalUiLabEntry: false')
    && configIpc.includes('enableExperimentalCurveLoaders: false')
  ) pass('曲线加载实验配置默认关闭并受全局实验开关联动');
  else fail('曲线加载实验配置门禁不完整');

  if (startupMain.includes('enableExperimentalCurveLoaders') && startupMain.includes('loadingCurveStyle') && startupRenderer.includes('loadingSystem?.create')) {
    pass('启动更新状态向后兼容地接入曲线加载器');
  } else {
    fail('启动更新曲线加载接入不完整');
  }
}

// ═══════════════════════════════════════════════════════════════
//  8. IPC 通道基本一致性
// ═══════════════════════════════════════════════════════════════
function checkIpcChannels() {
  section('IPC 通道一致性');
  const main = readFile('src/main/main.js');
  const bridge = readFile('src/renderer/js/ipc-bridge.js');
  if (!main || !bridge) { fail('文件不可读'); return; }
  const mainLayerSource = walkTextFiles(SRC_MAIN)
    .map((abs) => fs.readFileSync(abs, 'utf8'))
    .join('\n');

  // 关键 IPC handle
  const criticalHandles = [
    ['update:check', 'IPC_CHANNELS.UPDATE_CHECK'],
    ['config:get', 'IPC_CHANNELS.CONFIG_GET'],
    ['config:set', 'IPC_CHANNELS.CONFIG_SET'],
    ['update:download', 'IPC_CHANNELS.UPDATE_DOWNLOAD'],
    ['activity:getState', 'IPC_CHANNELS.ACTIVITY_GET_STATE'],
    ['activity:updateSettings', 'IPC_CHANNELS.ACTIVITY_UPDATE_SETTINGS'],
    ['activity:manage', 'IPC_CHANNELS.ACTIVITY_MANAGE'],
  ];

  for (const [channel, constantName] of criticalHandles) {
    if (mainLayerSource.includes(`ipcMain.handle(${constantName}`)) pass(`主进程注册 ${channel}`);
    else warn(`主进程可能缺少 ${channel} 注册`);
  }

  const rendererIpc = walkTextFiles(SRC_RENDERER)
    .filter((abs) => abs.endsWith('.js'))
    .map((abs) => fs.readFileSync(abs, 'utf8'))
    .join('\n');
  const hardcodedRendererEvents = rendererIpc.match(/ipc\.on\(['"][^'"]+['"]/g) || [];
  if (hardcodedRendererEvents.length === 0) {
    pass('renderer IPC 事件监听使用 IPC_EVENTS 常量或兼容封装');
  } else {
    fail(`renderer 存在硬编码 IPC 事件监听: ${hardcodedRendererEvents.slice(0, 5).join(', ')}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════════════════════════
console.log(`\n${C.cyan}═══════════════════════════════════════════════════${C.reset}`);
console.log(`${C.cyan}  Neko Status Desktop — 自动化验证${C.reset}`);
console.log(`${C.cyan}═══════════════════════════════════════════════════${C.reset}`);
console.log(`${C.dim}  项目路径: ${ROOT}${C.reset}`);

checkFileStructure();
checkRendererSplitSyntax();
checkHtmlIds();
checkCssConsistency();
checkEncodingSafety();
checkTextEncodingPollution();
checkConfigDefaults();
checkUpdateSystem();
checkActivityFeed();
checkActivityPresenceFeature();
checkCurveLoadingSystem();
checkIpcChannels();

// ── 汇总 ─────────────────────────────────────────────────────
console.log(`\n${C.cyan}═══════════════════════════════════════════════════${C.reset}`);
console.log(`  总计: ${totalChecks} 项检查`);
console.log(`  ${C.green}通过: ${passed}${C.reset}  ${C.red}失败: ${failed}${C.reset}  ${C.yellow}警告: ${warnings}${C.reset}`);

if (failed > 0) {
  console.log(`\n  ${C.red}❌ 验证未通过，请修复上述失败项${C.reset}\n`);
  process.exit(1);
} else {
  console.log(`\n  ${C.green}✅ 所有检查通过！${C.reset}\n`);
  process.exit(0);
}

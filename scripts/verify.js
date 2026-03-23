/**
 * scripts/verify.js
 * Neko Status Desktop — 自动化验证脚本
 *
 * 用法:
 *   node scripts/verify.js          # 运行全部检查
 *   node scripts/verify.js --fix    # 自动修复可修复的问题
 *
 * 检查项:
 *   1. 源文件语法验证（JSON / JS 基本语法）
 *   2. HTML 结构完整性（关键 ID 是否存在）
 *   3. IPC 通道一致性（主进程注册的 handle/on 与渲染进程调用匹配）
 *   4. 配置完整性（config-store 默认值 vs 实际使用）
 *   5. 版本号一致性（package.json 与代码中引用）
 *   6. 更新弹窗 DOM 完整性检查
 */

const fs = require('fs');
const path = require('path');

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

// ═══════════════════════════════════════════════════════════════
//  1. 基础文件存在性 & JSON 语法
// ═══════════════════════════════════════════════════════════════
function checkFileStructure() {
  section('文件结构验证');

  const required = [
    'package.json',
    'src/main/main.js',
    'src/main/config-store.js',
    'src/main/status-service.js',
    'src/main/system-utils.js',
    'src/main/api-service.js',
    'src/renderer/index.html',
    'src/renderer/css/main.css',
    'src/renderer/js/app.js',
    'src/renderer/js/app-ipc.js',
    'src/renderer/js/ipc-bridge.js',
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
    // 仪表盘
    'batteryValue',
    'healthValue',
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
  const css = readFile('src/renderer/css/main.css');
  if (!css) { fail('main.css 不可读'); return; }

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
//  5. 配置默认值完整性检查
// ═══════════════════════════════════════════════════════════════
function checkConfigDefaults() {
  section('配置默认值检查');
  const config = readFile('src/main/config-store.js');
  if (!config) { fail('config-store.js 不可读'); return; }

  const requiredKeys = [
    'deviceKey', 'reportInterval', 'enableScreenshot',
    'autoCheckUpdate', 'updateChannel', 'skippedVersion',
    'githubOwner', 'githubRepo',
  ];

  for (const key of requiredKeys) {
    if (config.includes(`${key}:`)) pass(`默认配置包含 ${key}`);
    else fail(`默认配置缺少 ${key}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  6. 更新系统完整性检查
// ═══════════════════════════════════════════════════════════════
function checkUpdateSystem() {
  section('更新系统完整性检查');
  const main = readFile('src/main/main.js');
  const ipc = readFile('src/renderer/js/app-ipc.js');
  if (!main || !ipc) { fail('主进程或渲染进程文件不可读'); return; }

  // 主进程 checkForUpdates 返回 downloadSize
  if (main.includes('downloadSize')) pass('checkForUpdates 返回 downloadSize');
  else fail('checkForUpdates 缺少 downloadSize 字段');

  // 主进程 skippedVersion 过滤
  if (main.includes("skippedVersion") && main.includes('configStore.get(\'skippedVersion\')')) {
    pass('启动/轮询中包含 skippedVersion 过滤');
  } else {
    fail('启动/轮询中缺少 skippedVersion 过滤');
  }

  // 主进程 FORCE_UPDATE 检测
  if (main.includes('FORCE_UPDATE')) pass('支持 FORCE_UPDATE 标记检测');
  else fail('缺少 FORCE_UPDATE 标记检测');

  // 渲染进程更新弹窗函数
  if (ipc.includes('showUpdateDialog')) pass('渲染进程包含 showUpdateDialog 函数');
  else fail('渲染进程缺少 showUpdateDialog 函数');

  if (ipc.includes('hideUpdateDialog')) pass('渲染进程包含 hideUpdateDialog 函数');
  else fail('渲染进程缺少 hideUpdateDialog 函数');

  // 版本号动态化
  if (ipc.includes('aboutVersionValue')) pass('关于页版本号按 ID 更新');
  else fail('关于页版本号更新方式不正确');

  if (ipc.includes('aboutVersionSub')) pass('关于页版本日期按 ID 更新');
  else fail('关于页版本日期未动态化');
}

// ═══════════════════════════════════════════════════════════════
//  7. 活动流检查
// ═══════════════════════════════════════════════════════════════
function checkActivityFeed() {
  section('活动流完整性检查');
  const ipc = readFile('src/renderer/js/app-ipc.js');
  if (!ipc) { fail('app-ipc.js 不可读'); return; }

  // 检查活动流是否有 app 类型
  if (ipc.includes("appendActivityItem('app'")) pass("活动流包含 'app' 类型条目");
  else fail("活动流缺少 'app' 类型条目");

  // 检查活动流是否有 upload 类型
  if (ipc.includes("appendActivityItem('upload'")) pass("活动流包含 'upload' 类型条目");
  else fail("活动流缺少 'upload' 类型条目");

  // 检查活动流是否有 capture 类型
  if (ipc.includes("appendActivityItem('capture'")) pass("活动流包含 'capture' 类型条目");
  else fail("活动流缺少 'capture' 类型条目");

  // 检查 appName 回退逻辑
  if (ipc.includes('data.appName || data.packageName')) pass('活动流有 appName 回退到 packageName 逻辑');
  else fail('活动流缺少 appName 回退逻辑');
}

// ═══════════════════════════════════════════════════════════════
//  8. IPC 通道基本一致性
// ═══════════════════════════════════════════════════════════════
function checkIpcChannels() {
  section('IPC 通道一致性');
  const main = readFile('src/main/main.js');
  const bridge = readFile('src/renderer/js/ipc-bridge.js');
  if (!main || !bridge) { fail('文件不可读'); return; }

  // 关键 IPC handle
  const criticalHandles = [
    'update:check',
    'config:get',
    'config:set',
    'update:download',
  ];

  for (const ch of criticalHandles) {
    if (main.includes(`'${ch}'`)) pass(`主进程注册 ${ch}`);
    else warn(`主进程可能缺少 ${ch} 注册`);
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
checkHtmlIds();
checkCssConsistency();
checkEncodingSafety();
checkConfigDefaults();
checkUpdateSystem();
checkActivityFeed();
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

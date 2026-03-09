/**
 * config-store.js
 * 基于 JSON 文件的轻量配置存储，无需外部依赖
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // 设备配置
  deviceKey: '',
  deviceId: null,
  // 上报配置
  reportInterval: 10,             // 上报间隔 (秒)
  serverMode: 'production',       // 'local' | 'production'
  serverUrlProd: 'https://nf.koirin.com',
  serverUrlLocal: 'http://127.0.0.1:3000',
  // 功能开关
  enableScreenshot: false,
  screenshotInterval: 60,
  screenshotMode: 'auto',         // 'auto' | 'interval' | 'manual'
  syncScreenshotInterval: true,   // 截图间隔是否与上报同步
  enableAutoStart: false,
  startupDelayMs: 5000,           // 自启动延迟 (ms)
  enableAutoServiceStart: false,  // 启动时自动开启上报服务
  // 关闭行为: 'ask' | 'minimize' | 'exit'
  closeAction: 'ask',
  // 界面配置
  themeMode: 'light',             // 'light' | 'dark' | 'auto' | 'system'
  darkModeStart: '18:00',         // 定时深色模式起始时间
  darkModeEnd: '07:00',           // 定时深色模式结束时间
  seedColor: '#06b6d4',
  glassEffect: true,              // 玻璃拟态效果
  uiScale: 100,                   // 界面缩放百分比
  uiFont: '',                     // 界面字体
  debugEnabled: false,
  // 通知 & 隐私
  enableNotification: true,       // 系统推送通知
  doNotDisturb: false,            // 勿扰模式
  enableIncognito: false,         // 隐身模式（截图模糊、隐藏敏感窗口）
  blurAllScreenshots: false,      // 全局截图模糊（无论前台应用）
  enable2FA: false,               // 双重认证
  restoreLastState: false,        // 启动时恢复上次页面
  authListCollapsed: false,       // 权限列表折叠状态持久化
  reportIntervalMode: 'auto',     // 'auto' | 'custom'
  // 故障恢复
  enableAutoRestart: true,        // 崩溃自动重启
  maxRestarts: 3,                 // 最大重启次数
  restartIntervalSec: 30,         // 重启间隔（秒）
  watchdogTimeoutSec: 60,         // 看门狗超时（秒）
  // 更新配置
  githubOwner: 'Neko-NF',
  githubRepo: 'Neko-Status-Desktop',
  githubToken: '',
  autoCheckUpdate: true,
  updateChannel: 'stable',         // 'stable' | 'beta' | 'nightly'
  skippedVersion: '',
  lastUpdateCheck: 0,
};

class ConfigStore {
  constructor() {
    this._configPath = null;
    this._data = null;
  }

  _getPath() {
    if (!this._configPath) {
      this._configPath = path.join(app.getPath('userData'), 'neko-config.json');
    }
    return this._configPath;
  }

  _load() {
    if (this._data !== null) return;
    try {
      const raw = fs.readFileSync(this._getPath(), 'utf8');
      this._data = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      this._data = { ...DEFAULTS };
    }
  }

  _save() {
    try {
      fs.writeFileSync(this._getPath(), JSON.stringify(this._data, null, 2), 'utf8');
    } catch (e) {
      console.error('[Config] 保存失败:', e.message);
    }
  }

  get(key) {
    this._load();
    return this._data[key] !== undefined ? this._data[key] : DEFAULTS[key];
  }

  set(key, value) {
    this._load();
    this._data[key] = value;
    this._save();
  }

  setMany(obj) {
    this._load();
    Object.assign(this._data, obj);
    this._save();
  }

  getAll() {
    this._load();
    return { ...this._data };
  }

  /** 获取当前使用的服务器基础 URL */
  getServerUrl() {
    const mode = this.get('serverMode');
    return mode === 'local' ? this.get('serverUrlLocal') : this.get('serverUrlProd');
  }
}

const configStore = new ConfigStore();
module.exports = configStore;

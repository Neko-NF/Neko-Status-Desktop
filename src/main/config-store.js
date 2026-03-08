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
  syncScreenshotInterval: true,   // 截图间隔是否与上报同步
  enableAutoStart: false,
  startupDelayMs: 5000,           // 自启动延迟 (ms)
  enableAutoServiceStart: false,  // 启动时自动开启上报服务
  // 关闭行为: 'ask' | 'minimize' | 'exit'
  closeAction: 'ask',
  // 界面配置
  themeMode: 0,                   // 0=系统, 1=浅色, 2=深色
  seedColor: '#06b6d4',
  debugEnabled: false,
  // 更新配置
  githubOwner: '',
  githubRepo: '',
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

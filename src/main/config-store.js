/**
 * config-store.js
 * Lightweight JSON-backed config store with no extra runtime dependency.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { DEFAULTS, mergeDefaults } = require('./config-store.helpers');

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
      this._data = mergeDefaults(JSON.parse(raw));
    } catch {
      this._data = mergeDefaults();
    }
  }

  _save() {
    try {
      fs.writeFileSync(this._getPath(), JSON.stringify(this._data, null, 2), 'utf8');
    } catch (error) {
      console.error('[Config] failed to save config:', error.message);
    }
  }

  get(key) {
    this._load();
    return this._data[key] !== undefined ? this._data[key] : DEFAULTS[key];
  }

  set(key, value) {
    this._load();
    if (key === 'streamConfig') {
      this._data.streamConfig = {
        ...DEFAULTS.streamConfig,
        ...(value || {}),
      };
    } else if (key === 'developerUiuxTuning') {
      this._data.developerUiuxTuning = {
        ...DEFAULTS.developerUiuxTuning,
        ...(value || {}),
      };
    } else if (key === 'developerScreenshotTuning') {
      this._data.developerScreenshotTuning = {
        ...DEFAULTS.developerScreenshotTuning,
        ...(value || {}),
      };
    } else if (key === 'activityDeviceBindings') {
      this._data.activityDeviceBindings = {
        version: 1,
        entries: {
          ...(value?.entries || {}),
        },
      };
    } else {
      this._data[key] = value;
    }
    this._save();
  }

  setMany(obj) {
    this._load();
    Object.assign(this._data, obj);
    if (Object.prototype.hasOwnProperty.call(obj, 'streamConfig')) {
      this._data.streamConfig = {
        ...DEFAULTS.streamConfig,
        ...(obj.streamConfig || {}),
      };
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'developerUiuxTuning')) {
      this._data.developerUiuxTuning = {
        ...DEFAULTS.developerUiuxTuning,
        ...(obj.developerUiuxTuning || {}),
      };
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'developerScreenshotTuning')) {
      this._data.developerScreenshotTuning = {
        ...DEFAULTS.developerScreenshotTuning,
        ...(obj.developerScreenshotTuning || {}),
      };
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'activityDeviceBindings')) {
      this._data.activityDeviceBindings = {
        version: 1,
        entries: {
          ...(obj.activityDeviceBindings?.entries || {}),
        },
      };
    }
    this._save();
  }

  getAll() {
    this._load();
    return mergeDefaults(this._data);
  }

  getServerUrl() {
    const mode = this.get('serverMode');
    return mode === 'local' ? this.get('serverUrlLocal') : this.get('serverUrlProd');
  }
}

const configStore = new ConfigStore();

module.exports = configStore;
module.exports.__private__ = {
  DEFAULTS,
  mergeDefaults,
};

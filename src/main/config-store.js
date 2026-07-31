/**
 * config-store.js
 * Lightweight JSON-backed config store with no extra runtime dependency.
 */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { DEFAULTS, mergeDefaults } = require('./config-store.helpers');
const { atomicWriteJson, parseJsonFile, readResilientJson } = require('./resilient-json-store');
const { decryptSafeValue, encryptSafeValue } = require('./secure-config.helpers');

const SENSITIVE_FIELDS = Object.freeze([
  { label: 'authToken', path: ['authToken'] },
  { label: 'authRefreshToken', path: ['authRefreshToken'] },
  { label: 'deviceKey', path: ['deviceKey'] },
  { label: 'githubToken', path: ['githubToken'] },
  { label: 'personalUpdateToken', path: ['personalUpdateToken'] },
  { label: 'streamKey', path: ['streamConfig', 'streamKey'] },
]);

class ConfigStore {
  constructor() {
    this._configPath = null;
    this._data = null;
    this._recoveryStatus = null;
  }

  _getPath() {
    if (!this._configPath) {
      this._configPath = path.join(app.getPath('userData'), 'neko-config.json');
    }
    return this._configPath;
  }

  _load() {
    if (this._data !== null) return;
    const result = readResilientJson(this._getPath());
    this._data = mergeDefaults(result.value || {});
    if (result.warning) {
      this._recoveryStatus = {
        source: result.source,
        message: result.warning,
        isolated: result.isolated,
      };
      console.error('[Config]', result.warning, result.isolated);
    }
    if (result.source !== 'corrupt') {
      this._migrateSensitiveValues();
    }
  }

  _save({ backup = true } = {}) {
    try {
      atomicWriteJson(this._getPath(), this._data, { backup });
      return true;
    } catch (error) {
      console.error('[Config] failed to save config:', error.message);
      return false;
    }
  }

  _secureValues() {
    if (!this._data._secure || typeof this._data._secure !== 'object') {
      this._data._secure = { version: 1, values: {} };
    }
    if (!this._data._secure.values || typeof this._data._secure.values !== 'object') {
      this._data._secure.values = {};
    }
    return this._data._secure.values;
  }

  _readPath(parts) {
    return parts.reduce((value, part) => value?.[part], this._data);
  }

  _writePath(parts, value) {
    let target = this._data;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!target[part] || typeof target[part] !== 'object') target[part] = {};
      target = target[part];
    }
    target[parts.at(-1)] = value;
  }

  _encryptionAvailable() {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  _encrypt(value) {
    return encryptSafeValue(safeStorage, value);
  }

  _decrypt(value) {
    return decryptSafeValue(safeStorage, value);
  }

  _migrateSensitiveValues() {
    if (!this._encryptionAvailable()) return;
    const secure = this._secureValues();
    const addedLabels = new Set();
    let removePlaintext = false;

    for (const field of SENSITIVE_FIELDS) {
      const plaintext = String(this._readPath(field.path) || '');
      const existing = secure[field.label];
      if (existing) {
        try {
          this._decrypt(existing);
          if (plaintext) removePlaintext = true;
          continue;
        } catch (error) {
          if (!plaintext) {
            this._recoveryStatus = {
              source: 'secure-value',
              message: `敏感配置 ${field.label} 无法解密，已保留密文并停止自动覆盖`,
              isolated: [],
            };
            console.error('[Config]', this._recoveryStatus.message, error.message);
            continue;
          }
        }
      }
      if (plaintext) {
        secure[field.label] = this._encrypt(plaintext);
        addedLabels.add(field.label);
        removePlaintext = true;
      }
    }

    if (addedLabels.size > 0) {
      if (!this._save({ backup: false })) return;
      const written = parseJsonFile(this._getPath());
      for (const field of SENSITIVE_FIELDS.filter((item) => addedLabels.has(item.label))) {
        const encrypted = written?._secure?.values?.[field.label];
        if (encrypted && this._decrypt(encrypted) !== String(this._readPath(field.path) || '')) {
          throw new Error(`sensitive migration verification failed for ${field.label}`);
        }
      }
    }
    if (removePlaintext) {
      for (const field of SENSITIVE_FIELDS) this._writePath(field.path, '');
      if (this._save({ backup: false })) {
        fs.copyFileSync(this._getPath(), `${this._getPath()}.bak`);
      }
    }
  }

  _getSensitive(field) {
    this._load();
    const encrypted = this._secureValues()[field.label];
    if (encrypted && this._encryptionAvailable()) {
      try {
        return this._decrypt(encrypted);
      } catch (error) {
        console.error(`[Config] failed to decrypt ${field.label}:`, error.message);
        return '';
      }
    }
    return this._readPath(field.path) || '';
  }

  _setSensitive(field, value) {
    const text = String(value || '');
    if (text && this._encryptionAvailable()) {
      this._secureValues()[field.label] = this._encrypt(text);
      this._writePath(field.path, '');
    } else if (!text) {
      delete this._secureValues()[field.label];
      this._writePath(field.path, '');
    } else {
      this._writePath(field.path, text);
      console.warn(`[Config] safeStorage unavailable; ${field.label} remains in legacy storage`);
    }
  }

  get(key) {
    this._load();
    const sensitive = SENSITIVE_FIELDS.find((field) => field.path.length === 1 && field.path[0] === key);
    if (sensitive) return this._getSensitive(sensitive);
    if (key === 'streamConfig') {
      return { ...this._data.streamConfig, streamKey: this._getSensitive(SENSITIVE_FIELDS.at(-1)) };
    }
    return this._data[key] !== undefined ? this._data[key] : DEFAULTS[key];
  }

  set(key, value) {
    this._load();
    const sensitive = SENSITIVE_FIELDS.find((field) => field.path.length === 1 && field.path[0] === key);
    if (sensitive) {
      this._setSensitive(sensitive, value);
    } else if (key === 'streamConfig') {
      this._data.streamConfig = {
        ...DEFAULTS.streamConfig,
        ...(value || {}),
      };
      this._setSensitive(SENSITIVE_FIELDS.at(-1), value?.streamKey || '');
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
    for (const field of SENSITIVE_FIELDS.filter((item) => item.path.length === 1)) {
      if (Object.prototype.hasOwnProperty.call(obj, field.label)) {
        this._setSensitive(field, obj[field.label]);
      }
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'streamConfig')) {
      this._data.streamConfig = {
        ...DEFAULTS.streamConfig,
        ...(obj.streamConfig || {}),
      };
      this._setSensitive(SENSITIVE_FIELDS.at(-1), obj.streamConfig?.streamKey || '');
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
    const logical = mergeDefaults(this._data);
    for (const field of SENSITIVE_FIELDS.filter((item) => item.path.length === 1)) {
      logical[field.label] = this._getSensitive(field);
    }
    logical.streamConfig = {
      ...logical.streamConfig,
      streamKey: this._getSensitive(SENSITIVE_FIELDS.at(-1)),
    };
    delete logical._secure;
    return logical;
  }

  getRecoveryStatus() {
    this._load();
    return this._recoveryStatus ? { ...this._recoveryStatus } : null;
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

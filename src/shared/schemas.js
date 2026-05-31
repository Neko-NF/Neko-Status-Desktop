const {
  DEVELOPER_SCREENSHOT_FORMATS,
  DEVELOPER_SCREENSHOT_TUNING_RANGES,
} = require('./screenshot-tuning');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateUpdateInstallPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'payload must be an object' };
  }

  if (typeof payload.filePath !== 'string' || payload.filePath.trim() === '') {
    return { ok: false, reason: 'filePath is required' };
  }

  if (
    payload.expectedSha256 !== undefined &&
    payload.expectedSha256 !== null &&
    typeof payload.expectedSha256 !== 'string'
  ) {
    return { ok: false, reason: 'expectedSha256 must be a string when provided' };
  }

  return { ok: true };
}

function validateUpdateDownloadPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'payload must be an object' };
  }

  if (typeof payload.url !== 'string' || payload.url.trim() === '') {
    return { ok: false, reason: 'url is required' };
  }

  return { ok: true };
}

function validateAuthCredentialsPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'payload must be an object' };
  }

  if (typeof payload.username !== 'string' || payload.username.trim() === '') {
    return { ok: false, reason: 'username is required' };
  }

  if (typeof payload.password !== 'string' || payload.password === '') {
    return { ok: false, reason: 'password is required' };
  }

  return { ok: true };
}

function validateAuthUpdateProfilePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'payload must be an object' };
  }

  const optionalStringFields = ['username', 'email', 'avatar', 'currentPassword', 'newPassword'];
  for (const field of optionalStringFields) {
    if (payload[field] !== undefined && typeof payload[field] !== 'string') {
      return { ok: false, reason: `${field} must be a string when provided` };
    }
  }

  if (payload.username !== undefined && payload.username.trim() === '') {
    return { ok: false, reason: 'username cannot be empty when provided' };
  }

  if (payload.newPassword && !payload.currentPassword) {
    return { ok: false, reason: 'currentPassword is required when changing password' };
  }

  return { ok: true };
}

function validateConfigKeyPayload(key) {
  if (typeof key !== 'string' || key.trim() === '') {
    return { ok: false, reason: 'config key must be a non-empty string' };
  }

  return { ok: true };
}

function validateConfigValuesPayload(values) {
  if (!isPlainObject(values)) {
    return { ok: false, reason: 'config values must be an object' };
  }

  return { ok: true };
}

function validateStreamConfigPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'payload must be an object' };
  }

  const optionalStringFields = ['srsHost', 'srsApp', 'obsWsHost', 'obsWsPassword'];
  for (const field of optionalStringFields) {
    if (payload[field] !== undefined && typeof payload[field] !== 'string') {
      return { ok: false, reason: `${field} must be a string when provided` };
    }
  }

  const optionalPortFields = ['srsRtmpPort', 'srsApiPort', 'obsWsPort', 'port'];
  for (const field of optionalPortFields) {
    if (payload[field] === undefined) continue;
    const port = Number(payload[field]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, reason: `${field} must be a valid TCP port` };
    }
  }

  return { ok: true };
}

const DEVELOPER_MODE_COMMAND_ACTIONS = new Set([
  'disable',
  'panel-closed',
  'request-state',
  'toggle-inspect',
  'toggle-include-hidden',
  'refresh-backend',
  'rescan',
  'open-main-devtools',
  'open-panel-devtools',
  'reload-main-window',
  'reload-panel-window',
  'focus-main-window',
  'toggle-update-source-mode',
  'toggle-auto-check-update',
  'toggle-auto-download',
  'run-health-check',
  'run-update-integrity',
  'clear-cache',
  'set-uiux-token',
  'reset-uiux-tokens',
  'set-screenshot-token',
  'reset-screenshot-tokens',
]);

const DEVELOPER_UIUX_TOKENS = Object.freeze({
  radiusCard: { min: 8, max: 40 },
  radiusButton: { min: 4, max: 28 },
  glassOpacity: { min: 2, max: 24 },
  fontScale: { min: 85, max: 120 },
  textOpacity: { min: 40, max: 95 },
});

function validateDeveloperModeCommandPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'payload must be an object' };
  }

  if (!DEVELOPER_MODE_COMMAND_ACTIONS.has(payload.action)) {
    return { ok: false, reason: 'unsupported developer mode action' };
  }

  if (payload.action === 'set-uiux-token') {
    const token = payload.token;
    const value = Number(payload.value);
    const range = DEVELOPER_UIUX_TOKENS[token];
    if (!range) return { ok: false, reason: 'unsupported UIUX token' };
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      return { ok: false, reason: 'UIUX token value is out of range' };
    }
  }

  if (payload.action === 'set-screenshot-token') {
    const token = payload.token;
    if (token === 'uploadFormat') {
      if (!DEVELOPER_SCREENSHOT_FORMATS.includes(payload.value)) {
        return { ok: false, reason: 'unsupported screenshot upload format' };
      }
      return { ok: true };
    }
    const value = Number(payload.value);
    const range = DEVELOPER_SCREENSHOT_TUNING_RANGES[token];
    if (!range) return { ok: false, reason: 'unsupported screenshot tuning token' };
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      return { ok: false, reason: 'screenshot tuning value is out of range' };
    }
  }

  return { ok: true };
}

function validateDeveloperModePanelStatePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'payload must be an object' };
  }

  const booleanFields = ['enabled', 'uiInspect', 'includeHidden'];
  for (const field of booleanFields) {
    if (payload[field] !== undefined && typeof payload[field] !== 'boolean') {
      return { ok: false, reason: `${field} must be a boolean when provided` };
    }
  }

  const objectFields = ['backend', 'selectedInfo', 'theme', 'uiuxTuning', 'screenshotTuning', 'screenshotDebug'];
  for (const field of objectFields) {
    if (payload[field] !== undefined && payload[field] !== null && !isPlainObject(payload[field])) {
      return { ok: false, reason: `${field} must be an object when provided` };
    }
  }

  return { ok: true };
}

module.exports = {
  isPlainObject,
  validateUpdateInstallPayload,
  validateUpdateDownloadPayload,
  validateAuthCredentialsPayload,
  validateAuthUpdateProfilePayload,
  validateConfigKeyPayload,
  validateConfigValuesPayload,
  validateStreamConfigPayload,
  validateDeveloperModeCommandPayload,
  validateDeveloperModePanelStatePayload,
};

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

module.exports = {
  isPlainObject,
  validateUpdateInstallPayload,
  validateUpdateDownloadPayload,
  validateAuthCredentialsPayload,
  validateAuthUpdateProfilePayload,
  validateConfigKeyPayload,
  validateConfigValuesPayload,
  validateStreamConfigPayload,
};

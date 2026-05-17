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

module.exports = {
  isPlainObject,
  validateUpdateInstallPayload,
  validateUpdateDownloadPayload,
};

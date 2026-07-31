'use strict';

const DEVICE_CREDENTIAL_ERROR_CODES = new Set([
  'DEVICE_CREDENTIAL_INVALID',
  'KEY_REVOKED',
  'KEY_NOT_FOUND',
]);

function parseRetryAfterSeconds(value, nowMs = Date.now()) {
  const raw = String(value || '').trim();
  if (!raw) return 60;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.max(1, Math.ceil(numeric));
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return 60;
  return Math.max(1, Math.ceil((dateMs - nowMs) / 1000));
}

function calculateNetworkBackoffMs(failureCount, random = Math.random) {
  const exponent = Math.max(0, Math.min(Number(failureCount || 1) - 1, 6));
  const baseMs = Math.min(300000, 5000 * (2 ** exponent));
  const jitter = 0.8 + Math.max(0, Math.min(1, Number(random()))) * 0.4;
  return Math.min(300000, Math.max(1000, Math.round(baseMs * jitter)));
}

function isNetworkFailure(error) {
  return error?.transient === true
    || error?.status >= 500
    || ([401, 403, 404].includes(error?.status) && error?.trustedJson !== true)
    || /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|abort|socket|TLS|certificate/i.test(String(error?.message || ''));
}

module.exports = {
  DEVICE_CREDENTIAL_ERROR_CODES,
  calculateNetworkBackoffMs,
  isNetworkFailure,
  parseRetryAfterSeconds,
};

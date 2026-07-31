const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateNetworkBackoffMs,
  isNetworkFailure,
  parseRetryAfterSeconds,
} = require('../../src/main/report-recovery-policy');

test('network retries start near five seconds and remain capped without a retry limit', () => {
  assert.equal(calculateNetworkBackoffMs(1, () => 0.5), 5000);
  assert.equal(calculateNetworkBackoffMs(7, () => 0.5), 300000);
  assert.equal(calculateNetworkBackoffMs(10000, () => 1), 300000);
});

test('ambiguous auth-shaped responses remain network failures', () => {
  assert.equal(isNetworkFailure({ status: 401, trustedJson: false }), true);
  assert.equal(isNetworkFailure({ status: 404 }), true);
  assert.equal(isNetworkFailure({ status: 401, trustedJson: true, code: 'DEVICE_CREDENTIAL_INVALID' }), false);
});

test('Retry-After accepts both delta seconds and HTTP dates', () => {
  const now = Date.parse('2026-07-31T00:00:00Z');
  assert.equal(parseRetryAfterSeconds('15', now), 15);
  assert.equal(parseRetryAfterSeconds('Fri, 31 Jul 2026 00:02:00 GMT', now), 120);
  assert.equal(parseRetryAfterSeconds('invalid', now), 60);
});

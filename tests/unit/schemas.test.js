const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAuthCredentialsPayload,
  validateAuthUpdateProfilePayload,
  validateConfigKeyPayload,
  validateConfigValuesPayload,
  validateDeveloperModeCommandPayload,
  validateDeveloperModePanelStatePayload,
  validateStreamConfigPayload,
  validateUpdateDownloadPayload,
  validateUpdateInstallPayload,
} = require('../../src/shared/schemas');

test('validateUpdateDownloadPayload accepts a URL string', () => {
  assert.deepEqual(validateUpdateDownloadPayload({ url: 'https://example.com/app.exe' }), {
    ok: true,
  });
});

test('validateUpdateDownloadPayload rejects invalid payloads', () => {
  assert.equal(validateUpdateDownloadPayload(null).ok, false);
  assert.equal(validateUpdateDownloadPayload({}).ok, false);
});

test('validateUpdateInstallPayload enforces filePath', () => {
  assert.deepEqual(
    validateUpdateInstallPayload({ filePath: 'C:\\tmp\\update.exe', expectedSha256: 'abc' }),
    { ok: true },
  );
  assert.equal(validateUpdateInstallPayload({ expectedSha256: 'abc' }).ok, false);
});

test('validateAuthCredentialsPayload requires username and password', () => {
  assert.deepEqual(validateAuthCredentialsPayload({ username: 'alice', password: 'secret' }), {
    ok: true,
  });
  assert.equal(validateAuthCredentialsPayload({ username: '', password: 'secret' }).ok, false);
  assert.equal(validateAuthCredentialsPayload({ username: 'alice' }).ok, false);
});

test('validateAuthUpdateProfilePayload validates optional fields', () => {
  assert.deepEqual(validateAuthUpdateProfilePayload({ username: 'alice', email: '' }), {
    ok: true,
  });
  assert.equal(validateAuthUpdateProfilePayload({ username: '' }).ok, false);
  assert.equal(validateAuthUpdateProfilePayload({ newPassword: 'new-pass' }).ok, false);
  assert.equal(validateAuthUpdateProfilePayload({ currentPassword: 'old', newPassword: 'new-pass' }).ok, true);
});

test('validateConfig payload helpers reject invalid keys and setMany values', () => {
  assert.equal(validateConfigKeyPayload('deviceKey').ok, true);
  assert.equal(validateConfigKeyPayload('').ok, false);
  assert.equal(validateConfigValuesPayload({ deviceKey: 'abc' }).ok, true);
  assert.equal(validateConfigValuesPayload(null).ok, false);
});

test('validateStreamConfigPayload validates port-shaped fields', () => {
  assert.equal(validateStreamConfigPayload({ srsHost: 'example.com', srsRtmpPort: 1935 }).ok, true);
  assert.equal(validateStreamConfigPayload({ obsWsPort: 70000 }).ok, false);
  assert.equal(validateStreamConfigPayload({ srsHost: 123 }).ok, false);
});

test('developer mode payload validators keep sidecar commands controlled', () => {
  assert.equal(validateDeveloperModeCommandPayload({ action: 'refresh-backend' }).ok, true);
  [
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
    'reset-uiux-tokens',
    'reset-screenshot-tokens',
  ].forEach((action) => {
    assert.equal(validateDeveloperModeCommandPayload({ action }).ok, true);
  });
  assert.equal(validateDeveloperModeCommandPayload({ action: 'set-uiux-token', token: 'radiusCard', value: 24 }).ok, true);
  assert.equal(validateDeveloperModeCommandPayload({ action: 'set-uiux-token', token: 'radiusCard', value: 80 }).ok, false);
  assert.equal(validateDeveloperModeCommandPayload({ action: 'set-uiux-token', token: 'unknown', value: 12 }).ok, false);
  assert.equal(validateDeveloperModeCommandPayload({ action: 'set-screenshot-token', token: 'targetKb', value: 2048 }).ok, true);
  assert.equal(validateDeveloperModeCommandPayload({ action: 'set-screenshot-token', token: 'uploadFormat', value: 'jpeg' }).ok, true);
  assert.equal(validateDeveloperModeCommandPayload({ action: 'set-screenshot-token', token: 'uploadFormat', value: 'webp' }).ok, false);
  assert.equal(validateDeveloperModeCommandPayload({ action: 'set-screenshot-token', token: 'targetKb', value: 128 }).ok, false);
  assert.equal(validateDeveloperModeCommandPayload({ action: 'set-screenshot-token', token: 'unknown', value: 2048 }).ok, false);
  assert.equal(validateDeveloperModeCommandPayload({ action: 'run-shell' }).ok, false);
  assert.equal(validateDeveloperModePanelStatePayload({
    enabled: true,
    backend: { ipcReady: true },
    uiuxTuning: { radiusCard: 24 },
    screenshotTuning: { targetKb: 2048 },
    screenshotDebug: { hasScreenshot: true },
  }).ok, true);
  assert.equal(validateDeveloperModePanelStatePayload({ includeHidden: 'true' }).ok, false);
});

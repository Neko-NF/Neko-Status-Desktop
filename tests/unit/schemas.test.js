const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAuthCredentialsPayload,
  validateAuthUpdateProfilePayload,
  validateConfigKeyPayload,
  validateConfigValuesPayload,
  validateDeveloperModeCommandPayload,
  validateDeveloperModePanelStatePayload,
  validateAnnouncementPayload,
  validateAnnouncementReceiptPayload,
  validateActivitySettingsPayload,
  validateActivityManagePayload,
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

test('validateAnnouncementPayload validates create and partial update payloads', () => {
  assert.deepEqual(validateAnnouncementPayload({
    title: 'Maintenance',
    content: 'Window starts at 02:00',
    type: 'warning',
    category: 'it',
    targetAudience: 'All staff',
    status: 'published',
    pinned: true,
    priority: 8,
    showPopup: true,
    pushNotification: false,
    totalAudience: 120,
    expiresAt: '2026-06-03T12:00:00.000Z',
  }), { ok: true });

  assert.equal(validateAnnouncementPayload({ title: 'Only title' }).ok, false);
  assert.equal(validateAnnouncementPayload({ title: 'Only title' }, { partial: true }).ok, true);
  assert.equal(validateAnnouncementPayload({ priority: 11 }, { partial: true }).ok, false);
  assert.equal(validateAnnouncementPayload({ category: 'unknown' }, { partial: true }).ok, false);
  assert.equal(validateAnnouncementPayload({ status: 'deleted' }, { partial: true }).ok, false);
  assert.equal(validateAnnouncementPayload({ showPopup: 'yes' }, { partial: true }).ok, false);
  assert.equal(validateAnnouncementPayload({ acknowledges: -1 }, { partial: true }).ok, false);
  assert.equal(validateAnnouncementPayload({ expiresAt: 'not-a-date' }, { partial: true }).ok, false);
});

test('validateAnnouncementReceiptPayload validates id and action', () => {
  assert.equal(validateAnnouncementReceiptPayload({ id: 1, action: 'view' }).ok, true);
  assert.equal(validateAnnouncementReceiptPayload({ id: '2', action: 'ack' }).ok, true);
  assert.equal(validateAnnouncementReceiptPayload({ id: '' }).ok, false);
  assert.equal(validateAnnouncementReceiptPayload({ id: 1, action: 'dismiss' }).ok, false);
});

test('activity payload validators keep settings and management actions controlled', () => {
  assert.equal(validateActivitySettingsPayload({
    enabled: true,
    publishing: false,
    snapshots: true,
    background: true,
    autoStart: true,
  }).ok, true);
  assert.equal(validateActivitySettingsPayload({ enabled: 'yes' }).ok, false);
  assert.equal(validateActivitySettingsPayload({ snapshots: 'yes' }).ok, false);
  assert.equal(validateActivitySettingsPayload(null).ok, false);

  assert.equal(validateActivityManagePayload({ action: 'searchUsers', data: { q: 'alice' } }).ok, true);
  assert.equal(validateActivityManagePayload({ action: 'setPrivacy', data: { visibility: 'followers' } }).ok, true);
  assert.equal(validateActivityManagePayload({ action: 'run-shell', data: {} }).ok, false);
  assert.equal(validateActivityManagePayload({ action: 'follow', data: 'not-object' }).ok, false);
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

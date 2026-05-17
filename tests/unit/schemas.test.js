const test = require('node:test');
const assert = require('node:assert/strict');
const {
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

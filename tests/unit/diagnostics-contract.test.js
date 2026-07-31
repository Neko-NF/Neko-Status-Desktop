const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DIAGNOSTIC_SCHEMA_VERSION,
  CONSENT_POLICY_VERSION,
  listDiagnosticContributions,
} = require('../../src/main/diagnostics-registry');
const { redactDiagnostics } = require('../../src/main/diagnostics-redactor');

test('diagnostic registry is versioned and every contribution declares privacy and size policy', () => {
  assert.equal(DIAGNOSTIC_SCHEMA_VERSION, 1);
  assert.equal(CONSENT_POLICY_VERSION, 1);
  const contributions = listDiagnosticContributions();
  assert.ok(contributions.length >= 5);
  for (const contribution of contributions) {
    assert.match(contribution.featureId, /^[a-z0-9][a-z0-9._-]+$/);
    assert.ok(contribution.events.length > 0);
    assert.ok(contribution.fingerprintFields.length > 0);
    for (const policy of Object.values(contribution.fields)) {
      assert.ok(policy.type);
      assert.ok(policy.privacy);
      assert.ok(policy.redaction);
      assert.ok(policy.maxBytes > 0);
    }
  }
});

test('client redaction removes prohibited data while retaining authorized raw paths and window titles', () => {
  const redacted = redactDiagnostics({
    windowTitle: '编辑 D:\\Projects\\neko\\main.js - Visual Studio Code',
    fullPath: 'D:\\Projects\\neko\\main.js',
    email: 'user@example.test',
    Authorization: 'Bearer top-secret',
    nested: { refreshToken: 'refresh-secret', clipboardText: 'private text' },
    stack: 'Error: user@example.test deviceKey=opaque-secret\n at D:\\Projects\\neko\\main.js:10:2',
  });

  assert.equal(redacted.windowTitle, '编辑 D:\\Projects\\neko\\main.js - Visual Studio Code');
  assert.equal(redacted.fullPath, 'D:\\Projects\\neko\\main.js');
  assert.equal(redacted.email, '[REDACTED]');
  assert.equal(redacted.Authorization, '[REDACTED]');
  assert.equal(redacted.nested.refreshToken, '[REDACTED]');
  assert.equal(redacted.nested.clipboardText, '[REDACTED]');
  assert.doesNotMatch(redacted.stack, /user@example\.test/);
  assert.doesNotMatch(redacted.stack, /opaque-secret/);
});

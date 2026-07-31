const DIAGNOSTIC_SCHEMA_VERSION = 1;
const CONSENT_POLICY_VERSION = 1;

const contributions = new Map();

function registerDiagnosticContribution(contribution) {
  const required = ['featureId', 'contributionVersion', 'docSection', 'fields', 'events', 'fingerprintFields', 'tests'];
  for (const field of required) {
    if (!contribution || contribution[field] === undefined) throw new Error(`diagnostic contribution missing ${field}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,95}$/.test(contribution.featureId)) {
    throw new Error(`invalid diagnostic featureId: ${contribution.featureId}`);
  }
  if (contributions.has(contribution.featureId)) throw new Error(`duplicate diagnostic featureId: ${contribution.featureId}`);
  contributions.set(contribution.featureId, Object.freeze({ ...contribution }));
}

function listDiagnosticContributions() {
  return [...contributions.values()];
}

[
  {
    featureId: 'core.config', contributionVersion: 1,
    docSection: '7.1 core.config',
    fields: { recoverySource: { type: 'string', privacy: 'operational', redaction: 'allowlist', maxBytes: 64 }, isolatedCount: { type: 'integer', privacy: 'operational', redaction: 'none', maxBytes: 16 } },
    events: ['CONFIG_RECOVERED', 'CONFIG_UNRECOVERABLE'], fingerprintFields: ['errorCode', 'recoverySource'],
    tests: ['tests/unit/diagnostics-contract.test.js'],
  },
  {
    featureId: 'core.auth', contributionVersion: 1,
    docSection: '7.2 core.auth',
    fields: { sessionState: { type: 'string', privacy: 'operational', redaction: 'allowlist', maxBytes: 32 }, serverMode: { type: 'string', privacy: 'configuration', redaction: 'allowlist', maxBytes: 32 } },
    events: ['AUTH_SESSION_UNRECOVERABLE'], fingerprintFields: ['errorCode', 'sessionState'],
    tests: ['tests/unit/diagnostics-contract.test.js'],
  },
  {
    featureId: 'core.status-report', contributionVersion: 1,
    docSection: '7.3 core.status-report',
    fields: { serviceState: { type: 'string', privacy: 'operational', redaction: 'allowlist', maxBytes: 32 }, failureCount: { type: 'integer', privacy: 'operational', redaction: 'none', maxBytes: 16 } },
    events: ['STATUS_CONTINUOUS_FAILURE', 'STATUS_INTERNAL_ERROR'], fingerprintFields: ['errorCode', 'serviceState'],
    tests: ['tests/unit/diagnostics-contract.test.js'],
  },
  {
    featureId: 'core.renderer', contributionVersion: 1,
    docSection: '7.4 core.renderer',
    fields: { reason: { type: 'string', privacy: 'operational', redaction: 'pattern', maxBytes: 128 }, exitCode: { type: 'integer', privacy: 'operational', redaction: 'none', maxBytes: 16 } },
    events: ['RENDERER_GONE', 'RENDERER_LOAD_FAILED', 'UNHANDLED_EXCEPTION'], fingerprintFields: ['errorCode', 'primaryStackFrame'],
    tests: ['tests/unit/diagnostics-contract.test.js'],
  },
  {
    featureId: 'core.update', contributionVersion: 1,
    docSection: '7.5 core.update',
    fields: { stage: { type: 'string', privacy: 'operational', redaction: 'allowlist', maxBytes: 64 }, version: { type: 'string', privacy: 'operational', redaction: 'version', maxBytes: 64 } },
    events: ['UPDATE_CRITICAL_FAILURE'], fingerprintFields: ['errorCode', 'stage'],
    tests: ['tests/unit/diagnostics-contract.test.js'],
  },
].forEach(registerDiagnosticContribution);

module.exports = {
  DIAGNOSTIC_SCHEMA_VERSION,
  CONSENT_POLICY_VERSION,
  registerDiagnosticContribution,
  listDiagnosticContributions,
};

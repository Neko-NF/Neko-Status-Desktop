const fs = require('fs');
const path = require('path');
const {
  CONSENT_POLICY_VERSION,
  DIAGNOSTIC_SCHEMA_VERSION,
  listDiagnosticContributions,
} = require('../src/main/diagnostics-registry');

const root = path.resolve(__dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const spec = fs.readFileSync(path.join(root, 'docs/diagnostics-improvement-program.md'), 'utf8');
const golden = readJson('docs/diagnostic-schema-v1.golden.json');
const manifest = readJson('docs/feature-diagnostics-manifest.json');

function fail(message) {
  process.stderr.write(`[diagnostics-contract] ${message}\n`);
  process.exitCode = 1;
}

if (golden.diagnosticSchemaVersion !== DIAGNOSTIC_SCHEMA_VERSION) fail('registry schema version does not match golden schema');
if (golden.consentPolicyVersion !== CONSENT_POLICY_VERSION) fail('consent policy version does not match golden schema');
if (!spec.includes(`diagnosticSchemaVersion = ${DIAGNOSTIC_SCHEMA_VERSION}`)) fail('spec does not declare current schema version');
if (!spec.includes(`consentPolicyVersion = ${CONSENT_POLICY_VERSION}`)) fail('spec does not declare current consent version');

const contributions = listDiagnosticContributions();
const ids = new Set(contributions.map((item) => item.featureId));
for (const contribution of contributions) {
  if (!spec.includes(`### ${contribution.docSection}`)) fail(`${contribution.featureId} references a missing documentation section`);
  for (const [field, policy] of Object.entries(contribution.fields)) {
    if (!policy.type || !policy.privacy || !policy.redaction || !Number.isFinite(policy.maxBytes)) {
      fail(`${contribution.featureId}.${field} lacks type/privacy/redaction/maxBytes`);
    }
  }
  for (const testPath of contribution.tests) {
    if (!fs.existsSync(path.join(root, testPath))) fail(`${contribution.featureId} references missing test ${testPath}`);
  }
}

const manifestBySource = new Map();
for (const entry of manifest.features || []) {
  if (manifestBySource.has(entry.source)) fail(`duplicate feature manifest source ${entry.source}`);
  manifestBySource.set(entry.source, entry);
  if (entry.diagnostics === 'contribution' && !ids.has(entry.featureId)) fail(`${entry.source} references unknown contribution ${entry.featureId}`);
  if (entry.diagnostics === 'none' && !entry.reason) fail(`${entry.source} diagnostics:none requires a reason`);
  if (!['contribution', 'none'].includes(entry.diagnostics)) fail(`${entry.source} has invalid diagnostics policy`);
}

const featureSources = [
  ...fs.readdirSync(path.join(root, 'src/main'))
    .filter((name) => /(?:-service|config-store|app-shell|startup-update-gate)\.js$/.test(name))
    .map((name) => `src/main/${name}`),
  ...fs.readdirSync(path.join(root, 'src/renderer/js/pages'))
    .filter((name) => name.endsWith('.page.js'))
    .map((name) => `src/renderer/js/pages/${name}`),
];
for (const source of featureSources) {
  if (!manifestBySource.has(source)) fail(`feature source has no explicit diagnostics policy: ${source}`);
}

if (!process.exitCode) process.stdout.write(`[diagnostics-contract] schema v${DIAGNOSTIC_SCHEMA_VERSION}, ${contributions.length} contributions, ${featureSources.length} feature sources OK\n`);

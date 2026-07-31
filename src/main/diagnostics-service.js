const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const configStore = require('./config-store');
const apiService = require('./api-service');
const { atomicWriteJson } = require('./resilient-json-store');
const { redactDiagnostics } = require('./diagnostics-redactor');
const {
  CONSENT_POLICY_VERSION,
  DIAGNOSTIC_SCHEMA_VERSION,
  listDiagnosticContributions,
} = require('./diagnostics-registry');
const { runtimeSessionId } = require('./runtime-session');
const { version: clientVersion } = require('../../package.json');

const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_QUEUE_COUNT = 20;
const MAX_QUEUE_BYTES = 20 * 1024 * 1024;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;

class DiagnosticsService {
  constructor() {
    this._logs = [];
    this._statusService = null;
    this._flushPromise = null;
    this._timer = null;
  }

  initialize({ statusService } = {}) {
    this._statusService = statusService || this._statusService;
    this._cleanupQueue();
    if (this.isEnabled()) this.flush().catch(() => {});
    else this.clearQueue();
    if (!this._timer) {
      this._timer = setInterval(() => this.flush().catch(() => {}), 10 * 60 * 1000);
      this._timer.unref?.();
    }
  }

  isEnabled() {
    return configStore.get('diagnosticsImprovementEnabled') === true
      && configStore.get('diagnosticsConsentPolicyVersion') === CONSENT_POLICY_VERSION;
  }

  onConsentChanged(enabled) {
    if (enabled) {
      configStore.setMany({
        diagnosticsImprovementEnabled: true,
        diagnosticsConsentPolicyVersion: CONSENT_POLICY_VERSION,
      });
      this.flush().catch(() => {});
    } else {
      configStore.setMany({ diagnosticsImprovementEnabled: false, diagnosticsConsentPolicyVersion: 0 });
      this._logs = [];
      this.clearQueue();
    }
  }

  recordLog(level, message, time = new Date().toISOString()) {
    if (!this.isEnabled()) return;
    this._logs.push(redactDiagnostics({ time, level, message: String(message || '') }));
    if (this._logs.length > 1000) this._logs.splice(0, this._logs.length - 1000);
  }

  _queueDir() {
    return path.join(app.getPath('userData'), 'diagnostics-queue');
  }

  _queueFiles() {
    const directory = this._queueDir();
    fs.mkdirSync(directory, { recursive: true });
    return fs.readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(directory, name));
  }

  _read(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
  }

  _remove(filePath) {
    try { fs.unlinkSync(filePath); } catch { /* already removed */ }
    try { fs.unlinkSync(`${filePath}.bak`); } catch { /* no backup */ }
  }

  _cleanupQueue() {
    const now = Date.now();
    let entries = this._queueFiles().map((filePath) => ({
      filePath,
      data: this._read(filePath),
      stat: fs.statSync(filePath),
    }));
    for (const entry of entries) {
      const occurredAt = Date.parse(entry.data?.occurredAt || '') || entry.stat.mtimeMs;
      if (!entry.data || now - occurredAt > MAX_AGE_MS) this._remove(entry.filePath);
    }
    entries = this._queueFiles().map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
    let total = entries.reduce((sum, entry) => sum + entry.stat.size, 0);
    while (entries.length > MAX_QUEUE_COUNT || total > MAX_QUEUE_BYTES) {
      const oldest = entries.shift();
      total -= oldest.stat.size;
      this._remove(oldest.filePath);
    }
  }

  clearQueue() {
    for (const filePath of this._queueFiles()) this._remove(filePath);
  }

  _nonSensitiveConfig() {
    const keys = [
      'serverMode', 'reportInterval', 'enableScreenshot', 'screenshotInterval',
      'enableAutoStart', 'startupDelayMs', 'enableAutoServiceStart', 'closeAction',
      'enableAutoRestart', 'maxRestarts', 'watchdogTimeoutSec', 'updateChannel',
      'autoCheckUpdate', 'autoDownload', 'themeMode', 'uiScale',
    ];
    return Object.fromEntries(keys.map((key) => [key, configStore.get(key)]));
  }

  _fingerprint(trigger) {
    const normalized = String(trigger.message || '')
      .toLowerCase().replace(/\b\d{2,}\b/g, '<n>').replace(/\s+/g, ' ').trim();
    const frame = String(trigger.stack || '').split(/\r?\n/).find((line) => /\bat\b|:\d+:\d+/.test(line)) || '';
    return crypto.createHash('sha256')
      .update([trigger.featureId, trigger.errorCode, normalized, process.platform, frame].join('\n'))
      .digest('hex');
  }

  _buildEnvelope(trigger, featureData) {
    const contribution = listDiagnosticContributions().find((item) => item.featureId === trigger.featureId);
    if (!contribution) throw new Error(`unregistered diagnostic feature: ${trigger.featureId}`);
    const clientFingerprint = this._fingerprint(trigger);
    const featureSections = {
      'core.config': { contributionVersion: 1, data: this._nonSensitiveConfig() },
      'core.status-report': {
        contributionVersion: 1,
        data: this._statusService?.getRecoveryStats?.() || {},
      },
    };
    featureSections[trigger.featureId] = {
      contributionVersion: contribution.contributionVersion,
      data: { ...(featureSections[trigger.featureId]?.data || {}), ...(featureData || {}) },
    };
    return redactDiagnostics({
      reportId: crypto.randomUUID(),
      diagnosticSchemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      consentPolicyVersion: CONSENT_POLICY_VERSION,
      occurredAt: new Date().toISOString(),
      clientFingerprint,
      occurrences: 1,
      lastOccurrenceAt: new Date().toISOString(),
      client: { version: clientVersion, platform: process.platform, runtimeSessionId },
      trigger: {
        type: trigger.type || 'exception',
        featureId: trigger.featureId,
        errorCode: trigger.errorCode,
        severity: trigger.severity || 'error',
        message: trigger.message || '',
        stack: trigger.stack || '',
      },
      environment: {
        osType: os.type(), osRelease: os.release(), arch: os.arch(),
        cpuModel: os.cpus()[0]?.model || '', cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(), processUptimeSec: Math.round(process.uptime()),
      },
      featureSections,
      recentLogs: this._logs.slice(-1000),
    });
  }

  async capture(trigger, featureData = {}) {
    if (!this.isEnabled()) return { skipped: 'consent_disabled' };
    let envelope = this._buildEnvelope(trigger, featureData);
    let serialized = JSON.stringify(envelope);
    while (Buffer.byteLength(serialized, 'utf8') > MAX_PACKAGE_BYTES && envelope.recentLogs.length > 0) {
      envelope.recentLogs.splice(0, Math.min(100, envelope.recentLogs.length));
      serialized = JSON.stringify(envelope);
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PACKAGE_BYTES) return { skipped: 'package_too_large' };

    const duplicate = this._queueFiles().map((filePath) => ({ filePath, data: this._read(filePath) }))
      .find((entry) => entry.data?.clientFingerprint === envelope.clientFingerprint
        && Date.now() - Date.parse(entry.data.lastOccurrenceAt || entry.data.occurredAt) < DEDUP_WINDOW_MS);
    if (duplicate) {
      duplicate.data.occurrences = Number(duplicate.data.occurrences || 1) + 1;
      duplicate.data.lastOccurrenceAt = new Date().toISOString();
      atomicWriteJson(duplicate.filePath, redactDiagnostics(duplicate.data), { backup: false });
      this.flush().catch(() => {});
      return { queued: true, deduplicated: true, reportId: duplicate.data.reportId };
    }

    const filePath = path.join(this._queueDir(), `${envelope.reportId}.json`);
    atomicWriteJson(filePath, envelope, { backup: false });
    this._cleanupQueue();
    this.flush().catch(() => {});
    return { queued: true, reportId: envelope.reportId };
  }

  async flush() {
    if (!this.isEnabled()) return { skipped: 'consent_disabled' };
    if (this._flushPromise) return this._flushPromise;
    this._flushPromise = this._flush().finally(() => { this._flushPromise = null; });
    return this._flushPromise;
  }

  async _flush() {
    const credential = configStore.get('deviceKey') || configStore.get('authToken');
    if (!credential) return { skipped: 'no_credential' };
    const capabilities = await apiService.getDiagnosticsCapabilities();
    if (!capabilities?.diagnosticsUpload || capabilities.diagnosticSchemaVersionMax < 1) {
      return { skipped: 'server_unsupported' };
    }
    let sent = 0;
    for (const filePath of this._queueFiles()) {
      const report = this._read(filePath);
      if (!report) { this._remove(filePath); continue; }
      try {
        await apiService.uploadDiagnosticReport(credential, redactDiagnostics(report));
        this._remove(filePath);
        sent += 1;
      } catch {
        // Upload is isolated from every core feature; keep the package for a later attempt.
      }
    }
    this._cleanupQueue();
    return { sent, pending: this._queueFiles().length };
  }
}

module.exports = new DiagnosticsService();

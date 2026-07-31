const { app } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const configStore = require('./config-store');
const apiService = require('./api-service');
const { atomicWriteJson, readResilientJson } = require('./resilient-json-store');
const { runtimeSessionId } = require('./runtime-session');
const { version: clientVersion } = require('../../package.json');

class LifecycleService {
  _outboxPath() {
    return path.join(app.getPath('userData'), 'lifecycle-outbox.json');
  }

  _readOutbox() {
    const result = readResilientJson(this._outboxPath());
    return Array.isArray(result.value?.events) ? result.value.events : [];
  }

  _writeOutbox(events) {
    atomicWriteJson(this._outboxPath(), { version: 1, events: events.slice(-100) });
  }

  async flush() {
    const deviceKey = configStore.get('deviceKey');
    if (!deviceKey) return { sent: 0, pending: this._readOutbox().length };
    const events = this._readOutbox();
    const pending = [];
    let sent = 0;
    for (const event of events) {
      try {
        await apiService.reportLifecycleEvent(deviceKey, event);
        sent += 1;
      } catch {
        pending.push(event);
      }
    }
    this._writeOutbox(pending);
    return { sent, pending: pending.length };
  }

  async recordUserExit(source) {
    if (!['tray', 'window_close'].includes(source) || !configStore.get('deviceKey')) return { skipped: true };
    const event = {
      eventId: crypto.randomUUID(),
      eventType: 'client_exit',
      reason: 'user_requested',
      source,
      runtimeSessionId,
      occurredAt: new Date().toISOString(),
      clientVersion,
    };
    const events = this._readOutbox();
    events.push(event);
    this._writeOutbox(events);

    await Promise.race([
      this.flush(),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 1500)),
    ]);
    return { queued: true, eventId: event.eventId };
  }

  ensureOutbox() {
    const filePath = this._outboxPath();
    if (!fs.existsSync(filePath)) this._writeOutbox([]);
  }
}

module.exports = new LifecycleService();

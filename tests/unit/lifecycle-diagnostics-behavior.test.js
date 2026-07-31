const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('explicit exit is persisted before the bounded send and excludes non-user exits', () => {
  const source = read('src/main/lifecycle-service.js');
  const writeIndex = source.indexOf('this._writeOutbox(events)');
  const flushIndex = source.indexOf('this.flush()', writeIndex);
  assert.ok(writeIndex >= 0 && flushIndex > writeIndex);
  assert.match(source, /\['tray', 'window_close'\]\.includes\(source\)/);
  assert.match(source, /setTimeout\(\(\) => resolve\(\{ timedOut: true \}\), 1500\)/);
  assert.match(source, /events:\s*events\.slice\(-100\)/);
});

test('diagnostics never collect logs while consent is disabled and revoke clears memory plus queue', () => {
  const source = read('src/main/diagnostics-service.js');
  assert.match(source, /recordLog\([\s\S]*?if \(!this\.isEnabled\(\)\) return;/);
  assert.match(source, /diagnosticsImprovementEnabled: false[\s\S]*?this\._logs = \[\];[\s\S]*?this\.clearQueue\(\)/);
  assert.match(source, /MAX_QUEUE_COUNT = 20/);
  assert.match(source, /MAX_QUEUE_BYTES = 20 \* 1024 \* 1024/);
  assert.match(source, /DEDUP_WINDOW_MS = 6 \* 60 \* 60 \* 1000/);
});

test('unconfirmed device credential responses fall back to network recovery without watchdog budget', () => {
  const source = read('src/main/status-service.js');
  assert.match(source, /if \(!confirmed\) error\.transient = true;/);
  assert.match(source, /if \(isNetworkFailure\(err\)\)[\s\S]*?_networkFailureCount \+= 1/);
  assert.match(source, /if \(isNetworkFailure\(err\)\) \{[\s\S]*?return;\r?\n\s*\}/);
});

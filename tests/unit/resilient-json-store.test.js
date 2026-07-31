const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWriteJson, readResilientJson } = require('../../src/main/resilient-json-store');

test('atomic config writes validate data and keep a recoverable backup', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-config-test-'));
  const filePath = path.join(directory, 'neko-config.json');
  try {
    atomicWriteJson(filePath, { version: 1, value: 'first' });
    atomicWriteJson(filePath, { version: 1, value: 'second' });
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { version: 1, value: 'second' });
    assert.deepEqual(JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf8')), { version: 1, value: 'first' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('corrupt primary restores backup and corrupt primary plus backup are isolated', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-config-recovery-'));
  const filePath = path.join(directory, 'neko-config.json');
  try {
    fs.writeFileSync(filePath, '{broken', 'utf8');
    fs.writeFileSync(`${filePath}.bak`, JSON.stringify({ value: 'backup' }), 'utf8');
    const restored = readResilientJson(filePath);
    assert.equal(restored.source, 'backup');
    assert.equal(restored.value.value, 'backup');

    fs.writeFileSync(filePath, '{broken-again', 'utf8');
    fs.writeFileSync(`${filePath}.bak`, '{also-broken', 'utf8');
    const isolated = readResilientJson(filePath);
    assert.equal(isolated.source, 'corrupt');
    assert.equal(isolated.value, null);
    assert.equal(isolated.isolated.length, 2);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

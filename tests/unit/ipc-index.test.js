const { test } = require('node:test');
const assert = require('node:assert/strict');

test('ipc index exports domain registrars and generic helpers', () => {
  const ipc = require('../../src/main/ipc');

  for (const name of [
    'registerInvokeHandlers',
    'registerEventHandlers',
    'registerConfigIpc',
    'registerApiIpc',
    'registerAuthIpc',
    'registerStreamIpc',
    'registerSystemIpc',
    'registerServiceIpc',
    'registerUpdateIpc',
  ]) {
    assert.equal(typeof ipc[name], 'function', `${name} should be exported`);
  }
});

test('generic ipc helper registration keeps channel names owned by the caller', () => {
  const handled = {};
  const listened = {};
  const ipcMain = {
    handle(channel, fn) { handled[channel] = fn; },
    on(channel, fn) { listened[channel] = fn; },
  };
  const { registerInvokeHandlers, registerEventHandlers } = require('../../src/main/ipc');

  registerInvokeHandlers(ipcMain, { 'feature:get': () => 'value' });
  registerEventHandlers(ipcMain, { 'feature:event': () => undefined });

  assert.equal(handled['feature:get'](), 'value');
  assert.equal(typeof listened['feature:event'], 'function');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IPC_CHANNELS,
  IPC_EVENTS,
  createIpcSuccess,
  createIpcError,
} = require('../../src/shared/ipc-contracts');

test('IPC channels stay unique', () => {
  const values = Object.values(IPC_CHANNELS);
  assert.equal(new Set(values).size, values.length);
});

test('IPC events stay unique', () => {
  const values = Object.values(IPC_EVENTS);
  assert.equal(new Set(values).size, values.length);
});

test('IPC result helpers return the agreed shape', () => {
  assert.deepEqual(createIpcSuccess({ hello: 'world' }), {
    ok: true,
    data: { hello: 'world' },
  });

  assert.deepEqual(createIpcError('BAD_REQUEST', 'invalid payload'), {
    ok: false,
    error: {
      code: 'BAD_REQUEST',
      message: 'invalid payload',
    },
  });
});

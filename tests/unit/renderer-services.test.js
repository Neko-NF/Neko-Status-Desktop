const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadBrowserScript(context, relPath) {
  const filename = path.join(ROOT, relPath);
  const code = fs.readFileSync(filename, 'utf8');
  vm.runInNewContext(code, context, { filename });
}

test('renderer stream client delegates through the live IPC bridge', async () => {
  const calls = [];
  const context = {
    window: {
      nekoIPC: {
        getStreamConfig: async () => {
          calls.push('getStreamConfig');
          return { srsHost: 'live.example.com' };
        },
        saveStreamConfig: async (cfg) => {
          calls.push(['saveStreamConfig', cfg]);
          return { ok: true, ...cfg };
        },
        getStreamKey: async () => ({ streamKey: 'sk_test' }),
        resetStreamKey: async () => ({ streamKey: 'sk_reset' }),
        getStreamLiveStatus: async () => 'idle',
        testSrsConnection: async () => ({ ok: true }),
        testObsWebSocket: async () => ({ connected: true }),
        applyStreamConfigToObs: async () => ({ ok: true }),
        exportObsServiceConfig: async () => ({ path: 'C:\\tmp\\obs.json' }),
      },
    },
    console,
  };
  context.window.window = context.window;

  loadBrowserScript(context, 'src/renderer/js/services/ipc-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/stream-client.js');

  const client = context.window._nekoModules.services.StreamClient;
  assert.equal(client.isReady(), true);
  assert.deepEqual(await client.getConfig(), { srsHost: 'live.example.com' });
  assert.deepEqual(await client.saveConfig({ srsHost: 'next.example.com' }), {
    ok: true,
    srsHost: 'next.example.com',
  });
  assert.deepEqual(calls, [
    'getStreamConfig',
    ['saveStreamConfig', { srsHost: 'next.example.com' }],
  ]);
});

test('renderer IPC client resolves methods at call time for stream mocks', async () => {
  const context = {
    window: {
      nekoIPC: {
        getStreamLiveStatus: async () => 'before-mock',
      },
    },
    console,
  };
  context.window.window = context.window;

  loadBrowserScript(context, 'src/renderer/js/services/ipc-client.js');
  loadBrowserScript(context, 'src/renderer/js/services/stream-client.js');

  const client = context.window._nekoModules.services.StreamClient;
  context.window.nekoIPC.getStreamLiveStatus = async () => 'after-mock';

  assert.equal(await client.getLiveStatus(), 'after-mock');
});

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

function createMocks() {
  const handlers = {};
  return {
    ipcMain: {
      handle(channel, fn) { handlers[channel] = fn; },
    },
    handlers,
    streamService: {
      getStreamConfig: async () => ({ srsHost: 'live.example.com', streamKey: 'sk_existing' }),
      saveStreamConfig: async (config) => ({ ok: true, config: { ...config, streamKey: 'sk_saved' } }),
      getOrInitStreamKey: async () => ({ stream_key: 'sk_new' }),
      resetStreamKey: async () => ({ stream_key: 'sk_reset' }),
      getStreamLiveStatus: async () => 'idle',
      testSrsConnection: async () => ({ ok: true, srsVersion: '6.0.0' }),
      testObsWebSocket: async () => ({ connected: true, obsVersion: '30.0.0' }),
      applyStreamConfigToObs: async () => ({ ok: true }),
      exportObsServiceConfig: async () => 'C:\\tmp\\neko-obs-stream-config.json',
    },
  };
}

describe('registerStreamIpc', () => {
  let handlers;

  beforeEach(() => {
    const mocks = createMocks();
    const { registerStreamIpc } = require('../../src/main/ipc/stream.ipc');
    registerStreamIpc(mocks);
    handlers = mocks.handlers;
  });

  it('stream key methods expose both stream_key and streamKey for renderer compatibility', async () => {
    const getResult = await handlers['stream:getKey']();
    const resetResult = await handlers['stream:resetKey']();

    assert.equal(getResult.ok, true);
    assert.equal(getResult.data.stream_key, 'sk_new');
    assert.equal(getResult.data.streamKey, 'sk_new');
    assert.equal(resetResult.data.stream_key, 'sk_reset');
    assert.equal(resetResult.data.streamKey, 'sk_reset');
  });

  it('save/apply/export include success flags expected by stream UI', async () => {
    const saveResult = await handlers['stream:saveConfig'](null, { srsHost: 'live.example.com' });
    const applyResult = await handlers['stream:applyToObs'](null, {});
    const exportResult = await handlers['stream:exportConfig']();

    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.data.ok, true);
    assert.equal(saveResult.data.success, true);
    assert.equal(saveResult.data.streamKey, 'sk_saved');
    assert.deepEqual(applyResult.data, { ok: true, success: true });
    assert.equal(exportResult.data.success, true);
    assert.match(exportResult.data.path, /neko-obs-stream-config\.json$/);
  });
});

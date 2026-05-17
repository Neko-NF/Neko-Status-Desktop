const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SRS_API_PORT,
  DEFAULT_SRS_HOST,
  DEFAULT_SRS_RTMP_PORT,
  mergeDefaults,
} = require('../../src/main/config-store.helpers');

test('mergeDefaults fills missing nested stream config keys', () => {
  const merged = mergeDefaults({
    streamConfig: {
      srsHost: 'example.com',
      streamKey: 'abc123',
    },
  });

  assert.equal(merged.streamConfig.srsHost, 'example.com');
  assert.equal(merged.streamConfig.streamKey, 'abc123');
  assert.equal(merged.streamConfig.srsApp, 'live');
  assert.equal(merged.streamConfig.obsWsPort, 4455);
});

test('mergeDefaults repairs legacy API port copied from RTMP port', () => {
  const merged = mergeDefaults({
    streamConfig: {
      srsHost: DEFAULT_SRS_HOST,
      srsRtmpPort: DEFAULT_SRS_RTMP_PORT,
      srsApiPort: DEFAULT_SRS_RTMP_PORT,
    },
  });

  assert.equal(merged.streamConfig.srsApiPort, DEFAULT_SRS_API_PORT);
});

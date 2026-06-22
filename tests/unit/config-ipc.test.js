const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

function createMocks() {
  const handlers = {};
  const activityCalls = [];
  return {
    ipcMain: {
      handle(channel, fn) { handlers[channel] = fn; },
    },
    handlers,
    configStore: {
      _data: {
        deviceKey: 'dev-key',
        enableActivityFeature: true,
        enableActivityPublishing: true,
        enableActivityBackground: true,
      },
      get(key) { return this._data[key]; },
      set(key, value) { this._data[key] = value; },
      setMany(values) { Object.assign(this._data, values); },
      getAll() { return { ...this._data }; },
    },
    activityAgent: {
      async revoke(reason) {
        activityCalls.push(['revoke', reason]);
      },
      isEnabled() {
        return false;
      },
    },
    activityCalls,
  };
}

describe('registerConfigIpc', () => {
  let mocks;
  let handlers;

  beforeEach(() => {
    mocks = createMocks();
    const { registerConfigIpc } = require('../../src/main/ipc/config.ipc');
    registerConfigIpc(mocks);
    handlers = mocks.handlers;
  });

  it('wraps config reads in the shared IPC envelope', async () => {
    const one = await handlers['config:get'](null, 'deviceKey');
    const all = await handlers['config:getAll']();

    assert.equal(one.ok, true);
    assert.equal(one.data, 'dev-key');
    assert.equal(all.ok, true);
    assert.equal(all.data.deviceKey, 'dev-key');
  });

  it('validates config keys and setMany payloads', async () => {
    assert.equal((await handlers['config:get'](null, '')).ok, false);
    assert.equal((await handlers['config:set'](null, '', 'x')).error.code, 'INVALID_CONFIG_KEY');
    assert.equal((await handlers['config:setMany'](null, null)).error.code, 'INVALID_CONFIG_VALUES');
  });

  it('writes single and multiple config values', async () => {
    const setResult = await handlers['config:set'](null, 'reportInterval', 10);
    const setManyResult = await handlers['config:setMany'](null, { enableScreenshot: true });

    assert.equal(setResult.ok, true);
    assert.equal(setManyResult.ok, true);
    assert.equal(mocks.configStore.get('reportInterval'), 10);
    assert.equal(mocks.configStore.get('enableScreenshot'), true);
  });

  it('disabling the activity entry also stops activity publishing and the agent', async () => {
    const result = await handlers['config:setMany'](null, {
      enableExperimentalActivityEntry: false,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(mocks.activityCalls, [['revoke', 'disable']]);
    assert.equal(mocks.configStore.get('enableExperimentalActivityEntry'), false);
    assert.equal(mocks.configStore.get('enableActivityFeature'), false);
    assert.equal(mocks.configStore.get('enableActivityPublishing'), false);
    assert.equal(mocks.configStore.get('enableActivityBackground'), false);
  });

  it('disabling all experiments hides the UI lab and curve loaders but preserves the selected style', async () => {
    mocks.configStore.setMany({
      enableExperimentalFeatures: true,
      enableExperimentalUiLabEntry: true,
      enableExperimentalCurveLoaders: true,
      loadingCurveStyle: 'neko-paw',
    });

    const result = await handlers['config:setMany'](null, { enableExperimentalFeatures: false });

    assert.equal(result.ok, true);
    assert.equal(mocks.configStore.get('enableExperimentalUiLabEntry'), false);
    assert.equal(mocks.configStore.get('enableExperimentalCurveLoaders'), false);
    assert.equal(mocks.configStore.get('loadingCurveStyle'), 'neko-paw');
  });
});

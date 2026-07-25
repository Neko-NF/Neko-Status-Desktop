const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAppearance({ stored = 'classic', setImpl } = {}) {
  const events = [];
  const values = new Map([['neko-ui-appearance-profile', stored]]);
  const root = { dataset: { uiProfile: stored }, style: {} };
  const context = {
    window: { _nekoModules: { core: {}, services: {} } },
    document: {
      documentElement: root,
      querySelectorAll() { return []; },
      getElementById() { return null; },
      addEventListener() {},
      dispatchEvent(event) { events.push(event); },
    },
    localStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); },
    },
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  const filename = path.join(__dirname, '../../src/renderer/js/core/appearance.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const profile = context.window._nekoModules.core.AppearanceProfile;
  profile.init({
    config: {
      async set(key, value) { return setImpl ? setImpl(key, value) : true; },
      async getAll() { return { enableExperimentalFeatures: true, uiAppearanceProfile: 'quiet' }; },
    },
  });
  return { profile, root, values, events };
}

test('appearance profile mirrors config and enforces the experimental gate', () => {
  const { profile, root, values, events } = loadAppearance({ stored: 'quiet' });
  profile.applyConfig({ enableExperimentalFeatures: true, uiAppearanceProfile: 'quiet' });
  assert.equal(root.dataset.uiProfile, 'quiet');
  assert.equal(values.get('neko-ui-appearance-profile'), 'quiet');

  profile.applyConfig({ enableExperimentalFeatures: false, uiAppearanceProfile: 'quiet' });
  assert.equal(root.dataset.uiProfile, 'classic');
  assert.equal(events.at(-1).type, 'neko:appearanceChange');
});

test('appearance profile rolls back when persistence fails', async () => {
  const { profile, root } = loadAppearance({
    setImpl: async () => { throw new Error('disk full'); },
  });
  profile.applyConfig({ enableExperimentalFeatures: true, uiAppearanceProfile: 'classic' });
  await assert.rejects(() => profile.saveProfile('quiet'), /disk full/);
  assert.equal(root.dataset.uiProfile, 'classic');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const curveRegistry = require('../../src/renderer/js/components/loading-curves');

function makeClassList() {
  const values = new Set();
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const next = force === undefined ? !values.has(name) : !!force;
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
  };
}

function makeElement(id = '') {
  const attributes = new Map();
  return {
    id,
    type: '',
    dataset: {},
    children: [],
    classList: makeClassList(),
    textContent: '',
    parentNode: null,
    append(...children) {
      children.forEach((child) => {
        child.parentNode = this;
        this.children.push(child);
      });
    },
    appendChild(child) { this.append(child); return child; },
    addEventListener(name, handler) { this[`on${name}`] = handler; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) || null; },
    closest(selector) {
      if (selector === '[data-curve-id]' && this.dataset.curveId) return this;
      if (selector === '[data-loading-context]' && this.dataset.loadingContext) return this;
      return null;
    },
  };
}

test('UI lab renders twelve static cards and keeps a single animated preview', async () => {
  const elements = new Map();
  const ids = [
    'uiLabCurveGrid', 'uiLabPreviewStage', 'uiLabApplySwitch', 'uiLabApplyState',
    'uiLabAutoBtn', 'uiLabContextGroup', 'uiLabPreviewName', 'uiLabPreviewDesc',
    'uiLabPreviewFormula', 'uiLabPreviewMode', 'uiLabDiagActive', 'uiLabDiagPaused',
    'uiLabDiagFrame', 'uiLabDiagMotion', 'uiLabPreviewWhere', 'uiLabMotionSummary',
  ];
  ids.forEach((id) => elements.set(id, makeElement(id)));
  ['startup', 'network', 'search', 'background'].forEach((context) => {
    const button = makeElement(`context-${context}`);
    button.dataset.loadingContext = context;
    elements.get('uiLabContextGroup').append(button);
  });

  const previewCalls = [];
  const preferenceCalls = [];
  const previewController = {
    show: () => previewCalls.push('show'),
    hide: () => previewCalls.push('hide'),
    setVariant: (value) => previewCalls.push(['variant', value]),
    setLabel: (value) => previewCalls.push(['label', value]),
  };
  const loading = {
    createStaticSvg(id) { const svg = makeElement(`svg-${id}`); svg.dataset.curveId = id; return svg; },
    create() { previewCalls.push('create'); return previewController; },
    applyPreferences(cfg) { preferenceCalls.push(cfg.loadingCurveStyle); },
    getDiagnostics() { return { active: 1, maxActive: 4, paused: 0, frameCostMs: 0.8, reducedMotion: false }; },
  };
  let pageChanged = null;
  const saved = [];
  const notices = [];
  const context = {
    window: {
      _nekoModules: {
        pages: {},
        components: { LoadingCurves: curveRegistry, LoadingSystem: loading },
        services: {},
        eventBus: { on(_name, handler) { pageChanged = handler; } },
      },
      setInterval() { return 42; },
      clearInterval() {},
    },
    document: {
      getElementById(id) { return elements.get(id) || null; },
      createElement(tag) { return makeElement(tag); },
      querySelectorAll(selector) {
        if (selector.includes('#uiLabContextGroup')) return elements.get('uiLabContextGroup').children;
        if (selector.includes('#uiLabCurveGrid')) return elements.get('uiLabCurveGrid').children;
        return [];
      },
    },
    console,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  const filename = path.join(__dirname, '../../src/renderer/js/pages/ui-lab.page.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });

  const page = context.window._nekoModules.pages.UiLabPage;
  page.init({
    curves: curveRegistry,
    loading,
    config: {
      async set(key, value) { saved.push([key, value]); return true; },
      async getAll() {
        return {
          enableExperimentalFeatures: true,
          enableExperimentalCurveLoaders: true,
          loadingCurveStyle: 'neko-paw',
        };
      },
    },
    showNotice: (message) => notices.push(message),
    applyExperimentalFeatureState: (cfg) => preferenceCalls.push(`apply:${cfg.loadingCurveStyle}`),
  });

  assert.equal(elements.get('uiLabCurveGrid').children.length, 12);
  assert.equal(previewCalls.filter((call) => call === 'create').length, 1);
  assert.equal(previewCalls.filter((call) => call === 'hide').length, 1);

  page.applyConfig({
    enableExperimentalFeatures: true,
    enableExperimentalCurveLoaders: false,
    loadingCurveStyle: 'auto',
  });
  assert.ok(previewCalls.some((call) => Array.isArray(call) && call[0] === 'variant' && call[1] === 'neko-head'));
  assert.equal(elements.get('uiLabApplyState').textContent, '仅在实验室预览');
  assert.ok(elements.get('uiLabPreviewWhere').children.length >= 1);
  assert.match(elements.get('uiLabMotionSummary').textContent, /绕圈|摆动|速度|脉冲|搜寻|呼吸/);

  pageChanged({ page: 'page-ui-lab' });
  assert.equal(previewCalls.includes('show'), false);
  page.setTab('loading');
  assert.ok(previewCalls.includes('show'));
  assert.equal(elements.get('uiLabDiagActive').textContent, '1 / 4');
  assert.equal(elements.get('uiLabDiagPaused').textContent, '0 个');

  await page.saveStyle('neko-paw');
  assert.deepEqual(saved, [['loadingCurveStyle', 'neko-paw']]);
  assert.ok(notices.includes('已固定为 猫爪花环'));
  assert.ok(preferenceCalls.includes('neko-paw'));
});

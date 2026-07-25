const test = require('node:test');
const assert = require('node:assert/strict');

const curves = require('../../src/renderer/js/components/loading-curves');
const { createLoadingSystem } = require('../../src/renderer/js/components/loading-system');

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : !!force;
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    values,
  };
}

function makeElement(tagName = 'div') {
  const attributes = new Map();
  const element = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    classList: makeClassList(),
    style: { minWidth: '' },
    hidden: false,
    disabled: false,
    innerHTML: '',
    textContent: '',
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    insertBefore(child, before) {
      child.parentNode = this;
      const index = this.children.indexOf(before);
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    replaceChildren(...children) {
      this.children.forEach((child) => { child.parentNode = null; });
      this.children = [];
      children.forEach((child) => this.appendChild(child));
    },
    remove() { this.parentNode?.removeChild?.(this); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    removeAttribute(name) { attributes.delete(name); },
    getBoundingClientRect() { return { width: 120, height: 40 }; },
    attributes,
  };
  Object.defineProperty(element, 'className', {
    get() { return Array.from(element.classList.values).join(' '); },
    set(value) { element.classList = makeClassList(String(value || '').split(/\s+/).filter(Boolean)); },
  });
  return element;
}

function createEnvironment({ reducedMotion = false } = {}) {
  let clock = 1000;
  let timerId = 0;
  let frameId = 0;
  const timers = new Map();
  const frames = new Map();
  const documentListeners = new Map();
  const motionListeners = new Map();
  const observers = [];
  const document = {
    hidden: false,
    createElement: (tag) => makeElement(tag),
    createElementNS: (_ns, tag) => makeElement(tag),
    addEventListener(name, handler) { documentListeners.set(name, handler); },
  };
  const root = {
    document,
    performance: { now: () => clock },
    setTimeout(handler, delay = 0) {
      const id = ++timerId;
      timers.set(id, { handler, due: clock + Number(delay || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(handler) {
      const id = ++frameId;
      frames.set(id, handler);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia() {
      return {
        matches: reducedMotion,
        addEventListener(name, handler) { motionListeners.set(name, handler); },
      };
    },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      unobserve() {}
    },
    flushTimers(ms) {
      clock += ms;
      const ready = Array.from(timers.entries()).filter(([, timer]) => timer.due <= clock);
      ready.forEach(([id, timer]) => {
        timers.delete(id);
        timer.handler();
      });
    },
    flushFrame(ms = 16) {
      clock += ms;
      const ready = Array.from(frames.entries());
      frames.clear();
      ready.forEach(([, handler]) => handler(clock));
    },
    pendingFrames: () => frames.size,
    setHidden(hidden) {
      document.hidden = !!hidden;
      documentListeners.get('visibilitychange')?.();
    },
    setIntersecting(element, intersecting) {
      observers.forEach((observer) => observer.callback([{ target: element, isIntersecting: !!intersecting }]));
    },
  };
  return root;
}

test('curve registry exposes nine families and twelve stable finite presets', () => {
  const definitions = curves.list();
  assert.equal(definitions.length, 12);
  assert.equal(curves.getFamilyCount(), 9);
  assert.equal(new Set(definitions.map((definition) => definition.id)).size, 12);

  for (const definition of definitions) {
    assert.equal(typeof definition.formulaNote, 'string');
    assert.ok(Array.isArray(definition.recommendedFor));
    assert.equal(typeof definition.motion?.durationMs, 'number');
    assert.equal(typeof definition.usage, 'string');
    assert.equal(typeof definition.motionSummary, 'string');
    assert.ok(['loop', 'open', 'pingpong'].includes(definition.motion?.travelMode));
    assert.equal(Number.isFinite(definition.motion?.tempo?.amplitude), true);
    assert.equal(typeof definition.motion?.rotation?.mode, 'string');
    const sampled = curves.sample(definition.id, 240);
    assert.equal(sampled.points.length, 240);
    for (const point of sampled.points) {
      assert.equal(Number.isFinite(point.x), true, `${definition.id} x must be finite`);
      assert.equal(Number.isFinite(point.y), true, `${definition.id} y must be finite`);
      assert.ok(point.x >= 7.9 && point.x <= 92.1, `${definition.id} x stays normalized`);
      assert.ok(point.y >= 7.9 && point.y <= 92.1, `${definition.id} y stays normalized`);
    }
    if (definition.closed) {
      const first = sampled.points[0];
      const last = sampled.points[sampled.points.length - 1];
      assert.ok(Math.hypot(first.x - last.x, first.y - last.y) < 0.15, `${definition.id} closes`);
    }
  }
});

test('curve registry maps contexts and safely falls back from unknown styles', () => {
  assert.equal(curves.resolveStyle('auto', 'startup'), 'neko-head');
  assert.equal(curves.resolveStyle('auto', 'network'), 'lissajous-drift');
  assert.equal(curves.resolveStyle('auto', 'search'), 'spiral-search');
  assert.equal(curves.resolveStyle('auto', 'background'), 'lemniscate-bloom');
  assert.equal(curves.normalizeStyle('future-curve-id'), 'auto');
  assert.equal(curves.endpointOpacity('neko-tail', 0), 0);
  assert.equal(curves.endpointOpacity('neko-tail', 0.5), 1);
  assert.equal(curves.endpointOpacity('neko-tail', 1), 0);
  assert.equal(curves.endpointOpacity('neko-head', 0), 1);
  assert.equal(curves.get('spiral-search').closed, false);
  assert.equal(curves.get('lemniscate-bloom').motion.travelMode, 'pingpong');
  assert.equal(curves.get('neko-paw').motion.rotation.mode, 'sway');
  assert.ok(curves.list().some((definition) => definition.motion.rotation.mode === 'none'));
  assert.ok(curves.list().some((definition) => definition.motion.tempo.amplitude > 0));
});

test('global fixed style overrides automatic context while explicit instance style remains local', () => {
  const root = createEnvironment();
  const system = createLoadingSystem(root, curves);
  system.applyPreferences({
    enableExperimentalFeatures: true,
    enableExperimentalCurveLoaders: true,
    loadingCurveStyle: 'neko-paw',
  });
  const automatic = system.create(makeElement('section'), { context: 'network', delayMs: 0 });
  const explicit = system.create(makeElement('section'), { context: 'network', variant: 'rose-five', delayMs: 0 });
  automatic.show();
  explicit.show();
  assert.equal(automatic.state.variant, 'neko-paw');
  assert.equal(explicit.state.variant, 'rose-five');
  automatic.destroy();
  explicit.destroy();
});

test('loading system shares one scheduler and caps active curve instances at four', () => {
  const root = createEnvironment();
  const system = createLoadingSystem(root, curves);
  system.applyPreferences({
    enableExperimentalFeatures: true,
    enableExperimentalCurveLoaders: true,
    loadingCurveStyle: 'auto',
  });
  const controllers = Array.from({ length: 6 }, () => {
    const target = makeElement('section');
    const controller = system.create(target, { preview: true, delayMs: 0, minVisibleMs: 0 });
    controller.show();
    return controller;
  });

  assert.equal(root.pendingFrames(), 1);
  root.flushFrame();
  assert.equal(system.getDiagnostics().active, 4);
  assert.equal(system.getDiagnostics().maxActive, 4);
  assert.equal(root.pendingFrames(), 1);

  controllers.forEach((controller) => controller.destroy());
  assert.equal(root.pendingFrames(), 0);
  assert.equal(system.getDiagnostics().total, 0);
});

test('loading system delays section feedback, preserves minimum visibility, and destroys idempotently', () => {
  const root = createEnvironment();
  const system = createLoadingSystem(root, curves);
  const target = makeElement('section');
  const controller = system.create(target, { preview: true, delayMs: 180, minVisibleMs: 320 });

  controller.show('正在准备测试');
  assert.equal(controller.state.rendered, false);
  assert.equal(target.getAttribute('aria-busy'), 'true');
  root.flushTimers(179);
  assert.equal(controller.state.rendered, false);
  root.flushTimers(1);
  assert.equal(controller.state.rendered, true);

  controller.hide();
  assert.equal(target.getAttribute('aria-busy'), 'false');
  root.flushTimers(319);
  assert.equal(controller.state.rendered, true);
  root.flushTimers(1);
  assert.equal(controller.state.rendered, false);
  controller.destroy();
  controller.destroy();
  assert.equal(system.getDiagnostics().total, 0);
});

test('reduced motion renders a static curve without scheduling animation frames', () => {
  const root = createEnvironment({ reducedMotion: true });
  const system = createLoadingSystem(root, curves);
  const controller = system.create(makeElement('section'), { preview: true, delayMs: 0 });
  controller.show();
  assert.equal(root.pendingFrames(), 0);
  assert.equal(system.getDiagnostics().active, 0);
  assert.equal(system.getDiagnostics().reducedMotion, true);
});

test('hidden documents and offscreen instances pause the shared scheduler and resume when visible', () => {
  const root = createEnvironment();
  const system = createLoadingSystem(root, curves);
  const controller = system.create(makeElement('section'), { preview: true, delayMs: 0, minVisibleMs: 0 });
  controller.show();
  root.flushFrame();
  assert.equal(system.getDiagnostics().active, 1);

  root.setHidden(true);
  assert.equal(root.pendingFrames(), 0);
  assert.equal(system.getDiagnostics().active, 0);
  root.setHidden(false);
  assert.equal(root.pendingFrames(), 1);

  root.setIntersecting(controller.element, false);
  root.flushFrame();
  assert.equal(system.getDiagnostics().active, 0);
  assert.equal(root.pendingFrames(), 0);
  root.setIntersecting(controller.element, true);
  assert.equal(root.pendingFrames(), 1);
  controller.destroy();
});

test('button busy state is idempotent and restores original content and accessibility state', () => {
  const root = createEnvironment();
  const system = createLoadingSystem(root, curves);
  const button = makeElement('button');
  button.innerHTML = '<i class="ph ph-play"></i> 开始';
  button.disabled = false;

  assert.equal(system.setButtonBusy(button, true, { label: '连接中…' }), true);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(button.children[0].className, 'neko-button-busy-overlay');
  assert.equal(button.children[0].children[1].textContent, '连接中…');
  assert.equal(system.setButtonBusy(button, true, { label: '仍在连接…' }), true);
  assert.equal(button.children[0].children[1].textContent, '仍在连接…');

  assert.equal(system.setButtonBusy(button, false), true);
  assert.equal(button.disabled, false);
  assert.equal(button.innerHTML, '<i class="ph ph-play"></i> 开始');
  assert.equal(button.getAttribute('aria-busy'), null);
  assert.equal(button.style.minWidth, '');
  assert.equal(system.setButtonBusy(button, false), false);
});

test('curve engine failures fall back to the classic indicator without blocking the controller', () => {
  const root = createEnvironment();
  const brokenCurves = {
    resolveStyle: () => 'broken',
    normalizeStyle: () => 'auto',
    sample: () => { throw new Error('formula failed'); },
  };
  const system = createLoadingSystem(root, brokenCurves);
  const controller = system.create(makeElement('section'), { preview: true, delayMs: 0 });
  assert.doesNotThrow(() => controller.show());
  assert.equal(controller.state.failed, true);
  assert.equal(controller.element.classList.contains('is-classic'), true);
  controller.destroy();
});

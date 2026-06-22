(function attachLoadingSystem(root, factory) {
  const createLoadingSystem = factory;
  if (typeof module === 'object' && module.exports) module.exports = { createLoadingSystem };
  if (!root) return;
  root._nekoModules = root._nekoModules || {};
  root._nekoModules.components = root._nekoModules.components || {};
  root._nekoModules.components.LoadingSystem = createLoadingSystem(
    root,
    root._nekoModules.components.LoadingCurves,
  );
})(typeof window !== 'undefined' ? window : null, function createLoadingSystem(root, curves) {
  'use strict';

  const doc = root?.document || null;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_ACTIVE = 4;
  const SIZE_PRESETS = Object.freeze({
    sm: { particles: 18, samples: 480 },
    md: { particles: 32, samples: 480 },
    lg: { particles: 48, samples: 480 },
  });
  const MODE_PRIORITY = Object.freeze({ inline: 1, section: 2, overlay: 3 });
  const instances = new Set();
  const buttonStates = new WeakMap();
  const observedInstances = new WeakMap();
  const frameCosts = [];
  let sequence = 0;
  let frameHandle = 0;
  let currentActiveCount = 0;
  let preferences = { enabled: false, style: 'auto' };
  let reduceMotion = !!root?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const requestFrame = root?.requestAnimationFrame?.bind(root)
    || ((callback) => root?.setTimeout?.(() => callback(Date.now()), 16));
  const cancelFrame = root?.cancelAnimationFrame?.bind(root)
    || ((handle) => root?.clearTimeout?.(handle));
  const now = () => Number(root?.performance?.now?.() ?? Date.now());

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function wrap01(value) {
    return ((Number(value) % 1) + 1) % 1;
  }

  function easeInOutSine(value) {
    const v = clamp01(value);
    return -(Math.cos(Math.PI * v) - 1) / 2;
  }

  function easeInOutCubic(value) {
    const v = clamp01(value);
    return v < 0.5 ? 4 * v * v * v : 1 - ((-2 * v + 2) ** 3) / 2;
  }

  function triangleWave(value) {
    const wrapped = wrap01(value);
    return wrapped < 0.5 ? wrapped * 2 : (1 - wrapped) * 2;
  }

  function triangleDirection(value) {
    return wrap01(value) < 0.5 ? 1 : -1;
  }

  function applyTempo(value, definition) {
    const motion = definition?.motion || {};
    const tempo = motion.tempo || {};
    let next = clamp01(value);
    if (tempo.ease === 'sine') next = easeInOutSine(next);
    else if (tempo.ease === 'cubic') next = easeInOutCubic(next);
    const amplitude = Number(tempo.amplitude || 0);
    const frequency = Math.max(1, Number(tempo.frequency || 1));
    if (amplitude) {
      next += amplitude * Math.sin((Math.PI * 2 * frequency * next) + Number(tempo.phase || 0));
    }
    return definition?.closed ? wrap01(next) : clamp01(next);
  }

  function getMotionState(definition, baseProgress) {
    const motion = definition?.motion || {};
    const mode = motion.travelMode || 'loop';
    let head = wrap01(baseProgress);
    let direction = 1;

    if (mode === 'pingpong') {
      direction = triangleDirection(baseProgress);
      head = triangleWave(baseProgress);
    } else if (mode === 'open') {
      head = clamp01(baseProgress);
    }

    return {
      head: applyTempo(head, definition),
      direction,
    };
  }

  function getPulseScale(definition, elapsed) {
    const pulse = definition?.motion?.pulse || {};
    const duration = Number(pulse.durationMs || definition?.pulseDurationMs || 4200);
    const amount = Number(pulse.amount ?? 0.035);
    if (!duration || !amount) return 1;
    const phase = Number(pulse.phase || 0);
    const wave = Math.sin(((elapsed % duration) / duration) * Math.PI * 2 + phase);
    return 1 + wave * amount;
  }

  function getRotation(definition, elapsed) {
    const rotation = definition?.motion?.rotation || {};
    const mode = rotation.mode || 'none';
    const duration = Number(rotation.durationMs || definition?.rotationDurationMs || 0);
    if (mode === 'none' || !duration) return 0;
    const phase = Number(rotation.phase || 0);
    if (mode === 'continuous') {
      const direction = Number(rotation.direction || 1);
      return direction * ((elapsed % duration) / duration) * 360;
    }
    const amplitude = Number(rotation.amplitudeDeg || 0);
    if (!amplitude) return 0;
    const wave = Math.sin(((elapsed % duration) / duration) * Math.PI * 2 + phase);
    if (mode === 'drift') return wave * amplitude;
    if (mode === 'sway') return wave * amplitude;
    return 0;
  }

  const intersectionObserver = root?.IntersectionObserver
    ? new root.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const instance = observedInstances.get(entry.target);
        if (!instance) return;
        instance.intersecting = entry.isIntersecting !== false;
      });
      ensureFrame();
    }, { threshold: 0.01 })
    : null;

  function effectiveCurveEnabled(instance) {
    return !!instance?.options?.preview || preferences.enabled === true;
  }

  function resolveVariant(instance) {
    const local = instance.variant || instance.options.variant || 'auto';
    const explicit = local === 'auto' ? (preferences.style || 'auto') : local;
    return curves?.resolveStyle?.(explicit, instance.options.context || 'generic') || 'neko-head';
  }

  function createSvgElement(name) {
    return doc?.createElementNS?.(SVG_NS, name) || null;
  }

  function createStaticSvg(variant, options = {}) {
    if (!doc || !curves?.sample) return null;
    try {
      const size = options.size || 'md';
      const preset = SIZE_PRESETS[size] || SIZE_PRESETS.md;
      const resolved = curves.resolveStyle(variant, options.context || 'generic');
      const sample = curves.sample(resolved, preset.samples);
      const svg = createSvgElement('svg');
      const path = createSvgElement('path');
      if (!svg || !path) return null;
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('aria-hidden', 'true');
      svg.classList.add('neko-curve-svg', 'neko-curve-svg--static');
      path.setAttribute('d', sample.path);
      path.setAttribute('class', 'neko-curve-track');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      return svg;
    } catch {
      return null;
    }
  }

  function createInstanceDom(instance) {
    if (!doc || instance.wrapper) return;
    const { options, target } = instance;
    const wrapper = doc.createElement('div');
    const visual = doc.createElement('span');
    const classic = doc.createElement('span');
    const label = doc.createElement('span');
    wrapper.className = `neko-loading neko-loading--${options.mode} neko-loading--size-${options.size}`;
    wrapper.hidden = true;
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');
    visual.className = 'neko-loading-visual';
    classic.className = 'neko-loading-classic';
    classic.setAttribute('aria-hidden', 'true');
    label.className = 'neko-loading-label';
    label.textContent = options.label;
    visual.appendChild(classic);
    wrapper.append(visual, label);

    if (options.mode === 'overlay') {
      target.classList?.add?.('neko-loading-host');
      instance.addedHostClass = true;
    }
    target.appendChild(wrapper);
    instance.wrapper = wrapper;
    instance.visual = visual;
    instance.classic = classic;
    instance.label = label;
    observedInstances.set(wrapper, instance);
    intersectionObserver?.observe?.(wrapper);
    rebuildCurve(instance);
  }

  function rebuildCurve(instance) {
    if (!instance.visual || !curves?.sample) return;
    const oldSvg = instance.svg;
    if (oldSvg?.parentNode) oldSvg.parentNode.removeChild(oldSvg);
    instance.svg = null;
    instance.group = null;
    instance.path = null;
    instance.particles = [];
    instance.failed = false;
    instance.error = null;
    try {
      const resolved = resolveVariant(instance);
      const preset = SIZE_PRESETS[instance.options.size] || SIZE_PRESETS.md;
      const sample = curves.sample(resolved, preset.samples);
      const svg = createSvgElement('svg');
      const group = createSvgElement('g');
      const path = createSvgElement('path');
      if (!svg || !group || !path) throw new Error('SVG is unavailable');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('aria-hidden', 'true');
      svg.classList.add('neko-curve-svg');
      path.setAttribute('d', sample.path);
      path.setAttribute('class', 'neko-curve-track');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      group.appendChild(path);
      const particles = Array.from({ length: preset.particles }, () => {
        const circle = createSvgElement('circle');
        circle.setAttribute('class', 'neko-curve-particle');
        circle.setAttribute('fill', 'currentColor');
        group.appendChild(circle);
        return circle;
      });
      svg.appendChild(group);
      instance.visual.insertBefore(svg, instance.classic);
      instance.resolvedVariant = resolved;
      instance.sample = sample;
      instance.svg = svg;
      instance.group = group;
      instance.path = path;
      instance.particles = particles;
      renderStatic(instance);
    } catch (error) {
      instance.failed = true;
      instance.error = error;
    }
    syncVisualMode(instance);
  }

  function syncVisualMode(instance) {
    if (!instance.wrapper) return;
    const useCurve = effectiveCurveEnabled(instance) && !instance.failed && !!instance.svg;
    instance.wrapper.classList.toggle('is-curve', useCurve);
    instance.wrapper.classList.toggle('is-classic', !useCurve);
    instance.wrapper.classList.toggle('is-reduced-motion', reduceMotion);
    if (reduceMotion && instance.rendered) {
      instance.wrapper.classList.remove('is-animating');
      instance.wrapper.classList.toggle('is-static', useCurve);
    }
  }

  function pointAt(instance, progress) {
    const points = instance.sample?.points || [];
    if (!points.length) return { x: 50, y: 50 };
    const definition = instance.sample.definition;
    let normalized = Number(progress) || 0;
    if (definition.closed) normalized = ((normalized % 1) + 1) % 1;
    else normalized = Math.max(0, Math.min(1, normalized));
    const scaled = normalized * (points.length - 1);
    const leftIndex = Math.floor(scaled);
    const rightIndex = Math.min(points.length - 1, leftIndex + 1);
    const mix = scaled - leftIndex;
    const left = points[leftIndex] || points[0];
    const right = points[rightIndex] || left;
    return {
      x: left.x + (right.x - left.x) * mix,
      y: left.y + (right.y - left.y) * mix,
    };
  }

  function renderStatic(instance) {
    if (!instance.particles?.length || !instance.sample) return;
    const count = instance.particles.length;
    instance.group?.setAttribute?.('transform', 'translate(50 50) scale(1) translate(-50 -50)');
    const definition = instance.sample.definition;
    const staticBase = definition.closed ? 0.14 : 0.88;
    const state = getMotionState(definition, staticBase);
    instance.particles.forEach((particle, index) => {
      const tail = index / Math.max(1, count - 1);
      const rawProgress = state.head - state.direction * tail * definition.trailLength;
      const openFade = curves?.endpointOpacity?.(definition, rawProgress) ?? 1;
      const point = pointAt(instance, rawProgress);
      const fade = Math.pow(1 - tail, 0.7) * Math.max(0, openFade);
      particle.setAttribute('cx', point.x.toFixed(2));
      particle.setAttribute('cy', point.y.toFixed(2));
      particle.setAttribute('r', (0.85 + fade * 2.1).toFixed(2));
      particle.setAttribute('opacity', (0.08 + fade * 0.78).toFixed(3));
    });
  }

  function renderFrame(instance, timestamp) {
    if (!instance.sample || !instance.particles?.length) return;
    const definition = instance.sample.definition;
    const elapsed = timestamp - instance.startedAt;
    const progress = ((elapsed % definition.durationMs) + definition.durationMs) % definition.durationMs / definition.durationMs;
    const motion = getMotionState(definition, progress);
    const scale = getPulseScale(definition, elapsed);
    const rotation = getRotation(definition, elapsed);
    instance.group?.setAttribute?.(
      'transform',
      `translate(50 50) rotate(${rotation.toFixed(2)}) scale(${scale.toFixed(4)}) translate(-50 -50)`,
    );
    const count = instance.particles.length;
    instance.particles.forEach((particle, index) => {
      const tail = index / Math.max(1, count - 1);
      const rawProgress = motion.head - motion.direction * tail * definition.trailLength;
      const openFade = curves?.endpointOpacity?.(definition, rawProgress) ?? 1;
      const point = pointAt(instance, rawProgress);
      const fade = Math.pow(1 - tail, 0.62) * Math.max(0, openFade);
      particle.setAttribute('cx', point.x.toFixed(2));
      particle.setAttribute('cy', point.y.toFixed(2));
      particle.setAttribute('r', (0.82 + fade * 2.28).toFixed(2));
      particle.setAttribute('opacity', (0.04 + fade * 0.96).toFixed(3));
    });
  }

  function candidates() {
    if (doc?.hidden || reduceMotion) return [];
    return Array.from(instances)
      .filter((instance) => instance.rendered && !instance.destroyed && instance.intersecting && effectiveCurveEnabled(instance) && !instance.failed)
      .sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
  }

  function tick(timestamp) {
    frameHandle = 0;
    const started = now();
    const active = candidates().slice(0, MAX_ACTIVE);
    currentActiveCount = active.length;
    const activeSet = new Set(active);
    instances.forEach((instance) => {
      const isActive = activeSet.has(instance);
      instance.wrapper?.classList?.toggle?.('is-animating', isActive);
      instance.wrapper?.classList?.toggle?.('is-static', instance.rendered && effectiveCurveEnabled(instance) && !isActive);
      if (isActive) renderFrame(instance, timestamp);
    });
    const cost = Math.max(0, now() - started);
    frameCosts.push(cost);
    if (frameCosts.length > 120) frameCosts.shift();
    if (active.length) frameHandle = requestFrame(tick);
  }

  function ensureFrame() {
    instances.forEach(syncVisualMode);
    if (frameHandle || !candidates().length) return;
    frameHandle = requestFrame(tick);
  }

  function stopFrameIfIdle() {
    if (candidates().length) {
      ensureFrame();
      return;
    }
    currentActiveCount = 0;
    if (frameHandle) cancelFrame(frameHandle);
    frameHandle = 0;
    instances.forEach((instance) => {
      instance.wrapper?.classList?.remove?.('is-animating');
      instance.wrapper?.classList?.toggle?.(
        'is-static',
        instance.rendered && effectiveCurveEnabled(instance) && !instance.failed,
      );
    });
  }

  function setRendered(instance, rendered) {
    if (!instance.wrapper || instance.destroyed) return;
    instance.rendered = !!rendered;
    instance.wrapper.hidden = !rendered;
    instance.wrapper.classList.toggle('is-visible', !!rendered);
    if (rendered) {
      instance.shownAt = now();
      instance.startedAt = instance.startedAt || now();
      ensureFrame();
    } else {
      instance.wrapper.classList.remove('is-animating');
      stopFrameIfIdle();
    }
  }

  function create(target, rawOptions = {}) {
    if (!target || !doc) return null;
    const options = {
      context: rawOptions.context || 'generic',
      mode: rawOptions.mode || 'section',
      size: rawOptions.size || 'md',
      label: rawOptions.label || '加载中…',
      variant: rawOptions.variant || 'auto',
      preview: rawOptions.preview === true,
      delayMs: rawOptions.delayMs ?? (rawOptions.mode === 'inline' ? 0 : 180),
      minVisibleMs: rawOptions.minVisibleMs ?? (rawOptions.mode === 'inline' ? 0 : 320),
    };
    if (!SIZE_PRESETS[options.size]) options.size = 'md';
    if (!MODE_PRIORITY[options.mode]) options.mode = 'section';
    const instance = {
      target,
      options,
      priority: MODE_PRIORITY[options.mode],
      sequence: ++sequence,
      variant: options.variant,
      intersecting: true,
      rendered: false,
      destroyed: false,
      startedAt: now(),
      particles: [],
      showTimer: 0,
      hideTimer: 0,
    };
    instances.add(instance);
    createInstanceDom(instance);

    function show(nextLabel) {
      if (instance.destroyed) return controller;
      if (nextLabel != null) controller.setLabel(nextLabel);
      if (instance.hideTimer) root.clearTimeout?.(instance.hideTimer);
      instance.hideTimer = 0;
      instance.desired = true;
      target.setAttribute?.('aria-busy', 'true');
      if (instance.rendered || options.delayMs <= 0) setRendered(instance, true);
      else {
        if (instance.showTimer) root.clearTimeout?.(instance.showTimer);
        instance.showTimer = root.setTimeout?.(() => {
          instance.showTimer = 0;
          if (instance.desired) setRendered(instance, true);
        }, options.delayMs);
      }
      return controller;
    }

    function hide() {
      if (instance.destroyed) return controller;
      instance.desired = false;
      target.setAttribute?.('aria-busy', 'false');
      if (instance.showTimer) root.clearTimeout?.(instance.showTimer);
      instance.showTimer = 0;
      if (!instance.rendered) return controller;
      const remaining = Math.max(0, options.minVisibleMs - (now() - instance.shownAt));
      if (instance.hideTimer) root.clearTimeout?.(instance.hideTimer);
      if (remaining > 0) {
        instance.hideTimer = root.setTimeout?.(() => {
          instance.hideTimer = 0;
          if (!instance.desired) setRendered(instance, false);
        }, remaining);
      } else setRendered(instance, false);
      return controller;
    }

    function destroy() {
      if (instance.destroyed) return;
      instance.destroyed = true;
      if (instance.showTimer) root.clearTimeout?.(instance.showTimer);
      if (instance.hideTimer) root.clearTimeout?.(instance.hideTimer);
      intersectionObserver?.unobserve?.(instance.wrapper);
      instances.delete(instance);
      instance.wrapper?.remove?.();
      if (instance.addedHostClass) target.classList?.remove?.('neko-loading-host');
      target.removeAttribute?.('aria-busy');
      stopFrameIfIdle();
    }

    const controller = {
      show,
      hide,
      destroy,
      setLabel(value) {
        options.label = String(value ?? '');
        if (instance.label) instance.label.textContent = options.label;
        return controller;
      },
      setVariant(value) {
        instance.variant = curves?.normalizeStyle?.(value) || 'auto';
        rebuildCurve(instance);
        ensureFrame();
        return controller;
      },
      get element() { return instance.wrapper; },
      get state() {
        return {
          rendered: instance.rendered,
          destroyed: instance.destroyed,
          variant: instance.resolvedVariant,
          failed: !!instance.failed,
        };
      },
    };
    return controller;
  }

  function setButtonBusy(button, busy, options = {}) {
    if (!button || !doc) return false;
    const labelText = String(options.label || '处理中…');
    if (busy) {
      let state = buttonStates.get(button);
      if (!state) {
        state = {
          html: button.innerHTML,
          disabled: !!button.disabled,
          ariaBusy: button.getAttribute?.('aria-busy'),
          minWidth: button.style?.minWidth || '',
        };
        buttonStates.set(button, state);
        if (options.lockWidth !== false) {
          const width = Number(button.getBoundingClientRect?.().width || 0);
          if (width > 0 && button.style) button.style.minWidth = `${Math.ceil(width)}px`;
        }
      }
      button.disabled = true;
      button.classList?.add?.('loading', 'neko-button-busy');
      button.setAttribute?.('aria-busy', 'true');
      const indicator = doc.createElement('span');
      const label = doc.createElement('span');
      indicator.className = 'neko-busy-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      label.className = 'neko-busy-label';
      label.textContent = labelText;
      if (button.replaceChildren) button.replaceChildren(indicator, label);
      else button.innerHTML = `<span class="neko-busy-indicator" aria-hidden="true"></span><span class="neko-busy-label"></span>`;
      if (!button.replaceChildren) button.querySelector?.('.neko-busy-label') && (button.querySelector('.neko-busy-label').textContent = labelText);
      return true;
    }

    const state = buttonStates.get(button);
    if (!state) return false;
    button.innerHTML = state.html;
    button.disabled = state.disabled;
    button.classList?.remove?.('loading', 'neko-button-busy');
    if (state.ariaBusy == null) button.removeAttribute?.('aria-busy');
    else button.setAttribute?.('aria-busy', state.ariaBusy);
    if (button.style) button.style.minWidth = state.minWidth;
    buttonStates.delete(button);
    return true;
  }

  function applyPreferences(config = {}) {
    preferences = {
      enabled: config.enableExperimentalFeatures === true && config.enableExperimentalCurveLoaders === true,
      style: curves?.normalizeStyle?.(config.loadingCurveStyle) || 'auto',
    };
    instances.forEach((instance) => {
      if (!instance.options.variant || instance.options.variant === 'auto') rebuildCurve(instance);
      else syncVisualMode(instance);
    });
    stopFrameIfIdle();
    ensureFrame();
    return { ...preferences };
  }

  function getDiagnostics() {
    const all = Array.from(instances).filter((instance) => !instance.destroyed);
    const sortedCosts = frameCosts.slice().sort((a, b) => a - b);
    const p95Index = sortedCosts.length ? Math.min(sortedCosts.length - 1, Math.floor(sortedCosts.length * 0.95)) : 0;
    return {
      total: all.length,
      active: currentActiveCount,
      paused: all.filter((instance) => instance.rendered && !instance.wrapper?.classList?.contains?.('is-animating')).length,
      static: all.filter((instance) => instance.wrapper?.classList?.contains?.('is-static')).length,
      enabled: preferences.enabled,
      style: preferences.style,
      reducedMotion: reduceMotion,
      frameCostMs: sortedCosts.length ? Number(sortedCosts[p95Index].toFixed(2)) : 0,
      maxActive: MAX_ACTIVE,
    };
  }

  doc?.addEventListener?.('visibilitychange', () => {
    stopFrameIfIdle();
    ensureFrame();
  });
  const motionQuery = root?.matchMedia?.('(prefers-reduced-motion: reduce)');
  motionQuery?.addEventListener?.('change', (event) => {
    reduceMotion = !!event.matches;
    instances.forEach((instance) => {
      syncVisualMode(instance);
      if (reduceMotion) renderStatic(instance);
    });
    stopFrameIfIdle();
    ensureFrame();
  });

  return {
    create,
    createStaticSvg,
    setButtonBusy,
    applyPreferences,
    getDiagnostics,
    MAX_ACTIVE,
  };
});

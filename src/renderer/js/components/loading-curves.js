(function attachLoadingCurves(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root) return;
  root._nekoModules = root._nekoModules || {};
  root._nekoModules.components = root._nekoModules.components || {};
  root._nekoModules.components.LoadingCurves = api;
})(typeof window !== 'undefined' ? window : null, function createLoadingCurvesRegistry() {
  'use strict';

  const TAU = Math.PI * 2;
  const AUTO_STYLE = 'auto';

  function wrapProgress(value) {
    return ((Number(value) % 1) + 1) % 1;
  }

  function wrapAngle(value) {
    return ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
  }

  function angularGaussian(theta, center, sigma) {
    const distance = wrapAngle(theta - center);
    return Math.exp(-(distance * distance) / (2 * sigma * sigma));
  }

  const definitions = [
    {
      id: 'neko-head',
      family: 'neko',
      name: '猫耳巡游',
      description: '两枚周期耳峰围成猫咪轮廓，是 Neko Status 的品牌默认加载轨迹。',
      formula: 'r(θ)=1+0.10cos(2θ)+0.34(Gσ(θ+3π/4)+Gσ(θ+π/4))',
      usage: '启动检查、系统初始化、设备权限批量准备。',
      motionSummary: '沿猫耳轮廓轻快巡游，整体只做轻微摆动，不做陀螺式匀速旋转。',
      contexts: ['startup', 'system', 'generic'],
      closed: true,
      durationMs: 3900,
      rotationDurationMs: 0,
      trail: 0.34,
      travelMode: 'loop',
      tempo: { amplitude: 0.026, frequency: 2, phase: 0.2 },
      rotation: { mode: 'sway', amplitudeDeg: 4.5, durationMs: 5200, phase: 0.15 },
      pulse: { amount: 0.042, durationMs: 3900, phase: 0 },
      point(progress) {
        const theta = wrapProgress(progress) * TAU - Math.PI / 2;
        const ears = angularGaussian(theta, -3 * Math.PI / 4, 0.16)
          + angularGaussian(theta, -Math.PI / 4, 0.16);
        const cheeks = angularGaussian(theta, Math.PI / 2, 0.72);
        const radius = 0.78 + 0.075 * Math.cos(2 * theta) + 0.34 * ears + 0.08 * cheeks;
        return { x: radius * Math.cos(theta), y: 0.88 * radius * Math.sin(theta) + 0.06 };
      },
    },
    {
      id: 'neko-paw',
      family: 'neko',
      name: '猫爪花环',
      description: '四枚趾豆与下方肉垫形成猫爪轮廓，适合轻松、活泼但仍明确的等待反馈。',
      formula: 'r(θ)=.52+.20ΣGtoe(θ)+.28Gpad(θ)-.10Gvalley(θ)',
      usage: '用户主动触发后的轻量等待，例如刷新、打开详情和应用设置。',
      motionSummary: '趾豆处有轻微跳动节奏，轨迹不再像四边形，也不整体绕圈。',
      contexts: ['generic'],
      closed: true,
      durationMs: 4300,
      rotationDurationMs: 0,
      trail: 0.31,
      travelMode: 'loop',
      tempo: { amplitude: 0.033, frequency: 4, phase: -0.35 },
      rotation: { mode: 'sway', amplitudeDeg: 2.8, durationMs: 3600, phase: 0.45 },
      pulse: { amount: 0.055, durationMs: 2150, phase: 0.2 },
      point(progress) {
        const theta = wrapProgress(progress) * TAU - Math.PI / 2;
        const toes = [
          angularGaussian(theta, -2.36, 0.18),
          angularGaussian(theta, -1.92, 0.17),
          angularGaussian(theta, -1.22, 0.17),
          angularGaussian(theta, -0.78, 0.18),
        ].reduce((sum, value) => sum + value, 0);
        const pad = angularGaussian(theta, Math.PI / 2, 0.58);
        const topValley = angularGaussian(theta, -Math.PI / 2, 0.24);
        const sideTuck = angularGaussian(theta, 0, 0.34) + angularGaussian(theta, Math.PI, 0.34);
        const radius = 0.54 + 0.19 * toes + 0.28 * pad - 0.1 * topValley - 0.055 * sideTuck;
        return { x: 0.96 * radius * Math.cos(theta), y: 0.9 * radius * Math.sin(theta) + 0.05 };
      },
    },
    {
      id: 'neko-tail',
      family: 'neko',
      name: '卷尾螺旋',
      description: '由内向外舒展的开放螺旋，尾端淡出后重新开始，不产生跳变亮点。',
      formula: 'r(t)=0.12+0.78t, θ(t)=-2.4π+4.8πt',
      usage: '后台准备、缓存刷新、较安静的非阻塞等待。',
      motionSummary: '从内向外舒展并淡出重启，强调“准备中”，不是闭环转圈。',
      contexts: ['background'],
      closed: false,
      durationMs: 4800,
      rotationDurationMs: 0,
      trail: 0.28,
      travelMode: 'open',
      tempo: { ease: 'sine', amplitude: 0.018, frequency: 2, phase: 0.1 },
      rotation: { mode: 'none' },
      pulse: { amount: 0.025, durationMs: 4800, phase: 0.35 },
      point(progress) {
        const t = Math.max(0, Math.min(1, Number(progress) || 0));
        const theta = -2.4 * Math.PI + 4.8 * Math.PI * t;
        const radius = 0.12 + 0.78 * t;
        return { x: radius * Math.cos(theta), y: 0.86 * radius * Math.sin(theta) };
      },
    },
    {
      id: 'rose-five',
      family: 'rose',
      name: '五瓣花轨',
      description: '柔化后的五瓣玫瑰轨迹，比经典负半径玫瑰线更稳定，适合中小尺寸。',
      formula: 'r(θ)=0.58+0.30cos(5θ)',
      usage: '品牌感较强的普通等待，不建议用于列表首屏。',
      motionSummary: '花瓣间速度有轻微收放，整体只做慢速漂移。',
      contexts: ['generic'],
      closed: true,
      durationMs: 4400,
      rotationDurationMs: 0,
      trail: 0.31,
      travelMode: 'loop',
      tempo: { amplitude: 0.028, frequency: 5, phase: 0 },
      rotation: { mode: 'drift', amplitudeDeg: 8, durationMs: 22000, phase: 0 },
      pulse: { amount: 0.034, durationMs: 4400, phase: 0.15 },
      point(progress) {
        const theta = wrapProgress(progress) * TAU;
        const radius = 0.58 + 0.3 * Math.cos(5 * theta);
        return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
      },
    },
    {
      id: 'rose-seven',
      family: 'rose',
      name: '七瓣花环',
      description: '七瓣花环密度更高，经过外环化处理后不再在中心高频打结。',
      formula: 'r(θ)=0.60+0.26cos(7θ)',
      usage: '较大的品牌型加载区域，例如公告详情或更新说明。',
      motionSummary: '花瓣边缘轻微加速，整体保持稳定，不做明显旋转。',
      contexts: ['generic'],
      closed: true,
      durationMs: 4700,
      rotationDurationMs: 0,
      trail: 0.36,
      travelMode: 'loop',
      tempo: { amplitude: 0.022, frequency: 7, phase: 0.4 },
      rotation: { mode: 'none' },
      pulse: { amount: 0.03, durationMs: 4700, phase: 0.25 },
      point(progress) {
        const theta = wrapProgress(progress) * TAU;
        const radius = 0.6 + 0.26 * Math.cos(7 * theta);
        return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
      },
    },
    {
      id: 'lissajous-drift',
      family: 'lissajous',
      name: '星轨编织',
      description: '3:2 频率的李萨如曲线，适合网络同步与跨端数据交换。',
      formula: 'x(t)=sin(3t+π/2), y(t)=0.88sin(2t)',
      usage: '网络同步、更新源检查、跨端数据交换。',
      motionSummary: '以编织路径往复穿梭，不依赖整体旋转表达“同步”。',
      contexts: ['network'],
      closed: true,
      durationMs: 5100,
      rotationDurationMs: 0,
      trail: 0.34,
      travelMode: 'loop',
      tempo: { amplitude: 0.024, frequency: 3, phase: Math.PI / 2 },
      rotation: { mode: 'none' },
      pulse: { amount: 0.028, durationMs: 5100, phase: 0.1 },
      point(progress) {
        const t = wrapProgress(progress) * TAU;
        return { x: Math.sin(3 * t + Math.PI / 2), y: 0.88 * Math.sin(2 * t) };
      },
    },
    {
      id: 'lemniscate-bloom',
      family: 'lemniscate',
      name: '无限回环',
      description: '平静的伯努利双纽线，适合后台准备和不需要抢占注意力的等待。',
      formula: 'x=cos(t)/(1+sin²t), y=sin(t)cos(t)/(1+sin²t)',
      usage: '后台等待、低优先级准备、安静状态保持。',
      motionSummary: '沿无限符号缓入缓出并轻微呼吸，避免持续绕圈造成注意力噪声。',
      contexts: ['background'],
      closed: true,
      durationMs: 5000,
      rotationDurationMs: 0,
      trail: 0.4,
      travelMode: 'pingpong',
      tempo: { ease: 'sine', amplitude: 0.012, frequency: 2, phase: 0 },
      rotation: { mode: 'none' },
      pulse: { amount: 0.036, durationMs: 5000, phase: 0 },
      point(progress) {
        const t = wrapProgress(progress) * TAU;
        const denominator = 1 + Math.sin(t) ** 2;
        return {
          x: Math.cos(t) / denominator,
          y: 1.45 * Math.sin(t) * Math.cos(t) / denominator,
        };
      },
    },
    {
      id: 'hypotrochoid-loop',
      family: 'hypotrochoid',
      name: '齿轮内旋',
      description: '滚圆形成的内摆线轨迹，适合系统诊断和机械感较强的任务。',
      formula: 'x=(R-r)cos(t)+dcos((R-r)t/r)',
      usage: '系统诊断、权限探测、更新检查中的机械型等待。',
      motionSummary: '保留少量机械漂移，但速度带有齿轮式快慢变化。',
      contexts: ['system'],
      closed: true,
      durationMs: 5700,
      rotationDurationMs: 28000,
      trail: 0.42,
      travelMode: 'loop',
      tempo: { amplitude: 0.02, frequency: 6, phase: 0.25 },
      rotation: { mode: 'continuous', durationMs: 28000, direction: -1 },
      pulse: { amount: 0.026, durationMs: 5700, phase: 0.2 },
      point(progress) {
        const t = wrapProgress(progress) * Math.PI * 6;
        const R = 5;
        const r = 3;
        const d = 4.3;
        return {
          x: ((R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t)) / 6.3,
          y: ((R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)) / 6.3,
        };
      },
    },
    {
      id: 'cardioid-pulse',
      family: 'cardioid',
      name: '心形脉冲',
      description: '单尖点心形轨迹，在用户主动等待时提供温和的情绪反馈。',
      formula: 'r(θ)=0.5(1-cosθ)',
      usage: '用户主动等待、确认类操作后的温和反馈。',
      motionSummary: '以心形轨迹慢速脉冲，不做整体旋转，减少眩晕感。',
      contexts: ['generic'],
      closed: true,
      durationMs: 5200,
      rotationDurationMs: 0,
      trail: 0.36,
      travelMode: 'loop',
      tempo: { amplitude: 0.018, frequency: 1, phase: -0.4 },
      rotation: { mode: 'none' },
      pulse: { amount: 0.052, durationMs: 2600, phase: 0 },
      point(progress) {
        const theta = wrapProgress(progress) * TAU;
        const radius = 0.55 * (1 - Math.cos(theta));
        return { x: radius * Math.sin(theta), y: -radius * Math.cos(theta) + 0.35 };
      },
    },
    {
      id: 'spiral-search',
      family: 'spiral',
      name: '螺旋搜寻',
      description: '开放式螺旋从中心向外搜寻，尾端淡出后重新发起下一轮探测。',
      formula: 'r(t)=0.10+0.82sin¹·¹(πt/2), θ(t)=-3.2π+5.35πt',
      usage: '搜索、诊断、扫描设备或检查更新源。',
      motionSummary: '外扩搜寻并淡出重启，避免被误解为普通循环等待。',
      contexts: ['search'],
      closed: false,
      durationMs: 4200,
      rotationDurationMs: 0,
      trail: 0.24,
      travelMode: 'open',
      tempo: { ease: 'sine', amplitude: 0.016, frequency: 2, phase: 0.15 },
      rotation: { mode: 'none' },
      pulse: { amount: 0.025, durationMs: 4200, phase: 0.15 },
      point(progress) {
        const t = Math.max(0, Math.min(1, Number(progress) || 0));
        const theta = -3.2 * Math.PI + 5.35 * Math.PI * t;
        const radius = 0.1 + 0.82 * (Math.sin((Math.PI * t) / 2) ** 1.1);
        return { x: radius * Math.cos(theta), y: 0.92 * radius * Math.sin(theta) };
      },
    },
    {
      id: 'butterfly-phase',
      family: 'butterfly',
      name: '蝶翼相位',
      description: '指数项和余弦项构成蝶翼轨迹，已降低重复周期，避免预览中过密打结。',
      formula: 'ρ=e^cos(t)-2cos(4t)-sin⁵(t/12)',
      usage: '表现力较强的实验预览，暂不作为默认正式加载。',
      motionSummary: '翼面区域缓慢穿梭，整体只轻微漂移。',
      contexts: ['generic'],
      closed: true,
      durationMs: 7200,
      rotationDurationMs: 0,
      trail: 0.28,
      travelMode: 'loop',
      tempo: { amplitude: 0.014, frequency: 4, phase: 0.5 },
      rotation: { mode: 'drift', amplitudeDeg: 6, durationMs: 30000, phase: 0.25 },
      pulse: { amount: 0.022, durationMs: 7200, phase: 0 },
      point(progress) {
        const t = wrapProgress(progress) * Math.PI * 12;
        const rho = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) - Math.sin(t / 12) ** 5;
        return { x: (Math.sin(t) * rho) / 4.2, y: (Math.cos(t) * rho) / 4.2 };
      },
    },
    {
      id: 'fourier-flow',
      family: 'fourier',
      name: '谐波流',
      description: '多个正弦与余弦分量叠加成持续变化感，适合未来视觉焕新实验。',
      formula: 'x=.65cos t+.22cos3t+.12sin5t; y=.62sin t-.24sin2t+.10cos4t',
      usage: '未来视觉焕新、主题化实验、非默认展示型等待。',
      motionSummary: '非圆形谐波路径内流动，速度带有潮汐式快慢变化。',
      contexts: ['generic'],
      closed: true,
      durationMs: 6500,
      rotationDurationMs: 0,
      trail: 0.32,
      travelMode: 'loop',
      tempo: { amplitude: 0.021, frequency: 3, phase: -0.2 },
      rotation: { mode: 'none' },
      pulse: { amount: 0.026, durationMs: 6500, phase: 0.2 },
      point(progress) {
        const t = wrapProgress(progress) * TAU;
        return {
          x: 0.65 * Math.cos(t) + 0.22 * Math.cos(3 * t) + 0.12 * Math.sin(5 * t),
          y: 0.62 * Math.sin(t) - 0.24 * Math.sin(2 * t) + 0.1 * Math.cos(4 * t),
        };
      },
    },
  ].map((definition) => {
    const contexts = Object.freeze([...(definition.contexts || ['generic'])]);
    const pulseDurationMs = definition.pulse?.durationMs || 4200;
    const rotation = Object.freeze({
      mode: definition.rotation?.mode || (definition.rotationDurationMs ? 'continuous' : 'none'),
      durationMs: definition.rotation?.durationMs || definition.rotationDurationMs || 0,
      amplitudeDeg: definition.rotation?.amplitudeDeg || 0,
      direction: definition.rotation?.direction || 1,
      phase: definition.rotation?.phase || 0,
    });
    const tempo = Object.freeze({
      ease: definition.tempo?.ease || 'none',
      amplitude: Number(definition.tempo?.amplitude || 0),
      frequency: Number(definition.tempo?.frequency || 1),
      phase: Number(definition.tempo?.phase || 0),
    });
    const pulse = Object.freeze({
      amount: Number(definition.pulse?.amount ?? 0.035),
      durationMs: pulseDurationMs,
      phase: Number(definition.pulse?.phase || 0),
    });
    return Object.freeze({
      pulseDurationMs,
      ...definition,
      contexts,
      formulaNote: definition.formula,
      recommendedFor: contexts,
      trailLength: definition.trail,
      motion: Object.freeze({
        durationMs: definition.durationMs,
        pulseDurationMs,
        rotationDurationMs: definition.rotationDurationMs,
        trailLength: definition.trail,
        travelMode: definition.travelMode || 'loop',
        tempo,
        rotation,
        pulse,
      }),
      endpointFade: definition.closed !== true,
    });
  });

  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const CONTEXT_DEFAULTS = Object.freeze({
    startup: 'neko-head',
    system: 'neko-head',
    network: 'lissajous-drift',
    search: 'spiral-search',
    background: 'lemniscate-bloom',
    generic: 'neko-head',
  });

  function list() {
    return definitions.slice();
  }

  function get(id) {
    return byId.get(String(id || '')) || null;
  }

  function normalizeStyle(style) {
    const value = String(style || '').trim();
    return value === AUTO_STYLE || byId.has(value) ? value : AUTO_STYLE;
  }

  function resolveStyle(style, context = 'generic') {
    const normalized = normalizeStyle(style);
    if (normalized !== AUTO_STYLE) return normalized;
    return CONTEXT_DEFAULTS[context] || CONTEXT_DEFAULTS.generic;
  }

  function normalizePoints(rawPoints, padding = 8) {
    const finitePoints = rawPoints.map((point) => ({
      x: Number.isFinite(point?.x) ? Number(point.x) : 0,
      y: Number.isFinite(point?.y) ? Number(point.y) : 0,
    }));
    const xs = finitePoints.map((point) => point.x);
    const ys = finitePoints.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(0.0001, maxX - minX);
    const height = Math.max(0.0001, maxY - minY);
    const scale = (100 - padding * 2) / Math.max(width, height);
    const offsetX = 50 - ((minX + maxX) / 2) * scale;
    const offsetY = 50 - ((minY + maxY) / 2) * scale;
    return finitePoints.map((point) => ({
      x: point.x * scale + offsetX,
      y: point.y * scale + offsetY,
    }));
  }

  function buildPath(points, closed) {
    const body = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    return closed ? `${body} Z` : body;
  }

  function sample(id, count = 160) {
    const definition = get(id) || get(CONTEXT_DEFAULTS.generic);
    const safeCount = Math.max(24, Math.min(720, Math.round(Number(count) || 160)));
    const rawPoints = Array.from({ length: safeCount }, (_, index) => {
      const denominator = Math.max(1, safeCount - 1);
      return definition.point(index / denominator);
    });
    const points = normalizePoints(rawPoints);
    return {
      definition,
      points,
      path: buildPath(points, definition.closed),
    };
  }

  function endpointOpacity(idOrDefinition, progress, fadeWindow = 0.08) {
    const definition = typeof idOrDefinition === 'string' ? get(idOrDefinition) : idOrDefinition;
    if (!definition || definition.closed) return 1;
    const value = Number(progress);
    if (!Number.isFinite(value) || value <= 0 || value >= 1) return 0;
    const windowSize = Math.max(0.001, Math.min(0.49, Number(fadeWindow) || 0.08));
    return Math.max(0, Math.min(1, value / windowSize, (1 - value) / windowSize));
  }

  function getFamilyCount() {
    return new Set(definitions.map((definition) => definition.family)).size;
  }

  return Object.freeze({
    AUTO_STYLE,
    CONTEXT_DEFAULTS,
    list,
    get,
    sample,
    normalizeStyle,
    resolveStyle,
    endpointOpacity,
    getFamilyCount,
  });
});

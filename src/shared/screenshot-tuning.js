const KIB = 1024;

const DEVELOPER_SCREENSHOT_TUNING_DEFAULTS = Object.freeze({
  uploadFormat: 'auto',
  captureWidth: 1920,
  captureHeight: 1080,
  targetKb: Math.round(2.2 * 1024),
  maxKb: Math.round(4.6 * 1024),
  uploadLimitKb: 5 * 1024,
  jpegQuality: 88,
  minQuality: 64,
  resizeFloor: 50,
});

const DEVELOPER_SCREENSHOT_FORMATS = Object.freeze(['auto', 'jpeg', 'png']);

const DEVELOPER_SCREENSHOT_TUNING_RANGES = Object.freeze({
  captureWidth: { min: 800, max: 3840 },
  captureHeight: { min: 450, max: 2160 },
  targetKb: { min: 256, max: 8192 },
  maxKb: { min: 512, max: 9216 },
  uploadLimitKb: { min: 512, max: 10240 },
  jpegQuality: { min: 45, max: 94 },
  minQuality: { min: 45, max: 92 },
  resizeFloor: { min: 35, max: 100 },
});

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeScreenshotFormat(value) {
  return DEVELOPER_SCREENSHOT_FORMATS.includes(value) ? value : DEVELOPER_SCREENSHOT_TUNING_DEFAULTS.uploadFormat;
}

function normalizeDeveloperScreenshotTuning(source = {}) {
  const targetKb = Math.round(clampNumber(
    source.targetKb,
    DEVELOPER_SCREENSHOT_TUNING_RANGES.targetKb.min,
    DEVELOPER_SCREENSHOT_TUNING_RANGES.targetKb.max,
    DEVELOPER_SCREENSHOT_TUNING_DEFAULTS.targetKb,
  ));
  const maxKb = Math.round(Math.max(targetKb, clampNumber(
    source.maxKb,
    DEVELOPER_SCREENSHOT_TUNING_RANGES.maxKb.min,
    DEVELOPER_SCREENSHOT_TUNING_RANGES.maxKb.max,
    DEVELOPER_SCREENSHOT_TUNING_DEFAULTS.maxKb,
  )));
  const uploadLimitKb = Math.round(Math.max(maxKb, clampNumber(
    source.uploadLimitKb,
    DEVELOPER_SCREENSHOT_TUNING_RANGES.uploadLimitKb.min,
    DEVELOPER_SCREENSHOT_TUNING_RANGES.uploadLimitKb.max,
    DEVELOPER_SCREENSHOT_TUNING_DEFAULTS.uploadLimitKb,
  )));
  const jpegQuality = Math.round(clampNumber(
    source.jpegQuality,
    DEVELOPER_SCREENSHOT_TUNING_RANGES.jpegQuality.min,
    DEVELOPER_SCREENSHOT_TUNING_RANGES.jpegQuality.max,
    DEVELOPER_SCREENSHOT_TUNING_DEFAULTS.jpegQuality,
  ));

  return {
    uploadFormat: normalizeScreenshotFormat(source.uploadFormat),
    captureWidth: Math.round(clampNumber(
      source.captureWidth,
      DEVELOPER_SCREENSHOT_TUNING_RANGES.captureWidth.min,
      DEVELOPER_SCREENSHOT_TUNING_RANGES.captureWidth.max,
      DEVELOPER_SCREENSHOT_TUNING_DEFAULTS.captureWidth,
    )),
    captureHeight: Math.round(clampNumber(
      source.captureHeight,
      DEVELOPER_SCREENSHOT_TUNING_RANGES.captureHeight.min,
      DEVELOPER_SCREENSHOT_TUNING_RANGES.captureHeight.max,
      DEVELOPER_SCREENSHOT_TUNING_DEFAULTS.captureHeight,
    )),
    targetKb,
    maxKb,
    uploadLimitKb,
    jpegQuality,
    minQuality: Math.min(jpegQuality, Math.round(clampNumber(
      source.minQuality,
      DEVELOPER_SCREENSHOT_TUNING_RANGES.minQuality.min,
      DEVELOPER_SCREENSHOT_TUNING_RANGES.minQuality.max,
      DEVELOPER_SCREENSHOT_TUNING_DEFAULTS.minQuality,
    ))),
    resizeFloor: Math.round(clampNumber(
      source.resizeFloor,
      DEVELOPER_SCREENSHOT_TUNING_RANGES.resizeFloor.min,
      DEVELOPER_SCREENSHOT_TUNING_RANGES.resizeFloor.max,
      DEVELOPER_SCREENSHOT_TUNING_DEFAULTS.resizeFloor,
    )),
  };
}

function developerScreenshotTuningToCaptureOptions(source = {}) {
  const tuning = normalizeDeveloperScreenshotTuning(source);
  return {
    captureWidth: tuning.captureWidth,
    captureHeight: tuning.captureHeight,
    format: tuning.uploadFormat,
    targetBytes: tuning.targetKb * KIB,
    maxBytes: tuning.maxKb * KIB,
    uploadLimitBytes: tuning.uploadLimitKb * KIB,
    jpegQuality: tuning.jpegQuality,
    minQuality: tuning.minQuality,
    minScale: tuning.resizeFloor / 100,
  };
}

module.exports = {
  DEVELOPER_SCREENSHOT_TUNING_DEFAULTS,
  DEVELOPER_SCREENSHOT_FORMATS,
  DEVELOPER_SCREENSHOT_TUNING_RANGES,
  normalizeScreenshotFormat,
  normalizeDeveloperScreenshotTuning,
  developerScreenshotTuningToCaptureOptions,
};

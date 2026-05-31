const test = require('node:test');
const assert = require('node:assert/strict');

const {
  optimizeScreenshotImage,
  normalizeCompressionOptions,
} = require('../../src/main/system-utils');

function fakeImage({ width = 1920, height = 1080, pngBytes, jpegBytesByQuality, resized = [] }) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    toPNG: () => Buffer.alloc(pngBytes, 1),
    toJPEG: (quality) => Buffer.alloc(jpegBytesByQuality[quality] || Math.max(1, Math.round(pngBytes * quality / 120)), 2),
    resize: ({ width: nextWidth, height: nextHeight }) => {
      const next = resized.shift() || {
        width: nextWidth,
        height: nextHeight,
        pngBytes: Math.max(1, Math.round(pngBytes * 0.55)),
        jpegBytesByQuality: Object.fromEntries(
          Object.entries(jpegBytesByQuality).map(([quality, bytes]) => [quality, Math.max(1, Math.round(bytes * 0.55))]),
        ),
      };
      return fakeImage({ ...next, resized });
    },
  };
}

test('screenshot optimizer keeps compact PNG screenshots lossless', () => {
  const image = fakeImage({
    pngBytes: 400 * 1024,
    jpegBytesByQuality: { 92: 320 * 1024 },
  });

  const result = optimizeScreenshotImage(image, { targetBytes: 800 * 1024 });

  assert.equal(result.format, 'png');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.quality, null);
});

test('screenshot optimizer honors forced JPEG upload format', () => {
  const image = fakeImage({
    pngBytes: 320 * 1024,
    jpegBytesByQuality: {
      88: 180 * 1024,
      84: 160 * 1024,
    },
  });

  const result = optimizeScreenshotImage(image, {
    format: 'jpeg',
    jpegQuality: 88,
    targetBytes: 800 * 1024,
  });

  assert.equal(result.format, 'jpeg');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.quality, 88);
});

test('screenshot optimizer honors forced PNG upload format and resizes PNG only', () => {
  const image = fakeImage({
    pngBytes: 5 * 1024 * 1024,
    jpegBytesByQuality: {
      88: 700 * 1024,
    },
    resized: [{
      width: 1536,
      height: 864,
      pngBytes: 1500 * 1024,
      jpegBytesByQuality: {
        88: 400 * 1024,
      },
    }],
  });

  const result = optimizeScreenshotImage(image, {
    format: 'png',
    targetBytes: 2 * 1024 * 1024,
    maxBytes: 4 * 1024 * 1024,
  });

  assert.equal(result.format, 'png');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.quality, null);
  assert.equal(result.scale, 0.9);
});

test('screenshot optimizer picks the highest quality JPEG under the target', () => {
  const image = fakeImage({
    pngBytes: 5 * 1024 * 1024,
    jpegBytesByQuality: {
      92: 3 * 1024 * 1024,
      88: 2400 * 1024,
      84: 1900 * 1024,
      80: 1600 * 1024,
    },
  });

  const result = optimizeScreenshotImage(image, { targetBytes: 2 * 1024 * 1024, maxBytes: 4 * 1024 * 1024 });

  assert.equal(result.format, 'jpeg');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.extension, 'jpg');
  assert.equal(result.quality, 84);
  assert.equal(result.compressedBytes, 1900 * 1024);
  assert.equal(result.wasCompressed, true);
});

test('screenshot optimizer resizes only when full-size candidates stay too large', () => {
  const image = fakeImage({
    pngBytes: 9 * 1024 * 1024,
    jpegBytesByQuality: {
      92: 7 * 1024 * 1024,
      88: 6 * 1024 * 1024,
      84: 5 * 1024 * 1024,
      80: 5 * 1024 * 1024,
      76: 5 * 1024 * 1024,
      72: 5 * 1024 * 1024,
      68: 5 * 1024 * 1024,
      64: 5 * 1024 * 1024,
    },
    resized: [{
      width: 1728,
      height: 972,
      pngBytes: 4 * 1024 * 1024,
      jpegBytesByQuality: {
        84: 3 * 1024 * 1024,
        78: 2100 * 1024,
        72: 1700 * 1024,
        68: 1600 * 1024,
        64: 1500 * 1024,
      },
    }],
  });

  const result = optimizeScreenshotImage(image, { targetBytes: 2 * 1024 * 1024, maxBytes: 4 * 1024 * 1024 });

  assert.equal(result.format, 'jpeg');
  assert.equal(result.quality, 72);
  assert.equal(result.scale, 0.9);
  assert.equal(result.width, 1728);
  assert.equal(result.height, 972);
});

test('screenshot optimizer clamps compression options', () => {
  const options = normalizeCompressionOptions({
    targetBytes: 1,
    maxBytes: 2,
    minQuality: 10,
    jpegQuality: 999,
    format: 'webp',
    minScale: 0.1,
    captureWidth: 9999,
    captureHeight: 1,
  });

  assert.equal(options.targetBytes, 256 * 1024);
  assert.equal(options.maxBytes, 512 * 1024);
  assert.equal(options.format, 'auto');
  assert.equal(options.jpegQuality, 94);
  assert.equal(options.minQuality, 40);
  assert.equal(options.minScale, 0.35);
  assert.equal(options.captureWidth, 3840);
  assert.equal(options.captureHeight, 360);
});

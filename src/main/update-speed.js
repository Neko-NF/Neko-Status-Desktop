const { performance } = require('perf_hooks');
const {
  buildDownloadHeadersForUrl,
} = require('./update-source');

const DEFAULT_SAMPLE_BYTES = 1024 * 1024;
const DEFAULT_MAX_SAMPLE_MS = 2500;
const DEFAULT_REQUEST_TIMEOUT_MS = 6000;

function nowMs() {
  return performance.now();
}

function cloneHeaders(headers) {
  return { ...(headers || {}) };
}

function isAbortError(error) {
  return error?.name === 'AbortError' || /aborted/i.test(String(error?.message || ''));
}

function makeTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear() {
      clearTimeout(timeoutId);
    },
  };
}

function calculateBytesPerSecond(bytes, durationMs) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.round(bytes / (durationMs / 1000));
}

async function readSampleFromResponse(response, controller, options = {}) {
  const sampleBytes = options.sampleBytes || DEFAULT_SAMPLE_BYTES;
  const maxSampleMs = options.maxSampleMs || DEFAULT_MAX_SAMPLE_MS;
  let sampledBytes = 0;
  let firstByteAt = 0;
  let endedAt = 0;

  if (!response.body || typeof response.body.getReader !== 'function') {
    if (typeof response.arrayBuffer !== 'function') {
      return { bytesPerSecond: 0, sampledBytes: 0, durationMs: 0, reason: 'stream-unavailable' };
    }
    const startedAt = nowMs();
    const buffer = await response.arrayBuffer();
    endedAt = nowMs();
    sampledBytes = Math.min(buffer.byteLength || 0, sampleBytes);
    return {
      bytesPerSecond: calculateBytesPerSecond(sampledBytes, endedAt - startedAt),
      sampledBytes,
      durationMs: Math.round(endedAt - startedAt),
      reason: 'buffer',
    };
  }

  const reader = response.body.getReader();

  try {
    while (sampledBytes < sampleBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.length) continue;

      const chunkAt = nowMs();
      if (!firstByteAt) firstByteAt = chunkAt;
      sampledBytes += value.length;
      endedAt = chunkAt;

      if (sampledBytes >= sampleBytes || (chunkAt - firstByteAt) >= maxSampleMs) {
        try { await reader.cancel(); } catch {}
        try { controller.abort(); } catch {}
        break;
      }
    }
  } catch (error) {
    if (!isAbortError(error)) throw error;
  }

  const durationMs = firstByteAt && endedAt ? Math.max(endedAt - firstByteAt, 1) : 0;
  return {
    bytesPerSecond: calculateBytesPerSecond(sampledBytes, durationMs),
    sampledBytes,
    durationMs: Math.round(durationMs),
    reason: sampledBytes > 0 ? 'sampled' : 'empty',
  };
}

async function sampleDownload(url, headers, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeout = makeTimeoutController(options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers,
      signal: timeout.controller.signal,
      redirect: 'follow',
    });

    if (!response || !response.ok) {
      return {
        ok: false,
        status: response?.status || 0,
        bytesPerSecond: 0,
        sampledBytes: 0,
        durationMs: 0,
      };
    }

    const sample = await readSampleFromResponse(response, timeout.controller, options);
    return {
      ok: true,
      status: response.status,
      bytesPerSecond: sample.bytesPerSecond,
      sampledBytes: sample.sampledBytes,
      durationMs: sample.durationMs,
      reason: sample.reason,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return { ok: false, status: 0, bytesPerSecond: 0, sampledBytes: 0, durationMs: 0, error: 'timeout' };
    }
    return { ok: false, status: 0, bytesPerSecond: 0, sampledBytes: 0, durationMs: 0, error: error.message };
  } finally {
    timeout.clear();
  }
}

async function estimateDownloadSpeed(url, configStore, options = {}) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { bytesPerSecond: 0, sampledBytes: 0, durationMs: 0, method: 'none', error: 'invalid-url' };
  }

  const sampleBytes = options.sampleBytes || DEFAULT_SAMPLE_BYTES;
  const buildHeaders = options.buildHeaders || buildDownloadHeadersForUrl;
  const baseHeaders = cloneHeaders(buildHeaders(url, configStore));
  const rangeHeaders = cloneHeaders(baseHeaders);
  rangeHeaders.Range = `bytes=0-${sampleBytes - 1}`;

  const ranged = await sampleDownload(url, rangeHeaders, { ...options, sampleBytes });
  if (ranged.ok && ranged.sampledBytes > 0) {
    return {
      bytesPerSecond: ranged.bytesPerSecond,
      sampledBytes: ranged.sampledBytes,
      durationMs: ranged.durationMs,
      method: 'range',
      status: ranged.status,
    };
  }

  const fallback = await sampleDownload(url, baseHeaders, { ...options, sampleBytes });
  if (fallback.ok && fallback.sampledBytes > 0) {
    return {
      bytesPerSecond: fallback.bytesPerSecond,
      sampledBytes: fallback.sampledBytes,
      durationMs: fallback.durationMs,
      method: 'full-sample',
      status: fallback.status,
      rangeStatus: ranged.status || 0,
    };
  }

  return {
    bytesPerSecond: 0,
    sampledBytes: 0,
    durationMs: 0,
    method: 'failed',
    status: fallback.status || ranged.status || 0,
    error: fallback.error || ranged.error || '',
  };
}

module.exports = {
  DEFAULT_SAMPLE_BYTES,
  DEFAULT_MAX_SAMPLE_MS,
  estimateDownloadSpeed,
  calculateBytesPerSecond,
};

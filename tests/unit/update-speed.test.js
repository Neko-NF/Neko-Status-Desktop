const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateBytesPerSecond,
  estimateDownloadSpeed,
} = require('../../src/main/update-speed');

function createStreamResponse(chunks, status = 206) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(Buffer.from(chunk));
        }
        controller.close();
      },
    }),
  };
}

describe('update download speed estimation', () => {
  it('calculates bytes per second from sampled bytes and active transfer duration', () => {
    assert.equal(calculateBytesPerSecond(1024 * 1024, 1000), 1024 * 1024);
    assert.equal(calculateBytesPerSecond(0, 1000), 0);
    assert.equal(calculateBytesPerSecond(1024, 0), 0);
  });

  it('samples a real asset with Range and source-scoped headers', async () => {
    const fetchImpl = mock.fn(async (_url, options) => {
      assert.equal(options.headers.Authorization, 'token personal-token');
      assert.equal(options.headers.Range, 'bytes=0-15');
      return createStreamResponse(['12345678', 'abcdefgh']);
    });

    const result = await estimateDownloadSpeed('https://git.example.test/NF/Neko/app.exe', {}, {
      fetchImpl,
      sampleBytes: 16,
      buildHeaders: () => ({ Authorization: 'token personal-token' }),
    });

    assert.equal(fetchImpl.mock.callCount(), 1);
    assert.equal(result.method, 'range');
    assert.equal(result.sampledBytes, 16);
    assert.ok(result.bytesPerSecond > 0);
  });

  it('retries without Range when the server rejects range requests', async () => {
    const seenRanges = [];
    let calls = 0;
    const fetchImpl = mock.fn(async (_url, options) => {
      calls += 1;
      seenRanges.push(options.headers.Range || '');
      if (calls === 1) {
        return { ok: false, status: 416, body: null };
      }
      return createStreamResponse(['12345678'], 200);
    });

    const result = await estimateDownloadSpeed('https://git.example.test/NF/Neko/app.exe', {}, {
      fetchImpl,
      sampleBytes: 8,
      buildHeaders: () => ({ Authorization: 'token personal-token' }),
    });

    assert.deepEqual(seenRanges, ['bytes=0-7', '']);
    assert.equal(result.method, 'full-sample');
    assert.equal(result.rangeStatus, 416);
    assert.equal(result.sampledBytes, 8);
    assert.ok(result.bytesPerSecond > 0);
  });

  it('does not estimate speed for invalid or missing asset URLs', async () => {
    const fetchImpl = mock.fn(async () => {
      throw new Error('fetch should not run');
    });

    const result = await estimateDownloadSpeed('', {}, { fetchImpl });

    assert.equal(fetchImpl.mock.callCount(), 0);
    assert.equal(result.bytesPerSecond, 0);
    assert.equal(result.method, 'none');
  });
});

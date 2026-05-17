import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HLS_UPSTREAM_BASES = (
  process.env.SRS_HLS_BASE_URLS ??
  process.env.SRS_HLS_BASE_URL ??
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

function contentTypeForPath(pathname: string): string {
  if (pathname.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl; charset=utf-8'
  if (pathname.endsWith('.ts')) return 'video/mp2t'
  if (pathname.endsWith('.m4s')) return 'video/iso.segment'
  if (pathname.endsWith('.mp4')) return 'video/mp4'
  if (pathname.endsWith('.aac')) return 'audio/aac'
  return 'application/octet-stream'
}

function buildUpstreamUrls(pathParts: string[]): URL[] {
  const cleanParts = pathParts
    .map((part) => decodeURIComponent(part).trim())
    .filter(Boolean)

  if (
    cleanParts.length === 0 ||
    cleanParts.some((part) => part === '.' || part === '..' || part.includes('\\'))
  ) {
    return []
  }

  return HLS_UPSTREAM_BASES.flatMap((baseValue) => {
    try {
      const base = new URL(baseValue.endsWith('/') ? baseValue : `${baseValue}/`)
      return [new URL(cleanParts.map(encodeURIComponent).join('/'), base)]
    } catch {
      return []
    }
  })
}

function toProxyPath(url: URL): string {
  const pathname = url.pathname.replace(/^\/+/, '')
  return `/api/stream/hls/${pathname}${url.search}`
}

function rewriteManifest(manifest: string, upstreamUrl: URL): string {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return line

      try {
        const resolved = new URL(trimmed, upstreamUrl)
        return toProxyPath(resolved)
      } catch {
        return line
      }
    })
    .join('\n')
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const upstreamUrls = buildUpstreamUrls(path)

  if (upstreamUrls.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'SRS_HLS_BASE_URL or SRS_HLS_BASE_URLS is not configured, or HLS path is invalid' },
      { status: 400 },
    )
  }

  let lastStatus = 502
  let lastError: unknown = null

  for (const upstreamUrl of upstreamUrls) {
    try {
      const upstream = await fetch(upstreamUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })

      if (!upstream.ok || !upstream.body) {
        lastStatus = upstream.status === 404 ? 404 : 502
        continue
      }

      const contentType = upstream.headers.get('content-type') || contentTypeForPath(upstreamUrl.pathname)

      if (upstreamUrl.pathname.endsWith('.m3u8')) {
        const manifest = await upstream.text()
        return new NextResponse(rewriteManifest(manifest, upstreamUrl), {
          headers: {
            'Content-Type': contentTypeForPath(upstreamUrl.pathname),
            'Cache-Control': 'no-store, max-age=0',
          },
        })
      }

      return new NextResponse(upstream.body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store, max-age=0',
        },
      })
    } catch (error) {
      lastError = error
      lastStatus = 502
    }
  }

  if (lastError) console.error('[stream/hls] proxy error:', lastError)
  return NextResponse.json(
    { ok: false, error: `HLS upstream failed on all configured bases, last HTTP ${lastStatus}` },
    { status: lastStatus },
  )
}

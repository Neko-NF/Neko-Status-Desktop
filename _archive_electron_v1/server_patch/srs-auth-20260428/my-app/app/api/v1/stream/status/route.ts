import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchSrsApi } from '@/lib/srs-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SRS_HLS_BASE = process.env.SRS_HLS_BASE_URL ?? ''

/**
 * GET /api/v1/stream/status
 * 查询当前设备的直播状态。
 *
 * Query params:
 *   srs_host     - SRS 主机名/IP（用于查询 SRS API）
 *   srs_api_port - SRS HTTP API 端口
 *   stream_key   - 推流 Key（可选，不传时从数据库取）
 *
 * Response: { ok: true, data: { status: 'live'|'idle'|'error', viewers?, bitrate_kbps?, hls_url? } }
 */
export async function GET(req: NextRequest) {
  const deviceKey = req.headers.get('X-API-Key') ?? ''
  if (!deviceKey) {
    return NextResponse.json({ ok: false, message: '缺少设备密钥', code: 'MISSING_KEY' }, { status: 401 })
  }

  const device = await prisma.device.findUnique({
    where: { verification: deviceKey },
    select: { id: true },
  })

  if (!device) {
    return NextResponse.json({ ok: false, message: '设备密钥无效', code: 'INVALID_KEY' }, { status: 403 })
  }

  try {
    const { searchParams } = req.nextUrl
    const srsHost = searchParams.get('srs_host') ?? ''
    const srsApiPort = Number(searchParams.get('srs_api_port')) || 1985
    const streamKeyParam = searchParams.get('stream_key') ?? ''

    // 从数据库取 Stream Key（优先用参数传入的值进行查询，但以数据库记录为准）
    const keyRecord = await prisma.deviceStreamKey.findUnique({
      where: { deviceId: device.id },
      select: { streamKey: true, isLive: true, liveStartedAt: true },
    })

    if (!keyRecord) {
      return NextResponse.json({ ok: true, data: { status: 'idle' } })
    }

    const streamKey = streamKeyParam || keyRecord.streamKey

    // 如果未提供 srsHost，直接返回数据库缓存的直播状态
    if (!srsHost) {
      return NextResponse.json({
        ok: true,
        data: {
          status: keyRecord.isLive ? 'live' : 'idle',
          hls_url: keyRecord.isLive && SRS_HLS_BASE
            ? `${SRS_HLS_BASE}/live/${streamKey}.m3u8`
            : null,
        },
      })
    }

    // 向 SRS 查询实时状态
    try {
      const res = await fetchSrsApi(
        `http://${srsHost}:${srsApiPort}/api/v1/streams?start=0&count=10`,
        { timeoutMs: 5000 },
      )

      if (!res.ok) {
        // SRS 不可达，降级到数据库状态
        return NextResponse.json({
          ok: true,
          data: { status: keyRecord.isLive ? 'live' : 'idle' },
        })
      }

      const json = await res.json().catch(() => ({}))
      // SRS streams API 返回 { streams: [ { name, app, clients, video, audio, ... } ] }
      const streams: Array<{ name?: string; clients?: number; video?: { bitrate?: number } }> =
        json?.streams ?? []

      const matched = streams.find((s) => s.name === streamKey)

      if (matched) {
        // 同步数据库标记（如果不一致）
        if (!keyRecord.isLive) {
          await prisma.deviceStreamKey.update({
            where: { deviceId: device.id },
            data: { isLive: true, liveStartedAt: new Date() },
          }).catch(() => {})
        }
        return NextResponse.json({
          ok: true,
          data: {
            status: 'live',
            viewers: matched.clients ?? 0,
            bitrate_kbps: matched.video?.bitrate ?? 0,
            hls_url: SRS_HLS_BASE ? `${SRS_HLS_BASE}/live/${streamKey}.m3u8` : null,
          },
        })
      } else {
        // 未找到推流，同步标记为 idle
        if (keyRecord.isLive) {
          await prisma.deviceStreamKey.update({
            where: { deviceId: device.id },
            data: { isLive: false, liveStartedAt: null },
          }).catch(() => {})
        }
        return NextResponse.json({ ok: true, data: { status: 'idle' } })
      }
    } catch {
      // SRS 连接超时，降级
      return NextResponse.json({
        ok: true,
        data: { status: keyRecord.isLive ? 'live' : 'idle' },
      })
    }
  } catch (error) {
    console.error('[v1/stream/status GET] error:', error)
    return NextResponse.json({ ok: false, message: 'Internal Server Error' }, { status: 500 })
  }
}

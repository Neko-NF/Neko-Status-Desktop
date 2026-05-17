import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { fetchSrsApi } from '@/lib/srs-api'

const SRS_HLS_BASE = process.env.SRS_HLS_BASE_URL ?? ''
const SRS_API_HOST = process.env.SRS_API_HOST ?? getHostFromUrl(SRS_HLS_BASE)
const SRS_API_PORT = Number(process.env.SRS_API_PORT) || 51985

function buildHlsUrl(streamKey: string): string {
  return `/api/stream/hls/live/${encodeURIComponent(streamKey)}.m3u8`
}

function getHostFromUrl(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return ''
  }
}

async function fetchLiveStreamStats(): Promise<Map<string, { viewers: number; bitrateKbps: number }>> {
  if (!SRS_API_HOST) return new Map()

  const res = await fetchSrsApi(
    `http://${SRS_API_HOST}:${SRS_API_PORT}/api/v1/streams?start=0&count=100`,
    { timeoutMs: 5000 },
  )

  if (!res.ok) return new Map()

  const json = await res.json().catch(() => ({}))
  const streams: Array<{
    name?: string
    clients?: number
    video?: { bitrate?: number }
  }> = json?.streams ?? []

  return new Map(
    streams
      .filter((stream) => stream.name)
      .map((stream) => [
        String(stream.name),
        {
          viewers: stream.clients ?? 0,
          bitrateKbps: stream.video?.bitrate ?? 0,
        },
      ]),
  )
}

export async function GET() {
  const session = await getSession()
  if (!session) return new NextResponse('Unauthorized', { status: 401 })

  try {
    const liveDevices = await prisma.deviceStreamKey.findMany({
      where: { isLive: true },
      include: {
        device: {
          select: {
            id: true,
            name: true,
            owner: { select: { username: true } },
          },
        },
      },
    })

    if (liveDevices.length === 0) {
      return NextResponse.json({ ok: true, devices: [] })
    }

    let liveStats: Map<string, { viewers: number; bitrateKbps: number }> | null = null
    try {
      liveStats = await fetchLiveStreamStats()
    } catch {
      liveStats = new Map()
    }

    const devices = liveDevices
      .map((d) => {
        const stats = liveStats?.get(d.streamKey)
        if (liveStats && !stats) return null

        return {
          deviceId: d.deviceId,
          deviceName: d.device.name,
          ownerName: d.device.owner.username,
          streamKey: d.streamKey,
          hlsUrl: buildHlsUrl(d.streamKey),
          viewers: stats?.viewers ?? 0,
          bitrateKbps: stats?.bitrateKbps ?? 0,
          durationSeconds: 0,
          startedAt: d.liveStartedAt?.toISOString() ?? '',
        }
      })
      .filter(Boolean)

    return NextResponse.json({ ok: true, devices })
  } catch (error) {
    console.error('[stream/live-devices] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 })
  }
}

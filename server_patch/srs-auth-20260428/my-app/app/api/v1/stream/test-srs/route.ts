import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchSrsApi } from '@/lib/srs-api'
import * as net from 'net'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * TCP 端口连通性探测（Node.js net 模块，纯 TCP 握手）
 */
function tcpProbe(host: string, port: number, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let resolved = false

    const done = (result: boolean) => {
      if (resolved) return
      resolved = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeout)
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
    socket.on('timeout', () => done(false))

    socket.connect(port, host)
  })
}

/**
 * SRS HTTP API 可达性探测（GET /api/v1/versions）
 */
async function httpApiProbe(
  host: string,
  apiPort: number,
  timeout = 5000,
): Promise<{ reachable: boolean; srsVersion?: string; status?: number }> {
  try {
    const res = await fetchSrsApi(`http://${host}:${apiPort}/api/v1/versions`, { timeoutMs: timeout })
    if (!res.ok) return { reachable: false, status: res.status }
    const json = await res.json().catch(() => ({}))
    const v = json?.data
    const srsVersion = v ? `${v.major ?? ''}.${v.minor ?? ''}.${v.revision ?? ''}`.replace(/^\.+|\.+$/g, '') : ''
    return { reachable: true, srsVersion: srsVersion || 'unknown' }
  } catch {
    return { reachable: false }
  }
}

/**
 * POST /api/v1/stream/test-srs
 * 桌面客户端（Neko Status）调用：测试 SRS 服务器的 RTMP 和 API 端口连通性。
 *
 * 鉴权：Header 中携带 X-API-Key（设备密钥），验证设备存在即可。
 *
 * Body: {
 *   srs_host:      string   - SRS 主机名 / IP
 *   srs_rtmp_port: number   - RTMP 端口（如 51935）
 *   srs_api_port:  number   - SRS HTTP API 端口（如 51985）
 * }
 */
export async function POST(req: NextRequest) {
  // ─── 鉴权：验证设备密钥 ───────────────────────────────────────────────
  const deviceKey = req.headers.get('X-API-Key') ?? ''
  if (!deviceKey) {
    return NextResponse.json({ ok: false, message: '缺少设备密钥' }, { status: 401 })
  }

  const device = await prisma.device.findUnique({
    where: { verification: deviceKey },
    select: { id: true },
  })

  if (!device) {
    return NextResponse.json(
      { ok: false, message: '设备密钥无效', code: 'INVALID_KEY' },
      { status: 403 },
    )
  }

  // ─── 解析请求参数 ─────────────────────────────────────────────────────
  let body: { srs_host?: string; srs_rtmp_port?: number; srs_api_port?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: '请求体 JSON 解析失败' }, { status: 400 })
  }

  const srsHost = String(body?.srs_host ?? '').trim()
  const srsRtmpPort = Number(body?.srs_rtmp_port) || 1935
  const srsApiPort = Number(body?.srs_api_port) || 1985

  if (!srsHost) {
    return NextResponse.json({ ok: false, message: 'srs_host 必填' }, { status: 400 })
  }

  if (
    !Number.isInteger(srsRtmpPort) || srsRtmpPort < 1 || srsRtmpPort > 65535 ||
    !Number.isInteger(srsApiPort) || srsApiPort < 1 || srsApiPort > 65535
  ) {
    return NextResponse.json({ ok: false, message: '端口号超出有效范围 (1-65535)' }, { status: 400 })
  }

  // ─── 并行探测 RTMP + SRS HTTP API ─────────────────────────────────────
  const [rtmp_reachable, apiResult] = await Promise.all([
    tcpProbe(srsHost, srsRtmpPort, 5000),
    httpApiProbe(srsHost, srsApiPort, 5000),
  ])

  const api_reachable = apiResult.reachable
  const srs_version = apiResult.srsVersion ?? ''
  const api_status = apiResult.status ?? null

  let reason = ''
  if (!api_reachable && (api_status === 401 || api_status === 403)) {
    reason = `SRS API port ${srsApiPort} is reachable, but authentication failed. Check SRS_API_USERNAME / SRS_API_PASSWORD.`
  } else if (!rtmp_reachable && !api_reachable) {
    reason = `RTMP 端口 ${srsRtmpPort} 和 API 端口 ${srsApiPort} 均无法连接，请检查 SRS 是否运行及防火墙规则`
  } else if (!rtmp_reachable) {
    reason = `RTMP 端口 ${srsRtmpPort} 无法连接（API 正常），请检查防火墙是否放行该端口`
  } else if (!api_reachable) {
    reason = `SRS API 端口 ${srsApiPort} 无法连接（RTMP 正常），请检查防火墙是否放行该端口`
  }

  return NextResponse.json({
    ok: true,
    data: {
      rtmp_reachable,
      api_reachable,
      api_status,
      srs_version,
      reason,
    },
  })
}

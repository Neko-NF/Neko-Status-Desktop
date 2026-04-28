import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { fetchSrsApi } from '@/lib/srs-api'
import * as net from 'net'

export const runtime = 'nodejs'

/**
 * TCP 端口连通性探测（使用 Node.js net 模块，纯 TCP 握手）
 * timeout 单位：毫秒
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
 * 测试 SRS HTTP API 可达性（GET /api/v1/versions）
 */
async function httpApiProbe(host: string, apiPort: number, timeout = 5000): Promise<{ reachable: boolean; srsVersion?: string; status?: number }> {
  try {
    const res = await fetchSrsApi(`http://${host}:${apiPort}/api/v1/versions`, { timeoutMs: timeout })
    if (!res.ok) return { reachable: false, status: res.status }
    const json = await res.json().catch(() => ({}))
    // SRS API 返回 { code: 0, server: ..., data: { major, minor, ... } }
    const v = json?.data
    const srsVersion = v ? `${v.major ?? ''}.${v.minor ?? ''}.${v.revision ?? ''}` : ''
    return { reachable: true, srsVersion: srsVersion.replace(/^\.+|\.+$/g, '') || 'unknown' }
  } catch {
    return { reachable: false }
  }
}

/**
 * POST /api/stream/test-srs
 * Body: { srs_host: string, srs_rtmp_port: number, srs_api_port: number }
 *
 * 需要用户登录 Session。使用 Node.js net 模块直接探测 TCP 端口，
 * 比客户端直接连接更稳定（服务端出口通常不受本地防火墙限制）。
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return new NextResponse('Unauthorized', { status: 401 })

  try {
    const body = await req.json()
    const srsHost: string = String(body?.srs_host ?? '').trim()
    const srsRtmpPort: number = Number(body?.srs_rtmp_port) || 1935
    const srsApiPort: number = Number(body?.srs_api_port) || 1985

    if (!srsHost) {
      return NextResponse.json({ ok: false, error: 'srs_host 必填' }, { status: 400 })
    }

    if (srsRtmpPort < 1 || srsRtmpPort > 65535 || srsApiPort < 1 || srsApiPort > 65535) {
      return NextResponse.json({ ok: false, error: '端口号超出有效范围 (1-65535)' }, { status: 400 })
    }

    // 并行探测 RTMP TCP 端口 + SRS HTTP API
    const [rtmp_reachable, apiResult] = await Promise.all([
      tcpProbe(srsHost, srsRtmpPort, 5000),
      httpApiProbe(srsHost, srsApiPort, 5000),
    ])

    const api_reachable = apiResult.reachable
    const srs_version = apiResult.srsVersion ?? ''
    const api_status = apiResult.status ?? null
    const authFailed = api_status === 401 || api_status === 403

    return NextResponse.json({
      ok: true,
      data: {
        rtmp_reachable,
        api_reachable,
        api_status,
        srs_version,
        // 给客户端返回一个原因说明（仅失败时有意义）
        reason: !rtmp_reachable && !api_reachable
          ? `RTMP 端口 ${srsRtmpPort} 和 API 端口 ${srsApiPort} 均无法连接，请检查 SRS 服务是否启动及防火墙设置`
          : !rtmp_reachable
          ? `RTMP 端口 ${srsRtmpPort} 无法连接，SRS API 正常`
          : authFailed
          ? `SRS API port ${srsApiPort} is reachable, but authentication failed. Check SRS_API_USERNAME / SRS_API_PASSWORD.`
          : !api_reachable
          ? `SRS API 端口 ${srsApiPort} 无法连接，RTMP 端口正常`
          : '',
      },
    })
  } catch (error) {
    console.error('[stream/test-srs] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 })
  }
}

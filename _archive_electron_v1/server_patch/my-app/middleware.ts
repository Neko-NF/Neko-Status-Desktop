import { type NextRequest, NextResponse } from 'next/server'
import { SignJWT, jwtVerify } from 'jose'

// 安全检查：生产环境必须设置 JWT_SECRET
const secretKey = process.env.JWT_SECRET
if (!secretKey && process.env.NODE_ENV === 'production') {
  throw new Error('[SECURITY] JWT_SECRET 环境变量未设置！生产环境必须配置此变量。')
}
const key = new TextEncoder().encode(secretKey || 'dev-secret-do-not-use-in-production')

// 公开路径 - 无需登录即可访问
const publicPaths = [
  '/login',
  '/api/auth',        // 认证相关 API
  '/api/captcha',     // 验证码 API
  '/api/v2/status',   // 客户端状态上报 API (Windows/移动端)
  '/api/usage',       // 应用使用数据上报 API
  '/api/screenshots', // 截图上传 API
  '/api/device',      // 设备注册 API
  '/api/widget/token', // Widget Token API (客户端通过 deviceKey 认证)
  '/api/v2/widget/status', // Widget Status API (通过 widgetToken 认证)
  '/api/v1/stream',   // 直播推流 API (桌面客户端通过 X-API-Key 认证)
  '/api/pair',        // 设备配对 API (桌面客户端配对握手)
  '/view/screenshot', // 截图查看页面 (小组件跳转)
]

// 检查是否为公开路径
function isPublicPath(pathname: string): boolean {
  // 根路径重定向到 /login
  if (pathname === '/') return true

  // 检查是否匹配公开路径
  return publicPaths.some(path => pathname.startsWith(path))
}

// 解密 session
async function decrypt(input: string): Promise<any> {
  try {
    const { payload } = await jwtVerify(input, key, {
      algorithms: ['HS256'],
    })
    return payload
  } catch {
    return null
  }
}

// 加密 session
async function encrypt(payload: any) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(key)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 🔒 安全措施：生产环境禁用测试 API
  if (pathname.startsWith('/api/test')) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Test API is disabled in production' },
        { status: 403 }
      )
    }
    // 开发环境也需要登录才能访问测试 API
    const session = request.cookies.get('session')?.value
    const sessionData = session ? await decrypt(session) : null
    if (!sessionData) {
      return NextResponse.json(
        { error: 'Authentication required for test API' },
        { status: 401 }
      )
    }
  }

  // 获取 session
  const session = request.cookies.get('session')?.value
  const sessionData = session ? await decrypt(session) : null
  const isAuthenticated = !!sessionData

  // 如果已登录且访问登录页，重定向到 dashboard
  if (isAuthenticated && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // 如果是公开路径，直接放行
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // 如果未登录且访问受保护路径，重定向到登录页
  if (!isAuthenticated) {
    const loginUrl = new URL('/login', request.url)
    // 保存原始路径，登录后可以跳转回去
    loginUrl.searchParams.set('redirect', pathname)
    loginUrl.searchParams.set('error', '请先登录后再访问该页面')
    return NextResponse.redirect(loginUrl)
  }

  // 已登录用户访问受保护路径，更新 session 过期时间
  const response = NextResponse.next()

  // 更新 session 过期时间
  if (sessionData) {
    sessionData.expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
    response.cookies.set({
      name: 'session',
      value: await encrypt(sessionData),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: sessionData.expires,
      path: '/',
    })
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|wallpapers|uploads|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}

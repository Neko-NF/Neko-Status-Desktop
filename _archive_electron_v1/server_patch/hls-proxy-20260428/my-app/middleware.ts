import { type NextRequest, NextResponse } from 'next/server'
import { SignJWT, jwtVerify } from 'jose'

const secretKey = process.env.JWT_SECRET
if (!secretKey && process.env.NODE_ENV === 'production') {
  throw new Error('[SECURITY] JWT_SECRET is required in production')
}

const key = new TextEncoder().encode(secretKey || 'dev-secret-do-not-use-in-production')

const publicPaths = [
  '/login',
  '/api/auth',
  '/api/captcha',
  '/api/v2/status',
  '/api/usage',
  '/api/screenshots',
  '/api/device',
  '/api/widget/token',
  '/api/v2/widget/status',
  '/api/stream/hls',
  '/api/v1/stream',
  '/api/pair',
  '/view/screenshot',
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  return publicPaths.some((path) => pathname.startsWith(path))
}

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

async function encrypt(payload: any) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(key)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/api/test')) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Test API is disabled in production' },
        { status: 403 },
      )
    }

    const session = request.cookies.get('session')?.value
    const sessionData = session ? await decrypt(session) : null
    if (!sessionData) {
      return NextResponse.json(
        { error: 'Authentication required for test API' },
        { status: 401 },
      )
    }
  }

  const session = request.cookies.get('session')?.value
  const sessionData = session ? await decrypt(session) : null
  const isAuthenticated = !!sessionData

  if (isAuthenticated && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  if (!isAuthenticated) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    loginUrl.searchParams.set('error', '请先登录后再访问该页面')
    return NextResponse.redirect(loginUrl)
  }

  const response = NextResponse.next()

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
    '/((?!_next/static|_next/image|favicon.ico|wallpapers|uploads|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}

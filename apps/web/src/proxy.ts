import { decodeJwt } from 'jose'
import { NextResponse, type NextRequest } from 'next/server'
import { authProvider } from './server/auth-provider'
import { COOKIE } from './server/cookies'
import { env } from './server/env'

/**
 * Optimistic gate (Next.js recommends real checks in the data layer; see server/session.ts):
 * - no session at all -> /login
 * - access token missing or about to expire, refresh token present -> refresh it with Cognito
 *   and continue with the new token (both for this request and in the browser cookie).
 */
export async function proxy(req: NextRequest) {
  const access = req.cookies.get(COOKIE.access)?.value
  if (access && !expiresWithin(access, 30)) return NextResponse.next()

  const refreshToken = req.cookies.get(COOKIE.refresh)?.value
  const username = req.cookies.get(COOKIE.username)?.value
  if (refreshToken && username) {
    try {
      const tokens = await (await authProvider()).refresh(refreshToken, username)
      req.cookies.set(COOKIE.access, tokens.accessToken)
      const res = NextResponse.next({ request: { headers: req.headers } })
      res.cookies.set(COOKIE.access, tokens.accessToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.secureCookies,
        path: '/',
        maxAge: tokens.expiresIn,
      })
      return res
    } catch {
      // Refresh token expired or revoked: fall through to sign in again.
    }
  }

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized', message: 'Sessão expirada.' }, { status: 401 })
  }
  return NextResponse.redirect(new URL('/login', req.url))
}

function expiresWithin(token: string, seconds: number): boolean {
  try {
    const { exp } = decodeJwt(token)
    return !exp || exp * 1000 - Date.now() < seconds * 1000
  } catch {
    return true
  }
}

export const config = {
  // Everything except the login page, health check and static assets.
  matcher: ['/((?!login|api/health|_next/static|_next/image|favicon.ico).*)'],
}

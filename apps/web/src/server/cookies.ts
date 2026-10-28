import type { AuthTokens } from '@nexo/shared'

/**
 * Tokens live in httpOnly cookies: JavaScript in the page can never read them.
 * The refresh token is kept for 30 days only when "Manter conectado" is checked;
 * otherwise it is a session cookie that dies with the browser.
 */
export const COOKIE = {
  access: 'nx_access',
  refresh: 'nx_refresh',
  /** Cognito needs the username to refresh; not a secret, but kept httpOnly too. */
  username: 'nx_user',
} as const

const THIRTY_DAYS = 30 * 24 * 3600

type CookieWriter = {
  set(name: string, value: string, options: Record<string, unknown>): unknown
  delete(name: string): unknown
}

export function writeSessionCookies(
  jar: CookieWriter,
  tokens: AuthTokens,
  opts: { username: string; remember: boolean; secure: boolean },
) {
  const base = { httpOnly: true, sameSite: 'lax', secure: opts.secure, path: '/' }
  const longLived = opts.remember ? { maxAge: THIRTY_DAYS } : {}
  jar.set(COOKIE.access, tokens.accessToken, { ...base, maxAge: tokens.expiresIn })
  if (tokens.refreshToken) jar.set(COOKIE.refresh, tokens.refreshToken, { ...base, ...longLived })
  jar.set(COOKIE.username, opts.username, { ...base, ...longLived })
}

export function clearSessionCookies(jar: CookieWriter) {
  for (const name of Object.values(COOKIE)) jar.delete(name)
}

import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isUnauthorizedError, type AuthUser, type Role } from '@nexo/shared'
import type { SessionProfile } from '@/lib/auth-types'
import { authProvider } from './auth-provider'
import { COOKIE } from './cookies'
import { assistDb } from './db'

export type Session = { user: AuthUser; profile: SessionProfile; accessToken: string }

export const HOME_BY_ROLE: Record<Role, string> = { employee: '/atendimento', analyst: '/console' }

/**
 * The real authorization check (the proxy only does optimistic redirects).
 * Verifies the access token's signature and claims, then loads the profile. Cached per request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const accessToken = (await cookies()).get(COOKIE.access)?.value
  if (!accessToken) return null
  try {
    const user = await (await authProvider()).verify(accessToken)
    const doc = await (await assistDb()).users.findOne({ _id: user.userId })
    if (!doc) return null
    const profile: SessionProfile = {
      userId: doc._id,
      name: doc.name,
      email: doc.email,
      // The role always comes from the token (Cognito groups), never from our own database.
      role: user.role,
      department: doc.department,
      ...(doc.team ? { team: doc.team } : {}),
    }
    return { user, profile, accessToken }
  } catch (err) {
    if (isUnauthorizedError(err)) return null
    throw err
  }
})

/** For pages and server actions: redirects to /login, or to the right area for the user's role. */
export async function requireSession(role?: Role): Promise<Session> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (role && session.user.role !== role) redirect(HOME_BY_ROLE[session.user.role])
  return session
}

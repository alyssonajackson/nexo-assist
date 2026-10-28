import type { Role } from '../domain/conversation'
import {
  InvalidCredentialsError,
  UnauthorizedError,
  type AuthProvider,
  type AuthTokens,
  type AuthUser,
} from './auth'

type FakeUser = { userId: string; email: string; password: string; role: Role }

/** Test double: opaque random tokens kept in memory. */
export class InMemoryAuthProvider implements AuthProvider {
  private readonly sessions = new Map<string, AuthUser>()

  constructor(private readonly users: FakeUser[]) {}

  async signIn(email: string, password: string): Promise<AuthTokens> {
    const user = this.users.find((u) => u.email === email && u.password === password)
    if (!user) throw new InvalidCredentialsError()
    return this.issue(user)
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const user = this.sessions.get(refreshToken)
    if (!user) throw new UnauthorizedError('Unknown refresh token')
    return this.issue({ ...user, password: '' })
  }

  async verify(accessToken: string): Promise<AuthUser> {
    const user = this.sessions.get(accessToken)
    if (!user) throw new UnauthorizedError('Unknown token')
    return user
  }

  private issue(user: FakeUser): AuthTokens {
    const authUser: AuthUser = { userId: user.userId, email: user.email, role: user.role }
    const accessToken = crypto.randomUUID()
    const refreshToken = crypto.randomUUID()
    this.sessions.set(accessToken, authUser)
    this.sessions.set(refreshToken, authUser)
    return { accessToken, idToken: accessToken, refreshToken, expiresIn: 3600 }
  }
}

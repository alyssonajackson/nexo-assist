import { z } from 'zod'
import { Role } from '../domain/conversation'

/** Who is calling, as proven by a verified token. Never taken from the request body or the prompt. */
export const AuthUser = z.object({
  userId: z.string(),
  email: z.string(),
  role: Role,
})
export type AuthUser = z.infer<typeof AuthUser>

export type AuthTokens = {
  accessToken: string
  idToken: string
  refreshToken?: string
  /** Seconds until the access token expires. */
  expiresIn: number
}

/**
 * Authentication port. CognitoAuthProvider (@nexo/shared/aws) talks to Cognito or cognito-local;
 * InMemoryAuthProvider is for unit tests.
 */
export interface AuthProvider {
  /** Throws InvalidCredentialsError on a wrong email or password. */
  signIn(email: string, password: string): Promise<AuthTokens>
  refresh(refreshToken: string, email: string): Promise<AuthTokens>
  /** Throws UnauthorizedError when the token is missing, expired, forged or from another app client. */
  verify(accessToken: string): Promise<AuthUser>
}

export class InvalidCredentialsError extends Error {
  override name = 'InvalidCredentialsError'
  constructor() {
    super('E-mail ou senha inválidos.')
  }
}

export class UnauthorizedError extends Error {
  override name = 'UnauthorizedError'
}

/** The analyst group wins if a user is in both. */
export const roleFromGroups = (groups: readonly string[]): Role =>
  groups.includes('analyst') ? 'analyst' : 'employee'

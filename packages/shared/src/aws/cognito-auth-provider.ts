import {
  InitiateAuthCommand,
  type AuthenticationResultType,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import {
  InvalidCredentialsError,
  UnauthorizedError,
  type AuthProvider,
  type AuthTokens,
  type AuthUser,
} from '../auth/auth'
import { createJwtVerifier } from '../auth/jwt-verifier'
import type { CognitoConfig } from './cognito-config'

const CREDENTIAL_ERRORS = new Set([
  'NotAuthorizedException',
  'UserNotFoundException',
  'InvalidPasswordException',
])

/** AuthProvider backed by Cognito (or Floci): USER_PASSWORD_AUTH plus JWT verification. */
export class CognitoAuthProvider implements AuthProvider {
  private readonly verifyToken: (token: string) => Promise<AuthUser>

  constructor(
    private readonly client: CognitoIdentityProviderClient,
    private readonly config: CognitoConfig,
  ) {
    this.verifyToken = createJwtVerifier({
      issuer: config.issuer,
      clientId: config.clientId,
      jwksUrl: config.jwksUrl,
    })
  }

  async signIn(email: string, password: string): Promise<AuthTokens> {
    try {
      const res = await this.client.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: this.config.clientId,
          AuthParameters: { USERNAME: email.trim().toLowerCase(), PASSWORD: password },
        }),
      )
      return toTokens(res.AuthenticationResult)
    } catch (err) {
      if (err instanceof Error && CREDENTIAL_ERRORS.has(err.name)) throw new InvalidCredentialsError()
      throw err
    }
  }

  async refresh(refreshToken: string, email: string): Promise<AuthTokens> {
    try {
      const res = await this.client.send(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: this.config.clientId,
          AuthParameters: { REFRESH_TOKEN: refreshToken, USERNAME: email },
        }),
      )
      // Cognito does not rotate the refresh token here; keep the old one.
      return { ...toTokens(res.AuthenticationResult), refreshToken }
    } catch (err) {
      if (err instanceof Error && CREDENTIAL_ERRORS.has(err.name)) throw new UnauthorizedError(err.message)
      throw err
    }
  }

  verify(accessToken: string): Promise<AuthUser> {
    return this.verifyToken(accessToken)
  }
}

function toTokens(result: AuthenticationResultType | undefined): AuthTokens {
  if (!result?.AccessToken || !result.IdToken) {
    // A challenge (e.g. NEW_PASSWORD_REQUIRED) means the user was not provisioned correctly.
    throw new UnauthorizedError('Cognito did not return tokens')
  }
  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    ...(result.RefreshToken ? { refreshToken: result.RefreshToken } : {}),
    expiresIn: result.ExpiresIn ?? 3600,
  }
}

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { isUnauthorizedError, roleFromGroups, UnauthorizedError, type AuthUser } from './auth'

export type JwtVerifierConfig = {
  /** Expected `iss`, e.g. https://cognito-idp.us-east-1.amazonaws.com/<poolId>. */
  issuer: string
  /** Only tokens issued to our app client are accepted. */
  clientId: string
  jwksUrl?: string
  /** Injected key set for tests. */
  keys?: JWTVerifyGetKey
}

/**
 * Verifies a Cognito access token: RS256 signature against the pool's JWKS, issuer, expiry,
 * token_use and client_id. Works the same for real Cognito and Floci.
 * (aws-jwt-verify hard-codes the AWS host, so jose is used to keep one code path.)
 */
export function createJwtVerifier(config: JwtVerifierConfig) {
  const keys = config.keys ?? createRemoteJWKSet(new URL(requiredJwksUrl(config)))

  return async function verify(token: string | undefined): Promise<AuthUser> {
    if (!token) throw new UnauthorizedError('Missing token')
    try {
      const { payload } = await jwtVerify(token, keys, { issuer: config.issuer, algorithms: ['RS256'] })
      if (payload.token_use !== 'access') throw new UnauthorizedError('Not an access token')
      if (payload.client_id !== config.clientId) throw new UnauthorizedError('Token from another client')
      if (!payload.sub) throw new UnauthorizedError('Token without subject')
      const groups = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'].map(String) : []
      return {
        userId: payload.sub,
        username: typeof payload.username === 'string' ? payload.username : '',
        role: roleFromGroups(groups),
      }
    } catch (err) {
      if (isUnauthorizedError(err)) throw err
      throw new UnauthorizedError(err instanceof Error ? err.message : 'Invalid token')
    }
  }
}

function requiredJwksUrl(config: JwtVerifierConfig): string {
  if (!config.jwksUrl) throw new Error('jwksUrl or keys is required')
  return config.jwksUrl
}

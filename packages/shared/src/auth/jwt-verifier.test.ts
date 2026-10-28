import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { UnauthorizedError } from './auth'
import { createJwtVerifier } from './jwt-verifier'

const issuer = 'http://localhost:9229/local_test'
const clientId = 'web-client'
let sign: (claims: JWTPayload, opts?: { expiresIn?: string; issuer?: string }) => Promise<string>
let verify: ReturnType<typeof createJwtVerifier>

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
  verify = createJwtVerifier({ issuer, clientId, keys: createLocalJWKSet({ keys: [jwk] }) })
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.issuer ?? issuer)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign(privateKey)
})

const accessClaims = (extra: JWTPayload = {}): JWTPayload => ({
  sub: 'user-1',
  token_use: 'access',
  client_id: clientId,
  username: 'ana.souza@nexo.com.br',
  'cognito:groups': ['employee'],
  ...extra,
})

describe('createJwtVerifier', () => {
  it('returns the user id, e-mail and role from a valid access token', async () => {
    await expect(verify(await sign(accessClaims()))).resolves.toEqual({
      userId: 'user-1',
      email: 'ana.souza@nexo.com.br',
      role: 'employee',
    })
  })

  it('maps the analyst group to the analyst role', async () => {
    const user = await verify(await sign(accessClaims({ 'cognito:groups': ['analyst'] })))
    expect(user.role).toBe('analyst')
  })

  it('treats a user without groups as an employee', async () => {
    const user = await verify(await sign(accessClaims({ 'cognito:groups': undefined })))
    expect(user.role).toBe('employee')
  })

  it.each([
    ['a missing token', async () => undefined],
    ['an id token', async () => sign(accessClaims({ token_use: 'id' }))],
    ['a token from another app client', async () => sign(accessClaims({ client_id: 'other' }))],
    ['a token from another issuer', async () => sign(accessClaims(), { issuer: 'http://evil/pool' })],
    ['an expired token', async () => sign(accessClaims(), { expiresIn: '-1m' })],
    ['a tampered token', async () => (await sign(accessClaims())).replace(/\.[^.]+$/, '.xxxx')],
  ])('rejects %s', async (_label, makeToken) => {
    await expect(verify(await makeToken())).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

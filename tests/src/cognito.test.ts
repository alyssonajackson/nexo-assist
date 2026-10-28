import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose'
import type { MongoClient } from 'mongodb'
import { ASSIST_COLLECTIONS, DB } from '@nexo/shared'
import { cognitoConfig, login } from './helpers/cognito'
import { connectMongo, type SeedMeta } from './helpers/mongo'

describe('Cognito login (Floci)', () => {
  let mongo: MongoClient
  let seededIds: Record<string, string>
  beforeAll(async () => {
    mongo = await connectMongo()
    const meta = await mongo
      .db(DB.assist)
      .collection<SeedMeta>(ASSIST_COLLECTIONS.meta)
      .findOne({ _id: 'seed' })
    seededIds = meta?.userIds ?? {}
  })
  afterAll(() => mongo.close())

  it.each([
    { key: 'ana', email: 'ana.souza@nexo.com.br', group: 'employee' },
    { key: 'rafael', email: 'rafael.lima@nexo.com.br', group: 'analyst' },
  ])('issues an access token for $key with the $group group', async ({ key, email, group }) => {
    const { issuer } = await cognitoConfig()
    const { accessToken } = await login(email)
    const claims = decodeJwt(accessToken)

    expect(claims.token_use).toBe('access')
    expect(claims.iss).toBe(issuer)
    expect(claims['cognito:groups']).toEqual([group])
    // The seed uses the Cognito sub as the user id, so tickets and conversations point to it.
    expect(claims.sub).toBe(seededIds[key])
  })

  it('rejects a wrong password', async () => {
    const error = await login('ana.souza@nexo.com.br', 'wrong-password').then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('NotAuthorizedException')
  })

  it('signs tokens that verify against the JWKS with the expected issuer', async () => {
    const { issuer, jwksUrl } = await cognitoConfig()
    const { accessToken } = await login('ana.souza@nexo.com.br')
    const jwks = createRemoteJWKSet(new URL(jwksUrl))

    const { payload } = await jwtVerify(accessToken, jwks, { issuer })
    expect(payload.token_use).toBe('access')

    await expect(
      jwtVerify(accessToken, jwks, { issuer: 'http://localhost:4566/other-pool' }),
    ).rejects.toThrow()
  })
})

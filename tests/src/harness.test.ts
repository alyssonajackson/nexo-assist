import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MongoClient } from 'mongodb'
import { ASSIST_COLLECTIONS, DB } from '@nexo/shared'
import { cognitoConfig } from './helpers/cognito'
import { connectMongo, type SeedMeta } from './helpers/mongo'

describe('harness', () => {
  let mongo: MongoClient
  beforeAll(async () => {
    mongo = await connectMongo()
  })
  afterAll(() => mongo.close())

  it('discovers the Cognito pool and app client by name', async () => {
    const config = await cognitoConfig()
    expect(config.userPoolId).toBeTruthy()
    expect(config.clientId).toBeTruthy()
  })

  it('finds the seed marker written by the init container', async () => {
    const meta = await mongo
      .db(DB.assist)
      .collection<SeedMeta>(ASSIST_COLLECTIONS.meta)
      .findOne({ _id: 'seed' })
    expect(meta).not.toBeNull()
  })
})

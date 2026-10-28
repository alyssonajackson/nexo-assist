import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MongoClient } from 'mongodb'
import { ListUserPoolsCommand } from '@aws-sdk/client-cognito-identity-provider'
import { ASSIST_COLLECTIONS, DB } from '@nexo/shared'
import { findUserPoolId } from '@nexo/shared/aws'
import { cognito } from './helpers/cognito'
import { connectMongo, type SeedMeta } from './helpers/mongo'
import { env } from './env'

const repoRoot = resolve(import.meta.dirname, '../..')

/** Runs the same init script as the compose `init` container, from the host against the emulators. */
const runInit = () =>
  promisify(execFile)('pnpm', ['--filter', '@nexo/scripts', 'init:local'], {
    cwd: repoRoot,
    env: process.env,
    timeout: 60_000,
  })

describe('init is idempotent', () => {
  let mongo: MongoClient
  beforeAll(async () => {
    mongo = await connectMongo()
  })
  afterAll(() => mongo.close())

  const seedMeta = () =>
    mongo.db(DB.assist).collection<SeedMeta>(ASSIST_COLLECTIONS.meta).findOne({ _id: 'seed' })

  it('keeps the same user pool and does not reseed on a second and third run', async () => {
    const poolBefore = await findUserPoolId(cognito, env.COGNITO_USER_POOL_NAME)
    const metaBefore = await seedMeta()
    expect(poolBefore).toBeTruthy()
    expect(metaBefore).not.toBeNull()

    for (let run = 0; run < 2; run++) {
      const { stdout } = await runInit()
      expect(stdout).toContain('seed: skipped')

      expect(await findUserPoolId(cognito, env.COGNITO_USER_POOL_NAME)).toBe(poolBefore)
      const meta = await seedMeta()
      expect(meta?.seededAt).toEqual(metaBefore?.seededAt)
      expect(meta?.userIds).toEqual(metaBefore?.userIds)
    }

    const pools = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }))
    expect(pools.UserPools?.filter((p) => p.Name === env.COGNITO_USER_POOL_NAME)).toHaveLength(1)
  })
})

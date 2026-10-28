/**
 * One-shot, idempotent bootstrap for local runs (the `init` container, or `pnpm init:local`):
 * 1. MongoDB single-node replica set
 * 2. Cognito user pool, app client, groups and seeded users (Floci or real Cognito)
 * 3. SQS queues and their dead-letter queues (Floci or real SQS)
 * 4. Seed data relative to "now" (only when empty, when Cognito ids changed, or with --reset)
 */
import { MongoClient } from 'mongodb'
import { ASSIST_COLLECTIONS, DB } from '@nexo/shared'
import { cognitoClient, sqsClient } from '@nexo/shared/aws'
import { ensureUser, ensureUserPool } from './lib/cognito'
import { ensureReplicaSet } from './lib/mongo'
import { ensureQueues } from './lib/queues'
import { seedAssistDb, seedTicketsDb, seedUsers, type UserIds } from './seed/seed'

const env = {
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true',
  replicaHost: process.env.MONGO_REPLICA_HOST ?? 'localhost:27017',
  poolName: process.env.COGNITO_USER_POOL_NAME ?? 'nexo-assist',
  seedPassword: process.env.SEED_PASSWORD ?? 'nexo123',
  reset: process.argv.includes('--reset'),
}

async function main() {
  await ensureReplicaSet(env.mongoUri, env.replicaHost)

  const cognito = cognitoClient()
  const { userPoolId, clientId } = await ensureUserPool(cognito, env.poolName)
  const ids = {} as UserIds
  for (const u of seedUsers) {
    ids[u.key] = await ensureUser(cognito, userPoolId, {
      email: u.email,
      name: u.name,
      role: u.role,
      password: env.seedPassword,
    })
  }
  console.log(`cognito: pool ${userPoolId}, client ${clientId}, ${seedUsers.length} users`)

  await ensureQueues(sqsClient())

  const mongo = new MongoClient(env.mongoUri)
  await mongo.connect()
  try {
    const assist = mongo.db(DB.assist)
    const meta = assist.collection<{ _id: string; userIds: UserIds; seededAt: Date }>(ASSIST_COLLECTIONS.meta)
    const previous = await meta.findOne({ _id: 'seed' })
    // Re-seed when Cognito was recreated (new subs), otherwise tickets would point to unknown users.
    const idsChanged = JSON.stringify(previous?.userIds) !== JSON.stringify(ids)

    if (env.reset || !previous || idsChanged) {
      const now = new Date()
      await seedTicketsDb(mongo.db(DB.tickets), ids, now)
      await seedAssistDb(assist, ids, now)
      await meta.updateOne({ _id: 'seed' }, { $set: { userIds: ids, seededAt: now } }, { upsert: true })
      console.log(`seed: done (relative to ${now.toISOString()})`)
    } else {
      console.log(
        `seed: skipped, already seeded at ${previous.seededAt.toISOString()} (use --reset to refresh)`,
      )
    }
  } finally {
    await mongo.close()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})

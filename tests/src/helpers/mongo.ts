import { MongoClient } from 'mongodb'
import { env } from '../env'

/** Connects a client for one test file; close it in afterAll. */
export async function connectMongo(): Promise<MongoClient> {
  const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 })
  await client.connect()
  return client
}

/** Written by scripts/src/init.ts after each seed. */
export type SeedMeta = { _id: string; userIds: Record<string, string>; seededAt: Date }

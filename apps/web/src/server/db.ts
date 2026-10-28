import 'server-only'
import { MongoClient, type Collection } from 'mongodb'
import { ASSIST_COLLECTIONS, DB, type Role } from '@nexo/shared'
import { env } from './env'

export type UserDoc = {
  _id: string
  email: string
  name: string
  role: Role
  department: string
  team?: string
}

export type AssistDb = {
  users: Collection<UserDoc>
}

// One client per process; kept on globalThis so dev hot reloads do not open new pools.
const globalForMongo = globalThis as unknown as { nexoAssistDb?: Promise<AssistDb> }

/** The `assist` database is owned by the web app (users, conversations, messages, drafts). */
export function assistDb(): Promise<AssistDb> {
  globalForMongo.nexoAssistDb ??= connect().catch((err: unknown) => {
    globalForMongo.nexoAssistDb = undefined
    throw err
  })
  return globalForMongo.nexoAssistDb
}

async function connect(): Promise<AssistDb> {
  const client = await new MongoClient(env.mongoUri).connect()
  const db = client.db(DB.assist)
  const users = db.collection<UserDoc>(ASSIST_COLLECTIONS.users)
  await users.createIndex({ email: 1 }, { unique: true })
  return { users }
}

import 'server-only'
import { MongoClient, type Collection } from 'mongodb'
import { ASSIST_COLLECTIONS, DB, type Conversation, type Draft, type Message, type Role } from '@nexo/shared'
import { env } from './env'

export type UserDoc = {
  _id: string
  email: string
  name: string
  role: Role
  department: string
  team?: string
}

/** Documents use the domain id as `_id` (string), and are validated with the shared zod schemas on read. */
export type ConversationDoc = Omit<Conversation, 'id'> & { _id: string }
export type MessageDoc = Omit<Message, 'id'> & { _id: string }
export type DraftDoc = Omit<Draft, 'id'> & { _id: string }
export type CounterDoc = { _id: string; seq: number }
/** A fixed-window usage counter (rate limits, LLM caps). Dropped by a TTL index when the window ends. */
export type UsageDoc = { _id: string; count: number; expiresAt: Date }

export type AssistDb = {
  client: MongoClient
  users: Collection<UserDoc>
  conversations: Collection<ConversationDoc>
  messages: Collection<MessageDoc>
  drafts: Collection<DraftDoc>
  counters: Collection<CounterDoc>
  llmUsage: Collection<UsageDoc>
  rateLimits: Collection<UsageDoc>
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
  const c = ASSIST_COLLECTIONS
  const assist: AssistDb = {
    client,
    users: db.collection<UserDoc>(c.users),
    conversations: db.collection<ConversationDoc>(c.conversations),
    messages: db.collection<MessageDoc>(c.messages),
    drafts: db.collection<DraftDoc>(c.drafts),
    counters: db.collection<CounterDoc>(c.counters),
    llmUsage: db.collection<UsageDoc>(c.llmUsage),
    rateLimits: db.collection<UsageDoc>(c.rateLimits),
  }
  await Promise.all([
    assist.users.createIndex({ email: 1 }, { unique: true }),
    // Analyst console tabs (by state, mine) and the employee's latest conversation.
    assist.conversations.createIndex({ state: 1, assignedAnalystId: 1, lastMessageAt: -1 }),
    assist.conversations.createIndex({ employeeId: 1, lastMessageAt: -1 }),
    assist.messages.createIndex({ conversationId: 1, createdAt: 1 }),
    assist.drafts.createIndex({ conversationId: 1, status: 1 }),
    assist.llmUsage.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    assist.rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ])
  return assist
}

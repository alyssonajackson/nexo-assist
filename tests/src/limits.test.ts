import { randomUUID } from 'node:crypto'
import type { MongoClient } from 'mongodb'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { counterId, DAY_MS, MINUTE_MS, type ChatStreamEvent, type Conversation } from '@nexo/shared'
import { env } from './env'
import { connectMongo } from './helpers/mongo'
import { postNdjson, session, type Session } from './helpers/web'

// The demo limits, against the running web app. Counters are pre-filled in MongoDB, so the tests
// do not depend on the configured caps and never call the LLM.

type ConversationDoc = Omit<Conversation, 'id'> & { _id: string }
type UsageDoc = { _id: string; count: number; expiresAt: Date }

let mongo: MongoClient
let ana: Session
const assist = () => mongo.db('assist')
const conversations = () => assist().collection<ConversationDoc>('conversations')
const llmUsage = () => assist().collection<UsageDoc>('llm_usage')
const rateLimits = () => assist().collection<UsageDoc>('rate_limits')

const inserted: { conversations: string[]; usage: string[]; rate: string[] } = {
  conversations: [],
  usage: [],
  rate: [],
}

/** Marks a counter as far over any limit, for this window and the next (a test may cross the edge). */
async function exhaust(which: 'usage' | 'rate', key: string, windowMs: number) {
  const now = Date.now()
  const ids = [counterId(key, windowMs, new Date(now)), counterId(key, windowMs, new Date(now + windowMs))]
  const collection = which === 'usage' ? llmUsage() : rateLimits()
  for (const _id of ids) {
    await collection.updateOne(
      { _id },
      { $set: { count: 1_000_000, expiresAt: new Date(now + 3 * windowMs) } },
      { upsert: true },
    )
  }
  inserted[which].push(...ids)
}

async function insertConversation(state: Conversation['state']): Promise<string> {
  const _id = `c-it-${randomUUID().slice(0, 8)}`
  const now = new Date()
  await conversations().insertOne({
    _id,
    employeeId: ana.userId,
    state,
    relatedTicketIds: [],
    employeeMessageCount: 0,
    lastMessageAt: now,
    preview: '',
    createdAt: now,
  })
  inserted.conversations.push(_id)
  return _id
}

const errorOf = (events: ChatStreamEvent[]) => events.find((e) => e.type === 'error')

beforeAll(async () => {
  mongo = await connectMongo()
  ana = await session('ana.souza@nexo.com.br')
})

afterEach(async () => {
  await llmUsage().deleteMany({ _id: { $in: inserted.usage } })
  await rateLimits().deleteMany({ _id: { $in: inserted.rate } })
  inserted.usage = []
  inserted.rate = []
})

afterAll(async () => {
  try {
    await assist()
      .collection('messages')
      .deleteMany({ conversationId: { $in: inserted.conversations } })
    await conversations().deleteMany({ _id: { $in: inserted.conversations } })
  } finally {
    await mongo.close()
  }
})

describe('LLM caps', () => {
  it("refuses the turn when the user's daily cap is used, before storing anything", async () => {
    await exhaust('usage', `tokens:user:${ana.userId}`, DAY_MS)
    const conversationId = await insertConversation('agent')

    const events = await postNdjson('/api/chat', ana.cookie, { conversationId, text: 'Minha VPN caiu' })
    expect(errorOf(events)).toMatchObject({ error: 'llm_user_daily_cap' })
    expect(errorOf(events)?.message).toContain('limite desta demonstração')
    expect(await assist().collection('messages').countDocuments({ conversationId })).toBe(0)
    expect((await conversations().findOne({ _id: conversationId }))?.employeeMessageCount).toBe(0)
  })

  it('refuses everyone when the global per-minute tokens are used, with a retry hint', async () => {
    await exhaust('usage', 'tokens:global', MINUTE_MS)
    const conversationId = await insertConversation('agent')

    const events = await postNdjson('/api/chat', ana.cookie, { conversationId, text: 'Minha VPN caiu' })
    expect(errorOf(events)).toMatchObject({ error: 'llm_busy' })
    expect(errorOf(events)?.message).toMatch(/Tente de novo em \d+ s/)
  })

  it('counts the model calls of a turn after it runs', async () => {
    const conversationId = await insertConversation('agent')
    const calls = async () =>
      (await llmUsage().findOne({ _id: counterId('calls:global', DAY_MS, new Date()) }))?.count ?? 0
    const before = await calls()

    const events = await postNdjson('/api/chat', ana.cookie, { conversationId, text: 'Oi' })
    expect(events.some((e) => e.type === 'message')).toBe(true)
    // At least one call: a turn that fails (e.g. no LLM key in CI) still counts as one.
    expect(await calls()).toBeGreaterThan(before)
  })

  it('still delivers messages to an analyst: a handoff never calls the LLM', async () => {
    await exhaust('usage', 'calls:global', DAY_MS)
    const conversationId = await insertConversation('waiting_analyst')

    const events = await postNdjson('/api/chat', ana.cookie, { conversationId, text: 'Ainda aguardo' })
    expect(errorOf(events)).toBeUndefined()
    expect(events.some((e) => e.type === 'employee_message')).toBe(true)
  })
})

describe('rate limiting', () => {
  it('answers 429 on /api/chat over the per-user limit', async () => {
    await exhaust('rate', `chat:user:${ana.userId}`, MINUTE_MS)
    const res = await fetch(`${env.WEB_URL}/api/chat`, {
      method: 'POST',
      headers: { cookie: ana.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'oi' }),
    })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: 'rate_limited' })
  })

  it('expires counters with a TTL index', async () => {
    for (const collection of [llmUsage(), rateLimits()]) {
      const indexes = await collection.indexes()
      expect(indexes.find((i) => i.key.expiresAt === 1)).toMatchObject({ expireAfterSeconds: 0 })
    }
  })
})

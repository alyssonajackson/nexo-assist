import { randomUUID } from 'node:crypto'
import type { MongoClient } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ConversationResponse,
  Draft,
  type ChatStreamEvent,
  type Conversation,
  type Message,
  type NewTicketInput,
  type Ticket,
} from '@nexo/shared'
import { env } from './env'
import { connectMongo } from './helpers/mongo'
import { postNdjson, session, waitUntil, type Session } from './helpers/web'

const fields: NewTicketInput = {
  type: 'INC',
  category: 'software',
  title: 'Teste de integração do chat',
  description: 'Rascunho criado pela suíte de integração.',
  priority: 'low',
  affected: 'self',
}

type ConversationDoc = Omit<Conversation, 'id'> & { _id: string }
type MessageDoc = Omit<Message, 'id'> & { _id: string }
type DraftDoc = Omit<Draft, 'id'> & { _id: string }
type TicketDoc = Omit<Ticket, 'id'> & { _id: string; idempotencyKey?: string }

let mongo: MongoClient
let ana: Session
let bruno: Session

const assist = () => mongo.db('assist')
const conversations = () => assist().collection<ConversationDoc>('conversations')
const messages = () => assist().collection<MessageDoc>('messages')
const drafts = () => assist().collection<DraftDoc>('drafts')
const tickets = () => mongo.db('tickets').collection<TicketDoc>('tickets')

const insertedConversations: string[] = []
const insertedDrafts: string[] = []

async function insertConversation(overrides: Partial<ConversationDoc> = {}): Promise<string> {
  const _id = `c-it-${randomUUID().slice(0, 8)}`
  const now = new Date()
  await conversations().insertOne({
    _id,
    employeeId: ana.userId,
    state: 'agent',
    relatedTicketIds: [],
    employeeMessageCount: 0,
    lastMessageAt: now,
    preview: '',
    createdAt: now,
    ...overrides,
  })
  insertedConversations.push(_id)
  return _id
}

async function insertDraft(conversationId: string): Promise<string> {
  const _id = `D-it-${randomUUID().slice(0, 8)}`
  await drafts().insertOne({
    _id,
    conversationId,
    employeeId: ana.userId,
    kind: 'create',
    fields,
    status: 'pending',
    createdAt: new Date(),
  })
  insertedDrafts.push(_id)
  return _id
}

const errorOf = (events: ChatStreamEvent[]) => events.find((e) => e.type === 'error')
const draftEvents = (events: ChatStreamEvent[]) =>
  events.flatMap((e) => (e.type === 'draft' ? [e.draft] : []))

beforeAll(async () => {
  mongo = await connectMongo()
  ;[ana, bruno] = await Promise.all([session('ana.souza@nexo.com.br'), session('bruno.tavares@nexo.com.br')])
})

// Tickets created by the confirm test stay in tickets.tickets (harmless; the seed reset drops them).
afterAll(async () => {
  try {
    await drafts().deleteMany({ _id: { $in: insertedDrafts } })
    await messages().deleteMany({ conversationId: { $in: insertedConversations } })
    await conversations().deleteMany({ _id: { $in: insertedConversations } })
  } finally {
    await mongo.close()
  }
})

describe('draft confirmation is a real state', () => {
  it('commits a pending draft once and refuses a second confirm', async () => {
    const conversationId = await insertConversation()
    const draftId = await insertDraft(conversationId)

    const first = await postNdjson(`/api/drafts/${draftId}/confirm`, ana.cookie)
    expect(errorOf(first)).toBeUndefined()
    // The service simulates random outages: then the write is queued (pending_registration) and the
    // consumers finish it shortly after. Either way the draft ends up committed, exactly once.
    expect(draftEvents(first).at(-1)?.status).toMatch(/^(committed|pending_registration)$/)
    expect(first.at(-1)?.type).toBe('conversation')
    const committed = await waitUntil(async () => {
      const d = await drafts().findOne({ _id: draftId })
      return d?.status === 'committed' ? d : undefined
    }, 40_000)
    expect(committed.resultTicketId).toMatch(/^(INC|REQ)-\d{5}$/)

    const ticket = await tickets().findOne({ idempotencyKey: draftId })
    expect(ticket?._id).toBe(committed.resultTicketId)
    expect(ticket?.requesterId).toBe(ana.userId)

    const second = await postNdjson(`/api/drafts/${draftId}/confirm`, ana.cookie)
    expect(errorOf(second)).toMatchObject({ error: 'not_pending' })
    expect(await tickets().countDocuments({ idempotencyKey: draftId })).toBe(1)
  })

  it("does not let another employee confirm Ana's draft", async () => {
    const draftId = await insertDraft(await insertConversation())
    const events = await postNdjson(`/api/drafts/${draftId}/confirm`, bruno.cookie)
    expect(errorOf(events)).toMatchObject({ error: 'not_found' })
    expect(await tickets().countDocuments({ idempotencyKey: draftId })).toBe(0)
    expect((await drafts().findOne({ _id: draftId }))?.status).toBe('pending')
  })

  it('cancels a pending draft, which can no longer be confirmed', async () => {
    const draftId = await insertDraft(await insertConversation())
    const res = await fetch(`${env.WEB_URL}/api/drafts/${draftId}/cancel`, {
      method: 'POST',
      headers: { cookie: ana.cookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { draft: unknown }
    expect(Draft.parse(body.draft).status).toBe('cancelled')

    const events = await postNdjson(`/api/drafts/${draftId}/confirm`, ana.cookie)
    expect(errorOf(events)).toMatchObject({ error: 'not_pending' })
    expect(await tickets().countDocuments({ idempotencyKey: draftId })).toBe(0)
  })
})

describe('conversation rules enforced by code (no LLM call)', () => {
  it('keeps the agent silent while the conversation waits for an analyst', async () => {
    const conversationId = await insertConversation({ state: 'waiting_analyst' })
    const text = `Alguém pode me ajudar? ${randomUUID().slice(0, 8)}`

    const events = await postNdjson('/api/chat', ana.cookie, { conversationId, text })
    expect(errorOf(events)).toBeUndefined()
    expect(events.some((e) => e.type === 'employee_message' && e.message.text === text)).toBe(true)
    expect(events.some((e) => e.type === 'message' && e.message.role === 'agent')).toBe(false)
    const last = events.at(-1)
    expect(last?.type === 'conversation' && last.conversation.state).toBe('waiting_analyst')

    const stored = await messages().find({ conversationId }).toArray()
    expect(stored.map((m) => [m.role, m.text])).toEqual([['employee', text]])
  })

  it('refuses the 31st employee message', async () => {
    const conversationId = await insertConversation({ employeeMessageCount: 30 })

    const events = await postNdjson('/api/chat', ana.cookie, { conversationId, text: 'mais uma mensagem' })
    expect(errorOf(events)).toMatchObject({ error: 'message_limit' })
    expect(await messages().countDocuments({ conversationId })).toBe(0)
    expect((await conversations().findOne({ _id: conversationId }))?.employeeMessageCount).toBe(30)
  })

  it("answers 404 when another employee reads Ana's conversation", async () => {
    const conversationId = await insertConversation()
    const asBruno = await fetch(`${env.WEB_URL}/api/conversations/${conversationId}`, {
      headers: { cookie: bruno.cookie },
    })
    expect(asBruno.status).toBe(404)

    const asAna = await fetch(`${env.WEB_URL}/api/conversations/${conversationId}`, {
      headers: { cookie: ana.cookie },
    })
    expect(asAna.status).toBe(200)
    expect(ConversationResponse.parse(await asAna.json()).conversation.id).toBe(conversationId)
  })
})

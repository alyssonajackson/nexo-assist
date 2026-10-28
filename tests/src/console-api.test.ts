import { randomUUID } from 'node:crypto'
import type { MongoClient } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ConsoleConversationResponse,
  ConsoleListResponse,
  ConversationResponse,
  type Conversation,
  type Message,
  type Ticket,
} from '@nexo/shared'
import { env } from './env'
import { connectMongo } from './helpers/mongo'
import { session, waitUntil, type Session } from './helpers/web'

type ConversationDoc = Omit<Conversation, 'id'> & { _id: string }
type MessageDoc = Omit<Message, 'id'> & { _id: string }
type TicketDoc = Omit<Ticket, 'id'> & { _id: string }

let mongo: MongoClient
let ana: Session
let rafael: Session
let anaTicketId: string

const conversations = () => mongo.db('assist').collection<ConversationDoc>('conversations')
const messages = () => mongo.db('assist').collection<MessageDoc>('messages')
const tickets = () => mongo.db('tickets').collection<TicketDoc>('tickets')

const created: string[] = []

/** A conversation of Ana's that the agent handed over, tied to one of her real tickets. */
async function insertWaiting(): Promise<string> {
  const _id = `c-console-${randomUUID().slice(0, 8)}`
  const now = new Date()
  await conversations().insertOne({
    _id,
    employeeId: ana.userId,
    state: 'waiting_analyst',
    transfer: {
      reason: 'employee_request',
      summary: 'Resumo de teste da transferência.',
      at: now,
      by: 'agent',
      ticketId: anaTicketId,
    },
    relatedTicketIds: [anaTicketId],
    employeeMessageCount: 1,
    lastMessageAt: now,
    preview: 'Quero falar com um analista',
    createdAt: now,
  })
  created.push(_id)
  return _id
}

const call = (path: string, as: Session | undefined, init: RequestInit = {}) =>
  fetch(`${env.WEB_URL}/api/console${path}`, {
    ...init,
    headers: { ...(as ? { cookie: as.cookie } : {}), 'content-type': 'application/json', ...init.headers },
  })
const post = (path: string, as: Session | undefined, body?: unknown) =>
  call(path, as, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const reply = (id: string, as: Session | undefined, text: string) =>
  post(`/conversations/${id}/messages`, as, { text })
const stateOf = async (id: string) => (await conversations().findOne({ _id: id }))?.state

beforeAll(async () => {
  mongo = await connectMongo()
  ;[ana, rafael] = await Promise.all([session('ana.souza@nexo.com.br'), session('rafael.lima@nexo.com.br')])
  const ticket = await tickets().findOne({ requesterId: ana.userId })
  if (!ticket) throw new Error('seed has no ticket for Ana')
  anaTicketId = ticket._id
})

afterAll(async () => {
  try {
    await messages().deleteMany({ conversationId: { $in: created } })
    await conversations().deleteMany({ _id: { $in: created } })
  } finally {
    await mongo.close()
  }
})

describe('console API access', () => {
  it('answers 401 without a session and 403 to an employee, on every route', async () => {
    const id = await insertWaiting()
    const routes: ((as: Session | undefined) => Promise<Response>)[] = [
      (as) => call('/conversations', as),
      (as) => call(`/conversations/${id}`, as),
      (as) => post(`/conversations/${id}/take-over`, as),
      (as) => post(`/conversations/${id}/give-back`, as),
      (as) => post(`/conversations/${id}/close`, as),
      (as) => reply(id, as, 'oi'),
    ]
    for (const run of routes) {
      expect((await run(undefined)).status).toBe(401)
      expect((await run(ana)).status).toBe(403)
    }
    expect(await stateOf(id)).toBe('waiting_analyst')
    expect(await messages().countDocuments({ conversationId: id })).toBe(0)
  })

  it('lists with counts and filters, and shows the employee tickets with the analyst token', async () => {
    const id = await insertWaiting()
    const list = ConsoleListResponse.parse(await (await call('/conversations?filter=waiting', rafael)).json())
    expect(list.items.every((i) => i.conversation.state === 'waiting_analyst')).toBe(true)
    expect(list.items.some((i) => i.conversation.id === id)).toBe(true)
    expect(list.counts.waiting).toBe(list.items.length)
    expect(list.counts.all).toBeGreaterThanOrEqual(list.counts.waiting)

    const found = ConsoleListResponse.parse(
      await (await call(`/conversations?filter=all&q=${anaTicketId}`, rafael)).json(),
    )
    expect(found.items.some((i) => i.conversation.id === id)).toBe(true)

    const detail = ConsoleConversationResponse.parse(
      await (await call(`/conversations/${id}`, rafael)).json(),
    )
    expect(detail.currentTicketId).toBe(anaTicketId)
    expect(detail.waitingUntil).toBeInstanceOf(Date)
    expect(detail.conversation.transfer?.summary).toContain('Resumo de teste')
    expect(detail.tickets.length).toBeGreaterThan(0)
    expect(detail.tickets.every((t) => t.requesterId === ana.userId)).toBe(true)
  })
})

describe('handoff transitions', () => {
  it('lets exactly one of two simultaneous take overs win', async () => {
    const id = await insertWaiting()
    const results = await Promise.all([
      post(`/conversations/${id}/take-over`, rafael),
      post(`/conversations/${id}/take-over`, rafael),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const doc = await conversations().findOne({ _id: id })
    expect(doc).toMatchObject({ state: 'analyst', assignedAnalystId: rafael.userId })
    // One divider only: the loser changed nothing.
    const dividers = await messages().find({ conversationId: id, role: 'system' }).toArray()
    expect(dividers.filter((m) => m.text.includes('assumiu'))).toHaveLength(1)
  })

  it('refuses a reply that is not assigned to the analyst, accepts it after take over', async () => {
    const id = await insertWaiting()
    expect((await reply(id, rafael, 'Oi, aqui é o Rafael')).status).toBe(409)
    expect(await messages().countDocuments({ conversationId: id, role: 'analyst' })).toBe(0)

    // Assigned to someone else: also refused.
    await conversations().updateOne(
      { _id: id },
      { $set: { state: 'analyst', assignedAnalystId: 'someone-else' } },
    )
    expect((await reply(id, rafael, 'Oi')).status).toBe(409)

    await conversations().updateOne(
      { _id: id },
      { $set: { state: 'analyst', assignedAnalystId: rafael.userId } },
    )
    expect((await reply(id, rafael, 'Oi, Ana! Aqui é o Rafael.')).status).toBe(201)

    // Ana sees it, with the analyst's name and team.
    const view = ConversationResponse.parse(
      await (
        await fetch(`${env.WEB_URL}/api/conversations/${id}`, { headers: { cookie: ana.cookie } })
      ).json(),
    )
    const message = view.messages.find((m) => m.role === 'analyst')
    expect(message?.text).toBe('Oi, Ana! Aqui é o Rafael.')
    expect(view.authors?.[rafael.userId]?.name).toBe('Rafael Lima')
  })

  it('walks waiting -> analyst -> agent -> closed, one guarded step at a time', async () => {
    const id = await insertWaiting()
    expect((await post(`/conversations/${id}/take-over`, rafael)).status).toBe(200)

    expect((await post(`/conversations/${id}/give-back`, rafael)).status).toBe(200)
    expect(await conversations().findOne({ _id: id })).toMatchObject({ state: 'agent' })
    expect((await conversations().findOne({ _id: id }))?.assignedAnalystId).toBeUndefined()
    // Back with the agent: nothing left to give back or close, and no analyst reply.
    expect((await post(`/conversations/${id}/give-back`, rafael)).status).toBe(409)
    expect((await post(`/conversations/${id}/close`, rafael)).status).toBe(409)
    expect((await reply(id, rafael, 'ainda aqui?')).status).toBe(409)

    await conversations().updateOne({ _id: id }, { $set: { state: 'waiting_analyst' } })
    expect((await post(`/conversations/${id}/close`, rafael)).status).toBe(200)
    expect(await stateOf(id)).toBe('closed')
    expect((await post(`/conversations/${id}/take-over`, rafael)).status).toBe(409)
  })

  it("records the handoff on the ticket's timeline through the handoff-events queue", async () => {
    const id = await insertWaiting()
    expect((await post(`/conversations/${id}/take-over`, rafael)).status).toBe(200)
    const entry = await waitUntil(async () => {
      const ticket = await tickets().findOne({ _id: anaTicketId })
      return ticket?.timeline.find((t) => t.kind === 'assumed' && t.by === rafael.userId)
    })
    expect(entry.note).toBe('Assumido por Rafael Lima')
  })
})

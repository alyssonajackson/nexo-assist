import { randomUUID } from 'node:crypto'
import type { MongoClient } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import type { Draft, NewTicketInput, Ticket, TicketWriteMessage } from '@nexo/shared'
import { env } from './env'
import { connectMongo } from './helpers/mongo'
import { queueUrl, sqs } from './helpers/sqs'
import {
  session,
  ticketsFetch,
  ticketsFetchRaw,
  waitForNoOutage,
  waitUntil,
  type Session,
} from './helpers/web'

const input: NewTicketInput = {
  type: 'INC',
  category: 'software',
  title: 'Teste de integração do serviço de chamados',
  description: 'Chamado criado pela suíte de integração.',
  priority: 'low',
  affected: 'self',
}

type TicketDoc = Omit<Ticket, 'id'> & { _id: string; idempotencyKey?: string }
type DraftDoc = Omit<Draft, 'id'> & { _id: string }

let mongo: MongoClient
let ana: Session
let bruno: Session
let rafael: Session

const tickets = () => mongo.db('tickets').collection<TicketDoc>('tickets')
const drafts = () => mongo.db('assist').collection<DraftDoc>('drafts')
const messages = () => mongo.db('assist').collection<{ conversationId: string; text: string }>('messages')

beforeAll(async () => {
  mongo = await connectMongo()
  ;[ana, bruno, rafael] = await Promise.all([
    session('ana.souza@nexo.com.br'),
    session('bruno.tavares@nexo.com.br'),
    session('rafael.lima@nexo.com.br'),
  ])
})

afterAll(async () => {
  try {
    await waitForNoOutage()
  } finally {
    await mongo.close()
  }
})

const listIds = async (s: Session, query = '') => {
  const res = await ticketsFetch(`/tickets${query}`, s.accessToken)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { tickets: Ticket[] }
  return body.tickets
}

describe('privacy (enforced inside the tickets service)', () => {
  it("answers 404 when an employee asks for someone else's ticket", async () => {
    const res = await ticketsFetch('/tickets/INC-20365', ana.accessToken)
    expect(res.status).toBe(404)
    // The owner still sees it, so the 404 is about ownership and not a missing ticket.
    expect((await ticketsFetch('/tickets/INC-20365', bruno.accessToken)).status).toBe(200)
  })

  it('ignores ?requesterId for employees', async () => {
    const mine = await listIds(ana, `?requesterId=${bruno.userId}`)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((t) => t.requesterId === ana.userId)).toBe(true)
    expect(mine.map((t) => t.id)).not.toContain('INC-20365')
  })

  it("lets an analyst list another employee's tickets with ?requesterId", async () => {
    const theirs = await listIds(rafael, `?requesterId=${bruno.userId}`)
    expect(theirs.map((t) => t.id)).toContain('INC-20365')
    expect(theirs.every((t) => t.requesterId === bruno.userId)).toBe(true)
  })
})

describe('idempotent writes', () => {
  it('replays the same ticket for the same Idempotency-Key', async () => {
    const key = `it-${randomUUID()}`
    const post = () =>
      ticketsFetch('/tickets', ana.accessToken, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: JSON.stringify({ ...input, requesterName: 'Ana Souza' }),
      })
    const first = await post()
    const second = await post()
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    const a = (await first.json()) as { ticket: Ticket; replayed: boolean }
    const b = (await second.json()) as { ticket: Ticket; replayed: boolean }
    expect(a.replayed).toBe(false)
    expect(b.replayed).toBe(true)
    expect(b.ticket.id).toBe(a.ticket.id)
    expect(a.ticket.requesterId).toBe(ana.userId)
    expect(await tickets().countDocuments({ idempotencyKey: key })).toBe(1)
  })
})

describe('outage -> queue -> consumer', () => {
  const draftId = `D-it-${randomUUID().slice(0, 8)}`
  const conversationId = `c-it-${randomUUID().slice(0, 8)}`

  afterAll(async () => {
    await drafts().deleteMany({ _id: draftId })
    await messages().deleteMany({ conversationId })
  })

  it('answers 503 during an outage, then a queued write is applied once it ends', async () => {
    const chaos = await fetch(`${env.TICKETS_URL}/_chaos/outage?ms=8000`, { method: 'POST' })
    expect(chaos.status).toBe(200)
    expect((await ticketsFetchRaw('/tickets', ana.accessToken)).status).toBe(503)

    // The web side would have stored the draft as pending_registration before enqueueing.
    await drafts().insertOne({
      _id: draftId,
      conversationId,
      employeeId: ana.userId,
      kind: 'create',
      fields: input,
      status: 'pending_registration',
      createdAt: new Date(),
      confirmedAt: new Date(),
    })

    const message: TicketWriteMessage = {
      op: 'create',
      input,
      idempotencyKey: draftId,
      draftId,
      conversationId,
      actor: { userId: ana.userId, role: 'employee', name: 'Ana Souza' },
      enqueuedAt: new Date(),
    }
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: await queueUrl('ticket-writes'),
        MessageBody: JSON.stringify(message),
      }),
    )

    // Consumer (tickets) creates the ticket, then the web consumer finishes the draft.
    const ticket = await waitUntil(() => tickets().findOne({ idempotencyKey: draftId }), 40_000)
    expect(ticket.requesterId).toBe(ana.userId)

    const committed = await waitUntil(async () => {
      const d = await drafts().findOne({ _id: draftId })
      return d?.status === 'committed' ? d : undefined
    }, 40_000)
    expect(committed.resultTicketId).toBe(ticket._id)

    const note = await waitUntil(
      () => messages().findOne({ conversationId, text: `Chamado ${ticket._id} registrado` }),
      10_000,
    )
    expect(note).toBeTruthy()
    expect(await tickets().countDocuments({ idempotencyKey: draftId })).toBe(1)

    await waitForNoOutage()
  })
})

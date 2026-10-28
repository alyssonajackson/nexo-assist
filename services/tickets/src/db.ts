import { MongoClient, type Collection, type Db } from 'mongodb'
import { DB, TICKETS_COLLECTIONS, type KbArticle, type Ticket } from '@nexo/shared'

/** Stored shapes: the domain id becomes `_id`. */
export type TicketDoc = Omit<Ticket, 'id'> & { _id: string; idempotencyKey?: string }
export type KbArticleDoc = Omit<KbArticle, 'id'> & { _id: string }
export type CounterDoc = { _id: string; seq: number }

export type TicketsDb = {
  tickets: Collection<TicketDoc>
  kb: Collection<KbArticleDoc>
  counters: Collection<CounterDoc>
}

export async function connectTicketsDb(uri: string): Promise<{ client: MongoClient; db: TicketsDb }> {
  const client = new MongoClient(uri)
  await client.connect()
  const db = collections(client.db(DB.tickets))
  await ensureIndexes(db)
  return { client, db }
}

export const collections = (db: Db): TicketsDb => ({
  tickets: db.collection<TicketDoc>(TICKETS_COLLECTIONS.tickets),
  kb: db.collection<KbArticleDoc>(TICKETS_COLLECTIONS.kbArticles),
  counters: db.collection<CounterDoc>(TICKETS_COLLECTIONS.counters),
})

/** Idempotent; runs at every start. This service is the only owner of the `tickets` database. */
export async function ensureIndexes(db: TicketsDb): Promise<void> {
  await db.tickets.createIndexes([
    // "my tickets", optionally by status
    { key: { requesterId: 1, status: 1 } },
    // recent activity
    { key: { updatedAt: -1 } },
    // similar-problem search (duplicates) and free-text lookup, with Portuguese stemming
    {
      key: { title: 'text', description: 'text' },
      weights: { title: 3, description: 1 },
      default_language: 'portuguese',
      name: 'tickets_text',
    },
    // one ticket per idempotency key (retries and replayed queue messages never duplicate)
    {
      key: { idempotencyKey: 1 },
      unique: true,
      partialFilterExpression: { idempotencyKey: { $exists: true } },
    },
  ])
  await db.kb.createIndex(
    { title: 'text', body: 'text', tags: 'text' },
    { weights: { title: 3, tags: 2, body: 1 }, default_language: 'portuguese', name: 'kb_text' },
  )
}

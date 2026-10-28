import { ObjectId, type Db } from 'mongodb'

// Our documents use string ids (the domain id), not ObjectId.
type Doc = { _id: string; [field: string]: unknown }
const col = (db: Db, name: string) => db.collection<Doc>(name)
import { ASSIST_COLLECTIONS, TICKETS_COLLECTIONS } from '@nexo/shared'
import { conversations, kbArticles, tickets, users } from './data'
import type { Ago, UserKey } from './types'

export type UserIds = Record<UserKey, string>

const MINUTE = 60_000
export const agoToDate = (now: Date, ago: Ago): Date =>
  new Date(now.getTime() - ((ago.days ?? 0) * 1440 + (ago.hours ?? 0) * 60 + (ago.minutes ?? 0)) * MINUTE)

const highestNumber = (prefix: 'INC' | 'REQ') =>
  Math.max(0, ...tickets.filter((t) => t.type === prefix).map((t) => Number(t.id.slice(4))))

/** Wipes and seeds the `tickets` database (tickets, KB, id counters). */
export async function seedTicketsDb(db: Db, ids: UserIds, now: Date) {
  const nameOf = (key: UserKey) => users.find((u) => u.key === key)?.name ?? key
  const byOf = (by: UserKey | 'support') => (by === 'support' ? 'support' : ids[by])

  await col(db, TICKETS_COLLECTIONS.tickets).deleteMany({})
  await col(db, TICKETS_COLLECTIONS.kbArticles).deleteMany({})
  await col(db, TICKETS_COLLECTIONS.counters).deleteMany({})

  await col(db, TICKETS_COLLECTIONS.tickets).insertMany(
    tickets.map((t) => {
      const timeline = t.timeline.map((e, i) => ({
        key: `seed-${t.id}-${i}`,
        kind: e.kind,
        at: agoToDate(now, e.ago),
        by: byOf(e.by),
        ...(e.note ? { note: e.note } : {}),
      }))
      const lastAt = timeline.reduce((max, e) => (e.at > max ? e.at : max), agoToDate(now, t.createdAgo))
      return {
        _id: t.id,
        type: t.type,
        category: t.category,
        ...(t.subcategory ? { subcategory: t.subcategory } : {}),
        title: t.title,
        description: t.description,
        priority: t.priority,
        affected: t.affected,
        status: t.status,
        requesterId: ids[t.requester],
        requesterName: nameOf(t.requester),
        createdAt: agoToDate(now, t.createdAgo),
        updatedAt: lastAt,
        ...(t.lastSupportUpdateAgo ? { lastSupportUpdateAt: agoToDate(now, t.lastSupportUpdateAgo) } : {}),
        ...(t.resolvedAgo ? { resolvedAt: agoToDate(now, t.resolvedAgo) } : {}),
        timeline,
      }
    }),
  )

  await col(db, TICKETS_COLLECTIONS.kbArticles).insertMany(
    kbArticles.map(({ id, ...rest }) => ({ _id: id, ...rest })),
  )

  // New tickets continue after the highest seeded number.
  await col(db, TICKETS_COLLECTIONS.counters).insertMany([
    { _id: 'INC', seq: Math.max(20_500, highestNumber('INC')) },
    { _id: 'REQ', seq: Math.max(10_500, highestNumber('REQ')) },
  ])

  console.log(`seed: tickets db -> ${tickets.length} tickets, ${kbArticles.length} KB articles`)
}

/** Upserts user profiles (always) and wipes + seeds demo conversations in the `assist` database. */
export async function seedAssistDb(db: Db, ids: UserIds, now: Date) {
  for (const u of users) {
    await col(db, ASSIST_COLLECTIONS.users).updateOne(
      { _id: ids[u.key] },
      {
        $set: {
          email: u.email,
          name: u.name,
          role: u.role,
          department: u.department,
          ...(u.team ? { team: u.team } : {}),
        },
      },
      { upsert: true },
    )
  }

  await col(db, ASSIST_COLLECTIONS.conversations).deleteMany({})
  await col(db, ASSIST_COLLECTIONS.messages).deleteMany({})
  await col(db, ASSIST_COLLECTIONS.drafts).deleteMany({})
  await col(db, ASSIST_COLLECTIONS.counters).deleteMany({})

  for (const c of conversations) {
    const conversationId = new ObjectId().toHexString()
    const messages = c.messages.map((m) => ({
      _id: new ObjectId().toHexString(),
      conversationId,
      role: m.role,
      ...(m.author ? { authorId: ids[m.author] } : {}),
      text: m.text,
      parts: m.parts ?? [],
      ...(m.decision ? { decision: m.decision } : {}),
      createdAt: agoToDate(now, m.ago),
    }))
    const last = messages.at(-1)
    const firstAt = messages[0]?.createdAt ?? now
    await col(db, ASSIST_COLLECTIONS.conversations).insertOne({
      _id: conversationId,
      employeeId: ids[c.employee],
      state: c.state,
      ...(c.assignedAnalyst ? { assignedAnalystId: ids[c.assignedAnalyst] } : {}),
      ...(c.transfer
        ? {
            transfer: {
              reason: c.transfer.reason,
              summary: c.transfer.summary,
              by: c.transfer.by,
              ...(c.transfer.ticketId ? { ticketId: c.transfer.ticketId } : {}),
              at: agoToDate(now, c.transfer.ago),
            },
          }
        : {}),
      relatedTicketIds: c.relatedTicketIds,
      employeeMessageCount: c.messages.filter((m) => m.role === 'employee').length,
      lastMessageAt: last?.createdAt ?? now,
      preview: last?.text.slice(0, 140) ?? '',
      createdAt: firstAt,
    })
    if (messages.length) await col(db, ASSIST_COLLECTIONS.messages).insertMany(messages)
  }

  // Draft numbers start at D-381 like the prototype; purely cosmetic.
  await col(db, ASSIST_COLLECTIONS.counters).insertOne({ _id: 'draft', seq: 380 })

  console.log(`seed: assist db -> ${users.length} users, ${conversations.length} conversations`)
}

export const seedUsers = users

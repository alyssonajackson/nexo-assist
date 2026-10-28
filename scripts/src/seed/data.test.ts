import { describe, expect, it } from 'vitest'
import { TicketId, slaStatus } from '@nexo/shared'
import { conversations, kbArticles, tickets, users } from './data'
import { agoToDate } from './seed'
import type { Ago, SeedTicket } from './types'

// A fixed reference point: "ago" values are compared as dates relative to it.
const REF = new Date('2026-10-28T12:00:00-03:00')
const at = (ago: Ago) => agoToDate(REF, ago).getTime()

const ticket = (id: string): SeedTicket => {
  const t = tickets.find((x) => x.id === id)
  if (!t) throw new Error(`seed ticket ${id} not found`)
  return t
}

/** The fields slaStatus needs, as seedTicketsDb would store them for a given "now". */
const slaInput = (t: SeedTicket, now: Date) => ({
  status: t.status,
  priority: t.priority,
  createdAt: agoToDate(now, t.createdAgo),
  ...(t.lastSupportUpdateAgo ? { lastSupportUpdateAt: agoToDate(now, t.lastSupportUpdateAgo) } : {}),
  ...(t.resolvedAgo ? { resolvedAt: agoToDate(now, t.resolvedAgo) } : {}),
})

describe('seed data structure', () => {
  const userKeys = new Set(users.map((u) => u.key))

  it('has unique ticket and KB ids', () => {
    expect(new Set(tickets.map((t) => t.id)).size).toBe(tickets.length)
    expect(new Set(kbArticles.map((a) => a.id)).size).toBe(kbArticles.length)
  })

  it('uses INC-#####/REQ-##### ids that match the ticket type', () => {
    for (const t of tickets) {
      expect(TicketId.safeParse(t.id).success, t.id).toBe(true)
      expect(t.id.startsWith(`${t.type}-`), t.id).toBe(true)
    }
  })

  it('has exactly one analyst', () => {
    expect(users.filter((u) => u.role === 'analyst')).toHaveLength(1)
  })

  it.each(tickets.map((t) => [t.id, t] as const))('%s has a consistent timeline', (_id, t) => {
    const times = t.timeline.map((e) => at(e.ago))
    expect(times, 'entries in chronological order').toEqual([...times].sort((a, b) => a - b))
    for (const time of times) expect(time).toBeGreaterThanOrEqual(at(t.createdAgo))

    const supportTimes = t.timeline
      .filter((e) => e.kind === 'support_update' || e.kind === 'resolved')
      .map((e) => at(e.ago))
    if (supportTimes.length) {
      expect(t.lastSupportUpdateAgo, 'lastSupportUpdateAgo set').toBeDefined()
      expect(at(t.lastSupportUpdateAgo ?? {})).toBe(Math.max(...supportTimes))
    } else {
      expect(t.lastSupportUpdateAgo).toBeUndefined()
    }

    const isDone = t.status === 'resolved' || t.status === 'closed'
    expect(t.resolvedAgo !== undefined, 'resolvedAgo iff resolved/closed').toBe(isDone)
  })

  it('references only seeded users', () => {
    for (const t of tickets) {
      expect(userKeys.has(t.requester), t.id).toBe(true)
      for (const e of t.timeline) expect(e.by === 'support' || userKeys.has(e.by), t.id).toBe(true)
    }
    for (const c of conversations) {
      expect(userKeys.has(c.employee)).toBe(true)
      if (c.assignedAnalyst) expect(userKeys.has(c.assignedAnalyst)).toBe(true)
      for (const m of c.messages) if (m.author) expect(userKeys.has(m.author)).toBe(true)
    }
  })

  it('has conversations with ordered messages and existing related tickets', () => {
    const ticketIds = new Set(tickets.map((t) => t.id))
    for (const c of conversations) {
      const times = c.messages.map((m) => at(m.ago))
      expect(times).toEqual([...times].sort((a, b) => a - b))
      for (const id of c.relatedTicketIds) expect(ticketIds.has(id), id).toBe(true)
      if (c.transfer?.ticketId) expect(ticketIds.has(c.transfer.ticketId)).toBe(true)
    }
  })
})

describe('seed states hold whatever time the app starts', () => {
  // Every hour across two weeks, weekends included, starting on a Monday at 0h in São Paulo.
  const start = new Date('2026-10-26T00:00:00-03:00').getTime()
  const nows = Array.from({ length: 14 * 24 }, (_, h) => new Date(start + h * 3_600_000))

  it('covers at least 336 starting times', () => {
    expect(nows.length).toBeGreaterThanOrEqual(336)
  })

  const expectations: { id: string; field: 'overdue' | 'reopenable'; value: boolean }[] = [
    { id: 'INC-20311', field: 'overdue', value: true },
    { id: 'INC-20150', field: 'reopenable', value: true },
    { id: 'REQ-10442', field: 'overdue', value: false },
    { id: 'INC-20298', field: 'overdue', value: false },
    { id: 'INC-19877', field: 'reopenable', value: false },
  ]

  it.each(expectations)('$id $field is $value', ({ id, field, value }) => {
    const t = ticket(id)
    const wrong = nows.filter((now) => slaStatus(slaInput(t, now), now)[field] !== value)
    expect(wrong.map((d) => d.toISOString())).toEqual([])
  })
})

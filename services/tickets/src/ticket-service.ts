import { MongoServerError, type Filter, type UpdateFilter } from 'mongodb'
import {
  isOpenStatus,
  OPEN_STATUSES,
  REOPEN_WINDOW_DAYS,
  slaStatus,
  Ticket,
  type Actor,
  type CreateTicketBody,
  type DuplicateCandidate,
  type HandoffEvent,
  type KbSearchResult,
  type TicketView,
  type TimelineEntry,
  type TimelineKind,
} from '@nexo/shared'
import type { TicketDoc, TicketsDb } from './db'

export class DomainError extends Error {
  override name = 'DomainError'
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const notFound = (id: string) => new DomainError(404, 'not_found', `Chamado ${id} não encontrado.`)
const DAY = 86_400_000

export type WriteResult = { ticket: TicketView; replayed: boolean }

/**
 * Ticket operations. Privacy is enforced here, on every query: an employee only ever matches
 * their own tickets (requesterId from the verified token). Another employee's ticket is reported
 * as "not found", so its existence is not leaked either.
 *
 * Writes are idempotent without transactions: a create is keyed by a unique idempotencyKey, and
 * every other write pushes a timeline entry guarded by `timeline.key != key` in the same
 * single-document update.
 */
export class TicketService {
  constructor(
    private readonly db: TicketsDb,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // --- reads --------------------------------------------------------------------------------

  async list(
    actor: Actor,
    query: { scope: 'open' | 'all'; q?: string | undefined; requesterId?: string | undefined },
  ): Promise<TicketView[]> {
    const filter: Filter<TicketDoc> = { ...this.visibleTo(actor) }
    if (actor.role === 'analyst' && query.requesterId) filter.requesterId = query.requesterId
    if (query.scope === 'open') filter.status = { $in: [...OPEN_STATUSES] }
    if (query.q) filter.$text = { $search: query.q }
    const docs = await this.db.tickets.find(filter).sort({ updatedAt: -1 }).limit(50).toArray()
    return docs.map((d) => this.toView(d))
  }

  async get(actor: Actor, id: string): Promise<TicketView> {
    const doc = await this.db.tickets.findOne({ _id: id, ...this.visibleTo(actor) })
    if (!doc) throw notFound(id)
    return this.toView(doc)
  }

  /**
   * Candidates for "same problem": the requester's open tickets, plus tickets resolved within the
   * reopen window. Code finds them; the agent decides whether one really is the same problem.
   */
  async duplicates(actor: Actor, text: string): Promise<DuplicateCandidate[]> {
    const reopenSince = new Date(this.now().getTime() - REOPEN_WINDOW_DAYS * DAY)
    const docs = await this.db.tickets
      .find(
        {
          requesterId: actor.userId,
          $or: [
            { status: { $in: [...OPEN_STATUSES] } },
            { status: 'resolved', resolvedAt: { $gte: reopenSince } },
          ],
          $text: { $search: text },
        },
        { projection: { score: { $meta: 'textScore' } } },
      )
      .sort({ score: { $meta: 'textScore' } })
      .limit(3)
      .toArray()
    return docs.map((d) => {
      const { score, ...doc } = d as TicketDoc & { score: number }
      return { ticket: this.toView(doc), score: Math.round(score * 100) / 100 }
    })
  }

  async searchKb(q: string): Promise<KbSearchResult[]> {
    const docs = await this.db.kb
      .find({ $text: { $search: q } }, { projection: { score: { $meta: 'textScore' } } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(3)
      .toArray()
    return docs.map((d) => {
      const { _id, score, ...rest } = d as typeof d & { score: number }
      return { id: _id, ...rest, score: Math.round(score * 100) / 100 }
    })
  }

  // --- writes -------------------------------------------------------------------------------

  async create(actor: Actor, body: CreateTicketBody, key: string): Promise<WriteResult> {
    const existing = await this.db.tickets.findOne({ idempotencyKey: key })
    if (existing) return this.replay(actor, existing)

    const now = this.now()
    const { requesterName, ...input } = body
    const id = await this.nextId(input.type)
    const doc: TicketDoc = {
      _id: id,
      ...input,
      status: 'open',
      requesterId: actor.userId,
      requesterName,
      createdAt: now,
      updatedAt: now,
      idempotencyKey: key,
      timeline: [{ key, kind: 'created', at: now, by: actor.userId }],
    }
    try {
      await this.db.tickets.insertOne(doc)
      return { ticket: this.toView(doc), replayed: false }
    } catch (err) {
      // Two deliveries of the same write raced; the other one won.
      if (err instanceof MongoServerError && err.code === 11000) {
        const winner = await this.db.tickets.findOne({ idempotencyKey: key })
        if (winner) return this.replay(actor, winner)
      }
      throw err
    }
  }

  /** Employee comment, or support update (restarts the SLA clock) when an analyst writes. */
  async addUpdate(actor: Actor, id: string, note: string, key: string): Promise<WriteResult> {
    const now = this.now()
    const fromSupport = actor.role === 'analyst'
    return this.appendEntry(actor, id, key, {
      kind: fromSupport ? 'support_update' : 'employee_update',
      note,
      set: fromSupport ? { lastSupportUpdateAt: now } : {},
      guard: { status: { $nin: ['closed'] } },
      onGuardFail: () => new DomainError(409, 'closed', `O chamado ${id} está encerrado.`),
    })
  }

  /** Annex A: a ticket resolved up to 7 days ago can be reopened. Checked atomically in the update filter. */
  async reopen(actor: Actor, id: string, reason: string, key: string): Promise<WriteResult> {
    const now = this.now()
    return this.appendEntry(actor, id, key, {
      kind: 'reopened',
      note: reason,
      set: { status: 'open', reopenedAt: now },
      unset: { resolvedAt: '' },
      guard: { status: 'resolved', resolvedAt: { $gte: new Date(now.getTime() - REOPEN_WINDOW_DAYS * DAY) } },
      onGuardFail: () =>
        new DomainError(
          409,
          'not_reopenable',
          `O chamado ${id} só pode ser reaberto até ${REOPEN_WINDOW_DAYS} dias depois de resolvido.`,
        ),
    })
  }

  async transfer(actor: Actor, id: string, summary: string, key: string): Promise<WriteResult> {
    return this.appendEntry(actor, id, key, {
      kind: 'transferred',
      note: summary,
      set: { status: 'awaiting_analyst' },
      guard: { status: { $in: [...OPEN_STATUSES] } },
      onGuardFail: () => new DomainError(409, 'not_open', `O chamado ${id} não está aberto.`),
    })
  }

  /** Records a conversation handoff on the related ticket (consumer of `handoff-events`). */
  async applyHandoff(event: HandoffEvent): Promise<void> {
    if (!event.ticketId) return
    const plan: Record<HandoffEvent['type'], { kind: TimelineKind; set: Partial<TicketDoc>; note: string }> =
      {
        transferred: {
          kind: 'transferred',
          set: { status: 'awaiting_analyst' },
          note: event.note ?? 'Transferido para um analista',
        },
        assumed: {
          kind: 'assumed',
          set: { status: 'in_progress', lastSupportUpdateAt: event.at },
          note: `Assumido por ${event.actor.name}`,
        },
        released: { kind: 'released', set: {}, note: 'Conversa devolvida ao agent' },
        closed: { kind: 'closed', set: {}, note: event.note ?? 'Atendimento encerrado' },
      }
    const step = plan[event.type]
    const doc = await this.db.tickets.findOne({ _id: event.ticketId })
    if (!doc) return
    // Status changes only apply to tickets still being worked on.
    const set = isOpenStatus(doc.status) ? step.set : {}
    await this.db.tickets.updateOne(
      { _id: event.ticketId, 'timeline.key': { $ne: event.eventId } },
      {
        $set: { ...set, updatedAt: event.at },
        $push: {
          timeline: {
            key: event.eventId,
            kind: step.kind,
            at: event.at,
            by: event.actor.userId,
            note: step.note,
          },
        },
      },
    )
  }

  // --- helpers ------------------------------------------------------------------------------

  private visibleTo(actor: Actor): Filter<TicketDoc> {
    return actor.role === 'analyst' ? {} : { requesterId: actor.userId }
  }

  private async nextId(type: 'INC' | 'REQ'): Promise<string> {
    const counter = await this.db.counters.findOneAndUpdate(
      { _id: type },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    )
    return `${type}-${String(counter?.seq ?? 1).padStart(5, '0')}`
  }

  private replay(actor: Actor, doc: TicketDoc): WriteResult {
    // An idempotency key belongs to whoever used it first.
    if (actor.role !== 'analyst' && doc.requesterId !== actor.userId) {
      throw new DomainError(409, 'idempotency_conflict', 'Idempotency-Key já usada.')
    }
    return { ticket: this.toView(doc), replayed: true }
  }

  private async appendEntry(
    actor: Actor,
    id: string,
    key: string,
    op: {
      kind: TimelineKind
      note: string
      set: Partial<TicketDoc>
      unset?: Record<string, ''>
      guard: Filter<TicketDoc>
      onGuardFail: () => DomainError
    },
  ): Promise<WriteResult> {
    const now = this.now()
    const entry: TimelineEntry = { key, kind: op.kind, at: now, by: actor.userId, note: op.note }
    const update: UpdateFilter<TicketDoc> = {
      $set: { ...op.set, updatedAt: now },
      $push: { timeline: entry },
      ...(op.unset ? { $unset: op.unset } : {}),
    }
    const updated = await this.db.tickets.findOneAndUpdate(
      { _id: id, ...this.visibleTo(actor), 'timeline.key': { $ne: key }, ...op.guard },
      update,
      { returnDocument: 'after' },
    )
    if (updated) return { ticket: this.toView(updated), replayed: false }

    // Nothing matched: missing / not visible, already applied (replay), or the guard failed.
    const current = await this.db.tickets.findOne({ _id: id, ...this.visibleTo(actor) })
    if (!current) throw notFound(id)
    if (current.timeline.some((e) => e.key === key)) return { ticket: this.toView(current), replayed: true }
    throw op.onGuardFail()
  }

  private toView(doc: TicketDoc): TicketView {
    const { _id, idempotencyKey: _key, ...rest } = doc
    const ticket = Ticket.parse({ id: _id, ...rest })
    return { ...ticket, sla: slaStatus(ticket, this.now()) }
  }
}

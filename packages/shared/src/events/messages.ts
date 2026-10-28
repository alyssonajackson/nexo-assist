import { z } from 'zod'
import { Role } from '../domain/conversation'
import { NewTicketInput, TicketId } from '../domain/ticket'

/**
 * Who performed an action, captured from the verified token when the message was produced.
 * The consumer runs later, without a live token, so it trusts this field. The queue is internal
 * (IAM-protected on AWS), never reachable by browsers.
 */
export const Actor = z.object({
  userId: z.string(),
  role: Role,
  name: z.string(),
})
export type Actor = z.infer<typeof Actor>

const deferredBase = {
  /** Draft id. Also the idempotency key, so a replayed message never creates a second ticket. */
  idempotencyKey: z.string(),
  draftId: z.string(),
  conversationId: z.string(),
  actor: Actor,
  enqueuedAt: z.coerce.date(),
}

/** Queue `ticket-writes` (web -> tickets): confirmed writes that failed while the ticket system was down. */
export const TicketWriteMessage = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), input: NewTicketInput, ...deferredBase }),
  z.object({ op: z.literal('update'), ticketId: TicketId, note: z.string(), ...deferredBase }),
  z.object({ op: z.literal('reopen'), ticketId: TicketId, reason: z.string(), ...deferredBase }),
])
export type TicketWriteMessage = z.infer<typeof TicketWriteMessage>

/** Queue `assist-events` (tickets -> web): outcome of a deferred write. */
export const AssistEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ticket.registered'),
    draftId: z.string(),
    conversationId: z.string(),
    ticketId: TicketId,
  }),
  z.object({
    type: z.literal('ticket.write_failed'),
    draftId: z.string(),
    conversationId: z.string(),
    reason: z.string(),
  }),
])
export type AssistEvent = z.infer<typeof AssistEvent>

/** Queue `handoff-events` (web -> tickets): conversation handoffs, recorded on the related ticket's timeline. */
export const HandoffEvent = z.object({
  eventId: z.string(),
  type: z.enum(['transferred', 'assumed', 'released', 'closed']),
  conversationId: z.string(),
  ticketId: TicketId.optional(),
  actor: Actor,
  note: z.string().optional(),
  at: z.coerce.date(),
})
export type HandoffEvent = z.infer<typeof HandoffEvent>

export const QUEUES = {
  ticketWrites: process.env.SQS_TICKET_WRITES_QUEUE ?? 'ticket-writes',
  assistEvents: process.env.SQS_ASSIST_EVENTS_QUEUE ?? 'assist-events',
  handoffEvents: process.env.SQS_HANDOFF_EVENTS_QUEUE ?? 'handoff-events',
} as const

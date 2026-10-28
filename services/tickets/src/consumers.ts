import type { AssistEvent, EventQueue, HandoffEvent, TicketWriteMessage } from '@nexo/shared'
import { DomainError, type TicketService } from './ticket-service'

/**
 * `ticket-writes`: confirmed writes that web could not apply while this service was down.
 * Applied with the same idempotent operations as the HTTP API (the draft id is the key), so a
 * message delivered twice still creates one ticket. Business rejections (e.g. reopen window
 * expired) are final and reported back; anything else throws, so SQS retries and finally
 * dead-letters the message.
 */
export function ticketWritesHandler(service: TicketService, assistEvents: EventQueue<AssistEvent>) {
  return async (msg: TicketWriteMessage): Promise<void> => {
    const base = { draftId: msg.draftId, conversationId: msg.conversationId }
    try {
      const { ticket } =
        msg.op === 'create'
          ? await service.create(
              msg.actor,
              { ...msg.input, requesterName: msg.actor.name },
              msg.idempotencyKey,
            )
          : msg.op === 'update'
            ? await service.addUpdate(msg.actor, msg.ticketId, msg.note, msg.idempotencyKey)
            : await service.reopen(msg.actor, msg.ticketId, msg.reason, msg.idempotencyKey)
      await assistEvents.send({ type: 'ticket.registered', ...base, ticketId: ticket.id })
      console.log(`tickets: deferred ${msg.op} ${msg.draftId} -> ${ticket.id}`)
    } catch (err) {
      if (!(err instanceof DomainError)) throw err
      await assistEvents.send({ type: 'ticket.write_failed', ...base, reason: err.message })
    }
  }
}

/** `handoff-events`: transfer / take over / give back / close, recorded on the ticket timeline. */
export function handoffEventsHandler(service: TicketService) {
  return (event: HandoffEvent) => service.applyHandoff(event)
}

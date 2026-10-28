import 'server-only'
import type { AssistEvent } from '@nexo/shared'
import { queues } from '../queues'
import { addRelatedTickets } from './conversations'
import { moveDraft } from './drafts'
import { appendMessage, systemMessage } from './messages'

/**
 * `assist-events` (tickets -> web): the outcome of a write that was queued during an outage.
 * Idempotent: the draft only moves out of pending_registration once, so a redelivered event
 * adds no second message.
 */
export async function handleAssistEvent(event: AssistEvent): Promise<void> {
  if (event.type === 'ticket.registered') {
    const draft = await moveDraft(event.draftId, ['pending_registration', 'confirmed'], 'committed', {
      resultTicketId: event.ticketId,
      committedAt: new Date(),
    })
    if (!draft) return
    await addRelatedTickets(event.conversationId, [event.ticketId])
    await appendMessage({
      conversationId: event.conversationId,
      role: 'system',
      text: `Chamado ${event.ticketId} registrado`,
      parts: [{ type: 'ticket', ticketId: event.ticketId }],
    })
    return
  }
  const draft = await moveDraft(event.draftId, ['pending_registration', 'confirmed'], 'failed')
  if (draft)
    await systemMessage(
      event.conversationId,
      `Não foi possível registrar o rascunho ${event.draftId}: ${event.reason}`,
    )
}

const globalForConsumer = globalThis as unknown as { nexoAssistConsumer?: AbortController }

/** Started once per process from instrumentation.ts (guarded: dev hot reloads would start it again). */
export function startAssistEventsConsumer(): void {
  if (globalForConsumer.nexoAssistConsumer) return
  const controller = new AbortController()
  globalForConsumer.nexoAssistConsumer = controller
  void queues()
    .assistEvents.consume(handleAssistEvent, { signal: controller.signal })
    .catch((err: unknown) => console.error('assist-events consumer stopped', err))
  console.log('web: assist-events consumer started')
}

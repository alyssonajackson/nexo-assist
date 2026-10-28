import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Actor, Conversation, HandoffEvent, Message, Transfer } from '@nexo/shared'
import { queues } from '../queues'
import { transition } from './conversations'
import { systemMessage } from './messages'

/**
 * Handoff steps (state machine in packages/shared/src/domain/conversation.ts). Each one is an atomic
 * transition, then a divider message in the chat and an event on `handoff-events` (ticket timeline,
 * audit trail). The event is best effort: a queue hiccup must not undo the handoff.
 */
async function publish(event: Omit<HandoffEvent, 'eventId' | 'at'>) {
  try {
    await queues().handoffEvents.send({ ...event, eventId: randomUUID(), at: new Date() })
  } catch (err) {
    console.error('handoff: could not publish event', err)
  }
}

/** agent -> waiting_analyst. The agent stops replying from here on. */
export async function transferToAnalyst(
  conversationId: string,
  transfer: Omit<Transfer, 'at'>,
  actor: Actor,
): Promise<Conversation | null> {
  const conv = await moveToWaitingAnalyst(conversationId, transfer)
  if (conv) await announceTransfer(conversationId, transfer, actor)
  return conv
}

/** The state change alone. The chat calls it mid-turn and announces after storing the agent's reply. */
export const moveToWaitingAnalyst = (conversationId: string, transfer: Omit<Transfer, 'at'>) =>
  transition(conversationId, ['agent'], 'waiting_analyst', { transfer: { ...transfer, at: new Date() } })

export async function announceTransfer(
  conversationId: string,
  transfer: Omit<Transfer, 'at'>,
  actor: Actor,
): Promise<Message> {
  const note = await systemMessage(conversationId, 'Transferida para um analista')
  await publish({
    type: 'transferred',
    conversationId,
    actor,
    note: transfer.summary,
    ...(transfer.ticketId ? { ticketId: transfer.ticketId } : {}),
  })
  return note
}

/** waiting_analyst -> analyst ("Assumir"). Only one analyst wins a race. */
export async function takeOver(conversationId: string, analyst: Actor): Promise<Conversation | null> {
  const conv = await transition(conversationId, ['waiting_analyst', 'agent'], 'analyst', {
    assignedAnalystId: analyst.userId,
  })
  if (!conv) return null
  await systemMessage(conversationId, `Assumida por ${analyst.name}`)
  await publish({ type: 'assumed', conversationId, actor: analyst, ...ticketOf(conv) })
  return conv
}

/** waiting_analyst | analyst -> agent ("Devolver ao agent"). */
export async function giveBack(conversationId: string, analyst: Actor): Promise<Conversation | null> {
  const conv = await transition(conversationId, ['waiting_analyst', 'analyst'], 'agent', {}, [
    'assignedAnalystId',
  ])
  if (!conv) return null
  await systemMessage(conversationId, 'Devolvida ao agent')
  await publish({ type: 'released', conversationId, actor: analyst, ...ticketOf(conv) })
  return conv
}

export async function closeConversation(
  conversationId: string,
  analyst: Actor,
): Promise<Conversation | null> {
  const conv = await transition(conversationId, ['waiting_analyst', 'analyst'], 'closed', {
    closedAt: new Date(),
  })
  if (!conv) return null
  await systemMessage(conversationId, 'Atendimento encerrado')
  await publish({ type: 'closed', conversationId, actor: analyst, ...ticketOf(conv) })
  return conv
}

const ticketOf = (c: Conversation) => (c.transfer?.ticketId ? { ticketId: c.transfer.ticketId } : {})

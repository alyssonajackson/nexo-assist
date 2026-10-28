import 'server-only'
import { randomUUID } from 'node:crypto'
import {
  SUPPORT_TEAM,
  type Actor,
  type Conversation,
  type HandoffEvent,
  type Message,
  type Transfer,
} from '@nexo/shared'
import { formatTime } from '@/lib/chat/format'
import { assistDb } from '../db'
import { queues } from '../queues'
import { transition } from './conversations'
import { appendMessage, systemMessage } from './messages'

/** Dividers carry the time like the prototype: "Transferida para Suporte N2 · 10:05". */
const divider = (text: string) => `${text} · ${formatTime(new Date())}`

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
  const note = await systemMessage(conversationId, divider(`Transferida para ${SUPPORT_TEAM}`))
  await publish({
    type: 'transferred',
    conversationId,
    actor,
    note: transfer.summary,
    ...(transfer.ticketId ? { ticketId: transfer.ticketId } : {}),
  })
  return note
}

/** waiting_analyst -> analyst ("Assumir atendimento"). Only one analyst wins a race. */
export async function takeOver(conversationId: string, analyst: Actor): Promise<Conversation | null> {
  const conv = await transition(conversationId, ['waiting_analyst'], 'analyst', {
    assignedAnalystId: analyst.userId,
  })
  if (!conv) return null
  await systemMessage(conversationId, divider(`${analyst.name} assumiu · agent pausado`))
  await publish({ type: 'assumed', conversationId, actor: analyst, ...ticketOf(conv) })
  return conv
}

/** While `analyst`, only the assigned analyst may act; `waiting_analyst` is open to any analyst. */
const assigneeOrWaiting = (analystId: string) => ({
  $or: [{ state: 'waiting_analyst' as const }, { assignedAnalystId: analystId }],
})

/** waiting_analyst | analyst (assignee only) -> agent ("Devolver ao agent"). */
export async function giveBack(conversationId: string, analyst: Actor): Promise<Conversation | null> {
  const conv = await transition(
    conversationId,
    ['waiting_analyst', 'analyst'],
    'agent',
    {},
    ['assignedAnalystId'],
    assigneeOrWaiting(analyst.userId),
  )
  if (!conv) return null
  await systemMessage(conversationId, divider(`${analyst.name} devolveu a conversa ao agent`))
  await publish({ type: 'released', conversationId, actor: analyst, ...ticketOf(conv) })
  return conv
}

export async function closeConversation(
  conversationId: string,
  analyst: Actor,
): Promise<Conversation | null> {
  const conv = await transition(
    conversationId,
    ['waiting_analyst', 'analyst'],
    'closed',
    { closedAt: new Date() },
    [],
    assigneeOrWaiting(analyst.userId),
  )
  if (!conv) return null
  await systemMessage(conversationId, divider(`Atendimento encerrado por ${analyst.name}`))
  await publish({ type: 'closed', conversationId, actor: analyst, ...ticketOf(conv) })
  return conv
}

const ticketOf = (c: Conversation) => (c.transfer?.ticketId ? { ticketId: c.transfer.ticketId } : {})

/**
 * An analyst's message. Allowed only while the conversation is `analyst` and assigned to this analyst:
 * the guard is the same atomic update that bumps the preview, so a give back in between wins cleanly.
 */
export async function analystReply(
  conversationId: string,
  analystId: string,
  text: string,
): Promise<Message | null> {
  const db = await assistDb()
  const now = new Date()
  const conv = await db.conversations.findOneAndUpdate(
    { _id: conversationId, state: 'analyst', assignedAnalystId: analystId },
    { $set: { lastMessageAt: now, preview: text.slice(0, 140) } },
  )
  if (!conv) return null
  return appendMessage({ conversationId, role: 'analyst', authorId: analystId, text, parts: [] })
}

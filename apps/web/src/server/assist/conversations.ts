import 'server-only'
import { ObjectId, type Filter } from 'mongodb'
import { MAX_EMPLOYEE_MESSAGES, type Conversation, type ConversationState } from '@nexo/shared'
import { assistDb, type ConversationDoc } from '../db'
import { toConversation } from './docs'

export async function getConversation(id: string): Promise<Conversation | null> {
  const doc = await (await assistDb()).conversations.findOne({ _id: id })
  return doc ? toConversation(doc) : null
}

/** Privacy on our side too: an employee can only open their own conversations. */
export async function getEmployeeConversation(id: string, employeeId: string): Promise<Conversation | null> {
  const doc = await (await assistDb()).conversations.findOne({ _id: id, employeeId })
  return doc ? toConversation(doc) : null
}

/** "Voltar outro dia e continuar de onde parei": the latest conversation that is not closed. */
export async function latestOpenConversation(employeeId: string): Promise<Conversation | null> {
  const doc = await (
    await assistDb()
  ).conversations.findOne({ employeeId, state: { $ne: 'closed' } }, { sort: { lastMessageAt: -1 } })
  return doc ? toConversation(doc) : null
}

export async function createConversation(employeeId: string): Promise<Conversation> {
  const now = new Date()
  const doc: ConversationDoc = {
    _id: new ObjectId().toHexString(),
    employeeId,
    state: 'agent',
    relatedTicketIds: [],
    employeeMessageCount: 0,
    lastMessageAt: now,
    preview: '',
    createdAt: now,
  }
  await (await assistDb()).conversations.insertOne(doc)
  return toConversation(doc)
}

/**
 * Counts one employee message, atomically refusing the 31st (PRD: 30 messages per session).
 * Returns null when the limit is reached or the conversation is closed.
 */
export async function countEmployeeMessage(id: string, employeeId: string): Promise<Conversation | null> {
  const doc = await (
    await assistDb()
  ).conversations.findOneAndUpdate(
    { _id: id, employeeId, state: { $ne: 'closed' }, employeeMessageCount: { $lt: MAX_EMPLOYEE_MESSAGES } },
    { $inc: { employeeMessageCount: 1 } },
    { returnDocument: 'after' },
  )
  return doc ? toConversation(doc) : null
}

export async function addRelatedTickets(id: string, ticketIds: string[]): Promise<void> {
  if (!ticketIds.length) return
  await (
    await assistDb()
  ).conversations.updateOne({ _id: id }, { $addToSet: { relatedTicketIds: { $each: ticketIds } } })
}

/**
 * One state-machine step as a single atomic update: it only applies if the conversation is still in
 * one of the `from` states. Two analysts clicking "Assumir" at once: exactly one gets a conversation back.
 */
export async function transition(
  id: string,
  from: ConversationState[],
  to: ConversationState,
  set: Partial<Omit<ConversationDoc, '_id' | 'state'>> = {},
  unset: (keyof ConversationDoc)[] = [],
  /** Extra guard in the same atomic filter, e.g. only the assigned analyst. */
  guard: Filter<ConversationDoc> = {},
): Promise<Conversation | null> {
  const doc = await (
    await assistDb()
  ).conversations.findOneAndUpdate(
    { _id: id, state: { $in: from }, ...guard },
    {
      $set: { ...set, state: to },
      ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, ''])) } : {}),
    },
    { returnDocument: 'after' },
  )
  return doc ? toConversation(doc) : null
}

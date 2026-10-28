import 'server-only'
import {
  slaDueAt,
  type ConsoleConversationResponse,
  type ConsoleEmployee,
  type ConsoleFilter,
  type ConsoleItem,
  type ConsoleListResponse,
  type Conversation,
  type Message,
  type TicketView,
} from '@nexo/shared'
import { countItems, filterItems } from '@/lib/console/list'
import { assistDb, type UserDoc } from '../db'
import type { Session } from '../session'
import { toConversation, toMessage } from './docs'
import { listDrafts } from './drafts'
import { listMessages } from './messages'
import { ticketsAs } from './runtime'

const employeeOf = (u: UserDoc | undefined, id: string): ConsoleEmployee =>
  u
    ? { id, name: u.name, department: u.department, email: u.email }
    : { id, name: 'Colaborador', department: '' }

/** Employee messages after the last answer, and the agent's latest confidence, from the newest messages. */
function summarize(recent: Message[]): { unread: number; lastConfidence?: number } {
  const lastAnswer = recent.findIndex((m) => m.role === 'agent' || m.role === 'analyst')
  const unread = (lastAnswer === -1 ? recent : recent.slice(0, lastAnswer)).filter(
    (m) => m.role === 'employee',
  ).length
  const confidence = recent.find((m) => m.role === 'agent')?.decision?.confidence
  return { unread, ...(confidence === undefined ? {} : { lastConfidence: confidence }) }
}

/** The list for the left pane: every conversation, newest first, then tab + search applied by pure code. */
export async function listConsole(
  analystId: string,
  filter: ConsoleFilter,
  query: string,
): Promise<ConsoleListResponse> {
  const db = await assistDb()
  const docs = await db.conversations.find({}).sort({ lastMessageAt: -1 }).limit(200).toArray()
  const users = await db.users.find({ _id: { $in: [...new Set(docs.map((d) => d.employeeId))] } }).toArray()
  const byId = new Map(users.map((u) => [u._id, u]))

  const items: ConsoleItem[] = await Promise.all(
    docs.map(async (doc) => {
      const recent = await db.messages
        .find({ conversationId: doc._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray()
      const summary = summarize(recent.map(toMessage))
      return {
        conversation: toConversation(doc),
        employee: employeeOf(byId.get(doc.employeeId), doc.employeeId),
        ...summary,
      }
    }),
  )
  return { items: filterItems(items, filter, query, analystId), counts: countItems(items, analystId) }
}

/** The ticket the handoff is about: the one the transfer names, else the latest the chat touched. */
export const currentTicketId = (c: Conversation): string | undefined =>
  c.transfer?.ticketId ?? c.relatedTicketIds.at(-1)

/**
 * "Até HH:MM" in the waiting bar: the SLA first-response window of the related ticket's priority,
 * counted from the moment of the transfer (medium when there is no ticket). Annex A rules, pure math.
 */
export function waitingUntil(c: Conversation, ticket: TicketView | undefined): Date | undefined {
  if (c.state !== 'waiting_analyst' || !c.transfer) return undefined
  return slaDueAt(ticket?.priority ?? 'medium', c.transfer.at)
}

/** Everything the console renders for one conversation; null when it does not exist. */
export async function consoleConversationView(
  session: Session,
  conversationId: string,
): Promise<ConsoleConversationResponse | null> {
  const db = await assistDb()
  const doc = await db.conversations.findOne({ _id: conversationId })
  if (!doc) return null
  const conversation = toConversation(doc)

  const [messages, drafts, employee] = await Promise.all([
    listMessages(conversationId),
    listDrafts(conversationId),
    db.users.findOne({ _id: conversation.employeeId }),
  ])

  const authorIds = [
    ...new Set([
      ...messages.flatMap((m) => (m.role === 'analyst' && m.authorId ? [m.authorId] : [])),
      ...(conversation.assignedAnalystId ? [conversation.assignedAnalystId] : []),
    ]),
  ]
  const analysts = await db.users.find({ _id: { $in: authorIds } }).toArray()
  const authors = Object.fromEntries(
    analysts.map((u) => [u._id, { name: u.name, ...(u.team ? { team: u.team } : {}) }]),
  )

  // The employee's tickets come from the tickets service with the analyst's own token. The service may
  // be down: the conversation still opens, the side panel just stays empty.
  let tickets: TicketView[] = []
  try {
    tickets = await ticketsAs(session.accessToken).listTickets({
      scope: 'all',
      requesterId: conversation.employeeId,
    })
  } catch {
    tickets = []
  }

  const ticketId = currentTicketId(conversation)
  const until = waitingUntil(
    conversation,
    tickets.find((t) => t.id === ticketId),
  )
  return {
    conversation,
    employee: employeeOf(employee ?? undefined, conversation.employeeId),
    messages,
    drafts,
    authors,
    tickets,
    ...(ticketId ? { currentTicketId: ticketId } : {}),
    ...(until ? { waitingUntil: until } : {}),
  }
}

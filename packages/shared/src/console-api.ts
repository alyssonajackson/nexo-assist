import { z } from 'zod'
import { Conversation, Draft, Message } from './domain/conversation'
import { TicketView } from './domain/ticket'

/** HTTP contract of the analyst console routes in apps/web (`/api/console/*`). */

/** Tabs of the conversation list (screens 4 and 5). */
export const ConsoleFilter = z.enum(['all', 'waiting', 'agent', 'mine'])
export type ConsoleFilter = z.infer<typeof ConsoleFilter>

export const CONSOLE_FILTER_LABELS: Record<ConsoleFilter, string> = {
  all: 'Todas',
  waiting: 'Para você',
  agent: 'Com o agent',
  mine: 'Minhas',
}

export const ConsoleEmployee = z.object({
  id: z.string(),
  name: z.string(),
  department: z.string(),
  email: z.string().optional(),
})
export type ConsoleEmployee = z.infer<typeof ConsoleEmployee>

/** One row of the conversation list. */
export const ConsoleItem = z.object({
  conversation: Conversation,
  employee: ConsoleEmployee,
  /** Employee messages since the last answer (agent or analyst). */
  unread: z.number().int().nonnegative(),
  /** Confidence of the agent's latest decision: "Agent pediu ajuda · confiança 41%". */
  lastConfidence: z.number().optional(),
})
export type ConsoleItem = z.infer<typeof ConsoleItem>

export const ConsoleCounts = z.object({
  all: z.number().int(),
  waiting: z.number().int(),
  agent: z.number().int(),
  mine: z.number().int(),
})
export type ConsoleCounts = z.infer<typeof ConsoleCounts>

export const ConsoleListResponse = z.object({ items: z.array(ConsoleItem), counts: ConsoleCounts })
export type ConsoleListResponse = z.infer<typeof ConsoleListResponse>

export const ConsoleAuthor = z.object({ name: z.string(), team: z.string().optional() })
export type ConsoleAuthor = z.infer<typeof ConsoleAuthor>

/** GET /api/console/conversations/:id */
export const ConsoleConversationResponse = z.object({
  conversation: Conversation,
  employee: ConsoleEmployee,
  messages: z.array(Message),
  drafts: z.array(Draft),
  /** Analysts who wrote or hold the conversation, by user id (names on the bubbles). */
  authors: z.record(z.string(), ConsoleAuthor),
  /** All of the employee's tickets, fetched with the analyst's token. */
  tickets: z.array(TicketView),
  /** The ticket tied to the handoff (transfer.ticketId or the latest related one). */
  currentTicketId: z.string().optional(),
  /** When the employee can expect a first answer ("até 12:05"), from the SLA of that ticket's priority. */
  waitingUntil: z.coerce.date().optional(),
})
export type ConsoleConversationResponse = z.infer<typeof ConsoleConversationResponse>

export const AnalystReplyRequest = z.object({ text: z.string().trim().min(1).max(2000) })
export type AnalystReplyRequest = z.infer<typeof AnalystReplyRequest>

/** The team the agent hands conversations to (shown on dividers and analyst bubbles by default). */
export const SUPPORT_TEAM = 'Suporte N2'

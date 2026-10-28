import { z } from 'zod'
import { Decision } from './decision'
import { NewTicketInput, TicketId } from './ticket'

/**
 * agent ──transfer──► waiting_analyst ──take──► analyst ──close──► closed
 *   ▲                      │                       │
 *   └──── give back ───────┴───────────────────────┘
 */
export const ConversationState = z.enum(['agent', 'waiting_analyst', 'analyst', 'closed'])
export type ConversationState = z.infer<typeof ConversationState>

export const Role = z.enum(['employee', 'analyst'])
export type Role = z.infer<typeof Role>

export const User = z.object({
  /** Cognito `sub`. */
  id: z.string(),
  email: z.email(),
  name: z.string(),
  role: Role,
  department: z.string(),
  /** Team label shown for analysts, e.g. "Suporte N2". */
  team: z.string().optional(),
})
export type User = z.infer<typeof User>

export const Transfer = z.object({
  reason: z.enum(['employee_request', 'critical', 'overdue', 'low_confidence']),
  summary: z.string(),
  at: z.coerce.date(),
  by: z.enum(['agent', 'rule']),
  ticketId: TicketId.optional(),
})
export type Transfer = z.infer<typeof Transfer>

export const Conversation = z.object({
  id: z.string(),
  employeeId: z.string(),
  state: ConversationState,
  assignedAnalystId: z.string().optional(),
  transfer: Transfer.optional(),
  relatedTicketIds: z.array(TicketId),
  /** Employee messages in this session; capped at MAX_EMPLOYEE_MESSAGES. */
  employeeMessageCount: z.number().int().nonnegative(),
  lastMessageAt: z.coerce.date(),
  preview: z.string(),
  createdAt: z.coerce.date(),
  closedAt: z.coerce.date().optional(),
})
export type Conversation = z.infer<typeof Conversation>

export const MAX_EMPLOYEE_MESSAGES = 30

export const DraftKind = z.enum(['create', 'update', 'reopen'])
export type DraftKind = z.infer<typeof DraftKind>

export const DraftStatus = z.enum([
  'pending',
  'confirmed',
  'committed',
  'pending_registration',
  'cancelled',
  'failed',
])
export type DraftStatus = z.infer<typeof DraftStatus>

export const Draft = z.object({
  /** D-381 style id; also the idempotency key of the resulting write. */
  id: z.string(),
  conversationId: z.string(),
  employeeId: z.string(),
  kind: DraftKind,
  /** Target ticket for update/reopen. */
  ticketId: TicketId.optional(),
  /** Full ticket fields for create. */
  fields: NewTicketInput.optional(),
  /** Note appended on update, or reason on reopen. */
  note: z.string().optional(),
  status: DraftStatus,
  /** Ticket number once registered. */
  resultTicketId: TicketId.optional(),
  createdAt: z.coerce.date(),
  confirmedAt: z.coerce.date().optional(),
  committedAt: z.coerce.date().optional(),
})
export type Draft = z.infer<typeof Draft>

/** Rich parts rendered in the chat besides plain text. */
export const MessagePart = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ticket_list'), ticketIds: z.array(TicketId) }),
  z.object({ type: z.literal('ticket'), ticketId: TicketId }),
  z.object({ type: z.literal('draft'), draftId: z.string() }),
  z.object({ type: z.literal('quick_replies'), options: z.array(z.string()).max(4) }),
])
export type MessagePart = z.infer<typeof MessagePart>

export const MessageRole = z.enum(['employee', 'agent', 'analyst', 'system'])
export type MessageRole = z.infer<typeof MessageRole>

export const Message = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: MessageRole,
  authorId: z.string().optional(),
  text: z.string(),
  parts: z.array(MessagePart),
  decision: Decision.optional(),
  createdAt: z.coerce.date(),
})
export type Message = z.infer<typeof Message>

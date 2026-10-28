import { z } from 'zod'
import { Conversation, Draft, Message } from './domain/conversation'
import { ToolCall } from './domain/decision'
import { TicketView } from './domain/ticket'

/** HTTP contract of the chat routes in apps/web, shared by the UI and the CLI (scripts/src/agent-chat.ts). */

export const ChatRequest = z.object({
  /** Omitted: continue the employee's open conversation, or start one. */
  conversationId: z.string().optional(),
  text: z.string().trim().min(1).max(2000),
})
export type ChatRequest = z.infer<typeof ChatRequest>

/**
 * POST /api/chat and POST /api/drafts/:id/confirm answer with NDJSON: one event per line, in order.
 * The stream always ends with `conversation` (the new state) or `error`.
 */
export const ChatStreamEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('employee_message'), message: Message }),
  /** A real tool call finished: draw its chip. */
  z.object({ type: z.literal('tool'), call: ToolCall }),
  /** The model's decision fields, before the reply text. */
  z.object({
    type: z.literal('decision'),
    intent: z.string().optional(),
    action: z.string().optional(),
    confidence: z.number().optional(),
  }),
  z.object({ type: z.literal('reply_delta'), delta: z.string() }),
  /** A rule replaced the streamed reply. */
  z.object({ type: z.literal('reply_replaced'), text: z.string() }),
  /** The ticket system is failing; the client is retrying (attempt n) or gave up and queued the write. */
  z.object({
    type: z.literal('status'),
    status: z.enum(['tickets_retrying', 'tickets_queued']),
    attempt: z.number().int().optional(),
    message: z.string(),
  }),
  /** A stored message (the agent's reply with its Decision, or a system note). */
  z.object({ type: z.literal('message'), message: Message }),
  z.object({ type: z.literal('draft'), draft: Draft }),
  z.object({ type: z.literal('conversation'), conversation: Conversation }),
  z.object({ type: z.literal('error'), error: z.string(), message: z.string() }),
])
export type ChatStreamEvent = z.infer<typeof ChatStreamEvent>

/** GET /api/conversations/:id (also used for polling while an analyst or the queue is working). */
export const ConversationResponse = z.object({
  conversation: Conversation,
  messages: z.array(Message),
  drafts: z.array(Draft),
  /** Tickets referenced by the cards, fetched with the employee's token (privacy applies). */
  tickets: z.array(TicketView),
})
export type ConversationResponse = z.infer<typeof ConversationResponse>

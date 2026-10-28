import { z } from 'zod'
import { Category, KbArticle, NewTicketInput, TicketView } from './domain/ticket'

/** HTTP contract of services/tickets, shared by the service and its client. */

export const ListTicketsQuery = z.object({
  /** "open" = not resolved/closed; "all" includes history. */
  scope: z.enum(['open', 'all']).default('all'),
  q: z.string().optional(),
  /** Analysts only: whose tickets. Employees always get their own, whatever they send. */
  requesterId: z.string().optional(),
})
export type ListTicketsQuery = z.input<typeof ListTicketsQuery>

export const DuplicatesQuery = z.object({
  text: z.string().min(3),
  category: Category.optional(),
})
export type DuplicatesQuery = z.infer<typeof DuplicatesQuery>

export const DuplicateCandidate = z.object({
  ticket: TicketView,
  /** MongoDB text score; higher means more similar. The agent decides if it is the same problem. */
  score: z.number(),
})
export type DuplicateCandidate = z.infer<typeof DuplicateCandidate>

export const CreateTicketBody = NewTicketInput.extend({
  /** Display name only; the requester id always comes from the token. */
  requesterName: z.string().min(1),
})
export type CreateTicketBody = z.infer<typeof CreateTicketBody>

export const NoteBody = z.object({ note: z.string().min(3).max(4000) })
export const ReopenBody = z.object({ reason: z.string().min(3).max(4000) })
export const TransferBody = z.object({ summary: z.string().min(3).max(4000) })

export const TicketResponse = z.object({
  ticket: TicketView,
  /** True when the Idempotency-Key was already used and the original result is returned. */
  replayed: z.boolean(),
})
export type TicketResponse = z.infer<typeof TicketResponse>

export const TicketListResponse = z.object({ tickets: z.array(TicketView) })
export const DuplicatesResponse = z.object({ candidates: z.array(DuplicateCandidate) })
export const KbSearchResponse = z.object({
  articles: z.array(KbArticle.extend({ score: z.number() })),
})
export type KbSearchResult = z.infer<typeof KbSearchResponse>['articles'][number]

export const ErrorResponse = z.object({
  error: z.string(),
  message: z.string(),
})
export type ErrorResponse = z.infer<typeof ErrorResponse>

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

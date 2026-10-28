/**
 * Two databases keep the service boundary real:
 * - `tickets` is owned by services/tickets (the "legacy" ticket system).
 * - `assist` is owned by apps/web (users, conversations, messages, drafts).
 * Documents use the domain `id` as `_id`.
 */
export const DB = {
  tickets: process.env.TICKETS_DB ?? 'tickets',
  assist: process.env.ASSIST_DB ?? 'assist',
} as const

export const TICKETS_COLLECTIONS = {
  tickets: 'tickets',
  kbArticles: 'kb_articles',
  counters: 'counters',
} as const

export const ASSIST_COLLECTIONS = {
  users: 'users',
  conversations: 'conversations',
  messages: 'messages',
  drafts: 'drafts',
  counters: 'counters',
  llmUsage: 'llm_usage',
  meta: 'meta',
} as const

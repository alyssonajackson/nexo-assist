import type {
  Affected,
  Category,
  ConversationState,
  Decision,
  MessagePart,
  MessageRole,
  Priority,
  Role,
  TicketStatus,
  TicketType,
  TimelineKind,
  Transfer,
} from '@nexo/shared'

/**
 * Seed data is declared relative to "now" so that states like "overdue" or "resolved 4 days ago"
 * stay true whenever the app is started. `Ago` is how long before now something happened.
 */
export type Ago = { days?: number; hours?: number; minutes?: number }

export type UserKey = 'ana' | 'bruno' | 'carla' | 'diego' | 'rafael'

export type SeedUser = {
  key: UserKey
  email: string
  name: string
  role: Role
  department: string
  team?: string
}

export type SeedTimelineEntry = {
  kind: TimelineKind
  ago: Ago
  /** A seeded user, or "support" for a generic support-team update. */
  by: UserKey | 'support'
  note?: string
}

export type SeedTicket = {
  id: string
  type: TicketType
  category: Category
  subcategory?: string
  title: string
  description: string
  priority: Priority
  affected: Affected
  status: TicketStatus
  requester: UserKey
  createdAgo: Ago
  lastSupportUpdateAgo?: Ago
  resolvedAgo?: Ago
  timeline: SeedTimelineEntry[]
}

export type SeedKbArticle = {
  id: string
  title: string
  body: string
  category: Category
  tags: string[]
}

export type SeedMessage = {
  role: MessageRole
  author?: UserKey
  text: string
  ago: Ago
  parts?: MessagePart[]
  decision?: Decision
}

export type SeedConversation = {
  employee: UserKey
  state: ConversationState
  assignedAnalyst?: UserKey
  transfer?: Omit<Transfer, 'at'> & { ago: Ago }
  relatedTicketIds: string[]
  messages: SeedMessage[]
}

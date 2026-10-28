import { z } from 'zod'

// Annex A: INC = something broke or stopped working; REQ = request for access, equipment or software.
export const TicketType = z.enum(['INC', 'REQ'])
export type TicketType = z.infer<typeof TicketType>

export const Category = z.enum(['access', 'network_vpn', 'hardware', 'software', 'email', 'other'])
export type Category = z.infer<typeof Category>

export const CATEGORY_LABELS: Record<Category, string> = {
  access: 'Acesso',
  network_vpn: 'Rede e VPN',
  hardware: 'Hardware',
  software: 'Software',
  email: 'E-mail',
  other: 'Outros',
}

export const Priority = z.enum(['critical', 'high', 'medium', 'low'])
export type Priority = z.infer<typeof Priority>

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}

// Who is affected. Drives impact in the priority matrix.
export const Affected = z.enum(['self', 'team', 'company', 'unknown'])
export type Affected = z.infer<typeof Affected>

export const AFFECTED_LABELS: Record<Affected, string> = {
  self: 'Somente você',
  team: 'Sua equipe',
  company: 'Toda a empresa',
  unknown: 'Não informado',
}

export const TicketStatus = z.enum(['open', 'in_progress', 'awaiting_analyst', 'approved', 'resolved', 'closed'])
export type TicketStatus = z.infer<typeof TicketStatus>

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  awaiting_analyst: 'Aguardando analista',
  approved: 'Aprovado',
  resolved: 'Resolvido',
  closed: 'Encerrado',
}

/** Statuses where the ticket is still being worked on (SLA applies, duplicates are checked). */
export const OPEN_STATUSES: readonly TicketStatus[] = ['open', 'in_progress', 'awaiting_analyst', 'approved']

export const isOpenStatus = (status: TicketStatus): boolean => OPEN_STATUSES.includes(status)

export const TicketId = z.string().regex(/^(INC|REQ)-\d{5}$/, 'expected INC-12345 or REQ-12345')

export const TimelineKind = z.enum([
  'created',
  'employee_update',
  'support_update',
  'reopened',
  'transferred',
  'assumed',
  'released',
  'closed',
  'resolved',
])
export type TimelineKind = z.infer<typeof TimelineKind>

export const TimelineEntry = z.object({
  /** Idempotency key of the write that produced this entry. */
  key: z.string(),
  kind: TimelineKind,
  at: z.coerce.date(),
  by: z.string(),
  note: z.string().optional(),
})
export type TimelineEntry = z.infer<typeof TimelineEntry>

export const Ticket = z.object({
  id: TicketId,
  type: TicketType,
  category: Category,
  subcategory: z.string().optional(),
  title: z.string().min(3).max(120),
  description: z.string().min(3).max(4000),
  priority: Priority,
  affected: Affected,
  status: TicketStatus,
  requesterId: z.string(),
  requesterName: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  /** Last time support (an analyst) responded or updated the ticket. Restarts the SLA clock. */
  lastSupportUpdateAt: z.coerce.date().optional(),
  resolvedAt: z.coerce.date().optional(),
  timeline: z.array(TimelineEntry),
})
export type Ticket = z.infer<typeof Ticket>

/** A ticket as returned by the tickets service, with SLA fields computed by code. */
export const TicketView = Ticket.extend({
  sla: z.object({
    dueAt: z.coerce.date().nullable(),
    overdue: z.boolean(),
    reopenable: z.boolean(),
  }),
})
export type TicketView = z.infer<typeof TicketView>

/** Fields every new ticket needs (Annex A). */
export const NewTicketInput = z.object({
  type: TicketType,
  category: Category,
  title: z.string().min(3).max(120),
  description: z.string().min(3).max(4000),
  priority: Priority,
  affected: Affected,
})
export type NewTicketInput = z.infer<typeof NewTicketInput>

export const KbArticle = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  category: Category,
  tags: z.array(z.string()),
})
export type KbArticle = z.infer<typeof KbArticle>

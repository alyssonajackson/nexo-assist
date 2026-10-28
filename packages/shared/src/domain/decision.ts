import { z } from 'zod'
import { Affected, Category, Priority, TicketType } from './ticket'

/** What the employee wants, as understood by the agent. */
export const Intent = z.enum([
  'kb_question',
  'ticket_lookup',
  'ticket_create',
  'ticket_update',
  'ticket_reopen',
  'request_analyst',
  'out_of_scope',
  'smalltalk',
  'unclear',
])
export type Intent = z.infer<typeof Intent>

export const INTENT_LABELS: Record<Intent, string> = {
  kb_question: 'Dúvida (central de ajuda)',
  ticket_lookup: 'Consultar chamado',
  ticket_create: 'Abrir chamado',
  ticket_update: 'Complementar chamado',
  ticket_reopen: 'Reabrir chamado',
  request_analyst: 'Falar com analista',
  out_of_scope: 'Fora do escopo de TI',
  smalltalk: 'Conversa',
  unclear: 'Não ficou claro',
}

/** What the agent did in this turn. */
export const Action = z.enum([
  'answer_from_kb',
  'list_tickets',
  'show_ticket',
  'ask_clarification',
  'propose_draft',
  'propose_update',
  'propose_reopen',
  'commit_draft',
  'transfer_to_analyst',
  'redirect_out_of_scope',
  'reply',
])
export type Action = z.infer<typeof Action>

export const ACTION_LABELS: Record<Action, string> = {
  answer_from_kb: 'Respondeu com a central de ajuda',
  list_tickets: 'Listou seus chamados',
  show_ticket: 'Mostrou um chamado',
  ask_clarification: 'Pediu mais informações',
  propose_draft: 'Montou um rascunho de chamado',
  propose_update: 'Montou um rascunho de atualização',
  propose_reopen: 'Montou um rascunho de reabertura',
  commit_draft: 'Registrou o chamado confirmado',
  transfer_to_analyst: 'Transferiu para um analista',
  redirect_out_of_scope: 'Redirecionou (fora de TI)',
  reply: 'Respondeu',
}

/** Fields the agent extracted from the conversation. All optional: it only fills what it understood. */
export const Extracted = z.object({
  ticketId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  type: TicketType.optional(),
  category: Category.optional(),
  affected: Affected.optional(),
  sameDayCommitment: z.boolean().optional(),
  hasWorkaround: z.boolean().optional(),
  priority: Priority.optional(),
  kbArticleIds: z.array(z.string()).optional(),
})
export type Extracted = z.infer<typeof Extracted>

/** Agent tools. The model has no tool that creates, updates or reopens a ticket: only the Confirmar button does. */
export const ToolName = z.enum([
  'search_kb',
  'list_my_tickets',
  'get_ticket',
  'classify_priority',
  'propose_draft',
  'propose_update',
  'propose_reopen',
  'transfer_to_analyst',
])
export type ToolName = z.infer<typeof ToolName>

/** Action chips shown above the agent's reply, one per real tool call. */
export const TOOL_LABELS: Record<ToolName, string> = {
  search_kb: 'consultou a central de ajuda',
  list_my_tickets: 'consultou seus chamados',
  get_ticket: 'abriu o chamado',
  classify_priority: 'classificou a prioridade',
  propose_draft: 'montou um rascunho',
  propose_update: 'montou uma atualização',
  propose_reopen: 'montou uma reabertura',
  transfer_to_analyst: 'transferiu para um analista',
}

/** One real tool call, recorded by code (never claimed by the model). */
export const ToolCall = z.object({
  tool: z.string(),
  /** PT-BR chip label, e.g. "consultou seus chamados". */
  label: z.string(),
  ok: z.boolean(),
  ms: z.number().int().nonnegative(),
  summary: z.string().optional(),
})
export type ToolCall = z.infer<typeof ToolCall>

/** Annex A rules that code enforces on top of the model (packages/agent/src/policy.ts and the tools). */
export const RuleName = z.enum([
  'low_confidence',
  'gray_zone_confidence',
  'out_of_scope',
  'explicit_analyst_request',
  'critical_transfer',
  'overdue_offer',
  'duplicate_check',
  'reopen_window',
  'action_without_tool',
])
export type RuleName = z.infer<typeof RuleName>

/** PT-BR names of the rules, for the decision panel ("regra aplicada pelo sistema"). */
export const RULE_LABELS: Record<RuleName, string> = {
  low_confidence: 'Confiança baixa',
  gray_zone_confidence: 'Confiança intermediária',
  out_of_scope: 'Fora do escopo de TI',
  explicit_analyst_request: 'Pedido de analista',
  critical_transfer: 'Caso crítico',
  overdue_offer: 'Chamado com prazo vencido',
  duplicate_check: 'Chamado duplicado',
  reopen_window: 'Prazo de reabertura (7 dias)',
  action_without_tool: 'Ação sem ferramenta',
}

/**
 * Self-reported confidence is not reliable, so there are two thresholds (enforced in
 * packages/agent/src/policy.ts, shown in the decision panel):
 * - below 0.5 the agent hands the conversation to an analyst;
 * - from 0.5 to 0.7 it never proposes a write, it asks a clarifying question first.
 */
export const CONFIDENCE = { transferBelow: 0.5, clarifyBelow: 0.7 } as const

/** A rule enforced by code that changed or constrained what the model decided. */
export const RuleOverride = z.object({
  rule: RuleName,
  from: z.string().optional(),
  to: z.string().optional(),
  why: z.string(),
})
export type RuleOverride = z.infer<typeof RuleOverride>

/** The part of the decision the model produces (structured output). */
export const ModelDecision = z.object({
  intent: Intent,
  extracted: Extracted,
  action: Action,
  confidence: z.number().min(0).max(1),
  reason: z.string().describe('PT-BR, 1-2 frases explicando por que escolheu esta ação'),
  quickReplies: z.array(z.string()).max(4).optional(),
  missingFields: z.array(z.string()).optional(),
})
export type ModelDecision = z.infer<typeof ModelDecision>

/** The full decision stored with each assistant message. Drives the chips and the detail panel. */
export const Decision = ModelDecision.extend({
  toolsCalled: z.array(ToolCall),
  ruleOverrides: z.array(RuleOverride),
  /** "model" when the LLM decided; "code" for deterministic turns (e.g. the employee pressed Confirmar). */
  source: z.enum(['model', 'code']),
  model: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  /** Tokens of the whole turn (every model step), for the cost estimate. */
  usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int() }).optional(),
})
export type Decision = z.infer<typeof Decision>

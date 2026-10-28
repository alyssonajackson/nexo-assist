import {
  PRIORITY_LABELS,
  type Action,
  type Draft,
  type DraftKind,
  type ModelDecision,
  type RuleOverride,
  type Transfer,
} from '@nexo/shared'
import type { TurnEffects } from './recorder'

/**
 * Post-turn rules (Annex A), applied by code after the model answers. Pure: the caller executes the
 * result (transfer, cancel drafts). Every change is recorded as a RuleOverride, so the detail panel
 * shows what the model wanted and what code enforced.
 *
 * Self-reported confidence is not reliable, so there are two thresholds:
 * - below 0.5 the agent hands the conversation to an analyst;
 * - from 0.5 to 0.7 it never proposes a write, it asks a clarifying question first.
 */
export const CONFIDENCE = { transferBelow: 0.5, clarifyBelow: 0.7 } as const

export type TransferPlan = Omit<Transfer, 'at'>

export type PolicyInput = {
  decision: ModelDecision
  reply: string
  effects: TurnEffects
  employeeName: string
  employeeMessage: string
}

export type PolicyResult = {
  decision: ModelDecision
  reply: string
  overrides: RuleOverride[]
  /** A transfer code must perform now (the model did not call the tool). */
  transfer?: TransferPlan
  /** Drafts proposed this turn that code withdrew. */
  cancelDraftIds: string[]
}

const PROPOSALS: Partial<Record<Action, DraftKind>> = {
  propose_draft: 'create',
  propose_update: 'update',
  propose_reopen: 'reopen',
}
const ACTION_BY_KIND: Record<DraftKind, Action> = {
  create: 'propose_draft',
  update: 'propose_update',
  reopen: 'propose_reopen',
}

export const REPLIES = {
  transfer:
    'Vou transferir você para um analista, que já vai receber o resumo do caso. Aguarde só um instante.',
  lowConfidence:
    'Não tenho certeza de que entendi o seu pedido. Para não te passar uma informação errada, vou transferir para um analista, que já vai receber o resumo da conversa.',
  outOfScope:
    'Eu cuido só de assuntos de TI (acessos, rede e VPN, equipamentos, softwares e e-mail). Para RH, financeiro ou facilities, procure a área responsável pelos canais internos.',
  clarify: (missing: string[]) =>
    'Antes de registrar qualquer coisa, quero ter certeza de que entendi. ' +
    (missing.length
      ? `Pode me contar ${missing.join(', ')}?`
      : 'Pode me dar mais detalhes: o que acontece, desde quando e quem é afetado?'),
} as const

export const OVERDUE_QUICK_REPLIES = ['Sim, falar com um analista', 'Não, obrigado'] as const
export const DUPLICATE_QUICK_REPLIES = ['É o mesmo problema', 'É outro problema'] as const

export function applyPolicy(input: PolicyInput): PolicyResult {
  const { effects, employeeName, employeeMessage } = input
  let decision: ModelDecision = withoutConfirmReplies(input.decision)
  let reply = input.reply
  const overrides: RuleOverride[] = []
  const cancelDraftIds: string[] = []
  let transfer: TransferPlan | undefined

  const setAction = (to: Action, rule: RuleOverride['rule'], why: string) => {
    if (decision.action !== to) overrides.push({ rule, from: decision.action, to, why })
    else overrides.push({ rule, why })
    decision = { ...decision, action: to }
  }
  const withdrawDrafts = () => {
    for (const d of effects.drafts) cancelDraftIds.push(d.id)
  }
  const summary = () =>
    `${employeeName}: "${employeeMessage.slice(0, 300)}". ${decision.reason}` +
    (effects.shownTicketIds.length ? ` Chamados vistos: ${effects.shownTicketIds.join(', ')}.` : '')

  // The model called transfer_to_analyst: the conversation is already with an analyst. Nothing else applies.
  if (effects.transfer) {
    if (decision.action !== 'transfer_to_analyst') decision = { ...decision, action: 'transfer_to_analyst' }
    return { decision, reply, overrides, cancelDraftIds }
  }

  // Annex A: transfer when the employee asks for it. Not left to the model's judgement.
  if (decision.intent === 'request_analyst') {
    setAction(
      'transfer_to_analyst',
      'explicit_analyst_request',
      'O funcionário pediu para falar com um analista.',
    )
    transfer = { reason: 'employee_request', summary: summary(), by: 'rule' }
    withdrawDrafts()
    return { decision, reply: REPLIES.transfer, overrides, transfer, cancelDraftIds }
  }

  if (decision.confidence < CONFIDENCE.transferBelow) {
    const pct = Math.round(decision.confidence * 100)
    setAction(
      'transfer_to_analyst',
      'low_confidence',
      `Confiança ${pct}% abaixo do limite de ${CONFIDENCE.transferBelow * 100}%.`,
    )
    transfer = { reason: 'low_confidence', summary: `${summary()} Confiança do agente: ${pct}%.`, by: 'rule' }
    withdrawDrafts()
    return { decision, reply: REPLIES.lowConfidence, overrides, transfer, cancelDraftIds }
  }

  // Scope: IT only. HR, finance and facilities are redirected, and nothing is registered for them.
  if (decision.intent === 'out_of_scope') {
    if (decision.action !== 'redirect_out_of_scope' || effects.drafts.length) {
      setAction('redirect_out_of_scope', 'out_of_scope', 'Assunto fora de TI: o agente só redireciona.')
      reply = REPLIES.outOfScope
    }
    withdrawDrafts()
    return { decision, reply, overrides, cancelDraftIds }
  }

  // A draft was proposed but the action says otherwise (or vice versa): trust what the tools did.
  const draft = effects.drafts.at(-1)
  const claimedKind = PROPOSALS[decision.action]
  if (draft && claimedKind !== draft.kind) decision = { ...decision, action: ACTION_BY_KIND[draft.kind] }
  if (!draft && claimedKind) {
    // A refused proposal (duplicate, reopen window...): the model may still write "preparei o
    // rascunho", so the reply comes from the refusal itself, written by code.
    const refusal = effects.refusals.filter((r) => r.tool === decision.action).at(-1)
    if (refusal) {
      decision = { ...decision, action: 'ask_clarification' }
      reply = refusal.message
      if (refusal.error === 'possible_duplicates')
        decision = { ...decision, quickReplies: [...DUPLICATE_QUICK_REPLIES] }
    } else {
      setAction(
        'ask_clarification',
        'action_without_tool',
        'O modelo disse que montou um rascunho, mas nenhum rascunho foi criado.',
      )
      reply = REPLIES.clarify(decision.missingFields ?? [])
    }
  }

  // Gray zone: unsure enough that no write is proposed; ask first.
  if (draft && decision.confidence < CONFIDENCE.clarifyBelow) {
    const pct = Math.round(decision.confidence * 100)
    setAction(
      'ask_clarification',
      'gray_zone_confidence',
      `Confiança ${pct}% abaixo de ${CONFIDENCE.clarifyBelow * 100}%: pergunta antes de propor o rascunho.`,
    )
    withdrawDrafts()
    reply = REPLIES.clarify(decision.missingFields ?? [])
  }

  // Annex A: critical cases go to an analyst. With a draft, the transfer happens when it is committed
  // (afterCommit); classified critical but no draft means nothing would be registered, so transfer now.
  if (effects.priority?.priority === 'critical' && !draft && decision.action !== 'transfer_to_analyst') {
    setAction(
      'transfer_to_analyst',
      'critical_transfer',
      'Caso classificado como Crítico: transferência imediata para um analista.',
    )
    transfer = { reason: 'critical', summary: summary(), by: 'rule' }
    return { decision, reply: REPLIES.transfer, overrides, transfer, cancelDraftIds }
  }

  // The chips and cards must match real tool calls.
  if (
    (decision.action === 'list_tickets' || decision.action === 'show_ticket') &&
    !effects.shownTicketIds.length
  ) {
    setAction('reply', 'action_without_tool', 'Nenhum chamado foi consultado neste turno.')
  }
  if (decision.action === 'answer_from_kb' && !effects.kbArticleIds.length) {
    setAction('reply', 'action_without_tool', 'A central de ajuda não foi consultada neste turno.')
  }
  if (decision.action === 'transfer_to_analyst') {
    // The model meant to transfer but did not call the tool: code performs it, so the reply is not a lie.
    const reason: Transfer['reason'] =
      effects.priority?.priority === 'critical'
        ? 'critical'
        : effects.overdueTicketIds.length
          ? 'overdue'
          : 'employee_request'
    overrides.push({
      rule: 'action_without_tool',
      why: 'O modelo decidiu transferir sem chamar a ferramenta; o código transferiu.',
    })
    transfer = { reason, summary: summary(), by: 'rule' }
  }

  // Annex A: an overdue ticket must be offered to an analyst (decision #2: offer, transfer on "sim").
  if (effects.overdueTicketIds.length && !transfer) {
    const offered = decision.quickReplies?.some((q) => /analista/i.test(q)) ?? false
    if (!offered) {
      decision = { ...decision, quickReplies: [...OVERDUE_QUICK_REPLIES] }
      overrides.push({
        rule: 'overdue_offer',
        why: `${effects.overdueTicketIds.join(', ')} passou do SLA: oferecer transferência para um analista.`,
      })
    }
  }

  return { decision, reply, overrides, ...(transfer ? { transfer } : {}), cancelDraftIds }
}

/** Confirmation is a click on the draft card, never typed text, so "Confirmar" is not offered as a quick reply. */
function withoutConfirmReplies(decision: ModelDecision): ModelDecision {
  if (!decision.quickReplies) return decision
  const { quickReplies, ...rest } = decision
  const kept = quickReplies.filter((q) => !/^\s*confirm/i.test(q))
  return kept.length ? { ...rest, quickReplies: kept } : rest
}

/**
 * After the employee confirms a draft (registered now, or queued while the ticket system is down).
 * Annex A: critical cases go to an analyst, so a confirmed critical ticket transfers the conversation.
 */
export function afterCommit(
  draft: Draft,
  ticketId: string | undefined,
  employeeName: string,
): { transfer?: TransferPlan; override?: RuleOverride } {
  const fields = draft.fields
  if (draft.kind !== 'create' || fields?.priority !== 'critical') return {}
  const ref = ticketId ?? `o rascunho ${draft.id} (pendente de registro)`
  return {
    transfer: {
      reason: 'critical',
      by: 'rule',
      ...(ticketId ? { ticketId } : {}),
      summary:
        `${employeeName} abriu ${ref} (${PRIORITY_LABELS.critical}): ${fields.title}. ${fields.description}`.slice(
          0,
          1000,
        ),
    },
    override: {
      rule: 'critical_transfer',
      from: 'commit_draft',
      to: 'transfer_to_analyst',
      why: `${ticketId ?? draft.id} é crítico: transferência automática para um analista.`,
    },
  }
}
